import { ValidationError } from '../utils/errors.js';

/**
 * Formats a Zod error into a flat, safe details array.
 *
 * Only the field path and the message are included — never the submitted
 * value, which could be a password.
 */
function formatIssues(error) {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join('.') : '(root)',
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * Builds middleware that validates one part of the request against a Zod
 * schema and *replaces* it with the parsed result.
 *
 * Replacing rather than merging matters: downstream handlers then only ever see
 * coerced, defaulted, allow-listed data, so an unexpected extra field cannot
 * reach a Prisma call. Schemas use `.strict()` where extra keys should be a
 * hard error rather than silently dropped.
 */
function validatePart(part, schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req[part] ?? {});
    if (!result.success) {
      next(new ValidationError(`Invalid request ${part}`, formatIssues(result.error)));
      return;
    }
    // Express 5 exposes `req.query` as a getter, so assign via defineProperty.
    if (part === 'query') {
      Object.defineProperty(req, 'validatedQuery', { value: result.data, configurable: true });
    } else {
      req[part] = result.data;
    }
    next();
  };
}

export const validateBody = (schema) => validatePart('body', schema);
export const validateQuery = (schema) => validatePart('query', schema);
export const validateParams = (schema) => validatePart('params', schema);

/** Reads the validated query, falling back to the raw query when unvalidated. */
export function query(req) {
  return req.validatedQuery ?? req.query;
}

export { formatIssues };
