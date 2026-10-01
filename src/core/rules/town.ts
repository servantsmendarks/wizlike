// 街（TW-02, TW-04, TW-07, TW-11, TW-30〜32、DG-30/43 の帰還）と、表示層向けの問い合わせ townMenu。
// 料金の式（宿のランク・寺院の 3 サービス・救済の蘇生費）は core のここだけに置く（表示層は townMenu の値を描く）。
// dungeon.ts は import しない（dungeon → combat → … → town の向きだけにして循環を作らない）。
// 迷宮入口の可否（TW-11）は enterBlockReason が持ち、dungeon.checkEnter がそれを呼ぶ。
// 乱数を使うのは寺院の蘇生の d100（randInt(1, 100) を 1 回）と、宿屋のレベルアップ（growth の既存の順）だけ。
import type { CurableStatusId, GameData, StatusId } from "../data/index";
import { CURABLE_STATUS_IDS, EQUIP_SLOTS } from "../data/index";
import { randInt } from "../rng";
import { destroyItemInstance, dungeonOf, itemDisplayName, itemOf, memberById } from "../state";
import type { Character, GameState, RuleContext, TownMenu } from "../types";
import { canAct } from "./combat-calc";
import { levelUpWhilePossible } from "./growth";
import { ceilRatio } from "./ratio";
import { restoreSan } from "./san";

export type TempleService = "resurrect" | "cure" | "uncurse";
/** 帰還の語りのキー（DG-30: 帰還の糸 / DG-06: 徒歩 / DG-32: テレポーター） */
export type ReturnKey = "dungeon.return" | "dungeon.exit" | "dungeon.teleport";

const TEMPLE_SERVICES: readonly TempleService[] = ["resurrect", "cure", "uncurse"];

function isCurable(s: StatusId): s is CurableStatusId {
  return (CURABLE_STATUS_IDS as readonly StatusId[]).includes(s);
}

// ---------------------------------------------------------------------------
// 料金と候補（TW-07, TW-08, TW-30）

/** TW-07 / TW-08 / TW-30: dead は寺院（level × templeCostPerLevel）、ash は闇魔術（level × darkCostPerLevel）。alive は Error */
export function resurrectCostOf(ch: Character, data: GameData): number {
  const e = data.config.economy;
  if (ch.life === "dead") return ch.level * e.templeCostPerLevel;
  if (ch.life === "ash") return ch.level * e.darkCostPerLevel;
  throw new Error(`resurrectCostOf: ${ch.id} is alive`);
}

/** TW-07 治療: ch.status の順のうち cureCost のキー（毒・麻痺・石化）と、その cureCost の合計 */
function cureOf(ch: Character, data: GameData): { statuses: CurableStatusId[]; cost: number } {
  const statuses = ch.status.filter(isCurable);
  let cost = 0;
  for (const s of statuses) cost += data.config.economy.cureCost[s];
  return { statuses, cost };
}

/** TW-07 解呪: EQUIP_SLOTS の順で、装備中の呪われた品（items[].cursed）の実体 id */
function cursedEquipped(state: GameState, data: GameData, ch: Character): string[] {
  const out: string[] = [];
  for (const slot of EQUIP_SLOTS) {
    const id = ch.equipment[slot];
    if (id === null) continue;
    const inst = state.items[id];
    if (inst === undefined) throw new Error(`cursedEquipped: unknown item instance ${id}`);
    if (itemOf(data, inst.itemId).cursed) out.push(id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 街に入る（TW-02, TW-26, TW-30）

/**
 * TW-30: リーダー以外が 1 人以上いて全員 dead / ash、かつ 所持金 + 銀行 < dead / ash の者それぞれの蘇生費の最小。
 * 同じ来訪の中では判定し直さない（arriveTown が 1 回だけ呼ぶ）。
 */
export function mercyEligible(state: GameState, data: GameData): boolean {
  const nonLeaders = state.party.filter((c) => !c.isLeader);
  if (nonLeaders.length === 0 || nonLeaders.some((c) => c.life === "alive")) return false;
  let cheapest = Infinity;
  for (const c of state.party) {
    if (c.life === "alive") continue;
    cheapest = Math.min(cheapest, resurrectCostOf(c, data));
  }
  return state.gold + state.bank < cheapest;
}

/**
 * 街に入る処理（TW-02, TW-26, TW-30。仕様の「town.enter と同じ処理」の実体。town.enter コマンドは受け付けない）。
 * 呼び出し側が dive / battle / pendingChoice を null にしてある前提。乱数は使わない。
 * 順: screen と townVisit → message town.enter → SAN の回復（life を問わず並び順）→ 救済の判定（town.mercy.offer）→ screen{town}
 */
export function arriveTown(ctx: RuleContext): void {
  const { state, data } = ctx;
  if (state.dive !== null || state.battle !== null || state.pendingChoice !== null) {
    throw new Error("arriveTown: dive / battle / pendingChoice must be null");
  }
  state.screen = "town";
  state.townVisit = { mercyOffered: false };
  ctx.events.push({ kind: "message", key: "town.enter" });
  if (data.config.san.restoreOnTown) {
    for (const ch of state.party) restoreSan(ctx, ch);
  }
  if (mercyEligible(state, data)) {
    state.townVisit.mercyOffered = true;
    ctx.events.push({ kind: "message", key: "town.mercy.offer" });
  }
  ctx.events.push({ kind: "screen", to: "town" });
}

/**
 * DG-30 / DG-43: 迷宮から街へ帰る（帰還の糸・徒歩・テレポーター）。戦闘中は Error。乱数は使わない。
 * message key → dive を捨てる（台帳は捨てるだけ。品と金は既に所持に入っているので、それで確定する）→ pendingChoice を下ろす → arriveTown
 */
export function returnToTown(ctx: RuleContext, key: ReturnKey): void {
  const { state } = ctx;
  if (state.battle !== null) throw new Error("returnToTown: in battle");
  if (state.dive === null) throw new Error("returnToTown: not in dungeon");
  ctx.events.push({ kind: "message", key });
  state.dive = null;
  state.pendingChoice = null;
  arriveTown(ctx);
}

// ---------------------------------------------------------------------------
// 迷宮入口（TW-11）

/** dungeon.enter を受け付けない理由。受け付けるなら null（dungeon.checkEnter の実体。townMenu の canEnter と同じ判定） */
export function enterBlockReason(state: GameState, dungeonId: unknown, data: GameData): string | null {
  if (state.screen !== "town") return "wrong screen";
  if (state.dive !== null) return "already diving";
  if (typeof dungeonId !== "string" || !data.dungeons.some((d) => d.id === dungeonId)) return "unknown dungeon";
  if (!state.progress.unlockedDungeons.includes(dungeonId)) return "not unlocked";
  if (!state.party.some(canAct)) return "no one can act";
  return null;
}

// ---------------------------------------------------------------------------
// 宿屋（TW-04, CH-61, MG-20〜24）

function inTown(state: GameState): boolean {
  return state.screen === "town" && state.dive === null;
}

/** town.inn を受け付けない理由。rank は config.town.innRanks の添字 */
export function checkInn(state: GameState, rank: unknown, data: GameData): string | null {
  if (!inTown(state)) return "wrong screen";
  const ranks = data.config.town.innRanks;
  if (typeof rank !== "number" || !Number.isInteger(rank) || rank < 0 || rank >= ranks.length) return "bad rank";
  if (state.gold < ranks[rank]!.cost) return "not enough gold";
  return null;
}

/**
 * TW-04 / MG-02: 料金を 1 回払う → message town.inn.stay → alive の者を並び順に、HP に ceil(hpMax × hpRatio) を足して hpMax で止め
 * （hpRatio 0 なら増えない）、MP は全ランクで mpMax に戻す → alive の者を並び順に levelUpWhilePossible（どのランクでも）。
 * 状態異常は治さない。満タンでも泊まれる。
 */
export function stayInn(ctx: RuleContext, rank: number): void {
  const { state, data } = ctx;
  const r = data.config.town.innRanks[rank];
  if (r === undefined) throw new Error(`stayInn: bad rank ${rank}`);
  state.gold -= r.cost;
  ctx.events.push({ kind: "message", key: "town.inn.stay", params: { room: r.name, cost: r.cost } });
  for (const ch of state.party) {
    if (ch.life !== "alive") continue;
    const hp = Math.min(ch.hpMax, ch.hp + ceilRatio(ch.hpMax, r.hpRatio));
    if (hp > ch.hp) ctx.events.push({ kind: "hpChanged", id: ch.id, delta: hp - ch.hp, hp });
    ch.hp = hp;
    const mp = ch.mpMax;
    if (mp > ch.mp) ctx.events.push({ kind: "mpChanged", id: ch.id, delta: mp - ch.mp, mp });
    ch.mp = mp;
  }
  for (const ch of state.party) {
    if (ch.life === "alive") levelUpWhilePossible(ctx, ch);
  }
}

// ---------------------------------------------------------------------------
// 寺院（TW-07）

/** 寺院のサービスの費用。受けられなければ理由（英語）。checkTemple と townMenu で共有 */
function templeQuote(
  state: GameState,
  data: GameData,
  ch: Character,
  service: TempleService,
): { ok: true; cost: number } | { ok: false; reason: string } {
  const e = data.config.economy;
  switch (service) {
    case "resurrect":
      if (ch.life !== "dead") return { ok: false, reason: "not dead" };
      return { ok: true, cost: resurrectCostOf(ch, data) };
    case "cure": {
      if (ch.life !== "alive") return { ok: false, reason: "not alive" };
      const c = cureOf(ch, data);
      if (c.statuses.length === 0) return { ok: false, reason: "nothing to cure" };
      return { ok: true, cost: c.cost };
    }
    case "uncurse":
      if (cursedEquipped(state, data, ch).length === 0) return { ok: false, reason: "nothing cursed" };
      return { ok: true, cost: e.uncurseCost };
  }
}

/** town.temple を受け付けない理由 */
export function checkTemple(state: GameState, memberId: unknown, service: unknown, data: GameData): string | null {
  if (!inTown(state)) return "wrong screen";
  const ch = typeof memberId === "string" ? memberById(state, memberId) : null;
  if (ch === null) return "no such member";
  if (typeof service !== "string" || !(TEMPLE_SERVICES as readonly string[]).includes(service)) return "bad service";
  const q = templeQuote(state, data, ch, service as TempleService);
  if (!q.ok) return q.reason;
  if (state.gold < q.cost) return "not enough gold";
  return null;
}

/**
 * TW-07。checkTemple が null を返した前提。
 * - resurrect: 払う → message resurrectRoll → d100（dice イベントなし）≤ min(templeSuccessMax, base + vit × perVit) なら
 *   alive・HP 1（lifeChanged, hpChanged）と resurrectOk、でなければ ash（lifeChanged）と resurrectFail。status・MP・SAN はそのまま
 * - cure: 払う → 毒・麻痺・石化を status の順に外す（statusChanged off）→ message town.temple.cured
 * - uncurse: uncurseCost を 1 回払う → 装備中の呪われた品を EQUIP_SLOTS の順に 1 個ずつ失う（message town.temple.uncursed）
 */
export function templeService(ctx: RuleContext, memberId: string, service: TempleService): void {
  const { state, data } = ctx;
  const ch = memberById(state, memberId);
  if (ch === null) throw new Error(`templeService: unknown member ${memberId}`);
  const q = templeQuote(state, data, ch, service);
  if (!q.ok) throw new Error(`templeService: ${q.reason}`);
  state.gold -= q.cost;
  const e = data.config.economy;
  switch (service) {
    case "resurrect": {
      ctx.events.push({ kind: "message", key: "town.temple.resurrectRoll", params: { name: ch.name } });
      const roll = randInt(state.rng, 1, 100);
      const rate = Math.min(e.templeSuccessMax, e.templeSuccessBase + ch.stats.vit * e.templeSuccessPerVit);
      if (roll <= rate) {
        reviveAtOne(ctx, ch);
        ctx.events.push({ kind: "message", key: "town.temple.resurrectOk", params: { name: ch.name } });
      } else {
        ch.life = "ash";
        ctx.events.push({ kind: "lifeChanged", id: ch.id, life: "ash" });
        ctx.events.push({ kind: "message", key: "town.temple.resurrectFail", params: { name: ch.name } });
      }
      return;
    }
    case "cure": {
      for (const s of cureOf(ch, data).statuses) {
        ch.status = ch.status.filter((x) => x !== s);
        ctx.events.push({ kind: "statusChanged", id: ch.id, status: s, on: false });
      }
      ctx.events.push({ kind: "message", key: "town.temple.cured", params: { name: ch.name } });
      return;
    }
    case "uncurse": {
      for (const id of cursedEquipped(state, data, ch)) {
        const item = itemDisplayName(state, data, id);
        destroyItemInstance(state, ch, id);
        ctx.events.push({ kind: "message", key: "town.temple.uncursed", params: { name: ch.name, item } });
      }
      return;
    }
  }
}

/** life を alive・HP 1 にする（寺院の蘇生の成功・救済）。lifeChanged の後に、HP が変わったら hpChanged */
function reviveAtOne(ctx: RuleContext, ch: Character): void {
  ch.life = "alive";
  ctx.events.push({ kind: "lifeChanged", id: ch.id, life: "alive" });
  if (ch.hp !== 1) ctx.events.push({ kind: "hpChanged", id: ch.id, delta: 1 - ch.hp, hp: 1 });
  ch.hp = 1;
}

// ---------------------------------------------------------------------------
// GM の救済（TW-31, TW-32）

/** town.mercy を受け付けない理由。対象は dead / ash の誰でもよい（リーダーも選べる） */
export function checkMercy(state: GameState, memberId: unknown): string | null {
  if (!inTown(state) || state.townVisit === null) return "wrong screen";
  if (!state.townVisit.mercyOffered) return "no mercy";
  const ch = typeof memberId === "string" ? memberById(state, memberId) : null;
  if (ch === null) return "no such member";
  if (ch.life === "alive") return "not dead";
  return null;
}

/** TW-31: 申し出を下ろす → alive・HP 1（失敗しない。dead も ash も）→ message town.mercy.done。乱数は使わない */
export function grantMercy(ctx: RuleContext, memberId: string): void {
  const { state } = ctx;
  const ch = memberById(state, memberId);
  if (ch === null || state.townVisit === null) throw new Error(`grantMercy: bad state for ${memberId}`);
  state.townVisit.mercyOffered = false;
  reviveAtOne(ctx, ch);
  ctx.events.push({ kind: "message", key: "town.mercy.done", params: { name: ch.name } });
}

// ---------------------------------------------------------------------------
// 表示層向けの問い合わせ（純粋。state を変えない）

/** UI-52 の街のメニューの値。screen が town でなければ null */
export function townMenu(state: GameState, data: GameData): TownMenu | null {
  if (state.screen !== "town") return null;
  const gold = state.gold;
  const rows = (service: TempleService) =>
    state.party.flatMap((ch) => {
      const q = templeQuote(state, data, ch, service);
      return q.ok ? [{ memberId: ch.id, name: ch.name, cost: q.cost, affordable: gold >= q.cost }] : [];
    });
  const offered = state.townVisit !== null && state.townVisit.mercyOffered;
  return {
    gold,
    inn: data.config.town.innRanks.map((r, rank) => ({
      rank,
      id: r.id,
      name: r.name,
      cost: r.cost,
      affordable: gold >= r.cost,
    })),
    temple: { resurrect: rows("resurrect"), cure: rows("cure"), uncurse: rows("uncurse") },
    mercy: offered
      ? state.party.flatMap((ch) => (ch.life === "alive" ? [] : [{ memberId: ch.id, name: ch.name, life: ch.life }]))
      : null,
    dungeons: state.progress.unlockedDungeons.map((id) => ({
      id,
      name: dungeonOf(data, id).name,
      canEnter: enterBlockReason(state, id, data) === null,
    })),
  };
}
