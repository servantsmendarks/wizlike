// UI-57（開発用）: debug パネルのコマンド。全滅の流れ（M4 の実機の結果、ユーザー指示）と、
// M5 の性格・イベント・SAN を実機で確かめるためのもの。乱数は使わない。
import type { RuleContext } from "../types";
import { floorOf, markExplored, warpTarget } from "./dungeon";
import { loseSan, sanCapOf, sanJustBelow, sanStage } from "./san";

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

/**
 * debug.warp（M5）: warpTarget の位置へ移り、目標を向く。行き先が無ければ message debug.warp.none だけ（state は変えない）。
 * あれば pos / facing を書き換え → 視野を explored に足す → moved → message debug.warp.<to>。遭遇・毒・罠は起こさない
 */
export function warp(ctx: RuleContext, to: "event" | "trap" | "stairsDown"): void {
  const { state, data } = ctx;
  const dive = state.dive;
  if (dive === null) throw new Error("warp: not in dungeon");
  const t = warpTarget(state, data, to);
  if (t === null) {
    ctx.events.push({ kind: "message", key: "debug.warp.none" });
    return;
  }
  dive.pos = { x: t.pos.x, y: t.pos.y };
  dive.facing = t.facing;
  markExplored(dive, floorOf(dive, data), data.config.dungeon.viewDepth);
  ctx.events.push({ kind: "moved", pos: { x: dive.pos.x, y: dive.pos.y }, facing: dive.facing });
  ctx.events.push({ kind: "message", key: `debug.warp.${to}` });
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
