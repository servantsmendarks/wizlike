// M0 の実機確認画面。UI-01 / UI-02 / UI-03 を目で確かめるための模様とフォント見本、計測値のライブ表示。
// 表示文は strings.json から取る（§3-10）。ASCII の計測ラベルのみコードに置く。
import type { StageLayout, StageLayoutInput } from "../stage";

const SVG_NS = "http://www.w3.org/2000/svg";

// 模様ブロックの配置（論理 px）。
const BLOCK = 32;
const BLOCK_TOP = 6;
const BLOCK_GAP = 8;
const BLOCK_LEFT = 6;

// フォント見本に使う文字列キー。
const SAMPLE_KEYS = ["debug.fontSample", "creation.intro", "town.enter", "dungeon.blocked"] as const;

function svgEl<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** 1 セルの繰り返し模様。cells は [x, y] の 1px 塗り。 */
function pattern(id: string, w: number, h: number, cells: ReadonlyArray<readonly [number, number, number, number]>): SVGPatternElement {
  const p = svgEl("pattern", { id, width: w, height: h, patternUnits: "userSpaceOnUse" });
  for (const [x, y, cw, ch] of cells) p.appendChild(svgEl("rect", { x, y, width: cw, height: ch, fill: "#fff" }));
  return p;
}

function buildPatterns(): SVGSVGElement {
  const blocks: Array<{ id: string; w: number; h: number; cells: Array<[number, number, number, number]> }> = [
    // 1px 市松
    { id: "sc-checker1", w: 2, h: 2, cells: [[0, 0, 1, 1], [1, 1, 1, 1]] },
    // 1px 間隔の縦線
    { id: "sc-vlines", w: 2, h: 1, cells: [[0, 0, 1, 1]] },
    // 1px 間隔の横線
    { id: "sc-hlines", w: 1, h: 2, cells: [[0, 0, 1, 1]] },
    // 2px 市松（参考用）
    { id: "sc-checker2", w: 4, h: 4, cells: [[0, 0, 2, 2], [2, 2, 2, 2]] },
  ];
  const width = BLOCK_LEFT * 2 + blocks.length * BLOCK + (blocks.length - 1) * BLOCK_GAP;
  const height = BLOCK_TOP + BLOCK + 1;
  const svg = svgEl("svg", { width, height, viewBox: `0 0 ${width} ${height}`, "shape-rendering": "crispEdges" });
  svg.setAttribute("class", "stage-check-svg");
  const defs = svgEl("defs", {});
  svg.appendChild(defs);
  blocks.forEach((b, i) => {
    defs.appendChild(pattern(b.id, b.w, b.h, b.cells));
    const x = BLOCK_LEFT + i * (BLOCK + BLOCK_GAP);
    svg.appendChild(svgEl("rect", { x, y: BLOCK_TOP, width: BLOCK, height: BLOCK, fill: `url(#${b.id})` }));
  });
  return svg;
}

/** ステージ外周の 1px 枠。寸法に依存しないよう DOM の枠線で描く。 */
function buildFrame(): HTMLDivElement {
  const frame = document.createElement("div");
  frame.style.position = "absolute";
  frame.style.left = "0";
  frame.style.top = "0";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.border = "1px solid #fff";
  frame.style.pointerEvents = "none";
  return frame;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/0+$/, "");
}

function readFallbackInput(): Pick<StageLayoutInput, "viewportWidth" | "viewportHeight" | "devicePixelRatio"> {
  return {
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio || 1,
  };
}

export function renderStageCheck(
  stage: HTMLElement,
  strings: Readonly<Record<string, string>>,
): { update(layout: StageLayout, input?: StageLayoutInput): void } {
  stage.replaceChildren();

  stage.appendChild(buildFrame());
  stage.appendChild(buildPatterns());

  const sample = document.createElement("div");
  sample.className = "stage-check-text";
  sample.style.top = `${BLOCK_TOP + BLOCK + 8}px`;
  sample.textContent = SAMPLE_KEYS.map((k) => strings[k] ?? k).join("\n");
  stage.appendChild(sample);

  const info = document.createElement("pre");
  info.className = "stage-check-info";
  info.style.top = "150px";
  stage.appendChild(info);

  return {
    update(layout: StageLayout, input?: StageLayoutInput): void {
      const v = input ?? readFallbackInput();
      const ins = input?.insets;
      const lines = [
        `scale       ${fmt(layout.scale)}`,
        `deviceScale ${fmt(layout.deviceScale)}`,
        `integer     ${layout.integer}`,
        `dpr         ${fmt(v.devicePixelRatio)}`,
        `viewport    ${fmt(v.viewportWidth)} x ${fmt(v.viewportHeight)}`,
        ins
          ? `insets      t${fmt(ins.top)} r${fmt(ins.right)} b${fmt(ins.bottom)} l${fmt(ins.left)}`
          : "insets      n/a",
        `stage pos   ${fmt(layout.left)}, ${fmt(layout.top)}`,
      ];
      if (input) lines.push(`stage size  ${input.stageWidth} x ${input.stageHeight}`);
      info.textContent = lines.join("\n");
    },
  };
}
