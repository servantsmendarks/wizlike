// キャンプと酒場のコマンド（MG-44 dungeon.cast、CH-03 party.reorder、CH-76 party.equip / party.unequip、CH-77 party.identify）と、
// 表示層向けの問い合わせ campMenu（UI-53 / TW-03）。
// 受け付ける場所は campPlace が決める（街、または迷宮の戦闘外かつ保留なし。dungeon.cast だけは迷宮のみ）。
// 乱数を使うのは dungeon.cast の heal（対象ごとに effect.dice を 1 回）と resurrect（randInt(1, 100) を 1 回）だけ。
// town.ts からはこのファイルを import しない（循環を作らない）。
import type { EquipItem, EquipSlot, GameData, Item, Spell } from "../data/index";
import { EQUIP_SLOTS } from "../data/index";
import { classOf, itemDisplayName, itemOf, memberById, spellOf } from "../state";
import type {
  CampEquipCandidate,
  CampMenu,
  CampPlace,
  CampSpellView,
  Character,
  EquipBlock,
  GameState,
  RuleContext,
} from "../types";
import { canAct } from "./combat-calc";
import { applyAllyEffect } from "./effects";
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

/** 装備品（items[].type が EQUIP_SLOTS のどれか）ならその品、そうでなければ null */
function asEquip(item: Item): EquipItem | null {
  return item.type === "consumable" || item.type === "book" ? null : item;
}

/** 装備品なら装備先のスロット（items[].slot）。装備品でなければ null */
function equipSlotOf(item: Item): EquipSlot | null {
  return asEquip(item)?.slot ?? null;
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
 * 順: not in dungeon → no such member → cannot act → unknown spell → not usable here → no mp → bad target
 */
export function checkCast(
  state: GameState,
  data: GameData,
  memberId: unknown,
  spellId: unknown,
  targetId: unknown,
): string | null {
  if (campPlace(state) !== "dungeon") return "not in dungeon";
  const ch = typeof memberId === "string" ? memberById(state, memberId) : null;
  if (ch === null) return "no such member";
  if (!canAct(ch)) return "cannot act";
  if (typeof spellId !== "string" || !data.spells.some((s) => s.id === spellId) || !ch.knownSpells.includes(spellId)) {
    return "unknown spell";
  }
  const sp = spellOf(data, spellId);
  if (!fieldSpellOk(sp)) return "not usable here";
  if (ch.mp < sp.mp) return "no mp";
  const kind = spellTargetKind(sp);
  if (kind !== "none") {
    const t = typeof targetId === "string" ? memberById(state, targetId) : null;
    if (t === null || t.life !== (kind === "dead" ? "dead" : "alive")) return "bad target";
  }
  return null;
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
  ch.mp -= sp.mp;
  ctx.events.push({ kind: "mpChanged", id: ch.id, delta: -sp.mp, mp: ch.mp });
  ctx.events.push({ kind: "message", key: "battle.cast", params: { actor: ch.name, spell: sp.name } });
  const e = sp.effect;
  switch (e.type) {
    case "heal":
    case "cureStatus": {
      const targets = castTargets(state, ch, sp, targetId);
      applyAllyEffect(ctx, e.type === "heal" ? { type: "heal", dice: e.dice } : { type: "cureStatus", status: e.status }, targets);
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

/** 呪われた品か（鑑定と関係なく items[].cursed。CH-73） */
function isCursed(state: GameState, data: GameData, instanceId: string): boolean {
  const inst = state.items[instanceId];
  if (inst === undefined) throw new Error(`isCursed: unknown item instance ${instanceId}`);
  return itemOf(data, inst.itemId).cursed;
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
  const item = asEquip(itemOf(data, inst.itemId));
  if (item === null) return "not equipment";
  const slot = item.slot;
  if (!inst.identified) return "not identified";
  if (item.classes.length > 0 && !item.classes.includes(ch.classId)) return "class cannot equip";
  const old = ch.equipment[slot];
  if (old !== null && isCursed(state, data, old)) return "slot cursed";
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
  const slot = equipSlotOf(itemOf(data, inst.itemId));
  if (slot === null) throw new Error(`equipItem: not equipment ${inst.itemId}`);
  const i = ch.inventory.indexOf(instanceId);
  if (i < 0) throw new Error(`equipItem: ${instanceId} not in inventory`);
  const old = ch.equipment[slot];
  if (old === null) ch.inventory.splice(i, 1);
  else ch.inventory[i] = old;
  ch.equipment[slot] = instanceId;
  const item = itemDisplayName(state, data, instanceId);
  ctx.events.push({ kind: "message", key: "camp.equipped", params: { name: ch.name, item } });
  if (isCursed(state, data, instanceId)) ctx.events.push({ kind: "message", key: "camp.cursed", params: { item } });
}

/** party.unequip を受け付けない理由。順: wrong screen → no such member → cannot act → bad slot → slot empty → cursed */
export function checkUnequip(state: GameState, data: GameData, memberId: unknown, slot: unknown): string | null {
  if (campPlace(state) === null) return "wrong screen";
  const ch = typeof memberId === "string" ? memberById(state, memberId) : null;
  if (ch === null) return "no such member";
  if (!canAct(ch)) return "cannot act";
  if (!isEquipSlot(slot)) return "bad slot";
  const id = ch.equipment[slot];
  if (id === null) return "slot empty";
  if (isCursed(state, data, id)) return "cursed";
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
 * party.identify を受け付けない理由。順: wrong screen → no such member → cannot identify → cannot act → no such item →
 * already identified
 */
export function checkIdentify(state: GameState, data: GameData, memberId: unknown, instanceId: unknown): string | null {
  if (campPlace(state) === null) return "wrong screen";
  const ch = typeof memberId === "string" ? memberById(state, memberId) : null;
  if (ch === null) return "no such member";
  if (!canIdentify(ch, data)) return "cannot identify";
  if (!canAct(ch)) return "cannot act";
  if (typeof instanceId !== "string" || ownerOf(state, instanceId) === null || state.items[instanceId] === undefined) {
    return "no such item";
  }
  if (state.items[instanceId]!.identified) return "already identified";
  return null;
}

/**
 * CH-77。checkIdentify が null を返した前提。確定・無料・乱数なし。
 * identified = true → message camp.identified{name, old, item} → 呪われていれば message camp.identifiedCursed{item}
 */
export function identifyItem(ctx: RuleContext, memberId: string, instanceId: string): void {
  const { state, data } = ctx;
  const ch = memberById(state, memberId);
  const inst = state.items[instanceId];
  if (ch === null || inst === undefined) throw new Error(`identifyItem: bad ${memberId} / ${instanceId}`);
  const old = itemDisplayName(state, data, instanceId);
  inst.identified = true;
  const item = itemOf(data, inst.itemId);
  ctx.events.push({ kind: "message", key: "camp.identified", params: { name: ch.name, old, item: item.name } });
  if (item.cursed) ctx.events.push({ kind: "message", key: "camp.identifiedCursed", params: { item: item.name } });
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
      if (place === "dungeon") {
        for (const id of ch.knownSpells) {
          const sp = data.spells.find((s) => s.id === id);
          if (sp === undefined || !fieldSpellOk(sp)) continue;
          const target = spellTargetKind(sp);
          const probe = target === "ally" ? (alive[0]?.id ?? null) : target === "dead" ? (dead[0]?.id ?? null) : null;
          spells.push({ spellId: sp.id, name: sp.name, mp: sp.mp, target, usable: checkCast(state, data, ch.id, sp.id, probe) === null });
        }
      }
      const equipCandidates: CampEquipCandidate[] = [];
      for (const id of ch.inventory) {
        const inst = state.items[id];
        if (inst === undefined) continue;
        const slot = equipSlotOf(itemOf(data, inst.itemId));
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
          const cursed = inst !== undefined && inst.identified && isCursed(state, data, id);
          return { slot, instanceId: id, name: itemDisplayName(state, data, id), cursed, canUnequip: checkUnequip(state, data, ch.id, slot) === null };
        }),
        equipCandidates,
      };
    }),
    allies: alive.map((c) => ({ id: c.id, name: c.name, hp: c.hp, hpMax: c.hpMax })),
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
