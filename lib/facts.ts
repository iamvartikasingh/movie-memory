import { Prisma, type MovieFact } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generateMovieFact } from "@/lib/openai";

export const FACT_CACHE_WINDOW_MS = 60_000;

// Changing movies starts a fresh cache window, so the cache alone doesn't bound
// OpenAI usage. This caps new facts per user, across all their movies.
export const GENERATION_LIMIT = 10;
export const GENERATION_LIMIT_WINDOW_MS = 10 * 60_000;

/**
 * - `cache`: a fact for this user + movie less than 60s old was reused.
 * - `generated`: a new fact was generated and stored.
 * - `stale`: generation failed, so the most recent (older) fact is returned.
 * - `limited`: the user reached the generation limit, so their most recent
 *   fact for this movie is returned.
 */
export type FactSource = "cache" | "generated" | "stale" | "limited";

/** `nextFactAt` is the earliest time a request could generate a new fact. */
export type FactResult = { fact: MovieFact; source: FactSource; nextFactAt: Date };

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

/** The user reached the generation limit and has no earlier fact for this movie. */
export class GenerationLimitError extends Error {
  readonly retryAt: Date;

  constructor(retryAt: Date) {
    super("Movie fact generation limit reached");
    this.retryAt = retryAt;
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

/** Whole seconds from `now` until `time`, rounded up and never negative. */
export function secondsUntil(time: Date, now: Date): number {
  return Math.max(0, Math.ceil((time.getTime() - now.getTime()) / 1000));
}

/** When a fact leaves the cache window. */
const cacheExpiry = (fact: MovieFact) => new Date(fact.createdAt.getTime() + FACT_CACHE_WINDOW_MS);

function findLatestFact(db: Prisma.TransactionClient, userId: string, movie: string) {
  return db.movieFact.findFirst({
    where: { userId, movie },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * If the user has reached the generation limit, when a slot frees up (the
 * oldest of their last GENERATION_LIMIT facts leaves the window); else null.
 */
async function generationLimitResetAt(db: Prisma.TransactionClient, userId: string, now: Date) {
  const recent = await db.movieFact.findMany({
    where: { userId, createdAt: { gt: new Date(now.getTime() - GENERATION_LIMIT_WINDOW_MS) } },
    orderBy: { createdAt: "desc" },
    take: GENERATION_LIMIT,
    select: { createdAt: true },
  });
  if (recent.length < GENERATION_LIMIT) return null;
  return new Date(recent[GENERATION_LIMIT - 1].createdAt.getTime() + GENERATION_LIMIT_WINDOW_MS);
}

/**
 * Returns a fun fact about the user's favorite movie, generating at most one
 * new fact per user and movie per 60 seconds no matter how many requests
 * arrive at once, and at most GENERATION_LIMIT per user per 10 minutes.
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
    return { fact: cached, source: "cache", nextFactAt: cacheExpiry(cached) };
  }

  try {
    return await generateUnderLock(userId, movie, description, { generateFact, now });
  } catch (error) {
    if (error instanceof FactUnavailableError || error instanceof GenerationLimitError) throw error;
    // The transaction itself failed (lock wait timed out because generation is
    // slow or failing, connection pool exhausted, ...). Degrade gracefully.
    console.error("Movie fact transaction failed", error);
    if (cached) return { fact: cached, source: "stale", nextFactAt: now() };
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
        return { fact: latest, source: "cache" as const, nextFactAt: cacheExpiry(latest) };
      }

      // Counted under the lock, so concurrent requests can't all slip under the limit.
      const retryAt = await generationLimitResetAt(tx, userId, now());
      if (retryAt) {
        if (latest) return { fact: latest, source: "limited" as const, nextFactAt: retryAt };
        throw new GenerationLimitError(retryAt);
      }

      let content: string;
      try {
        content = await generateFact(movie, description);
      } catch (error) {
        console.error("Movie fact generation failed", error);
        if (latest) return { fact: latest, source: "stale" as const, nextFactAt: now() };
        throw new FactUnavailableError({ cause: error });
      }

      const fact = await tx.movieFact.create({
        // createdAt is set from the same clock the window is checked against.
        data: { userId, movie, content, createdAt: now() },
      });
      return { fact, source: "generated" as const, nextFactAt: cacheExpiry(fact) };
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
