// UI-41 / UI-23 / UI-43 / UI-45: GameEvent[] を順に再生する。kind ごとに 1 つのハンドラ（Promise を返す）。
// - 判定・計算・分岐はしない（§3-4）。イベントの値で表示を更新し、最後に最終の state で同期する。
// - 再生中の視点（cursor）は再生前の state.dive から作り、moved / turned / floorChanged の値で進める。
//   ビューは visibleCells(finalState, data, cursor) を描く（具体的なビューは結線側が PlayerDeps に注入する）。
// - settings().skipAnimations が真なら、フェード・フラッシュ・揺れ・ダイスの動きは 0ms、文字送りは即時で解決する（UI-41）。
//   ただし戦闘の拍の待ち（UI-45）は省かない（CLAUDE.md §3-9 との衝突は decisions の「衝突(M4.5)」）。
// - 拍（UI-45 / CB-55）: beat を受けたら、直前の拍の後に message か dice が出ていれば待ってから次の拍に入る。
//   手動（beat.auto 偽）はタップ待ち（beat.waitTap、続きの三角を点滅）、オートは message.waitMs(settings().autoBeatMs)。
//   戦闘の外への screen の前でも同じ待ちをする。再生の終わりは、オートなら待ち、手動ならダイスが出ているときだけ待つ（beatWait）。
//   手動かオートかは beat.auto だけで決める（state から推測しない）。拍の外（迷宮・街）は待たない。
// - tap(): タップ待ちなら解く。拍の中なら今の拍の残りを即時にする（拍は飛ばさない）。拍の外なら UI-43
//   （1 回目は今の文の即表示、同じ再生の中の 2 回目で残りをすべて即時）。
// - 全滅（UI-56）: wipe で内訳の overlay を開き、入力を待たずに続ける。
// - レベルの変化（levelUp / levelDown）はパーティ欄の最大値と現在値を描き直す。spellLearned は何もしない（message が語る）。
// - 戦闘（UI-41 / UI-42 / UI-40）: 被弾のフラッシュは hpChanged（delta < 0）に一本化する（味方はパーティ行、敵はグループの絵）。
//   敵の id は "e{g}-{u}"（enemyGroupOfId）。敵の HP・状態は見せない（状態は core の message で伝わる）。
//   全体攻撃の揺れは、spell の呪文が target enemyGroup / allEnemies かつ effect damage のとき（data.spells を表示のためだけに引く）。
//   ダイスは dice で出し（1 件で 1 つの箱。新しい dice は前の箱を置き換える）、message と dice 以外のイベントの前と再生の終わりに消す。
//   beat はその例外で、拍の待ちの後に消す。dice を受けたら履歴に 1 行の要約（formatDiceSummary）を残す（UI-46）。
//   skip のときは flash / shake / dice / fade に 0ms を渡し、タイマーを使わない。
// 具体的な views は import しない（純粋な enemyGroupOfId / formatMessage / formatDiceSummary だけ）。モジュールのトップレベルでは DOM に触れない。
import type { GameData, StatusId, Strings } from "../core/data/index";
import type { EnemyGroupView, GameEvent, GameEventKind, GameState, Life, PenaltyResult, Screen, ViewPoint } from "../core/types";
import type { Settings } from "./settings";
import { enemyGroupOfId } from "./views/battle";
import { formatDiceSummary, type DiceEvent } from "./views/dice";
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
  message: {
    say(text: string, instant: boolean): Promise<void>;
    /** 続きの三角。blink は UI-45 のタップ待ちの点滅 */
    setMore(on: boolean, blink?: boolean): void;
    /** 文字送り中の文を即表示する（UI-43 / UI-45 のタップ） */
    rush(): void;
    /** UI-46: 履歴にだけ足す（ダイスの要約） */
    log(text: string): void;
    /** UI-45: オートの拍の待ち（WAAPI の animation.finished で測る） */
    waitMs(ms: number): Promise<void>;
  };
  party: {
    setHp(id: string, hp: number): void;
    setSan(id: string, san: number): void;
    setLife(id: string, life: Life): void;
    setMp(id: string, mp: number): void;
    /** levelUp / levelDown の最大値（続けて setHp / setMp で現在値） */
    setMax(id: string, hpMax: number, mpMax: number): void;
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
  /** UI-40 のダイス表示（views/dice.ts）。skip は段ごとに読み直す（途中のタップで残りを即時にする） */
  dice: {
    show(ev: DiceEvent, skip: () => boolean, stepMs: number): Promise<void>;
    hide(): void;
  };
  /** UI-45 の手動の拍のタップ待ち。省略すると createTapLatch() を使う（Player.tap() が解く） */
  beat?: TapLatch;
  screens: { show(to: Screen, state: GameState): void; sync(state: GameState): void };
  /** UI-56 の全滅の内訳の overlay を開く（入力は待たない。閉じるのは app） */
  wipe: { show(p: PenaltyResult): void };
};

export type Handlers = {
  [K in GameEventKind]?: (ev: Extract<GameEvent, { kind: K }>, cx: PlayCx, finalState: GameState) => Promise<void>;
};

export type Player = {
  play(events: readonly GameEvent[], before: GameState, finalState: GameState): Promise<void>;
  /** タップ待ちなら解く。拍の中なら今の拍の残りを即時にする。拍の外なら UI-43（1 回目で今の文、2 回目で残りすべて） */
  tap(): void;
};

/** UI-45: 拍の待ち方。tap = 手動（タップ待ち）、timed = オート（autoBeatMs） */
export type BeatMode = "tap" | "timed";

/**
 * UI-45（純粋）: 待つかどうかと待ち方。at は beat（次の拍の前）・leave（戦闘の外への screen の前）・end（再生の終わり）。
 * 拍の中（mode 非 null）で、直前の拍の後に message か dice が出ていれば（pending）待つ。
 * ただし再生の終わりの手動は、ダイスが出ているときだけ待つ（遭遇の先手判定を読ませる）
 */
export function beatWait(o: { mode: BeatMode | null; pending: boolean; diceShown: boolean; at: "beat" | "leave" | "end" }): BeatMode | null {
  if (o.mode === null || !o.pending) return null;
  if (o.at === "end" && o.mode === "tap" && !o.diceShown) return null;
  return o.mode;
}

/** UI-45: タップ待ちの掛け金。waitTap の Promise は次の release で解決する（待っていない間の release は何もしない） */
export type TapLatch = { waitTap(): Promise<void>; release(): void };

export function createTapLatch(): TapLatch {
  let resolve: (() => void) | null = null;
  return {
    waitTap(): Promise<void> {
      // 前の待ちが残っていれば解いてから（同時に 2 つは待たない）
      resolve?.();
      return new Promise<void>((r) => {
        resolve = r;
      });
    },
    release(): void {
      const r = resolve;
      resolve = null;
      r?.();
    },
  };
}

function cursorOfDive(state: GameState): ViewPoint | null {
  const d = state.dive;
  return d === null ? null : { floor: d.floor, pos: { x: d.pos.x, y: d.pos.y }, facing: d.facing };
}

function copyCursor(c: ViewPoint): ViewPoint {
  return { floor: c.floor, pos: { x: c.pos.x, y: c.pos.y }, facing: c.facing };
}

export function createPlayer(deps: PlayerDeps): Player {
  const latch = deps.beat ?? createTapLatch();
  /** UI-43: 拍の外の 2 回目のタップで、同じ再生の残りをすべて即時にする */
  let rushed = false;
  /** 同じ再生の中の拍の外のタップの回数 */
  let taps = 0;
  /** UI-45: 今の拍の待ち方（拍の外なら null） */
  let mode: BeatMode | null = null;
  /** 直前の拍の後に message か dice が出たか */
  let pending = false;
  /** 拍の中のタップで、今の拍の残りを即時にする */
  let beatRush = false;
  /** タップ待ちの最中か */
  let waitingTap = false;

  const isSkip = (): boolean => deps.settings().skipAnimations || rushed || beatRush;
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
      deps.message.log(formatDiceSummary(ev, deps.strings));
      await deps.dice.show(ev, isSkip, msOf(cx, ui.diceStepMs));
    },
    async levelUp(ev, cx) {
      cx.skip = isSkip();
      deps.party.setMax(ev.id, ev.hpMax, ev.mpMax);
      deps.party.setHp(ev.id, ev.hp);
      deps.party.setMp(ev.id, ev.mp);
    },
    async levelDown(ev, cx) {
      cx.skip = isSkip();
      deps.party.setMax(ev.id, ev.hpMax, ev.mpMax);
      deps.party.setHp(ev.id, ev.hp);
      deps.party.setMp(ev.id, ev.mp);
    },
    async spellLearned(_ev, cx) {
      // 何もしない（覚えたことは core の message が語る）
      cx.skip = isSkip();
    },
    async wipe(ev, cx) {
      // UI-56: 内訳の overlay を開き、待たずに先へ（後続の街に入る処理は overlay の下で再生する）
      cx.skip = isSkip();
      deps.wipe.show(ev.penalty);
    },
    async battleEnd(_ev, cx) {
      cx.skip = isSkip();
      hideDice();
    },
  };

  /** UI-45: at の位置で待つ（beatWait が null なら待たない）。手動は続きの三角を点滅させてタップを待つ */
  const waitBeat = async (at: "beat" | "leave" | "end"): Promise<void> => {
    const w = beatWait({ mode, pending, diceShown, at });
    if (w === "tap") {
      deps.message.setMore(true, !deps.settings().skipAnimations);
      waitingTap = true;
      try {
        await latch.waitTap();
      } finally {
        waitingTap = false;
      }
      deps.message.setMore(false);
    } else if (w === "timed") {
      await deps.message.waitMs(deps.settings().autoBeatMs);
    }
  };

  /** 拍の状態を拍の外に戻す */
  const leaveBeats = (): void => {
    mode = null;
    pending = false;
    beatRush = false;
  };

  return {
    async play(events: readonly GameEvent[], before: GameState, finalState: GameState): Promise<void> {
      rushed = false;
      taps = 0;
      leaveBeats();
      const cx: PlayCx = { cursor: cursorOfDive(before), skip: isSkip() };
      // 後ろに message が残っているか（続きの三角。拍の外はタップを待たずに先へ進む）
      let messagesLeft = events.filter((e) => e.kind === "message").length;
      try {
        for (const ev of events) {
          if (ev.kind === "beat") {
            // UI-45: 次の拍の前で待ち、待った後にダイスを消してから拍に入る
            await waitBeat("beat");
            hideDice();
            mode = ev.auto ? "timed" : "tap";
            pending = false;
            beatRush = false;
            continue;
          }
          if (ev.kind === "screen" && ev.to !== "battle" && mode !== null) {
            // 戦闘の外へ出る（勝ち・逃走は dungeon、全滅は town）前に、最後の拍を読ませる
            await waitBeat("leave");
            hideDice();
            leaveBeats();
          }
          if (ev.kind === "message") {
            messagesLeft--;
            if (mode === null) deps.message.setMore(messagesLeft > 0);
          } else if (ev.kind !== "dice") {
            // UI-40: ダイスは続く message（と続けて来たダイス）の間だけ残す
            hideDice();
          }
          if (mode !== null && (ev.kind === "message" || ev.kind === "dice")) pending = true;
          const h = handlers[ev.kind] as ((e: GameEvent, cx: PlayCx, s: GameState) => Promise<void>) | undefined;
          if (h !== undefined) await h(ev, cx, finalState);
        }
        await waitBeat("end");
      } finally {
        leaveBeats();
      }
      hideDice();
      deps.message.setMore(false);
      deps.screens.sync(finalState);
    },
    tap(): void {
      if (waitingTap) {
        latch.release();
        return;
      }
      if (mode !== null) {
        // 拍の中: 今の拍の残りを即時にする（拍は飛ばさない）
        beatRush = true;
        deps.message.rush();
        return;
      }
      // 拍の外: UI-43
      taps++;
      if (taps >= 2) rushed = true;
      deps.message.rush();
    },
  };
}
