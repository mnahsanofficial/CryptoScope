"use client";

import { useEffect, useRef, useState } from "react";

/**
 * `value`, updated at most once every `ms` (the latest value always arrives in the end).
 * Unlike a debounce, a steady stream of changes (a long batch of scans finishing one by one) still
 * produces an update every `ms`, instead of none until the stream stops.
 */
export function useThrottled<T>(value: T, ms: number): T {
  const [throttled, setThrottled] = useState(value);
  const lastUpdate = useRef(0);

  useEffect(() => {
    const wait = Math.max(0, lastUpdate.current + ms - Date.now());
    const timer = setTimeout(() => {
      lastUpdate.current = Date.now();
      setThrottled(value);
    }, wait);
    return () => clearTimeout(timer);
  }, [value, ms]);

  return throttled;
}
