import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../services/api.js';

/**
 * Data fetching for a single endpoint.
 *
 * Deliberately small — this application has no need for a cache layer, and the
 * two things that actually matter are handled: the request is aborted when the
 * component unmounts or the inputs change, and a response that arrives after a
 * newer request was issued is discarded. Without the second guard, typing in a
 * search box reliably leaves stale results on screen when an earlier request
 * resolves last.
 *
 * @param {(options: {signal: AbortSignal}) => Promise<{data: unknown, meta?: unknown}>} fetcher
 * @param {unknown[]} deps Re-fetch when any of these change.
 * @param {object} [options]
 * @param {boolean} [options.enabled] Skip fetching when false.
 * @param {unknown} [options.initialData]
 */
export function useApi(fetcher, deps = [], { enabled = true, initialData = null } = {}) {
  const [data, setData] = useState(initialData);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(enabled);
  /** Monotonic request id; only the newest request may commit its result. */
  const requestIdRef = useRef(0);
  const fetcherRef = useRef(fetcher);

  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const execute = useCallback(async (signal) => {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    try {
      const result = await fetcherRef.current({ signal });
      if (requestId !== requestIdRef.current) return;
      setData(result?.data ?? null);
      setMeta(result?.meta ?? null);
      setError(null);
    } catch (caught) {
      if (caught?.name === 'AbortError' || requestId !== requestIdRef.current) return;
      setError(caught instanceof ApiError ? caught : new ApiError(caught.message));
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    void execute(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller-supplied deps
  }, [enabled, execute, ...deps]);

  const refetch = useCallback(() => execute(undefined), [execute]);

  return { data, meta, error, isLoading, refetch, setData };
}

/**
 * Wraps a mutating call with pending/error state.
 *
 * Returns the result so callers can `await` it and act on the response, and
 * rethrows so a form can surface field-level validation errors.
 */
export function useMutation(mutator) {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState(null);
  const mutatorRef = useRef(mutator);

  useEffect(() => {
    mutatorRef.current = mutator;
  });

  const mutate = useCallback(async (...args) => {
    setIsPending(true);
    setError(null);
    try {
      return await mutatorRef.current(...args);
    } catch (caught) {
      const apiError = caught instanceof ApiError ? caught : new ApiError(caught.message);
      setError(apiError);
      throw apiError;
    } finally {
      setIsPending(false);
    }
  }, []);

  return { mutate, isPending, error, reset: () => setError(null) };
}

/** Debounces a value, for search inputs that would otherwise fetch per keypress. */
export function useDebounced(value, delayMs = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
