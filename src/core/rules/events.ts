// イベント（EV-10〜15 衝動判定、EV-20〜24 制止判定、EV-30〜34 結果、EV-31/33 選択、DG-22）。
// dungeon.ts から呼ばれる（dungeon.ts は import しない。Floor は引数で受ける）。import の向きは events.ts → field.ts → san.ts。
// 乱数はすべて ctx.state.rng を処理の順に引く。ただし衝動判定の 1d6 群は eventStarted を出す前に引く（actorId を付けるため。B12）。
import type { EventDef, EventEffect, GameData, LureWeights } from "../data/index";
import { LURE_TAGS } from "../data/index";
import { randInt, rollDice, rollDie, weightedIndex } from "../rng";
import { destroyItemInstance, eventOf, itemDisplayName, itemOf, personalityOf } from "../state";
import type { Character, Floor, GameState, PendingChoice, RuleContext } from "../types";
import { canAct } from "./combat-calc";
import { offerEventChoice } from "./choices";
import { idx } from "./dungeon-gen";
import { addExplored, aliveMembers, damageMembers, gainGold } from "./field";
import { applySanValue, gainSan, sanStage } from "./san";

// ---------------------------------------------------------------------------
// 衝動判定（EV-10〜14、A2、B2）

/** EV-11: Σ_tag lure[tag] × ev[tag]（LURE_TAGS の順） */
export function lureProduct(lure: LureWeights, ev: LureWeights): number {
  let sum = 0;
  for (const tag of LURE_TAGS) sum += lure[tag] * ev[tag];
  return sum;
}

/**
 * EV-10〜14 / A2: 衝動の行動者。リーダーと行動不能の者は対象外。並び順に、錯乱（CH-53）の者は先に randInt(0,3) で
 * LURE_TAGS のタグを 1 つ選び、性格の lure をそのタグだけ events.confusedLureWeight の重みに置き換える（加算しない）。
 * 誘いの積が 0 以下の者は 1d6 も振らない。score = 積 + (stats[def.stat] − 10) + 1d6 が impulseThreshold 以上の者のうち最大、
 * 同点は agi が高い方、それも同じなら並び順が前の者。誰もいなければ null
 */
export function decideImpulse(ctx: RuleContext, def: EventDef): Character | null {
  const { state, data } = ctx;
  const cfg = data.config;
  let best: { ch: Character; score: number } | null = null;
  for (const ch of state.party) {
    if (ch.isLeader || !canAct(ch)) continue; // EV-10
    const p = personalityOf(data, ch.personality);
    if (p === null) continue; // リーダー以外は性格を持つ（来ない）
    let lure: LureWeights = p.lure;
    if (sanStage(ch.san, ch.sanMax, cfg) === "confused") {
      // EV-14: 錯乱の者はランダムな 1 タグに仮の重み（性格の lure を置き換える）
      const tag = LURE_TAGS[randInt(state.rng, 0, LURE_TAGS.length - 1)]!;
      lure = { treasure: 0, unknown: 0, danger: 0, weak: 0, [tag]: cfg.events.confusedLureWeight };
    }
    const prod = lureProduct(lure, def.lure);
    if (prod <= 0) continue; // A2: 誘いの積 0 の者は衝動判定に乗らない
    const score = prod + (ch.stats[def.stat] - 10) + rollDie(state.rng, 6);
    if (score < cfg.events.impulseThreshold) continue; // EV-12
    if (best === null || score > best.score || (score === best.score && ch.stats.agi > best.ch.stats.agi)) best = { ch, score };
  }
  return best?.ch ?? null;
}

// ---------------------------------------------------------------------------
// 制止判定（EV-20〜22、A3、B1、B19）

/**
 * EV-20 / B1: 制止者。def.stopCheck が偽なら null。行動者以外で行動可能かつ性格の canStop が真の者のうち iq 最大、
 * 同値は並び順が前の者。乱数なし
 */
export function pickStopper(state: GameState, data: GameData, def: EventDef, actor: Character): Character | null {
  if (!def.stopCheck) return null;
  let best: Character | null = null;
  for (const ch of state.party) {
    if (ch.id === actor.id || !canAct(ch)) continue;
    if (personalityOf(data, ch.personality)?.canStop !== true) continue;
    if (best === null || ch.stats.iq > best.stats.iq) best = ch;
  }
  return best;
}

/**
 * EV-21 / A3: 制止者の iq + 1d10 ≥ 行動者の agi + 1d10 で成功（等しいとき成功）。乱数は制止者 → 行動者の順。
 * 判定の箱（UI-40）を 1 件 2 行で出す。拍は出さない（CB-55 は戦闘だけ）
 */
function rollRestrain(ctx: RuleContext, stopper: Character, actor: Character): boolean {
  const rng = ctx.state.rng;
  const rS = rollDie(rng, 10);
  const rA = rollDie(rng, 10);
  const tS = stopper.stats.iq + rS;
  const tA = actor.stats.agi + rA;
  const ok = tS >= tA;
  ctx.events.push({
    kind: "dice",
    label: { key: "dice.restrain" },
    rows: [
      { label: { key: "dice.restrain.stopper", params: { name: stopper.name } }, base: stopper.stats.iq, dice: [rS], total: tS },
      { label: { key: "dice.restrain.actor", params: { name: actor.name } }, base: actor.stats.agi, dice: [rA], total: tA },
    ],
    rule: { key: "dice.restrain.rule", params: { diff: tS - tA } },
    result: { key: ok ? "dice.restrain.ok" : "dice.restrain.ng" },
  });
  return ok;
}

// ---------------------------------------------------------------------------
// 効果（EV-32、B6〜B9）

/** B6: 効果の対象（その時点で解決）。actor は行動者が life alive なら [actor]、party は life alive の全員、others は party から行動者を除く */
function targetsOf(state: GameState, target: "actor" | "party" | "others", actor: Character): Character[] {
  if (target === "actor") return actor.life === "alive" ? [actor] : [];
  const party = aliveMembers(state);
  return target === "party" ? party : party.filter((c) => c.id !== actor.id);
}

function requireDiveOf(state: GameState) {
  if (state.dive === null) throw new Error("events: not in dungeon");
  return state.dive;
}

/**
 * EV-32: effects を順に適用する。actor は衝動の行動者、選択肢ではリーダー（B6）。f は dive.floor の実効の構造。
 * consumeItem で品が見つからず optional でなければ event.noItem を出して以降の効果を飛ばす。
 * item / encounter / status はプロトタイプで実装しない（データにあれば検証で起動を止めている）
 */
export function applyEffects(ctx: RuleContext, f: Floor, effects: readonly EventEffect[], actor: Character): void {
  const { state, data } = ctx;
  for (const e of effects) {
    switch (e.type) {
      case "gold": {
        const g = Math.max(0, rollDice(state.rng, e.dice).total);
        if (g > 0) gainGold(ctx, g, { key: "event.gold", params: { gold: g } }); // DG-40 / CH-52。0 なら何も出さない
        break;
      }
      case "damage":
        damageMembers(ctx, targetsOf(state, e.target, actor), e.dice); // CH-45。落とし穴と同じ順（B7）
        break;
      case "san":
        for (const ch of targetsOf(state, e.target, actor)) applySanValue(ctx, ch, e.value); // CH-54: 耐性なし
        break;
      case "revealFloor": {
        const dive = requireDiveOf(state);
        addExplored(dive, dive.floor, Array.from({ length: f.width * f.height }, (_, i) => i)); // 語りは結果の text
        break;
      }
      case "revealStairs": {
        // B9: 下り階段が無い階（最下層）ではボスのセルを明かす。どちらも無ければ何もしない
        const dive = requireDiveOf(state);
        const at = f.stairsDown ?? f.boss;
        if (at !== null) addExplored(dive, dive.floor, [idx(f, at.x, at.y)]);
        break;
      }
      case "consumeItem": {
        let done = false;
        for (const owner of targetsOf(state, e.target, actor)) {
          const id = owner.inventory.find((x) => state.items[x]?.itemId === e.itemId); // 鑑定を問わない
          if (id === undefined) continue;
          const item = itemDisplayName(state, data, id); // 消す前に取る
          destroyItemInstance(state, owner, id); // 潜行台帳からも外れる（DG-41）
          ctx.events.push({ kind: "message", key: "event.consume", params: { name: owner.name, item } });
          done = true;
          break;
        }
        if (done || e.optional === true) break; // optional なら持っていなくても語らずに続ける
        ctx.events.push({ kind: "message", key: "event.noItem", params: { item: itemOf(data, e.itemId).name } });
        return; // EV-32: 無ければ以降の効果は起きない
      }
      case "message":
        ctx.events.push({ kind: "message", key: e.key });
        break;
      case "nothing":
        break;
      case "item":
      case "encounter":
      case "status":
        throw new Error(`EV-32: not implemented: ${e.type}`);
    }
  }
}

// ---------------------------------------------------------------------------
// イベントの開始（DG-22、EV-13、EV-20〜24、EV-30）と選択（EV-31/33）

/** EV-33 / B10: 処理を終えたイベントのセルを通常のセルにする（floorOf が clearedCells を重ねる）。選択の保留中は呼ばない */
function clearHere(ctx: RuleContext): void {
  const dive = requireDiveOf(ctx.state);
  dive.clearedCells.push({ floor: dive.floor, x: dive.pos.x, y: dive.pos.y });
}

function leaderOf(state: GameState): Character {
  const l = state.party.find((c) => c.isLeader);
  if (l === undefined) throw new Error("events: no leader");
  return l;
}

/**
 * DG-22: イベントのセルに入った歩（moveForward の続き）から呼ぶ。f は dive.floor の実効の構造。
 * 衝動判定（choice 型はしない）→ eventStarted → intro →（行動者がいれば）制止判定 → 衝動の実行、
 * 行動者がいない・制止に成功した mixed / choice は選択を待つ（screen event。A4）
 */
export function startEvent(ctx: RuleContext, f: Floor, eventId: string): void {
  const { state, data } = ctx;
  const def = eventOf(data, eventId);
  const actor = def.kind === "choice" ? null : decideImpulse(ctx, def); // 1d6 群（B12: eventStarted の前）
  ctx.events.push({ kind: "eventStarted", eventId, ...(actor !== null ? { actorId: actor.id } : {}) });
  ctx.events.push({ kind: "message", key: def.text.intro });
  if (actor === null) {
    // EV-13: 衝動なし。impulse は何も起きない、choice / mixed は選択型へ
    if (def.kind === "impulse") {
      ctx.events.push({ kind: "message", key: "event.nothing" });
      clearHere(ctx);
      return;
    }
    offerEventChoice(ctx, def);
    return;
  }
  ctx.events.push({ kind: "message", key: "event.impulse.actor", params: { actor: actor.name } });
  const stopper = pickStopper(state, data, def, actor);
  if (stopper !== null) {
    ctx.events.push({ kind: "message", key: "event.stop.roll", params: { stopper: stopper.name } });
    if (rollRestrain(ctx, stopper, actor)) {
      // EV-22: 制止成功。不発で、制止者 → 行動者の順に SAN +stopSanGain
      ctx.events.push({ kind: "message", key: "event.stop.success", params: { stopper: stopper.name, actor: actor.name } });
      gainSan(ctx, stopper, data.config.events.stopSanGain);
      gainSan(ctx, actor, data.config.events.stopSanGain);
      if (def.kind === "impulse") {
        ctx.events.push({ kind: "message", key: "event.nothing" });
        clearHere(ctx);
        return;
      }
      offerEventChoice(ctx, def);
      return;
    }
    ctx.events.push({ kind: "message", key: "event.stop.fail", params: { stopper: stopper.name } });
  }
  // EV-23 / EV-24 / EV-30: 衝動の実行
  ctx.events.push({ kind: "message", key: def.text.impulse, params: { actor: actor.name } });
  const outcomes = def.impulseOutcomes;
  const o = outcomes[weightedIndex(state.rng, outcomes.map((x) => x.weight))]!;
  ctx.events.push({ kind: "message", key: o.text, params: { actor: actor.name } });
  applyEffects(ctx, f, o.effects, actor);
  if (stopper !== null) {
    // B4: ボーナスと慰めは制止に失敗した者がいるときだけ（EV-24）
    if (o.quality === "good" && o.impulseBonus !== undefined) applyEffects(ctx, f, o.impulseBonus, actor);
    if (o.quality === "bad" && stopper.life === "alive") {
      ctx.events.push({ kind: "message", key: "event.stop.told", params: { stopper: stopper.name } });
      gainSan(ctx, stopper, data.config.events.stopSanGain); // B3
    }
  }
  clearHere(ctx);
}

/**
 * EV-31 / EV-33: イベントの選択（event.choose）。pendingChoice は呼び出し側で null 済み。
 * screen を dungeon に戻して screen{dungeon} → 選択肢の text（params なし）→ 効果（行動者はリーダー。B6）→ セルを通常に
 */
export function chooseEventOption(
  ctx: RuleContext,
  f: Floor,
  pc: Extract<PendingChoice, { kind: "event" }>,
  optionId: string,
): void {
  const { state, data } = ctx;
  const def = eventOf(data, pc.eventId);
  const choice = def.choices.find((c) => c.id === optionId);
  if (choice === undefined) throw new Error(`chooseEventOption: unknown option ${optionId}`);
  state.screen = "dungeon";
  ctx.events.push({ kind: "screen", to: "dungeon" });
  ctx.events.push({ kind: "message", key: choice.text });
  applyEffects(ctx, f, choice.effects, leaderOf(state));
  clearHere(ctx);
}
