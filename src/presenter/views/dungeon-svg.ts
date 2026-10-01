// UI-20〜23: 線画のビュー。40 本の path を最初に 1 回だけ作り、以後は visibility を差分で切り替えるだけ。
// UI-23 の歩行・旋回の演出は、ビュー全体の opacity のフェードだけ（Element.animate。fill は使わない）。
// モジュールのトップレベルでは DOM に触れない。
import { cssVar } from "../palette";
import { SLOT_IDS, SLOT_PATHS, type SlotId } from "./dungeon-geometry";

const SVG_NS = "http://www.w3.org/2000/svg";
export const VIEW_WIDTH = 240;
export const VIEW_HEIGHT = 150;

export type DungeonSvg = {
  el: SVGSVGElement;
  /** slots に入っている path だけを見せる（前回との差分だけ書き換える） */
  show(slots: ReadonlySet<SlotId>): void;
  /** opacity 1→0（ms/2）→ apply() → 0→1（ms/2）。ms が 0 以下なら apply だけを同期で呼んで解決する */
  fade(ms: number, apply: () => void): Promise<void>;
};

export function createDungeonSvg(): DungeonSvg {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`);
  svg.setAttribute("width", String(VIEW_WIDTH));
  svg.setAttribute("height", String(VIEW_HEIGHT));
  svg.setAttribute("aria-hidden", "true");

  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("transform", "translate(0.5 0.5)");
  g.setAttribute("fill", "none");
  g.setAttribute("stroke", `var(${cssVar("line")})`);
  g.setAttribute("stroke-width", "1");
  g.setAttribute("shape-rendering", "crispEdges");
  svg.appendChild(g);

  const paths = {} as Record<SlotId, SVGPathElement>;
  for (const id of SLOT_IDS) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", SLOT_PATHS[id]);
    p.setAttribute("data-slot", id);
    p.setAttribute("visibility", "hidden");
    g.appendChild(p);
    paths[id] = p;
  }

  let shown = new Set<SlotId>();
  let running: Animation | null = null;

  const show = (slots: ReadonlySet<SlotId>): void => {
    for (const id of shown) if (!slots.has(id)) paths[id].setAttribute("visibility", "hidden");
    for (const id of slots) if (!shown.has(id)) paths[id].setAttribute("visibility", "visible");
    shown = new Set(slots);
  };

  /** 1 段の opacity アニメーション。cancel や切り離しによる reject は握りつぶす */
  const step = async (from: number, to: number, ms: number): Promise<void> => {
    running?.cancel();
    // fill を使わないので、終わった後の値は style に先に置いておく（アニメーションの間は上書きされる）
    svg.style.opacity = String(to);
    const a = svg.animate([{ opacity: from }, { opacity: to }], { duration: ms, easing: "steps(2, end)" });
    running = a;
    try {
      await a.finished;
    } catch {
      // cancel された（次の fade が始まった、要素が外れた）。そのまま先へ進む
    }
    if (running === a) running = null;
  };

  const fade = async (ms: number, apply: () => void): Promise<void> => {
    if (!(ms > 0)) {
      running?.cancel();
      running = null;
      svg.style.opacity = "1";
      apply();
      return;
    }
    const half = ms / 2;
    await step(1, 0, half);
    apply();
    await step(0, 1, half);
  };

  return { el: svg, show, fade };
}
