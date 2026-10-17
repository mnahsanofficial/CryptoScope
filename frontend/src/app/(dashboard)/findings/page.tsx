import type { Metadata } from "next";
import { FindingsView } from "@/components/findings-view";

export const metadata: Metadata = { title: "Findings" };

export default function FindingsPage() {
  return <FindingsView />;
}
