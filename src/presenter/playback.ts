// UI-41 / UI-23 / UI-43 / UI-45: GameEvent[] を順に再生する。kind ごとに 1 つのハンドラ（Promise を返す）。
// - 判定・計算・分岐はしない（§3-4）。イベントの値で表示を更新し、最後に最終の state で同期する。
// - 再生中の視点（cursor）は再生前の state.dive から作り、moved / turned / floorChanged の値で進める。
//   ビューは visibleCells(finalState, data, cursor) を描く（具体的なビューは結線側が PlayerDeps に注入する）。
// - settings().skipAnimations が真なら、フェード・フラッシュ・揺れ・ダイスの動きは 0ms、文字送りは即時で解決する（UI-41）。
//   ただし戦闘の拍の待ち（UI-45）は省かない（CLAUDE.md §3-9）。
// - 拍（UI-45 / CB-55）: beat を受けたら、直前の拍の後に message か dice が出ていれば待ってから次の拍に入る。
//   手動（beat.auto 偽）はタップ待ち（beat.waitTap、続きの三角を点滅）、オートは message.waitMs(settings().autoBeatMs)。
//   戦闘の外への screen と全滅の wipe の前でも同じ待ちをする。再生の終わりは、オートなら待ち、手動ならダイスが出ているときだけ待つ（beatWait）。
//   手動かオートかは beat.auto だけで決める（state から推測しない）。拍の外（迷宮・街）は待たない。
// - tap(): タップ待ちなら解く。拍の中なら今の拍の残りを即時にする（拍は飛ばさない）。拍の外なら UI-43
//   （1 回目は今の文の即表示、同じ再生の中の 2 回目で残りをすべて即時）。
//   拍の中で見せる残りが無い（文字送り中でなく、出ているダイスが最終の段まで描けている）ときのタップは、
//   その拍の手動の待ちのタップとして持ち越す（tapAhead。待ちの前に message / dice / penaltyTable が来たら取り消す）。
// - 全滅（UI-56）: 拍の中の wipe は、開く前に最後の拍を読ませ（上の待ち）、拍の外に出てから内訳の overlay を開く。
//   拍の外の wipe（戦闘外の全滅）も、開く前に全滅の 2d10 の箱を出したままタップを 1 回待つ。
//   全滅の 2d10（label が WIPE_DICE_KEY）の箱は、その後の message 以外のイベント（復活の lifeChanged など）でも消さず、wipe の待ちの後に消す。
//   開いた後は入力を待たずに続ける（後続の screen town でも待たない）。
//   出目の表（penaltyTable、M5.5）: 2d10 の前の hit null で表を出し、入力の UI を下げてからタップを 1 回待つ（演出スキップでも待つ。§3-9）。
//   2d10 の後の hit で当たった行を強調して描き直す（待たない）。表は 2d10 の箱と同じく wipe の前の待ちの後（と再生の終わり）に消す。
//   表の事件は message でも dice でもないが、1 回目は 2d10 の箱がまだ無く、2 回目は wipeDiceShown なので、2d10 の箱は消さない。
// - battleEnd を受けたら deps.battleEnded() で戦闘の入力の UI（ヘッダーの問い・オート解除・パーティの選択）を下げる。
//   全滅の 2d10 を受けたら deps.inputClosed() で入力の UI（迷宮のヘッダー・十字ボタンなども）を下げる。
// - レベルの変化（levelUp / levelDown）はパーティ欄の最大値と現在値を描き直す。spellLearned は何もしない（message が語る）。
// - 戦闘（UI-41 / UI-42 / UI-40）: 被弾のフラッシュは hpChanged（delta < 0）に一本化する（味方はパーティ行、敵はグループの絵）。
//   敵の id は "e{g}-{u}"（enemyGroupOfId）。敵の HP・状態は見せない（状態は core の message で伝わる）。
//   全体攻撃の揺れは、spell の呪文が target enemyGroup / allEnemies かつ effect damage のとき（data.spells を表示のためだけに引く）。
//   ダイスは dice で出し（1 件で 1 つの箱。新しい dice は前の箱を置き換える）、message と dice 以外のイベントの前と再生の終わりに消す。
//   beat はその例外で、拍の待ちの後に消す。全滅の 2d10 も例外で、wipe の前の待ちの後に消す（上の全滅）。dice を受けたら履歴に 1 行の要約（formatDiceSummary）を残す（UI-46）。
//   skip のときは flash / shake / dice / fade に 0ms を渡し、タイマーを使わない。
// - イベント（UI-55、M5）: screen{event} と、イベントから戻る screen{dungeon} ではビューをフェードしない（迷宮の画面の上の状態）。
//   eventStarted を受けたら deps.eventStarted() で迷宮の操作を下げ、actorId があれば party.markActor（演出スキップでは点滅なし）。
//   印は再生の終わり（sync の前）に外す。
//   制止の判定の箱（label が RESTRAIN_DICE_KEY、拍の外）は、続く message を 1 件（成否の語り）出した後でタップを 1 回待ってから消す
//   （先に message・dice 以外のイベントか再生の終わりが来たらそこで待つ）。演出スキップでも待つ（§3-9。手動のタップ待ち）。
//   他の拍の外の箱（dice.learn など）は待たない。
// - 街（UI-47。M8.5。M10.5 で溜める形に）: message の表示先（迷宮の窓か街の会話の箱）は結線側の deps.message が決める。
//   会話の箱は文を溜め続けてスクロールする（M10.5 追補のログ形式。拍の外のタップは message.rush に行き、文字送り中なら即表示）。
//   この再生で文を語った後の次の出来事（dice を除く）と、各 message の再生と音の前に deps.message.hold() を待つ
//   （会話の箱は、前の文の文字送りが終わるまで待つ。窓は待たない）。音（learn・levelup・文の音）が前の文の文字送りの途中に鳴らないようにする。
//   dice は語った文（「…を掴もうとしている」）と一緒に出す（判定の箱）。街では message と dice 以外の出来事と再生の終わりで消さず（keepsDice）、
//   会話の箱を閉じるときに結線側が消す（M10.5 追補: 箱を空にすることは無くなったので、次の判定の箱に置き換わるか閉じるまで残る）。制止・強化の箱のタップ待ちの後は、その文を読んだものとして待たない。
//   強化・鑑定の箱（HOLD_DICE_KEYS）で列が終わるときの待ちは、keepsDice の間は会話の箱の最後の ▼ に任せる（M10.5 の修正。タップは 1 回）。
//   screen{town} では、その前に迷宮の窓で語った文（townCarry）を screens.show に渡す。
// 具体的な views は import しない（純粋な enemyGroupOfId / formatMessage / formatDiceSummary だけ）。モジュールのトップレベルでは DOM に触れない。
import type { GameData, StatusId, Strings } from "../core/data/index";
import type { EnemyGroupView, GameEvent, GameEventKind, GameState, Life, PenaltyResult, Screen, ViewPoint } from "../core/types";
import type { Settings } from "./settings";
import { enemyGroupOfId } from "./views/battle";
import { formatDiceSummary, type DiceEvent } from "./views/dice";
import { formatMessage } from "./views/message";
import { formatPenaltyTable, type PenaltyTableText } from "./views/penalty-table";

/** screen は再生中の core の画面（before.screen から、screen イベントの値で進める。UI-55 のフェードの有無に使う） */
export type PlayCx = { cursor: ViewPoint | null; skip: boolean; screen: Screen };

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
    /** 文字送りの最中か（UI-45 の拍の中のタップで、見せる残りがあるかを見る） */
    typing(): boolean;
    /** UI-46: 履歴にだけ足す（ダイスの要約） */
    log(text: string): void;
    /**
     * UI-47 / UI-66（2026-10-06。M10.5）: この再生で語った文の後の次の出来事（dice を除く）と、各 message の、再生と音の前に呼ぶ。
     * 街の会話の箱は、前の文の文字送りが終わったら解く（talk.ts の hold。M10.5 追補のログ形式で、箱を空にするタップは無くなった）。
     * メッセージ窓は待たない。省略すると待たない
     */
    hold?(): Promise<void>;
    /**
     * UI-40 / UI-47（M10.5）: 拍の外の判定の箱を、message と dice 以外の出来事と再生の終わりで消さずに残すか（街の会話の箱は真。
     * 箱は会話の箱を閉じるときに結線側が消す）。省略すると偽
     */
    keepsDice?(): boolean;
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
    /** UI-55: 衝動の行動者の印（名前の accent 色、blink なら行の点滅）。null で外す */
    markActor(id: string | null, blink: boolean): void;
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
    /** 最終の段（結果の行まで）を描いたか（その後の結果の点滅の間も真） */
    settled(): boolean;
  };
  /** UI-45 の手動の拍のタップ待ち。省略すると createTapLatch() を使う（Player.tap() が解く） */
  beat?: TapLatch;
  /**
   * show の carry（UI-47。M8.5）は screen{town} のときだけ渡す、街に入る前に迷宮の窓で語った文（townCarry）。
   * 受けた側が会話の箱に出し直す（ログには入れ直さない）
   */
  screens: { show(to: Screen, state: GameState, carry?: readonly string[]): void; sync(state: GameState): void };
  /** UI-56 の全滅の内訳の overlay を開く（入力は待たない。閉じるのは app） */
  wipe: { show(p: PenaltyResult): void };
  /** UI-56（M5.5）の全滅の出目の表（views/penalty-table.ts）。show は描き直しも兼ねる */
  penaltyTable: { show(v: PenaltyTableText): void; hide(): void };
  /** UI-44 / UI-54: battleEnd を再生した（戦闘の入力の UI を下げる。続きの再生の間は出さない） */
  battleEnded(): void;
  /** UI-44 / UI-56: 全滅の 2d10 を出した（入力の UI を下げる。戦闘の外の全滅でも、内訳を開くまでの待ちの間は出さない） */
  inputClosed(): void;
  /** UI-55: eventStarted を再生した（十字ボタンなど迷宮の操作を下げる。続きの再生の間は出さない） */
  eventStarted(): void;
  /**
   * UI-66（M8）: 各イベントのハンドラの前（拍・全滅の待ちの後）に 1 回ずつ呼ぶ。何を鳴らすかは呼ばれた側（sound-cues.ts）が決める。
   * 演出スキップでも同じに呼ぶ。例外は console.warn にとどめて再生を続ける。省略すると無音
   */
  sound?(ev: GameEvent): void;
  /**
   * UI-66（2026-10-07）: 再生の開始に 1 回、最初の sound より前に呼ぶ（同じ拍の効果音の記録を空にする。拍の外の再生も 1 つの拍として扱う）。
   * 街の会話の箱（拍の外で message.keepsDice が真）では、さらに各 message の sound の直前にも呼ぶ（文ごとに 1 拍。未定-21）。
   * 例外は sound と同じく console.warn にとどめる
   */
  soundStart?(): void;
};

/** UI-40 / UI-56: 全滅の 2d10 の dice の label のキー。この箱は wipe（内訳を開く）まで消さない */
export const WIPE_DICE_KEY = "dice.wipe";
/** UI-40 / UI-55: 制止の判定の dice の label のキー。拍の外で出たら、続く message を 1 件出した後でタップを 1 回待ってから消す */
export const RESTRAIN_DICE_KEY = "dice.restrain";
/** UI-40 / TW-17（M7）: 強化の判定の dice の label のキー。制止の箱と同じく、拍の外で出たら続く message を 1 件出した後でタップを 1 回待つ */
export const UPGRADE_DICE_KEY = "dice.upgrade";
/** UI-40 / CH-77（M10）: 司教の鑑定の判定の dice の label のキー。強化の箱と同じく、拍の外で出たら続く message を 1 件出した後でタップを 1 回待つ */
export const IDENTIFY_DICE_KEY = "dice.identify";
/** 拍の外で出たらタップを 1 回待つ箱の label のキー */
const HOLD_DICE_KEYS: readonly string[] = [RESTRAIN_DICE_KEY, UPGRADE_DICE_KEY, IDENTIFY_DICE_KEY];

/**
 * UI-47（M8.5。純粋）: 添字 i の screen{town} の前で、最後の screen / wipe / beat より後にある message の整形済みの文。
 * 街に入る語り（帰還の dungeon.return・town.enter・救済の申し出、全滅の後の town.enter など）は screen{town} の前に迷宮の窓で語られるので、
 * 街の会話の箱に出し直すために使う。game.new のように前に message が無ければ空
 */
export function townCarry(events: readonly GameEvent[], i: number, strings: Strings): string[] {
  const out: string[] = [];
  for (let k = Math.min(i, events.length) - 1; k >= 0; k--) {
    const ev = events[k]!;
    if (ev.kind === "screen" || ev.kind === "wipe" || ev.kind === "beat") break;
    if (ev.kind === "message") out.push(formatMessage(strings[ev.key] ?? ev.key, ev.params));
  }
  return out.reverse();
}

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
  /** UI-66: 音の契機。音は付加機能なので、例外で再生を止めない */
  const sound = (ev: GameEvent): void => {
    try {
      deps.sound?.(ev);
    } catch (e) {
      console.warn("sound:", e);
    }
  };
  /** UI-66: 同じ拍の効果音の記録を空にする契機（再生の開始と、街の文ごと） */
  const soundStart = (): void => {
    try {
      deps.soundStart?.();
    } catch (e) {
      console.warn("sound:", e);
    }
  };
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
  /**
   * UI-45: 拍の中で見せる残りが無いときに受けたタップ。この拍の手動の待ちのタップとして使う。
   * 待ちの前に新しく読ませるもの（message / dice / penaltyTable）が来たら取り消す
   */
  let tapAhead = false;
  /** UI-55: この再生で衝動の行動者に印を付けたか（再生の終わりで外す） */
  let marked = false;
  /** UI-47: 今の screen{town} の前の語り（townCarry。screen ハンドラが screens.show に渡す） */
  let carry: string[] = [];

  const isSkip = (): boolean => deps.settings().skipAnimations || rushed || beatRush;
  /** UI-47（M10.5）: 拍の外で、判定の箱を会話の箱と一緒に消すか（deps.message.keepsDice） */
  const keepDice = (): boolean => mode === null && deps.message.keepsDice?.() === true;
  /** ダイスの overlay が出ているか（出ていなければ hide を呼ばない） */
  let diceShown = false;
  /** 出ている箱が全滅の 2d10 か（UI-56。wipe の待ちの後まで消さない） */
  let wipeDiceShown = false;
  const hideDice = (): void => {
    if (!diceShown) return;
    diceShown = false;
    wipeDiceShown = false;
    deps.dice.hide();
  };
  /** UI-56: 出目の表が出ているか（wipe の前の待ちの後と再生の終わりに消す） */
  let tableShown = false;
  const hideTable = (): void => {
    if (!tableShown) return;
    tableShown = false;
    deps.penaltyTable.hide();
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
        cx.screen = ev.to;
        return;
      }
      if (ev.to === "event") {
        // UI-55: イベントは迷宮の画面の上の状態。線画は同じなのでフェードしない
        deps.screens.show(ev.to, finalState);
        cx.screen = ev.to;
        return;
      }
      if (ev.to === "dungeon" && cx.screen === "event") {
        // UI-55: イベントから迷宮へ戻る。同じ線画なので描き直さず、視点だけ最終の dive に合わせる
        deps.screens.show(ev.to, finalState);
        cx.cursor = cursorOfDive(finalState);
        cx.screen = ev.to;
        return;
      }
      // UI-47: 街に入るときは、その前に迷宮の窓で語った文を渡す（会話の箱に出し直す）
      if (ev.to === "town") deps.screens.show(ev.to, finalState, carry);
      else deps.screens.show(ev.to, finalState);
      cx.screen = ev.to;
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
      wipeDiceShown = ev.label.key === WIPE_DICE_KEY;
      // UI-44 / UI-56: 全滅の 2d10 を出したら、内訳を開くまでの待ちの間は入力の UI を出さない（戦闘の内と外で同じ）
      if (wipeDiceShown) deps.inputClosed();
      deps.message.log(formatDiceSummary(ev, deps.strings));
      await deps.dice.show(ev, isSkip, msOf(cx, ui.diceStepMs));
    },
    async penaltyTable(ev, cx) {
      // UI-56: 1 回目（hit null）は表を出して入力の UI を下げ、タップを 1 回待つ（演出スキップでも待つ）。2 回目（hit）は当たった行の強調だけ
      cx.skip = isSkip();
      deps.penaltyTable.show(formatPenaltyTable(ev, deps.strings));
      tableShown = true;
      if (ev.hit !== null) return;
      deps.inputClosed();
      await waitTap();
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
      // UI-56: 内訳の overlay を開き、待たずに先へ（後続の街に入る処理は overlay の下で再生する）。
      // 拍の中で受けたときの待ちと拍の外への切り替えは play のループ（screen の leave と同じ所）でする
      cx.skip = isSkip();
      deps.wipe.show(ev.penalty);
    },
    async battleEnd(_ev, cx) {
      cx.skip = isSkip();
      hideDice();
      deps.battleEnded();
    },
    async eventStarted(ev, cx) {
      // UI-55: 迷宮の操作を下げ、衝動の行動者がいれば印を付ける（演出スキップでは点滅せず色だけ）。印は再生の終わりで外す
      cx.skip = isSkip();
      deps.eventStarted();
      if (ev.actorId !== undefined) {
        deps.party.markActor(ev.actorId, !cx.skip);
        marked = true;
      }
    },
  };

  /** UI-45: at の位置で待つ（beatWait が null なら待たない）。手動は続きの三角を点滅させてタップを待つ */
  const waitBeat = async (at: "beat" | "leave" | "end"): Promise<void> => {
    const w = beatWait({ mode, pending, diceShown, at });
    const ahead = tapAhead;
    tapAhead = false;
    if (w === "tap") {
      if (ahead) return;
      await waitTap();
    } else if (w === "timed") {
      await deps.message.waitMs(deps.settings().autoBeatMs);
    }
  };

  /** UI-45: 続きの三角を点滅させて（演出スキップでは点滅しない）タップを 1 回待つ */
  const waitTap = async (): Promise<void> => {
    deps.message.setMore(true, !deps.settings().skipAnimations);
    waitingTap = true;
    try {
      await latch.waitTap();
    } finally {
      waitingTap = false;
    }
    deps.message.setMore(false);
  };

  /** 拍の状態を拍の外に戻す */
  const leaveBeats = (): void => {
    mode = null;
    pending = false;
    beatRush = false;
    tapAhead = false;
  };

  return {
    async play(events: readonly GameEvent[], before: GameState, finalState: GameState): Promise<void> {
      rushed = false;
      taps = 0;
      marked = false;
      leaveBeats();
      soundStart();
      const cx: PlayCx = { cursor: cursorOfDive(before), skip: isSkip(), screen: before.screen };
      // 後ろに message が残っているか（続きの三角。拍の外はタップを待たずに先へ進む）
      let messagesLeft = events.filter((e) => e.kind === "message").length;
      /**
       * UI-55 / UI-40: 拍の外の制止の箱のタップ待ち。awaitMessage = 箱を出して成否の語りを待つ、
       * afterMessage = 語りを 1 件出した（次のイベントの前で待つ）
       */
      let hold: null | "awaitMessage" | "afterMessage" = null;
      /** UI-47 / UI-66: この再生で文を語り、まだその文の後の待ち（message.hold）をしていない */
      let said = false;
      try {
        for (const [idx, ev] of events.entries()) {
          if (ev.kind === "screen" && ev.to === "town") carry = townCarry(events, idx, deps.strings);
          if (hold === "afterMessage" || (hold === "awaitMessage" && ev.kind !== "message" && ev.kind !== "dice")) {
            // 制止の箱を出したまま、続く message を 1 件出した後（先に別のイベントが来たらその前）でタップを 1 回待ち、待ちの後に消す
            await waitTap();
            hideDice();
            hold = null;
            said = false;
          }
          if ((said && ev.kind !== "dice") || ev.kind === "message") {
            // UI-47 / UI-66（M10.5）: 街の会話の箱は、前の文の文字送りが終わるまで次の出来事（と音）を出さない
            said = false;
            await deps.message.hold?.();
          }
          if (ev.kind === "beat") {
            // UI-45: 次の拍の前で待ち、待った後にダイスを消してから拍に入る
            await waitBeat("beat");
            hideDice();
            sound(ev);
            mode = ev.auto ? "timed" : "tap";
            pending = false;
            beatRush = false;
            continue;
          }
          if (((ev.kind === "screen" && ev.to !== "battle") || ev.kind === "wipe") && mode !== null) {
            // 戦闘の外へ出る（勝ち・逃走は dungeon、全滅は town）前に、最後の拍を読ませる。
            // UI-56: 全滅は内訳（wipe）を開く前に待ち（窓とダイスが内訳に覆われる前）、開いた後は拍の外なので待たない
            await waitBeat("leave");
            hideDice();
            hideTable();
            leaveBeats();
          } else if (ev.kind === "wipe" && (wipeDiceShown || tableShown)) {
            // UI-56: 拍の外の全滅（戦闘外）も、全滅の 2d10 の箱（と出目の表）を出したままタップを 1 回待ってから内訳を開く
            await waitTap();
            hideDice();
            hideTable();
          }
          if (ev.kind === "message") {
            messagesLeft--;
            if (mode === null) deps.message.setMore(messagesLeft > 0);
          } else if (ev.kind !== "dice" && !wipeDiceShown && !keepDice()) {
            // UI-40: ダイスは続く message（と続けて来たダイス）の間だけ残す。
            // UI-56: 全滅の 2d10 は復活の lifeChanged / hpChanged / statusChanged などでは消さず、wipe の待ちの後に消す
            // UI-47（M10.5）: 街の会話の箱では消さない（文と一緒に出た箱は、次の判定の箱に置き換わるか、会話の箱を閉じるときに消える）
            hideDice();
          }
          if (mode !== null && (ev.kind === "message" || ev.kind === "dice")) pending = true;
          if (ev.kind === "message" || ev.kind === "dice" || ev.kind === "penaltyTable") tapAhead = false;
          const h = handlers[ev.kind] as ((e: GameEvent, cx: PlayCx, s: GameState) => Promise<void>) | undefined;
          // UI-66（未定-21。2026-10-07）: 街の会話の箱（拍の外・keepsDice）では文ごとに 1 拍。文の音の前に同じ拍の効果音の記録を空にする
          if (ev.kind === "message" && keepDice()) soundStart();
          sound(ev);
          if (h !== undefined) await h(ev, cx, finalState);
          if (ev.kind === "message") said = true;
          if (ev.kind === "dice") hold = mode === null && HOLD_DICE_KEYS.includes(ev.label.key) ? "awaitMessage" : null;
          else if (ev.kind === "message" && hold === "awaitMessage") hold = "afterMessage";
        }
        if (hold !== null) {
          // 制止の箱で列が終わる（または成否の語りが最後の文）なら、再生の終わりで待つ。
          // UI-47（M10.5）: 会話の箱に語る間（keepsDice。街の強化・鑑定）は、この待ちを会話の箱の最後の ▼ に任せる
          // （見た目が同じ ▼ のタップが 2 回続かないように。閉じるタップの cleared で判定の箱が消える）
          if (!keepDice()) {
            await waitTap();
            hideDice();
          }
          hold = null;
        }
        await waitBeat("end");
      } finally {
        leaveBeats();
      }
      if (!keepDice()) hideDice();
      hideTable();
      deps.message.setMore(false);
      if (marked) {
        deps.party.markActor(null, false);
        marked = false;
      }
      deps.screens.sync(finalState);
    },
    tap(): void {
      if (waitingTap) {
        latch.release();
        return;
      }
      if (mode !== null) {
        // 拍の中: 今の拍の残りを即時にする（拍は飛ばさない）。
        // 見せる残り（文字送り中の文・最終の段の前のダイス）が無ければ、このタップをこの拍の待ちのタップとして持ち越す
        tapAhead = !deps.message.typing() && (!diceShown || deps.dice.settled());
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
