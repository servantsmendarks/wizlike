// UI-61（M8.5）: 街の施設の絵（public/town/<facility>.png、240×150。ビューの中の層）。
// ビルド時の一覧（GameAssets.town）にある施設だけ <img> で読み、無い・読めなかったら黒（下地の黒）のまま。
// 読めなかった URL は覚えて読み直さない（battle.ts の敵の絵と同じ）。モジュールのトップレベルでは DOM に触れない。
import type { SpriteInfo } from "../../build/asset-types";
import { townPicture } from "../sprites";

/**
 * UI-61 / UI-50: public/town の絵の名前の一覧（施設は townFacility の 8 つ。title はタイトル画面の絵。2026-10-06 ユーザー決定。
 * bank は M21（工房の銀行の絵の準備）で足した）。ビルドの一覧（GameAssets.town）は名前で選ばないので、この一覧は表示層が読みに行く名前の正
 */
export const TOWN_PICTURE_IDS = ["town", "tavern", "inn", "temple", "dark", "gate", "shop", "bank", "title"] as const;

/**
 * UI-61（M21）: 絵が一覧（GameAssets.town）に無い施設の落とし先（暫定）。銀行の絵（public/town/bank.png）は工房から届くまで店の絵。
 * 工房の bank.png が届いたら bank の行を外す
 */
export const TOWN_PICTURE_FALLBACK: Readonly<Record<string, string>> = { bank: "shop" };

/** UI-61: 施設の絵の名前。一覧に無ければ落とし先（TOWN_PICTURE_FALLBACK）の絵、それも無ければ null（黒） */
export function townPictureName(facility: string, available: Readonly<Record<string, SpriteInfo>>): string | null {
  const own = townPicture(facility, available);
  if (own !== null) return own;
  const fb = Object.prototype.hasOwnProperty.call(TOWN_PICTURE_FALLBACK, facility) ? TOWN_PICTURE_FALLBACK[facility] : undefined;
  return fb === undefined ? null : townPicture(fb, available);
}

/** UI-50: タイトル画面の絵の名前（public/town/title.png） */
export const TITLE_PICTURE_ID = "title";

/** UI-61: 施設の絵の URL（base は import.meta.env.BASE_URL。本番は /wizlike/） */
export function townPictureUrl(id: string, base: string): string {
  return `${base}town/${id}.png`;
}

export type TownPictureView = {
  el: HTMLElement;
  /** 施設の絵を出す（一覧に無ければ落とし先の絵、それも無ければ黒）。同じ施設なら何もしない */
  show(facility: string): void;
};

/** w・h はビューの大きさ（240×150）。available はビルド時の一覧（GameAssets.town） */
export function createTownPicture(o: { w: number; h: number; available: Readonly<Record<string, SpriteInfo>>; base: string }): TownPictureView {
  const el = document.createElement("div");
  el.className = "town-picture";
  Object.assign(el.style, { position: "absolute", left: "0px", top: "0px", width: `${o.w}px`, height: `${o.h}px`, background: "var(--c-bg)" });
  const missing = new Set<string>();
  let current: string | null = null;
  return {
    el,
    show(facility: string): void {
      if (current === facility) return;
      current = facility;
      el.replaceChildren();
      const name = townPictureName(facility, o.available);
      if (name === null) return;
      const url = townPictureUrl(name, o.base);
      if (missing.has(url)) return;
      const img = document.createElement("img");
      img.className = "town-picture-img";
      img.alt = "";
      img.draggable = false;
      Object.assign(img.style, {
        display: "none",
        position: "absolute",
        left: "0px",
        top: "0px",
        width: `${o.w}px`,
        height: `${o.h}px`,
        imageRendering: "pixelated",
        pointerEvents: "none",
      });
      img.addEventListener("load", () => {
        img.style.display = "block";
      });
      img.addEventListener("error", () => {
        missing.add(url);
        img.remove();
      });
      img.src = url;
      el.appendChild(img);
    },
  };
}
