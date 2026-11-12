import { getSessionUserId } from "@/lib/session";
import { createTtlCache } from "@/lib/ttl-cache";
import { MOVIE_TITLE_MAX_LENGTH } from "@/lib/validation";
import { searchFilms, type Film } from "@/lib/wikipedia";

export type MovieSearchResponse = { results: Film[] };
export type MovieSearchErrorResponse = { error: string };

const MAX_RESULTS = 6;

// Many people type the same titles, and Wikipedia rate-limits anonymous
// clients, so searches are cached for ten minutes.
const cachedSearch = createTtlCache<Film[]>(() => 10 * 60 * 1000);

/** GET /api/movies/search?q=…: films matching a title, for the movie picker. */
export async function GET(request: Request) {
  // Signed-in users only, so this isn't an open proxy to Wikipedia.
  if (!(await getSessionUserId())) {
    return Response.json({ error: "Please sign in." } satisfies MovieSearchErrorResponse, { status: 401 });
  }

  const query = (new URL(request.url).searchParams.get("q") ?? "").trim().replace(/\s+/g, " ");
  if (query.length < 2 || query.length > MOVIE_TITLE_MAX_LENGTH) {
    return Response.json(
      { error: `Search for 2 to ${MOVIE_TITLE_MAX_LENGTH} characters.` } satisfies MovieSearchErrorResponse,
      { status: 400 },
    );
  }

  try {
    const results = await cachedSearch(query.toLowerCase(), () => searchFilms(query));
    return Response.json({ results: results.slice(0, MAX_RESULTS) } satisfies MovieSearchResponse);
  } catch (error) {
    console.error("Movie search failed", error);
    return Response.json(
      { error: "Search isn't available right now. You can still type the title." } satisfies MovieSearchErrorResponse,
      { status: 503 },
    );
  }
}
