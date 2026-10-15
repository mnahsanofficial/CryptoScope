"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";
import { ScanProgressPanel } from "./scan-progress-panel";
import { Button, Skeleton } from "./ui/primitives";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/assets", label: "Assets" },
  { href: "/findings", label: "Findings" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { state, user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

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
      <header className="border-b border-hairline bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-6">
            <Link href="/" className="font-semibold tracking-tight">
              CryptoScope
            </Link>
            <nav className="flex gap-1">
              {NAV.map((item) => {
                const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`rounded-lg px-3 py-1.5 text-sm ${active ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:text-ink"}`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-ink-2">
              {user.email} · <span className="font-medium text-ink">{user.role}</span>
            </span>
            <Button variant="ghost" onClick={logout}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{children}</main>
      <ScanProgressPanel />
    </div>
  );
}
