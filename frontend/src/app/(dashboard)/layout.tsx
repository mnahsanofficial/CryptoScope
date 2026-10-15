import { AppShell } from "@/components/app-shell";
import type { ReactNode } from "react";

/** Every page in this group requires login (the shell redirects anonymous users to /login). */
export default function DashboardLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <AppShell>{children}</AppShell>;
}
