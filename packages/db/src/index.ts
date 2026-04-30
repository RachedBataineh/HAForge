import { env } from "@HAForge/env/server";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import * as schema from "./schema";

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export function createDb() {
  return drizzle(pool, { schema });
}

export const db = createDb();

// Re-export schema
export * from "./schema";
