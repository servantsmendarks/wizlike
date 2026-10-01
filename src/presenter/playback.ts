// UI-41 / UI-23 / UI-43: GameEvent[] を順に再生する。kind ごとに 1 つのハンドラ（Promise を返す）。
// - 判定・計算・分岐はしない（§3-4）。イベントの値で表示を更新し、最後に最終の state で同期する。
// - 再生中の視点（cursor）は再生前の state.dive から作り、moved / turned / floorChanged の値で進める。
//   ビューは visibleCells(finalState, data, cursor) を描く（具体的なビューは結線側が PlayerDeps に注入する）。
// - settings().skipAnimations が真なら、フェードは 0ms、文字送りは即時で解決する（§3-9）。
// - rushAll() は、同じ再生の中の残りをすべて即時にする（UI-43 のタップ 2 回目）。今の文の即時表示は呼び出し側が message.rush() で行う。
// - 戦闘（UI-41 / UI-42 / UI-40）: 被弾のフラッシュは hpChanged（delta < 0）に一本化する（味方はパーティ行、敵はグループの絵）。
//   敵の id は "e{g}-{u}"（enemyGroupOfId）。敵の HP・状態は見せない（状態は core の message で伝わる）。
//   全体攻撃の揺れは、spell の呪文が target enemyGroup / allEnemies かつ effect damage のとき（data.spells を表示のためだけに引く）。
//   ダイスは dice で出し、message と dice 以外のイベントの前と再生の終わりに消す。
//   skip のときは flash / shake / dice / fade に 0ms を渡し、タイマーを使わない。
// 具体的な views は import しない（純粋な enemyGroupOfId と formatMessage だけ）。モジュールのトップレベルでは DOM に触れない。
import type { GameData, StatusId, Strings } from "../core/data/index";
import type { EnemyGroupView, GameEvent, GameEventKind, GameState, Life, Screen, ViewPoint } from "../core/types";
import type { Settings } from "./settings";
import { enemyGroupOfId } from "./views/battle";
import { formatMessage } from "./views/message";

export type PlayCx = { cursor: ViewPoint | null; skip: boolean };

export type PlayerDeps = {
  data: GameData;
  strings: Strings;
  settings(): Settings;
  view: {
    fade(ms: number, apply: () => void): Promise<void>;
    showAt(state: GameState, at: ViewPoint): void;
    /** UI-42 の全体攻撃の揺れ */
    shake(ms: number): Promise<void>;
  };
  header: { showAt(state: GameState, at: ViewPoint): void };
  message: { say(text: string, instant: boolean): Promise<void>; setMore(on: boolean): void };
  party: {
    setHp(id: string, hp: number): void;
    setSan(id: string, san: number): void;
    setLife(id: string, life: Life): void;
    setMp(id: string, mp: number): void;
    setStatus(id: string, status: StatusId, on: boolean): void;
    /** UI-42 の被弾 */
    flash(id: string, ms: number): Promise<void>;
  };
  /** ビューの敵グループの層（views/battle.ts） */
  battle: {
    setGroups(groups: readonly EnemyGroupView[]): void;
    removeOne(g: number, ms: number): Promise<void>;
    flash(g: number, ms: number): Promise<void>;
    clear(): void;
  };
  /** UI-40 のダイス表示（views/dice.ts） */
  dice: {
    show(ev: { label: string; dice: readonly number[]; total: number }, skip: boolean, stepMs: number): Promise<void>;
    hide(): void;
  };
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
  /** ダイスの overlay が出ているか（出ていなければ hide を呼ばない） */
  let diceShown = false;
  const hideDice = (): void => {
    if (!diceShown) return;
    diceShown = false;
    deps.dice.hide();
  };
  const ui = deps.data.config.ui;
  const msOf = (cx: PlayCx, ms: number): number => (cx.skip ? 0 : ms);

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
      if (ev.to === "battle") {
        // 迷宮の線画をフェードで消し、その間に敵グループの層へ切り替える（層の表示は screens.show が画面のモードで行う）
        await deps.view.fade(msOf(cx, ui.viewFadeMs), () => {
          deps.screens.show(ev.to, finalState);
          deps.battle.clear();
        });
        return;
      }
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
      const g = enemyGroupOfId(ev.id);
      if (g !== null) {
        if (ev.delta < 0) await deps.battle.flash(g, msOf(cx, ui.flashMs));
        return;
      }
      deps.party.setHp(ev.id, ev.hp);
      if (ev.delta < 0) await deps.party.flash(ev.id, msOf(cx, ui.flashMs));
    },
    async mpChanged(ev, cx) {
      cx.skip = isSkip();
      deps.party.setMp(ev.id, ev.mp);
    },
    async statusChanged(ev, cx) {
      cx.skip = isSkip();
      // 敵の状態は見せない（core の message で伝わる）
      if (enemyGroupOfId(ev.id) === null) deps.party.setStatus(ev.id, ev.status, ev.on);
    },
    async sanChanged(ev, cx) {
      cx.skip = isSkip();
      deps.party.setSan(ev.id, ev.san);
    },
    async lifeChanged(ev, cx) {
      cx.skip = isSkip();
      const g = enemyGroupOfId(ev.id);
      if (g !== null) {
        if (ev.life === "dead") await deps.battle.removeOne(g, msOf(cx, ui.flashMs));
        return;
      }
      deps.party.setLife(ev.id, ev.life);
    },
    async encounter(ev, cx) {
      cx.skip = isSkip();
      deps.battle.setGroups(ev.groups);
    },
    async enemyGroups(ev, cx) {
      cx.skip = isSkip();
      deps.battle.setGroups(ev.groups);
    },
    async attack(_ev, cx) {
      // 演出なし（フラッシュは hpChanged に一本化）。文言は core の message が出す
      cx.skip = isSkip();
    },
    async spell(ev, cx) {
      cx.skip = isSkip();
      const sp = deps.data.spells.find((x) => x.id === ev.spellId);
      if (sp === undefined) return;
      const wide = sp.target === "enemyGroup" || sp.target === "allEnemies";
      if (wide && sp.effect.type === "damage") await deps.view.shake(msOf(cx, ui.shakeMs));
    },
    async dice(ev, cx) {
      cx.skip = isSkip();
      diceShown = true;
      await deps.dice.show(ev, cx.skip, msOf(cx, ui.diceStepMs));
    },
    async battleEnd(_ev, cx) {
      cx.skip = isSkip();
      hideDice();
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
        } else if (ev.kind !== "dice") {
          // UI-40: ダイスは続く message（と続けて来たダイス）の間だけ残す
          hideDice();
        }
        const h = handlers[ev.kind] as ((e: GameEvent, cx: PlayCx, s: GameState) => Promise<void>) | undefined;
        if (h !== undefined) await h(ev, cx, finalState);
      }
      hideDice();
      deps.message.setMore(false);
      deps.screens.sync(finalState);
    },
    rushAll(): void {
      rushed = true;
    },
  };
}
