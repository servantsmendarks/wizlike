// UI-60（M8）: 敵の絵の選び方と大きさ（純粋。DOM に触れない）。
// 絵は public/sprites に実在するもの（ビルド時に作った一覧 = GameAssets.sprites）だけを読む。一覧に無ければ読みに行かない
// （素材が無い間に 404 や SPA の HTML を取りに行かない）。拡大は整数倍だけ（最近傍は CSS の image-rendering: pixelated）。縮小はしない。
import type { SpriteInfo } from "../build/asset-types";
import type { GameData } from "../core/data/index";

export type SpriteChoice = { name: string; w: number; h: number; scale: number } | null;

/**
 * UI-60: 鑑定済みは monsters[].sprite、未鑑定は系統の sprite（unknown_<kind>）。
 * available（GameAssets.sprites）に無ければ null（読みに行かない）。正方形でない・大きさが正の整数でない・
 * frame に 1 倍でも入らなければ null（縮小しない）。scale = floor(frame / w)（1 以上の整数倍）
 */
export function chooseSprite(
  data: Pick<GameData, "monsters" | "unknownKinds">,
  monsterId: string,
  identified: boolean,
  available: Readonly<Record<string, SpriteInfo>>,
  frame: number,
): SpriteChoice {
  const m = data.monsters.find((x) => x.id === monsterId);
  if (m === undefined) return null;
  const name = identified ? m.sprite : data.unknownKinds.find((k) => k.id === m.unknownKind)?.sprite;
  if (name === undefined || !Object.prototype.hasOwnProperty.call(available, name)) return null;
  const info = available[name];
  if (info === undefined) return null;
  const { w, h } = info;
  if (!Number.isInteger(w) || w <= 0 || w !== h) return null;
  const scale = Math.floor(frame / w);
  if (scale < 1) return null;
  return { name, w, h, scale };
}

/** UI-54 / UI-60: 表示のためだけに monsters の special.boss を引く（未知の id は偽） */
export function isBossMonster(data: Pick<GameData, "monsters">, monsterId: string): boolean {
  return data.monsters.find((x) => x.id === monsterId)?.special.boss === true;
}

/**
 * UI-61（M8.5）: 施設の絵（public/town/<id>.png）の名前。available（GameAssets.town。ビルド時に 240×150 だけを入れた一覧）に
 * 無ければ null（読みに行かず黒のまま）
 */
export function townPicture(id: string, available: Readonly<Record<string, SpriteInfo>>): string | null {
  return Object.prototype.hasOwnProperty.call(available, id) ? id : null;
}
