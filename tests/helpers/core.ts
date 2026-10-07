// core のテスト用の共通フィクスチャ。
// - data は実データを loadGameData に通したもの。loadGameData は freeze もコピーもしないので、テストで data を書き換えないこと。
//   書き換えや freeze が要るテストは loadFreshData() で別のコピーを作る。
import { expect } from "vitest";
import config from "../../data/config.json";
import races from "../../data/races.json";
import classes from "../../data/classes.json";
import spells from "../../data/spells.json";
import monsters from "../../data/monsters.json";
import unknownKinds from "../../data/unknown-kinds.json";
import items from "../../data/items.json";
import equipmentBases from "../../data/equipment-bases.json";
import itemOptions from "../../data/item-options.json";
import uniques from "../../data/uniques.json";
import drops from "../../data/drops.json";
import personalities from "../../data/personalities.json";
import penaltyTable from "../../data/penalty-table.json";
import dungeons from "../../data/dungeons.json";
import events from "../../data/events.json";
import tavern from "../../data/tavern.json";
import chestTraps from "../../data/chest-traps.json";
import rivalries from "../../data/rivalries.json";
import strings from "../../data/strings.json";
import wavetables from "../../data/wavetables.json";
import audio from "../../data/audio.json";
import { EQUIP_SLOTS, loadGameData, type GameData, type PersonalityId } from "../../src/core/data";
import { createInitialState, execute } from "../../src/core/engine";
import { createRng, randInt, rollDice, type RngState } from "../../src/core/rng";
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
      unknownKinds,
      items,
      equipmentBases,
      itemOptions,
      uniques,
      drops,
      personalities,
      penaltyTable,
      dungeons,
      events,
      tavern,
      chestTraps,
      rivalries,
      strings,
      wavetables,
      audio,
    }),
  );
}

/** 共有の実データ。書き換えないこと。 */
export const data: GameData = loadFreshData();

/**
 * CH-64 のルールのテスト（レベルの上げ下げの手計算・鏡の rng）で使う expBase。実データの config.growth.expBase は調整値【仮】なので、
 * ルールのテストはこの値に固定したデータ（loadRuleData）で書き、調整のたびに期待値を作り直さないようにする。
 */
export const RULE_EXP_BASE = 1000;

/** loadFreshData に config.growth.expBase = RULE_EXP_BASE を当てたもの（独立したコピー） */
export function loadRuleData(): GameData {
  const d = loadFreshData();
  d.config.growth.expBase = RULE_EXP_BASE;
  return d;
}

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

/** events に出てくる文字列キー（message の key、dice の label → rows[].label → rule → result の key）を、出てきた順に返す。 */
export function stringKeysOf(events: readonly GameEvent[]): string[] {
  const keys: string[] = [];
  for (const e of events) {
    if (e.kind === "message") keys.push(e.key);
    else if (e.kind === "dice") keys.push(e.label.key, ...e.rows.map((r) => r.label.key), e.rule.key, e.result.key);
  }
  return keys;
}

/** events の message の key と dice の各 TextRef の key が、すべて data.strings に実在することを確かめる。 */
export function expectKnownStringKeys(events: readonly GameEvent[], d: GameData = data): void {
  const unknown = stringKeysOf(events).filter((k) => !Object.prototype.hasOwnProperty.call(d.strings, k));
  expect(unknown, "message key / dice key not found in data/strings.json").toEqual([]);
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

/**
 * GameState の不変条件（M4。M7 で倉庫と買い戻しを足した）。
 * - state.items の各実体は、party の equipment / inventory・warehouse・buyback のどこか 1 か所からちょうど 1 回参照され、参照先はすべて実在する
 * - buyback の実体はユニーク（uniqueId が非 null）で鑑定済み（IT-63）
 * - dive が非 null なら潜行台帳の品は所持品の部分集合
 * - screen town ⇔ townVisit 非 null、screen battle ⇔ battle 非 null、dive null ⇔ screen が title / town
 * - screen event ⇔ pendingChoice の kind が event（M5。A4）
 * - dive.chest が非 null なら pendingChoice null、screen は dungeon か battle（M11。CB-60）
 * - gold は 0 以上の整数、各人の levelHistory.length === level − 1、各人の maxLevelReached[classId] ≥ level（CH-63）
 * - JSON 往復で変わらない（CLAUDE.md §3-11）
 */
export function expectStateInvariants(state: GameState): void {
  const refs: string[] = [];
  for (const ch of state.party) {
    for (const slot of EQUIP_SLOTS) {
      const id = ch.equipment[slot];
      if (id !== null) refs.push(id);
    }
    refs.push(...ch.inventory);
  }
  refs.push(...state.warehouse, ...state.buyback);
  expect([...refs].sort(), "item references").toEqual(Object.keys(state.items).sort());
  for (const id of state.buyback) {
    const inst = state.items[id];
    expect(inst !== undefined && inst.uniqueId !== null && inst.identified, `buyback ${id} is an identified unique (IT-63)`).toBe(true);
  }
  if (state.dive !== null) {
    for (const id of state.dive.ledger.items) expect(refs, `ledger item ${id} is owned`).toContain(id);
  }
  expect(state.screen === "town", "screen town ⇔ townVisit").toBe(state.townVisit !== null);
  expect(state.screen === "battle", "screen battle ⇔ battle").toBe(state.battle !== null);
  expect(state.screen === "event", "screen event ⇔ pendingChoice kind event").toBe(state.pendingChoice?.kind === "event");
  expect(state.dive === null, "dive null ⇔ screen title / town").toBe(state.screen === "title" || state.screen === "town");
  // CB-60（M11）: 宝箱があれば保留の選択は無く、画面は迷宮か（警報の）戦闘
  if (state.dive !== null && state.dive.chest !== null) {
    expect(state.pendingChoice, "chest ⇒ pendingChoice null").toBeNull();
    expect(state.screen === "dungeon" || state.screen === "battle", `chest ⇒ screen dungeon / battle (${state.screen})`).toBe(true);
  }
  expect(Number.isInteger(state.gold) && state.gold >= 0, `gold ${state.gold}`).toBe(true);
  if (state.screen === "title") expect(state.morale, "morale is null on title (TW-15)").toBeNull();
  for (const ch of state.party) expect(ch.levelHistory, `levelHistory of ${ch.id}`).toHaveLength(ch.level - 1);
  // CH-63（SV-04 v5）: maxLevelReached は職業ごとの記録で、今の職業の欄は level 以上
  for (const ch of state.party) expect(ch.maxLevelReached[ch.classId] ?? 0, `maxLevelReached of ${ch.id}`).toBeGreaterThanOrEqual(ch.level);
  expect(JSON.parse(JSON.stringify(state))).toStrictEqual(state);
}

/** 最初の randInt(1, 100) が pred を満たす最小のシード（鏡の rng で探す） */
export function seedWithFirstD100(pred: (roll: number) => boolean): { seed: number; roll: number } {
  for (let k = 1; k < 100000; k++) {
    const roll = randInt(createRng(k), 1, 100);
    if (pred(roll)) return { seed: k, roll };
  }
  throw new Error("no seed");
}

/** M5 の mut: 全性格の benefits.initiative / damage を 0 にする（CB-11 / CB-22 の恩恵を外して鏡や行動順を見る） */
export function noBenefits(d: GameData): void {
  for (const p of d.personalities) {
    p.benefits.initiative = 0;
    p.benefits.damage = 0;
  }
}

/** M5 の mut: 全性格の benefits.ambushAvoid を 0 にする（CB-04 の敵の奇襲の取り消しで d100 を引かない） */
export function noAmbushAvoid(d: GameData): void {
  for (const p of d.personalities) p.benefits.ambushAvoid = 0;
}

/** M5 の mut: CB-45 の置き換えを止める（uneasyChance / confusedChance と全性格の disobeyBelowHalf を 0。確率 0 なら乱数も引かない） */
export function noSanOverride(d: GameData): void {
  d.config.san.uneasyChance = 0;
  d.config.san.confusedChance = 0;
  for (const p of d.personalities) p.san.disobeyBelowHalf = 0;
}

/** M5 の mut: 全性格の benefits.trapDetect を 0 にする（DG-21 の罠の察知で d100 を引かない） */
export function noTrapDetect(d: GameData): void {
  for (const p of d.personalities) p.benefits.trapDetect = 0;
}
