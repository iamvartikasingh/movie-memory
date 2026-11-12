import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  FACT_CACHE_WINDOW_MS,
  FactUnavailableError,
  getFactForUser,
  isWithinCacheWindow,
  NoFavoriteMovieError,
  secondsUntilNextFact,
} from "@/lib/facts";
import { createFact, createUser, resetDatabase } from "./helpers";

const NOW = new Date("2026-01-01T12:00:00.000Z");
const msAgo = (ms: number) => new Date(NOW.getTime() - ms);
const secondsAgo = (seconds: number) => msAgo(seconds * 1000);

/** A fixed clock plus a spy standing in for OpenAI. */
function fakeDeps(generate = async (movie: string) => `Fresh fact about ${movie}`) {
  return { generateFact: vi.fn(generate), now: () => NOW };
}

const failingOpenAI = async (): Promise<string> => {
  throw new Error("Request timed out");
};

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

describe("isWithinCacheWindow", () => {
  it("treats facts younger than 60 seconds as fresh", () => {
    expect(isWithinCacheWindow(NOW, NOW)).toBe(true);
    expect(isWithinCacheWindow(msAgo(FACT_CACHE_WINDOW_MS - 1), NOW)).toBe(true);
  });

  it("treats facts 60 seconds or older as stale", () => {
    expect(isWithinCacheWindow(msAgo(FACT_CACHE_WINDOW_MS), NOW)).toBe(false);
    expect(isWithinCacheWindow(secondsAgo(61), NOW)).toBe(false);
  });
});

describe("secondsUntilNextFact", () => {
  it("counts down whole seconds, rounding up while the fact is still cached", () => {
    expect(secondsUntilNextFact(NOW, NOW)).toBe(60);
    expect(secondsUntilNextFact(msAgo(500), NOW)).toBe(60);
    expect(secondsUntilNextFact(secondsAgo(18), NOW)).toBe(42);
    expect(secondsUntilNextFact(msAgo(FACT_CACHE_WINDOW_MS - 1), NOW)).toBe(1);
  });

  it("reaches 0 exactly when the fact leaves the cache window", () => {
    expect(secondsUntilNextFact(msAgo(FACT_CACHE_WINDOW_MS), NOW)).toBe(0);
    expect(secondsUntilNextFact(secondsAgo(600), NOW)).toBe(0);
  });
});

describe("getFactForUser: 60-second cache", () => {
  it("returns the cached fact when the latest one is under 60 seconds old", async () => {
    const user = await createUser("Inception");
    const cached = await createFact(user.id, "Inception", secondsAgo(59));
    const deps = fakeDeps();

    const result = await getFactForUser(user.id, deps);

    expect(result.source).toBe("cache");
    expect(result.fact.id).toBe(cached.id);
    expect(deps.generateFact).not.toHaveBeenCalled();
  });

  it("generates and stores a new fact once the latest is 60 seconds old", async () => {
    const user = await createUser("Inception");
    await createFact(user.id, "Inception", secondsAgo(60));
    const deps = fakeDeps();

    const result = await getFactForUser(user.id, deps);

    expect(result.source).toBe("generated");
    expect(result.fact).toMatchObject({ content: "Fresh fact about Inception", createdAt: NOW });
    expect(deps.generateFact).toHaveBeenCalledExactlyOnceWith("Inception", null);
    expect(await prisma.movieFact.count({ where: { userId: user.id } })).toBe(2);
  });

  it("generates a fact when the user has none yet", async () => {
    const user = await createUser("Inception");

    const result = await getFactForUser(user.id, fakeDeps());

    expect(result.source).toBe("generated");
    expect(await prisma.movieFact.count()).toBe(1);
  });

  it("only reuses facts about the user's current favorite movie", async () => {
    const user = await createUser("Inception");
    await createFact(user.id, "Heat", secondsAgo(5));

    const result = await getFactForUser(user.id, fakeDeps());

    expect(result.source).toBe("generated");
    expect(result.fact.movie).toBe("Inception");
  });

  it("rejects users who haven't completed onboarding", async () => {
    const user = await createUser(null);

    await expect(getFactForUser(user.id, fakeDeps())).rejects.toBeInstanceOf(NoFavoriteMovieError);
  });
});

describe("getFactForUser: films that share a name", () => {
  it("keeps their facts apart, since a picked film is keyed by its unique Wikipedia title", async () => {
    const user = await createUser("Drishyam (2015 film)");
    await createFact(user.id, "Drishyam", secondsAgo(5), "A fact about the 2013 original");

    const result = await getFactForUser(user.id, fakeDeps());

    expect(result.source).toBe("generated");
    expect(result.fact.content).toBe("Fresh fact about Drishyam (2015 film)");
  });

  it("tells the generator which film a picked title is", async () => {
    const user = await createUser("Drishyam (2015 film)");
    await prisma.user.update({
      where: { id: user.id },
      data: { favoriteMovieDescription: "2015 Indian film by Nishikant Kamat" },
    });
    const deps = fakeDeps();

    await getFactForUser(user.id, deps);

    expect(deps.generateFact).toHaveBeenCalledWith("Drishyam (2015 film)", "2015 Indian film by Nishikant Kamat");
  });
});

describe("getFactForUser: burst protection", () => {
  it("generates exactly one fact when many requests arrive at once", async () => {
    const user = await createUser("Inception");
    const deps = fakeDeps(async (movie) => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return `Fresh fact about ${movie}`;
    });

    // e.g. five tabs opening the dashboard at the same moment.
    const results = await Promise.all(Array.from({ length: 5 }, () => getFactForUser(user.id, deps)));

    expect(deps.generateFact).toHaveBeenCalledTimes(1);
    expect(new Set(results.map((result) => result.fact.id)).size).toBe(1);
    expect(results.filter((result) => result.source === "generated")).toHaveLength(1);
    expect(await prisma.movieFact.count()).toBe(1);
  });
});

describe("getFactForUser: OpenAI failures", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("falls back to the most recent fact when generation fails", async () => {
    const user = await createUser("Inception");
    await createFact(user.id, "Inception", secondsAgo(600), "Oldest fact");
    const latest = await createFact(user.id, "Inception", secondsAgo(300), "Most recent fact");

    const result = await getFactForUser(user.id, fakeDeps(failingOpenAI));

    expect(result.source).toBe("stale");
    expect(result.fact.id).toBe(latest.id);
    expect(await prisma.movieFact.count()).toBe(2);
  });

  it("throws FactUnavailableError when generation fails and nothing is cached", async () => {
    const user = await createUser("Inception");

    await expect(getFactForUser(user.id, fakeDeps(failingOpenAI))).rejects.toBeInstanceOf(
      FactUnavailableError,
    );
  });
});

describe("getFactForUser: authorization", () => {
  it("never serves another user's cached fact, even for the same movie", async () => {
    const alice = await createUser("Inception");
    const bob = await createUser("Inception");
    const bobsFact = await createFact(bob.id, "Inception", secondsAgo(5), "Bob's fact");

    const result = await getFactForUser(alice.id, fakeDeps());

    expect(result.source).toBe("generated");
    expect(result.fact.userId).toBe(alice.id);
    expect(result.fact.id).not.toBe(bobsFact.id);
  });

  it("never falls back to another user's fact when generation fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const alice = await createUser("Inception");
    const bob = await createUser("Inception");
    await createFact(bob.id, "Inception", secondsAgo(300), "Bob's fact");

    await expect(getFactForUser(alice.id, fakeDeps(failingOpenAI))).rejects.toBeInstanceOf(
      FactUnavailableError,
    );
  });
});
