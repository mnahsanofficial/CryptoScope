import { ShieldCheck } from "lucide-react";

/** The logo tile: one definition, so the navbar, login and error pages always match. */
export function BrandMark({ size = "md" }: { size?: "md" | "lg" }) {
  const box = size === "lg" ? "h-11 w-11 rounded-xl" : "h-8 w-8 rounded-lg";
  const icon = size === "lg" ? "h-6 w-6" : "h-[18px] w-[18px]";
  return (
    <span aria-hidden className={`flex shrink-0 items-center justify-center bg-accent text-white shadow-sm ${box}`}>
      <ShieldCheck className={icon} strokeWidth={2.25} />
    </span>
  );
}
