"use client";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex flex-1 items-center justify-center bg-spotlight px-6">
      <div className="max-w-sm text-center">
        <h1 className="font-display text-4xl">Something went wrong.</h1>
        <p className="mt-3 text-zinc-400">Please try again in a moment.</p>
        <button
          type="button"
          onClick={reset}
          className="mt-8 rounded-full bg-amber-500 px-5 py-2.5 font-semibold text-zinc-950 transition hover:bg-amber-400"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
