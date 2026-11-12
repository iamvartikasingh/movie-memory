import { execSync } from "node:child_process";
import { TEST_DATABASE_URL } from "./db-url";

export default function setup() {
  // Tests wipe tables between cases, so never point them at a real database.
  const database = new URL(TEST_DATABASE_URL).pathname.slice(1);
  if (!database.endsWith("_test")) {
    throw new Error(`Refusing to run tests against "${database}": the database name must end in _test`);
  }

  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "inherit",
  });
}
