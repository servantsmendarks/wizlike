// UI-53 迷宮のキャンプ、UI-59 キャラクター画面（M10）、TW-03 / UI-52 酒場の状態・並び順・図鑑。
// ページ（CampPage）を段にした純粋な状態機械と、パネルの DOM。
// - 候補・押せるか・対象の要否は core の campMenu と fieldItemMenu の値だけで決める（UI-35）。送る Command は
//   dungeon.cast / dungeon.useItem / party.equip / party.unequip / party.give / party.drop / party.reorder / party.identify。
// - 迷宮のキャンプの top は [状態][並び順][空き][空き] / [空き][空き][空き][戻る] の 4×2 の枠（layout.campGrid。M10 で 道具・装備・呪文・鑑定 を
//   キャラクター画面へ移した）。状態 → メンバー一覧（名前の 6 枠と [7] 戻る）→ 人 → キャラクター画面。
// - キャラクター画面（UI-59。M10）は 1 人の全部（能力値・装備・所持品・習得呪文）を 1 画面に出し、操作は 4×2 の枠
//   [装備][使う][渡す][捨てる] / [呪文][鑑定（鑑定できる職業の者だけ）][次の人][戻る]。その下の段（装備・使う・渡す・捨てる・呪文・鑑定）の
//   やめるは同じ人のキャラクター画面へ。キャラクター画面の戻るは、キャンプはメンバー一覧、酒場は閉じる（酒場の一覧・帯を押した街のページへ）。
// - 送った後も閉じずに、同じ者の段へ戻る（CampStep の after）。sync で campMenu を取り直し、campRepair で成り立たない段を直す。
// - 帰還の糸（FieldItemView.isReturn）は送る前に確認の段（confirmReturn。戻る / やめる）を挟む。捨てるも確認の段（drop の confirm）を挟む。
//   確認の段は表示層だけの値で、core の状態は確認まで変えない（保存しない）。
// - 所持品は 8 件、呪文は 14 件ずつの頁（渡す・捨てる・呪文の段の一覧の [次の頁][前の頁]。パネルも同じ頁を出す）。
// - UI-68（M10）: 呪文は 一覧 → 説明（[唱える][やめる]。パネルの呪文の枠を説明に置き換える）→ 対象。一覧の dim の呪文も説明を見られる（peek）。
// - UI-67（M10）: 装備の品の詳細の段のパネルには差分の引数（preview）を付け、app が core の equipPreview の差分を詳細の下に出す。
// DOM はパネル（createCampView）だけで、モジュールのトップレベルでは DOM に触れない。結線は app が行う。
import type { EquipSlot, Strings } from "../../core/data/index";
import type { CampMember, CampMenu, CampSummary, CampTargetBlock, Command, FieldItemMenu } from "../../core/types";
import type { Action } from "../input/swipe";
import type { Rect } from "../layout";
import { CHARACTER_INVENTORY_CELLS, CHARACTER_SPELL_CELLS, createDetailView, SLOT_ORDER, type CharacterDetail } from "./detail";
import type { PanelLine } from "./item-detail";
import { formatMessage } from "./message";

export type CampHost = "camp" | "tavern";
/** TW-03（M10）: 酒場の一覧から開く項目（状態は先頭の者のキャラクター画面） */
export type CampOpen = "status" | "order" | "book";
export type CampPage =
  | { kind: "top" }
  /** UI-53（M10）: キャンプの「状態」のメンバー一覧（名前の 6 枠と [7] 戻る） */
  | { kind: "members" }
  /** UI-59（M10）: キャラクター画面 */
  | { kind: "character"; memberId: string }
  | { kind: "equip"; stage: "slot"; memberId: string }
  | { kind: "equip"; stage: "item"; memberId: string; slot: EquipSlot }
  /** UI-59（M7）: 品の詳細（装備中の品なら 外す、候補なら 装備する / やめる） */
  | { kind: "equip"; stage: "detail"; memberId: string; slot: EquipSlot; instanceId: string }
  | { kind: "use"; stage: "item"; memberId: string }
  | { kind: "use"; stage: "target"; memberId: string; instanceId: string }
  /** DG-30 / UI-53（M5.5）: 帰還の糸を使う前の確認 */
  | { kind: "use"; stage: "confirmReturn"; memberId: string; instanceId: string }
  /** CH-78（M10）: 渡す品（page は所持品の頁） → 相手 */
  | { kind: "give"; stage: "item"; memberId: string; page: number }
  | { kind: "give"; stage: "to"; memberId: string; instanceId: string }
  /** CH-79（M10）: 捨てる品（page は所持品の頁） → 確認 */
  | { kind: "drop"; stage: "item"; memberId: string; page: number }
  | { kind: "drop"; stage: "confirm"; memberId: string; instanceId: string }
  /** MG-44（M10 で キャラクター画面の下へ）: 習得呪文の一覧（page は呪文の頁）→ 説明（UI-68。[唱える][やめる]）→ 対象 */
  | { kind: "spell"; stage: "spell"; memberId: string; page: number }
  | { kind: "spell"; stage: "info"; memberId: string; spellId: string }
  | { kind: "spell"; stage: "target"; memberId: string; spellId: string }
  /** CH-77（M10 で キャラクター画面の下へ）: memberId は鑑定する者。品はパーティ全員の未鑑定品 */
  | { kind: "identify"; memberId: string }
  | { kind: "order"; picked: string | null }
  /** IT-66（M7）: 図鑑（酒場の一覧から開く。操作はやめるだけ） */
  | { kind: "book" };
/** キャラクター画面の操作（UI-59。M10） */
export type CharacterAction = "equip" | "use" | "give" | "drop" | "spell" | "identify";
export type CampChoice =
  | { kind: "open"; page: CampPage }
  | { kind: "member"; memberId: string }
  /** UI-59（M10）: キャラクター画面の操作の枠 */
  | { kind: "action"; action: CharacterAction }
  /** UI-59（M10）: 次の人（並び順で巡回） */
  | { kind: "nextMember" }
  /** 渡す・捨てる・呪文の段の頁送り（+1 で次、-1 で前） */
  | { kind: "pageTurn"; delta: 1 | -1 }
  | { kind: "spell"; spellId: string }
  | { kind: "item"; instanceId: string }
  | { kind: "target"; targetId: string }
  | { kind: "slot"; slot: EquipSlot }
  | { kind: "equip"; instanceId: string }
  | { kind: "unequip" }
  /** UI-59（M7）: 装備の段の品の行。押すと品の詳細の段へ */
  | { kind: "detail"; instanceId: string }
  | { kind: "identifyItem"; instanceId: string }
  /** 確認の段の決定（帰還の糸の「戻る」・捨てるの「捨てる」・呪文の説明の段の「唱える」（UI-68）） */
  | { kind: "confirm" }
  /** 押しても何もしない行（「装備できる物がない」など） */
  | { kind: "none" }
  /** やめる / 戻る */
  | { kind: "cancel" };
/**
 * reason は押せない項目を押したときに語る文（core の値から作ったものだけ。無ければ何もしない）。
 * peek は dim（disabled）でも選べる行（UI-68 の呪文の一覧。唱えられない呪文も説明を見られる。押しても送るのは説明の段の「唱える」だけ）
 */
export type CampEntry = { label: string; disabled: boolean; choice: CampChoice; reason?: string; peek?: true };
/** grid は layout.campGrid の 8 枠（null は空き枠）、list は操作領域の一覧 */
export type CampEntries = { layout: "grid"; slots: (CampEntry | null)[] } | { layout: "list"; rows: CampEntry[] };
/** 段を移る・閉じる・送る（送った後は after の段へ） */
export type CampStep = { kind: "page"; page: CampPage } | { kind: "close" } | { kind: "send"; command: Command; after: CampPage };
/**
 * ビューに出すもの。text は場所の見出し（キャンプ / 酒場。迷宮のキャンプの top だけ、見出しの下に campSummary の行を lines で出す）、
 * character は UI-59 のキャラクター画面（focusSlot はその枠を accent 色、spellPage / inventoryPage は頁の段の頁。省略は先頭から「ほか n」）、
 * order は並び順の表
 */
export type CampPanel =
  | { kind: "text"; title: string; lines?: string[] }
  /** spellInfo は UI-68（M10）の呪文の説明の段・対象の段の呪文（呪文の枠を説明に置き換える。app が core の spellInfo から作る） */
  | { kind: "character"; memberId: string; focusSlot: EquipSlot | null; spellPage?: number; inventoryPage?: number; spellInfo?: string }
  | { kind: "order"; rows: { n: number; name: string; row: string; picked: boolean }[] }
  /**
   * UI-59（M7）: 品の詳細（app が core の itemDetail から formatItemDetail で行を作る）。
   * preview は UI-67（M10）の装備の差分の引数（app が core の equipPreview に渡す。instanceId null はその枠の装備中の品を外すとき）
   */
  | { kind: "item"; instanceId: string; preview?: { memberId: string; slot: EquipSlot; instanceId: string | null } }
  /** IT-66（M7）: 図鑑（app が core の uniqueBookView から formatBook で行を作る） */
  | { kind: "book" };
/**
 * summary は core の campSummary（迷宮のキャンプだけ非 null。UI-53）。
 * identifyMpCost は CH-77（M10）の鑑定 1 回の MP（config.identify.mpCost。鑑定の段の見出しに出すだけ）
 */
export type CampInput = { menu: CampMenu; items: FieldItemMenu | null; summary: CampSummary | null; identifyMpCost: number };

/** campGrid の枠の数（4 列 × 2 段）。[7] がやめる / 戻る */
export const CAMP_GRID_SLOTS = 8;

function s(strings: Strings, key: string, params?: Record<string, string | number>): string {
  return formatMessage(strings[key] ?? key, params);
}

/**
 * UI-59（M10）: キャラクター画面とその下の段か（パネルを 240×284 に広げ、パーティ欄とメッセージ窓を隠し、語りを会話の箱に出す間）。
 * top・メンバー一覧・並び順・図鑑は偽
 */
export function campCharacterOpen(page: CampPage): boolean {
  return page.kind !== "top" && page.kind !== "members" && page.kind !== "order" && page.kind !== "book";
}

/** キャラクター画面とその下の段の人（それ以外は null） */
function pageMember(page: CampPage): string | null {
  return campCharacterOpen(page) && "memberId" in page ? page.memberId : null;
}

/**
 * host の最初のページ。camp は top。酒場は開いた項目（状態は先頭の者（memberId を渡せばその人）のキャラクター画面、並び順は未選択、図鑑）
 */
export function campFirstPage(host: CampHost, open?: CampOpen, menu?: CampMenu, memberId?: string): CampPage {
  if (host === "camp" || open === undefined) return { kind: "top" };
  switch (open) {
    case "status":
      return { kind: "character", memberId: memberId ?? menu?.members[0]?.id ?? "" };
    case "order":
      return { kind: "order", picked: null };
    case "book":
      return { kind: "book" };
  }
}

/** やめる / 戻るの行き先（キャラクター画面の下の段は同じ人のキャラクター画面、その上は host ごと） */
function cancelStep(host: CampHost, page: CampPage, m: CampInput): CampStep {
  const go = (p: CampPage): CampStep => ({ kind: "page", page: p });
  switch (page.kind) {
    case "top":
      return { kind: "close" };
    case "members":
      return host === "camp" ? go({ kind: "top" }) : { kind: "close" };
    case "character":
      return host === "camp" ? go({ kind: "members" }) : { kind: "close" };
    case "order":
    case "book":
      return host === "camp" ? go({ kind: "top" }) : { kind: "close" };
    case "equip":
      if (page.stage === "slot") return go({ kind: "character", memberId: page.memberId });
      if (page.stage === "item") return go({ kind: "equip", stage: "slot", memberId: page.memberId });
      return go({ kind: "equip", stage: "item", memberId: page.memberId, slot: page.slot });
    case "use":
      if (page.stage === "item") return go({ kind: "character", memberId: page.memberId });
      return go({ kind: "use", stage: "item", memberId: page.memberId });
    case "give":
      if (page.stage === "item") return go({ kind: "character", memberId: page.memberId });
      return go({ kind: "give", stage: "item", memberId: page.memberId, page: inventoryPageOf(m, page.memberId, page.instanceId) });
    case "drop":
      if (page.stage === "item") return go({ kind: "character", memberId: page.memberId });
      return go({ kind: "drop", stage: "item", memberId: page.memberId, page: inventoryPageOf(m, page.memberId, page.instanceId) });
    case "spell":
      if (page.stage === "spell") return go({ kind: "character", memberId: page.memberId });
      if (page.stage === "info") return go(spellListPage(m, page.memberId, page.spellId));
      return go({ kind: "spell", stage: "info", memberId: page.memberId, spellId: page.spellId });
    case "identify":
      return go({ kind: "character", memberId: page.memberId });
  }
}

const memberOf = (m: CampInput, id: string): CampMember | undefined => m.menu.members.find((x) => x.id === id);
const nameOf = (m: CampInput, id: string): string => memberOf(m, id)?.name ?? "";

/** 頁の数（0 件でも 1） */
function pageCount(n: number, per: number): number {
  return Math.max(1, Math.ceil(n / per));
}
/** 所持品の instanceId が載る頁（無ければ 0） */
function inventoryPageOf(m: CampInput, memberId: string, instanceId: string): number {
  const i = memberOf(m, memberId)?.inventory.findIndex((x) => x.instanceId === instanceId) ?? -1;
  return i < 0 ? 0 : Math.floor(i / CHARACTER_INVENTORY_CELLS);
}
/** spellId が載る呪文の頁（無ければ 0） */
function spellPageOf(m: CampInput, memberId: string, spellId: string): number {
  const i = memberOf(m, memberId)?.knownSpells.findIndex((x) => x.spellId === spellId) ?? -1;
  return i < 0 ? 0 : Math.floor(i / CHARACTER_SPELL_CELLS);
}
/** 呪文の一覧の段（spellId が載る頁） */
function spellListPage(m: CampInput, memberId: string, spellId: string): CampPage {
  return { kind: "spell", stage: "spell", memberId, page: spellPageOf(m, memberId, spellId) };
}

/** 名前の 6 枠と [7] やめる / 戻る（disabled は dim） */
function memberGrid(m: CampInput, dim: (id: string) => boolean, cancel: CampEntry): CampEntries {
  const slots: (CampEntry | null)[] = Array.from({ length: CAMP_GRID_SLOTS }, () => null);
  m.menu.members.slice(0, CAMP_GRID_SLOTS - 1).forEach((x, i) => {
    slots[i] = { label: x.name, disabled: dim(x.id), choice: { kind: "member", memberId: x.id } };
  });
  slots[CAMP_GRID_SLOTS - 1] = cancel;
  return { layout: "grid", slots };
}

/** 頁送りの行（頁が 2 つ以上のときだけ。次の頁は最後の頁で、前の頁は最初の頁で dim） */
function pageRows(strings: Strings, page: number, count: number): CampEntry[] {
  if (count <= 1) return [];
  return [
    { label: s(strings, "character.pageNext"), disabled: page >= count - 1, choice: { kind: "pageTurn", delta: 1 } },
    { label: s(strings, "character.pagePrev"), disabled: page <= 0, choice: { kind: "pageTurn", delta: -1 } },
  ];
}

/** その段の項目。grid は 8 枠、list は末尾がやめる */
export function campEntries(_host: CampHost, page: CampPage, m: CampInput, strings: Strings): CampEntries {
  const cancel: CampEntry = { label: s(strings, "common.cancel"), disabled: false, choice: { kind: "cancel" } };
  const back: CampEntry = { label: s(strings, "common.back"), disabled: false, choice: { kind: "cancel" } };
  const list = (rows: CampEntry[]): CampEntries => ({ layout: "list", rows: [...rows, cancel] });
  // MG-44 / UI-53（2026-10-05）: 回復の対象の行。core の targets の block があれば dim にし、理由を名前と HP の後ろに付ける（戦闘中の対象は別の部品）
  const targetRow = (a: { id: string; name: string; hp: number; hpMax: number }, block: CampTargetBlock | null): CampEntry => {
    const row = s(strings, "dungeon.items.allyRow", { name: a.name, hp: a.hp, hpMax: a.hpMax });
    return {
      label: block === null ? row : s(strings, "camp.target.blocked", { row, why: s(strings, `camp.targetBlock.${block}`) }),
      disabled: block !== null,
      choice: { kind: "target", targetId: a.id },
    };
  };
  const menu = m.menu;
  switch (page.kind) {
    case "top": {
      const open = (key: string, p: CampPage): CampEntry => ({ label: s(strings, key), disabled: false, choice: { kind: "open", page: p } });
      return {
        layout: "grid",
        slots: [open("camp.status", { kind: "members" }), open("camp.order", { kind: "order", picked: null }), null, null, null, null, null, back],
      };
    }
    case "members":
      return memberGrid(m, () => false, back);
    case "character": {
      const x = memberOf(m, page.memberId);
      const it = m.items?.members.find((y) => y.id === page.memberId);
      const act = (action: CharacterAction, disabled: boolean, reason?: string): CampEntry => ({
        label: s(strings, `character.${action}`),
        disabled,
        choice: { kind: "action", action },
        ...(reason !== undefined ? { reason } : {}),
      });
      const empty = (x?.inventory.length ?? 0) === 0;
      // 鑑定: 鑑定できる職業の者だけ枠を出す。送れない理由（行動不能・MP・品が無い）は core の identifyBlock
      const block = x === undefined ? "cannotIdentify" : x.identifyBlock;
      const identify = block === "cannotIdentify" ? null : act("identify", block !== null, block === null ? undefined : s(strings, `camp.identifyBlock.${block}`, { name: x?.name ?? "" }));
      return {
        layout: "grid",
        slots: [
          act("equip", false),
          act("use", it === undefined || !it.canAct || !it.items.some((y) => y.usable)),
          act("give", empty),
          act("drop", empty),
          // UI-68（M10）: 習得呪文があれば押せる（唱えられない呪文も一覧から説明を見られる。唱えられるかは説明の段の「唱える」）
          act("spell", (x?.knownSpells.length ?? 0) === 0),
          identify,
          { label: s(strings, "character.next"), disabled: menu.members.length <= 1, choice: { kind: "nextMember" } },
          back,
        ],
      };
    }
    case "equip": {
      const x = memberOf(m, page.memberId);
      if (page.stage === "slot") {
        const slots: (CampEntry | null)[] = Array.from({ length: CAMP_GRID_SLOTS }, () => null);
        SLOT_ORDER.forEach((slot, i) => {
          slots[i] = { label: s(strings, `detail.slot.${slot}`), disabled: false, choice: { kind: "slot", slot } };
        });
        slots[CAMP_GRID_SLOTS - 1] = cancel;
        return { layout: "grid", slots };
      }
      const cur = x?.slots.find((sl) => sl.slot === page.slot);
      const cands = (x?.equipCandidates ?? []).filter((c) => c.slot === page.slot);
      if (page.stage === "detail") {
        // UI-59（M7）: 装備中の品なら 外す（外せなければ dim）、候補なら 装備する（装備できなければ理由を付けて dim）→ やめる
        if (cur !== undefined && cur.instanceId === page.instanceId) {
          return list([{ label: s(strings, "camp.equip.unequip"), disabled: !cur.canUnequip, choice: { kind: "unequip" } }]);
        }
        const c = cands.find((y) => y.instanceId === page.instanceId);
        if (c === undefined) return list([]);
        const label = s(strings, "camp.equip.do");
        return list([
          {
            label: c.block === null ? label : s(strings, "camp.equip.blocked", { name: label, why: s(strings, `camp.equipBlock.${c.block}`) }),
            disabled: c.block !== null,
            choice: { kind: "equip", instanceId: c.instanceId },
          },
        ]);
      }
      // 外す → 装備中の品（M7: 押すと詳細）→ 候補（M7: 押すと詳細。装備できない品も詳細は見られるので dim にしない）
      const rows: CampEntry[] = [];
      if (cur !== undefined && cur.instanceId !== null) {
        rows.push({ label: s(strings, "camp.equip.unequip"), disabled: !cur.canUnequip, choice: { kind: "unequip" } });
        rows.push({ label: s(strings, "camp.equip.current", { name: cur.name ?? "" }), disabled: false, choice: { kind: "detail", instanceId: cur.instanceId } });
      }
      for (const c of cands) {
        rows.push({
          label: c.block === null ? c.name : s(strings, "camp.equip.blocked", { name: c.name, why: s(strings, `camp.equipBlock.${c.block}`) }),
          disabled: false,
          choice: { kind: "detail", instanceId: c.instanceId },
        });
      }
      if (cands.length === 0) rows.push({ label: s(strings, "camp.equip.none"), disabled: true, choice: { kind: "none" } });
      return list(rows);
    }
    case "use": {
      const items = m.items;
      if (page.stage === "item") {
        const x = items?.members.find((y) => y.id === page.memberId);
        return list((x?.items ?? []).map((it) => ({ label: it.name, disabled: !it.usable, choice: { kind: "item", instanceId: it.instanceId } })));
      }
      if (page.stage === "confirmReturn") {
        // 戻る（先頭。Enter）/ やめる（末尾。UI-11 の固定の位置。Esc）
        return list([{ label: s(strings, "camp.returnConfirm.yes"), disabled: false, choice: { kind: "confirm" } }]);
      }
      const it = items?.members.find((y) => y.id === page.memberId)?.items.find((y) => y.instanceId === page.instanceId);
      return list((items?.allies ?? []).map((a) => targetRow(a, it?.targets.find((t) => t.id === a.id)?.block ?? null)));
    }
    case "give":
    case "drop": {
      const x = memberOf(m, page.memberId);
      if (page.kind === "drop" && page.stage === "confirm") {
        return list([{ label: s(strings, "camp.dropYes"), disabled: false, choice: { kind: "confirm" } }]);
      }
      if (page.kind === "give" && page.stage === "to") {
        // CH-78: 自分以外の全員。受け取れない者（使用枠が満杯。core の canReceive）は理由付きで dim
        return list(
          menu.members
            .filter((y) => y.id !== page.memberId)
            .map((y) => ({
              label: y.canReceive ? y.name : s(strings, "camp.equip.blocked", { name: y.name, why: s(strings, "camp.giveBlock.full") }),
              disabled: !y.canReceive,
              choice: { kind: "target", targetId: y.id },
            })),
        );
      }
      const inv = x?.inventory ?? [];
      const p = page.stage === "item" ? page.page : 0;
      const rows: CampEntry[] = inv
        .slice(p * CHARACTER_INVENTORY_CELLS, (p + 1) * CHARACTER_INVENTORY_CELLS)
        .map((it) => ({ label: it.name, disabled: false, choice: { kind: "item", instanceId: it.instanceId } }));
      return list([...rows, ...pageRows(strings, p, pageCount(inv.length, CHARACTER_INVENTORY_CELLS))]);
    }
    case "spell": {
      const x = memberOf(m, page.memberId);
      if (page.stage === "spell") {
        const known = x?.knownSpells ?? [];
        const rows: CampEntry[] = known
          .slice(page.page * CHARACTER_SPELL_CELLS, (page.page + 1) * CHARACTER_SPELL_CELLS)
          // UI-68（M10）: 唱えられない呪文は dim のまま、押すと説明の段へ（peek）
          .map((sp) => ({ label: s(strings, "camp.spellRow", { name: sp.name, mp: sp.mp }), disabled: !sp.castable, choice: { kind: "spell", spellId: sp.spellId }, peek: true }));
        return list([...rows, ...pageRows(strings, page.page, pageCount(known.length, CHARACTER_SPELL_CELLS))]);
      }
      if (page.stage === "info") {
        // UI-68（M10）: 唱える（戦闘外で唱えられ MP が足りる。core の castable）/ やめる
        const castable = x?.knownSpells.find((y) => y.spellId === page.spellId)?.castable ?? false;
        return list([{ label: s(strings, "spell.info.cast"), disabled: !castable, choice: { kind: "confirm" } }]);
      }
      const sp = x?.spells.find((y) => y.spellId === page.spellId);
      if (sp?.target === "dead") {
        return list(menu.dead.map((d) => ({ label: d.name, disabled: false, choice: { kind: "target", targetId: d.id } })));
      }
      return list(menu.allies.map((a) => targetRow(a, sp?.targets.find((t) => t.id === a.id)?.block ?? null)));
    }
    case "identify": {
      // CH-77（M10）: 行は「{owner}: {name}　{rate}%」（rate は core の identifyRates）。送れない間（行動不能・MP 切れ）は dim で、
      // 押すと core の identifyBlock の理由を語る（可否は canIdentifyNow だけで決める）
      const x = memberOf(m, page.memberId);
      const block = x?.identifyBlock ?? null;
      const why = block === null || x?.canIdentifyNow === true ? undefined : s(strings, `camp.identifyBlock.${block}`, { name: x?.name ?? "" });
      const rows: CampEntry[] = menu.unidentified.map((u) => ({
        label: s(strings, "camp.identifyRow", {
          owner: u.ownerName,
          name: u.name,
          rate: x?.identifyRates.find((r) => r.instanceId === u.instanceId)?.rate ?? "?",
        }),
        disabled: x?.canIdentifyNow !== true,
        choice: { kind: "identifyItem", instanceId: u.instanceId },
        ...(why === undefined ? {} : { reason: why }),
      }));
      if (rows.length === 0) rows.push({ label: s(strings, "camp.identify.none"), disabled: true, choice: { kind: "none" } });
      return list(rows);
    }
    case "order":
      return memberGrid(m, () => false, cancel);
    case "book":
      // IT-66: 図鑑はパネルに出すだけで、操作はやめるだけ
      return list([]);
  }
}

/**
 * UI-59（M10）: キャラクター画面の人を並び順で dir（+1 次 / −1 前）に巡回したページ。キャラクター画面でなければ null
 */
export function campCycle(page: CampPage, m: CampInput, dir: 1 | -1): CampPage | null {
  if (page.kind !== "character") return null;
  const ids = m.menu.members.map((x) => x.id);
  if (ids.length === 0) return null;
  const i = ids.indexOf(page.memberId);
  const n = ids.length;
  return { kind: "character", memberId: ids[(((i < 0 ? 0 : i) + dir) % n + n) % n]! };
}

/** 1 つ選ぶ。段に合わない選択と none は同じ段のまま */
export function campStep(host: CampHost, page: CampPage, m: CampInput, choice: CampChoice): CampStep {
  const stay: CampStep = { kind: "page", page };
  const go = (p: CampPage): CampStep => ({ kind: "page", page: p });
  if (choice.kind === "cancel") return cancelStep(host, page, m);
  const menu = m.menu;
  switch (page.kind) {
    case "top":
      return choice.kind === "open" ? go(choice.page) : stay;
    case "members":
      return choice.kind === "member" ? go({ kind: "character", memberId: choice.memberId }) : stay;
    case "character": {
      if (choice.kind === "nextMember") return go(campCycle(page, m, 1) ?? page);
      if (choice.kind !== "action") return stay;
      const id = page.memberId;
      switch (choice.action) {
        case "equip":
          return go({ kind: "equip", stage: "slot", memberId: id });
        case "use":
          return go({ kind: "use", stage: "item", memberId: id });
        case "give":
          return go({ kind: "give", stage: "item", memberId: id, page: 0 });
        case "drop":
          return go({ kind: "drop", stage: "item", memberId: id, page: 0 });
        case "spell":
          return go({ kind: "spell", stage: "spell", memberId: id, page: 0 });
        case "identify":
          return go({ kind: "identify", memberId: id });
      }
      return stay;
    }
    case "equip": {
      if (page.stage === "slot") {
        return choice.kind === "slot" ? go({ kind: "equip", stage: "item", memberId: page.memberId, slot: choice.slot }) : stay;
      }
      const slotStage: CampPage = { kind: "equip", stage: "slot", memberId: page.memberId };
      if (choice.kind === "unequip") return { kind: "send", command: { type: "party.unequip", memberId: page.memberId, slot: page.slot }, after: slotStage };
      if (choice.kind === "equip") return { kind: "send", command: { type: "party.equip", memberId: page.memberId, instanceId: choice.instanceId }, after: slotStage };
      if (choice.kind === "detail" && page.stage === "item") {
        return go({ kind: "equip", stage: "detail", memberId: page.memberId, slot: page.slot, instanceId: choice.instanceId });
      }
      return stay;
    }
    case "use": {
      const back: CampPage = { kind: "use", stage: "item", memberId: page.memberId };
      if (page.stage === "confirmReturn") {
        if (choice.kind !== "confirm") return stay;
        return { kind: "send", command: { type: "dungeon.useItem", memberId: page.memberId, itemId: page.instanceId }, after: back };
      }
      if (page.stage === "item") {
        if (choice.kind !== "item") return stay;
        const it = m.items?.members.find((x) => x.id === page.memberId)?.items.find((x) => x.instanceId === choice.instanceId);
        if (it === undefined) return stay;
        if (it.target === "ally") return go({ kind: "use", stage: "target", memberId: page.memberId, instanceId: it.instanceId });
        // DG-30 / UI-53（M5.5）: 帰還の糸は送らずに確認の段へ（使えるかは core の usable。dim の品は操作領域が押させない）
        if (it.isReturn) return go({ kind: "use", stage: "confirmReturn", memberId: page.memberId, instanceId: it.instanceId });
        return { kind: "send", command: { type: "dungeon.useItem", memberId: page.memberId, itemId: it.instanceId }, after: back };
      }
      if (choice.kind !== "target") return stay;
      return { kind: "send", command: { type: "dungeon.useItem", memberId: page.memberId, itemId: page.instanceId, targetId: choice.targetId }, after: back };
    }
    case "give":
    case "drop": {
      const inv = memberOf(m, page.memberId)?.inventory ?? [];
      if (page.stage === "item") {
        if (choice.kind === "pageTurn") {
          const p = page.page + choice.delta;
          return p < 0 || p >= pageCount(inv.length, CHARACTER_INVENTORY_CELLS) ? stay : go({ ...page, page: p });
        }
        if (choice.kind !== "item" || !inv.some((x) => x.instanceId === choice.instanceId)) return stay;
        return page.kind === "give"
          ? go({ kind: "give", stage: "to", memberId: page.memberId, instanceId: choice.instanceId })
          : go({ kind: "drop", stage: "confirm", memberId: page.memberId, instanceId: choice.instanceId });
      }
      const after: CampPage = { kind: page.kind, stage: "item", memberId: page.memberId, page: inventoryPageOf(m, page.memberId, page.instanceId) };
      if (page.kind === "give" && page.stage === "to") {
        if (choice.kind !== "target" || choice.targetId === page.memberId) return stay;
        return { kind: "send", command: { type: "party.give", memberId: page.memberId, instanceId: page.instanceId, toId: choice.targetId }, after };
      }
      if (page.kind === "drop" && page.stage === "confirm" && choice.kind === "confirm") {
        return { kind: "send", command: { type: "party.drop", memberId: page.memberId, instanceId: page.instanceId }, after };
      }
      return stay;
    }
    case "spell": {
      const x = memberOf(m, page.memberId);
      if (page.stage === "spell") {
        if (choice.kind === "pageTurn") {
          const p = page.page + choice.delta;
          return p < 0 || p >= pageCount(x?.knownSpells.length ?? 0, CHARACTER_SPELL_CELLS) ? stay : go({ ...page, page: p });
        }
        if (choice.kind !== "spell") return stay;
        // UI-68（M10）: 習得呪文なら（戦闘専用・MP の足りない呪文も）説明の段へ
        if (!(x?.knownSpells.some((y) => y.spellId === choice.spellId) ?? false)) return stay;
        return go({ kind: "spell", stage: "info", memberId: page.memberId, spellId: choice.spellId });
      }
      if (page.stage === "info") {
        if (choice.kind !== "confirm") return stay;
        // 戦闘外で唱えられる呪文（knownSpells の castable、対象は campMenu の spells）だけ先へ進む
        const sp = x?.spells.find((y) => y.spellId === page.spellId);
        if (sp === undefined || !(x?.knownSpells.find((y) => y.spellId === page.spellId)?.castable ?? false)) return stay;
        const list = spellListPage(m, page.memberId, sp.spellId);
        if (sp.target === "none") return { kind: "send", command: { type: "dungeon.cast", memberId: page.memberId, spellId: sp.spellId }, after: list };
        return go({ kind: "spell", stage: "target", memberId: page.memberId, spellId: sp.spellId });
      }
      if (choice.kind !== "target") return stay;
      return {
        kind: "send",
        command: { type: "dungeon.cast", memberId: page.memberId, spellId: page.spellId, targetId: choice.targetId },
        after: spellListPage(m, page.memberId, page.spellId),
      };
    }
    case "identify":
      if (choice.kind !== "identifyItem") return stay;
      return { kind: "send", command: { type: "party.identify", memberId: page.memberId, instanceId: choice.instanceId }, after: page };
    case "order": {
      if (choice.kind !== "member") return stay;
      if (page.picked === null) return go({ kind: "order", picked: choice.memberId });
      if (page.picked === choice.memberId) return go({ kind: "order", picked: null });
      const ids = menu.members.map((x) => x.id);
      const a = ids.indexOf(page.picked);
      const b = ids.indexOf(choice.memberId);
      if (a < 0 || b < 0) return stay;
      const order = ids.slice();
      order[a] = choice.memberId;
      order[b] = page.picked;
      return { kind: "send", command: { type: "party.reorder", order }, after: { kind: "order", picked: null } };
    }
    case "book":
      return stay;
  }
}

/** その段の問い（ヘッダーに出す） */
export function campHeader(page: CampPage, m: CampInput, strings: Strings): string {
  switch (page.kind) {
    case "top":
      return s(strings, "camp.prompt.top");
    case "members":
      return s(strings, "camp.prompt.members");
    case "character":
      return s(strings, "camp.prompt.status", { name: nameOf(m, page.memberId) });
    case "equip":
      if (page.stage === "slot") return s(strings, "camp.prompt.equipSlot", { name: nameOf(m, page.memberId) });
      return s(strings, "camp.prompt.equipItem", { name: nameOf(m, page.memberId), slot: s(strings, `detail.slot.${page.slot}`) });
    case "use":
      if (page.stage === "item") return s(strings, "dungeon.items.which", { name: nameOf(m, page.memberId) });
      if (page.stage === "confirmReturn") {
        const it = m.items?.members.find((x) => x.id === page.memberId)?.items.find((x) => x.instanceId === page.instanceId);
        return s(strings, "camp.returnConfirm.prompt", { item: it?.name ?? "" });
      }
      return s(strings, "dungeon.items.target");
    case "give":
      return page.stage === "item" ? s(strings, "camp.prompt.giveWhich", { name: nameOf(m, page.memberId) }) : s(strings, "camp.prompt.giveTo");
    case "drop": {
      if (page.stage === "item") return s(strings, "camp.prompt.dropWhich", { name: nameOf(m, page.memberId) });
      const it = memberOf(m, page.memberId)?.inventory.find((x) => x.instanceId === page.instanceId);
      return s(strings, "camp.dropConfirm", { item: it?.name ?? "" });
    }
    case "spell": {
      if (page.stage === "spell" || page.stage === "info") return s(strings, "camp.prompt.spellWhich", { name: nameOf(m, page.memberId) });
      const sp = memberOf(m, page.memberId)?.spells.find((x) => x.spellId === page.spellId);
      return s(strings, sp?.target === "dead" ? "camp.prompt.spellDead" : "camp.prompt.spellTarget");
    }
    case "identify":
      return s(strings, "camp.prompt.identifyWhich", { cost: m.identifyMpCost });
    case "order":
      return page.picked === null ? s(strings, "camp.prompt.order") : s(strings, "camp.prompt.orderSecond", { name: nameOf(m, page.picked) });
    case "book":
      return s(strings, "camp.prompt.book");
  }
}

/** ビューに出すもの（キャラクター画面とその下の段は UI-59 の画面、品の詳細、並び順の表、図鑑、それ以外は場所の見出しだけ） */
export function campPanel(page: CampPage, m: CampInput, strings: Strings): CampPanel {
  if (page.kind === "equip" && page.stage === "detail") {
    // UI-67（M10）: 差分の引数。その枠の装備中の品なら外すとき（null）、候補なら装備するとき
    const cur = memberOf(m, page.memberId)?.slots.find((sl) => sl.slot === page.slot);
    const equipped = cur !== undefined && cur.instanceId === page.instanceId;
    return { kind: "item", instanceId: page.instanceId, preview: { memberId: page.memberId, slot: page.slot, instanceId: equipped ? null : page.instanceId } };
  }
  if (page.kind === "book") return { kind: "book" };
  const who = pageMember(page);
  if (who !== null) {
    const focusSlot = page.kind === "equip" && page.stage === "item" ? page.slot : null;
    const base = { kind: "character" as const, memberId: who, focusSlot };
    if (page.kind === "spell") {
      if (page.stage === "spell") return { ...base, spellPage: page.page };
      // UI-68（M10）: 説明の段と対象の段は、呪文の枠をその呪文の説明に置き換える
      return { ...base, spellPage: spellPageOf(m, page.memberId, page.spellId), spellInfo: page.spellId };
    }
    if ((page.kind === "give" || page.kind === "drop") && page.stage === "item") return { ...base, inventoryPage: page.page };
    return base;
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
  const title = s(strings, m.menu.place === "town" ? "town.menu.tavern" : "dungeon.menu.camp");
  const sum = m.summary;
  if (page.kind !== "top" || sum === null) return { kind: "text", title };
  return {
    kind: "text",
    title,
    lines: [
      s(strings, "camp.summary.place", { dungeon: sum.dungeonName, floor: sum.floor }),
      s(strings, "camp.summary.gold", { gold: sum.gold }),
      s(strings, "camp.summary.ledger", { gold: sum.ledgerGold, items: sum.ledgerItems }),
      s(strings, "camp.summary.return", { count: sum.returnItems }),
      ...(sum.morale ? [s(strings, "camp.summary.morale")] : []), // TW-15: 士気がある間だけ 5 行目
    ],
  };
}

/**
 * sync で campMenu を取り直した後に、成り立たなくなった段を直す（送った後・戦闘の外での変化）。
 * 人がいなくなった段は host の最初のページ（キャンプはメンバー一覧、酒場は先頭の者のキャラクター画面）、
 * 品・呪文・対象が成り立たない段は同じ人の 1 つ上の段へ。成り立つならそのまま返す
 */
export function campRepair(host: CampHost, page: CampPage, m: CampInput): CampPage {
  const menu = m.menu;
  const member = (id: string) => memberOf(m, id);
  const lost = (): CampPage => (host === "camp" ? { kind: "members" } : campFirstPage("tavern", "status", menu));
  switch (page.kind) {
    case "top":
      return host === "camp" ? page : campFirstPage("tavern", "order", menu);
    case "members":
      return host === "camp" ? page : campFirstPage("tavern", "status", menu);
    case "order":
      return page.picked === null || member(page.picked) !== undefined ? page : { kind: "order", picked: null };
    case "book":
      return page;
    default:
      break;
  }
  const x = member(page.memberId);
  if (x === undefined) return lost();
  const character: CampPage = { kind: "character", memberId: page.memberId };
  switch (page.kind) {
    case "character":
      return page;
    case "equip": {
      // U6（M10）: 行動できない者・死亡・灰の者の段も成り立つ（外すは core の canUnequip、装備するは core の block で dim）
      if (page.stage !== "detail") return page;
      // UI-59（M7）: 詳細の品が、その枠の装備中の品でも候補でもなくなったら（付け外しの後など）同じ枠の品の段へ
      const id = page.instanceId;
      const here = x.slots.some((sl) => sl.slot === page.slot && sl.instanceId === id) || x.equipCandidates.some((c) => c.slot === page.slot && c.instanceId === id);
      return here ? page : { kind: "equip", stage: "item", memberId: page.memberId, slot: page.slot };
    }
    case "use": {
      const it = m.items?.members.find((y) => y.id === page.memberId);
      if (it === undefined || !it.canAct) return character;
      if (page.stage === "item") return page;
      // 対象の段・確認の段: 品が消えた・使えなくなったら同じ者の道具の段へ
      return it.items.some((y) => y.instanceId === page.instanceId && y.usable) ? page : { kind: "use", stage: "item", memberId: page.memberId };
    }
    case "give":
    case "drop": {
      if (page.stage === "item") {
        const last = pageCount(x.inventory.length, CHARACTER_INVENTORY_CELLS) - 1;
        return page.page > last ? { ...page, page: last } : page;
      }
      // 相手・確認の段: 品が手元から消えたら同じ者の品の段へ
      return x.inventory.some((y) => y.instanceId === page.instanceId) ? page : { kind: page.kind, stage: "item", memberId: page.memberId, page: 0 };
    }
    case "spell": {
      if (page.stage === "spell") {
        const last = pageCount(x.knownSpells.length, CHARACTER_SPELL_CELLS) - 1;
        return page.page > last ? { ...page, page: last } : page;
      }
      // UI-68（M10）: 説明の段は、その呪文を覚えている間は成り立つ（唱えられなければ「唱える」が dim）
      if (page.stage === "info") return x.knownSpells.some((y) => y.spellId === page.spellId) ? page : spellListPage(m, page.memberId, page.spellId);
      // 対象の段で、その呪文が使えなくなった（MP 切れ・行動不能）→ 同じ者の呪文の一覧
      return x.spells.some((y) => y.spellId === page.spellId && y.usable) ? page : spellListPage(m, page.memberId, page.spellId);
    }
    case "identify":
      return x.identifyBlock === "cannotIdentify" ? character : page;
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
/**
 * 並び順の表の列（パネル内の x と幅。美咲は半角 4px・全角 8px）。
 * 番号と名前（camp.order.row「{n} {name}」。半角 1 字 + 空白 + 全角 6 文字 = 56px）の列と、前衛 / 後衛の列。
 * 前衛 / 後衛の列は名前の長さによらず同じ x に置く（パーティ欄の PARTY_COLUMNS と同じく、名前は全角 6 文字ぶんの幅で切る）
 */
export const ORDER_COLUMNS = {
  name: { left: PAD, width: 56 },
  row: { left: PAD + 64, width: 16 },
} as const;

/** 描くもの。character は app が formatCharacter で作った文字列。order の label は番号と名前、row は前衛 / 後衛 */
export type CampPanelView =
  | { kind: "text"; title: string; lines?: string[] }
  /** UI-59（M10）: キャラクター画面（tallRect に広げる） */
  | { kind: "character"; detail: CharacterDetail; focusSlot: number | null }
  | { kind: "order"; lines: { label: string; row: string; picked: boolean }[] }
  /** UI-59 の品の詳細・IT-66 の図鑑（M7）。見出しは accent、行は tone の色（danger / dim）。tall ならパネルを tallRect に広げる（図鑑・キャラクター画面の下の品の詳細。UI-11） */
  | { kind: "lines"; title: string; lines: PanelLine[]; tall?: boolean };

export type CampView = {
  el: HTMLElement;
  render(p: CampPanelView): void;
};

/**
 * rect はステージ座標のパネルの範囲（layout.camp = ビュー領域）。メッセージ窓とパーティ欄は覆わない。
 * tallRect は広げたパネル（キャラクター画面（UI-59。M10）・その下の品の詳細と、IT-66 の図鑑）の範囲（layout.character = ビューの上端から操作領域の上端まで）。
 * 幅は rect と同じ前提（行の幅は rect.w で決める）
 */
export function createCampView(rect: Rect, tallRect: Rect = rect): CampView {
  const el = document.createElement("div");
  el.className = "camp-view";
  Object.assign(el.style, {
    position: "absolute",
    background: "var(--c-bg)",
    color: "var(--c-text)",
    overflow: "hidden",
  });
  const place = (r: Rect): void => {
    Object.assign(el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
  };
  place(rect);
  const detail = createDetailView({ x: 0, y: 0, w: tallRect.w, h: tallRect.h });

  const line = (row: number, text: string, cls: string, color?: string, col: { left: number; width: number } = { left: PAD, width: rect.w - 2 * PAD }): HTMLElement => {
    const t = document.createElement("div");
    t.className = cls;
    Object.assign(t.style, {
      position: "absolute",
      left: `${col.left}px`,
      top: `${PAD + LINE_H * row}px`,
      width: `${col.width}px`,
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
      place(p.kind === "character" || (p.kind === "lines" && p.tall === true) ? tallRect : rect);
      if (p.kind === "character") {
        detail.render(p.detail, p.focusSlot);
        el.replaceChildren(detail.el);
        return;
      }
      if (p.kind === "order") {
        el.replaceChildren(
          ...p.lines.flatMap((l, i) => {
            const color = l.picked ? "var(--c-accent)" : undefined;
            return [line(i, l.label, "camp-order-name", color, ORDER_COLUMNS.name), line(i, l.row, "camp-order-col", color, ORDER_COLUMNS.row)];
          }),
        );
        return;
      }
      if (p.kind === "lines") {
        const color = (tone: PanelLine["tone"]): string | undefined =>
          tone === "danger" ? "var(--c-danger)" : tone === "dim" ? "var(--c-dim)" : tone === "accent" ? "var(--c-accent)" : undefined;
        el.replaceChildren(line(0, p.title, "camp-title", "var(--c-accent)"), ...p.lines.map((x, i) => line(i + 1, x.text, "camp-line", color(x.tone))));
        return;
      }
      el.replaceChildren(line(0, p.title, "camp-title", "var(--c-accent)"), ...(p.lines ?? []).map((x, i) => line(i + 1, x, "camp-summary")));
    },
  };
}
