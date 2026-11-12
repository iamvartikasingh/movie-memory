import { vi } from "vitest";
import type { WikipediaPage } from "@/lib/wikipedia";

/** A Wikipedia page as the API returns it; `index` (search rank) defaults to the page id. */
export const wikiPage = (
  pageid: number,
  title: string,
  description: string,
  { withImage = true, index = pageid }: { withImage?: boolean; index?: number } = {},
): WikipediaPage => ({
  pageid,
  index,
  title,
  description,
  thumbnail: withImage ? { source: `https://upload.wikimedia.org/${pageid}.jpg` } : undefined,
});

export const wikipediaResponse = (pages: WikipediaPage[]) => Response.json({ query: { pages } });

/** Stubs fetch, answering by host. Requests to a host left out get a 503. */
export function stubFetch(responses: { tmdb?: (url: URL) => Response; wikipedia?: (url: URL) => Response }) {
  const fetchMock = vi.fn(async (input: URL | string) => {
    const url = new URL(input);
    const respond =
      url.host === "api.themoviedb.org" ? responses.tmdb : url.host === "en.wikipedia.org" ? responses.wikipedia : undefined;
    return respond ? respond(url) : new Response(null, { status: 503 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The URLs a stubbed fetch was called with. */
export const requestedUrls = (fetchMock: ReturnType<typeof stubFetch>) =>
  fetchMock.mock.calls.map(([input]) => new URL(input));
