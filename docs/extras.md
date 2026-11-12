# Beyond the spec

These additions sit outside the take-home spec. Each is isolated from the core (auth, onboarding, the Variant A fact service), optional, and degrades to the spec's behaviour when its third-party source is unavailable.

| Addition | Files |
| --- | --- |
| Film picker that tells same-name films apart | `app/movie-picker.tsx`, `app/api/movies/search/route.ts`, `lib/wikipedia.ts`, `lib/favorite-movie.ts` |
| Movie poster and backdrop | `app/dashboard/movie-art.tsx`, `lib/movie-art.ts`, `lib/ttl-cache.ts` |
| Changing your movie | `app/dashboard/favorite-movie.tsx`, `app/dashboard/actions.ts` |

## Telling same-name films apart

"Ramayana" could be the 2026 film, the 1992 anime or the 2010 animated film; "Drishyam" could be the 2013 Malayalam original or its 2015 Hindi remake. A free-text title can't say which, so onboarding and "Change movie" suggest films as you type:

1. The picker calls `GET /api/movies/search?q=` (signed-in users only, cached for 10 minutes), which searches Wikipedia for `"<query> film"` and keeps pages whose short description says they're a film. Each suggestion shows the poster, the article title and the description, e.g. *Drishyam (2015 film): 2015 Indian film by Nishikant Kamat*.
2. Picking one submits its Wikipedia page id next to the title. **The server doesn't trust the browser's copy:** it fetches the page again by id and saves the title, description and poster that Wikipedia reports. If the page isn't a film, or Wikipedia is down, it saves the title as typed.
3. The saved title is the **Wikipedia article title**, which is unique ("Drishyam" vs "Drishyam (2015 film)"). Facts are keyed by `(userId, movie)`, so same-name films get separate facts without any change to the fact service.
4. The OpenAI prompt includes the description, so the model knows which film is meant. The dashboard shows the title without Wikipedia's "(2015 film)" qualifier, with the description underneath.

Typing without picking still works exactly as the spec describes (trimmed, 1 to 100 characters, validated on the server); there's just no description or saved poster. Search results pass the same validation as typed titles, so a picked title always fits `VARCHAR(100)`.

**Data model:** three nullable columns next to `User.favoriteMovie`: `favoriteMovieWikipediaId`, `favoriteMovieDescription` (`VARCHAR(200)`) and `favoriteMoviePosterUrl`. They're set only for a verified pick and cleared when a title is typed instead.

**Tradeoffs:**

- **Wikipedia rather than TMDB as the source of identity.** It needs no API key, its article titles are unique and readable (so they double as the cache key), and its short descriptions are exactly what tells films apart. The cost: "is this a film?" is judged from the description text, a heuristic that excludes people, series and studios. Wikidata's "instance of: film" would be exact, at the cost of another request.
- **Columns on `User` rather than a `Movie` table.** With one favorite per user this is the smallest change, and the fact service works unchanged because the unique title is the key. With several favorites or shared movie pages, I'd move to a `Movie` table referenced by id.

## Movie poster and backdrop

The dashboard hero shows the movie's poster beside its title, with artwork behind it that fades into the page.

- **Sources.** TMDB has posters and wide 16:9 scene stills but needs a free token (`TMDB_READ_ACCESS_TOKEN`), so it's optional. Without it, or if TMDB fails or finds nothing, the poster comes from Wikipedia: saved with a picked film, or found by searching for a typed title. With no wide still, the background is the poster blurred into a colour wash.
- **Matching.** TMDB is searched by the display title and, when known, the release year, so same-name films are told apart; among matches, the best-known film with that title wins. A typed, ambiguous title can still get the wrong film's art; picking from the list avoids that.
- **Never blocks the page.** Both images are server components inside `<Suspense>`, so the dashboard renders immediately and the art streams in. The poster has a fixed-size frame, so nothing shifts when it arrives. Each lookup has a 3-second timeout, and any failure just means less art.
- **Caching.** Results are cached in memory per server process (hits for a day, misses for 10 minutes); in-flight lookups are shared, so the poster and backdrop cost one request. For a real feature I'd store the URLs in the database.
- **Attribution.** This product uses the TMDB API but is not endorsed or certified by TMDB. The hero credits TMDB, or Wikipedia when the poster comes from there.

## Changing your movie

"Change movie" on the dashboard turns the title into the same picker, with Save and Cancel (or Esc). The `changeFavoriteMovie` server action re-checks the session, reuses the onboarding validation, and only updates the signed-in user's row; `refresh()` then re-renders the dashboard. Onboarding itself stays first-time only.

Facts are keyed by movie, so a new title starts with no cached fact and switching back finds the old ones. The catch: switching titles repeatedly can trigger one generation per switch, which a per-user generation cap would close (see the README's improvements).

## Possible next steps

- **Exact TMDB art for picked films:** Wikidata maps a Wikipedia article to its TMDB id, replacing the title-and-year search with an exact lookup.
- **Ground facts in the article:** the picked film's Wikipedia summary, passed to the model as context, would make facts both specific and accurate.
