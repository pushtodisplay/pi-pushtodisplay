import { ACCENT, STATUS_COLOR, SURFACE, TEXT, TEXT_DIM } from "../payloads.ts";

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** AA for body text. Every foreground on a line must clear this. */
const AA = 4.5;

describe("palette", () => {
  const foregrounds: Array<[string, string]> = [
    ["body", TEXT],
    ["agent", ACCENT],
    ["time", TEXT_DIM],
    ...Object.entries(STATUS_COLOR).map(([k, v]) => [`status ${k}`, v] as [string, string]),
  ];

  it.each(foregrounds)("%s clears AA on the surface", (_name, colour) => {
    expect(contrast(colour, SURFACE)).toBeGreaterThanOrEqual(AA);
  });

  it("keeps the time quieter than the body, but still readable", () => {
    expect(contrast(TEXT_DIM, SURFACE)).toBeLessThan(contrast(TEXT, SURFACE));
    expect(contrast(TEXT_DIM, SURFACE)).toBeGreaterThanOrEqual(AA);
  });

  it("separates the surface from both page themes", () => {
    // A near-black card: strongly distinct from a white page, subtly lifted from
    // a black one. It never needs to know which theme it is sitting on.
    expect(contrast(SURFACE, "#ffffff")).toBeGreaterThan(10);
    expect(contrast(SURFACE, "#000000")).toBeGreaterThan(1.2);
  });

  it("distinguishes the status colours from one another", () => {
    const colours = new Set(Object.values(STATUS_COLOR));
    // ready+run / ok+done / fail / needs / stop+ended
    expect(colours.size).toBe(5);
  });
});
