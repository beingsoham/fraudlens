import { randomUUID } from 'node:crypto';

/**
 * Assigns every request a correlation id.
 *
 * The id is echoed in the `X-Request-Id` response header, attached to log
 * records, and persisted on audit events, which is what lets an auditor tie a
 * stored audit row back to the exact request that produced it.
 *
 * An inbound `X-Request-Id` is honoured only when it is a plausible id, so a
 * caller cannot inject arbitrary text into logs and audit rows.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function requestContext(req, res, next) {
  const inbound = req.get('x-request-id');
  req.requestId = inbound && SAFE_REQUEST_ID.test(inbound) ? inbound : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  req.startedAt = process.hrtime.bigint();
  next();
}
