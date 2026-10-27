import pinoHttp from 'pino-http';
import { logger } from '../config/logger.js';

/**
 * Structured access logging.
 *
 * Health checks are logged at `debug` so a container orchestrator polling
 * `/health` every few seconds does not drown out the real traffic, and 4xx/5xx
 * responses are raised to `warn`/`error`.
 */
export const httpLogger = pinoHttp({
  logger,
  genReqId: (req) => req.requestId,
  customLogLevel(req, res, err) {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    if (req.url?.startsWith('/api/v1/health')) return 'debug';
    return 'info';
  },
  customSuccessMessage(req, res) {
    return `${req.method} ${req.url} -> ${res.statusCode}`;
  },
  serializers: {
    req(req) {
      return {
        id: req.id,
        method: req.method,
        url: req.url,
        // Deliberately no headers or body: see the logger's redaction list.
        remoteAddress: req.remoteAddress,
      };
    },
    res(res) {
      return { statusCode: res.statusCode };
    },
  },
});
