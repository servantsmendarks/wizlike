// 酒場の見回すと酒場のイベント（TW-13 / TW-14。M5.5）。
// 乱数は ctx.state.rng を 見回すの randInt → chance（条件を満たすときだけ）→ weightedIndex（当たったときだけ）→ 効果 の順に引く。
// import の向きは tavern.ts → events.ts（applyEffects）。town.ts・dungeon.ts からは import しない。
import type { GameData } from "../data/index";
import { chance, randInt, weightedIndex } from "../rng";
import type { Character, GameState, RuleContext } from "../types";
import { applyEffects } from "./events";

/** TW-13: 街（screen town かつ dive null）でなければ "wrong screen"。受け付けるなら null */
export function checkLookAround(state: GameState): string | null {
  if (state.screen !== "town" || state.dive !== null) return "wrong screen";
  return null;
}

/** TW-14: adventureTurns − tavernEventMark ≥ config.town.tavernEventTurns（酒場のイベントが起きうる） */
export function tavernEventReady(state: GameState, data: GameData): boolean {
  return state.adventureTurns - state.tavernEventMark >= data.config.town.tavernEventTurns;
}

function leaderOf(state: GameState): Character {
  const l = state.party.find((c) => c.isLeader);
  if (l === undefined) throw new Error("tavern: no leader");
  return l;
}

/**
 * TW-13 / TW-14: 見回す。
 * 1) randInt(0, lookTexts.length − 1) → message lookTexts[i]（params なし）
 * 2) tavernEventReady なら chance(tavernEventChance) を 1 回。外れなら終わり（tavernEventMark は変えない）
 * 3) 当たれば weightedIndex(events の weight) で 1 つ → tavernEventMark = adventureTurns → message text → applyEffects(ctx, null, effects, リーダー)
 * screen・eventStarted は出さない（酒場の一覧のまま）
 */
export function lookAround(ctx: RuleContext): void {
  const { state, data } = ctx;
  const tv = data.tavern;
  const look = tv.lookTexts[randInt(state.rng, 0, tv.lookTexts.length - 1)];
  if (look === undefined) throw new Error("tavern: no lookTexts");
  ctx.events.push({ kind: "message", key: look });
  if (!tavernEventReady(state, data)) return;
  if (!chance(state.rng, data.config.town.tavernEventChance)) return;
  const ev = tv.events[weightedIndex(state.rng, tv.events.map((e) => e.weight))];
  if (ev === undefined) throw new Error("tavern: no events");
  state.tavernEventMark = state.adventureTurns;
  ctx.events.push({ kind: "message", key: ev.text });
  applyEffects(ctx, null, ev.effects, leaderOf(state));
}
