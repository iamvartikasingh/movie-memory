import { afterEach, describe, expect, it, vi } from "vitest";
import { favoriteMovieOf } from "@/lib/favorite-movie";
import { findMovieArt, pickPosterFilm, pickTmdbMovie, type TmdbMovie } from "@/lib/movie-art";
import type { Film } from "@/lib/wikipedia";
import { requestedUrls, stubFetch, wikiPage, wikipediaResponse } from "./fetch-stubs";

const tmdbMovie = (title: string, voteCount: number, withArt = true): TmdbMovie => ({
  title,
  vote_count: voteCount,
  poster_path: withArt ? `/poster-${voteCount}.jpg` : null,
  backdrop_path: withArt ? `/backdrop-${voteCount}.jpg` : null,
});

const film = (wikipediaId: number, title: string, withPoster = true): Film => ({
  wikipediaId,
  title,
  description: "film",
  posterUrl: withPoster ? `https://upload.wikimedia.org/${wikipediaId}.jpg` : null,
});

/** A favorite movie as typed, or (with details) as picked from the search list. */
const favorite = (title: string, picked?: { wikipediaId: number; description: string; posterUrl: string | null }) =>
  favoriteMovieOf({
    favoriteMovie: title,
    favoriteMovieWikipediaId: picked?.wikipediaId ?? null,
    favoriteMovieDescription: picked?.description ?? null,
    favoriteMoviePosterUrl: picked?.posterUrl ?? null,
  })!;

describe("pickTmdbMovie", () => {
  it("prefers the best-known film with the same title over TMDB's top result", () => {
    const results = [tmdbMovie("Dune: Part Two", 7000), tmdbMovie("Dune", 3000), tmdbMovie("Dune", 12000)];
    expect(pickTmdbMovie(results, "dune")).toBe(results[2]);
  });

  it("matches titles regardless of a leading article", () => {
    const results = [tmdbMovie("2001: A Space Odyssey", 12000), tmdbMovie("The Odyssey", 4000)];
    expect(pickTmdbMovie(results, "Odyssey")).toBe(results[1]);
  });

  it("falls back to TMDB's top result with art when no title matches", () => {
    const results = [tmdbMovie("Spirited", 900, false), tmdbMovie("Spirited Away", 16000)];
    expect(pickTmdbMovie(results, "Spirited Awya")).toBe(results[1]);
  });

  it("returns nothing when no result has any art", () => {
    expect(pickTmdbMovie([tmdbMovie("Heat", 7000, false)], "Heat")).toBeUndefined();
  });
});

describe("pickPosterFilm", () => {
  it("prefers the film whose title matches exactly over a higher-ranked one", () => {
    const films = [film(1, "The Heat (film)"), film(2, "Heat (1995 film)")];
    expect(pickPosterFilm(films, "heat")?.title).toBe("Heat (1995 film)");
  });

  it("falls back to the top-ranked film with a poster", () => {
    const films = [film(1, "Odyssey 5", false), film(2, "The Odyssey (2026 film)")];
    expect(pickPosterFilm(films, "Odyssey")?.title).toBe("The Odyssey (2026 film)");
  });

  it("returns nothing when no film has a poster", () => {
    expect(pickPosterFilm([film(1, "Up (2009 film)", false)], "Up")).toBeUndefined();
  });
});

describe("findMovieArt", () => {
  // Each test uses its own title, since results are cached for the life of the module.
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses TMDB's poster and backdrop, searching by display title and release year", async () => {
    vi.stubEnv("TMDB_READ_ACCESS_TOKEN", "test-token");
    const fetchMock = stubFetch({ tmdb: () => Response.json({ results: [tmdbMovie("Drishyam", 900)] }) });
    const drishyam = favorite("Drishyam (2015 film)", {
      wikipediaId: 1,
      description: "2015 Indian film by Nishikant Kamat",
      posterUrl: null,
    });

    expect(await findMovieArt(drishyam)).toEqual({
      posterUrl: "https://image.tmdb.org/t/p/w500/poster-900.jpg",
      backdropUrl: "https://image.tmdb.org/t/p/w1280/backdrop-900.jpg",
      source: "tmdb",
    });
    const [url] = requestedUrls(fetchMock);
    expect(url.searchParams.get("query")).toBe("Drishyam");
    expect(url.searchParams.get("year")).toBe("2015");
    const [, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(init.headers).toMatchObject({ Authorization: "Bearer test-token" });
  });

  it("uses a picked film's saved poster without any lookup when there's no token", async () => {
    vi.stubEnv("TMDB_READ_ACCESS_TOKEN", "");
    const fetchMock = stubFetch({});
    const posterUrl = "https://upload.wikimedia.org/arrival.jpg";

    const art = await findMovieArt(favorite("Arrival (film)", { wikipediaId: 2, description: "2016 film", posterUrl }));

    expect(art).toEqual({ posterUrl, backdropUrl: null, source: "wikipedia" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("searches Wikipedia for the poster of a typed title", async () => {
    vi.stubEnv("TMDB_READ_ACCESS_TOKEN", "");
    stubFetch({ wikipedia: () => wikipediaResponse([wikiPage(3, "Amelie (film)", "2001 French film")]) });

    expect(await findMovieArt(favorite("Amelie"))).toEqual({
      posterUrl: "https://upload.wikimedia.org/3.jpg",
      backdropUrl: null,
      source: "wikipedia",
    });
  });

  it("falls back to Wikipedia when TMDB fails", async () => {
    vi.stubEnv("TMDB_READ_ACCESS_TOKEN", "test-token");
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch({ wikipedia: () => wikipediaResponse([wikiPage(4, "Parasite (2019 film)", "2019 South Korean film")]) });

    expect(await findMovieArt(favorite("Parasite"))).toMatchObject({ source: "wikipedia" });
  });

  it("returns no art, without throwing, when every lookup fails", async () => {
    vi.stubEnv("TMDB_READ_ACCESS_TOKEN", "test-token");
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch({});

    expect(await findMovieArt(favorite("Some Unlucky Movie"))).toEqual({
      posterUrl: null,
      backdropUrl: null,
      source: null,
    });
  });

  it("shares one lookup between concurrent callers", async () => {
    vi.stubEnv("TMDB_READ_ACCESS_TOKEN", "");
    const fetchMock = stubFetch({ wikipedia: () => wikipediaResponse([wikiPage(5, "Roma (2018 film)", "2018 Mexican film")]) });

    const [first, second] = await Promise.all([findMovieArt(favorite("Roma")), findMovieArt(favorite("Roma"))]);

    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
