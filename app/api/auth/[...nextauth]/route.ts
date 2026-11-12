import type { NextRequest } from "next/server";
import { handlers } from "@/auth";

export const { POST } = handlers;

/**
 * Cancelling on Google's consent screen redirects back here with
 * `?error=access_denied`. Auth.js rejects that response (Google leaves out the
 * `iss` parameter on errors) and would show its generic "server configuration"
 * page, so errors the provider reports go straight back to the landing page.
 */
export function GET(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  const error = searchParams.get("error");
  if (error && pathname.startsWith("/api/auth/callback/")) {
    const landing = new URL("/", request.url);
    landing.searchParams.set("error", error === "access_denied" ? "cancelled" : "failed");
    return Response.redirect(landing, 303);
  }
  return handlers.GET(request);
}
