// UI-66 / UI-63: 出来事（GameEvent）と鳴らすもの（場面の曲・ジングル・効果音）の対応（純粋。DOM・Web Audio に触れない）。
// - 対応は data/audio.json（cues・screenSongs・battleSongs・bossSong・facilitySongs・campSong）と dungeons[].song が正。
//   ここはデータを引いて当てはめるだけ（§3-5）。
// - 判定は GameEvent の欄と id の形（敵は "e{g}-{u}"。enemyGroupOfId）だけで行い、state を掘らない（§3-4）。
// - ボスの判定は monsters[].special.boss を表示のためだけに引く（battle.ts の色と同じ扱い）。
// - 戦闘の曲の順（battleSongs を順に巡回）とボス戦か（battleEnd の boss）は、表示層だけの値 SoundContext で持つ（保存しない。リロードで初めから）。
import type { AudioFacility, GameData, SoundCue } from "../core/data/index";
import type { GameEvent, Screen } from "../core/types";
import { routeOfScreen } from "./resume";
import { enemyGroupOfId } from "./views/battle";

export type SoundOrder = { type: "sfx"; name: string } | { type: "jingle"; name: string } | { type: "song"; name: string | null };

type CueData = Pick<GameData, "audio" | "monsters" | "dungeons">;

/** 表示層だけの音の状態（UI-63 / UI-66。2026-10-06） */
export type SoundContext = {
  /** 今の（直前の）戦闘にボスがいるか（encounter で決める。battleEnd の cue の boss に使う） */
  boss: boolean;
  /** これまでのボスのいない遭遇の数（battleSongs をこの順で選ぶ） */
  encounters: number;
  /**
   * UI-66（2026-10-07）: 今の拍（beat の出来事から次の beat まで。拍の外は再生の開始から）で鳴らした効果音の名前。
   * 同じ名前の効果音は 2 回目以降を鳴らさない（全員の SAN の減少で san が 6 回重なるなど）。ジングルと曲は対象外
   */
  beatSfx: readonly string[];
};

export const INITIAL_SOUND_CONTEXT: SoundContext = { boss: false, encounters: 0, beatSfx: [] };

/** UI-66（2026-10-07）: 再生の開始と拍（beat）で、同じ拍の効果音の記録を空にする */
export function startSoundPlayback(ctx: SoundContext): SoundContext {
  return ctx.beatSfx.length === 0 ? ctx : { ...ctx, beatSfx: [] };
}

/** 場面の曲を選ぶのに要る値。monsterIds は戦闘の敵、dungeonId は迷宮、battleIndex は battleSongs の何番目か */
export type SceneOpts = { monsterIds?: readonly string[]; dungeonId?: string | null; battleIndex?: number };

const hasBoss = (monsterIds: readonly string[], data: CueData): boolean =>
  monsterIds.some((id) => data.monsters.find((m) => m.id === id)?.special.boss === true);

/** UI-63: 戦闘の曲。ボスがいれば bossSong、いなければ battleSongs の index 番目（巡回） */
export function battleSong(monsterIds: readonly string[], index: number, data: CueData): string | undefined {
  if (hasBoss(monsterIds, data)) return data.audio.bossSong;
  const list = data.audio.battleSongs;
  if (list.length === 0) return undefined;
  const i = ((Math.trunc(index) % list.length) + list.length) % list.length;
  return list[i];
}

/** UI-63: 迷宮の曲。ダンジョンの song、無ければ screenSongs.dungeon */
export function dungeonSong(dungeonId: string | null | undefined, data: CueData): string | undefined {
  const own = dungeonId == null ? undefined : data.dungeons.find((d) => d.id === dungeonId)?.song;
  return own ?? data.audio.screenSongs.dungeon;
}

/** UI-63: 街のページの曲。施設の曲（facilitySongs）、無い施設と施設メニュー（town）は screenSongs.town */
export function townSong(facility: AudioFacility | "town", data: CueData): string | undefined {
  const own = facility === "town" ? undefined : data.audio.facilitySongs[facility];
  return own ?? data.audio.screenSongs.town;
}

/** UI-63: 迷宮のキャンプの曲 */
export function campSong(data: CueData): string {
  return data.audio.campSong;
}

/**
 * UI-63: 画面の曲。battle は battleSong、dungeon は dungeonSong、それ以外は screenSongs。
 * screenSongs に無い画面（event）は undefined = 今の曲のまま
 */
export function sceneSong(screen: Screen, data: CueData, opts: SceneOpts = {}): string | undefined {
  if (screen === "battle") return battleSong(opts.monsterIds ?? [], opts.battleIndex ?? 0, data);
  if (screen === "dungeon") return dungeonSong(opts.dungeonId, data);
  return data.audio.screenSongs[screen];
}

/**
 * UI-63 / SV-50: screen イベントの来ない場面（続きから・タイトル）の曲。保存した画面の曲で、
 * screenSongs に無い画面（event）は表示する route（UI-55: event は迷宮の画面の上 = dungeon）の曲。
 * 戦闘は battleSongs の先頭（ボスなら bossSong）
 */
export function songAt(screen: Screen, data: CueData, opts: SceneOpts = {}): string | undefined {
  const own = sceneSong(screen, data, { ...opts, battleIndex: 0 });
  if (own !== undefined) return own;
  const r = routeOfScreen(screen);
  return r === null || r === screen ? undefined : sceneSong(r, data, { ...opts, battleIndex: 0 });
}

/** UI-63 / SV-50: 続きからの音の状態。戦闘中なら、その戦闘を 1 つ目の遭遇として数える（次の遭遇は battleSongs の 2 つ目） */
export function resumeSoundContext(screen: Screen, monsterIds: readonly string[], data: CueData): SoundContext {
  if (screen !== "battle") return INITIAL_SOUND_CONTEXT;
  const boss = hasBoss(monsterIds, data);
  return { boss, encounters: boss ? 0 : 1, beatSfx: [] };
}

const side = (id: string): "enemy" | "party" => (enemyGroupOfId(id) !== null ? "enemy" : "party");

function matches(cue: SoundCue, ev: GameEvent, ctx: SoundContext): boolean {
  if (cue.event !== ev.kind) return false;
  switch (ev.kind) {
    case "message":
      return cue.key === ev.key && (cue.rarity === undefined || cue.rarity === ev.params?.["rarity"]);
    case "battleEnd":
      return (cue.result === undefined || cue.result === ev.result) && (cue.boss === undefined || cue.boss === ctx.boss);
    case "attack":
      return (cue.hit === undefined || cue.hit === ev.hit) && (cue.target === undefined || cue.target === side(ev.targetId));
    case "hpChanged":
    case "sanChanged":
      return (
        (cue.target === undefined || cue.target === side(ev.id)) &&
        (cue.loss === undefined || (cue.loss ? ev.delta < 0 : ev.delta > 0))
      );
    case "statusChanged":
      return (
        (cue.target === undefined || cue.target === side(ev.id)) &&
        (cue.status === undefined || cue.status === ev.status) &&
        (cue.on === undefined || cue.on === ev.on)
      );
    case "lifeChanged":
      return (cue.target === undefined || cue.target === side(ev.id)) && (cue.life === undefined || cue.life === ev.life);
    case "dice":
      return cue.key === undefined || cue.key === ev.label.key;
    case "spell":
    case "floorChanged":
    case "levelUp":
    case "wipe":
    case "encounter":
    case "blocked":
    case "spellLearned":
    case "chestFound":
      return true;
    default:
      return false;
  }
}

/**
 * UI-66: GameEvent 1 件 → 鳴らすもの。audio.json の cues を上から見て当たったものすべて。
 * screen は場面の曲（battle は何も求めない。直後の encounter で決める）。
 * encounter は cues（遭遇のジングル）の後に戦闘の曲（ジングルが鳴り終わってから始まる。UI-63 の再生機）。
 * 効果音は、同じ拍で既に鳴らした名前（ctx.beatSfx）と、この出来事で既に返した名前を除く（2026-10-07）
 */
export function soundsFor(ev: GameEvent, data: CueData, ctx: SoundContext = INITIAL_SOUND_CONTEXT): SoundOrder[] {
  if (ev.kind === "screen") {
    if (ev.to === "battle") return [];
    const name = sceneSong(ev.to, data, { dungeonId: ev.dungeonId ?? null });
    return name === undefined ? [] : [{ type: "song", name }];
  }
  const out: SoundOrder[] = [];
  for (const cue of data.audio.cues) {
    if (!matches(cue, ev, ctx)) continue;
    if (cue.sfx !== undefined) {
      const name = cue.sfx;
      if (!ctx.beatSfx.includes(name) && !out.some((x) => x.type === "sfx" && x.name === name)) out.push({ type: "sfx", name });
    }
    else if (cue.jingle !== undefined) out.push({ type: "jingle", name: cue.jingle });
  }
  if (ev.kind === "encounter") {
    const name = battleSong(
      ev.groups.map((g) => g.monsterId),
      ctx.encounters,
      data,
    );
    if (name !== undefined) out.push({ type: "song", name });
  }
  return out;
}

/**
 * UI-63 / UI-66: 出来事の後の音の状態。encounter でボスかを覚え、ボスのいない遭遇を数える。
 * beat で同じ拍の効果音の記録を空にし、それ以外はこの出来事で鳴らした効果音（soundsFor の sfx）を足す（2026-10-07）
 */
export function nextSoundContext(ev: GameEvent, data: CueData, ctx: SoundContext): SoundContext {
  if (ev.kind === "beat") return startSoundPlayback(ctx);
  const heard = soundsFor(ev, data, ctx).flatMap((x) => (x.type === "sfx" ? [x.name] : []));
  let next = heard.length === 0 ? ctx : { ...ctx, beatSfx: [...ctx.beatSfx, ...heard] };
  if (ev.kind === "encounter") {
    const boss = hasBoss(
      ev.groups.map((g) => g.monsterId),
      data,
    );
    next = { ...next, boss, encounters: boss ? ctx.encounters : ctx.encounters + 1 };
  }
  return next;
}
