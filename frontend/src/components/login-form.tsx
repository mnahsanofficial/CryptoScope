"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth-context";
import { Button, ErrorNote } from "./ui/primitives";

export function LoginForm() {
  const { state, login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Already logged in (e.g. back button): go to the dashboard.
  useEffect(() => {
    if (state.status === "authenticated") router.replace("/");
  }, [state.status, router]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      router.replace("/");
    } catch (err) {
      // 401 and 429 messages come from the API ("Invalid email or password", "Too Many Requests")
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="w-full max-w-sm rounded-xl border border-hairline bg-surface p-6" noValidate={false}>
      <h1 className="text-2xl font-semibold tracking-tight">CryptoScope</h1>
      <p className="mt-1 text-sm text-ink-2">Sign in to your cryptographic inventory.</p>

      <label className="mt-6 block text-sm font-medium" htmlFor="email">
        Email
      </label>
      <input
        id="email"
        type="email"
        autoComplete="username"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="mt-1 w-full rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-accent"
      />

      <label className="mt-4 block text-sm font-medium" htmlFor="password">
        Password
      </label>
      <input
        id="password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="mt-1 w-full rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-accent"
      />

      {error && (
        <div className="mt-4">
          <ErrorNote message={error} />
        </div>
      )}

      <Button type="submit" className="mt-6 w-full" disabled={submitting || !email || !password}>
        {submitting ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
