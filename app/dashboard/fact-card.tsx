"use client";

import { useEffect, useState } from "react";
import type { FactErrorResponse, FactResponse } from "@/app/api/fact/route";

type FactState =
  | { status: "loading" }
  // nextFactAt: when, by this browser's clock, a new fact can be generated.
  | { status: "ready"; data: FactResponse; nextFactAt: number }
  | { status: "error"; message: string };

async function fetchFact(): Promise<FactState> {
  try {
    const response = await fetch("/api/fact", { cache: "no-store" });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message = (body as FactErrorResponse | null)?.error ?? "Something went wrong.";
      return { status: "error", message };
    }
    const data = body as FactResponse;
    return { status: "ready", data, nextFactAt: Date.now() + data.nextFactInSeconds * 1000 };
  } catch {
    return { status: "error", message: "Couldn't reach the server. Check your connection and try again." };
  }
}

const SOURCE_NOTES: Record<FactResponse["source"], string> = {
  generated: "Freshly generated.",
  cache: "New facts are generated at most once a minute, so this is your latest one.",
  stale: "We couldn't generate a new fact right now, so here's your most recent one.",
  limited: "You've had a lot of new facts in the last few minutes, so here's your latest one.",
};

// "42s", or "4m 12s" for the longer wait after the generation limit.
const formatWait = (seconds: number) => (seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`);

export function FactCard() {
  const [state, setState] = useState<FactState>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  // The clock the countdown reads. Updated with each fact, then every second while counting.
  const [now, setNow] = useState(0);

  useEffect(() => {
    let active = true;
    fetchFact().then((next) => {
      if (!active) return;
      setState(next);
      setNow(Date.now());
    });
    return () => {
      active = false;
    };
  }, []);

  const nextFactAt = state.status === "ready" ? state.nextFactAt : 0;
  useEffect(() => {
    if (nextFactAt <= Date.now()) return;
    const timer = setInterval(() => {
      const time = Date.now();
      setNow(time);
      if (time >= nextFactAt) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [nextFactAt]);

  async function refresh() {
    setRefreshing(true);
    const next = await fetchFact();
    setState(next);
    setNow(Date.now());
    setRefreshing(false);
  }

  // Until the cache window ends the server would return the same fact, so the
  // button counts down instead of looking like it does nothing.
  const secondsLeft = Math.max(0, Math.ceil((nextFactAt - now) / 1000));
  const waiting = state.status === "ready" && secondsLeft > 0;

  return (
    <section className="max-w-3xl">
      <h2 className="text-xs font-semibold tracking-[0.25em] text-amber-400 uppercase">Fun fact</h2>

      {/* Only the fact is announced to screen readers; the countdown would be noise. */}
      <div aria-live="polite">
        {state.status === "loading" && (
          <div className="mt-6 space-y-3" aria-label="Loading fact">
            <div className="h-8 w-full animate-pulse rounded-lg bg-white/10" />
            <div className="h-8 w-3/4 animate-pulse rounded-lg bg-white/10" />
          </div>
        )}

        {state.status === "error" && (
          <p role="alert" className="mt-6 text-lg text-red-300">
            {state.message}
          </p>
        )}

        {state.status === "ready" && (
          // Keyed by fact, so a new one fades in and the change is visible.
          <blockquote key={state.data.fact.createdAt} className="relative mt-10 motion-safe:animate-fade-in">
            <span aria-hidden="true" className="absolute -top-9 -left-1 font-display text-8xl leading-none text-amber-400/40 select-none">
              &ldquo;
            </span>
            <p className="relative font-display text-2xl leading-snug sm:text-3xl">{state.data.fact.content}</p>
          </blockquote>
        )}
      </div>

      {state.status !== "loading" && (
        <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing || waiting}
            className="rounded-full bg-amber-500 px-5 py-2.5 text-sm font-semibold text-zinc-950 tabular-nums transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {refreshing
              ? "Fetching…"
              : state.status === "error"
                ? "Try again"
                : waiting
                  ? `New fact in ${formatWait(secondsLeft)}`
                  : "Get another fact"}
          </button>
          {state.status === "ready" && <p className="text-sm text-zinc-400">{SOURCE_NOTES[state.data.source]}</p>}
        </div>
      )}
    </section>
  );
}
