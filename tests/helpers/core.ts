// core のテスト用の共通フィクスチャ。
// - data は実データを loadGameData に通したもの。loadGameData は freeze もコピーもしないので、テストで data を書き換えないこと。
//   書き換えや freeze が要るテストは loadFreshData() で別のコピーを作る。
import { expect } from "vitest";
import config from "../../data/config.json";
import races from "../../data/races.json";
import classes from "../../data/classes.json";
import spells from "../../data/spells.json";
import monsters from "../../data/monsters.json";
import items from "../../data/items.json";
import personalities from "../../data/personalities.json";
import penaltyTable from "../../data/penalty-table.json";
import dungeons from "../../data/dungeons.json";
import events from "../../data/events.json";
import strings from "../../data/strings.json";
import { loadGameData, type GameData, type PersonalityId } from "../../src/core/data";
import { createInitialState, execute } from "../../src/core/engine";
import { randInt, rollDice, type RngState } from "../../src/core/rng";
import { cloneState, makeContext } from "../../src/core/state";
import type { Character, GameEvent, GameState, PartySetupMember, RuleContext } from "../../src/core/types";

/** 実データの独立したコピーを loadGameData に通して返す。 */
export function loadFreshData(): GameData {
  return loadGameData(
    structuredClone({
      config,
      races,
      classes,
      spells,
      monsters,
      items,
      personalities,
      penaltyTable,
      dungeons,
      events,
      strings,
    }),
  );
}

/** 共有の実データ。書き換えないこと。 */
export const data: GameData = loadFreshData();

/** newGame の既定の性格（添字順。リーダーは null。乱数を使わないように "random" は含めない）。 */
export const DEFAULT_PERSONALITIES: readonly (PersonalityId | null)[] = [
  null,
  "cautious",
  "reckless",
  "greedy",
  "normal",
  "cautious",
];

/** 既定の PartySetup.members（名前は prototypeParty の defaultName、性格は DEFAULT_PERSONALITIES）。 */
export function defaultMembers(): PartySetupMember[] {
  return data.config.prototypeParty.members.map((m, i) => ({
    name: m.defaultName,
    personality: DEFAULT_PERSONALITIES[i] ?? null,
  }));
}

/**
 * createInitialState(seed) に game.new を実行した state（screen "town"）。
 * members を省くと defaultMembers()（乱数を消費しない）。rejected になったら例外を投げる。
 */
export function newGame(seed: number, members: PartySetupMember[] = defaultMembers()): GameState {
  const r = execute(createInitialState(seed, data), { type: "game.new", party: { members } }, data);
  const rej = r.events.find((e) => e.kind === "rejected");
  if (rej !== undefined) throw new Error(`newGame: game.new rejected: ${JSON.stringify(rej)}`);
  return r.state;
}

/** makeContext(cloneState(state), data)。返る ctx.state は state と参照を共有しない。 */
export function ctxFor(state: GameState): RuleContext {
  return makeContext(cloneState(state), data);
}

/** 再帰的に Object.freeze して同じ値を返す。 */
export function deepFreeze<T>(x: T): T {
  if (typeof x === "object" && x !== null && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x as object)) deepFreeze(v);
  }
  return x;
}

/** state を複製し、party[idx] に patch を浅くマージした新しい state を返す（元の state は変えない）。 */
export function withChar(state: GameState, idx: number, patch: Partial<Character>): GameState {
  const s = cloneState(state);
  const ch = s.party[idx];
  if (ch === undefined) throw new Error(`withChar: no party member at ${idx}`);
  s.party[idx] = { ...ch, ...structuredClone(patch) };
  return s;
}

/** events に出てくる文字列キー（message の key、dice の label）を、出てきた順に返す。 */
export function stringKeysOf(events: readonly GameEvent[]): string[] {
  const keys: string[] = [];
  for (const e of events) {
    if (e.kind === "message") keys.push(e.key);
    else if (e.kind === "dice") keys.push(e.label);
  }
  return keys;
}

/** events の message の key と dice の label が、すべて data.strings に実在することを確かめる。 */
export function expectKnownStringKeys(events: readonly GameEvent[], d: GameData = data): void {
  const unknown = stringKeysOf(events).filter((k) => !Object.prototype.hasOwnProperty.call(d.strings, k));
  expect(unknown, "message key / dice label not found in data/strings.json").toEqual([]);
}

/**
 * 全滅処理（TW-22）の乱数を鏡の rng で進める: 2d10 → 失う品 1 個ごとに randInt(0, 候補数 − 1)。2d10 の合計を返す。
 * 前提: 台帳が空で、非装備の所持品が unequipped 個あり、帯の itemLoss 以上（候補は非装備だけで、1 個失うごとに 1 減る）。
 * 既定の一行（newGame）の非装備は 5 個（薬草 3・解毒草・帰還の糸）で、itemLoss は最大 3。
 */
export function mirrorWipeRolls(m: RngState, unequipped: number, d: GameData = data): number {
  const r = rollDice(m, d.penaltyTable.dice);
  const band = d.penaltyTable.bands.find((b) => b.min <= r.total && r.total <= b.max);
  if (band === undefined) throw new Error(`mirrorWipeRolls: no band for ${r.total}`);
  if (unequipped < band.itemLoss) throw new Error("mirrorWipeRolls: not enough unequipped items for this helper");
  for (let k = 0; k < band.itemLoss; k++) randInt(m, 0, unequipped - 1 - k);
  return r.total;
}
