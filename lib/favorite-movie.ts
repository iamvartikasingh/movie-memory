import "server-only";
import type { User } from "@prisma/client";
import { getFilm } from "@/lib/wikipedia";

export type FavoriteMovie = {
  /** Identity and fact cache key: the Wikipedia article title, or the title as typed. */
  title: string;
  /** The title without Wikipedia's qualifier: "Drishyam (2015 film)" → "Drishyam". */
  displayTitle: string;
  description: string | null;
  posterUrl: string | null;
  wikipediaId: number | null;
  year: number | null;
};

type FavoriteMovieColumns = Pick<
  User,
  "favoriteMovie" | "favoriteMovieWikipediaId" | "favoriteMovieDescription" | "favoriteMoviePosterUrl"
>;

// Only Wikipedia's "(… film)" qualifiers, so a typed "Ramayana (1993)" is left alone.
export const displayTitle = (title: string) => title.replace(/\s+\([^()]*\bfilm\)$/i, "");

// From the description ("2015 Indian film by …") or a qualifier ("(2015 film)", "(1993)").
function releaseYear(title: string, description: string | null): number | null {
  const match = /\b(1[89]\d\d|20\d\d)\b/.exec(description ?? "") ?? /\((?:[^()]*\D)?(1[89]\d\d|20\d\d)\b[^()]*\)$/.exec(title);
  return match ? Number(match[1]) : null;
}

/** The user's favorite movie, or null before onboarding. */
export function favoriteMovieOf(user: FavoriteMovieColumns): FavoriteMovie | null {
  if (!user.favoriteMovie) return null;
  return {
    title: user.favoriteMovie,
    displayTitle: displayTitle(user.favoriteMovie),
    description: user.favoriteMovieDescription,
    posterUrl: user.favoriteMoviePosterUrl,
    wikipediaId: user.favoriteMovieWikipediaId,
    year: releaseYear(user.favoriteMovie, user.favoriteMovieDescription),
  };
}

/**
 * The User columns to save for a submitted favorite movie. A film picked from
 * the search list is re-fetched from Wikipedia rather than trusting what the
 * browser sent, so only real films are saved with a description and poster.
 * If that fails (no such page, not a film, Wikipedia down), the title is saved
 * as typed, exactly like a title that wasn't picked.
 */
export async function favoriteMovieColumns({
  movie,
  wikipediaId,
}: {
  movie: string;
  wikipediaId: number | null;
}): Promise<FavoriteMovieColumns & { favoriteMovie: string }> {
  const film = wikipediaId
    ? await getFilm(wikipediaId).catch((error) => {
        console.error("Film lookup failed", error);
        return null;
      })
    : null;

  if (film) {
    return {
      favoriteMovie: film.title,
      favoriteMovieWikipediaId: film.wikipediaId,
      favoriteMovieDescription: film.description,
      favoriteMoviePosterUrl: film.posterUrl,
    };
  }
  return {
    favoriteMovie: movie,
    favoriteMovieWikipediaId: null,
    favoriteMovieDescription: null,
    favoriteMoviePosterUrl: null,
  };
}
