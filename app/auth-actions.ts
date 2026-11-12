"use server";

import { signIn, signOut } from "@/auth";

// After Google redirects back, "/" sends the user to onboarding or the dashboard.
export async function signInWithGoogle() {
  await signIn("google", { redirectTo: "/" });
}

export async function signOutUser() {
  await signOut({ redirectTo: "/" });
}
