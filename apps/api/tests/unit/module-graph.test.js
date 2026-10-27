import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);
const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repoRoot = path.resolve(apiRoot, '../..');

/**
 * Module-graph linking, checked under real Node.
 *
 * Vitest transforms ES modules into its own runner, which resolves imports more
 * permissively than Node's native loader. A re-export of a binding that does
 * not exist — `export { Missing } from './thing.js'` — links fine under Vitest
 * and throws a SyntaxError the moment Node loads it. The entire suite can
 * therefore pass against a build that cannot boot, which is exactly what
 * happened when the pure audit helpers were extracted into their own module and
 * the constant was left unexported.
 *
 * These tests spawn real `node` and import the entry points, so a broken link
 * fails here rather than at `npm start`. The child gets placeholder
 * configuration because importing the graph constructs the Prisma client but
 * never connects, so no database is required.
 */

const ENV = {
  ...process.env,
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://placeholder:placeholder@127.0.0.1:1/placeholder?schema=public',
  TEST_DATABASE_URL: 'postgresql://placeholder:placeholder@127.0.0.1:1/other?schema=public',
  JWT_SECRET: 'module-graph-check-secret-value-long-enough-to-validate',
  COOKIE_SECRET: 'module-graph-check-cookie-secret-long-enough-to-pass',
};

/** Imports a module in a fresh Node process and resolves with its exports. */
async function importUnderNode(specifier, cwd) {
  const script = `
    const m = await import(${JSON.stringify(specifier)});
    process.stdout.write(JSON.stringify(Object.keys(m).sort()));
  `;
  const { stdout } = await run(process.execPath, ['--input-type=module', '-e', script], {
    cwd,
    env: ENV,
    timeout: 30_000,
  });
  return JSON.parse(stdout);
}

describe('module graph links under Node', () => {
  it('loads the Express application and every route it reaches', async () => {
    const exports = await importUnderNode('./src/app.js', apiRoot);
    expect(exports).toContain('createApp');
    expect(exports).toContain('API_PREFIX');
  });

  it('loads the audit module, whose helpers were split across two files', async () => {
    const exports = await importUnderNode('./src/modules/audit/audit.service.js', apiRoot);
    // Both the re-exported binding and the locally defined one must resolve.
    expect(exports).toEqual(
      expect.arrayContaining(['ALLOWED_METADATA_KEYS', 'recordAudit', 'sanitizeMetadata']),
    );
  });

  it('loads the fraud module, whose defaults were split out of the services', async () => {
    const engine = await importUnderNode('./src/modules/fraud/features.js', apiRoot);
    expect(engine).toContain('emptyFeatures');

    const ruleset = await importUnderNode('./src/modules/fraud/ruleset.service.js', apiRoot);
    expect(ruleset).toContain('defaultRuleset');
    expect(ruleset).toContain('getActiveRuleset');
  });

  it('loads the realtime layer and the simulator', async () => {
    const socket = await importUnderNode('./src/realtime/socket.js', apiRoot);
    expect(socket).toContain('createSocketServer');

    const simulator = await importUnderNode(
      './src/modules/simulator/simulator.service.js',
      apiRoot,
    );
    expect(simulator).toContain('startSimulator');
  });

  it('links the seed script', async () => {
    // `seed.js` is a script: importing it runs it, and against a placeholder
    // database it will fail to connect. That failure is fine and expected —
    // what this checks is that the module graph *linked*, so the assertion is
    // on the kind of error rather than on the exit code.
    const result = await run(
      process.execPath,
      ['--input-type=module', '-e', "await import('./prisma/seed.js');"],
      {
        cwd: repoRoot,
        env: { ...ENV, SEED_DEMO_DATA: 'false' },
        timeout: 30_000,
      },
    ).catch((error) => error);

    const output = `${result.stderr ?? ''}${result.stdout ?? ''}`;
    expect(output).not.toMatch(/does not provide an export named/);
    expect(output).not.toMatch(/Cannot find (module|package)/);
    expect(output).not.toMatch(/SyntaxError/);
  });
});
