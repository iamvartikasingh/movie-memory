import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Pick your favorite movie" };

export default async function OnboardingPage() {
  const user = await requireUser();
  // Onboarding is first-time only.
  if (user.favoriteMovie) redirect("/dashboard");

  const firstName = user.name?.trim().split(/\s+/)[0];

  return (
    <main className="flex flex-1 items-center justify-center bg-spotlight px-6 py-16">
      <div className="w-full max-w-md">
        <p className="text-xs font-semibold tracking-[0.25em] text-amber-400 uppercase">Welcome</p>
        <h1 className="mt-4 font-display text-5xl leading-tight text-balance">
          {firstName ? `Hi ${firstName}, one quick question.` : "One quick question."}
        </h1>
        <p className="mt-3 text-lg text-zinc-400">What&apos;s your favorite movie?</p>
        <OnboardingForm />
      </div>
    </main>
  );
}
