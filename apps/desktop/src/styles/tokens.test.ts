import { describe, expect, it } from "vitest";
import appStyles from "../App.css?raw";
import baseStyles from "./base.css?raw";
import tokensStyles from "./tokens.css?raw";

const WCAG_TEXT_MIN_RATIO = 4.5;
const WCAG_NON_TEXT_MIN_RATIO = 3;
const WCAG_CONTRAST_OFFSET = 0.05;
const SRGB_LINEAR_THRESHOLD = 0.03928;
const SRGB_LINEAR_SLOPE = 12.92;
const SRGB_OFFSET = 0.055;
const SRGB_SCALE = 1.055;
const SRGB_GAMMA = 2.4;
const RED_WEIGHT = 0.2126;
const GREEN_WEIGHT = 0.7152;
const BLUE_WEIGHT = 0.0722;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const HEX_PREFIX_LENGTH = 1;
const HEX_CHANNEL_LENGTH = 2;
const HEX_RADIX = 16;
const MAX_CHANNEL_VALUE = 255;
const FIXED_VALUE = /#[0-9a-f]{3,8}\b|\brgba?\(|\b\d+px\b/i;

type Palette = Record<string, string>;

/** Pares de texto usados na interface (WCAG 1.4.3, mínimo 4,5:1). */
const TEXT_PAIRS: [string, string][] = [
  ["color-text", "color-bg"],
  ["color-text", "color-surface"],
  ["color-text", "color-sand"],
  ["color-muted", "color-bg"],
  ["color-muted", "color-surface"],
  ["color-error", "color-bg"],
  ["color-error", "color-surface"],
];

/** Controles, foco e indicadores de estado (WCAG 1.4.11, mínimo 3:1). */
const NON_TEXT_PAIRS: [string, string][] = [
  ["color-accent", "color-bg"],
  ["color-control", "color-surface"],
  ["color-ok", "color-bg"],
  ["color-warn", "color-bg"],
  ["color-error", "color-bg"],
];

function requireMatch(
  css: string,
  pattern: RegExp,
  description: string,
): string {
  const match = pattern.exec(css);
  if (match?.[1] === undefined) {
    throw new Error(`Bloco não encontrado em tokens.css: ${description}`);
  }
  return match[1];
}

function parseDeclarations(block: string): Palette {
  const palette: Palette = {};
  for (const match of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    palette[match[1]] = match[2].trim();
  }
  return palette;
}

function colorOf(palette: Palette, name: string): string {
  const value = palette[name];
  if (value === undefined || !HEX_COLOR.test(value)) {
    throw new Error(`Cor hexadecimal ausente no tema: ${name}`);
  }
  return value;
}

function linearChannel(hex: string, index: number): number {
  const start = HEX_PREFIX_LENGTH + index * HEX_CHANNEL_LENGTH;
  const channel =
    parseInt(hex.slice(start, start + HEX_CHANNEL_LENGTH), HEX_RADIX) /
    MAX_CHANNEL_VALUE;

  return channel <= SRGB_LINEAR_THRESHOLD
    ? channel / SRGB_LINEAR_SLOPE
    : ((channel + SRGB_OFFSET) / SRGB_SCALE) ** SRGB_GAMMA;
}

/** Luminância relativa do WCAG 2.x (sRGB linearizado e ponderado). */
function relativeLuminance(hex: string): number {
  return (
    RED_WEIGHT * linearChannel(hex, 0) +
    GREEN_WEIGHT * linearChannel(hex, 1) +
    BLUE_WEIGHT * linearChannel(hex, 2)
  );
}

function contrastRatio(foreground: string, background: string): number {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);

  return (lighter + WCAG_CONTRAST_OFFSET) / (darker + WCAG_CONTRAST_OFFSET);
}

function hexColorNames(palette: Palette): string[] {
  return Object.keys(palette)
    .filter((name) => HEX_COLOR.test(palette[name] ?? ""))
    .sort();
}

const lightPalette = parseDeclarations(
  requireMatch(tokensStyles, /^:root\s*\{([^}]*)\}/m, ":root"),
);
const darkByAttribute = parseDeclarations(
  requireMatch(
    tokensStyles,
    /^:root\[data-theme="dark"\]\s*\{([^}]*)\}/m,
    ':root[data-theme="dark"]',
  ),
);
const darkByMedia = parseDeclarations(
  requireMatch(
    tokensStyles,
    /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}/,
    "prefers-color-scheme: dark",
  ),
);
const THEMES: [string, Palette][] = [
  ["claro", lightPalette],
  ["escuro", darkByAttribute],
];

describe("tema escuro", () => {
  it("data-theme e prefers-color-scheme definem os mesmos valores", () => {
    expect(darkByAttribute).toEqual(darkByMedia);
  });

  it("redefine cada cor do tema claro", () => {
    expect(hexColorNames(darkByAttribute)).toEqual(hexColorNames(lightPalette));
  });
});

describe.each(THEMES)("contraste no tema %s", (_theme, palette) => {
  it.each(TEXT_PAIRS)(
    "texto %s sobre %s atinge AA",
    (foreground, background) => {
      expect(
        contrastRatio(
          colorOf(palette, foreground),
          colorOf(palette, background),
        ),
      ).toBeGreaterThanOrEqual(WCAG_TEXT_MIN_RATIO);
    },
  );

  it.each(NON_TEXT_PAIRS)(
    "%s sobre %s atinge 3:1",
    (foreground, background) => {
      expect(
        contrastRatio(
          colorOf(palette, foreground),
          colorOf(palette, background),
        ),
      ).toBeGreaterThanOrEqual(WCAG_NON_TEXT_MIN_RATIO);
    },
  );
});

describe("estilos dos componentes", () => {
  it.each([
    ["App.css", appStyles],
    ["base.css", baseStyles],
  ])("%s não usa cor nem px fixos", (_file, css) => {
    expect(css).not.toMatch(FIXED_VALUE);
  });

  it("todo token usado nos estilos está definido em tokens.css", () => {
    const defined = new Set(
      [...tokensStyles.matchAll(/--([\w-]+):/g)].map((match) => match[1]),
    );
    const used = [
      ...`${appStyles}\n${baseStyles}`.matchAll(/var\(--([\w-]+)/g),
    ].map((match) => match[1]);

    expect(used.filter((name) => !defined.has(name))).toEqual([]);
  });
});
