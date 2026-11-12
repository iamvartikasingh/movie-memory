import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  // Reads AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET from the environment.
  providers: [Google],
  // Sessions live in Postgres; the cookie only holds an opaque token, so a
  // session can be revoked by deleting its row.
  session: { strategy: "database" },
  // Any sign-in error lands on the landing page (with ?error=…), which shows a
  // friendly message instead of Auth.js's built-in error page. Details stay in
  // the server log.
  pages: { signIn: "/", error: "/" },
  callbacks: {
    // The adapter hands us the full User row. Expose an explicit allowlist so
    // nothing else (e.g. favoriteMovie, emailVerified) leaks via /api/auth/session.
    session({ session, user }) {
      return {
        expires: session.expires,
        user: { id: user.id, name: user.name, email: user.email, image: user.image },
      };
    },
  },
});
