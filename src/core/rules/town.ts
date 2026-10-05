// 街（TW-02, TW-04, TW-07, TW-08, TW-11, TW-30〜32、DG-30/43 の帰還）と、表示層向けの問い合わせ townMenu。
// 料金の式（宿のランク・寺院の 3 サービス・闇魔術・救済の蘇生費）は core のここだけに置く（表示層は townMenu の値を描く）。
// 店（TW-05 / IT-60〜65）は rules/shop.ts（M7 の B7 で切り出した。townMenu.shop は shopMenu の値）。
// dungeon.ts は import しない（dungeon → combat → … → town の向きだけにして循環を作らない）。
// 迷宮入口の可否（TW-11）は enterBlockReason が持ち、dungeon.checkEnter がそれを呼ぶ。
// 乱数を使うのは寺院の蘇生の d100（randInt(1, 100) を 1 回）と、宿屋のレベルアップ（growth の既存の順）だけ。
import type { CurableStatusId, GameData, StatBlock, StatusId } from "../data/index";
import { CURABLE_STATUS_IDS, EQUIP_SLOTS } from "../data/index";
import { randInt } from "../rng";
import { classOf, destroyItemInstance, dungeonOf, itemDisplayName, memberById, moraleOf, raisesMorale } from "../state";
import type { Character, GameState, RuleContext, TownMenu } from "../types";
import { canAct } from "./combat-calc";
import { clampToMax, effectiveStats, equipStats } from "./equip-stats";
import { levelUpWhilePossible } from "./growth";
import { ceilRatio } from "./ratio";
import { clearAllStatus } from "./field";
import { capSan, overSan, restoreSan } from "./san";
import { shopMenu } from "./shop";
import { storageMenu } from "./storage";
import { upgradeMenu } from "./upgrade";

export type TempleService = "resurrect" | "cure" | "uncurse";
/** 帰還の語りのキー（DG-30: 帰還の糸 / DG-06: 徒歩 / DG-32: テレポーター / MG-40: 帰還の呪文） */
export type ReturnKey = "dungeon.return" | "dungeon.exit" | "dungeon.teleport" | "dungeon.returnSpell";

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

/** TW-07 解呪: EQUIP_SLOTS の順で、装備中の呪われた品（実体の cursed。IT-32）の実体 id */
function cursedEquipped(state: GameState, ch: Character): string[] {
  const out: string[] = [];
  for (const slot of EQUIP_SLOTS) {
    const id = ch.equipment[slot];
    if (id === null) continue;
    const inst = state.items[id];
    if (inst === undefined) throw new Error(`cursedEquipped: unknown item instance ${id}`);
    if (inst.cursed) out.push(id);
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
  state.morale = null; // TW-15: 士気は次に街に入るまで
  ctx.events.push({ kind: "message", key: "town.enter" });
  if (data.config.san.restoreOnTown) {
    for (const ch of state.party) restoreSan(ctx, ch);
  } else {
    for (const ch of state.party) capSan(ctx, ch); // TW-02 / TW-15: 回復しない設定でも士気の超過分は丸める
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
 * （hpRatio 0 なら増えない）、MP は全ランクで mpMax に戻す →（TW-15。士気の立つランクなら）morale = { rankId } →
 * sanOver > 0 なら alive の者を並び順に overSan → message town.inn.morale → alive の者を並び順に levelUpWhilePossible（どのランクでも）。
 * 士気の立たないランクでは morale を変えない（消さない）。状態異常は治さない。満タンでも泊まれる。
 */
export function stayInn(ctx: RuleContext, rank: number): void {
  const { state, data } = ctx;
  const r = data.config.town.innRanks[rank];
  if (r === undefined) throw new Error(`stayInn: bad rank ${rank}`);
  state.gold -= r.cost;
  ctx.events.push({ kind: "message", key: "town.inn.stay", params: { room: r.name, cost: r.cost } });
  for (const ch of state.party) {
    if (ch.life !== "alive") continue;
    const es = equipStats(state, data, ch); // CH-14: 実効の最大値
    const hp = Math.min(es.hpMax, ch.hp + ceilRatio(es.hpMax, r.hpRatio));
    if (hp > ch.hp) ctx.events.push({ kind: "hpChanged", id: ch.id, delta: hp - ch.hp, hp });
    ch.hp = hp;
    const mp = es.mpMax;
    if (mp > ch.mp) ctx.events.push({ kind: "mpChanged", id: ch.id, delta: mp - ch.mp, mp });
    ch.mp = mp;
  }
  if (raisesMorale(r)) {
    state.morale = { rankId: r.id };
    if (r.sanOver > 0) {
      for (const ch of state.party) {
        if (ch.life === "alive") overSan(ctx, ch, r.sanOver);
      }
    }
    ctx.events.push({ kind: "message", key: "town.inn.morale" });
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
      if (cursedEquipped(state, ch).length === 0) return { ok: false, reason: "nothing cursed" };
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
 *   alive・HP 1（lifeChanged, hpChanged）と resurrectOk、でなければ ash（lifeChanged）と resurrectFail。status はすべて外す（CH-45。statusChanged off）、MP・SAN はそのまま
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
  switch (service) {
    case "resurrect": {
      ctx.events.push({ kind: "message", key: "town.temple.resurrectRoll", params: { name: ch.name } });
      const ok = rollResurrect(ctx, ch);
      ctx.events.push({ kind: "message", key: ok ? "town.temple.resurrectOk" : "town.temple.resurrectFail", params: { name: ch.name } });
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
      for (const id of cursedEquipped(state, ch)) {
        const item = itemDisplayName(state, data, id);
        destroyItemInstance(state, ch, id);
        ctx.events.push({ kind: "message", key: "town.temple.uncursed", params: { name: ch.name, item } });
      }
      clampToMax(ctx, ch); // CH-14: 品を失って実効の最大値が下がったら現在値を止める
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// 闇魔術（TW-08）

/** town.dark を受け付けない理由。対象は life ash の者だけ。費用は level × darkCostPerLevel（resurrectCostOf） */
export function checkDark(state: GameState, memberId: unknown, data: GameData): string | null {
  if (!inTown(state)) return "wrong screen";
  const ch = typeof memberId === "string" ? memberById(state, memberId) : null;
  if (ch === null) return "no such member";
  if (ch.life !== "ash") return "not ash";
  if (state.gold < resurrectCostOf(ch, data)) return "not enough gold";
  return null;
}

/**
 * TW-08。checkDark が null を返した前提。乱数は使わない（確定）。
 * 払う → alive・HP 1（lifeChanged, hpChanged）→ message town.dark.done。status はすべて外し、MP・SAN はそのまま（寺院の蘇生と同じ）
 */
export function darkService(ctx: RuleContext, memberId: string): void {
  const { state, data } = ctx;
  const ch = memberById(state, memberId);
  if (ch === null || ch.life !== "ash") throw new Error(`darkService: ${memberId} is not ash`);
  state.gold -= resurrectCostOf(ch, data);
  reviveAtOne(ctx, ch);
  ctx.events.push({ kind: "message", key: "town.dark.done", params: { name: ch.name } });
}

/**
 * TW-07 / MG-42: 蘇生の成功率% = min(templeSuccessMax, templeSuccessBase + vit × templeSuccessPerVit)。寺院と呪文で共有する。
 * vit は対象の実効の能力値（CH-13。rollResurrect が渡す。省略は素の値）
 */
export function resurrectRate(ch: Character, data: GameData, stats: StatBlock = ch.stats): number {
  const e = data.config.economy;
  return Math.min(e.templeSuccessMax, e.templeSuccessBase + stats.vit * e.templeSuccessPerVit);
}

/**
 * TW-07 / MG-42: 蘇生の判定。randInt(1, 100) を 1 回引き、resurrectRate 以下なら alive・HP 1（lifeChanged alive → [hpChanged]）、
 * そうでなければ ash（lifeChanged ash）。message と dice は出さない（呼び出し側が語りを出す）。成功なら true
 */
export function rollResurrect(ctx: RuleContext, ch: Character): boolean {
  if (ch.life !== "dead") throw new Error(`rollResurrect: ${ch.id} is not dead`);
  const roll = randInt(ctx.state.rng, 1, 100);
  if (roll <= resurrectRate(ch, ctx.data, effectiveStats(ctx.state, ctx.data, ch))) {
    reviveAtOne(ctx, ch);
    return true;
  }
  ch.life = "ash";
  ctx.events.push({ kind: "lifeChanged", id: ch.id, life: "ash" });
  clearAllStatus(ctx, ch); // CH-45（死亡で外れているはずだが、古い保存の死者に残っていても灰では持たない）
  return false;
}

/** life を alive・HP 1 にする（寺院の蘇生の成功・闇魔術・救済）。lifeChanged の後に、HP が変わったら hpChanged、状態異常をすべて外す（statusChanged off） */
function reviveAtOne(ctx: RuleContext, ch: Character): void {
  ch.life = "alive";
  ctx.events.push({ kind: "lifeChanged", id: ch.id, life: "alive" });
  if (ch.hp !== 1) ctx.events.push({ kind: "hpChanged", id: ch.id, delta: 1 - ch.hp, hp: 1 });
  ch.hp = 1;
  clearAllStatus(ctx, ch); // TW-07 / TW-08 / TW-31: 生き返る者は常に状態異常なし（全滅の復活 TW-23 と同じく hpChanged の後）
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
      morale: raisesMorale(r),
    })),
    morale: (() => {
      const m = moraleOf(state, data);
      return m === null ? null : { rankId: m.id, name: m.name };
    })(),
    temple: { resurrect: rows("resurrect"), cure: rows("cure"), uncurse: rows("uncurse") },
    dark: state.party.flatMap((ch) => {
      if (ch.life !== "ash") return [];
      const cost = resurrectCostOf(ch, data);
      return [{ memberId: ch.id, name: ch.name, cost, affordable: gold >= cost }];
    }),
    shop: shopMenu(state, data), // TW-05 / IT-60〜65（rules/shop.ts）
    storage: storageMenu(state, data), // TW-16 / IT-64（rules/storage.ts）
    upgrade: upgradeMenu(state, data), // TW-17（rules/upgrade.ts）
    mercy: offered
      ? state.party.flatMap((ch) => (ch.life === "alive" ? [] : [{ memberId: ch.id, name: ch.name, life: ch.life }]))
      : null,
    dungeons: state.progress.unlockedDungeons.map((id) => ({
      id,
      name: dungeonOf(data, id).name,
      canEnter: enterBlockReason(state, id, data) === null,
    })),
    // TW-03（M5.5）: camp.ts を import しない（循環を作らない）ので、campMenu の identifiers と同じ条件をここで数える
    canIdentify: state.party.some((c) => canAct(c) && classOf(data, c.classId).abilities.includes("identify")),
  };
}
