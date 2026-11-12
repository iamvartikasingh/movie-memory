import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Stand in for the Auth.js session and for OpenAI. Everything else (the fact
// service, Prisma, Postgres) is real.
vi.mock("@/lib/session", () => ({ getSessionUserId: vi.fn() }));
vi.mock("@/lib/openai", () => ({ generateMovieFact: vi.fn() }));

import { GET } from "@/app/api/fact/route";
import { generateMovieFact } from "@/lib/openai";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/session";
import { createFact, createUser, resetDatabase } from "./helpers";

const signInAs = (userId: string | null) => vi.mocked(getSessionUserId).mockResolvedValue(userId);

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(generateMovieFact).mockReset().mockResolvedValue("A fresh fact");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterAll(() => prisma.$disconnect());

describe("GET /api/fact", () => {
  it("returns 401 and generates nothing without a session", async () => {
    signInAs(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(generateMovieFact).not.toHaveBeenCalled();
  });

  it("returns only the signed-in user's facts", async () => {
    // The handler takes no input at all (no user id, no fact id), so the
    // session is the only way to choose whose facts are read.
    const alice = await createUser("Inception");
    const bob = await createUser("Inception");
    await createFact(bob.id, "Inception", new Date(), "Bob's fact");
    signInAs(alice.id);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ source: "generated", fact: { content: "A fresh fact", movie: "Inception" } });
    // A fact made just now keeps the next one a full window away.
    expect(body.nextFactInSeconds).toBe(60);
    expect(JSON.stringify(body)).not.toContain("Bob's fact");
    // The response never includes internal ids.
    expect(body.fact).not.toHaveProperty("userId");
  });

  it("returns 409 when the user hasn't picked a movie yet", async () => {
    const user = await createUser(null);
    signInAs(user.id);

    const response = await GET();

    expect(response.status).toBe(409);
  });

  it("returns a friendly 429, without calling OpenAI, once the user reaches the generation limit", async () => {
    const user = await createUser("Inception");
    // Ten facts in the last 5 minutes; the oldest leaves the 10-minute window in 5 minutes.
    for (let i = 0; i < 10; i++) {
      await createFact(user.id, `Other movie ${i}`, new Date(Date.now() - (i + 1) * 30_000));
    }
    signInAs(user.id);

    const response = await GET();

    expect(response.status).toBe(429);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await response.json()).toEqual({ error: "You've asked for a lot of new facts. Please try again in 5 minutes." });
    expect(generateMovieFact).not.toHaveBeenCalled();
  });

  it("returns a friendly 503 when OpenAI fails and nothing is cached", async () => {
    const user = await createUser("Inception");
    signInAs(user.id);
    vi.mocked(generateMovieFact).mockRejectedValue(new Error("Request timed out"));

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "We couldn't come up with a fact right now. Please try again in a moment.",
    });
  });
});
