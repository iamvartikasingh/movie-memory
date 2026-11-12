import type { ReactNode } from "react";
import type { FavoriteMovie } from "@/lib/favorite-movie";
import { findMovieArt } from "@/lib/movie-art";

// Both components call findMovieArt, which shares one lookup per movie.
// The images are decorative, so they skip the image optimizer and load directly.

const CREDITS = {
  tmdb: { label: "Images from TMDB", href: "https://www.themoviedb.org/" },
  wikipedia: { label: "Poster via Wikipedia", href: "https://en.wikipedia.org/" },
};

/** Behind the hero: the movie's wide still, or else its poster blurred into a colour wash. */
export async function MovieBackdrop({ movie }: { movie: FavoriteMovie }) {
  const { posterUrl, backdropUrl, source } = await findMovieArt(movie);
  const imageUrl = backdropUrl ?? posterUrl;
  if (!imageUrl || !source) return null;

  return (
    <>
      <div aria-hidden="true" className="absolute inset-0 -z-10 overflow-hidden motion-safe:animate-fade-in">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt=""
          className={backdropUrl ? "size-full object-cover" : "size-full scale-110 object-cover blur-xl saturate-150"}
        />
        {/* Darken the top for the nav and the left for the title, and fade the bottom into the page. */}
        <div className="absolute inset-0 bg-linear-to-b from-black/60 to-transparent to-30%" />
        <div className="absolute inset-0 bg-linear-to-r from-black/50 to-transparent to-60%" />
        <div className="absolute inset-0 bg-linear-to-t from-background from-5% via-background/70 via-30% to-transparent to-70%" />
      </div>
      {/* TMDB's terms ask apps that use its API to credit it; Wikipedia gets the same courtesy. */}
      <p className="absolute right-6 bottom-4 text-xs text-zinc-500">
        <a href={CREDITS[source].href} target="_blank" rel="noreferrer" className="hover:text-zinc-300">
          {CREDITS[source].label}
        </a>
      </p>
    </>
  );
}

/** The movie's poster beside the title, or an empty frame if there isn't one. */
export async function MoviePoster({ movie }: { movie: FavoriteMovie }) {
  const { posterUrl } = await findMovieArt(movie);
  return (
    <PosterFrame>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {posterUrl && <img src={posterUrl} alt="" className="size-full object-cover motion-safe:animate-fade-in" />}
    </PosterFrame>
  );
}

/** Fixed poster-sized frame, so the title doesn't shift when the poster arrives. */
export function PosterFrame({ children }: { children?: ReactNode }) {
  return (
    <div className="flex aspect-2/3 w-28 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/5 shadow-2xl ring-1 ring-white/10 sm:w-44">
      {children || <FilmIcon />}
    </div>
  );
}

function FilmIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="size-8 text-zinc-600">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
    </svg>
  );
}
