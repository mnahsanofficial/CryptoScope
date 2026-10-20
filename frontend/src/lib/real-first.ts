import type { Paginated } from "./types";

interface Loaded<T> {
  data: Paginated<T> | null;
  error: string | null;
}

/**
 * One table from two lists: every real row first, then seeded demo rows to fill it up to `size`.
 * Still loading (data null) until both lists are in, so rows never jump around as the second one arrives.
 */
export function realFirst<T>(real: Loaded<T>, demo: Loaded<T>, size = 8): { data: T[] | null; error: string | null } {
  const error = real.error ?? demo.error;
  if (!real.data || !demo.data) return { data: null, error };
  return { data: [...real.data.data, ...demo.data.data].slice(0, size), error };
}
