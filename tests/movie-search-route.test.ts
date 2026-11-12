import { afterEach, describe, expect, it, vi } from "vitest";

// Stand in for the Auth.js session; Wikipedia is stubbed per test.
vi.mock("@/lib/session", () => ({ getSessionUserId: vi.fn() }));

import { GET } from "@/app/api/movies/search/route";
import { getSessionUserId } from "@/lib/session";
import { stubFetch, wikiPage, wikipediaResponse } from "./fetch-stubs";

const signInAs = (userId: string | null) => vi.mocked(getSessionUserId).mockResolvedValue(userId);
const search = (q: string) => GET(new Request(`http://localhost/api/movies/search?q=${encodeURIComponent(q)}`));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/movies/search", () => {
  it("returns 401 without a session and doesn't search", async () => {
    signInAs(null);
    const fetchMock = stubFetch({});

    expect((await search("Heat")).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a query that's too short", async () => {
    signInAs("user-1");

    expect((await search(" a ")).status).toBe(400);
  });

  it("returns at most six films", async () => {
    signInAs("user-1");
    const pages = Array.from({ length: 8 }, (_, i) => wikiPage(i + 1, `Ramayana ${i + 1}`, `${2000 + i} Indian film`));
    stubFetch({ wikipedia: () => wikipediaResponse([...pages, wikiPage(99, "Valmiki", "Ancient Indian poet")]) });

    const response = await search("Ramayana");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.results).toHaveLength(6);
    expect(body.results[0]).toEqual({
      wikipediaId: 1,
      title: "Ramayana 1",
      description: "2000 Indian film",
      posterUrl: "https://upload.wikimedia.org/1.jpg",
    });
  });

  it("returns a friendly 503 when Wikipedia is down", async () => {
    signInAs("user-1");
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch({});

    const response = await search("Unreachable Movie");

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Search isn't available right now. You can still type the title." });
  });
});
