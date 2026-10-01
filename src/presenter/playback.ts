// UI-41 / UI-23 / UI-43: GameEvent[] を順に再生する。kind ごとに 1 つのハンドラ（Promise を返す）。
// - 判定・計算・分岐はしない（§3-4）。イベントの値で表示を更新し、最後に最終の state で同期する。
// - 再生中の視点（cursor）は再生前の state.dive から作り、moved / turned / floorChanged の値で進める。
//   ビューは visibleCells(finalState, data, cursor) を描く（具体的なビューは結線側が PlayerDeps に注入する）。
// - settings().skipAnimations が真なら、フェードは 0ms、文字送りは即時で解決する（§3-9）。
// - rushAll() は、同じ再生の中の残りをすべて即時にする（UI-43 のタップ 2 回目）。今の文の即時表示は呼び出し側が message.rush() で行う。
// 具体的な views は import しない。モジュールのトップレベルでは DOM に触れない。
import type { GameData, Strings } from "../core/data/index";
import type { GameEvent, GameEventKind, GameState, Life, Screen, ViewPoint } from "../core/types";
import type { Settings } from "./settings";
import { formatMessage } from "./views/message";

export type PlayCx = { cursor: ViewPoint | null; skip: boolean };

export type PlayerDeps = {
  data: GameData;
  strings: Strings;
  settings(): Settings;
  view: { fade(ms: number, apply: () => void): Promise<void>; showAt(state: GameState, at: ViewPoint): void };
  header: { showAt(state: GameState, at: ViewPoint): void };
  message: { say(text: string, instant: boolean): Promise<void>; setMore(on: boolean): void };
  party: { setHp(id: string, hp: number): void; setSan(id: string, san: number): void; setLife(id: string, life: Life): void };
  screens: { show(to: Screen, state: GameState): void; sync(state: GameState): void };
};

export type Handlers = {
  [K in GameEventKind]?: (ev: Extract<GameEvent, { kind: K }>, cx: PlayCx, finalState: GameState) => Promise<void>;
};

export type Player = {
  play(events: readonly GameEvent[], before: GameState, finalState: GameState): Promise<void>;
  rushAll(): void;
};

function cursorOfDive(state: GameState): ViewPoint | null {
  const d = state.dive;
  return d === null ? null : { floor: d.floor, pos: { x: d.pos.x, y: d.pos.y }, facing: d.facing };
}

function copyCursor(c: ViewPoint): ViewPoint {
  return { floor: c.floor, pos: { x: c.pos.x, y: c.pos.y }, facing: c.facing };
}

export function createPlayer(deps: PlayerDeps): Player {
  let rushed = false;

  const isSkip = (): boolean => deps.settings().skipAnimations || rushed;

  /** ビューとヘッダーを cursor の視点でフェードしながら描き直す（UI-23） */
  const redraw = (cx: PlayCx, finalState: GameState): Promise<void> => {
    const c = cx.cursor;
    if (c === null) return Promise.resolve();
    const at = copyCursor(c);
    const ms = cx.skip ? 0 : deps.data.config.ui.viewFadeMs;
    return deps.view.fade(ms, () => {
      deps.view.showAt(finalState, at);
      deps.header.showAt(finalState, at);
    });
  };

  /** cursor が無いとき（再生前に潜行していなかった）は最終の dive の階で作る */
  const ensureCursor = (cx: PlayCx, finalState: GameState): ViewPoint | null => {
    if (cx.cursor === null) cx.cursor = cursorOfDive(finalState);
    return cx.cursor;
  };

  const handlers: Handlers = {
    async message(ev, cx) {
      cx.skip = isSkip();
      const tpl = deps.strings[ev.key] ?? ev.key;
      await deps.message.say(formatMessage(tpl, ev.params), cx.skip);
    },
    async moved(ev, cx, finalState) {
      cx.skip = isSkip();
      const c = ensureCursor(cx, finalState);
      if (c === null) return;
      c.pos = { x: ev.pos.x, y: ev.pos.y };
      c.facing = ev.facing;
      await redraw(cx, finalState);
    },
    async turned(ev, cx, finalState) {
      cx.skip = isSkip();
      const c = ensureCursor(cx, finalState);
      if (c === null) return;
      c.facing = ev.facing;
      await redraw(cx, finalState);
    },
    async floorChanged(ev, cx, finalState) {
      cx.skip = isSkip();
      cx.cursor = { floor: ev.floor, pos: { x: ev.pos.x, y: ev.pos.y }, facing: ev.facing };
      await redraw(cx, finalState);
    },
    async screen(ev, cx, finalState) {
      cx.skip = isSkip();
      deps.screens.show(ev.to, finalState);
      if (ev.to === "dungeon") {
        const c = cursorOfDive(finalState);
        if (c === null) return;
        cx.cursor = c;
        await redraw(cx, finalState);
      }
    },
    async blocked(_ev, cx) {
      // 文言は core の message が出す
      cx.skip = isSkip();
    },
    async hpChanged(ev, cx) {
      cx.skip = isSkip();
      deps.party.setHp(ev.id, ev.hp);
    },
    async sanChanged(ev, cx) {
      cx.skip = isSkip();
      deps.party.setSan(ev.id, ev.san);
    },
    async lifeChanged(ev, cx) {
      cx.skip = isSkip();
      deps.party.setLife(ev.id, ev.life);
    },
  };

  return {
    async play(events: readonly GameEvent[], before: GameState, finalState: GameState): Promise<void> {
      rushed = false;
      const cx: PlayCx = { cursor: cursorOfDive(before), skip: isSkip() };
      // 後ろに message が残っているか（続きの三角。M2 はタップを待たずに先へ進む）
      let messagesLeft = events.filter((e) => e.kind === "message").length;
      for (const ev of events) {
        if (ev.kind === "message") {
          messagesLeft--;
          deps.message.setMore(messagesLeft > 0);
        }
        const h = handlers[ev.kind] as ((e: GameEvent, cx: PlayCx, s: GameState) => Promise<void>) | undefined;
        if (h !== undefined) await h(ev, cx, finalState);
      }
      deps.message.setMore(false);
      deps.screens.sync(finalState);
    },
    rushAll(): void {
      rushed = true;
    },
  };
}
