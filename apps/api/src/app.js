import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { requestContext } from './middleware/requestContext.js';
import { httpLogger } from './middleware/httpLogger.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { authenticate } from './middleware/authenticate.js';
import { csrfProtection } from './middleware/csrf.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { AuthorizationError } from './utils/errors.js';

import authRoutes from './modules/auth/auth.routes.js';
import dashboardRoutes from './modules/dashboard/dashboard.routes.js';
import transactionRoutes from './modules/transactions/transactions.routes.js';
import alertRoutes from './modules/alerts/alerts.routes.js';
import analyticsRoutes from './modules/analytics/analytics.routes.js';
import simulatorRoutes from './modules/simulator/simulator.routes.js';
import settingsRoutes from './modules/settings/settings.routes.js';
import userRoutes from './modules/users/users.routes.js';
import auditRoutes from './modules/audit/audit.routes.js';
import healthRoutes from './modules/health/health.routes.js';

export const API_PREFIX = '/api/v1';

/**
 * Builds the Express application.
 *
 * Exported as a factory so the integration tests can mount it with Supertest
 * without opening a port or starting the Socket.IO server.
 *
 * Middleware order is load-bearing:
 *  1. `requestContext` first, so every later log line and audit row has an id.
 *  2. Security headers and CORS before anything reads the body.
 *  3. Body parsing with an explicit size limit.
 *  4. Rate limiting before authentication, so an unauthenticated flood is
 *     rejected without a database lookup per request.
 *  5. `authenticate` then `csrfProtection` — CSRF needs to know whether the
 *     request was authenticated by cookie or by bearer token.
 *  6. Routes, then 404, then the terminal error handler.
 */
export function createApp() {
  const app = express();

  // Behind a reverse proxy, `req.ip` must come from X-Forwarded-For for rate
  // limiting and audit logging to record the real client. Enabled only in
  // production, where the proxy is known: trusting the header in development
  // would let any client spoof its address.
  if (env.isProduction) {
    app.set('trust proxy', 1);
  }
  app.disable('x-powered-by');

  app.use(requestContext);

  app.use(
    helmet({
      // The API serves JSON, not documents, so the CSP is maximally
      // restrictive: nothing should ever be loaded from an API response.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
      hsts: env.isProduction
        ? { maxAge: 31_536_000, includeSubDomains: true, preload: false }
        : false,
    }),
  );

  app.use(
    cors({
      // An explicit allow-list, never a reflected origin: reflecting would make
      // `credentials: true` equivalent to allowing every site to call the API
      // with the user's cookies.
      origin(origin, callback) {
        if (!origin) {
          // Same-origin and non-browser clients send no Origin header.
          callback(null, true);
          return;
        }
        if (env.allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new AuthorizationError(`Origin ${origin} is not allowed`));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'X-Row-Count', 'Content-Disposition'],
      maxAge: 600,
    }),
  );

  app.use(express.json({ limit: env.REQUEST_BODY_LIMIT }));
  app.use(express.urlencoded({ extended: false, limit: env.REQUEST_BODY_LIMIT }));
  app.use(cookieParser(env.COOKIE_SECRET));
  app.use(httpLogger);
  app.use(globalLimiter);

  // Health is mounted before the authentication wall: an orchestrator cannot
  // present credentials, and the endpoint decides its own detail level.
  app.use(`${API_PREFIX}/health`, healthRoutes);

  // Login and logout cannot require an existing session.
  app.use(`${API_PREFIX}/auth`, authRoutes);

  // Everything below here requires authentication, and every state-changing
  // cookie-authenticated request requires a matching CSRF token.
  const protectedRouter = express.Router();
  protectedRouter.use(authenticate);
  protectedRouter.use(csrfProtection);

  protectedRouter.use('/dashboard', dashboardRoutes);
  protectedRouter.use('/transactions', transactionRoutes);
  protectedRouter.use('/alerts', alertRoutes);
  protectedRouter.use('/analytics', analyticsRoutes);
  protectedRouter.use('/simulator', simulatorRoutes);
  protectedRouter.use('/settings', settingsRoutes);
  protectedRouter.use('/users', userRoutes);
  protectedRouter.use('/audit-logs', auditRoutes);

  app.use(API_PREFIX, protectedRouter);

  // A tiny unauthenticated descriptor, so hitting the bare prefix is not a 404.
  app.get(API_PREFIX, (_req, res) => {
    res.json({
      data: {
        name: 'FraudLens API',
        version: 'v1',
        documentation: 'See README.md for the full endpoint reference',
      },
    });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
