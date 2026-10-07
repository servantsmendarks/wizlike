// キャンプと酒場のコマンド（MG-44 dungeon.cast、CH-03 party.reorder、CH-76 party.equip / party.unequip、CH-77 party.identify、CH-78 party.give、CH-79 party.drop）と、
// 表示層向けの問い合わせ campMenu（UI-53 / TW-03）・campSummary（UI-53）。
// 受け付ける場所は campPlace が決める（街、または迷宮の戦闘外かつ保留なし。M5.5 から dungeon.cast も街で受け付ける。帰還は迷宮だけ）。
// 乱数を使うのは dungeon.cast の heal（対象ごとに effect.dice を 1 回）と resurrect（randInt(1, 100) を 1 回）、party.identify（d100 と、失敗した呪いの品の取り憑きの chance。CH-77）だけ。
// town.ts からはこのファイルを import しない（循環を作らない）。
import type { EquipmentBase, EquipSlot, GameData, Spell } from "../data/index";
import { EQUIP_SLOTS } from "../data/index";
import { chance, randInt } from "../rng";
import { classOf, destroyItemInstance, dungeonOf, findBase, findItem, identifyInstance, itemDisplayName, memberById, moraleOf, slotsUsed, spellOf } from "../state";
import type {
  CampEquipCandidate,
  CampMenu,
  CampSummary,
  CampPlace,
  CampSpellView,
  CampTargetBlock,
  DiceRow,
  Character,
  EquipBlock,
  GameState,
  RuleContext,
} from "../types";
import { canAct } from "./combat-calc";
import { applyAllyEffect } from "./effects";
import { clampToMax, equipStats, hpMaxOf, spellCost } from "./equip-stats";
import { loseSan } from "./san";
import { returnToTown, rollResurrect } from "./town";

/** キャンプのコマンドを受け付ける場所。街（dive null）か迷宮の戦闘外。どちらも保留なしのときだけ。それ以外は null */
export function campPlace(state: GameState): CampPlace | null {
  if (state.battle !== null || state.pendingChoice !== null) return null;
  if (state.screen === "town" && state.dive === null) return "town";
  if (state.screen === "dungeon" && state.dive !== null) return "dungeon";
  return null;
}

function isEquipSlot(x: unknown): x is EquipSlot {
  return typeof x === "string" && (EQUIP_SLOTS as readonly string[]).includes(x);
}

/** 装備品（itemId が equipment-bases.json のベース。IT-02）ならそのベース、そうでなければ null */
function asEquip(data: GameData, itemId: string): EquipmentBase | null {
  return findBase(data, itemId);
}

/** 装備品なら装備先のスロット（ベースの slot）。装備品でなければ null */
function equipSlotOf(data: GameData, itemId: string): EquipSlot | null {
  return asEquip(data, itemId)?.slot ?? null;
}

// ---------------------------------------------------------------------------
// MG-44 dungeon.cast

/** MG-32: 戦闘外で使える呪文（usableIn が battle でなく、効果が heal / cureStatus / return / resurrect、対象が味方側か none） */
function fieldSpellOk(sp: Spell): boolean {
  if (sp.usableIn === "battle") return false;
  const t = sp.effect.type;
  if (t !== "heal" && t !== "cureStatus" && t !== "return" && t !== "resurrect") return false;
  return sp.target === "ally" || sp.target === "self" || sp.target === "party" || sp.target === "none";
}

/** 対象の選び方。resurrect は life dead の者、ally は life alive の者、それ以外は対象を取らない */
function spellTargetKind(sp: Spell): CampSpellView["target"] {
  if (sp.effect.type === "resurrect") return "dead";
  return sp.target === "ally" ? "ally" : "none";
}

/**
 * dungeon.cast を受け付けない理由（英語）。受け付けるなら null。
 * 順: wrong screen → no such member → cannot act → unknown spell → not usable here（戦闘外で使えない呪文と、街の帰還。M5.5）→ no mp → bad target
 */
export function checkCast(
  state: GameState,
  data: GameData,
  memberId: unknown,
  spellId: unknown,
  targetId: unknown,
): string | null {
  const place = campPlace(state);
  if (place === null) return "wrong screen";
  const ch = typeof memberId === "string" ? memberById(state, memberId) : null;
  if (ch === null) return "no such member";
  if (!canAct(ch)) return "cannot act";
  if (typeof spellId !== "string" || !data.spells.some((s) => s.id === spellId) || !ch.knownSpells.includes(spellId)) {
    return "unknown spell";
  }
  const sp = spellOf(data, spellId);
  if (!fieldSpellOk(sp)) return "not usable here";
  if (place === "town" && sp.effect.type === "return") return "not usable here"; // MG-32（M5.5）: 帰還は迷宮だけ
  if (ch.mp < spellCost(state, data, ch, sp)) return "no mp"; // MG-30 / IT-40: mpCostDown の後の消費
  const kind = spellTargetKind(sp);
  if (kind !== "none") {
    const t = typeof targetId === "string" ? memberById(state, targetId) : null;
    if (t === null || t.life !== (kind === "dead" ? "dead" : "alive")) return "bad target";
    if (kind === "ally" && healTargetBlock(state, data, sp.effect.type, t) !== null) return "full hp"; // MG-44（2026-10-05）
  }
  return null;
}

/**
 * MG-44 / UI-53（2026-10-05）: 戦闘外で対象を選ぶ回復（呪文・道具の効果 heal、対象 ally）の、対象ごとの使えない理由。
 * HP が実効の hpMax（CH-14）以上なら "fullHp"、それ以外（heal でない効果を含む）は null。戦闘中の対象には使わない
 */
export function healTargetBlock(state: GameState, data: GameData, effectType: string, t: Character): CampTargetBlock | null {
  return effectType === "heal" && t.hp >= hpMaxOf(state, data, t) ? "fullHp" : null;
}

/**
 * MG-44。checkCast が null を返した前提。
 * MP を引く（mpChanged）→ message battle.cast{actor, spell} → 効果（spell イベントは出さない）。
 * - heal / cureStatus: applyAllyEffect（対象は ally なら [対象]、self なら [本人]、party なら alive の全員）
 * - return: returnToTown(ctx, "dungeon.returnSpell")（MG-40。台帳は持ち帰る）
 * - resurrect: message dungeon.cast.resurrectRoll → rollResurrect → resurrectOk / resurrectFail（MG-42。dice は出さない）
 */
export function castInField(ctx: RuleContext, memberId: string, spellId: string, targetId: string | null): void {
  const { state, data } = ctx;
  const ch = memberById(state, memberId);
  if (ch === null) throw new Error(`castInField: unknown member ${memberId}`);
  const sp = spellOf(data, spellId);
  const cost = spellCost(state, data, ch, sp); // MG-30 / IT-40
  ch.mp -= cost;
  ctx.events.push({ kind: "mpChanged", id: ch.id, delta: -cost, mp: ch.mp });
  ctx.events.push({ kind: "message", key: "battle.cast", params: { actor: ch.name, spell: sp.name } });
  const e = sp.effect;
  switch (e.type) {
    case "heal":
    case "cureStatus": {
      const targets = castTargets(state, ch, sp, targetId);
      const power = e.type === "heal" ? equipStats(state, data, ch).magicPower : 0; // MG-33
      applyAllyEffect(ctx, e.type === "heal" ? { type: "heal", dice: e.dice } : { type: "cureStatus", status: e.status }, targets, power);
      return;
    }
    case "return":
      returnToTown(ctx, "dungeon.returnSpell");
      return;
    case "resurrect": {
      const t = targetId === null ? null : memberById(state, targetId);
      if (t === null) throw new Error(`castInField: bad target ${String(targetId)}`);
      ctx.events.push({ kind: "message", key: "dungeon.cast.resurrectRoll", params: { name: t.name } });
      const ok = rollResurrect(ctx, t);
      ctx.events.push({ kind: "message", key: ok ? "dungeon.cast.resurrectOk" : "dungeon.cast.resurrectFail", params: { name: t.name } });
      return;
    }
    default:
      throw new Error(`castInField: not usable in field: ${sp.id}`);
  }
}

function castTargets(state: GameState, actor: Character, sp: Spell, targetId: string | null): Character[] {
  switch (sp.target) {
    case "ally": {
      const t = targetId === null ? null : memberById(state, targetId);
      if (t === null) throw new Error(`castInField: bad target ${String(targetId)}`);
      return [t];
    }
    case "self":
      return [actor];
    case "party":
      return state.party.filter((c) => c.life === "alive");
    default:
      throw new Error(`castInField: target not usable in field: ${sp.target}`);
  }
}

// ---------------------------------------------------------------------------
// CH-03 party.reorder

/** party.reorder を受け付けない理由。順: wrong screen → bad order → no change */
export function checkReorder(state: GameState, order: unknown): string | null {
  if (campPlace(state) === null) return "wrong screen";
  if (!Array.isArray(order) || order.length !== state.party.length) return "bad order";
  const seen = new Set<string>();
  for (const id of order as unknown[]) {
    if (typeof id !== "string" || seen.has(id) || memberById(state, id) === null) return "bad order";
    seen.add(id);
  }
  if ((order as string[]).every((id, i) => state.party[i]!.id === id)) return "no change";
  return null;
}

/** CH-03。checkReorder が null を返した前提。order の順に並べ替える → message camp.reordered。乱数なし。リーダーも動かせる */
export function reorderParty(ctx: RuleContext, order: string[]): void {
  const { state } = ctx;
  state.party = order.map((id) => {
    const ch = memberById(state, id);
    if (ch === null) throw new Error(`reorderParty: unknown member ${id}`);
    return ch;
  });
  ctx.events.push({ kind: "message", key: "camp.reordered" });
}

// ---------------------------------------------------------------------------
// CH-76 party.equip / party.unequip

/** 呪われた品か（鑑定と関係なく実体の cursed。CH-73 / IT-32） */
function isCursed(state: GameState, instanceId: string): boolean {
  const inst = state.items[instanceId];
  if (inst === undefined) throw new Error(`isCursed: unknown item instance ${instanceId}`);
  return inst.cursed;
}

/**
 * party.equip を受け付けない理由。順: wrong screen → no such member → cannot act → item not in inventory → not equipment →
 * not identified → class cannot equip → slot cursed
 */
export function checkEquip(state: GameState, data: GameData, memberId: unknown, instanceId: unknown): string | null {
  if (campPlace(state) === null) return "wrong screen";
  const ch = typeof memberId === "string" ? memberById(state, memberId) : null;
  if (ch === null) return "no such member";
  if (!canAct(ch)) return "cannot act";
  if (typeof instanceId !== "string" || !ch.inventory.includes(instanceId)) return "item not in inventory";
  const inst = state.items[instanceId];
  if (inst === undefined) return "item not in inventory";
  const item = asEquip(data, inst.itemId);
  if (item === null) return "not equipment";
  const slot = item.slot;
  if (!inst.identified) return "not identified";
  if (item.classes.length > 0 && !item.classes.includes(ch.classId)) return "class cannot equip";
  const old = ch.equipment[slot];
  if (old !== null && isCursed(state, old)) return "slot cursed";
  return null;
}

/**
 * CH-76。checkEquip が null を返した前提。乱数なし。所持枠と台帳は変わらない。
 * inventory の新しい品の位置に旧品を入れる（旧品が無ければ取り除く）→ equipment[slot] = 新しい品 → message camp.equipped{name, item}
 * → 新しい品が呪われていれば message camp.cursed{item}
 */
export function equipItem(ctx: RuleContext, memberId: string, instanceId: string): void {
  const { state, data } = ctx;
  const ch = memberById(state, memberId);
  if (ch === null) throw new Error(`equipItem: unknown member ${memberId}`);
  const inst = state.items[instanceId];
  if (inst === undefined) throw new Error(`equipItem: unknown item instance ${instanceId}`);
  const slot = equipSlotOf(data, inst.itemId);
  if (slot === null) throw new Error(`equipItem: not equipment ${inst.itemId}`);
  const i = ch.inventory.indexOf(instanceId);
  if (i < 0) throw new Error(`equipItem: ${instanceId} not in inventory`);
  const old = ch.equipment[slot];
  if (old === null) ch.inventory.splice(i, 1);
  else ch.inventory[i] = old;
  ch.equipment[slot] = instanceId;
  const item = itemDisplayName(state, data, instanceId);
  ctx.events.push({ kind: "message", key: "camp.equipped", params: { name: ch.name, item } });
  if (isCursed(state, instanceId)) ctx.events.push({ kind: "message", key: "camp.cursed", params: { item } });
  clampToMax(ctx, ch); // CH-14: 実効の最大値が下がったら現在値を止める
}

/**
 * party.unequip を受け付けない理由。順: wrong screen → no such member → bad slot → slot empty → cursed。
 * M10（U6）: 本人の life と行動の可否は問わない（死亡・灰の者の装備も、呪われていなければ外して回収できる。操作するのはプレイヤー）。
 * 呪いは実体の cursed（M7）で見るので data は読まない（引数は呼び出し側との形を保つために残す）
 */
export function checkUnequip(state: GameState, _data: GameData, memberId: unknown, slot: unknown): string | null {
  if (campPlace(state) === null) return "wrong screen";
  const ch = typeof memberId === "string" ? memberById(state, memberId) : null;
  if (ch === null) return "no such member";
  if (!isEquipSlot(slot)) return "bad slot";
  const id = ch.equipment[slot];
  if (id === null) return "slot empty";
  if (isCursed(state, id)) return "cursed";
  return null;
}

/** CH-76。checkUnequip が null を返した前提。equipment[slot] = null → inventory の末尾 → message camp.unequipped{name, item}。乱数なし */
export function unequipItem(ctx: RuleContext, memberId: string, slot: EquipSlot): void {
  const { state, data } = ctx;
  const ch = memberById(state, memberId);
  if (ch === null) throw new Error(`unequipItem: unknown member ${memberId}`);
  const id = ch.equipment[slot];
  if (id === null) throw new Error(`unequipItem: ${slot} is empty`);
  ch.equipment[slot] = null;
  ch.inventory.push(id);
  ctx.events.push({ kind: "message", key: "camp.unequipped", params: { name: ch.name, item: itemDisplayName(state, data, id) } });
  clampToMax(ctx, ch); // CH-14
}

// ---------------------------------------------------------------------------
// CH-78 party.give / CH-79 party.drop（M10）

/** 使用枠（CH-71）に空きがあるか（CH-78 の target full の逆。campMenu の canReceive） */
function hasFreeSlot(data: GameData, ch: Character): boolean {
  return slotsUsed(ch) < data.config.inventory.slotsPerCharacter;
}

/** CH-78 / CH-79 共通の前半。順: wrong screen → no such member → item not in inventory（本人の inventory に無い。装備中は対象外） */
function checkOwnItem(state: GameState, memberId: unknown, instanceId: unknown): string | null {
  if (campPlace(state) === null) return "wrong screen";
  const ch = typeof memberId === "string" ? memberById(state, memberId) : null;
  if (ch === null) return "no such member";
  if (typeof instanceId !== "string" || !ch.inventory.includes(instanceId) || state.items[instanceId] === undefined) {
    return "item not in inventory";
  }
  return null;
}

/**
 * party.give を受け付けない理由。順: wrong screen → no such member → item not in inventory → no such target（自分・パーティ外）→ target full。
 * 渡す側・受け取る側の life と行動の可否は問わない（U6）。呪われた品・未鑑定の品も渡せる
 */
export function checkGive(state: GameState, data: GameData, memberId: unknown, instanceId: unknown, toId: unknown): string | null {
  const r = checkOwnItem(state, memberId, instanceId);
  if (r !== null) return r;
  const to = typeof toId === "string" && toId !== memberId ? memberById(state, toId) : null;
  if (to === null) return "no such target";
  if (!hasFreeSlot(data, to)) return "target full";
  return null;
}

/** CH-78。checkGive が null を返した前提。渡す側の inventory から外し、受け取る側の inventory の末尾へ → message camp.gave{name, item, to}。台帳・乱数は変わらない */
export function giveItem(ctx: RuleContext, memberId: string, instanceId: string, toId: string): void {
  const { state, data } = ctx;
  const ch = memberById(state, memberId);
  const to = memberById(state, toId);
  if (ch === null || to === null) throw new Error(`giveItem: unknown member ${memberId} / ${toId}`);
  const i = ch.inventory.indexOf(instanceId);
  if (i < 0) throw new Error(`giveItem: ${instanceId} not in inventory`);
  ch.inventory.splice(i, 1);
  to.inventory.push(instanceId);
  ctx.events.push({ kind: "message", key: "camp.gave", params: { name: ch.name, item: itemDisplayName(state, data, instanceId), to: to.name } });
}

/** party.drop を受け付けない理由。順: wrong screen → no such member → item not in inventory。本人の life と行動の可否は問わない（U6） */
export function checkDrop(state: GameState, memberId: unknown, instanceId: unknown): string | null {
  return checkOwnItem(state, memberId, instanceId);
}

/** CH-79。checkDrop が null を返した前提。message camp.dropped{name, item} → 実体ごと消す（潜行中なら台帳からも。DG-41）。図鑑は消さない。乱数なし */
export function dropItem(ctx: RuleContext, memberId: string, instanceId: string): void {
  const { state, data } = ctx;
  const ch = memberById(state, memberId);
  if (ch === null) throw new Error(`dropItem: unknown member ${memberId}`);
  const item = itemDisplayName(state, data, instanceId);
  destroyItemInstance(state, ch, instanceId);
  ctx.events.push({ kind: "message", key: "camp.dropped", params: { name: ch.name, item } });
}

// ---------------------------------------------------------------------------
// CH-77 party.identify

function canIdentify(ch: Character, data: GameData): boolean {
  return classOf(data, ch.classId).abilities.includes("identify");
}

/** パーティの誰かの inventory にある品なら持ち主 */
function ownerOf(state: GameState, instanceId: string): Character | null {
  return state.party.find((c) => c.inventory.includes(instanceId)) ?? null;
}

/**
 * party.identify を受け付けない理由。順: wrong screen → no such member → cannot identify → cannot act → no mp → no such item →
 * already identified（M10: no mp を足した。回数の制限は MP だけ）
 */
export function checkIdentify(state: GameState, data: GameData, memberId: unknown, instanceId: unknown): string | null {
  if (campPlace(state) === null) return "wrong screen";
  const ch = typeof memberId === "string" ? memberById(state, memberId) : null;
  if (ch === null) return "no such member";
  if (!canIdentify(ch, data)) return "cannot identify";
  if (!canAct(ch)) return "cannot act";
  if (ch.mp < data.config.identify.mpCost) return "no mp";
  if (typeof instanceId !== "string" || ownerOf(state, instanceId) === null || state.items[instanceId] === undefined) {
    return "no such item";
  }
  if (state.items[instanceId]!.identified) return "already identified";
  return null;
}

/** 符号付きの数（"+6" / "-10" / "0"） */
function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

/** 内訳の 1 行（UI-40 の補正の行: base が値で目が無い。値は label の params の v にも入れる） */
function identifyRow(key: string, value: number, v: string = signed(value)): DiceRow {
  return { label: { key, params: { v } }, base: value, dice: [], total: value };
}

/**
 * CH-77（M10）/ UI-35: 司教の鑑定の成功率と内訳（出目の行を除く）。純粋。
 * memberId がいない・鑑定できる職業でない・instanceId の実体が無いなら null（受け付けの可否は checkIdentify が決める）。
 * rate = base + (知恵（実効。CH-13）− iqPivot) × iqPerPoint + perLevelStep × floor(レベル / levelStep) − rarityPenalty[希少度]
 * −（ユニークなら uniquePenalty）を min〜max に収めた値。
 * rows の順: 基本（常に）→ 知恵 → レベル → 希少度 → ユニーク → 上下限（クランプが効いたとき）。基本以外は値が 0 の行を出さない
 */
export function identifyChance(
  state: GameState,
  data: GameData,
  memberId: string,
  instanceId: string,
): { rate: number; rows: DiceRow[] } | null {
  const ch = memberById(state, memberId);
  const inst = state.items[instanceId];
  if (ch === null || inst === undefined || !canIdentify(ch, data)) return null;
  const c = data.config.identify;
  const iq = (equipStats(state, data, ch).stats.iq - c.iqPivot) * c.iqPerPoint;
  const level = c.perLevelStep * Math.floor(ch.level / c.levelStep);
  const rarity = -c.rarityPenalty[inst.rarity];
  const unique = inst.uniqueId !== null ? -c.uniquePenalty : 0;
  const raw = c.base + iq + level + rarity + unique;
  const rate = Math.min(c.max, Math.max(c.min, raw));
  const rows: DiceRow[] = [identifyRow("identify.row.base", c.base, `${c.base}`)];
  const parts: Array<[string, number]> = [
    ["identify.row.iq", iq],
    ["identify.row.level", level],
    ["identify.row.rarity", rarity],
    ["identify.row.unique", unique],
    ["identify.row.clamp", rate - raw],
  ];
  for (const [key, v] of parts) if (v !== 0) rows.push(identifyRow(key, v));
  return { rate, rows };
}

/**
 * CH-77（M10）: 取り憑いた品を司教に強制装備できるか。品が装備品で、司教の職業が装備でき（CH-75）、
 * その枠の今の品が呪われておらず、枠が空のときは品が司教の inventory にあるか司教の使用枠（CH-71）に空きがあること。
 * 未鑑定（CH-72）は問わない（取り憑きは CH-76 を通らない別の経路）
 */
function canForceEquip(state: GameState, data: GameData, bishop: Character, owner: Character, instanceId: string): boolean {
  const inst = state.items[instanceId];
  if (inst === undefined) return false;
  const base = asEquip(data, inst.itemId);
  if (base === null) return false;
  if (base.classes.length > 0 && !base.classes.includes(bishop.classId)) return false;
  const old = bishop.equipment[base.slot];
  if (old !== null) return !isCursed(state, old);
  return owner.id === bishop.id || slotsUsed(bishop) < data.config.inventory.slotsPerCharacter;
}

/**
 * CH-77（M10）: 取り憑いた品を司教の枠に入れる（未鑑定のまま）。枠の旧品は品があった持ち主の inventory の同じ位置へ入れ、
 * 旧品が無ければその位置から取り除く → message camp.possessed{name, item} → camp.cursed{item} → clampToMax（CH-14）。
 * canForceEquip が真の前提
 */
function forceEquip(ctx: RuleContext, bishop: Character, owner: Character, instanceId: string): void {
  const { state, data } = ctx;
  const inst = state.items[instanceId]!;
  const slot = equipSlotOf(data, inst.itemId)!;
  const i = owner.inventory.indexOf(instanceId);
  if (i < 0) throw new Error(`forceEquip: ${instanceId} not in ${owner.id}`);
  const old = bishop.equipment[slot];
  if (old === null) owner.inventory.splice(i, 1);
  else owner.inventory[i] = old;
  bishop.equipment[slot] = instanceId;
  const item = itemDisplayName(state, data, instanceId);
  ctx.events.push({ kind: "message", key: "camp.possessed", params: { name: bishop.name, item } });
  ctx.events.push({ kind: "message", key: "camp.cursed", params: { item } });
  clampToMax(ctx, bishop);
}

/**
 * CH-77（M10）。checkIdentify が null を返した前提。
 * MP を mpCost 引く（mpChanged）→ randInt(1, 100) を 1 回 → dice（label dice.identify{item: 鑑定前の表示名}、内訳の行（identifyChance）
 * と最後に出目の行 identify.row.roll（base null）、基準 identify.rule{rate}、結果 dice.identify.ok / ng）。出目 ≤ rate で成功。
 * 成功: identified = true（ユニークなら図鑑。IT-66）→ message camp.identified{name, old, item, rarity} → 呪われていれば camp.identifiedCursed{item}。
 * 失敗: message camp.identifyFailed{name, item} → 迷宮内（dive が null でない）なら司教の SAN −failSanDungeon（tags 空）→
 * 品が呪われていれば chance(possessChance) を 1 回。当たれば canForceEquip なら forceEquip、そうでなければ
 * message camp.possessedSan{name, item} → 司教の SAN −possessSan（tags 空）。
 * 乱数の順: d100 →（失敗かつ呪いのときだけ）chance
 */
export function identifyItem(ctx: RuleContext, memberId: string, instanceId: string): void {
  const { state, data } = ctx;
  const ch = memberById(state, memberId);
  const inst = state.items[instanceId];
  const owner = ownerOf(state, instanceId);
  const chanceOf = identifyChance(state, data, memberId, instanceId);
  if (ch === null || inst === undefined || owner === null || chanceOf === null) {
    throw new Error(`identifyItem: bad ${memberId} / ${instanceId}`);
  }
  const c = data.config.identify;
  ch.mp -= c.mpCost;
  ctx.events.push({ kind: "mpChanged", id: ch.id, delta: -c.mpCost, mp: ch.mp });
  const old = itemDisplayName(state, data, instanceId);
  const roll = randInt(state.rng, 1, 100);
  const success = roll <= chanceOf.rate;
  ctx.events.push({
    kind: "dice",
    label: { key: "dice.identify", params: { item: old } },
    rows: [...chanceOf.rows, { label: { key: "identify.row.roll" }, base: null, dice: [roll], total: roll }],
    rule: { key: "identify.rule", params: { rate: chanceOf.rate } },
    result: { key: success ? "dice.identify.ok" : "dice.identify.ng" },
  });
  if (success) {
    identifyInstance(state, instanceId); // IT-66: ユニークなら図鑑に記録
    const item = itemDisplayName(state, data, instanceId);
    // UI-66（M8）: rarity は文には出さない（音の契機。伝説の品の鑑定で rare）
    ctx.events.push({ kind: "message", key: "camp.identified", params: { name: ch.name, old, item, rarity: inst.rarity } });
    if (inst.cursed) ctx.events.push({ kind: "message", key: "camp.identifiedCursed", params: { item } });
    return;
  }
  ctx.events.push({ kind: "message", key: "camp.identifyFailed", params: { name: ch.name, item: old } });
  if (state.dive !== null) loseSan(ctx, ch, c.failSanDungeon);
  if (!inst.cursed || !chance(state.rng, c.possessChance)) return;
  if (canForceEquip(state, data, ch, owner, instanceId)) {
    forceEquip(ctx, ch, owner, instanceId);
    return;
  }
  ctx.events.push({ kind: "message", key: "camp.possessedSan", params: { name: ch.name, item: old } });
  loseSan(ctx, ch, c.possessSan);
}

// ---------------------------------------------------------------------------
// 表示層向けの問い合わせ（純粋。state を変えない）

const BLOCK_OF: Record<string, EquipBlock> = {
  "cannot act": "cannotAct",
  "not identified": "unidentified",
  "class cannot equip": "class",
  "slot cursed": "cursedSlot",
};

/**
 * UI-53 / TW-03 のキャンプと酒場の値。campPlace が null なら null。
 * spells の usable は、対象を 1 人仮に当てたうえで checkCast === null（ally なら allies の先頭、dead なら dead の先頭）。
 * equipCandidates の block は checkEquip の理由を写したもの、slots の canUnequip は checkUnequip === null。
 */
export function campMenu(state: GameState, data: GameData): CampMenu | null {
  const place = campPlace(state);
  if (place === null) return null;
  const alive = state.party.filter((c) => c.life === "alive");
  const dead = state.party.filter((c) => c.life === "dead");
  const frontRow = data.config.party.frontRow;
  return {
    place,
    members: state.party.map((ch, i) => {
      const spells: CampSpellView[] = [];
      // M5.5: 街（酒場）でも作る。街の帰還は usable false（一覧には出す）
      for (const id of ch.knownSpells) {
        const sp = data.spells.find((s) => s.id === id);
        if (sp === undefined || !fieldSpellOk(sp)) continue;
        const target = spellTargetKind(sp);
        const probe = target === "ally" ? (alive[0]?.id ?? null) : target === "dead" ? (dead[0]?.id ?? null) : null;
        // 対象の満タン（full hp）は呪文の行では見ず、対象の行の block で出す（全員が満タンでも対象の段で理由を見せるため）
        const r = checkCast(state, data, ch.id, sp.id, probe);
        const targets = target === "ally" ? alive.map((t) => ({ id: t.id, block: healTargetBlock(state, data, sp.effect.type, t) })) : [];
        spells.push({ spellId: sp.id, name: sp.name, mp: spellCost(state, data, ch, sp), target, usable: r === null || r === "full hp", targets });
      }
      const equipCandidates: CampEquipCandidate[] = [];
      for (const id of ch.inventory) {
        const inst = state.items[id];
        if (inst === undefined) continue;
        const slot = equipSlotOf(data, inst.itemId);
        if (slot === null) continue;
        const r = checkEquip(state, data, ch.id, id);
        const block = r === null ? null : (BLOCK_OF[r] ?? null);
        if (r !== null && block === null) throw new Error(`campMenu: unexpected equip reason ${r}`);
        equipCandidates.push({ instanceId: id, name: itemDisplayName(state, data, id), slot, block });
      }
      return {
        id: ch.id,
        name: ch.name,
        life: ch.life,
        canAct: canAct(ch),
        row: i < frontRow ? ("front" as const) : ("back" as const),
        spells,
        slots: EQUIP_SLOTS.map((slot) => {
          const id = ch.equipment[slot];
          if (id === null) return { slot, instanceId: null, name: null, cursed: false, canUnequip: false };
          const inst = state.items[id];
          const cursed = inst !== undefined && inst.identified && isCursed(state, id);
          return { slot, instanceId: id, name: itemDisplayName(state, data, id), cursed, canUnequip: checkUnequip(state, data, ch.id, slot) === null };
        }),
        equipCandidates,
        canReceive: hasFreeSlot(data, ch),
      };
    }),
    allies: alive.map((c) => ({ id: c.id, name: c.name, hp: c.hp, hpMax: hpMaxOf(state, data, c) })),
    dead: dead.map((c) => ({ id: c.id, name: c.name })),
    identifiers: state.party.filter((c) => canIdentify(c, data) && canAct(c)).map((c) => ({ id: c.id, name: c.name })),
    unidentified: state.party.flatMap((c) =>
      c.inventory.flatMap((id) => {
        const inst = state.items[id];
        if (inst === undefined || inst.identified) return [];
        return [{ instanceId: id, ownerId: c.id, ownerName: c.name, name: itemDisplayName(state, data, id) }];
      }),
    ),
  };
}

/**
 * UI-53: キャンプの top のパネルの要約。迷宮のキャンプ（campPlace dungeon）のときだけ非 null。
 * 帰還の品は life を問わずパーティ全員の inventory の、効果 return の消耗品の個数（未鑑定も数える。装備は数えない）。
 * morale は宿の士気がある（TW-15。moraleOf が null でない）か。
 */
export function campSummary(state: GameState, data: GameData): CampSummary | null {
  if (campPlace(state) !== "dungeon") return null;
  const dive = state.dive;
  if (dive === null) return null;
  let returnItems = 0;
  for (const ch of state.party) {
    for (const id of ch.inventory) {
      const inst = state.items[id];
      if (inst === undefined) continue;
      const item = findItem(data, inst.itemId);
      if (item !== null && item.type === "consumable" && item.effect.type === "return") returnItems++;
    }
  }
  return {
    dungeonName: dungeonOf(data, dive.dungeonId).name,
    floor: dive.floor,
    gold: state.gold,
    ledgerItems: dive.ledger.items.length,
    ledgerGold: dive.ledger.gold,
    returnItems,
    morale: moraleOf(state, data) !== null,
  };
}
