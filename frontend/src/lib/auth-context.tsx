"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { apiFetch, setUnauthorizedHandler } from "./api";
import { getServerSessionSnapshot, getSessionSnapshot, setSession, subscribeSession, tokenExpiry, type Session } from "./session";
import type { User } from "./types";

type AuthState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "authenticated"; session: Session };

interface AuthContextValue {
  state: AuthState;
  user: User | null;
  token: string | null;
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // undefined = not known yet (server render), null = logged out
  const session = useSyncExternalStore(subscribeSession, getSessionSnapshot, getServerSessionSnapshot);

  const logout = useCallback(() => setSession(null), []);

  // Any 401 from the API (expired or revoked token) logs the user out.
  useEffect(() => {
    setUnauthorizedHandler(logout);
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  // Log out exactly when the token expires, even if the user is idle.
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(logout, Math.max(0, session.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [session, logout]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await apiFetch<{ accessToken: string; user: User }>("/auth/login", {
      method: "POST",
      body: { email, password },
    });
    setSession({
      token: result.accessToken,
      user: result.user,
      expiresAt: tokenExpiry(result.accessToken) ?? Date.now() + 60 * 60 * 1000,
    });
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const state: AuthState =
      session === undefined ? { status: "loading" } : session ? { status: "authenticated", session } : { status: "anonymous" };
    return {
      state,
      user: session?.user ?? null,
      token: session?.token ?? null,
      isAdmin: session?.user.role === "admin",
      login,
      logout,
    };
  }, [session, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}
