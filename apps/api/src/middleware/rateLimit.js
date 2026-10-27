import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { env } from '../config/env.js';

/**
 * Builds a rate limiter that responds with the application's standard error
 * envelope rather than express-rate-limit's default plain-text body.
 */
function buildLimiter({ windowMs, max, message, keyGenerator }) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator,
    // Never rate-limit the test suite: it issues bursts far above any
    // realistic client, and limiting would make tests order-dependent.
    skip: () => env.isTest,
    handler: (_req, res) => {
      res.status(429).json({
        error: { code: 'RATE_LIMITED', message },
      });
    },
  });
}

/** Baseline limiter applied to the whole API surface. */
export const globalLimiter = buildLimiter({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  message: 'Too many requests. Please slow down.',
});

/**
 * Tighter limiter for authentication, keyed by IP *and* submitted email so
 * that password guessing against one account cannot be spread across many
 * source addresses without also hitting the per-account limit.
 */
export const authLimiter = buildLimiter({
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  max: env.AUTH_RATE_LIMIT_MAX,
  message: 'Too many sign-in attempts. Please try again later.',
  keyGenerator: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : 'unknown';
    return `${ipKeyGenerator(req.ip)}:${email}`;
  },
});

/**
 * Higher ceiling for transaction ingestion, which is a machine-to-machine
 * endpoint and legitimately bursty.
 */
export const ingestLimiter = buildLimiter({
  windowMs: env.INGEST_RATE_LIMIT_WINDOW_MS,
  max: env.INGEST_RATE_LIMIT_MAX,
  message: 'Ingestion rate limit exceeded.',
});

/** Export endpoints are expensive; keep them to a handful per minute per user. */
export const exportLimiter = buildLimiter({
  windowMs: 60_000,
  max: 10,
  message: 'Too many export requests. Please wait a moment.',
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip),
});
