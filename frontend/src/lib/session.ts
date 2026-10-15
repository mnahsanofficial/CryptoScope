import { setAccessToken } from "./api";
import type { User } from "./types";

/**
 * Where the access token lives in the browser.
 *
 * Choice: memory + sessionStorage (cleared when the tab closes), sent as an Authorization header.
 *  - Not vulnerable to CSRF (browsers never attach it automatically, unlike cookies).
 *  - But readable by JavaScript, so an XSS bug could steal it. Mitigations: short token lifetime,
 *    a strict Content-Security-Policy (next.config.ts) and React's escaping of all rendered text.
 *  - The more secure production design is a "backend for frontend" that keeps the token in an
 *    httpOnly cookie that JavaScript can't read at all (see docs/dashboard.md).
 */
export interface Session {
  token: string;
  user: User;
  /** Epoch milliseconds, read from the JWT's exp claim. */
  expiresAt: number;
}

const STORAGE_KEY = "cryptoscope.session";

/** Reads the exp claim. Decoding is NOT verifying: the server verifies the signature on every request. */
export function tokenExpiry(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const exp = (JSON.parse(json) as { exp?: number }).exp;
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

export function loadSession(now: number = Date.now()): Session | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as Session;
    if (!session.token || session.expiresAt <= now) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return session;
  } catch {
    return null; // storage blocked (private mode) or corrupted
  }
}

/*
 * A tiny external store, read by React with useSyncExternalStore. On the server (prerendering) there
 * is no sessionStorage, so the server snapshot is `undefined` = "still loading"; React then reads the
 * real value in the browser without a hydration mismatch.
 */
let current: Session | null | undefined;
const listeners = new Set<() => void>();

export function getSessionSnapshot(): Session | null {
  if (current === undefined) {
    current = loadSession();
    setAccessToken(current?.token ?? null);
  }
  return current;
}

export const getServerSessionSnapshot = (): undefined => undefined;

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Saves (or clears, with null) the session and notifies React. */
export function setSession(session: Session | null): void {
  current = session;
  setAccessToken(session?.token ?? null);
  try {
    if (session) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable: the session still works in memory until the tab is reloaded.
  }
  listeners.forEach((listener) => listener());
}
