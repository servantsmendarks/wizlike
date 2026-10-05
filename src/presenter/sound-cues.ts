// UI-66 / UI-63: 出来事（GameEvent）と鳴らすもの（場面の曲・ジングル・効果音）の対応（純粋。DOM・Web Audio に触れない）。
// - 対応は data/audio.json（cues・screenSongs・bossSong）が正。ここはデータを引いて当てはめるだけ（§3-5）。
// - 判定は GameEvent の欄と id の形（敵は "e{g}-{u}"。enemyGroupOfId）だけで行い、state を掘らない（§3-4）。
// - ボスの判定は monsters[].special.boss を表示のためだけに引く（battle.ts の色と同じ扱い）。
import type { GameData, SoundCue } from "../core/data/index";
import type { GameEvent, Screen } from "../core/types";
import { routeOfScreen } from "./resume";
import { enemyGroupOfId } from "./views/battle";

export type SoundOrder = { type: "sfx"; name: string } | { type: "jingle"; name: string } | { type: "song"; name: string | null };

type CueData = Pick<GameData, "audio" | "monsters">;

/**
 * UI-63: 画面と戦闘の敵（monsterId）から場面の曲。battle で special.boss の敵がいれば bossSong。
 * screenSongs に無い画面（event）は undefined = 今の曲のまま
 */
export function sceneSong(screen: Screen, monsterIds: readonly string[], data: CueData): string | undefined {
  if (screen === "battle" && monsterIds.some((id) => data.monsters.find((m) => m.id === id)?.special.boss === true)) {
    return data.audio.bossSong;
  }
  return data.audio.screenSongs[screen];
}

/**
 * UI-63 / SV-50: screen イベントの来ない場面（続きから・タイトル）の曲。保存した画面の曲で、
 * screenSongs に無い画面（event）は表示する route（UI-55: event は迷宮の画面の上 = dungeon）の曲
 */
export function songAt(screen: Screen, monsterIds: readonly string[], data: CueData): string | undefined {
  const own = sceneSong(screen, monsterIds, data);
  if (own !== undefined) return own;
  const r = routeOfScreen(screen);
  return r === null || r === screen ? undefined : sceneSong(r, monsterIds, data);
}

const side = (id: string): "enemy" | "party" => (enemyGroupOfId(id) !== null ? "enemy" : "party");

function matches(cue: SoundCue, ev: GameEvent): boolean {
  switch (ev.kind) {
    case "message":
      return cue.event === "message" && cue.key === ev.key;
    case "battleEnd":
      return cue.event === "battleEnd" && (cue.result === undefined || cue.result === ev.result);
    case "attack":
      return (
        cue.event === "attack" &&
        (cue.hit === undefined || cue.hit === ev.hit) &&
        (cue.target === undefined || cue.target === side(ev.targetId))
      );
    case "hpChanged":
      return (
        cue.event === "hpChanged" &&
        (cue.target === undefined || cue.target === side(ev.id)) &&
        (cue.loss !== true || ev.delta < 0)
      );
    case "spell":
    case "floorChanged":
    case "levelUp":
    case "wipe":
      return cue.event === ev.kind;
    default:
      return false;
  }
}

/**
 * UI-66: GameEvent 1 件 → 鳴らすもの。audio.json の cues を上から見て当たったものすべて。
 * screen は場面の曲（battle はここでは battle。直後の encounter でボスなら bossSong）、encounter は戦闘の場面の曲
 */
export function soundsFor(ev: GameEvent, data: CueData): SoundOrder[] {
  if (ev.kind === "screen" || ev.kind === "encounter") {
    const name = ev.kind === "screen" ? sceneSong(ev.to, [], data) : sceneSong("battle", ev.groups.map((g) => g.monsterId), data);
    return name === undefined ? [] : [{ type: "song", name }];
  }
  const out: SoundOrder[] = [];
  for (const cue of data.audio.cues) {
    if (!matches(cue, ev)) continue;
    if (cue.sfx !== undefined) out.push({ type: "sfx", name: cue.sfx });
    else if (cue.jingle !== undefined) out.push({ type: "jingle", name: cue.jingle });
  }
  return out;
}
