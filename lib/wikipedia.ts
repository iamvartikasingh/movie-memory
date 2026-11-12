// Film search and lookup via the Wikipedia API, which needs no key. Article
// titles are unique ("Drishyam" vs "Drishyam (2015 film)"), so a picked
// article identifies exactly one film, and its short description ("2015 Indian
// film by Nishikant Kamat") tells same-name films apart.
import "server-only";
import { favoriteMovieSchema } from "@/lib/validation";

const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";
// Wikimedia asks API clients to identify themselves.
const USER_AGENT = "MovieMemory/0.1 (Next.js take-home demo)";
const TIMEOUT_MS = 3_000;
// Must match @db.VarChar(200) on User.favoriteMovieDescription.
const DESCRIPTION_MAX_LENGTH = 200;

export type Film = {
  wikipediaId: number;
  title: string;
  description: string;
  posterUrl: string | null;
};

export type WikipediaPage = {
  pageid: number;
  title: string;
  index?: number;
  missing?: boolean;
  description?: string;
  thumbnail?: { source: string };
};

// "film" in a description that isn't about a film: people, studios, festivals...
const NOT_A_FILM =
  /\b(series|franchise|filmmaker|born)\b|\b(film|movie)\s+(director|producer|critic|festival|studio|score|editor|actor|actress|composer|award|company|distributor|industry|character|soundtrack|genre)\b/i;

/** Whether a page is about a single film, judged by Wikipedia's short description. */
export function isFilmPage(page: WikipediaPage): page is WikipediaPage & { description: string } {
  const description = page.description ?? "";
  return (
    !page.missing &&
    /\b(film|movie)\b/i.test(description) &&
    !NOT_A_FILM.test(description) &&
    // The title becomes the stored favorite movie, so it must pass the same rules as typed input.
    favoriteMovieSchema.safeParse(page.title).success
  );
}

function toFilm(page: WikipediaPage & { description: string }): Film {
  return {
    wikipediaId: page.pageid,
    title: page.title,
    description: page.description.slice(0, DESCRIPTION_MAX_LENGTH),
    posterUrl: page.thumbnail?.source ?? null,
  };
}

async function queryPages(params: Record<string, string>): Promise<WikipediaPage[]> {
  const url = new URL(WIKIPEDIA_API);
  url.search = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    prop: "pageimages|description",
    piprop: "thumbnail",
    pithumbsize: "500",
    // Film posters on Wikipedia are non-free images, which are excluded by default.
    pilicense: "any",
    ...params,
  }).toString();

  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Wikipedia responded with ${response.status}`);

  const data = (await response.json()) as { query?: { pages?: WikipediaPage[] } };
  // Search results arrive unordered, with their rank in `index`.
  return [...(data.query?.pages ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

/** Films matching a title, best match first. */
export async function searchFilms(query: string): Promise<Film[]> {
  const pages = await queryPages({ generator: "search", gsrsearch: `${query} film`, gsrlimit: "10" });
  return pages.filter(isFilmPage).map(toFilm);
}

/** The film with this page id, or null if there's no such page or it isn't a film. */
export async function getFilm(wikipediaId: number): Promise<Film | null> {
  const [page] = await queryPages({ pageids: String(wikipediaId) });
  return page && isFilmPage(page) ? toFilm(page) : null;
}
