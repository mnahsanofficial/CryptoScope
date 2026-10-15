"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./api";

export interface ApiState<T> {
  /** The latest successful response. Kept while a new request loads, so tables don't flash empty. */
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Fetch again (e.g. after a scan finished). */
  reload: () => void;
}

interface Result<T> {
  key: string | null;
  data: T | null;
  error: string | null;
}

/**
 * GET `path` and keep the result in state. Pass null to skip.
 * A new path cancels the previous request, so a slow old response can't overwrite a newer one.
 * "loading" is derived (current request key != key of the last finished request) instead of being
 * set inside the effect, which avoids an extra render per request.
 */
export function useApi<T>(path: string | null): ApiState<T> {
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState<Result<T>>({ key: null, data: null, error: null });
  const key = path === null ? null : `${version}:${path}`;

  useEffect(() => {
    if (path === null || key === null) return;
    const controller = new AbortController();

    apiFetch<T>(path, { signal: controller.signal })
      .then((data) => setResult({ key, data, error: null }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : "Unknown error";
        setResult((previous) => ({ key, data: previous.data, error: message }));
      });

    return () => controller.abort();
  }, [path, key]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data: result.data, error: result.error, loading: key !== null && result.key !== key, reload };
}
