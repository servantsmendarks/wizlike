// UI-57（開発用）: debug パネルの「ポインタ」に出す、直近のポインタイベントの記録（長押しの不具合を実機で再現したときの証拠）。
// - 表示層だけの 20 件の輪（GameState にも保存にも入れない）。古いものから押し出す。
// - 記録するのは pointerdown / pointerup / pointercancel / lostpointercapture だけ（pointermove は 20 件を埋めるので記録しない）。
// - ステージに capture で付ける（tap.ts の bubble の処理より先に走るので、開くタップの pointerup も開く前に記録できる）。
// - enabled() が偽（debug パネルを開いている間）に始まった押下は、その後の up / cancel / lost も記録しない
//   （パネルを閉じるタップの pointerup の後に届く lostpointercapture が、閉じた後に 1 件だけ残らないように）。
// - 各件は type、ステージの論理座標（整数に丸める）、now() の ms（整数）、対象の短い表し（describeTarget）。
//   cancel / lost で clientX と clientY が両方 0 のときは座標を null にする（Chrome は cancel / lost に座標を渡さず 0,0 になり、
//   換算すると -15,-32 のような意味の無い値になるため。行では debug.pointer.rowNoPos で「-」と出す）。
// モジュールのトップレベルでは DOM に触れない。
import type { Strings } from "../../core/data/index";
import { formatMessage } from "../views/message";

export const POINTER_KINDS = ["pointerdown", "pointerup", "pointercancel", "lostpointercapture"] as const;
export type PointerKind = (typeof POINTER_KINDS)[number];
/** x / y は論理座標。cancel / lost で座標が渡されなかった（clientX と clientY が両方 0）ときは null */
export type PointerEntry = { type: PointerKind; x: number | null; y: number | null; t: number; target: string };

/** 記録の件数（ユーザー指示） */
export const POINTER_LOG_MAX = 20;
/** 対象の表しの最大の文字数 */
export const POINTER_TARGET_MAX = 16;

export type PointerLog = {
  push(e: PointerEntry): void;
  /** 古い順 */
  entries(): readonly PointerEntry[];
  clear(): void;
};

export function createPointerLog(max = POINTER_LOG_MAX): PointerLog {
  let list: PointerEntry[] = [];
  return {
    push(e: PointerEntry): void {
      list.push(e);
      if (list.length > max) list = list.slice(list.length - max);
    },
    entries: () => list.slice(),
    clear(): void {
      list = [];
    },
  };
}

/** describeTarget が読む要素の形（node のテストで偽物を渡せるように最小限） */
export type TargetLike = {
  tagName: string;
  getAttribute(name: string): string | null;
  textContent: string | null;
  closest?(selector: string): TargetLike | null;
};

/**
 * 対象の短い表し（1 行に収まる長さ。POINTER_TARGET_MAX 文字で切る）。押せるもの（closest('[data-tap]')）があればそれ、無ければ target 自身。
 * aria-label、無ければ文字（空白を詰めて trim）を label とし、"{tag} {label}"。label が無ければ "{tag}.{class の先頭}"（class も無ければ tag）。
 * class は getAttribute で読む（SVG の className は SVGAnimatedString のため）
 */
export function describeTarget(t: TargetLike | null): string {
  if (t === null || typeof t.tagName !== "string") return "-";
  const el = (typeof t.closest === "function" ? t.closest("[data-tap]") : null) ?? t;
  const tag = el.tagName.toLowerCase();
  const label = (el.getAttribute("aria-label") ?? "").trim() || (el.textContent ?? "").replace(/\s+/g, " ").trim();
  const cls = (el.getAttribute("class") ?? "").trim().split(/\s+/)[0] ?? "";
  const s = label !== "" ? `${tag} ${label}` : cls !== "" ? `${tag}.${cls}` : tag;
  return [...s].slice(0, POINTER_TARGET_MAX).join("");
}

/**
 * パネルの 1 行（strings debug.pointer.row「{t} {type} {x},{y} {target}」。type は debug.pointer.{type} の短い名前）。
 * 座標が null なら debug.pointer.rowNoPos「{t} {type} - {target}」
 */
export function formatPointerRow(e: PointerEntry, strings: Strings): string {
  const type = strings[`debug.pointer.${e.type}`] ?? e.type;
  if (e.x === null || e.y === null) {
    return formatMessage(strings["debug.pointer.rowNoPos"] ?? "debug.pointer.rowNoPos", { t: e.t, type, target: e.target });
  }
  return formatMessage(strings["debug.pointer.row"] ?? "debug.pointer.row", { t: e.t, type, x: e.x, y: e.y, target: e.target });
}

/** attachPointerLog が受けるイベントの形 */
type PtrEv = { type: string; pointerId: number; clientX: number; clientY: number; target: EventTarget | null };

/** ステージに capture の listener を 4 つ付ける。戻り値で外す */
export function attachPointerLog(
  stage: HTMLElement,
  o: { log: PointerLog; scale(): number; now(): number; enabled(): boolean },
): () => void {
  /** 記録しなかった押下の pointerId（その後の up / cancel / lost も記録しない） */
  let skipped: number | null = null;
  const handle = (ev: Event): void => {
    const e = ev as unknown as PtrEv;
    const type = e.type as PointerKind;
    // 次の pointerdown で必ず置き換わるので、lost が届かない環境でも後の押下を取りこぼさない
    if (type === "pointerdown") skipped = o.enabled() ? null : e.pointerId;
    if (!o.enabled() || skipped === e.pointerId) return;
    const rect = stage.getBoundingClientRect();
    const sc = o.scale();
    const noPos = (type === "pointercancel" || type === "lostpointercapture") && e.clientX === 0 && e.clientY === 0;
    o.log.push({
      type,
      x: noPos ? null : Math.round((e.clientX - rect.left) / sc),
      y: noPos ? null : Math.round((e.clientY - rect.top) / sc),
      t: Math.round(o.now()),
      target: describeTarget(e.target as unknown as TargetLike | null),
    });
  };
  const opts: AddEventListenerOptions = { capture: true };
  for (const k of POINTER_KINDS) stage.addEventListener(k, handle, opts);
  return () => {
    for (const k of POINTER_KINDS) stage.removeEventListener(k, handle, opts);
  };
}
