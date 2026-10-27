import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

// Load the repository-root .env unless the process already has the variables
// injected (Docker Compose, CI). Existing process.env values always win.
dotenv.config({ path: path.join(repoRoot, '.env'), quiet: true });

const booleanish = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((value) => value === true || value === 'true' || value === '1');

const PLACEHOLDER_SECRETS = [
  'replace-me-with-a-long-random-development-secret-value',
  'replace-me-with-a-second-long-random-development-secret',
  'change-me',
];

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    DATABASE_URL: z
      .string()
      .min(1, 'DATABASE_URL is required')
      .refine((value) => value.startsWith('postgres://') || value.startsWith('postgresql://'), {
        message: 'DATABASE_URL must be a PostgreSQL connection string',
      }),
    TEST_DATABASE_URL: z.string().optional(),

    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    JWT_EXPIRES_IN: z
      .string()
      .regex(/^\d+[smhd]$/, 'JWT_EXPIRES_IN must look like 30m or 12h')
      .default('12h'),
    COOKIE_SECRET: z.string().min(32, 'COOKIE_SECRET must be at least 32 characters'),
    AUTH_COOKIE_NAME: z.string().min(1).default('fraudlens_session'),

    WEB_ORIGIN: z.string().min(1).default('http://localhost:5173'),

    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
    AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900_000),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
    INGEST_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    INGEST_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(1200),
    REQUEST_BODY_LIMIT: z.string().default('256kb'),

    SEED_DEMO_DATA: booleanish.default(true),
    SEED_ACCOUNT_COUNT: z.coerce.number().int().min(2).max(5000).default(40),
    SEED_TRANSACTION_COUNT: z.coerce.number().int().min(0).max(200_000).default(900),
    SEED_RANDOM_SEED: z.coerce.number().int().nonnegative().default(20260101),
    SEED_ADMIN_EMAIL: z.string().default('admin@fraudlens.local'),
    SEED_ADMIN_PASSWORD: z.string().default('ChangeMe!Admin123'),
    SEED_ANALYST_EMAIL: z.string().default('analyst@fraudlens.local'),
    SEED_ANALYST_PASSWORD: z.string().default('ChangeMe!Analyst123'),
    SEED_INVESTIGATOR_EMAIL: z.string().default('investigator@fraudlens.local'),
    SEED_INVESTIGATOR_PASSWORD: z.string().default('ChangeMe!Investigator123'),
    SEED_VIEWER_EMAIL: z.string().default('viewer@fraudlens.local'),
    SEED_VIEWER_PASSWORD: z.string().default('ChangeMe!Viewer123'),

    SIMULATOR_DEFAULT_RATE: z.coerce.number().min(0.1).max(100).default(2),
    SIMULATOR_MAX_RATE: z.coerce.number().min(0.1).max(200).default(25),
    SIMULATOR_DEFAULT_SEED: z.coerce.number().int().nonnegative().default(424242),
    SIMULATOR_AUTOSTART: booleanish.default(false),

    RISK_MEDIUM_THRESHOLD: z.coerce.number().int().min(1).max(100).default(30),
    RISK_HIGH_THRESHOLD: z.coerce.number().int().min(2).max(100).default(70),
    ALERT_THRESHOLD: z.coerce.number().int().min(1).max(100).default(70),
    RULESET_VERSION: z.string().min(1).max(32).default('2026.10.1'),
  })
  .superRefine((value, ctx) => {
    if (value.RISK_MEDIUM_THRESHOLD >= value.RISK_HIGH_THRESHOLD) {
      ctx.addIssue({
        code: 'custom',
        path: ['RISK_MEDIUM_THRESHOLD'],
        message: 'RISK_MEDIUM_THRESHOLD must be below RISK_HIGH_THRESHOLD',
      });
    }
    if (value.ALERT_THRESHOLD < value.RISK_MEDIUM_THRESHOLD) {
      ctx.addIssue({
        code: 'custom',
        path: ['ALERT_THRESHOLD'],
        message: 'ALERT_THRESHOLD must be at or above RISK_MEDIUM_THRESHOLD',
      });
    }
    if (value.SIMULATOR_DEFAULT_RATE > value.SIMULATOR_MAX_RATE) {
      ctx.addIssue({
        code: 'custom',
        path: ['SIMULATOR_DEFAULT_RATE'],
        message: 'SIMULATOR_DEFAULT_RATE must not exceed SIMULATOR_MAX_RATE',
      });
    }
    // Refuse to boot a production process with the example secrets in place.
    if (value.NODE_ENV === 'production') {
      for (const key of ['JWT_SECRET', 'COOKIE_SECRET']) {
        if (PLACEHOLDER_SECRETS.some((placeholder) => value[key].includes(placeholder))) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} still holds the .env.example placeholder; generate a real secret`,
          });
        }
      }
      if (value.JWT_SECRET === value.COOKIE_SECRET) {
        ctx.addIssue({
          code: 'custom',
          path: ['COOKIE_SECRET'],
          message: 'COOKIE_SECRET must differ from JWT_SECRET',
        });
      }
    }
  });

/**
 * Parses and validates process.env, exiting with a readable report when the
 * configuration is incomplete. Called once at module load so a misconfigured
 * process fails immediately rather than at the first request.
 */
function loadEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    // Written to stderr directly: the logger itself depends on this config.
    process.stderr.write(
      `\nFraudLens cannot start: invalid environment configuration.\n${issues}\n\n` +
        'Copy .env.example to .env and fill in the required values.\n\n',
    );
    throw new Error('Invalid environment configuration');
  }
  return result.data;
}

const raw = loadEnv();

/** Comma-separated origin list, normalised into an array. */
const allowedOrigins = raw.WEB_ORIGIN.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export const env = Object.freeze({
  ...raw,
  allowedOrigins,
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  isDevelopment: raw.NODE_ENV === 'development',
  /**
   * In test runs the integration suite points at its own database. Using the
   * dev database for tests would destroy local data, so the suite refuses to
   * run without TEST_DATABASE_URL set to something different.
   */
  activeDatabaseUrl:
    raw.NODE_ENV === 'test' && raw.TEST_DATABASE_URL ? raw.TEST_DATABASE_URL : raw.DATABASE_URL,
});

/** Safe subset of configuration, suitable for the health endpoint. */
export function publicConfigSummary() {
  return {
    nodeEnv: env.NODE_ENV,
    rulesetVersion: env.RULESET_VERSION,
    simulatorMaxRate: env.SIMULATOR_MAX_RATE,
  };
}

export { envSchema };
