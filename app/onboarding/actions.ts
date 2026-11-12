"use server";

import { redirect } from "next/navigation";
import { favoriteMovieColumns } from "@/lib/favorite-movie";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/session";
import { parseFavoriteMovieForm, type MovieFormState } from "@/lib/validation";

export async function saveFavoriteMovie(
  _previous: MovieFormState,
  formData: FormData,
): Promise<MovieFormState> {
  // Server actions are public endpoints, so re-check the session here rather
  // than trusting that the caller came from the onboarding page.
  const userId = await getSessionUserId();
  if (!userId) redirect("/");

  const result = parseFavoriteMovieForm(formData);
  if (!result.success) return result.state;

  // The `favoriteMovie: null` condition keeps onboarding first-time only: a
  // second submit (e.g. from another tab) can't overwrite a movie already set.
  // Changing it later is a separate action on the dashboard.
  await prisma.user.updateMany({
    where: { id: userId, favoriteMovie: null },
    data: await favoriteMovieColumns(result),
  });

  redirect("/dashboard");
}
