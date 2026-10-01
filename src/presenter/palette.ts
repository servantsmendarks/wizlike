// UI-04: FC 風の固定パレット。表示層の色の唯一の出所。
// 起動時に applyPalette が CSS カスタムプロパティ --c-<role> を流し込み、style.css と SVG はそれだけを参照する。
// モジュールのトップレベルでは DOM に触れない（node 環境のテストから import するため）。

/** FC の色から選んだもの（UI-04 の 54 色以内）。値は #RRGGBB */
export const PALETTE = {
  black: "#000000",
  white: "#FCFCFC",
  gray: "#BCBCBC",
  dim: "#7C7C7C",
  lightGreen: "#B8F8B8",
  darkGreen: "#005800",
  red: "#F83800",
  orange: "#FCA044",
  sky: "#3CBCFC",
  yellow: "#F8B800",
} as const;

export type PaletteName = keyof typeof PALETTE;

/** 用途 → パレットの色名。CSS 変数は --c-<用途>（例 --c-line）。線画の線は淡緑【仮】 */
export const ROLES = {
  bg: "black",
  text: "white",
  dim: "dim",
  line: "lightGreen",
  frame: "white",
  accent: "yellow",
  danger: "red",
  player: "yellow",
  stairs: "sky",
  mapFloor: "darkGreen",
} as const satisfies Record<string, PaletteName>;

export type Role = keyof typeof ROLES;

/** 用途の CSS 変数名（"--c-line" など） */
export function cssVar(role: Role): string {
  return `--c-${role}`;
}

/** { "--c-bg": "#000000", ... }（純粋） */
export function cssVars(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const role of Object.keys(ROLES) as Role[]) out[cssVar(role)] = PALETTE[ROLES[role]];
  return out;
}

/** root（通常は document.documentElement）に CSS 変数を設定する */
export function applyPalette(root: HTMLElement): void {
  for (const [name, value] of Object.entries(cssVars())) root.style.setProperty(name, value);
}
