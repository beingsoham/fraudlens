import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI configuration.
 *
 * `datasource.url` is read straight from the environment rather than through
 * Prisma's `env()` helper, which throws when the variable is absent. That
 * matters because `prisma generate` needs no database at all — it only reads
 * the schema — and it runs during the Docker image build, where no connection
 * string exists or should. The commands that genuinely need a URL
 * (`migrate deploy`, `migrate dev`) are always run with one set, and fail with
 * their own clear message if it is missing.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node prisma/seed.js',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
