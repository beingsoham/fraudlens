import { ZodError } from 'zod';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { AppError, NotFoundError, PRISMA_ERROR } from '../utils/errors.js';
import { formatIssues } from './validate.js';

/** 404 handler for unmatched routes, so the body shape stays consistent. */
export function notFoundHandler(req, _res, next) {
  next(new NotFoundError(`Route ${req.method} ${req.originalUrl}`));
}

/**
 * Translates a Prisma error into a domain error.
 *
 * Prisma messages embed table names, column names and sometimes the offending
 * values, none of which belongs in an HTTP response, so nothing from the
 * original message is passed through — only a mapped status and a generic
 * description of the class of problem.
 */
function translatePrismaError(error) {
  switch (error.code) {
    case PRISMA_ERROR.UNIQUE_VIOLATION:
      return new AppError('A record with these details already exists', {
        status: 409,
        code: 'CONFLICT',
        // `meta.target` is a column list the API itself defined, so it is safe.
        details: { fields: error.meta?.target ?? undefined },
      });
    case PRISMA_ERROR.FOREIGN_KEY_VIOLATION:
      return new AppError('A referenced record does not exist', {
        status: 422,
        code: 'UNPROCESSABLE',
      });
    case PRISMA_ERROR.RECORD_NOT_FOUND:
      return new AppError('The requested record was not found', {
        status: 404,
        code: 'NOT_FOUND',
      });
    default:
      return null;
  }
}

/**
 * Detects the append-only triggers and CHECK constraints added by migration
 * `20261027060000_constraints_and_immutability`, which surface as raw
 * PostgreSQL errors rather than Prisma codes.
 */
function translateDatabaseConstraint(error) {
  const text = `${error?.message ?? ''}`;
  if (text.includes('is append-only')) {
    return new AppError('This record is append-only and cannot be modified or deleted', {
      status: 409,
      code: 'APPEND_ONLY',
    });
  }
  if (text.includes('transactions_amount_positive')) {
    return new AppError('Transaction amount must be greater than zero', {
      status: 400,
      code: 'VALIDATION_ERROR',
    });
  }
  if (text.includes('risk_assessments_score_range')) {
    return new AppError('Risk score must be between 0 and 100', {
      status: 400,
      code: 'VALIDATION_ERROR',
    });
  }
  if (text.includes('risk_settings_bounds')) {
    return new AppError('Risk thresholds are inconsistent', {
      status: 400,
      code: 'VALIDATION_ERROR',
    });
  }
  if (text.includes('alerts_resolution_consistent')) {
    return new AppError('Alert status and investigation outcome are inconsistent', {
      status: 409,
      code: 'CONFLICT',
    });
  }
  return null;
}

/**
 * Terminal error handler.
 *
 * Responses contain only `{ error: { code, message, details?, requestId } }`.
 * Stack traces, Prisma internals and raw SQL never cross this boundary; they
 * go to the structured log, correlated by request id.
 */
// Express identifies an error handler by its four-argument arity, so `_next`
// must stay in the signature even though it is never called.
export function errorHandler(error, req, res, _next) {
  let appError;

  if (error instanceof AppError) {
    appError = error;
  } else if (error instanceof ZodError) {
    appError = new AppError('The request payload is invalid', {
      status: 400,
      code: 'VALIDATION_ERROR',
      details: formatIssues(error),
    });
  } else if (error?.type === 'entity.too.large') {
    appError = new AppError('Request body is too large', {
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
    });
  } else if (error?.type === 'entity.parse.failed' || error instanceof SyntaxError) {
    appError = new AppError('Request body is not valid JSON', {
      status: 400,
      code: 'MALFORMED_JSON',
    });
  } else {
    appError =
      translatePrismaError(error ?? {}) ??
      translateDatabaseConstraint(error ?? {}) ??
      new AppError('An unexpected error occurred', { status: 500, code: 'INTERNAL_ERROR' });
  }

  const logPayload = {
    requestId: req.requestId,
    status: appError.status,
    code: appError.code,
    route: `${req.method} ${req.originalUrl}`,
    userId: req.user?.id,
    err: error,
  };
  if (appError.status >= 500) {
    logger.error(logPayload, 'Request failed');
  } else {
    logger.warn(logPayload, 'Request rejected');
  }

  const body = {
    error: {
      code: appError.code,
      message: appError.status >= 500 ? 'An unexpected error occurred' : appError.message,
      requestId: req.requestId,
    },
  };
  if (appError.details !== undefined && appError.status < 500) {
    body.error.details = appError.details;
  }
  // Only in a non-production process, and only for genuine 500s, is the
  // original message included — it speeds up local debugging without ever
  // being reachable in a deployed environment.
  if (!env.isProduction && appError.status >= 500 && error?.message) {
    body.error.debug = String(error.message).slice(0, 500);
  }

  res.status(appError.status).json(body);
}
