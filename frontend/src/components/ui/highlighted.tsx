import { splitHighlight } from "@/lib/highlight";

/** Shows `highlighted` (with search matches marked) when present, otherwise the plain text. */
export function Highlighted({ text, highlighted }: { text: string; highlighted?: string }) {
  if (!highlighted) return <>{text}</>;
  return (
    <>
      {splitHighlight(highlighted).map((part, i) =>
        part.match ? (
          <mark key={i} className="rounded-sm bg-accent-soft px-0.5 text-ink">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}
