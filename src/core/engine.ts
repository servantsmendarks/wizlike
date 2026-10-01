// execute(state, command, data) → { state, events }（CLAUDE.md §3-2）。
// 受け付けるかの判定は複製の前に行う。rejected では state を同じ参照のまま返し、乱数も消費しない（D2）。
import type { GameData } from "./data/index";
import { createRng } from "./rng";
import { startNewGame, validatePartySetup } from "./rules/creation";
import { checkEnter, chooseOption, enterDungeon, moveForward, turn } from "./rules/dungeon";
import { cloneState, makeContext } from "./state";
import type { Command, ExecuteResult, GameState } from "./types";

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
  };
}

function reject(state: GameState, command: string, reason: string): ExecuteResult {
  return { state, events: [{ kind: "rejected", command, reason }] };
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
      return { state: ctx.state, events: ctx.events };
    }
    case "dungeon.enter": {
      const id = (command as { dungeonId?: unknown }).dungeonId;
      const r = checkEnter(state, id, data);
      if (r !== null) return reject(state, "dungeon.enter", r);
      const ctx = makeContext(cloneState(state), data);
      enterDungeon(ctx, id as string);
      return { state: ctx.state, events: ctx.events };
    }
    case "dungeon.move": {
      if (state.screen !== "dungeon" || state.dive === null) return reject(state, "dungeon.move", "not in dungeon");
      const ctx = makeContext(cloneState(state), data);
      moveForward(ctx);
      return { state: ctx.state, events: ctx.events };
    }
    case "dungeon.turn": {
      if (state.screen !== "dungeon" || state.dive === null) return reject(state, "dungeon.turn", "not in dungeon");
      const dir = (command as { dir?: unknown }).dir;
      if (dir !== "left" && dir !== "right" && dir !== "around") return reject(state, "dungeon.turn", "bad dir");
      const ctx = makeContext(cloneState(state), data);
      turn(ctx, dir);
      return { state: ctx.state, events: ctx.events };
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
      return { state: ctx.state, events: ctx.events };
    }
    case "town.enter":
    case "town.inn":
    case "town.temple":
    case "town.dark":
    case "town.shop":
    case "town.bank":
    case "town.mercy":
    case "dungeon.useItem":
    case "dungeon.cast":
    case "battle.input":
    case "battle.resolve":
    case "battle.auto":
    case "party.reorder":
      return reject(state, command.type, "not implemented");
    default:
      return reject(state, String((command as unknown as { type?: unknown }).type), "unknown command");
  }
}
