// 闇魔術の強化（TW-17 / IT-70。M7 の C）。街（screen town・dive null）でだけ、本人の装備中の汎用装備 1 つを、パーティの誰かの inventory の
// 鑑定済みの汎用装備（触媒。0〜upgradeMaxCatalysts 個。M16 で本人だけから全員に広げた）を食わせて d100 で鍛える。触媒は成否に関わらず持ち主から消え、
// オプション・希少度は引き継がない。
// 成功率 p・大成功の率 q・料金の式は core のここだけに置く（表示層は upgradePreview / townMenu.upgrade の値を描く。UI-35）。
// 乱数は d100（randInt(1, 100)）の 1 回だけ。拒否では引かない。
// 対象・触媒の level は変わっても hpMax / mpMax / sanMax に効かない（IT-20〜23。オプションは変えない）ので clampToMax は呼ばない。
import type { Config, EquipSlot, GameData } from "../data/index";
import { EQUIP_SLOTS } from "../data/index";
import { randInt } from "../rng";
import { destroyItemInstance, equipmentPlainName, findBase, itemDisplayName, memberById } from "../state";
import type { Character, GameState, ItemInstance, RuleContext, TownMenu, UpgradeCatalystRef, UpgradePreview } from "../types";

type EconomyConfig = Config["economy"];

/**
 * TW-17: 成功率 p = min(100, floor(upgradeRateBase + Σ 触媒ごとに upgradeRatePerCatalyst × upgradeDecay^max(0, 対象Lv − 触媒Lv) + 1e-9))。
 * 整数で返し、判定（出目 ≤ p）も表示もこの整数を使う（UI-40 / CB-04 と同じく、表示している値で比べる）
 */
export function upgradeRate(targetLv: number, catalystLvs: readonly number[], e: EconomyConfig): number {
  let sum = e.upgradeRateBase;
  for (const c of catalystLvs) sum += e.upgradeRatePerCatalyst * Math.pow(e.upgradeDecay, Math.max(0, targetLv - c));
  return Math.min(100, Math.floor(sum + 1e-9));
}

/** TW-17: 大成功の率 q = max(1, floor(p ÷ 10)) */
export function upgradeGreat(rate: number): number {
  return Math.max(1, Math.floor(rate / 10));
}

/** TW-17: 料金 = upgradeBase × (対象Lv + 1)。触媒の数に関わらない */
export function upgradeFee(targetLv: number, e: EconomyConfig): number {
  return e.upgradeBase * (targetLv + 1);
}

function isSlot(x: unknown): x is EquipSlot {
  return typeof x === "string" && (EQUIP_SLOTS as readonly string[]).includes(x);
}

/** TW-17: 対象にできない理由（空き・ユニーク）。対象にできるなら null */
function targetBlock(state: GameState, ch: Character, slot: EquipSlot): string | null {
  const id = ch.equipment[slot];
  if (id === null) return "slot empty";
  const inst = state.items[id];
  if (inst === undefined) throw new Error(`upgrade: unknown item instance ${id}`);
  if (inst.uniqueId !== null) return "unique";
  return null;
}

/**
 * TW-17 / Q13: 触媒にできる実体（持ち主 ref.memberId がパーティにいて、その inventory にあり、装備品のベースで、ユニークでなく、鑑定済み）。
 * できなければ null。inventory は装備中の品を含まないので、鍛える対象そのものは触媒にならない
 */
function catalystOf(state: GameState, data: GameData, ref: UpgradeCatalystRef): { owner: Character; inst: ItemInstance } | null {
  const owner = memberById(state, ref.memberId);
  if (owner === null) return null;
  const id = ref.instanceId;
  if (!owner.inventory.includes(id)) return null;
  const inst = state.items[id];
  if (inst === undefined || findBase(data, inst.itemId) === null) return null;
  if (inst.uniqueId !== null || !inst.identified) return null;
  return { owner, inst };
}

function isRef(x: unknown): x is UpgradeCatalystRef {
  if (typeof x !== "object" || x === null) return false;
  const r = x as { memberId?: unknown; instanceId?: unknown };
  return typeof r.memberId === "string" && typeof r.instanceId === "string";
}

/**
 * town.upgrade を受け付けない理由。順: wrong screen → bad action（catalysts が {memberId, instanceId} の配列でない・upgradeMaxCatalysts より多い・
 * instanceId の重複）→ no such member → bad slot → slot empty → unique → bad catalyst（持ち主がいない・持ち主の inventory に無い・装備品でない・
 * ユニーク・未鑑定）→ not enough gold。本人・持ち主の life は問わない。呪われた対象・触媒も可
 */
export function checkUpgrade(state: GameState, memberId: unknown, slot: unknown, catalysts: unknown, data: GameData): string | null {
  if (state.screen !== "town" || state.dive !== null) return "wrong screen";
  if (!Array.isArray(catalysts) || !catalysts.every(isRef)) return "bad action";
  if (catalysts.length > data.config.economy.upgradeMaxCatalysts) return "bad action";
  if (new Set(catalysts.map((r) => r.instanceId)).size !== catalysts.length) return "bad action";
  const ch = typeof memberId === "string" ? memberById(state, memberId) : null;
  if (ch === null) return "no such member";
  if (!isSlot(slot)) return "bad slot";
  const tb = targetBlock(state, ch, slot);
  if (tb !== null) return tb;
  if (catalysts.some((r) => catalystOf(state, data, r) === null)) return "bad catalyst";
  const target = state.items[ch.equipment[slot]!]!;
  if (state.gold < upgradeFee(target.level, data.config.economy)) return "not enough gold";
  return null;
}

/**
 * TW-17。checkUpgrade が null を返した前提。
 * 料金を払う → 触媒を catalysts の順に持ち主から destroyItemInstance → randInt(1, 100) を 1 回 → dice（label dice.upgrade{item: 強化前の表示名}、
 * 行 dice.row.roll（base null）、基準 dice.upgrade.rule{rate, great}、結果 dice.upgrade.great / ok / ng）→ level を +2 / +1 / −1（0 で止まる）
 * → message town.upgrade.great / ok / ng{name, item: 強化後の表示名}。M16（4-5）: 強化前が Lv0 の失敗は ng の代わりに ngFloor（同じ params）。
 * オプション・希少度・呪い・鑑定はそのまま
 */
export function doUpgrade(ctx: RuleContext, memberId: string, slot: EquipSlot, catalysts: readonly UpgradeCatalystRef[]): void {
  const { state, data } = ctx;
  const e = data.config.economy;
  const ch = memberById(state, memberId);
  if (ch === null) throw new Error(`doUpgrade: unknown member ${memberId}`);
  const targetId = ch.equipment[slot];
  if (targetId === null) throw new Error(`doUpgrade: ${memberId} has nothing in ${slot}`);
  const target = state.items[targetId];
  if (target === undefined) throw new Error(`doUpgrade: unknown item instance ${targetId}`);
  const cats = catalysts.map((r) => {
    const c = catalystOf(state, data, r);
    if (c === null) throw new Error(`doUpgrade: bad catalyst ${r.instanceId}`);
    return c;
  });
  const lvs = cats.map((c) => c.inst.level);
  const rate = upgradeRate(target.level, lvs, e);
  const great = upgradeGreat(rate);
  const before = itemDisplayName(state, data, targetId);
  state.gold -= upgradeFee(target.level, e);
  for (const c of cats) destroyItemInstance(state, c.owner, c.inst.id);
  const roll = randInt(state.rng, 1, 100);
  const outcome = roll <= great ? "great" : roll <= rate ? "ok" : "ng";
  ctx.events.push({
    kind: "dice",
    label: { key: "dice.upgrade", params: { item: before } },
    rows: [{ label: { key: "dice.row.roll" }, base: null, dice: [roll], total: roll }],
    rule: { key: "dice.upgrade.rule", params: { rate, great } },
    result: { key: `dice.upgrade.${outcome}` },
  });
  const floor = outcome === "ng" && target.level === 0;
  target.level = Math.max(0, target.level + (outcome === "great" ? 2 : outcome === "ok" ? 1 : -1));
  ctx.events.push({
    kind: "message",
    key: floor ? "town.upgrade.ngFloor" : `town.upgrade.${outcome}`,
    params: { name: ch.name, item: itemDisplayName(state, data, targetId) },
  });
}

/**
 * TW-17 / UI-35: 表示層向けの問い合わせ（純粋）。対象（本人・部位・その実体）が決まらない（checkUpgrade が wrong screen / bad action /
 * no such member / bad slot / slot empty / unique のどれか）なら null。それ以外は、触媒のうち触媒にできる実体の Lv で成功率を出し、
 * block に checkUpgrade の理由（bad catalyst / not enough gold / null）を入れる。block が null のときだけ town.upgrade が受け付けられる
 */
export function upgradePreview(
  state: GameState,
  data: GameData,
  memberId: string,
  slot: EquipSlot,
  catalysts: readonly UpgradeCatalystRef[],
): UpgradePreview | null {
  const block = checkUpgrade(state, memberId, slot, [...catalysts], data);
  if (block !== null && block !== "bad catalyst" && block !== "not enough gold") return null;
  const ch = memberById(state, memberId)!;
  const target = state.items[ch.equipment[slot]!]!;
  const e = data.config.economy;
  const lvs = catalysts.flatMap((r) => {
    const c = catalystOf(state, data, r);
    return c === null ? [] : [c.inst.level];
  });
  const rate = upgradeRate(target.level, lvs, e);
  const fee = upgradeFee(target.level, e);
  return { rate, great: upgradeGreat(rate), fee, affordable: state.gold >= fee, block };
}

/** M16（4-5）: 鑑定済みの装備の実体の、Lv を除いた名前（equipmentPlainName）。装備品のベースでないか未鑑定なら表示名 */
function plainNameOf(state: GameState, data: GameData, id: string): string {
  const inst = state.items[id];
  const base = inst === undefined ? null : findBase(data, inst.itemId);
  if (inst === undefined || base === null || !inst.identified) return itemDisplayName(state, data, id);
  return equipmentPlainName(data, base, inst.rarity, inst.uniqueId);
}

/**
 * UI-52 / TW-17: 闇魔術の強化のページの値（townMenu.upgrade。純粋）。全員（並び順。life を問わない）。
 * 触媒の候補は全員で同じ（パーティ全員の inventory。メンバーの並び順 → inventory の順。M16 の G-2）。
 * 対象は装備中の品で inventory に無いので、候補に出ない
 */
export function upgradeMenu(state: GameState, data: GameData): TownMenu["upgrade"] {
  const catalysts = state.party.flatMap((owner) =>
    owner.inventory.flatMap((id) => {
      const c = catalystOf(state, data, { memberId: owner.id, instanceId: id });
      if (c === null) return [];
      const name = itemDisplayName(state, data, id);
      return [{ instanceId: id, name, plainName: plainNameOf(state, data, id), level: c.inst.level, ownerId: owner.id, ownerName: owner.name }];
    }),
  );
  return {
    maxCatalysts: data.config.economy.upgradeMaxCatalysts,
    members: state.party.map((ch) => {
      const slots = EQUIP_SLOTS.map((slot) => {
        const id = ch.equipment[slot];
        const block = targetBlock(state, ch, slot);
        return {
          slot,
          instanceId: id,
          name: id === null ? null : itemDisplayName(state, data, id),
          plainName: id === null ? null : plainNameOf(state, data, id),
          level: id === null ? 0 : (state.items[id]?.level ?? 0),
          block,
        };
      });
      return { memberId: ch.id, name: ch.name, canUpgrade: slots.some((s) => s.block === null), slots, catalysts: catalysts.map((c) => ({ ...c })) };
    }),
  };
}
