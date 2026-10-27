import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * Test setup for the web app.
 *
 * jsdom lacks a few browser APIs the components rely on, so they are stubbed
 * here rather than guarded for in application code: a component should not
 * carry branches that exist only to satisfy a test environment.
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Recharts measures its container; jsdom reports every element as 0x0, which
// makes charts render nothing. A fixed size lets them lay out.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
  configurable: true,
  value: 800,
});
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  value: 400,
});

globalThis.matchMedia =
  globalThis.matchMedia ||
  ((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  }));

// jsdom implements neither, and the CSV download path uses both.
globalThis.URL.createObjectURL = globalThis.URL.createObjectURL ?? (() => 'blob:mock');
globalThis.URL.revokeObjectURL = globalThis.URL.revokeObjectURL ?? (() => {});
