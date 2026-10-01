// 戦闘のテスト用のフィクスチャ。
// - withBattle は screen "battle" と BattleState を直接組む（遭遇の乱数を通さずに小さな編成を作る）。
// - dataWith は loadFreshData の複製に config の上書きを当てる（共有の data は書き換えない）。
import { expect } from "vitest";
import type { Config, GameData, StatusId } from "../../src/core/data";
import { execute } from "../../src/core/engine";
import { cloneState } from "../../src/core/state";
import type { BattleAction, BattleOrigin, Command, GameEvent, GameState } from "../../src/core/types";
import { data, expectKnownStringKeys, loadFreshData, newGame } from "./core";

export type GroupSpec = { monsterId: string; hps: number[]; status?: StatusId[][] };

export type BattleOpts = {
  origin?: BattleOrigin;
  auto?: boolean;
  inputs?: Record<string, BattleAction>;
  /** 鑑定済みにする monsterId（既定: なし。図鑑のキーは編成の全種類に作る） */
  identified?: string[];
  round?: number;
};

/** newGame(seed) に dungeon.enter d01 を実行した state（screen "dungeon"） */
export function dived(seed = 1): GameState {
  const r = execute(newGame(seed), { type: "dungeon.enter", dungeonId: "d01" }, data);
  if (r.events[0]?.kind === "rejected") throw new Error(JSON.stringify(r.events));
  return r.state;
}

/** state を複製して、screen "battle" と BattleState を組んだもの（元の state は変えない） */
export function withBattle(state: GameState, groups: GroupSpec[], opts: BattleOpts = {}): GameState {
  const s = cloneState(state);
  s.screen = "battle";
  s.battle = {
    origin: opts.origin ?? { kind: "random", inRoom: false },
    round: opts.round ?? 0,
    partySurprise: false,
    groups: groups.map((g) => ({
      monsterId: g.monsterId,
      units: g.hps.map((hp, i) => ({ hp, hpMax: Math.max(1, hp), status: [...(g.status?.[i] ?? [])] })),
    })),
    inputs: structuredClone(opts.inputs ?? {}),
    auto: opts.auto ?? false,
    acBonus: {},
  };
  for (const g of groups) {
    if (s.bestiary[g.monsterId] === undefined) s.bestiary[g.monsterId] = { kills: 0, identified: false };
  }
  for (const id of opts.identified ?? []) s.bestiary[id] = { kills: s.bestiary[id]?.kills ?? 0, identified: true };
  return s;
}

/** loadFreshData の複製に config.combat / config.san の上書きを当て、mut でさらに書き換えたもの */
export function dataWith(
  patch: { combat?: Partial<Config["combat"]>; san?: Partial<Config["san"]> } = {},
  mut?: (d: GameData) => void,
): GameData {
  const d = loadFreshData();
  Object.assign(d.config.combat, patch.combat ?? {});
  Object.assign(d.config.san, patch.san ?? {});
  mut?.(d);
  return d;
}

/** 必中（命中率が常に 100）の上書き */
export const ALWAYS_HIT: Partial<Config["combat"]> = { hitMin: 100, hitMax: 100 };
/** 必ず外れる上書き（命中率 0） */
export const NEVER_HIT: Partial<Config["combat"]> = { hitMin: 0, hitMax: 0 };

/** execute して、文字列キーの実在を確かめる。rejected なら例外（allowReject で許す） */
export function exec(state: GameState, cmd: Command, d: GameData = data, allowReject = false) {
  const r = execute(state, cmd, d);
  expectKnownStringKeys(r.events, d);
  if (!allowReject && r.events[0]?.kind === "rejected") throw new Error(`rejected: ${JSON.stringify(r.events[0])}`);
  return r;
}

/** 全員分（行動可能な者）に同じ入力を入れた inputs */
export function allInputs(state: GameState, action: BattleAction, overrides: Record<string, BattleAction> = {}): Record<string, BattleAction> {
  const out: Record<string, BattleAction> = {};
  for (const c of state.party) out[c.id] = structuredClone(overrides[c.id] ?? action);
  return out;
}

/** events を見やすい文字列の列にする（message は key、他は kind） */
export function kindsOf(events: readonly GameEvent[]): string[] {
  return events.map((e) => (e.kind === "message" ? `message:${e.key}` : e.kind));
}

/** 指定した kind のイベントだけを取り出す */
export function eventsOf<K extends GameEvent["kind"]>(events: readonly GameEvent[], kind: K): Extract<GameEvent, { kind: K }>[] {
  return events.filter((e): e is Extract<GameEvent, { kind: K }> => e.kind === kind);
}

export function expectRejected(state: GameState, cmd: Command, reason: string, d: GameData = data): void {
  const r = execute(state, cmd, d);
  expect(r.state).toBe(state);
  expect(r.events).toEqual([{ kind: "rejected", command: cmd.type, reason }]);
}
