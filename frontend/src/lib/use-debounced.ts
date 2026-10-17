"use client";

import { useEffect, useState } from "react";

/** Waits until the value stops changing for `ms` before returning it (avoids one request per keystroke). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}
