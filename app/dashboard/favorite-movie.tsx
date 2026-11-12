"use client";

import { useActionState, useState } from "react";
import type { FavoriteMovie as Movie } from "@/lib/favorite-movie";
import type { MovieFormState } from "@/lib/validation";
import { MoviePicker } from "../movie-picker";
import { changeFavoriteMovie } from "./actions";

/** The favorite movie as the hero title, with an inline form to change it. */
export function FavoriteMovie({ movie }: { movie: Movie }) {
  const [editing, setEditing] = useState(false);

  if (editing) return <ChangeMovieForm movie={movie} onDone={() => setEditing(false)} />;

  return (
    <>
      <p className="text-xs font-semibold tracking-[0.25em] text-amber-400 uppercase">Your favorite movie</p>
      <h1 className="mt-3 max-w-4xl font-display text-6xl leading-[0.95] text-balance wrap-break-word text-shadow-lg sm:text-8xl">
        {movie.displayTitle}
      </h1>
      {/* Which film exactly, e.g. "2015 Indian film by Nishikant Kamat", when it was picked from the list. */}
      {movie.description && (
        <p className="mt-3 text-lg text-zinc-300 text-shadow-md first-letter:uppercase">{movie.description}</p>
      )}
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="mt-6 inline-flex items-center gap-2 rounded-full bg-black/40 px-4 py-2 text-sm text-zinc-200 ring-1 ring-white/15 backdrop-blur transition hover:bg-white/10 hover:text-white"
      >
        <PencilIcon />
        Change movie
      </button>
    </>
  );
}

function ChangeMovieForm({ movie, onDone }: { movie: Movie; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(async (_previous: MovieFormState, formData: FormData) => {
    const next = await changeFavoriteMovie(formData);
    if (!next.error) onDone();
    return next;
  }, {});

  return (
    <form action={formAction} className="max-w-3xl" noValidate>
      <label htmlFor="favoriteMovie" className="text-xs font-semibold tracking-[0.25em] text-amber-400 uppercase">
        Your favorite movie
      </label>
      <MoviePicker
        id="favoriteMovie"
        defaultTitle={movie.title}
        defaultFilm={
          movie.wikipediaId && movie.description
            ? { wikipediaId: movie.wikipediaId, title: movie.title, description: movie.description, posterUrl: movie.posterUrl }
            : null
        }
        autoFocus
        onEscape={onDone}
        invalid={Boolean(state.error)}
        describedBy={state.error ? "favoriteMovie-error" : undefined}
        className="mt-3 w-full border-b-2 border-white/30 bg-transparent pb-2 font-display text-4xl outline-none focus:border-amber-400 aria-invalid:border-red-400 sm:text-6xl"
      />
      {state.error && (
        <p id="favoriteMovie-error" role="alert" className="mt-3 text-sm text-red-300">
          {state.error}
        </p>
      )}
      <div className="mt-6 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-amber-500 px-5 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onDone}
          disabled={pending}
          className="rounded-full bg-black/40 px-4 py-2.5 text-sm text-zinc-200 ring-1 ring-white/15 backdrop-blur transition hover:bg-white/10 hover:text-white disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function PencilIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="size-4">
      <path d="M13.586 3.586a2 2 0 1 1 2.828 2.828l-.793.793-2.828-2.828.793-.793ZM11.379 5.793 3 14.172V17h2.828l8.38-8.379-2.83-2.828Z" />
    </svg>
  );
}
