/**
 * Vitest setup.
 *
 * Forces NODE_ENV=test before anything imports the config module, so the API
 * picks up TEST_DATABASE_URL rather than the development database. Without
 * this, running the suite would destroy local development data.
 */
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
