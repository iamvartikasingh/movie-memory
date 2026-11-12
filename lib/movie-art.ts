// Finds artwork for the favorite movie: a poster, plus a wide still
// ("backdrop") when one is available. TMDB has both but needs a token, so it's
// optional. Otherwise the poster comes from Wikipedia: saved with the movie
// when it was picked from the search list, or found by searching for a title
// that was typed. Purely decorative: any failure just means less art.
import "server-only";
import type { FavoriteMovie } from "@/lib/favorite-movie";
import { createTtlCache } from "@/lib/ttl-cache";
import { searchFilms, type Film } from "@/lib/wikipedia";

const LOOKUP_TIMEOUT_MS = 3_000;

const TMDB_SEARCH_URL = "https://api.themoviedb.org/3/search/movie";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

export type MovieArt = {
  posterUrl: string | null;
  backdropUrl: string | null;
  source: "tmdb" | "wikipedia" | null;
};

const NO_ART: MovieArt = { posterUrl: null, backdropUrl: null, source: null };

// Hits are kept for a day and misses for ten minutes, so repeat visits don't
// call the APIs again (Wikipedia rate-limits anonymous clients), and the
// poster and the backdrop on one page share a single lookup.
const cachedArt = createTtlCache<MovieArt>((art) => (art.source ? 24 * 60 * 60 * 1000 : 10 * 60 * 1000));

export type TmdbMovie = {
  title: string;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_count: number;
};

// Ignores case and a leading article, so "Odyssey" matches "The Odyssey".
// Safe here because vote counts break ties ("Heat" vs "The Heat").
const normalizeTmdbTitle = (title: string) => title.trim().toLowerCase().replace(/^(the|a|an)\s+/, "");

/**
 * Picks the search result most likely to be this movie: among results with
 * any art, the best-known film with the same title (so "Dune" is the 2021
 * film, not the 1984 one), otherwise TMDB's top match.
 */
export function pickTmdbMovie(results: TmdbMovie[], movie: string): TmdbMovie | undefined {
  const withArt = results.filter((result) => result.poster_path || result.backdrop_path);
  const sameTitle = withArt
    .filter((result) => normalizeTmdbTitle(result.title) === normalizeTmdbTitle(movie))
    .sort((a, b) => b.vote_count - a.vote_count);
  return sameTitle[0] ?? withArt[0];
}

async function lookUpTmdb(movie: FavoriteMovie, token: string): Promise<MovieArt | null> {
  const url = new URL(TMDB_SEARCH_URL);
  url.search = new URLSearchParams({
    query: movie.displayTitle,
    include_adult: "false",
    language: "en-US",
    // The release year separates same-name films ("Drishyam" 2013 vs 2015).
    ...(movie.year ? { year: String(movie.year) } : {}),
  }).toString();

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`TMDB responded with ${response.status}`);

  const data = (await response.json()) as { results?: TmdbMovie[] };
  const match = pickTmdbMovie(data.results ?? [], movie.displayTitle);
  if (!match) return null;
  return {
    posterUrl: match.poster_path ? `${TMDB_IMAGE_BASE}/w500${match.poster_path}` : null,
    // Backdrops are 16:9; w1280 is sharp on most screens without being huge.
    backdropUrl: match.backdrop_path ? `${TMDB_IMAGE_BASE}/w1280${match.backdrop_path}` : null,
    source: "tmdb",
  };
}

// Strips a trailing "(1995 film)". Keeps a leading "The", since Wikipedia has
// no vote counts to tell "Heat" from "The Heat".
const normalizeWikipediaTitle = (title: string) => title.toLowerCase().replace(/\s*\(.*\)$/, "").trim();

/** For a typed title: the film with a poster whose title matches exactly ("Heat" → "Heat (1995 film)"), else the top one. */
export function pickPosterFilm(films: Film[], movie: string): Film | undefined {
  const withPoster = films.filter((film) => film.posterUrl);
  return withPoster.find((film) => normalizeWikipediaTitle(film.title) === normalizeWikipediaTitle(movie)) ?? withPoster[0];
}

const logFailure = (source: string) => (error: unknown) => {
  console.error(`${source} lookup failed`, error);
  return null;
};

async function lookUpMovieArt(movie: FavoriteMovie): Promise<MovieArt> {
  const token = process.env.TMDB_READ_ACCESS_TOKEN;
  if (token) {
    const art = await lookUpTmdb(movie, token).catch(logFailure("TMDB"));
    if (art) return art;
  }
  // A film picked from the search list already has its own poster.
  if (movie.posterUrl) return { posterUrl: movie.posterUrl, backdropUrl: null, source: "wikipedia" };
  if (movie.wikipediaId) return NO_ART;

  const films = await searchFilms(movie.title).catch(logFailure("Wikipedia"));
  const posterUrl = films && pickPosterFilm(films, movie.title)?.posterUrl;
  return posterUrl ? { posterUrl, backdropUrl: null, source: "wikipedia" } : NO_ART;
}

/** Never rejects: a movie with no art found gets nulls. */
export function findMovieArt(movie: FavoriteMovie): Promise<MovieArt> {
  return cachedArt(`${movie.title.toLowerCase()}|${movie.year ?? ""}`, () => lookUpMovieArt(movie));
}
