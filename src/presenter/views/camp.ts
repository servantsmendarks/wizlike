// UI-53 迷宮のキャンプと、TW-03 / UI-52 酒場の「状態を見る / 装備を替える / 並び順を変える」（UI-59 の状態を含む）。
// ページ（CampPage）を段にした純粋な状態機械（M4 の field-items.ts の道具の 3 段を吸収した）と、ビュー領域を覆うパネルの DOM。
// - 候補・押せるか・対象の要否は core の campMenu と fieldItemMenu の値だけで決める（UI-35）。送る Command は
//   dungeon.cast / dungeon.useItem / party.equip / party.unequip / party.reorder / party.identify。
// - 迷宮の top は [状態][呪文][道具][装備] / [並び順][鑑定（identifiers が空なら空き枠）][空き][戻る] の 4×2 の枠（layout.campGrid）。
//   top の「戻る」で閉じる。ほかの段の末尾は「やめる」（common.cancel）で、host の最初のページへ戻る（camp は top、酒場は閉じて酒場の一覧へ）。
// - 送った後も閉じずに、同じ者の段へ戻る（CampStep の after）。sync で campMenu を取り直し、campRepair で成り立たない段を直す。
// - 名前の枠（状態・呪文・道具・装備の人・並び順）はパーティ全員の 6 枠と [7] やめる。呪文・道具・装備の品・対象・鑑定の品は一覧（末尾がやめる）。
// DOM はパネル（createCampView）だけで、モジュールのトップレベルでは DOM に触れない。結線は app が行う。
import type { EquipSlot, Strings } from "../../core/data/index";
import type { CampMenu, Command, FieldItemMenu } from "../../core/types";
import type { Action } from "../input/swipe";
import type { Rect } from "../layout";
import { createDetailView, SLOT_ORDER, type CharacterDetail } from "./detail";
import { formatMessage } from "./message";

export type CampHost = "camp" | "tavern";
export type CampPage =
  | { kind: "top" }
  | { kind: "status"; memberId: string }
  | { kind: "spell"; stage: "caster" }
  | { kind: "spell"; stage: "spell"; casterId: string }
  | { kind: "spell"; stage: "target"; casterId: string; spellId: string }
  | { kind: "item"; stage: "member" }
  | { kind: "item"; stage: "item"; memberId: string }
  | { kind: "item"; stage: "target"; memberId: string; instanceId: string }
  | { kind: "equip"; stage: "member" }
  | { kind: "equip"; stage: "slot"; memberId: string }
  | { kind: "equip"; stage: "item"; memberId: string; slot: EquipSlot }
  | { kind: "order"; picked: string | null }
  | { kind: "identify"; stage: "appraiser" }
  | { kind: "identify"; stage: "item"; appraiserId: string };
export type CampChoice =
  | { kind: "open"; page: CampPage }
  | { kind: "member"; memberId: string }
  | { kind: "spell"; spellId: string }
  | { kind: "item"; instanceId: string }
  | { kind: "target"; targetId: string }
  | { kind: "slot"; slot: EquipSlot }
  | { kind: "equip"; instanceId: string }
  | { kind: "unequip" }
  | { kind: "identifyItem"; instanceId: string }
  /** 押しても何もしない行（「装備できる物がない」など） */
  | { kind: "none" }
  /** やめる（top では戻る = 閉じる） */
  | { kind: "cancel" };
export type CampEntry = { label: string; disabled: boolean; choice: CampChoice };
/** grid は layout.campGrid の 8 枠（null は空き枠）、list は操作領域の一覧 */
export type CampEntries = { layout: "grid"; slots: (CampEntry | null)[] } | { layout: "list"; rows: CampEntry[] };
/** 段を移る・閉じる・送る（送った後は after の段へ） */
export type CampStep = { kind: "page"; page: CampPage } | { kind: "close" } | { kind: "send"; command: Command; after: CampPage };
/** ビュー領域に出すもの。text は見出しと問い、detail は UI-59 の状態（focusSlot はその枠を accent 色）、order は並び順の表 */
export type CampPanel =
  | { kind: "text"; title: string; body: string }
  | { kind: "detail"; memberId: string; focusSlot: EquipSlot | null }
  | { kind: "order"; rows: { n: number; name: string; row: string; picked: boolean }[] };
export type CampInput = { menu: CampMenu; items: FieldItemMenu | null };

/** campGrid の枠の数（4 列 × 2 段）。[7] がやめる / 戻る */
export const CAMP_GRID_SLOTS = 8;

function s(strings: Strings, key: string, params?: Record<string, string | number>): string {
  return formatMessage(strings[key] ?? key, params);
}

/** host の最初のページ。camp は top。酒場は開いた項目（状態は先頭の者、装備は人の段、並び順は未選択） */
export function campFirstPage(host: CampHost, open?: "status" | "equip" | "order", menu?: CampMenu): CampPage {
  if (host === "camp" || open === undefined) return { kind: "top" };
  if (open === "status") return { kind: "status", memberId: menu?.members[0]?.id ?? "" };
  if (open === "equip") return { kind: "equip", stage: "member" };
  return { kind: "order", picked: null };
}

/** 酒場で「やめる」の後に戻る先が無い（閉じる）か。camp は top のときだけ閉じる */
function cancelStep(host: CampHost, page: CampPage): CampStep {
  if (host === "tavern" || page.kind === "top") return { kind: "close" };
  return { kind: "page", page: { kind: "top" } };
}

const nameOf = (m: CampInput, id: string): string => m.menu.members.find((x) => x.id === id)?.name ?? "";

/** 名前の 6 枠と [7] やめる（disabled は dim） */
function memberGrid(m: CampInput, dim: (id: string) => boolean, cancel: CampEntry): CampEntries {
  const slots: (CampEntry | null)[] = Array.from({ length: CAMP_GRID_SLOTS }, () => null);
  m.menu.members.slice(0, CAMP_GRID_SLOTS - 1).forEach((x, i) => {
    slots[i] = { label: x.name, disabled: dim(x.id), choice: { kind: "member", memberId: x.id } };
  });
  slots[CAMP_GRID_SLOTS - 1] = cancel;
  return { layout: "grid", slots };
}

/** その段の項目。grid は 8 枠、list は末尾がやめる */
/** host は今の配置では項目に影響しない（酒場は top を開かない）が、呼び出しの形をそろえるために受ける */
export function campEntries(_host: CampHost, page: CampPage, m: CampInput, strings: Strings): CampEntries {
  const cancel: CampEntry = { label: s(strings, "common.cancel"), disabled: false, choice: { kind: "cancel" } };
  const list = (rows: CampEntry[]): CampEntries => ({ layout: "list", rows: [...rows, cancel] });
  const menu = m.menu;
  switch (page.kind) {
    case "top": {
      const open = (key: string, p: CampPage): CampEntry => ({ label: s(strings, key), disabled: false, choice: { kind: "open", page: p } });
      const first = menu.members[0]?.id ?? "";
      return {
        layout: "grid",
        slots: [
          open("camp.status", { kind: "status", memberId: first }),
          open("camp.spell", { kind: "spell", stage: "caster" }),
          open("camp.item", { kind: "item", stage: "member" }),
          open("camp.equip", { kind: "equip", stage: "member" }),
          open("camp.order", { kind: "order", picked: null }),
          menu.identifiers.length > 0 ? open("camp.identify", { kind: "identify", stage: "appraiser" }) : null,
          null,
          { label: s(strings, "common.back"), disabled: false, choice: { kind: "cancel" } },
        ],
      };
    }
    case "status":
      return memberGrid(m, () => false, cancel);
    case "spell": {
      if (page.stage === "caster") {
        return memberGrid(m, (id) => {
          const x = menu.members.find((y) => y.id === id);
          return x === undefined || !x.canAct || !x.spells.some((sp) => sp.usable);
        }, cancel);
      }
      const caster = menu.members.find((x) => x.id === page.casterId);
      if (page.stage === "spell") {
        return list(
          (caster?.spells ?? []).map((sp) => ({
            label: s(strings, "camp.spellRow", { name: sp.name, mp: sp.mp }),
            disabled: !sp.usable,
            choice: { kind: "spell", spellId: sp.spellId },
          })),
        );
      }
      const sp = caster?.spells.find((x) => x.spellId === page.spellId);
      if (sp?.target === "dead") {
        return list(menu.dead.map((d) => ({ label: d.name, disabled: false, choice: { kind: "target", targetId: d.id } })));
      }
      return list(
        menu.allies.map((a) => ({
          label: s(strings, "dungeon.items.allyRow", { name: a.name, hp: a.hp, hpMax: a.hpMax }),
          disabled: false,
          choice: { kind: "target", targetId: a.id },
        })),
      );
    }
    case "item": {
      const items = m.items;
      if (page.stage === "member") {
        return memberGrid(m, (id) => {
          const x = items?.members.find((y) => y.id === id);
          return x === undefined || !x.canAct || !x.items.some((it) => it.usable);
        }, cancel);
      }
      if (page.stage === "item") {
        const x = items?.members.find((y) => y.id === page.memberId);
        return list((x?.items ?? []).map((it) => ({ label: it.name, disabled: !it.usable, choice: { kind: "item", instanceId: it.instanceId } })));
      }
      return list(
        (items?.allies ?? []).map((a) => ({
          label: s(strings, "dungeon.items.allyRow", { name: a.name, hp: a.hp, hpMax: a.hpMax }),
          disabled: false,
          choice: { kind: "target", targetId: a.id },
        })),
      );
    }
    case "equip": {
      if (page.stage === "member") {
        return memberGrid(m, (id) => menu.members.find((y) => y.id === id)?.canAct !== true, cancel);
      }
      const x = menu.members.find((y) => y.id === page.memberId);
      if (page.stage === "slot") {
        const slots: (CampEntry | null)[] = Array.from({ length: CAMP_GRID_SLOTS }, () => null);
        SLOT_ORDER.forEach((slot, i) => {
          slots[i] = { label: s(strings, `detail.slot.${slot}`), disabled: false, choice: { kind: "slot", slot } };
        });
        slots[CAMP_GRID_SLOTS - 1] = cancel;
        return { layout: "grid", slots };
      }
      const rows: CampEntry[] = [];
      const cur = x?.slots.find((sl) => sl.slot === page.slot);
      if (cur !== undefined && cur.instanceId !== null) {
        rows.push({ label: s(strings, "camp.equip.unequip"), disabled: !cur.canUnequip, choice: { kind: "unequip" } });
      }
      const cands = (x?.equipCandidates ?? []).filter((c) => c.slot === page.slot);
      for (const c of cands) {
        rows.push({
          label: c.block === null ? c.name : s(strings, "camp.equip.blocked", { name: c.name, why: s(strings, `camp.equipBlock.${c.block}`) }),
          disabled: c.block !== null,
          choice: { kind: "equip", instanceId: c.instanceId },
        });
      }
      if (cands.length === 0) rows.push({ label: s(strings, "camp.equip.none"), disabled: true, choice: { kind: "none" } });
      return list(rows);
    }
    case "order":
      return memberGrid(m, () => false, cancel);
    case "identify": {
      if (page.stage === "appraiser") {
        const slots: (CampEntry | null)[] = Array.from({ length: CAMP_GRID_SLOTS }, () => null);
        menu.identifiers.slice(0, CAMP_GRID_SLOTS - 1).forEach((x, i) => {
          slots[i] = { label: x.name, disabled: false, choice: { kind: "member", memberId: x.id } };
        });
        slots[CAMP_GRID_SLOTS - 1] = cancel;
        return { layout: "grid", slots };
      }
      const rows: CampEntry[] = menu.unidentified.map((u) => ({
        label: s(strings, "camp.identifyRow", { owner: u.ownerName, name: u.name }),
        disabled: false,
        choice: { kind: "identifyItem", instanceId: u.instanceId },
      }));
      if (rows.length === 0) rows.push({ label: s(strings, "camp.identify.none"), disabled: true, choice: { kind: "none" } });
      return list(rows);
    }
  }
}

/** 1 つ選ぶ。段に合わない選択と none は同じ段のまま */
export function campStep(host: CampHost, page: CampPage, m: CampInput, choice: CampChoice): CampStep {
  const stay: CampStep = { kind: "page", page };
  if (choice.kind === "cancel") return cancelStep(host, page);
  const menu = m.menu;
  switch (page.kind) {
    case "top":
      if (choice.kind !== "open") return stay;
      // 鑑定する者が 1 人なら、鑑定する者の段を飛ばす
      if (choice.page.kind === "identify" && menu.identifiers.length === 1) {
        return { kind: "page", page: { kind: "identify", stage: "item", appraiserId: menu.identifiers[0]!.id } };
      }
      return { kind: "page", page: choice.page };
    case "status":
      return choice.kind === "member" ? { kind: "page", page: { kind: "status", memberId: choice.memberId } } : stay;
    case "spell": {
      if (page.stage === "caster") {
        return choice.kind === "member" ? { kind: "page", page: { kind: "spell", stage: "spell", casterId: choice.memberId } } : stay;
      }
      const back: CampPage = { kind: "spell", stage: "spell", casterId: page.casterId };
      if (page.stage === "spell") {
        if (choice.kind !== "spell") return stay;
        const sp = menu.members.find((x) => x.id === page.casterId)?.spells.find((x) => x.spellId === choice.spellId);
        if (sp === undefined) return stay;
        if (sp.target === "none") return { kind: "send", command: { type: "dungeon.cast", memberId: page.casterId, spellId: sp.spellId }, after: back };
        return { kind: "page", page: { kind: "spell", stage: "target", casterId: page.casterId, spellId: sp.spellId } };
      }
      if (choice.kind !== "target") return stay;
      return {
        kind: "send",
        command: { type: "dungeon.cast", memberId: page.casterId, spellId: page.spellId, targetId: choice.targetId },
        after: back,
      };
    }
    case "item": {
      if (page.stage === "member") {
        return choice.kind === "member" ? { kind: "page", page: { kind: "item", stage: "item", memberId: choice.memberId } } : stay;
      }
      const back: CampPage = { kind: "item", stage: "item", memberId: page.memberId };
      if (page.stage === "item") {
        if (choice.kind !== "item") return stay;
        const it = m.items?.members.find((x) => x.id === page.memberId)?.items.find((x) => x.instanceId === choice.instanceId);
        if (it === undefined) return stay;
        if (it.target === "ally") return { kind: "page", page: { kind: "item", stage: "target", memberId: page.memberId, instanceId: it.instanceId } };
        return { kind: "send", command: { type: "dungeon.useItem", memberId: page.memberId, itemId: it.instanceId }, after: back };
      }
      if (choice.kind !== "target") return stay;
      return {
        kind: "send",
        command: { type: "dungeon.useItem", memberId: page.memberId, itemId: page.instanceId, targetId: choice.targetId },
        after: back,
      };
    }
    case "equip": {
      if (page.stage === "member") {
        return choice.kind === "member" ? { kind: "page", page: { kind: "equip", stage: "slot", memberId: choice.memberId } } : stay;
      }
      if (page.stage === "slot") {
        return choice.kind === "slot" ? { kind: "page", page: { kind: "equip", stage: "item", memberId: page.memberId, slot: choice.slot } } : stay;
      }
      const back: CampPage = { kind: "equip", stage: "slot", memberId: page.memberId };
      if (choice.kind === "unequip") return { kind: "send", command: { type: "party.unequip", memberId: page.memberId, slot: page.slot }, after: back };
      if (choice.kind === "equip") return { kind: "send", command: { type: "party.equip", memberId: page.memberId, instanceId: choice.instanceId }, after: back };
      return stay;
    }
    case "order": {
      if (choice.kind !== "member") return stay;
      if (page.picked === null) return { kind: "page", page: { kind: "order", picked: choice.memberId } };
      if (page.picked === choice.memberId) return { kind: "page", page: { kind: "order", picked: null } };
      const ids = menu.members.map((x) => x.id);
      const a = ids.indexOf(page.picked);
      const b = ids.indexOf(choice.memberId);
      if (a < 0 || b < 0) return stay;
      const order = ids.slice();
      order[a] = choice.memberId;
      order[b] = page.picked;
      return { kind: "send", command: { type: "party.reorder", order }, after: { kind: "order", picked: null } };
    }
    case "identify": {
      if (page.stage === "appraiser") {
        return choice.kind === "member" ? { kind: "page", page: { kind: "identify", stage: "item", appraiserId: choice.memberId } } : stay;
      }
      if (choice.kind !== "identifyItem") return stay;
      return { kind: "send", command: { type: "party.identify", memberId: page.appraiserId, instanceId: choice.instanceId }, after: page };
    }
  }
}

/** その段の問い（ヘッダーに出す） */
export function campHeader(page: CampPage, m: CampInput, strings: Strings): string {
  switch (page.kind) {
    case "top":
      return s(strings, "camp.prompt.top");
    case "status":
      return s(strings, "camp.prompt.status", { name: nameOf(m, page.memberId) });
    case "spell": {
      if (page.stage === "caster") return s(strings, "camp.prompt.spellWho");
      if (page.stage === "spell") return s(strings, "camp.prompt.spellWhich", { name: nameOf(m, page.casterId) });
      const sp = m.menu.members.find((x) => x.id === page.casterId)?.spells.find((x) => x.spellId === page.spellId);
      return s(strings, sp?.target === "dead" ? "camp.prompt.spellDead" : "camp.prompt.spellTarget");
    }
    case "item":
      if (page.stage === "member") return s(strings, "dungeon.items.who");
      if (page.stage === "item") return s(strings, "dungeon.items.which", { name: nameOf(m, page.memberId) });
      return s(strings, "dungeon.items.target");
    case "equip":
      if (page.stage === "member") return s(strings, "camp.prompt.equipWho");
      if (page.stage === "slot") return s(strings, "camp.prompt.equipSlot", { name: nameOf(m, page.memberId) });
      return s(strings, "camp.prompt.equipItem", { name: nameOf(m, page.memberId), slot: s(strings, `detail.slot.${page.slot}`) });
    case "order":
      return page.picked === null ? s(strings, "camp.prompt.order") : s(strings, "camp.prompt.orderSecond", { name: nameOf(m, page.picked) });
    case "identify":
      return s(strings, page.stage === "appraiser" ? "camp.prompt.identifyWho" : "camp.prompt.identifyWhich");
  }
}

/** ビュー領域に出すもの（状態と装備の枠・品は UI-59 の詳細、並び順は表、それ以外は見出しと問い） */
export function campPanel(page: CampPage, m: CampInput, strings: Strings): CampPanel {
  if (page.kind === "status") return { kind: "detail", memberId: page.memberId, focusSlot: null };
  if (page.kind === "equip" && page.stage !== "member") {
    return { kind: "detail", memberId: page.memberId, focusSlot: page.stage === "item" ? page.slot : null };
  }
  if (page.kind === "order") {
    return {
      kind: "order",
      rows: m.menu.members.map((x, i) => ({
        n: i + 1,
        name: x.name,
        row: s(strings, x.row === "front" ? "camp.order.front" : "camp.order.back"),
        picked: x.id === page.picked,
      })),
    };
  }
  return { kind: "text", title: s(strings, m.menu.place === "town" ? "town.menu.tavern" : "dungeon.menu.camp"), body: campHeader(page, m, strings) };
}

/**
 * sync で campMenu を取り直した後に、成り立たなくなった段を直す（送った後・戦闘の外での変化）。
 * 人がいない・行動できない・候補が無い段は host の最初のページへ（酒場は開いた項目の最初の段）。成り立つならそのまま返す
 */
export function campRepair(host: CampHost, page: CampPage, m: CampInput): CampPage {
  const menu = m.menu;
  const member = (id: string) => menu.members.find((x) => x.id === id);
  const reset = (): CampPage => {
    if (host === "camp") return { kind: "top" };
    if (page.kind === "status") return campFirstPage("tavern", "status", menu);
    if (page.kind === "equip") return { kind: "equip", stage: "member" };
    return { kind: "order", picked: null };
  };
  switch (page.kind) {
    case "top":
      return host === "camp" ? page : reset();
    case "status":
      return member(page.memberId) === undefined ? (host === "camp" ? reset() : campFirstPage("tavern", "status", menu)) : page;
    case "spell": {
      if (menu.place !== "dungeon") return reset();
      if (page.stage === "caster") return page;
      const c = member(page.casterId);
      if (c === undefined || !c.canAct) return reset();
      if (page.stage === "spell") return page;
      return c.spells.some((x) => x.spellId === page.spellId && x.usable) ? page : { kind: "spell", stage: "spell", casterId: page.casterId };
    }
    case "item": {
      if (m.items === null) return reset();
      if (page.stage === "member") return page;
      const x = m.items.members.find((y) => y.id === page.memberId);
      if (x === undefined || !x.canAct) return reset();
      if (page.stage === "item") return page;
      return x.items.some((it) => it.instanceId === page.instanceId && it.usable) ? page : { kind: "item", stage: "item", memberId: page.memberId };
    }
    case "equip":
      if (page.stage === "member") return page;
      return member(page.memberId)?.canAct === true ? page : reset();
    case "order":
      return page.picked === null || member(page.picked) !== undefined ? page : { kind: "order", picked: null };
    case "identify":
      if (menu.identifiers.length === 0) return reset();
      if (page.stage === "appraiser") return page;
      return menu.identifiers.some((x) => x.id === page.appraiserId) ? page : reset();
  }
}

/** 全項目（grid は空き枠を null のまま含む。添字は枠の位置）。キーとテストで使う */
export function campRows(e: CampEntries): (CampEntry | null)[] {
  return e.layout === "grid" ? e.slots : e.rows;
}

/**
 * UI-33 のキー: 数字 n → n 番目の枠・行（空き枠なら null）、Enter → 先頭の押せる項目、Esc → やめる / 戻る。該当が無ければ null。
 * 押せない項目の番号も返す（選んでも何もしないのは操作領域の側）
 */
export function campKeyIndex(a: Action, e: CampEntries): number | null {
  const rows = campRows(e);
  if (typeof a === "object") {
    const r = rows[a.menu];
    return r === undefined || r === null ? null : a.menu;
  }
  if (a === "confirm") {
    const i = rows.findIndex((x) => x !== null && !x.disabled);
    return i < 0 ? null : i;
  }
  if (a === "back") {
    const i = rows.findIndex((x) => x !== null && x.choice.kind === "cancel");
    return i < 0 ? null : i;
  }
  return null;
}

// ---------------------------------------------------------------- パネルの DOM

const LINE_H = 10;
const PAD = 4;

/** 描くもの。detail は app が formatDetail で作った文字列（state の Character から） */
export type CampPanelView =
  | { kind: "text"; title: string; body: string }
  | { kind: "detail"; detail: CharacterDetail; focusSlot: number | null }
  | { kind: "order"; lines: { text: string; picked: boolean }[] };

export type CampView = {
  el: HTMLElement;
  render(p: CampPanelView): void;
};

/** rect はステージ座標のパネルの範囲（layout.camp = ビュー領域）。メッセージ窓とパーティ欄は覆わない */
export function createCampView(rect: Rect): CampView {
  const el = document.createElement("div");
  el.className = "camp-view";
  Object.assign(el.style, {
    position: "absolute",
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.w}px`,
    height: `${rect.h}px`,
    background: "var(--c-bg)",
    color: "var(--c-text)",
  });
  const detail = createDetailView({ x: 0, y: 0, w: rect.w, h: rect.h });

  const line = (row: number, text: string, cls: string, color?: string): HTMLElement => {
    const t = document.createElement("div");
    t.className = cls;
    Object.assign(t.style, {
      position: "absolute",
      left: `${PAD}px`,
      top: `${PAD + LINE_H * row}px`,
      width: `${rect.w - 2 * PAD}px`,
      height: `${LINE_H}px`,
      lineHeight: `${LINE_H}px`,
      whiteSpace: "nowrap",
      overflow: "hidden",
    });
    if (color !== undefined) t.style.color = color;
    t.textContent = text;
    return t;
  };

  return {
    el,
    render(p: CampPanelView): void {
      if (p.kind === "detail") {
        detail.render(p.detail, p.focusSlot);
        el.replaceChildren(detail.el);
        return;
      }
      if (p.kind === "order") {
        el.replaceChildren(...p.lines.map((l, i) => line(i, l.text, "camp-order-row", l.picked ? "var(--c-accent)" : undefined)));
        return;
      }
      el.replaceChildren(line(0, p.title, "camp-title", "var(--c-accent)"), line(1, p.body, "camp-body"));
    },
  };
}
