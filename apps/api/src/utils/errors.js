/**
 * Application error hierarchy.
 *
 * Every error reaching the client passes through these classes, which carry an
 * HTTP status, a stable machine-readable `code`, and an optional `details`
 * payload. The error handler never serialises anything else, so an unexpected
 * exception can never leak a stack trace or a database message to a caller.
 */

export class AppError extends Error {
  /**
   * @param {string} message Safe, human-readable message for the client.
   * @param {object} options
   * @param {number} options.status HTTP status code.
   * @param {string} options.code Stable error code, e.g. `VALIDATION_ERROR`.
   * @param {unknown} [options.details] Safe structured details.
   * @param {Error}  [options.cause] Underlying error, logged but never sent.
   */
  constructor(message, { status = 500, code = 'INTERNAL_ERROR', details, cause } = {}) {
    super(message, { cause });
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.details = details;
    /** Marks errors that are safe to show the client verbatim. */
    this.expose = status < 500;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'The request payload is invalid', details) {
    super(message, { status: 400, code: 'VALIDATION_ERROR', details });
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Authentication is required') {
    super(message, { status: 401, code: 'UNAUTHENTICATED' });
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'You do not have permission to perform this action', details) {
    super(message, { status: 403, code: 'FORBIDDEN', details });
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} was not found`, { status: 404, code: 'NOT_FOUND' });
  }
}

export class ConflictError extends AppError {
  constructor(message = 'The request conflicts with the current state', details) {
    super(message, { status: 409, code: 'CONFLICT', details });
  }
}

/**
 * A duplicate ingestion attempt. Distinct from a generic conflict so clients
 * can treat it as a successful no-op rather than a failure, and so the
 * response can carry the already-persisted transaction.
 */
export class DuplicateIngestionError extends AppError {
  constructor(message = 'This transaction has already been ingested', details) {
    super(message, { status: 409, code: 'DUPLICATE_TRANSACTION', details });
  }
}

export class UnprocessableError extends AppError {
  constructor(message = 'The request could not be processed', details) {
    super(message, { status: 422, code: 'UNPROCESSABLE', details });
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests. Please slow down.') {
    super(message, { status: 429, code: 'RATE_LIMITED' });
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'A dependency is unavailable', details) {
    super(message, { status: 503, code: 'SERVICE_UNAVAILABLE', details });
  }
}

/** Prisma error codes this application translates into domain errors. */
export const PRISMA_ERROR = {
  UNIQUE_VIOLATION: 'P2002',
  FOREIGN_KEY_VIOLATION: 'P2003',
  RECORD_NOT_FOUND: 'P2025',
  CHECK_CONSTRAINT: 'P2010',
};

/** True when the error looks like a Prisma known-request error with `code`. */
export function isPrismaError(error, code) {
  return Boolean(error && typeof error === 'object' && error.code === code);
}
