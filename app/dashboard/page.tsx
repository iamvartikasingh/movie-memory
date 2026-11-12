import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { favoriteMovieOf } from "@/lib/favorite-movie";
import { requireUser } from "@/lib/session";
import { signOutUser } from "../auth-actions";
import { Logo } from "../logo";
import { Avatar } from "./avatar";
import { FactCard } from "./fact-card";
import { FavoriteMovie } from "./favorite-movie";
import { MovieBackdrop, MoviePoster, PosterFrame } from "./movie-art";

// The browser tab shows the movie, e.g. "Drishyam · Movie Memory".
export async function generateMetadata(): Promise<Metadata> {
  const movie = favoriteMovieOf(await requireUser());
  return { title: movie?.displayTitle ?? "Dashboard" };
}

export default async function DashboardPage() {
  const user = await requireUser();
  const movie = favoriteMovieOf(user);
  if (!movie) redirect("/onboarding");

  // Google may not provide a name or photo; fall back gracefully.
  const displayName = user.name?.trim() || "Movie fan";

  return (
    <main className="flex flex-1 flex-col">
      {/* Without a backdrop, the spotlight glow alone fills the hero. */}
      <section className="relative isolate z-10 flex min-h-[50vh] flex-col bg-spotlight sm:min-h-[55vh]">
        {/* Streams in after the page renders, so a slow lookup never delays the dashboard. */}
        <Suspense fallback={null}>
          <MovieBackdrop movie={movie} />
        </Suspense>

        <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-5">
          {/* Hidden on phones to leave room for the name and email. */}
          <div className="hidden shrink-0 sm:block">
            <Logo />
          </div>
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex min-w-0 items-center gap-3 rounded-full bg-black/40 py-1 pr-4 pl-1 ring-1 ring-white/10 backdrop-blur">
              <Avatar src={user.image} name={displayName} />
              <div className="min-w-0 leading-tight">
                <p className="truncate text-sm font-medium">{displayName}</p>
                {user.email && <p className="truncate text-xs text-zinc-400">{user.email}</p>}
              </div>
            </div>
            <form action={signOutUser} className="shrink-0">
              <button
                type="submit"
                className="rounded-full bg-black/40 px-4 py-2 text-sm text-zinc-200 ring-1 ring-white/15 backdrop-blur transition hover:bg-white/10 hover:text-white"
              >
                Log out
              </button>
            </form>
          </div>
        </header>

        <div className="mx-auto mt-auto flex w-full max-w-5xl flex-col gap-6 px-6 pt-16 pb-12 sm:flex-row sm:items-end sm:gap-10">
          <Suspense fallback={<PosterFrame />}>
            <MoviePoster movie={movie} />
          </Suspense>
          <div className="min-w-0 flex-1">
            <FavoriteMovie movie={movie} />
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-5xl px-6 pb-20">
        {/* Keyed by movie so changing it remounts the card and fetches a fact for the new one. */}
        <FactCard key={movie.title} />
      </div>
    </main>
  );
}
