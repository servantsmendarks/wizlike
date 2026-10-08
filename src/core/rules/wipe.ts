// 全滅処理（TW-20〜26、DG-42、CH-41/62、MG-03）と、迷宮の戦闘外の全滅判定、TW-27 の総資産。
// combat.ts（戦闘の全滅）と engine.ts（受け付けたコマンドの後処理）から呼ぶ。combat.ts と dungeon.ts は import しない。
// 乱数の消費順: 2d10（penaltyTable.dice を rollDice で 1 回）→ 失う品 1 個ごとに randInt(0, 候補数 − 1) を 1 回（候補 1 個でも引く）。
// イベントの順: wipe.intro → 台帳（wipe.ledgerLost を 1 回。失った金 0・品 0 なら代わりに wipe.ledgerNone）→ penaltyTable{hit null} → dice{dice.wipe}
//   → penaltyTable{hit 帯}（UI-56。M5.5）→ 帯の text → 金 → 品 → EXP とレベルダウン
//   → 復活 → wipe{penalty} → arriveTown（town.enter → sanChanged → 救済 → screen{town}）。message の語りは出さない（dice の表示がラベルとして出す）。
import type { GameData } from "../data/index";
import { EQUIP_SLOTS } from "../data/index";
import { randInt, rollDice } from "../rng";
import { destroyItemInstance, itemDisplayName } from "../state";
import type { Character, GameState, PenaltyExpLoss, PenaltyLostItem, PenaltyResult, RuleContext, TextRef } from "../types";
import { canAct } from "./combat-calc";
import { clampToMax, hpMaxOf } from "./equip-stats";
import { clearAllStatus } from "./field";
import { levelDownWhileBelow } from "./growth";
import { ceilRatio, floorRatio } from "./ratio";
import { sellPrice } from "./shop";
import { arriveTown } from "./town";
import { bumpTally } from "./progress";

/** TW-22: 出目 total が入る帯の添字。どの帯にも入らなければ Error（penalty-table.json は起動時に隙間なしを検証済み） */
export function bandIndexFor(data: GameData, total: number): number {
  const i = data.penaltyTable.bands.findIndex((b) => b.min <= total && total <= b.max);
  if (i < 0) throw new Error(`bandIndexFor: no band for ${total}`);
  return i;
}

/**
 * UI-56 / TW-22（M5.5）: 全滅の出目の表の見出しと行（純粋）。見出しは wipe.table.title{dice}。行は帯の順に、min === max の帯は
 * wipe.table.rowOne{roll}、それ以外は wipe.table.row{min, max}。共通の params: name（帯の name）、gold = round(goldLossRatio × 100)、
 * items = itemLoss、exp = round(expLossRatio × 100)
 */
export function penaltyTableView(data: GameData): { title: TextRef; rows: TextRef[] } {
  const t = data.penaltyTable;
  return {
    title: { key: "wipe.table.title", params: { dice: t.dice } },
    rows: t.bands.map((b) => {
      const common = { name: b.name, gold: Math.round(b.goldLossRatio * 100), items: b.itemLoss, exp: Math.round(b.expLossRatio * 100) };
      return b.min === b.max
        ? { key: "wipe.table.rowOne", params: { roll: b.min, ...common } }
        : { key: "wipe.table.row", params: { min: b.min, max: b.max, ...common } };
    }),
  };
}

/**
 * TW-27 の総資産 = 所持金 + 銀行 + 全アイテム実体の売値（IT-61 の sellPrice。倉庫・買い戻しのストックの品も含む）+ 全員の EXP（素の値）。
 * テスト用（表示層は使わない）。
 */
export function assetValue(state: GameState, data: GameData): number {
  let v = state.gold + state.bank;
  for (const inst of Object.values(state.items)) v += sellPrice(inst, data);
  for (const ch of state.party) v += ch.exp;
  return v;
}

function ownerOf(state: GameState, instanceId: string): Character {
  for (const ch of state.party) {
    if (ch.inventory.includes(instanceId)) return ch;
    for (const slot of EQUIP_SLOTS) if (ch.equipment[slot] === instanceId) return ch;
  }
  throw new Error(`ownerOf: no owner for ${instanceId}`);
}

type Holding = { ch: Character; instanceId: string; equipped: boolean };

/** TW-22 の失う品の候補。非装備（並び順 × inventory の順）があればそれ、無ければ装備（並び順 × EQUIP_SLOTS の順） */
function lossPool(state: GameState): Holding[] {
  const unequipped: Holding[] = [];
  const equipped: Holding[] = [];
  for (const ch of state.party) {
    for (const id of ch.inventory) unequipped.push({ ch, instanceId: id, equipped: false });
    for (const slot of EQUIP_SLOTS) {
      const id = ch.equipment[slot];
      if (id !== null) equipped.push({ ch, instanceId: id, equipped: true });
    }
  }
  return unequipped.length > 0 ? unequipped : equipped;
}

/**
 * TW-23 / TW-24: alive にして HP を max(1, ceil(hpMax × reviveHpRatio)) に「する」（下がることもある）。
 * 死亡・灰から生き返る者（TW-24 のリーダー）は常に、全滅時点で alive の者は clearStatus なら状態を全部外す（CH-45）。MP・SAN は触らない
 */
function revive(ctx: RuleContext, ch: Character): void {
  const cfg = ctx.data.config.wipe;
  const wasDead = ch.life !== "alive";
  if (wasDead) {
    ch.life = "alive";
    ctx.events.push({ kind: "lifeChanged", id: ch.id, life: "alive" });
  }
  const hp = Math.max(1, ceilRatio(hpMaxOf(ctx.state, ctx.data, ch), cfg.reviveHpRatio)); // CH-14: 実効の hpMax
  if (hp !== ch.hp) ctx.events.push({ kind: "hpChanged", id: ch.id, delta: hp - ch.hp, hp });
  ch.hp = hp;
  if (wasDead || cfg.clearStatus) clearAllStatus(ctx, ch);
}

/**
 * 全滅処理（TW-20〜26）。前提: dive が非 null、battle が null。終わると screen town・dive null・townVisit 非 null。
 */
export function performWipe(ctx: RuleContext): void {
  const { state, data } = ctx;
  const dive = state.dive;
  if (dive === null) throw new Error("performWipe: not in dungeon");
  if (state.battle !== null) throw new Error("performWipe: in battle");
  const aliveAtWipe = state.party.filter((c) => c.life === "alive").map((c) => c.id);
  const leader = state.party.find((c) => c.isLeader);
  if (leader === undefined) throw new Error("performWipe: no leader");
  state.pendingChoice = null;
  bumpTally(state, "wipes"); // TW-35（M12）

  // 1) 語り
  ctx.events.push({ kind: "message", key: "wipe.intro" });

  // 2) DG-42 / TW-21: 台帳の品と金は全部失う
  const ledgerItems: string[] = [];
  for (const id of [...dive.ledger.items]) {
    const owner = ownerOf(state, id);
    ledgerItems.push(itemDisplayName(state, data, id));
    destroyItemInstance(state, owner, id);
  }
  const ledgerGold = Math.min(state.gold, dive.ledger.gold);
  state.gold -= ledgerGold;
  dive.ledger = { items: [], gold: 0 };
  // TW-21: 失った金も品も無ければ、内訳（wipe.summary.ledgerNone）と言い回しを合わせて wipe.ledgerNone
  const ledgerEmpty = ledgerGold === 0 && ledgerItems.length === 0;
  ctx.events.push({ kind: "message", key: ledgerEmpty ? "wipe.ledgerNone" : "wipe.ledgerLost" });

  // 3) TW-22: 2d10
  // 4) 帯（乱数を使わないので dice の前に引く。UI-40 の基準と結果に出す）
  // UI-56（M5.5）: 振る前に出目の表を見せる（乱数は使わない）
  const table = penaltyTableView(data);
  ctx.events.push({ kind: "penaltyTable", title: table.title, rows: table.rows, hit: null });
  const roll = rollDice(state.rng, data.penaltyTable.dice);
  const bandIndex = bandIndexFor(data, roll.total);
  const band = data.penaltyTable.bands[bandIndex]!;
  ctx.events.push({
    kind: "dice",
    label: { key: "dice.wipe" },
    rows: [{ label: { key: "dice.row.roll" }, base: null, dice: [...roll.dice], total: roll.total }],
    rule: { key: "dice.wipe.rule", params: { min: band.min, max: band.max } },
    result: { key: "dice.wipe.result", params: { band: band.name } },
  });
  // UI-56（M5.5）: 振った後に当たった帯を示す
  ctx.events.push({ kind: "penaltyTable", title: table.title, rows: table.rows, hit: bandIndex });
  ctx.events.push({ kind: "message", key: band.text });

  // 5) 金（台帳分を引いた後の所持金から）
  const goldLost = floorRatio(state.gold, band.goldLossRatio);
  state.gold -= goldLost;
  if (goldLost > 0) ctx.events.push({ kind: "message", key: "wipe.goldLost", params: { gold: goldLost } });

  // 6) 品（非装備を使い切ってから装備。1 個ごとに候補を作り直して randInt 1 回）
  const itemsLost: PenaltyLostItem[] = [];
  for (let k = 0; k < band.itemLoss; k++) {
    const pool = lossPool(state);
    if (pool.length === 0) break;
    const pick = pool[randInt(state.rng, 0, pool.length - 1)]!;
    const inst = state.items[pick.instanceId];
    if (inst === undefined) throw new Error(`performWipe: unknown item instance ${pick.instanceId}`);
    const name = itemDisplayName(state, data, pick.instanceId);
    destroyItemInstance(state, pick.ch, pick.instanceId);
    itemsLost.push({ memberId: pick.ch.id, instanceId: pick.instanceId, itemId: inst.itemId, name, equipped: pick.equipped });
    ctx.events.push({ kind: "message", key: "wipe.itemLost", params: { item: name } });
  }

  // 7) EXP（全員。dead / ash も）とレベルダウン（CH-62）
  const losses = state.party.map((ch) => floorRatio(ch.exp, band.expLossRatio));
  if (losses.some((x) => x > 0)) ctx.events.push({ kind: "message", key: "wipe.expLost" });
  const expLost: PenaltyExpLoss[] = [];
  state.party.forEach((ch, i) => {
    const lost = losses[i]!;
    const expBefore = ch.exp;
    const levelFrom = ch.level;
    ch.exp -= lost;
    if (levelDownWhileBelow(ctx, ch) > 0) {
      ctx.events.push({ kind: "message", key: "wipe.levelDown", params: { name: ch.name, level: ch.level } });
    }
    expLost.push({ id: ch.id, name: ch.name, expBefore, lost, levelFrom, levelTo: ch.level });
  });

  // CH-14: 装備中の品を失って実効の最大値が下がった者の現在値を止める（変わらなければ何も出ない）
  for (const ch of state.party) clampToMax(ctx, ch);

  // 8) 復活（TW-23: 全滅時点で alive の者 → TW-24: リーダー）
  const revived: string[] = [];
  if (aliveAtWipe.length > 0) {
    ctx.events.push({ kind: "message", key: "wipe.revived" });
    for (const ch of state.party) {
      if (!aliveAtWipe.includes(ch.id)) continue;
      revive(ctx, ch);
      revived.push(ch.id);
    }
  }
  const leaderRule = !aliveAtWipe.includes(leader.id);
  if (leaderRule) {
    ctx.events.push({ kind: "message", key: "wipe.leaderRule" });
    revive(ctx, leader);
    revived.push(leader.id);
  }

  // 9) 迷宮を出て街へ（TW-26）
  state.dive = null;
  const penalty: PenaltyResult = {
    dice: [...roll.dice],
    total: roll.total,
    bandIndex,
    ledgerGold,
    ledgerItems,
    goldLost,
    itemsLost,
    expLost,
    revived,
    leaderRule,
  };
  ctx.events.push({ kind: "wipe", penalty });
  arriveTown(ctx);
}

/**
 * 迷宮の戦闘外の全滅（CH-44 の行動可能な者がいない）。engine が受け付けた全コマンドの最後に呼ぶ。
 * screen dungeon か event（A4。イベントの選択を待つ間）・dive 非 null・battle null で、行動可能な者がいなければ performWipe。それ以外は何もしない。
 * screen event なら保留中の選択を下ろして dungeon に戻してから（screen イベントは出さない。performWipe が screen{town} を出す）。
 */
export function wipeIfNoneCanAct(ctx: RuleContext): void {
  const { state } = ctx;
  if ((state.screen !== "dungeon" && state.screen !== "event") || state.dive === null || state.battle !== null) return;
  if (state.party.some(canAct)) return;
  if (state.screen === "event") {
    state.pendingChoice = null;
    state.screen = "dungeon";
  }
  performWipe(ctx);
}
