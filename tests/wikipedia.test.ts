import { afterEach, describe, expect, it, vi } from "vitest";
import { getFilm, isFilmPage, searchFilms } from "@/lib/wikipedia";
import { requestedUrls, stubFetch, wikiPage, wikipediaResponse } from "./fetch-stubs";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isFilmPage", () => {
  it("accepts pages Wikipedia describes as a film", () => {
    expect(isFilmPage(wikiPage(1, "Drishyam (2015 film)", "2015 Indian film by Nishikant Kamat"))).toBe(true);
    expect(isFilmPage(wikiPage(2, "Ramayana: The Legend of Prince Rama", "1992 anime film by Yugo Sako"))).toBe(true);
  });

  it("rejects people, series, and other pages that merely mention film", () => {
    expect(isFilmPage(wikiPage(1, "Yugo Sako", "Japanese film director, screenwriter, and producer"))).toBe(false);
    expect(isFilmPage(wikiPage(2, "Drishyam (film series)", "Indian film series"))).toBe(false);
    expect(isFilmPage(wikiPage(3, "Up (song)", "song by Shania Twain"))).toBe(false);
    expect(isFilmPage({ ...wikiPage(4, "Heat", "1995 film"), missing: true })).toBe(false);
  });

  it("rejects titles that couldn't be saved as a favorite movie", () => {
    expect(isFilmPage(wikiPage(1, "A".repeat(101), "2020 film"))).toBe(false);
  });
});

describe("searchFilms", () => {
  it("returns only films, in search rank order", async () => {
    const fetchMock = stubFetch({
      wikipedia: () =>
        wikipediaResponse([
          wikiPage(30, "Drishyam (2015 film)", "2015 Indian film by Nishikant Kamat", { index: 2 }),
          wikiPage(10, "Drishyam (film series)", "Indian film series", { index: 3 }),
          wikiPage(20, "Drishyam", "2013 Indian film by Jeethu Joseph", { index: 1, withImage: false }),
        ]),
    });

    expect(await searchFilms("Drishyam")).toEqual([
      { wikipediaId: 20, title: "Drishyam", description: "2013 Indian film by Jeethu Joseph", posterUrl: null },
      {
        wikipediaId: 30,
        title: "Drishyam (2015 film)",
        description: "2015 Indian film by Nishikant Kamat",
        posterUrl: "https://upload.wikimedia.org/30.jpg",
      },
    ]);
    expect(requestedUrls(fetchMock)[0].searchParams.get("gsrsearch")).toBe("Drishyam film");
  });

  it("throws when Wikipedia is unavailable", async () => {
    stubFetch({});
    await expect(searchFilms("Heat")).rejects.toThrow("Wikipedia responded with 503");
  });
});

describe("getFilm", () => {
  it("returns the film for a page id", async () => {
    const fetchMock = stubFetch({ wikipedia: () => wikipediaResponse([wikiPage(42, "Heat (1995 film)", "1995 film by Michael Mann")]) });

    expect(await getFilm(42)).toMatchObject({ wikipediaId: 42, title: "Heat (1995 film)" });
    expect(requestedUrls(fetchMock)[0].searchParams.get("pageids")).toBe("42");
  });

  it("returns null for a page that isn't a film or doesn't exist", async () => {
    stubFetch({ wikipedia: () => wikipediaResponse([wikiPage(7, "Michael Mann", "American film director and producer")]) });
    expect(await getFilm(7)).toBeNull();

    stubFetch({ wikipedia: () => wikipediaResponse([{ pageid: 8, title: "", missing: true }]) });
    expect(await getFilm(8)).toBeNull();
  });
});
