"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { favoriteMovieColumns } from "@/lib/favorite-movie";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/session";
import { parseFavoriteMovieForm, type MovieFormState } from "@/lib/validation";

export async function changeFavoriteMovie(formData: FormData): Promise<MovieFormState> {
  // Server actions are public endpoints, so re-check the session here.
  const userId = await getSessionUserId();
  if (!userId) redirect("/");

  const result = parseFavoriteMovieForm(formData);
  if (!result.success) return result.state;

  // Facts are stored per movie, so nothing else needs updating: a new title
  // starts with no facts, and switching back finds the old ones.
  await prisma.user.update({ where: { id: userId }, data: await favoriteMovieColumns(result) });

  // Re-render the dashboard with the new title and backdrop.
  refresh();
  return {};
}
