"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";
import { Navbar } from "./navbar";
import { ScanProgressPanel } from "./scan-progress-panel";
import { Skeleton } from "./ui/primitives";

export function AppShell({ children }: { children: ReactNode }) {
  const { state, user } = useAuth();
  const router = useRouter();

  // Client-side guard for UX only. The real protection is the API, which rejects requests without a valid token.
  useEffect(() => {
    if (state.status === "anonymous") router.replace("/login");
  }, [state.status, router]);

  if (state.status !== "authenticated" || !user) {
    return (
      <div className="mx-auto max-w-6xl p-6">
        <Skeleton className="h-10" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{children}</main>
      <ScanProgressPanel />
    </div>
  );
}
