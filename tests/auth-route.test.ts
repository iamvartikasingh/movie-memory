import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The real Auth.js handlers need Google credentials; only the routing in
// front of them is under test.
vi.mock("@/auth", () => ({ handlers: { GET: vi.fn(async () => new Response("auth.js")), POST: vi.fn() } }));

import { GET } from "@/app/api/auth/[...nextauth]/route";
import { handlers } from "@/auth";

const get = (path: string) => GET(new NextRequest(`http://localhost:3000${path}`));

beforeEach(() => {
  vi.mocked(handlers.GET).mockClear();
});

describe("GET /api/auth/*", () => {
  it("sends a sign-in cancelled on Google back to the landing page", async () => {
    const response = await get("/api/auth/callback/google?error=access_denied&state=abc");

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:3000/?error=cancelled");
    expect(handlers.GET).not.toHaveBeenCalled();
  });

  it("reports any other provider error as a failed sign-in", async () => {
    const response = await get("/api/auth/callback/google?error=server_error");

    expect(response.headers.get("location")).toBe("http://localhost:3000/?error=failed");
  });

  it("passes successful callbacks and other auth routes to Auth.js", async () => {
    await get("/api/auth/callback/google?code=xyz&state=abc");
    await get("/api/auth/session");

    expect(handlers.GET).toHaveBeenCalledTimes(2);
  });
});
