import { initials } from "@/components/navbar";
import { HIGHLIGHT_END as E, HIGHLIGHT_START as S, splitHighlight } from "@/lib/highlight";

describe("splitHighlight", () => {
  it("splits marked words into matched parts", () => {
    expect(splitHighlight(`The ${S}certificate${E} has ${S}expired${E}`)).toEqual([
      { text: "The ", match: false },
      { text: "certificate", match: true },
      { text: " has ", match: false },
      { text: "expired", match: true },
    ]);
  });

  it("returns plain text unchanged and treats HTML as text", () => {
    expect(splitHighlight("<img src=x onerror=alert(1)>")).toEqual([{ text: "<img src=x onerror=alert(1)>", match: false }]);
  });

  it("tolerates a missing end marker and empty input", () => {
    expect(splitHighlight(`qa.${S}zeuz`)).toEqual([
      { text: "qa.", match: false },
      { text: "zeuz", match: true },
    ]);
    expect(splitHighlight("")).toEqual([]);
  });
});

describe("initials", () => {
  it("uses the first letters of the name parts, or the first two letters", () => {
    expect(initials("demo.viewer@cryptoscope.io")).toBe("DV");
    expect(initials("admin@cryptoscope.io")).toBe("AD");
    expect(initials("jane_doe-smith@x.io")).toBe("JD");
  });
});
