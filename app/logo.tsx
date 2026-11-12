import Link from "next/link";

/** The Movie Memory wordmark: the film-frame mark from the tab icon, then the name. */
export function Logo() {
  return (
    <Link href="/" className="inline-flex items-center gap-2.5 transition hover:opacity-80">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-7 text-amber-400"
      >
        <rect x="4" y="3" width="16" height="18" rx="2.5" />
        <path d="M8 3v18M16 3v18M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4" />
      </svg>
      <span className="font-display text-[1.75rem] leading-none tracking-tight">
        Movie <em className="text-amber-300">Memory</em>
      </span>
    </Link>
  );
}
