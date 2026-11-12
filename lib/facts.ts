import { Prisma, type MovieFact } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generateMovieFact } from "@/lib/openai";

export const FACT_CACHE_WINDOW_MS = 60_000;

/**
 * - `cache`: a fact for this user + movie less than 60s old was reused.
 * - `generated`: a new fact was generated and stored.
 * - `stale`: generation failed, so the most recent (older) fact is returned.
 */
export type FactSource = "cache" | "generated" | "stale";

export type FactResult = { fact: MovieFact; source: FactSource };

export class NoFavoriteMovieError extends Error {
  constructor() {
    super("User has not chosen a favorite movie yet");
  }
}

/** Generation failed and there is no earlier fact to fall back to. */
export class FactUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super("Could not generate a movie fact", options);
  }
}

export type FactDeps = {
  generateFact: (movie: string, description: string | null) => Promise<string>;
  now: () => Date;
};

const defaultDeps: FactDeps = {
  generateFact: generateMovieFact,
  now: () => new Date(),
};

// A request waits at most LOCK_WAIT for the lock, then generates for at most
// the OpenAI timeout (10s), so the transaction budget must cover both.
const LOCK_WAIT = "12s";
const TRANSACTION_TIMEOUT_MS = 30_000;

export function isWithinCacheWindow(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() < FACT_CACHE_WINDOW_MS;
}

/**
 * Whole seconds until a fact made at `createdAt` leaves the cache window, i.e.
 * until a request could generate a new one. Rounds up, so it's 0 exactly when
 * `isWithinCacheWindow` turns false.
 */
export function secondsUntilNextFact(createdAt: Date, now: Date): number {
  return Math.max(0, Math.ceil((createdAt.getTime() + FACT_CACHE_WINDOW_MS - now.getTime()) / 1000));
}

function findLatestFact(db: Prisma.TransactionClient, userId: string, movie: string) {
  return db.movieFact.findFirst({
    where: { userId, movie },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Returns a fun fact about the user's favorite movie, generating at most one
 * new fact per user per 60 seconds no matter how many requests arrive at once.
 *
 * `userId` must come from the authenticated session; every query below is
 * scoped by it, so one user can never read or reuse another user's facts.
 */
export async function getFactForUser(
  userId: string,
  { generateFact, now }: FactDeps = defaultDeps,
): Promise<FactResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { favoriteMovie: true, favoriteMovieDescription: true },
  });
  if (!user?.favoriteMovie) throw new NoFavoriteMovieError();
  // The cache key: a picked film's unique Wikipedia title, or the title as typed.
  const movie = user.favoriteMovie;
  const description = user.favoriteMovieDescription;

  // Fast path: a fresh fact can be served without taking the lock.
  const cached = await findLatestFact(prisma, userId, movie);
  if (cached && isWithinCacheWindow(cached.createdAt, now())) {
    return { fact: cached, source: "cache" };
  }

  try {
    return await generateUnderLock(userId, movie, description, { generateFact, now });
  } catch (error) {
    if (error instanceof FactUnavailableError) throw error;
    // The transaction itself failed (lock wait timed out because generation is
    // slow or failing, connection pool exhausted, ...). Degrade gracefully.
    console.error("Movie fact transaction failed", error);
    if (cached) return { fact: cached, source: "stale" };
    throw new FactUnavailableError({ cause: error });
  }
}

function generateUnderLock(
  userId: string,
  movie: string,
  description: string | null,
  { generateFact, now }: FactDeps,
): Promise<FactResult> {
  return prisma.$transaction(
    async (tx) => {
      // Serialize generation per user with a Postgres transaction-level advisory
      // lock. Concurrent requests (rapid refreshes, several tabs, several server
      // instances) queue here; the lock is released automatically on commit or
      // rollback, so a crashed request can't leave it held. lock_timeout bounds
      // the queue so requests don't pile up behind a hanging OpenAI call.
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${LOCK_WAIT}'`);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`movie-fact:${userId}`}, 0))`;

      // Re-check under the lock: whoever held it before us may have just
      // generated a fact, in which case we reuse it rather than generate again.
      const latest = await findLatestFact(tx, userId, movie);
      if (latest && isWithinCacheWindow(latest.createdAt, now())) {
        return { fact: latest, source: "cache" as const };
      }

      let content: string;
      try {
        content = await generateFact(movie, description);
      } catch (error) {
        console.error("Movie fact generation failed", error);
        if (latest) return { fact: latest, source: "stale" as const };
        throw new FactUnavailableError({ cause: error });
      }

      const fact = await tx.movieFact.create({
        // createdAt is set from the same clock the window is checked against.
        data: { userId, movie, content, createdAt: now() },
      });
      return { fact, source: "generated" as const };
    },
    {
      // Required: each READ COMMITTED statement sees rows committed before it
      // started, so the re-check above sees a fact the previous lock holder
      // just committed. Under REPEATABLE READ the snapshot would predate it.
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: TRANSACTION_TIMEOUT_MS,
    },
  );
}
