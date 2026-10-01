// execute(state, command, data) → { state, events }（CLAUDE.md §3-2）。
// 受け付けるかの判定は複製の前に行う。rejected では state を同じ参照のまま返し、乱数も消費しない（D2）。
import type { GameData } from "./data/index";
import { createRng } from "./rng";
import {
  applyBattleInput,
  checkBattleAuto,
  checkBattleInput,
  checkFlee,
  checkRepeat,
  checkResolve,
  fleeRound,
  repeatRound,
  resolveRound,
  setAuto,
} from "./rules/combat";
import { startNewGame, validatePartySetup } from "./rules/creation";
import { checkEnter, chooseOption, enterDungeon, moveForward, turn } from "./rules/dungeon";
import { checkUseItem, useItemInField } from "./rules/items";
import { checkInn, checkMercy, checkTemple, grantMercy, stayInn, templeService } from "./rules/town";
import type { TempleService } from "./rules/town";
import { cloneState, makeContext } from "./state";
import type { BattleAction, Command, ExecuteResult, GameState, RuleContext } from "./types";

/** ゲーム開始前の状態（D3）。整数でない seed は createRng の RangeError をそのまま投げる。 */
export function createInitialState(seed: number, _data: GameData): GameState {
  return {
    screen: "title",
    rng: createRng(seed),
    party: [],
    items: {},
    nextItemSeq: 1,
    gold: 0,
    bank: 0,
    progress: { unlockedDungeons: [], clearedDungeons: [] },
    dive: null,
    pendingChoice: null,
    battle: null,
    bestiary: {},
    townVisit: null,
  };
}

function reject(state: GameState, command: string, reason: string): ExecuteResult {
  return { state, events: [{ kind: "rejected", command, reason }] };
}

/**
 * 受け付けたコマンドの共通の後処理（受け付けた全コマンドの最後に通す）。
 * C5 で迷宮の戦闘外の全滅判定（wipeIfNoneCanAct）をここに足す（迷宮外・戦闘中は何もしない）。
 */
function finish(ctx: RuleContext): ExecuteResult {
  return { state: ctx.state, events: ctx.events };
}

export function execute(state: GameState, command: Command, data: GameData): ExecuteResult {
  const raw = command as unknown;
  if (typeof raw !== "object" || raw === null || typeof (raw as { type?: unknown }).type !== "string") {
    return reject(state, "unknown", "malformed command");
  }
  // E3: 保留中の選択があれば event.choose 以外は受け付けない
  if (state.pendingChoice !== null && command.type !== "event.choose") {
    return reject(state, command.type, "choice pending");
  }
  switch (command.type) {
    case "game.new": {
      if (state.screen !== "title") return reject(state, "game.new", "wrong screen");
      if (state.party.length !== 0) return reject(state, "game.new", "game already started");
      const r = validatePartySetup((command as { party?: unknown }).party, data);
      if (r !== null) return reject(state, "game.new", r);
      const ctx = makeContext(cloneState(state), data);
      startNewGame(ctx, command.party);
      return finish(ctx);
    }
    case "dungeon.enter": {
      const id = (command as { dungeonId?: unknown }).dungeonId;
      const r = checkEnter(state, id, data);
      if (r !== null) return reject(state, "dungeon.enter", r);
      const ctx = makeContext(cloneState(state), data);
      enterDungeon(ctx, id as string);
      return finish(ctx);
    }
    case "dungeon.move": {
      if (state.screen !== "dungeon" || state.dive === null) return reject(state, "dungeon.move", "not in dungeon");
      const ctx = makeContext(cloneState(state), data);
      moveForward(ctx);
      return finish(ctx);
    }
    case "dungeon.turn": {
      if (state.screen !== "dungeon" || state.dive === null) return reject(state, "dungeon.turn", "not in dungeon");
      const dir = (command as { dir?: unknown }).dir;
      if (dir !== "left" && dir !== "right" && dir !== "around") return reject(state, "dungeon.turn", "bad dir");
      const ctx = makeContext(cloneState(state), data);
      turn(ctx, dir);
      return finish(ctx);
    }
    case "dungeon.useItem": {
      const c = command as { memberId?: unknown; itemId?: unknown; targetId?: unknown };
      const r = checkUseItem(state, data, c.memberId, c.itemId, c.targetId);
      if (r !== null) return reject(state, "dungeon.useItem", r);
      const ctx = makeContext(cloneState(state), data);
      useItemInField(ctx, c.memberId as string, c.itemId as string, typeof c.targetId === "string" ? c.targetId : null);
      return finish(ctx);
    }
    case "event.choose": {
      const pc = state.pendingChoice;
      if (pc === null) return reject(state, "event.choose", "no pending choice");
      const optionId = (command as { optionId?: unknown }).optionId;
      if (typeof optionId !== "string" || !pc.options.some((o) => o.id === optionId)) {
        return reject(state, "event.choose", "unknown option");
      }
      const ctx = makeContext(cloneState(state), data);
      chooseOption(ctx, optionId);
      return finish(ctx);
    }
    case "battle.input": {
      if (state.screen !== "battle" || state.battle === null) return reject(state, "battle.input", "not in battle");
      const c = command as { memberId?: unknown; action?: unknown };
      const r = checkBattleInput(state, data, c.memberId, c.action);
      if (r !== null) return reject(state, "battle.input", r);
      const ctx = makeContext(cloneState(state), data);
      applyBattleInput(ctx, c.memberId as string, c.action as BattleAction);
      return finish(ctx);
    }
    case "battle.resolve": {
      if (state.screen !== "battle" || state.battle === null) return reject(state, "battle.resolve", "not in battle");
      const r = checkResolve(state, data);
      if (r !== null) return reject(state, "battle.resolve", r);
      const ctx = makeContext(cloneState(state), data);
      resolveRound(ctx);
      return finish(ctx);
    }
    case "battle.auto": {
      if (state.screen !== "battle" || state.battle === null) return reject(state, "battle.auto", "not in battle");
      const on = (command as { on?: unknown }).on;
      const r = checkBattleAuto(state, on);
      if (r !== null) return reject(state, "battle.auto", r);
      const ctx = makeContext(cloneState(state), data);
      setAuto(ctx, on as boolean);
      return finish(ctx);
    }
    case "battle.flee": {
      if (state.screen !== "battle" || state.battle === null) return reject(state, "battle.flee", "not in battle");
      const r = checkFlee(state);
      if (r !== null) return reject(state, "battle.flee", r);
      const ctx = makeContext(cloneState(state), data);
      fleeRound(ctx);
      return finish(ctx);
    }
    case "battle.repeat": {
      if (state.screen !== "battle" || state.battle === null) return reject(state, "battle.repeat", "not in battle");
      const r = checkRepeat(state);
      if (r !== null) return reject(state, "battle.repeat", r);
      const ctx = makeContext(cloneState(state), data);
      repeatRound(ctx);
      return finish(ctx);
    }
    case "town.enter":
      // TW-02/TW-26: 街に入る処理は帰還と全滅だけが内部で行う（来訪を作り直すと救済を何度でも引けるため）
      return reject(state, "town.enter", "internal command");
    case "town.inn": {
      const rank = (command as { rank?: unknown }).rank;
      const r = checkInn(state, rank, data);
      if (r !== null) return reject(state, "town.inn", r);
      const ctx = makeContext(cloneState(state), data);
      stayInn(ctx, rank as number);
      return finish(ctx);
    }
    case "town.temple": {
      const c = command as { memberId?: unknown; service?: unknown };
      const r = checkTemple(state, c.memberId, c.service, data);
      if (r !== null) return reject(state, "town.temple", r);
      const ctx = makeContext(cloneState(state), data);
      templeService(ctx, c.memberId as string, c.service as TempleService);
      return finish(ctx);
    }
    case "town.mercy": {
      const memberId = (command as { memberId?: unknown }).memberId;
      const r = checkMercy(state, memberId);
      if (r !== null) return reject(state, "town.mercy", r);
      const ctx = makeContext(cloneState(state), data);
      grantMercy(ctx, memberId as string);
      return finish(ctx);
    }
    case "town.dark":
    case "town.shop":
    case "town.bank":
    case "dungeon.cast":
    case "party.reorder":
      return reject(state, command.type, "not implemented");
    default:
      return reject(state, String((command as unknown as { type?: unknown }).type), "unknown command");
  }
}
