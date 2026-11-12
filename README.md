# Movie Memory

Sign in with Google, tell the app your favorite movie, and get a fun fact about it from OpenAI.

**Variant chosen: A (backend: caching and correctness).**

Built with Next.js 16 (App Router), React 19, TailwindCSS 4, Postgres 17, Prisma 6, Auth.js v5 (Google), and the OpenAI API.

---

## Setup

### Prerequisites

- Node.js 22 LTS or 24 (`.nvmrc` pins 22)
- Docker (for Postgres)
- A Google OAuth client and an OpenAI API key

### 1. Install

```bash
npm install
cp .env.example .env    # then fill it in; see below
```

### 2. Environment variables

| Variable             | Required | Purpose                                                                 |
| -------------------- | -------- | ----------------------------------------------------------------------- |
| `DATABASE_URL`       | yes      | Postgres connection string. The default matches `docker-compose.yml`.  |
| `AUTH_SECRET`        | yes      | Encrypts Auth.js cookies and tokens. Generate with `openssl rand -base64 32`. |
| `AUTH_GOOGLE_ID`     | yes      | Google OAuth client ID                                                  |
| `AUTH_GOOGLE_SECRET` | yes      | Google OAuth client secret                                              |
| `OPENAI_API_KEY`     | yes      | OpenAI API key (server-side only)                                       |
| `OPENAI_MODEL`       | no       | Defaults to `gpt-4o-mini`                                               |
| `TMDB_READ_ACCESS_TOKEN` | no   | TMDB token for the dashboard's movie art. Without it, posters come from Wikipedia and there's no wide still. |
| `AUTH_TRUST_HOST`    | no       | Set to `true` only when running `npm start` (production mode) on localhost |
| `TEST_DATABASE_URL`  | no       | Overrides the test database (default `…/movie_memory_test`)             |

None of these are prefixed with `NEXT_PUBLIC_`, so Next.js never sends them to the browser.

**Google OAuth client:** Google Cloud Console → APIs & Services → Credentials → *Create OAuth client ID* → *Web application*.

- Authorized JavaScript origin: `http://localhost:3000`
- Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`

If the consent screen is in "Testing" mode, add your Google account as a test user.

**TMDB token (optional):** create a free account at [themoviedb.org](https://www.themoviedb.org/signup), then go to Settings → API, request a developer API key, and copy the **API Read Access Token** (the long one, not the short API key).

### 3. Database and migrations

```bash
npm run db:up        # docker compose up -d --wait: Postgres on localhost:5432
npm run db:migrate   # prisma migrate deploy: applies prisma/migrations
```

On first start, the container also creates an empty `movie_memory_test` database for the test suite (`docker/init-test-db.sql`). To change the schema later, edit `prisma/schema.prisma` and run `npx prisma migrate dev --name <change>`.

### 4. Run

```bash
npm run dev          # http://localhost:3000
npm test             # requires the database container to be running
npm run lint
```

The test suite runs against a real Postgres database (`movie_memory_test`), because the concurrency guarantees under test come from Postgres itself. Global setup applies migrations to that database, and it refuses to run against any database whose name doesn't end in `_test`. OpenAI is always faked in tests.

---

## Architecture overview

```
app/
  page.tsx                  Landing page; routes signed-in users to /onboarding or /dashboard
  onboarding/               First-time-only page and the saveFavoriteMovie server action
  dashboard/                Profile, favorite movie, <FactCard> (client), changeFavoriteMovie action
  api/fact/route.ts         GET /api/fact: the only fact endpoint
  api/auth/[...nextauth]/   Auth.js handlers (Google callback, session, sign-out)
auth.ts                     Auth.js config: Google provider, Prisma adapter, database sessions
lib/
  facts.ts                  Fact service: 60s cache, burst protection, failure fallback
  openai.ts                 OpenAI call (server-only, timeout, output cap)
  session.ts                getSessionUserId / requireUser: the only source of identity
  validation.ts             Zod schema for the movie title
prisma/                     Schema and migrations
tests/                      Vitest, against a real Postgres
```

The additions outside the spec (film picker, movie art) have their own files, listed in [docs/extras.md](docs/extras.md).

### Auth flow

1. Signed out, `/` shows the landing page. "Sign in with Google" is a server action that calls Auth.js `signIn("google")`.
2. When Google redirects back, Auth.js's Prisma adapter creates the `User` and `Account` rows on first login and a `Session` row on every login. The browser gets an opaque, HTTP-only session cookie.
3. Auth.js redirects to `/`, which routes the user: **no favorite movie yet → `/onboarding`, otherwise → `/dashboard`.** "First-time" therefore means "hasn't finished onboarding", so abandoning onboarding brings you back to it.
4. Every page, server action and route handler checks the session itself (no middleware-only gate): pages redirect to `/`, and `/api/fact` returns 401.
5. Logout deletes the `Session` row and cookie. A sign-in cancelled at Google returns to `/` with a friendly message rather than Auth.js's generic error page (Google omits the `iss` parameter that Auth.js expects on error responses).

### Data model

```
User ──1:N── Account     (Auth.js: Google account link)
     ──1:N── Session     (Auth.js: database sessions)
     ──1:N── MovieFact   (generated facts, append-only)

User.favoriteMovie  VARCHAR(100) NULL      NULL = onboarding not done
MovieFact           id, userId, movie VARCHAR(100), content TEXT, createdAt
                    INDEX (userId, movie, createdAt DESC)
```

- **The favorite is a column on `User`.** Each user has exactly one, so a separate table would add nothing, and `NULL` doubles as the "needs onboarding" signal. A film picked from the search list also stores its Wikipedia details ([docs/extras.md](docs/extras.md)).
- **Each fact stores the movie it was generated for**, so the cache key is `(userId, movie)`, as the spec describes. Changing the favorite never serves the old movie's facts.
- **Facts are append-only.** A cache hit just means "the newest row is under 60s old", so there's no cache table to keep in sync, and the history comes free.
- **The composite index** serves the hot query (latest fact for a user and movie) as a single index lookup, and `VARCHAR(100)` enforces the validation limit in the database too.
- **Auth.js tables** follow the adapter's shape. `VerificationToken` is omitted because only email sign-in uses it.

### Fact generation (`lib/facts.ts`)

```
GET /api/fact
  └─ userId := session            (never from the request)
     getFactForUser(userId)
       1. read favoriteMovie                          ── none → 409
       2. latest fact for (userId, movie) < 60s old?  ── yes → return "cache"    (no lock)
       3. BEGIN (READ COMMITTED)
            SET LOCAL lock_timeout = '12s'
            pg_advisory_xact_lock(hash("movie-fact:" + userId))   ← requests for one user queue here
            latest fact < 60s old?                    ── yes → return "cache"    (another request just made it)
            call OpenAI (10s timeout, no retries)
              ok     → INSERT fact, return "generated"
              failed → latest exists ? return "stale" : 503 friendly error
          COMMIT  (lock released automatically)
       4. if the transaction itself fails (lock wait timed out, pool exhausted):
            fall back to the step-2 fact ("stale"), or return 503
```

**The 60-second window** is `now - createdAt < 60_000`, so a fact exactly 60s old is stale. The clock is injected, which lets tests check the exact boundaries (59.999s, 60s, 61s) without sleeping. The response also carries `nextFactInSeconds`, so the "Get another fact" button counts down instead of looking broken inside the window; it's relative, so a wrong client clock can't skew it.

**Burst protection** is a per-user, transaction-level Postgres advisory lock with a re-check under the lock. Five tabs opening at once all miss the cache and queue; the first generates and commits, and the other four find its fact. The tests assert exactly one OpenAI call, and fail with five if the lock is removed.

- **`READ COMMITTED` is required:** each statement sees everything committed before it started, so the re-check sees the previous holder's insert. Under `REPEATABLE READ` the snapshot would predate it, and every queued request would generate again.
- **Transaction-level, not session-level:** Prisma pools connections, so the lock must live on the transaction's single connection. It's released on commit, rollback or a dropped connection, so a crashed request can't leave it held.
- **Bounded waiting:** `lock_timeout` (12s) stops requests piling up behind a hanging OpenAI call; a request that times out falls back to the last fact. The common case (a fresh fact exists) skips the lock entirely.

**Failure handling:** an OpenAI timeout, error, empty response or missing key returns the most recent fact for this user and movie, whatever its age, marked `source: "stale"` so the UI can say so. With no fact at all, the route returns a friendly 503 and the card offers "Try again". Unexpected errors return a generic 500. Details are logged on the server, never sent to the client.

### Security

- **Identity comes only from the session.** No route or action accepts a user or fact id, and every fact query filters by `userId`, so two users with the same movie never share a fact. Tests cover this for the service, the route and the failure fallback.
- **Server actions re-check the session** (they're public endpoints) and validate with Zod: trim, collapse whitespace, 1 to 100 characters, no control characters. Onboarding's update is conditional (`WHERE favoriteMovie IS NULL`), so it stays first-time only even from a stale tab.
- **Secrets stay on the server:** nothing is `NEXT_PUBLIC_`, modules that use API keys import `server-only`, and the session callback returns an allowlist (`id`, `name`, `email`, `image`).
- **OpenAI output** is rendered as escaped text and capped at 150 tokens, and the prompt tells the model to treat the title as data.
- **Missing Google data:** no name shows "Movie fan", a missing or broken photo shows an initial, and a missing email isn't shown.

### Beyond the spec

Kept outside the core, and optional: a film picker that tells same-name films apart (*Drishyam* 2013 vs its 2015 remake), the movie's poster and backdrop, and changing your movie. Each falls back to the spec's behaviour when Wikipedia or TMDB is unavailable. Design and tradeoffs: [docs/extras.md](docs/extras.md).

---

## Why Variant A

The interesting problems in this app are on the backend: a time-based cache, concurrent requests racing to generate the same fact, and a third-party API that can be slow or down. Those problems have precise correctness criteria and can be tested deterministically against a real database. That makes Variant A the best way to show data modeling and concurrency reasoning in a small codebase.

## Key tradeoffs

- **Advisory lock vs. the other options.**
  - *An in-memory lock* only works within one server process. It breaks with multiple instances or serverless.
  - *A unique constraint per 60-second bucket* stops duplicate rows but not duplicate OpenAI calls (both racers call OpenAI, one insert fails). It also breaks at bucket boundaries: requests at 0:59.9 and 1:00.1 land in different buckets.
  - *A "generation in progress" flag* needs a lease expiry for crashed requests, plus polling for the requests that lose the race.

  The advisory lock is correct across instances, cleans up after crashes automatically, and needs no extra schema. **Its cost:** the transaction holds a pooled connection for the length of the OpenAI call (about 1 to 3s, at most 10s), and so does each queued request. That's fine at this scale; for high traffic I'd switch to a lease row, or move generation to a background job.
- **App clock vs. database clock.** `createdAt` is written and compared with the app server's clock, which keeps the logic testable. With multiple instances this assumes NTP-synced clocks; a few seconds of skew only shifts the window edge.
- **A stale fact beats an error.** On failure, the last fact is served whatever its age, and the UI labels it.
- **No retries on OpenAI calls.** Retries would lengthen the time the lock is held. The fallback covers transient failures, and the next request simply tries again.
- **`gpt-4o-mini` by default:** fast and cheap, but it sometimes invents details, especially for recent or obscure films. `OPENAI_MODEL` swaps in a stronger model without code changes.
- **Changing the movie starts a fresh cache window**, since facts are keyed by movie. A user who keeps switching titles can trigger one generation per switch; the per-user cap below would close that.
- **The fact loads on the client after the page renders**, so the dashboard never waits on OpenAI. The card has explicit loading, error and retry states.
- **Database sessions rather than JWTs.** Sessions are revocable and the cookie holds only an opaque token, at the cost of one indexed query per authenticated request.
- **Pinned to stable releases:** Prisma 6 (npm's `latest` points at a Prisma 8 release candidate) and Vitest 4.

## What I'd improve with 2 more hours

1. **Ground facts in the film's Wikipedia summary.** Passing the article's intro to the model as context would make facts accurate rather than plausible.
2. **A per-user generation cap** (for example 10 per 10 minutes, counted under the lock), closing the movie-switching loophole above.
3. **Negative caching for OpenAI.** During an outage, each refresh still makes one attempt per user; remembering the last failure for about 30s would cut load and latency.
4. **Lease-based generation.** A short-lived "claim" row instead of a long-held transaction, so the OpenAI call runs outside any transaction and waiters don't hold connections.
5. **End-to-end tests and CI:** Playwright with a stubbed OAuth provider, plus a GitHub Actions workflow with a Postgres service container.
6. **Refresh Google profile data on sign-in**; the adapter only copies name and photo when the account is created.

---

## AI usage

- I used Claude Code (Anthropic's coding agent) as a pair programmer throughout. It scaffolded the project and wrote first drafts of the implementation, the tests and this README.
- **Design:** I used it to compare the four burst-protection approaches before choosing the advisory lock, and to work through the isolation-level, lock-timeout and connection-pooling details.
- **Iterating on the product:** I reviewed the app in the browser and directed changes, and Claude implemented them: the cinematic redesign, the poster and backdrop, changing the movie, the "New fact in 42s" countdown, and the film picker for telling same-name films apart.
- **Debugging:** it traced the "server configuration" error after a cancelled Google sign-in to Auth.js rejecting Google's error response from the server logs, and diagnosed an OpenAI key that had no model access.
- **Verification:** it ran the test suite, lint, type checks and a production build, and drove the real app in Chrome with Playwright scripts and screenshots, using a seeded database session in place of Google sign-in. It also confirmed the concurrency test is meaningful by removing the lock and showing the test fail.
