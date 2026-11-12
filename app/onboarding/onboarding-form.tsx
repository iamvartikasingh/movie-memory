"use client";

import { useActionState } from "react";
import type { MovieFormState } from "@/lib/validation";
import { MoviePicker } from "../movie-picker";
import { saveFavoriteMovie } from "./actions";

const initialState: MovieFormState = {};

export function OnboardingForm() {
  const [state, formAction, pending] = useActionState(saveFavoriteMovie, initialState);

  return (
    <form action={formAction} className="mt-8 space-y-4" noValidate>
      <div>
        <label htmlFor="favoriteMovie" className="block text-sm font-medium text-zinc-300">
          Favorite movie
        </label>
        <MoviePicker
          id="favoriteMovie"
          defaultTitle={state.value}
          placeholder="e.g. Spirited Away"
          autoFocus
          invalid={Boolean(state.error)}
          describedBy={state.error ? "favoriteMovie-error" : undefined}
          className="mt-2 w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-lg outline-none placeholder:text-zinc-500 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/30 aria-invalid:border-red-400"
        />
        {state.error && (
          <p id="favoriteMovie-error" role="alert" className="mt-2 text-sm text-red-300">
            {state.error}
          </p>
        )}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-full bg-amber-500 px-5 py-3 font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Saving…" : "Continue"}
      </button>
    </form>
  );
}
