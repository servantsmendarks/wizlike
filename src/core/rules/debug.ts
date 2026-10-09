// UI-57（開発用）: debug パネルのコマンド。全滅の流れ（M4 の実機の結果、ユーザー指示）と、
// M5 の性格・イベント・SAN を実機で確かめるためのもの。乱数は使わない（例外は debug.chest{present: true}。衝動・制止・掛け合いが state.rng を使う。M12 の debug.levels も HP のダイスと習得判定に、M14 から能力値の成長 CH-61 にも state.rng を使う）。
import { optionAppliesTo, optionKindOf, type StatKey } from "../data/index";
import { classOf, createItemInstance, itemDisplayName, slotsUsed } from "../state";
import type { RuleContext } from "../types";
import { placeDebugChest, type StartAlarm } from "./chest";
import { cellAt } from "./dungeon-gen";
import { floorOf, markExplored, warpTarget } from "./dungeon";
import { equipStats } from "./equip-stats";
import { expFor, levelDownWhileBelow, levelUpOnce } from "./growth";
import { loseSan, overSan, sanCapOf, sanJustBelow, sanStage } from "./san";

/**
 * debug.hpOne: 並び順に、life alive で hp が 1 でない者の hp を 1 にして hpChanged を出す（dead / ash は変えない）。
 * 最後に message debug.hpOne を出す（変わった者がいなくても出す）。hp 1 で行動不能になる者はいないので、
 * 迷宮の戦闘外でも全滅処理（finish の wipeIfNoneCanAct）は起きない
 */
export function hpOne(ctx: RuleContext): void {
  for (const ch of ctx.state.party) {
    if (ch.life !== "alive" || ch.hp === 1) continue;
    const delta = 1 - ch.hp;
    ch.hp = 1;
    ctx.events.push({ kind: "hpChanged", id: ch.id, delta, hp: 1 });
  }
  ctx.events.push({ kind: "message", key: "debug.hpOne" });
}

/**
 * debug.sanDown（M5）: 並び順に、リーダー以外で life alive の者の SAN を今の段の次の段へ下げる
 * （normal → 不安の境の 1 つ下、uneasy → 錯乱の境の 1 つ下、confused → 0、broken はそのまま）。
 * loseSan（耐性のタグなし）を通すので sanChanged と段の message は通常どおり。最後に message debug.sanDown（変化が無くても出す）。
 * リーダーを外すのは、リーダーが行動可能なら全滅せずに「SAN 0 で行動不能」を実機で見られるため
 */
export function sanDown(ctx: RuleContext): void {
  const cfg = ctx.data.config;
  for (const ch of ctx.state.party) {
    if (ch.isLeader || ch.life !== "alive") continue;
    const max = sanCapOf(ctx.state, ctx.data, ch); // CH-53: 段は実効の sanMax 比
    const stage = sanStage(ch.san, max, cfg);
    if (stage === "broken") continue;
    const next = stage === "normal" ? "uneasy" : stage === "uneasy" ? "confused" : "broken";
    const target = sanJustBelow(next, max, cfg);
    loseSan(ctx, ch, Math.max(0, ch.san - target), []);
  }
  ctx.events.push({ kind: "message", key: "debug.sanDown" });
}

/** debug.sanOver の超過量（開発用の道具の値で、ゲームの調整値ではないので config に置かない。ラベルの n にも使う） */
export const SAN_OVER_DEBUG = 10;

/**
 * debug.sanOver（M7）: 並び順に、life alive の者の SAN を sanCapOf（実効の sanMax）+ SAN_OVER_DEBUG にする
 * （overSan を通すので、今の方が高ければ変えない・下げない。士気が無くても超過させ、虚脱（0）からでも上げる）。
 * 最後に message debug.sanOver{n}（変化が無くても出す）。士気中の制止判定の成功（TW-15）で SAN が超過分を超えて増えないことを
 * 実機で確かめるため。超過の後の扱いは san.ts の規則のまま（減少は超過分から引き、増加は止まり、街に入ると丸める）。乱数は使わない
 */
export function sanOver(ctx: RuleContext): void {
  for (const ch of ctx.state.party) {
    if (ch.life !== "alive") continue;
    overSan(ctx, ch, SAN_OVER_DEBUG);
  }
  ctx.events.push({ kind: "message", key: "debug.sanOver", params: { n: SAN_OVER_DEBUG } });
}

/**
 * debug.warp（M5）: warpTarget の位置へ移り、目標を向く。行き先が無ければ message debug.warp.none だけ（state は変えない）。
 * あれば pos / facing を書き換え → 視野を explored に足す → moved → message debug.warp.<to>。遭遇・毒・罠は起こさない
 */
export function warp(ctx: RuleContext, to: "event" | "trap" | "stairsDown" | "chest"): void {
  const { state, data } = ctx;
  const dive = state.dive;
  if (dive === null) throw new Error("warp: not in dungeon");
  const t = warpTarget(state, data, to);
  if (t === null) {
    ctx.events.push({ kind: "message", key: "debug.warp.none" });
    return;
  }
  // UI-57（M9）: 最下層の「階段前」はボスの手前（warpTarget）。語りは debug.warp.boss
  const key = to === "stairsDown" && floorOf(dive, data).stairsDown === null ? "boss" : to;
  dive.pos = { x: t.pos.x, y: t.pos.y };
  dive.facing = t.facing;
  markExplored(dive, floorOf(dive, data), data.config.dungeon.viewDepth);
  ctx.events.push({ kind: "moved", pos: { x: dive.pos.x, y: dive.pos.y }, facing: dive.facing });
  ctx.events.push({ kind: "message", key: `debug.warp.${key}` });
}

/**
 * debug.addTurns（M5.5）: adventureTurns に config.town.tavernEventTurns を足し、message debug.addTurns{n, total} を出す。
 * 酒場のイベント（TW-14）を実機で確かめるため。乱数は使わない
 */
export function addTurns(ctx: RuleContext): void {
  const n = ctx.data.config.town.tavernEventTurns;
  ctx.state.adventureTurns += n;
  ctx.events.push({ kind: "message", key: "debug.addTurns", params: { n, total: ctx.state.adventureTurns } });
}

/**
 * debug.giveCursed（M10）: 呪われた未鑑定の装備品の実体を 1 つ作り、並び順で最初に使用枠（CH-71）の空いた者（life を問わない。IT-54 と同じ）の
 * inventory の末尾に入れる。品は equipment-bases.json の並びで最初の、鑑定できる職業（abilities に identify）のすべてが装備できる（wearable 真）／
 * どれも装備できない（偽）ベース。Lv0・通常・ユニークでない。オプションはその品種に付けられる最初の 1 つ（段階 1）の値を負にしたもの
 * （IT-32 の「呪いの余分の 1 個の符号を反転」と同じ形）。迷宮内なら潜行台帳（DG-40）に入れ、foundIn はそのダンジョン（街では null）。
 * message debug.giveCursed{name, item}（item は未鑑定の表示名）。誰も空いていない・該当するベースが無ければ実体を作らず message debug.giveCursed.full /
 * debug.giveCursed.none。取り憑き（CH-77）・街での鑑定の失敗・呪いの警告を実機で確かめるため。乱数は使わない
 */
export function giveCursed(ctx: RuleContext, wearable: boolean): void {
  const { state, data } = ctx;
  const identifiers = data.classes.filter((c) => c.abilities.includes("identify")).map((c) => c.id);
  const canWear = (classes: readonly string[], classId: string): boolean => classes.length === 0 || classes.includes(classId);
  const base = data.equipmentBases.find((b) =>
    wearable ? identifiers.every((id) => canWear(b.classes, id)) : identifiers.every((id) => !canWear(b.classes, id)),
  );
  if (base === undefined) {
    ctx.events.push({ kind: "message", key: "debug.giveCursed.none" });
    return;
  }
  const ch = state.party.find((c) => slotsUsed(c) < data.config.inventory.slotsPerCharacter);
  if (ch === undefined) {
    ctx.events.push({ kind: "message", key: "debug.giveCursed.full" });
    return;
  }
  const kind = optionKindOf(base);
  const option = data.itemOptions.options.find((o) => optionAppliesTo(o, kind));
  const options = option === undefined ? [] : [{ optionId: option.id, tier: 1 as const, value: -option.values[0]! }];
  const id = createItemInstance(state, {
    itemId: base.id,
    identified: false,
    cursed: true,
    options,
    foundIn: state.dive === null ? null : state.dive.dungeonId,
  });
  ch.inventory.push(id);
  if (state.dive !== null) state.dive.ledger.items.push(id);
  ctx.events.push({ kind: "message", key: "debug.giveCursed", params: { name: ch.name, item: itemDisplayName(state, data, id) } });
}

/**
 * debug.levels のボタンが巡回する目標の Lv（M12。U-6）。d01 のボス（Lv4）・d02 のボス（Lv5）・d03（Lv5〜7）を数分で通すための開発用の値で、
 * ゲームの調整値ではないので config に置かない（SAN_OVER_DEBUG と同じ）。core はこの並びを使わず、表示層のラベルと巡回だけが使う
 */
export const DEBUG_LEVELS: readonly number[] = [5, 8, 11];

/** debug.levels の目標の Lv の上限（開発用。expFor の値が大きくなりすぎないように） */
export const DEBUG_LEVEL_MAX = 30;

/**
 * debug.levels（M12。U-6）: 並び順に、life alive の者の exp を expFor(level) にし、level を合わせる。dead / ash は変えない。
 * 上げるときは growth の levelUpOnce を 1 段ずつ（宿と同じ。HP のダイス → 全体の最高到達レベルを超える段では能力値の成長 CH-61 の 6 回（M14）→
 * 今の職業で初到達の段の習得判定（MG-20〜24）に state.rng を使う）。levelHistory・maxLevelReached は宿のレベルアップと同じに積む。
 * 下げるときは levelDownWhileBelow（CH-62。乱数なし）。途中の語り・ダイス・spellLearned は捨て、変わった者ごとに levelUp（hpGain / mpGain は合計、
 * statGains は段ごとに上がった能力値を順につないだ配列（重複あり。M14））か levelDown を 1 件と
 * message debug.levels.member{name, from, to, learned} を出す。最後に message debug.levels{level}（誰も変わらなくても出す）
 */
export function setLevels(ctx: RuleContext, level: number): void {
  const { state, data } = ctx;
  // 途中の events は捨てる（state は同じものを書き換える）
  const quiet: RuleContext = { state, data, events: [] };
  for (const ch of state.party) {
    if (ch.life !== "alive") continue;
    const from = ch.level;
    const known = ch.knownSpells.length;
    ch.exp = expFor(level, classOf(data, ch.classId), data.config);
    let hpGain = 0;
    let mpGain = 0;
    const statGains: StatKey[] = [];
    while (ch.level < level) {
      const mark = quiet.events.length;
      const rec = levelUpOnce(quiet, ch);
      hpGain += rec.hpGain;
      mpGain += rec.mpGain;
      // CH-61（M14）: その段の levelUp の statGains を順につなぐ
      for (const e of quiet.events.slice(mark)) if (e.kind === "levelUp") statGains.push(...e.statGains);
    }
    levelDownWhileBelow(quiet, ch);
    if (ch.level === from) continue;
    const es = equipStats(state, data, ch); // CH-14: イベントの最大値は実効の値
    if (ch.level > from) {
      ctx.events.push({ kind: "levelUp", id: ch.id, level: ch.level, hpGain, mpGain, hpMax: es.hpMax, mpMax: es.mpMax, hp: ch.hp, mp: ch.mp, statGains });
    } else {
      ctx.events.push({ kind: "levelDown", id: ch.id, level: ch.level, hpMax: es.hpMax, mpMax: es.mpMax, hp: ch.hp, mp: ch.mp });
    }
    const learned = ch.knownSpells.length - known;
    ctx.events.push({ kind: "message", key: "debug.levels.member", params: { name: ch.name, from, to: ch.level, learned } });
  }
  ctx.events.push({ kind: "message", key: "debug.levels", params: { level } });
}

/**
 * debug.chest（M11）: 今の位置にドロップの宝箱を置く（罠は trapId。null は罠なし）。U-1 の確認用（危険度 3〜4 の罠は普通の遊びで出にくい）。
 * inRoom は今のセルの roomId !== null。chestFound → chest.found.drop → chest.prompt。
 * startAlarm が null（present が偽・省略）なら衝動判定はせず乱数も使わない。非 null（present が真）なら衝動・制止・掛け合いを行う（state.rng を使う）
 */
export function debugChest(ctx: RuleContext, trapId: string | null, startAlarm: StartAlarm | null = null): void {
  const dive = ctx.state.dive;
  if (dive === null) throw new Error("debugChest: not in dungeon");
  const cell = cellAt(floorOf(dive, ctx.data), dive.pos.x, dive.pos.y);
  placeDebugChest(ctx, trapId, cell.roomId !== null, startAlarm);
}
