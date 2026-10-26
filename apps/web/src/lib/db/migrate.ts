import { closeDatabase, getDb } from "./client";

try {
  await getDb();
  console.log("[db] Postgres migrations applied.");
} finally {
  await closeDatabase();
}
