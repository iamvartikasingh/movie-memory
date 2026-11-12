import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stand in for the Auth.js session and Next's router refresh. Prisma and
// Postgres are real.
vi.mock("@/lib/session", () => ({ getSessionUserId: vi.fn() }));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));

import { refresh } from "next/cache";
import { changeFavoriteMovie } from "@/app/dashboard/actions";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/session";
import { stubFetch, wikiPage, wikipediaResponse } from "./fetch-stubs";
import { createUser, resetDatabase } from "./helpers";

const signInAs = (userId: string | null) => vi.mocked(getSessionUserId).mockResolvedValue(userId);

const form = (favoriteMovie: string, wikipediaId?: number) => {
  const data = new FormData();
  data.set("favoriteMovie", favoriteMovie);
  if (wikipediaId) data.set("wikipediaId", String(wikipediaId));
  return data;
};

const movieOf = async (userId: string) =>
  (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).favoriteMovie;

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(refresh).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(() => prisma.$disconnect());

describe("changeFavoriteMovie", () => {
  it("changes only the signed-in user's movie, normalized like onboarding", async () => {
    const alice = await createUser("Inception");
    const bob = await createUser("Inception");
    signInAs(alice.id);

    expect(await changeFavoriteMovie(form("  Spirited   Away "))).toEqual({});

    expect(await movieOf(alice.id)).toBe("Spirited Away");
    expect(await movieOf(bob.id)).toBe("Inception");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("saves a film picked from the list with the details Wikipedia reports", async () => {
    const alice = await createUser("Inception");
    signInAs(alice.id);
    stubFetch({
      wikipedia: () => wikipediaResponse([wikiPage(30, "Drishyam (2015 film)", "2015 Indian film by Nishikant Kamat")]),
    });

    expect(await changeFavoriteMovie(form("Drishyam (2015 film)", 30))).toEqual({});

    expect(await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).toMatchObject({
      favoriteMovie: "Drishyam (2015 film)",
      favoriteMovieWikipediaId: 30,
      favoriteMovieDescription: "2015 Indian film by Nishikant Kamat",
      favoriteMoviePosterUrl: "https://upload.wikimedia.org/30.jpg",
    });
  });

  it("clears an earlier pick's details when a title is typed instead", async () => {
    const alice = await createUser("Drishyam (2015 film)");
    await prisma.user.update({
      where: { id: alice.id },
      data: { favoriteMovieWikipediaId: 30, favoriteMovieDescription: "2015 Indian film by Nishikant Kamat" },
    });
    signInAs(alice.id);

    await changeFavoriteMovie(form("Heat"));

    expect(await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).toMatchObject({
      favoriteMovie: "Heat",
      favoriteMovieWikipediaId: null,
      favoriteMovieDescription: null,
    });
  });

  it("rejects an invalid title and keeps the current movie", async () => {
    const alice = await createUser("Inception");
    signInAs(alice.id);

    expect(await changeFavoriteMovie(form("   "))).toEqual({ error: "Please enter a movie title.", value: "   " });

    expect(await movieOf(alice.id)).toBe("Inception");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("redirects to sign-in without a session and changes nothing", async () => {
    const alice = await createUser("Inception");
    signInAs(null);

    await expect(changeFavoriteMovie(form("Heat"))).rejects.toThrow("NEXT_REDIRECT");

    expect(await movieOf(alice.id)).toBe("Inception");
  });
});
