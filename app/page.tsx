import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSessionUserId, homePathFor } from "@/lib/session";
import { signInWithGoogle } from "./auth-actions";
import { Logo } from "./logo";

// After a sign-in that didn't complete: cancelled on Google's screen, or any Auth.js error.
function signInErrorMessage(error: string | string[] | undefined) {
  if (!error) return null;
  return error === "cancelled"
    ? "Sign-in was cancelled. You can try again whenever you're ready."
    : "Sign-in didn't work. Please try again.";
}

export default async function Home({ searchParams }: PageProps<"/">) {
  // Signed-in users never see the landing page. This is also where Google
  // sign-in lands, so it's the single place that routes first-time users to
  // onboarding and returning users to the dashboard.
  const userId = await getSessionUserId();
  if (userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { favoriteMovie: true },
    });
    if (user) redirect(homePathFor(user));
  }

  const errorMessage = signInErrorMessage((await searchParams).error);

  return (
    <main className="flex flex-1 items-center justify-center bg-spotlight px-6 py-16">
      <div className="w-full max-w-xl text-center">
        <Logo />
        <h1 className="mt-8 font-display text-5xl leading-[1.05] text-balance sm:text-7xl">
          Your favorite movie, <em className="text-amber-300">one fun fact at a time.</em>
        </h1>
        <p className="mx-auto mt-6 max-w-md text-lg text-zinc-400">
          Tell us the movie you love and we&apos;ll dig up something you didn&apos;t know about it.
        </p>
        {errorMessage && (
          <p role="alert" className="mx-auto mt-8 max-w-md rounded-xl bg-white/5 px-4 py-3 text-sm text-zinc-300 ring-1 ring-white/10">
            {errorMessage}
          </p>
        )}
        <form action={signInWithGoogle} className={errorMessage ? "mt-6" : "mt-10"}>
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-3 rounded-full bg-white px-6 py-3 font-medium text-zinc-900 shadow-lg shadow-amber-500/10 transition hover:bg-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
          >
            <GoogleLogo />
            Sign in with Google
          </button>
        </form>
      </div>
    </main>
  );
}

function GoogleLogo() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="size-5">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
