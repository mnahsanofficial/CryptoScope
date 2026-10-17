/** Markers the API puts around matched words (control characters, never HTML). */
export const HIGHLIGHT_START = "\u0001";
export const HIGHLIGHT_END = "\u0002";

export interface HighlightPart {
  text: string;
  match: boolean;
}

/**
 * "The \u0001certificate\u0002 expired" -> [{text:"The ", match:false}, {text:"certificate", match:true}, ...]
 * Rendering these parts as React elements (instead of injecting <mark> HTML) means search results can
 * never execute markup, even if indexed text contained some.
 */
export function splitHighlight(value: string): HighlightPart[] {
  const parts: HighlightPart[] = [];
  let rest = value;
  while (rest.length > 0) {
    const start = rest.indexOf(HIGHLIGHT_START);
    if (start === -1) {
      parts.push({ text: rest, match: false });
      break;
    }
    if (start > 0) parts.push({ text: rest.slice(0, start), match: false });
    const end = rest.indexOf(HIGHLIGHT_END, start + 1);
    const stop = end === -1 ? rest.length : end;
    parts.push({ text: rest.slice(start + 1, stop), match: true });
    rest = end === -1 ? "" : rest.slice(end + 1);
  }
  return parts.filter((p) => p.text.length > 0);
}
