"use client";

import Image from "next/image";
import { useState } from "react";

/** Google profile photo, falling back to an initial if it's missing or fails to load. */
export function Avatar({ src, name }: { src: string | null; name: string }) {
  const [failed, setFailed] = useState(false);

  if (src && !failed) {
    return (
      <Image
        src={src}
        alt=""
        width={36}
        height={36}
        className="size-9 shrink-0 rounded-full"
        onError={() => setFailed(true)}
      />
    );
  }

  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? "?";
  return (
    <div
      aria-hidden="true"
      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-sm font-semibold text-amber-200"
    >
      {initial}
    </div>
  );
}
