import { afterEach, describe, expect, it, vi } from "vitest";
import { displayTitle, favoriteMovieColumns, favoriteMovieOf } from "@/lib/favorite-movie";
import { stubFetch, wikiPage, wikipediaResponse } from "./fetch-stubs";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const columns = (favoriteMovie: string | null, favoriteMovieDescription: string | null = null) => ({
  favoriteMovie,
  favoriteMovieDescription,
  favoriteMovieWikipediaId: null,
  favoriteMoviePosterUrl: null,
});

describe("displayTitle", () => {
  it("drops Wikipedia's film qualifier", () => {
    expect(displayTitle("Drishyam (2015 film)")).toBe("Drishyam");
    expect(displayTitle("Up (2009 film)")).toBe("Up");
    expect(displayTitle("Arrival (film)")).toBe("Arrival");
  });

  it("keeps any other parentheses, including a year typed by the user", () => {
    expect(displayTitle("Ramayana (1993)")).toBe("Ramayana (1993)");
    expect(displayTitle("Birdman or (The Unexpected Virtue of Ignorance)")).toBe(
      "Birdman or (The Unexpected Virtue of Ignorance)",
    );
  });
});

describe("favoriteMovieOf", () => {
  it("is null before onboarding", () => {
    expect(favoriteMovieOf(columns(null))).toBeNull();
  });

  it("reads the release year from the description, or from the title's qualifier", () => {
    expect(favoriteMovieOf(columns("Drishyam (2015 film)", "2015 Indian film by Nishikant Kamat"))?.year).toBe(2015);
    expect(favoriteMovieOf(columns("Ramayana (1993)"))?.year).toBe(1993);
    expect(favoriteMovieOf(columns("2001: A Space Odyssey"))?.year).toBeNull();
  });
});

describe("favoriteMovieColumns", () => {
  it("saves a picked film with the details Wikipedia reports, not what the browser typed", async () => {
    stubFetch({ wikipedia: () => wikipediaResponse([wikiPage(30, "Drishyam (2015 film)", "2015 Indian film by Nishikant Kamat")]) });

    expect(await favoriteMovieColumns({ movie: "anything", wikipediaId: 30 })).toEqual({
      favoriteMovie: "Drishyam (2015 film)",
      favoriteMovieWikipediaId: 30,
      favoriteMovieDescription: "2015 Indian film by Nishikant Kamat",
      favoriteMoviePosterUrl: "https://upload.wikimedia.org/30.jpg",
    });
  });

  it("saves the typed title when the picked page isn't a film", async () => {
    stubFetch({ wikipedia: () => wikipediaResponse([wikiPage(7, "Michael Mann", "American film director")]) });

    expect(await favoriteMovieColumns({ movie: "Heat", wikipediaId: 7 })).toEqual(columns("Heat"));
  });

  it("saves the typed title when Wikipedia is down", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch({});

    expect(await favoriteMovieColumns({ movie: "Heat", wikipediaId: 42 })).toEqual(columns("Heat"));
  });

  it("doesn't call Wikipedia for a title that wasn't picked", async () => {
    const fetchMock = stubFetch({});

    expect(await favoriteMovieColumns({ movie: "Heat", wikipediaId: null })).toEqual(columns("Heat"));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
