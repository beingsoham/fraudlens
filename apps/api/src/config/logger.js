import pino from 'pino';
import { env } from './env.js';

/**
 * Keys that are stripped from every log record, at any depth.
 *
 * Secrets must never reach the log stream, so redaction happens in the logger
 * itself rather than at each call site where it could be forgotten.
 */
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  'password',
  'newPassword',
  'currentPassword',
  'passwordHash',
  'token',
  'accessToken',
  'jwt',
  'secret',
  '*.password',
  '*.passwordHash',
  '*.token',
  'body.password',
  'body.newPassword',
  'body.currentPassword',
];

export const logger = pino({
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
  base: { service: 'fraudlens-api', env: env.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
  // Pretty output is intentionally not enabled: structured JSON is what a log
  // pipeline needs, and `npm run dev | npx pino-pretty` covers local reading.
});

/** Returns a child logger tagged with a module name. */
export function moduleLogger(name) {
  return logger.child({ module: name });
}

export { REDACTED_PATHS };
