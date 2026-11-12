import { z } from "zod";

// Must match @db.VarChar(100) on User.favoriteMovie and MovieFact.movie.
export const MOVIE_TITLE_MAX_LENGTH = 100;

export const favoriteMovieSchema = z
  .string()
  .trim()
  // Collapse runs of whitespace (incl. newlines/tabs) so "The  Matrix" and
  // "The Matrix" are the same movie, and therefore the same cache key.
  .overwrite((value) => value.replace(/\s+/g, " "))
  .min(1, "Please enter a movie title.")
  .max(MOVIE_TITLE_MAX_LENGTH, `Please keep it under ${MOVIE_TITLE_MAX_LENGTH} characters.`)
  // Postgres rejects NUL bytes in text columns; reject all control characters up front.
  .regex(/^\P{Cc}*$/u, "Please remove any special control characters.");

/** What a favorite-movie form shows after a submit: an error, plus the input to refill. */
export type MovieFormState = { error?: string; value?: string };

/**
 * Reads the movie form shared by onboarding and the dashboard: the title, plus
 * the Wikipedia page id when a film was picked from the search list.
 */
export function parseFavoriteMovieForm(
  formData: FormData,
): { success: true; movie: string; wikipediaId: number | null } | { success: false; state: MovieFormState } {
  const raw = formData.get("favoriteMovie");
  const input = typeof raw === "string" ? raw : "";
  const rawId = formData.get("wikipediaId");
  // Anything but a positive integer that fits a Postgres INTEGER is ignored.
  const wikipediaId = typeof rawId === "string" && /^[1-9]\d{0,8}$/.test(rawId) ? Number(rawId) : null;

  const parsed = favoriteMovieSchema.safeParse(input);
  if (parsed.success) return { success: true, movie: parsed.data, wikipediaId };
  return {
    success: false,
    state: { error: parsed.error.issues[0]?.message ?? "Please enter a valid movie title.", value: input },
  };
}
