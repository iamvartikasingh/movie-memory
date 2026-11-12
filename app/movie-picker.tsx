"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { MovieSearchErrorResponse, MovieSearchResponse } from "@/app/api/movies/search/route";
import type { Film } from "@/lib/wikipedia";

const SEARCH_DELAY_MS = 300;
const SEARCH_UNAVAILABLE = "Search isn't available right now. You can still type the title.";

type Search =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; results: Film[] }
  | { status: "error"; message: string };

type MoviePickerProps = {
  id: string;
  defaultTitle?: string;
  /** The film already picked, so saving without changes keeps it. */
  defaultFilm?: Film | null;
  invalid?: boolean;
  describedBy?: string;
  className?: string;
  autoFocus?: boolean;
  placeholder?: string;
  /** Escape pressed while the list is closed. */
  onEscape?: () => void;
};

/**
 * A title input that suggests matching films as you type (an ARIA combobox).
 * Picking one also submits its Wikipedia page id as `wikipediaId`, so the
 * server knows exactly which film is meant; a title typed without picking is
 * submitted as is.
 */
export function MoviePicker({
  id,
  defaultTitle = "",
  defaultFilm = null,
  invalid,
  describedBy,
  className,
  autoFocus,
  placeholder,
  onEscape,
}: MoviePickerProps) {
  const listId = useId();
  const hintId = `${id}-hint`;
  const [title, setTitle] = useState(defaultTitle);
  const [picked, setPicked] = useState<Film | null>(defaultFilm);
  const [search, setSearch] = useState<Search>({ status: "idle" });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // The pending search (waiting for typing to pause, or in flight), so a newer
  // keystroke can cancel it and stale results never overwrite newer ones.
  const pending = useRef<{ timer?: ReturnType<typeof setTimeout>; controller?: AbortController }>({});

  useEffect(() => {
    const current = pending.current;
    return () => {
      clearTimeout(current.timer);
      current.controller?.abort();
    };
  }, []);

  function cancelSearch() {
    clearTimeout(pending.current.timer);
    pending.current.controller?.abort();
  }

  function startSearch(query: string) {
    cancelSearch();
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSearch({ status: "idle" });
      setOpen(false);
      return;
    }

    setSearch({ status: "loading" });
    pending.current.timer = setTimeout(async () => {
      const controller = new AbortController();
      pending.current.controller = controller;
      try {
        const response = await fetch(`/api/movies/search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        const body = (await response.json().catch(() => null)) as MovieSearchResponse | MovieSearchErrorResponse | null;
        if (!response.ok || !body || !("results" in body)) {
          setSearch({ status: "error", message: (body && "error" in body && body.error) || SEARCH_UNAVAILABLE });
        } else {
          setSearch({ status: "done", results: body.results });
          setActive(-1);
        }
        setOpen(true);
      } catch {
        if (controller.signal.aborted) return;
        setSearch({ status: "error", message: SEARCH_UNAVAILABLE });
        setOpen(true);
      }
    }, SEARCH_DELAY_MS);
  }

  function choose(film: Film) {
    cancelSearch();
    setTitle(film.title);
    setPicked(film);
    setOpen(false);
  }

  const results = search.status === "done" ? search.results : [];

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && results.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === "ArrowUp" && open && results.length > 0) {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && open && results[active]) {
      // Choose the highlighted film rather than submitting the form.
      event.preventDefault();
      choose(results[active]);
    } else if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
      } else {
        onEscape?.();
      }
    }
  }

  return (
    <div className="relative">
      <input
        id={id}
        name="favoriteMovie"
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && results[active] ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={[describedBy, hintId].filter(Boolean).join(" ")}
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={title}
        onChange={(event) => {
          setTitle(event.target.value);
          setPicked(null);
          startSearch(event.target.value);
        }}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className={className}
      />
      {/* The picked film, if any. The server re-checks it with Wikipedia before saving. */}
      <input type="hidden" name="wikipediaId" value={picked?.wikipediaId ?? ""} />

      {open && (
        <div className="absolute inset-x-0 top-full z-20 mt-2 overflow-hidden rounded-xl bg-zinc-900/95 p-1 shadow-2xl ring-1 ring-white/10 backdrop-blur">
          {search.status === "error" ? (
            <p className="px-3 py-2 text-sm text-zinc-400">{search.message}</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-sm text-zinc-400">No films found. You can still use the title as typed.</p>
          ) : (
            <ul id={listId} role="listbox" aria-label="Matching films" className="max-h-96 overflow-y-auto">
              {results.map((film, index) => (
                <li
                  key={film.wikipediaId}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  // Keeps focus in the input, so choosing doesn't blur (and close) the list first.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(film)}
                  onMouseEnter={() => setActive(index)}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg p-2 ${index === active ? "bg-white/10" : ""}`}
                >
                  {film.posterUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={film.posterUrl} alt="" className="h-15 w-10 shrink-0 rounded bg-white/5 object-cover" />
                  ) : (
                    <div className="h-15 w-10 shrink-0 rounded bg-white/5" />
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-100">{film.title}</p>
                    <p className="truncate text-xs text-zinc-400 first-letter:uppercase">{film.description}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p id={hintId} className="mt-2 text-sm text-zinc-400 first-letter:uppercase">
        {picked
          ? `✓ ${picked.description}`
          : search.status === "loading"
            ? "Searching…"
            : "Pick a film from the list so we know exactly which one you mean."}
      </p>
    </div>
  );
}
