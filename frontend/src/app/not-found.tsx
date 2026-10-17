import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/ui/brand";

export const metadata: Metadata = { title: "Page not found" };

/** Branded 404 with a way back, instead of the framework's bare "This page could not be found". */
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <div className="flex justify-center">
          <BrandMark size="lg" />
        </div>
        <p className="mt-6 text-sm font-medium text-accent">404</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-2 text-sm text-ink-2">The page you asked for doesn&apos;t exist or has moved.</p>
        <div className="mt-6 flex justify-center gap-2">
          <Link href="/" className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white hover:opacity-90">
            Go to overview
          </Link>
          <Link href="/findings" className="rounded-lg border border-hairline bg-surface px-3.5 py-2 text-sm font-medium hover:bg-surface-2">
            Search findings
          </Link>
        </div>
      </div>
    </main>
  );
}
