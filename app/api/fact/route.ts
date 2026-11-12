import { getSessionUserId } from "@/lib/session";
import {
  FactUnavailableError,
  GenerationLimitError,
  getFactForUser,
  NoFavoriteMovieError,
  secondsUntil,
} from "@/lib/facts";

export type FactResponse = {
  fact: { content: string; movie: string; createdAt: string };
  source: "cache" | "generated" | "stale" | "limited";
  // Relative rather than a timestamp, so a wrong client clock can't skew the
  // UI's countdown. 0 means the next request may generate a new fact.
  nextFactInSeconds: number;
};

export type FactErrorResponse = { error: string };

/**
 * GET /api/fact: a fun fact about the signed-in user's favorite movie.
 * Takes no parameters; the user is always taken from the session.
 */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return Response.json({ error: "Please sign in." } satisfies FactErrorResponse, { status: 401 });
  }

  try {
    const { fact, source, nextFactAt } = await getFactForUser(userId);
    const body: FactResponse = {
      fact: { content: fact.content, movie: fact.movie, createdAt: fact.createdAt.toISOString() },
      source,
      nextFactInSeconds: secondsUntil(nextFactAt, new Date()),
    };
    return Response.json(body);
  } catch (error) {
    if (error instanceof NoFavoriteMovieError) {
      return Response.json(
        { error: "Pick a favorite movie first." } satisfies FactErrorResponse,
        { status: 409 },
      );
    }
    if (error instanceof GenerationLimitError) {
      const seconds = secondsUntil(error.retryAt, new Date());
      const minutes = Math.max(1, Math.ceil(seconds / 60));
      return Response.json(
        {
          error: `You've asked for a lot of new facts. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
        } satisfies FactErrorResponse,
        { status: 429, headers: { "Retry-After": String(seconds) } },
      );
    }
    if (error instanceof FactUnavailableError) {
      return Response.json(
        { error: "We couldn't come up with a fact right now. Please try again in a moment." } satisfies FactErrorResponse,
        { status: 503 },
      );
    }
    console.error("GET /api/fact failed", error);
    return Response.json({ error: "Something went wrong." } satisfies FactErrorResponse, { status: 500 });
  }
}
