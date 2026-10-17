"use client";

import { ChevronDown, LayoutDashboard, LogOut, Server, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useScanEvents } from "@/lib/scan-events-context";
import { isFinished } from "@/lib/scan-events-reducer";
import type { User } from "@/lib/types";
import { BrandMark } from "./ui/brand";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/assets", label: "Assets", icon: Server },
  { href: "/findings", label: "Findings", icon: ShieldAlert },
];

/** "demo.viewer@x.io" -> "DV", "admin@x.io" -> "AD" */
export function initials(email: string): string {
  const parts = email.split("@")[0].split(/[._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

export function Navbar() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-hairline bg-surface/85 backdrop-blur supports-[backdrop-filter]:bg-surface/70">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="CryptoScope home">
          <BrandMark />
          <span className="hidden leading-tight sm:block">
            <span className="block text-sm font-semibold tracking-tight">CryptoScope</span>
            <span className="block text-[11px] text-ink-muted">Quantum-risk inventory</span>
          </span>
        </Link>

        <nav aria-label="Main" className="flex h-full items-stretch gap-1 sm:ml-4">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                title={label}
                className={`relative flex items-center gap-2 px-3 text-sm transition-colors ${active ? "font-medium text-ink" : "text-ink-2 hover:text-ink"}`}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {/* Visually hidden (not display:none) on phones, so screen readers still announce the link. */}
                <span className="sr-only sm:not-sr-only">{label}</span>
                {/* Active page: accent bar on the bottom edge of the header */}
                <span aria-hidden className={`absolute inset-x-2 -bottom-px h-0.5 rounded-full ${active ? "bg-accent" : "bg-transparent"}`} />
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <LiveStatus />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}

/** Socket.IO connection state, plus how many scans are running right now. */
function LiveStatus() {
  const { connection, jobs } = useScanEvents();
  const running = jobs.filter((j) => !isFinished(j)).length;
  const look = {
    connected: { dot: "bg-[var(--status-good)]", label: running ? `Scanning ${running}` : "Live" },
    connecting: { dot: "bg-[var(--status-warning)]", label: "Connecting" },
    error: { dot: "bg-[var(--status-critical)]", label: "Offline" },
    disconnected: { dot: "bg-ink-muted", label: "Offline" },
  }[connection];
  return (
    <span
      className="hidden items-center gap-2 rounded-full border border-hairline px-2.5 py-1 text-xs text-ink-2 md:inline-flex"
      title="Live scan updates (Socket.IO)"
    >
      <span className="relative flex h-2 w-2">
        {connection === "connected" && running > 0 && (
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${look.dot}`} />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${look.dot}`} />
      </span>
      {look.label}
    </span>
  );
}

function RoleBadge({ role }: { role: User["role"] }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${role === "admin" ? "bg-accent-soft text-ink" : "bg-surface-2 text-ink-2"}`}
    >
      {role === "admin" ? "Admin" : "Viewer"}
    </span>
  );
}

/** Avatar button that opens a small account menu. Closes on outside click and Escape. */
function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) return null;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${user.email}`}
        title={user.email}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-hairline py-1 pl-1 pr-2.5 text-sm hover:bg-surface-2"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-ink">
          {initials(user.email)}
        </span>
        <span className="hidden max-w-40 truncate text-ink-2 lg:inline">{user.email}</span>
        <RoleBadge role={user.role} />
        <ChevronDown className={`h-4 w-4 text-ink-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-64 overflow-hidden rounded-xl border border-hairline bg-surface shadow-lg">
          <div className="border-b border-hairline px-4 py-3">
            <p className="text-xs text-ink-muted">Signed in as</p>
            <p className="truncate text-sm font-medium">{user.email}</p>
            <p className="mt-1 text-xs text-ink-2">
              {user.role === "admin" ? "Admin: can scan and manage assets" : "Viewer: read-only access"}
            </p>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              logout();
            }}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-ink-2 hover:bg-surface-2 hover:text-ink"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
