import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

/**
 * The signed-in user's id, or null. This is the only source of identity on
 * the server: no route or action accepts a user id from the client.
 */
export async function getSessionUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

/**
 * For pages: loads the signed-in user, or redirects to the landing page.
 * Cached per request, so a page and its metadata share one lookup.
 */
export const requireUser = cache(async () => {
  const userId = await getSessionUserId();
  if (!userId) redirect("/");

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) redirect("/");

  return user;
});

/** Where a signed-in user belongs: onboarding until they've picked a movie. */
export function homePathFor(user: { favoriteMovie: string | null }) {
  return user.favoriteMovie ? "/dashboard" : "/onboarding";
}
