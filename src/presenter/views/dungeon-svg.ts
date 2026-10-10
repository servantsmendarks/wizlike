// UI-20〜23: 線画のビュー。96 本の path（壁・扉・階段の記号・罠の印・宝箱の印・開口側の床線）と開口の印 6 本（M16）を最初に 1 回だけ作り、以後は visibility を差分で切り替えるだけ。
// UI-23 の歩行・旋回の演出は、ビュー全体の opacity のフェードだけ（Element.animate。fill は使わない）。
// モジュールのトップレベルでは DOM に触れない。
import { cssVar } from "../palette";
import { EXIT_MARK_IDS, EXIT_MARK_PATHS, type ExitMarkId, isChestSlot, isStairsSlot, isTrapSlot, SLOT_IDS, SLOT_PATHS, type SlotId } from "./dungeon-geometry";

const SVG_NS = "http://www.w3.org/2000/svg";
export const VIEW_WIDTH = 240;
export const VIEW_HEIGHT = 150;

export type DungeonSvg = {
  el: SVGSVGElement;
  /** slots と marks（開口の印。M16）に入っている path だけを見せる（前回との差分だけ書き換える）。marks を省くと印は出さない */
  show(slots: ReadonlySet<SlotId>, marks?: ReadonlySet<ExitMarkId>): void;
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

  const paths = {} as Record<SlotId | ExitMarkId, SVGPathElement>;
  const ids: readonly (SlotId | ExitMarkId)[] = [...SLOT_IDS, ...EXIT_MARK_IDS];
  const isMark = (id: SlotId | ExitMarkId): id is ExitMarkId => id in EXIT_MARK_PATHS;
  for (const id of ids) {
    const p = document.createElementNS(SVG_NS, "path");
    // 開口の印（M16）はすべてのスロットの後（いちばん上）。色は g の線の色を継ぐ
    if (isMark(id)) {
      p.setAttribute("d", EXIT_MARK_PATHS[id]);
      p.setAttribute("data-slot", id);
      p.setAttribute("visibility", "hidden");
      g.appendChild(p);
      paths[id] = p;
      continue;
    }
    p.setAttribute("d", SLOT_PATHS[id]);
    p.setAttribute("data-slot", id);
    // 階段の記号は地図（UI-24）と同じ色。ほかは g の線の色を継ぐ
    if (isStairsSlot(id)) p.setAttribute("stroke", `var(${cssVar("stairs")})`);
    // 察知した罠の印は danger（赤。地図の罠の × と同じ。M5.5）
    if (isTrapSlot(id)) p.setAttribute("stroke", `var(${cssVar("danger")})`);
    // 宝箱の印は accent（地図の宝箱の □ と同じ。M11。UI-72）
    if (isChestSlot(id)) p.setAttribute("stroke", `var(${cssVar("accent")})`);
    p.setAttribute("visibility", "hidden");
    g.appendChild(p);
    paths[id] = p;
  }

  let shown = new Set<SlotId | ExitMarkId>();
  let running: Animation | null = null;

  const show = (slots: ReadonlySet<SlotId>, marks: ReadonlySet<ExitMarkId> = new Set()): void => {
    const next = new Set<SlotId | ExitMarkId>([...slots, ...marks]);
    for (const id of shown) if (!next.has(id)) paths[id].setAttribute("visibility", "hidden");
    for (const id of next) if (!shown.has(id)) paths[id].setAttribute("visibility", "visible");
    shown = next;
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
