// UI-53 迷宮のキャンプ、UI-59 キャラクター画面（M10）、TW-03 / UI-52 酒場の状態・並び順・図鑑。
// ページ（CampPage）を段にした純粋な状態機械と、パネルの DOM。
// - 候補・押せるか・対象の要否は core の campMenu と fieldItemMenu の値だけで決める（UI-35）。送る Command は
//   dungeon.cast / dungeon.useItem / party.equip / party.unequip / party.give / party.drop / party.reorder / party.identify。
// - 迷宮のキャンプの top は [状態][並び順][糸で帰る][敵を待つ] / [呪文][空き][空き][戻る] の 4×2 の枠（layout.campGrid。M10 で 道具・装備・呪文・鑑定 を
//   キャラクター画面へ移した。糸で帰るは M16 で、core の campSummary.returnItem があるときだけ。無ければ空き枠。敵を待つ（旧 辺りを探る）は M18 で、
//   押すとキャンプを閉じて dungeon.search を送る（CampStep の closeSend））。状態 → メンバー一覧（名前の 6 枠と [7] 戻る）→ 人 → キャラクター画面。
// - M18（設計 5-1）: top の 5 つ目の「呪文」は 術者（spellWho。唱えられる呪文の無い者は dim）→ 呪文の段（from "top"。キャラクター画面の呪文の段と同じ）
//   → 説明 → 対象 → dungeon.cast → top。from "top" の呪文の一覧のやめるは術者の段へ（説明・対象のやめるは今どおり 1 つ上の段）。
// - キャラクター画面（UI-59。M10）は 1 人の全部（能力値・装備・所持品・習得呪文）を 1 画面に出し、操作は 4×2 の枠
//   [装備][使う][渡す][捨てる] / [呪文][鑑定（鑑定できる職業の者だけ）][次の人][戻る]（M20 の UI-80 から [呪文][次の人] / …[戻る] だけで、
//   装備・使う・渡す・捨てる・鑑定はパネルの品（装備の行・所持品の枠）を押した品の段（kind "item"。core の itemActions）から。
//   品の段から入った使う・渡す・捨てるの段は from "item"（やめるで品の段、送った後はキャラクター画面）。旧い枠からの段は残してある）。その下の段（装備・使う・渡す・捨てる・呪文・鑑定）の
//   やめるは同じ人のキャラクター画面へ。前後の人は ← → キー・左右スワイプ・ヘッダーの ◀ ▶ でも移る（M16。campCanCycle / campSwipeDir）。キャラクター画面の戻るは、キャンプはメンバー一覧、酒場は閉じる（酒場の一覧・帯を押した街のページへ）。
// - 送った後も閉じずに、同じ者の段へ戻る（CampStep の after）。sync で campMenu を取り直し、campRepair で成り立たない段を直す。
// - 帰還の糸（FieldItemView.isReturn）は送る前に確認の段（confirmReturn。戻る / やめる）を挟む。捨てるも確認の段（drop の confirm）を挟む。
//   確認の段は表示層だけの値で、core の状態は確認まで変えない（保存しない）。
// - 所持品は 8 件、呪文は 14 件ずつの頁（渡す・捨てる・呪文の段の一覧の [次の頁][前の頁]。パネルも同じ頁を出す）。
// - UI-68（M10）: 呪文は 一覧 → 説明（[唱える][やめる]。パネルの呪文の枠を説明に置き換える）→ 対象。一覧の dim の呪文も説明を見られる（peek）。
// - UI-67（M10）: 装備の品の詳細の段のパネルには差分の引数（preview）を付け、app が core の equipPreview の差分を詳細の下に出す。
// - UI-79（M18。設計 5-5）: 酒場の「敵の図鑑」（bestiary）。パネルに正体の分かった敵の名前の一覧と、選んでいる 1 体の絵（戦闘と同じ chooseSprite）・
//   名前・倒した数。操作は [次の敵][前の敵]（2 体以上のとき）とやめる。値は core の bestiaryView（CampInput.bestiary）だけ。
// - TW-16c / UI-52 / UI-59（M21 A-2）: 銀行の一覧の「状態」から host "bank" で開く（酒場の状態と同じキャラクター画面。閉じると銀行の一覧へ）。
//   host "bank" のキャラクター画面だけ 4 つ目の枠に「倉庫から」（キー 4）を置き、残置の装備の段（部位 → 品の一覧 → 品の詳細）を開く。品の一覧は
//   「外して倉庫へ」（core の canUnequipToWarehouse）→ 装備中 → 手元の候補 → 倉庫の候補「{name}（倉庫）」（core の warehouseCandidates）。
//   倉庫の品の装備は party.equip の from / to "warehouse"（旧品は倉庫へ）、外すは party.unequip の to "warehouse"。手元の候補は今どおり（旧品は手元へ）。
// DOM はパネル（createCampView）だけで、モジュールのトップレベルでは DOM に触れない。結線は app が行う。
import type { SpriteInfo } from "../../build/asset-types";
import type { EquipSlot, GameData, Strings } from "../../core/data/index";
import type { BestiaryView } from "../../core/rules/item-view";
import type { CampMember, CampMenu, CampSummary, CampTargetBlock, Command, FieldItemMenu, ItemActionKind, ItemActions } from "../../core/types";
import type { Action } from "../input/swipe";
import type { Rect } from "../layout";
import {
  CHARACTER_INVENTORY_CELLS,
  CHARACTER_SPELL_CELLS,
  characterHitAt,
  characterHitRects,
  createDetailView,
  inventoryFoldCount,
  SLOT_ORDER,
  type CharacterDetail,
  type CharacterTap,
} from "./detail";
import type { PanelLine } from "./item-detail";
import { formatMessage } from "./message";
import { PALETTE } from "../palette";
import { chooseSprite } from "../sprites";
import { enemyFill, spriteUrl } from "./battle";
import { BAND_ELLIPSIS_KEY, fitName, textUnits } from "./party-band";
import { LIST_ROW_UNITS } from "./town";

/** bank は TW-16c（M21 A-2）の銀行の「状態」（酒場の状態と同じ。キャラクター画面に「倉庫から」の枠が付く） */
export type CampHost = "camp" | "tavern" | "bank";
/** TW-03（M10）: 酒場の一覧から開く項目（状態は先頭の者のキャラクター画面） */
export type CampOpen = "status" | "order" | "book" | "bestiary";
export type CampPage =
  | { kind: "top" }
  /** UI-53（M10）: キャンプの「状態」のメンバー一覧（名前の 6 枠と [7] 戻る） */
  | { kind: "members" }
  /** UI-53 / MG-44（M18。設計 5-1）: top の「呪文」の術者（名前の 6 枠と [7] やめる。唱えられる呪文の無い者は dim） */
  | { kind: "spellWho" }
  /**
   * UI-59（M10）: キャラクター画面。fold は UI-80（M20）の畳んだ所持品の頁（省略は 0。「ほか {n}」を押すと次）。
   * focus は UI-33 / UI-80（M21）のキーの注目（characterHitRects の順の添字。省略は注目なし。表示だけの値）
   */
  | { kind: "character"; memberId: string; fold?: number; focus?: number }
  /** UI-80（M20）: キャラクター画面で押した品の詳細と、その品の操作（core の itemActions） */
  | { kind: "item"; memberId: string; instanceId: string }
  | { kind: "equip"; stage: "slot"; memberId: string }
  | { kind: "equip"; stage: "item"; memberId: string; slot: EquipSlot }
  /** UI-59（M7）: 品の詳細（装備中の品なら 外す、候補なら 装備する / やめる）。from "warehouse" は TW-16c（M21）の倉庫の候補 */
  | { kind: "equip"; stage: "detail"; memberId: string; slot: EquipSlot; instanceId: string; from?: "warehouse" }
  | { kind: "use"; stage: "item"; memberId: string }
  /** from "item" は UI-80（M20）の品の操作から来たとき（やめるで品の段へ、送った後はキャラクター画面へ） */
  | { kind: "use"; stage: "target"; memberId: string; instanceId: string; from?: "item" }
  /**
   * DG-30 / UI-53（M5.5）: 帰還の糸を使う前の確認。from "top" は迷宮のキャンプの top の「糸で帰る」（M16。campSummary.returnItem）から
   * 来たとき（キャラクター画面を開かず、やめるで top へ戻る）。from "item" は UI-80（M20）の品の操作から
   */
  | { kind: "use"; stage: "confirmReturn"; memberId: string; instanceId: string; from?: "top" | "item" }
  /** CH-78（M10）: 渡す品（page は所持品の頁） → 相手。from "item" は UI-80（M20）の品の操作から */
  | { kind: "give"; stage: "item"; memberId: string; page: number }
  | { kind: "give"; stage: "to"; memberId: string; instanceId: string; from?: "item" }
  /** CH-79（M10）: 捨てる品（page は所持品の頁） → 確認。from "item" は UI-80（M20）の品の操作から */
  | { kind: "drop"; stage: "item"; memberId: string; page: number }
  | { kind: "drop"; stage: "confirm"; memberId: string; instanceId: string; from?: "item" }
  /**
   * MG-44（M10 で キャラクター画面の下へ）: 習得呪文の一覧（page は呪文の頁）→ 説明（UI-68。[唱える][やめる]）→ 対象。
   * from "top" は top の「呪文」の術者の段から来たとき（M18。設計 5-1。一覧のやめるで術者の段へ、送った後は top へ）
   */
  | { kind: "spell"; stage: "spell"; memberId: string; page: number; from?: "top" }
  | { kind: "spell"; stage: "info"; memberId: string; spellId: string; from?: "top" }
  | { kind: "spell"; stage: "target"; memberId: string; spellId: string; from?: "top" }
  /** CH-77（M10 で キャラクター画面の下へ）: memberId は鑑定する者。品はパーティ全員の未鑑定品 */
  | { kind: "identify"; memberId: string }
  | { kind: "order"; picked: string | null }
  /** IT-66（M7）: 図鑑（酒場の一覧から開く。操作はやめるだけ） */
  | { kind: "book" }
  /** UI-79（M18。設計 5-5）: 敵の図鑑（酒場の一覧から開く）。focus は絵を出す敵の bestiary.rows の添字（[次の敵][前の敵] で動かす） */
  | { kind: "bestiary"; focus: number };
/** キャラクター画面の操作（UI-59。M10） */
export type CharacterAction = "equip" | "use" | "give" | "drop" | "spell" | "identify";
export type CampChoice =
  | { kind: "open"; page: CampPage }
  | { kind: "member"; memberId: string }
  /** UI-59（M10）: キャラクター画面の操作の枠（M20 の UI-80 からキャラクター画面の枠は 呪文 だけ。ほかは品の段から） */
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
  /** UI-59（M7）: 装備の段の品の行。押すと品の詳細の段へ。from "warehouse" は TW-16c（M21）の倉庫の候補の行 */
  | { kind: "detail"; instanceId: string; from?: "warehouse" }
  | { kind: "identifyItem"; instanceId: string }
  /** UI-80（M20）: キャラクター画面のパネルで品を押した（品の段へ） */
  | { kind: "openItem"; instanceId: string }
  /** UI-80（M20）: 品の段の操作の枠 */
  | { kind: "itemAction"; action: ItemActionKind }
  /** DG-45 / UI-53（M18）: top の「敵を待つ」（旧 辺りを探る。閉じて dungeon.search を送る。確認なし） */
  | { kind: "search" }
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
export type CampStep =
  | { kind: "page"; page: CampPage }
  | { kind: "close" }
  | { kind: "send"; command: Command; after: CampPage }
  /** DG-45 / UI-53（M18）: キャンプを閉じてから送る（top の「敵を待つ」） */
  | { kind: "closeSend"; command: Command };
/**
 * ビューに出すもの。text は場所の見出し（キャンプ / 酒場。迷宮のキャンプの top だけ、見出しの下に campSummary の行を lines で出す）、
 * character は UI-59 のキャラクター画面（focusSlot はその枠を accent 色、spellPage / inventoryPage は頁の段の頁。省略は先頭から「ほか n」）、
 * order は並び順の表
 */
export type CampPanel =
  | { kind: "text"; title: string; lines?: string[] }
  /**
   * spellInfo は UI-68（M10）の呪文の説明の段・対象の段の呪文（呪文の枠を説明に置き換える。app が core の spellInfo から作る）。
   * tappable は UI-80（M20）のキャラクター画面そのもの（品を押せる。注記を出し、所持品は inventoryFold の頁で畳む）
   */
  | {
      kind: "character";
      memberId: string;
      focusSlot: EquipSlot | null;
      spellPage?: number;
      inventoryPage?: number;
      spellInfo?: string;
      tappable?: true;
      inventoryFold?: number;
      /** UI-33 / UI-80（M21）: キーの注目（tappable のときだけ。characterHitRects の順の添字） */
      itemFocus?: number;
    }
  | { kind: "order"; rows: { n: number; name: string; row: string; picked: boolean }[] }
  /**
   * UI-59（M7）: 品の詳細（app が core の itemDetail から formatItemDetail で行を作る）。
   * preview は UI-67（M10）の装備の差分の引数（app が core の equipPreview に渡す。instanceId null はその枠の装備中の品を外すとき）
   */
  | { kind: "item"; instanceId: string; preview?: { memberId: string; slot: EquipSlot; instanceId: string | null; from?: "warehouse" } }
  /** IT-66（M7）: 図鑑（app が core の uniqueBookView から formatBook で行を作る） */
  | { kind: "book" }
  /** UI-79（M18）: 敵の図鑑（app が CampInput.bestiary から formatBestiary で作る） */
  | { kind: "bestiary"; focus: number };
/**
 * summary は core の campSummary（迷宮のキャンプだけ非 null。UI-53）。
 * identifyMpCost は CH-77（M10）の鑑定 1 回の MP（config.identify.mpCost。鑑定の段の見出しに出すだけ）
 */
export type CampInput = {
  menu: CampMenu;
  items: FieldItemMenu | null;
  summary: CampSummary | null;
  identifyMpCost: number;
  /** UI-79（M18）: core の bestiaryView（敵の図鑑の段の行と頁送りの範囲） */
  bestiary: BestiaryView;
  /**
   * UI-80（M20）: core の itemActions（品の段の操作と理由）を、パーティ全員の装備と所持品の instanceId ごとに引いた値（campItemActions で作る。
   * 品は 1 人だけが持つので instanceId で引ける）。省略すると品の段は戻るだけ
   */
  itemActions?: Readonly<Record<string, ItemActions>>;
};

/**
 * UI-80（M20）: CampInput.itemActions を作る（純粋。menu の各人の装備（slots）と所持品（inventory）の instanceId ごとに of を呼ぶ。null は入れない）。
 * of は app が core の itemActions を渡す
 */
export function campItemActions(menu: CampMenu, of: (memberId: string, instanceId: string) => ItemActions | null): Record<string, ItemActions> {
  const out: Record<string, ItemActions> = {};
  for (const x of menu.members) {
    const ids = [...x.slots.flatMap((sl) => (sl.instanceId === null ? [] : [sl.instanceId])), ...x.inventory.map((y) => y.instanceId)];
    for (const id of ids) {
      const a = of(x.id, id);
      if (a !== null) out[id] = a;
    }
  }
  return out;
}

/** campGrid の枠の数（4 列 × 2 段）。[7] がやめる / 戻る */
export const CAMP_GRID_SLOTS = 8;
/** UI-80（M20）: 品の段の操作の枠の位置（装備する と 外す は同じ枠。当てはまらない操作の枠は空き） */
export const ITEM_ACTION_SLOT: Record<ItemActionKind, number> = { equip: 0, unequip: 0, use: 1, give: 2, drop: 3, identify: 4 };

function s(strings: Strings, key: string, params?: Record<string, string | number>): string {
  return formatMessage(strings[key] ?? key, params);
}

/**
 * UI-59（M10）: キャラクター画面とその下の段か（パネルを 240×284 に広げ、パーティ欄とメッセージ窓を隠し、語りを会話の箱に出す間）。
 * top・メンバー一覧・並び順・図鑑は偽
 */
export function campCharacterOpen(page: CampPage): boolean {
  if (page.kind === "use" && page.stage === "confirmReturn" && page.from === "top") return false; // M16: top の「糸で帰る」の確認
  return (
    page.kind !== "top" && page.kind !== "members" && page.kind !== "spellWho" && page.kind !== "order" && page.kind !== "book" && page.kind !== "bestiary"
  );
}

/**
 * UI-59 / UI-33（M16。設計 4-9）: キャラクター画面で前後の人へ移れるか（ヘッダーの ◀ ▶ を出すか・左右スワイプを受けるか）。
 * キャラクター画面そのもの（下の段ではない）で、パーティが 2 人以上のとき（「次の人」の枠の dim と同じ条件）
 */
export function campCanCycle(page: CampPage, m: CampInput): boolean {
  return page.kind === "character" && m.menu.members.length > 1;
}

/**
 * UI-30 / UI-59（M16）: キャラクター画面の左右スワイプの向き。指を左へ動かすと次の人（+1）、右へ動かすと前の人（−1）
 * （頁をめくる向き。← / → キーと ◀ ▶ は前 / 次）。左右以外は null
 */
export function campSwipeDir(a: Action): 1 | -1 | null {
  return a === "left" ? 1 : a === "right" ? -1 : null;
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
    case "bestiary":
      return { kind: "bestiary", focus: 0 };
  }
}

/** やめる / 戻るの行き先（キャラクター画面の下の段は同じ人のキャラクター画面、その上は host ごと） */
function cancelStep(host: CampHost, page: CampPage, m: CampInput): CampStep {
  const go = (p: CampPage): CampStep => ({ kind: "page", page: p });
  switch (page.kind) {
    case "top":
      return { kind: "close" };
    case "members":
    case "spellWho":
      return host === "camp" ? go({ kind: "top" }) : { kind: "close" };
    case "character":
      return host === "camp" ? go({ kind: "members" }) : { kind: "close" };
    case "item":
      return go({ kind: "character", memberId: page.memberId });
    case "order":
    case "book":
    case "bestiary":
      return host === "camp" ? go({ kind: "top" }) : { kind: "close" };
    case "equip":
      if (page.stage === "slot") return go({ kind: "character", memberId: page.memberId });
      if (page.stage === "item") return go({ kind: "equip", stage: "slot", memberId: page.memberId });
      return go({ kind: "equip", stage: "item", memberId: page.memberId, slot: page.slot });
    case "use":
      if (page.stage === "item") return go({ kind: "character", memberId: page.memberId });
      if (page.stage === "confirmReturn" && page.from === "top") return go({ kind: "top" });
      if (page.from === "item") return go({ kind: "item", memberId: page.memberId, instanceId: page.instanceId }); // UI-80（M20）
      return go({ kind: "use", stage: "item", memberId: page.memberId });
    case "give":
      if (page.stage === "item") return go({ kind: "character", memberId: page.memberId });
      if (page.from === "item") return go({ kind: "item", memberId: page.memberId, instanceId: page.instanceId }); // UI-80（M20）
      return go({ kind: "give", stage: "item", memberId: page.memberId, page: inventoryPageOf(m, page.memberId, page.instanceId) });
    case "drop":
      if (page.stage === "item") return go({ kind: "character", memberId: page.memberId });
      if (page.from === "item") return go({ kind: "item", memberId: page.memberId, instanceId: page.instanceId }); // UI-80（M20）
      return go({ kind: "drop", stage: "item", memberId: page.memberId, page: inventoryPageOf(m, page.memberId, page.instanceId) });
    case "spell":
      // M18（設計 5-1）: top の「呪文」から来た一覧のやめるは術者の段へ
      if (page.stage === "spell") return go(page.from === "top" ? { kind: "spellWho" } : { kind: "character", memberId: page.memberId });
      if (page.stage === "info") return go(spellListPage(m, page.memberId, page.spellId, page.from));
      return go({ kind: "spell", stage: "info", memberId: page.memberId, spellId: page.spellId, ...fromTop(page.from) });
    case "identify":
      return go({ kind: "character", memberId: page.memberId });
  }
}

const memberOf = (m: CampInput, id: string): CampMember | undefined => m.menu.members.find((x) => x.id === id);
const nameOf = (m: CampInput, id: string): string => memberOf(m, id)?.name ?? "";

/** UI-80（M20）: その人の品の操作（CampInput.itemActions。持ち主が違えば null） */
function actionsOf(m: CampInput, memberId: string, instanceId: string): ItemActions | null {
  const a = m.itemActions?.[instanceId];
  return a !== undefined && a.memberId === memberId ? a : null;
}
/** UI-80（M20）: その人の装備か所持品にある品か */
function ownsItem(m: CampInput, memberId: string, instanceId: string): boolean {
  const x = memberOf(m, memberId);
  return x !== undefined && (x.inventory.some((y) => y.instanceId === instanceId) || x.slots.some((y) => y.instanceId === instanceId));
}
/** UI-80（M20）: その人の装備か所持品の品の表示名（無ければ空） */
function ownItemName(m: CampInput, memberId: string, instanceId: string): string {
  const x = memberOf(m, memberId);
  return x?.inventory.find((y) => y.instanceId === instanceId)?.name ?? x?.slots.find((y) => y.instanceId === instanceId)?.name ?? "";
}

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
/** 呪文の段の from（M18。top の「呪文」から来たときだけ付ける） */
function fromTop(from: "top" | undefined): { from?: "top" } {
  return from === "top" ? { from } : {};
}
/** 呪文の一覧の段（spellId が載る頁。from は top の「呪文」から来たとき） */
function spellListPage(m: CampInput, memberId: string, spellId: string, from?: "top"): CampPage {
  return { kind: "spell", stage: "spell", memberId, page: spellPageOf(m, memberId, spellId), ...fromTop(from) };
}
/** UI-53 / MG-44（M18。設計 5-1）: 戦闘外でいま唱えられる呪文（core の knownSpells の castable）を 1 つ以上持つか */
function hasCastable(m: CampInput, memberId: string): boolean {
  return memberOf(m, memberId)?.knownSpells.some((x) => x.castable) ?? false;
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

/** TW-16c（M21）: 倉庫の候補の行「{name}（倉庫）」（送れなければ「…（{why}）」）。一覧の行の幅（LIST_ROW_UNITS）を超えるときは名前の末尾を「…」で切る */
export function warehouseRowLabel(name: string, why: string | null, strings: Strings): string {
  const label = (n: string): string => {
    const row = s(strings, "camp.equip.warehouse", { name: n });
    return why === null ? row : s(strings, "camp.equip.blocked", { name: row, why });
  };
  const room = LIST_ROW_UNITS - textUnits(label(""));
  return label(fitName(name, Math.max(0, room), s(strings, BAND_ELLIPSIS_KEY)));
}

/** その段の項目。grid は 8 枠、list は末尾がやめる */
export function campEntries(host: CampHost, page: CampPage, m: CampInput, strings: Strings): CampEntries {
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
      // DG-30 / UI-53（M16。設計 4-8）: いま使える帰還の品があれば 3 つ目の枠に「糸で帰る」（どれを使うかは core の campSummary.returnItem）
      const ret = m.summary?.returnItem ?? null;
      const useReturn =
        ret === null ? null : open("camp.useReturn", { kind: "use", stage: "confirmReturn", memberId: ret.memberId, instanceId: ret.instanceId, from: "top" });
      // DG-45 / UI-53（M18。設計 1-3）: 迷宮のキャンプ（campSummary が非 null）では 4 つ目の枠に「敵を待つ」（糸の有無で位置は動かない）
      const search: CampEntry | null = m.summary === null ? null : { label: s(strings, "camp.search"), disabled: false, choice: { kind: "search" } };
      return {
        layout: "grid",
        // UI-53 / MG-44（M18。設計 5-1）: 5 つ目の枠に「呪文」（術者の段へ）
        slots: [open("camp.status", { kind: "members" }), open("camp.order", { kind: "order", picked: null }), useReturn, search, open("camp.spell", { kind: "spellWho" }), null, null, back],
      };
    }
    case "members":
      return memberGrid(m, () => false, back);
    case "spellWho":
      // M18（設計 5-1）: いま唱えられる呪文（castable）の無い者は dim
      return memberGrid(m, (id) => !hasCastable(m, id), cancel);
    case "character": {
      const x = memberOf(m, page.memberId);
      // UI-80（M20）: 装備・使う・渡す・捨てる・鑑定はパネルの品を押して品の段から。枠は [呪文][次の人][鑑定] / [空き]…[戻る]（キー 1・2・3・8）
      // UI-59 / UI-80（M21 A-1）: 鑑定できる職業の者（core の identifyBlock が cannotIdentify でない）だけ 3 つ目の枠に「鑑定」（鑑定の一覧の段へ。キー 3）。
      // 送れない間（cannotAct / noMp / noUnidentified）は dim で、押すと core の identifyBlock の理由を語る
      const block = x?.identifyBlock ?? null;
      const identify: CampEntry | null =
        x === undefined || block === "cannotIdentify"
          ? null
          : {
              label: s(strings, "character.identify"),
              disabled: !x.canIdentifyNow,
              choice: { kind: "action", action: "identify" },
              ...(block === null || x.canIdentifyNow ? {} : { reason: s(strings, `camp.identifyBlock.${block}`, { name: x.name }) }),
            };
      // TW-16c / UI-59（M21 A-2）: 銀行の状態（host bank）だけ 4 つ目の枠に「倉庫から」（装備の段へ。キー 4）
      const fromWarehouse: CampEntry | null =
        host === "bank" ? { label: s(strings, "character.fromWarehouse"), disabled: false, choice: { kind: "action", action: "equip" } } : null;
      return {
        layout: "grid",
        slots: [
          // UI-68（M10）: 習得呪文があれば押せる（唱えられない呪文も一覧から説明を見られる。唱えられるかは説明の段の「唱える」）
          { label: s(strings, "character.spell"), disabled: (x?.knownSpells.length ?? 0) === 0, choice: { kind: "action", action: "spell" } },
          { label: s(strings, "character.next"), disabled: menu.members.length <= 1, choice: { kind: "nextMember" } },
          identify,
          fromWarehouse,
          null,
          null,
          null,
          back,
        ],
      };
    }
    case "item": {
      // UI-80（M20）: core の itemActions の操作を決まった枠に置く（装備する／外す 1・使う 2・渡す 3・捨てる 4・鑑定 5・戻る 8）。
      // 当てはまらない操作は空き枠、送れない操作は dim で、押すと理由（camp.itemReason.{block}）を語る
      const a = actionsOf(m, page.memberId, page.instanceId);
      const slots: (CampEntry | null)[] = Array.from({ length: CAMP_GRID_SLOTS }, () => null);
      slots[CAMP_GRID_SLOTS - 1] = back;
      if (a === null) return { layout: "grid", slots };
      const owner = nameOf(m, page.memberId);
      for (const v of a.actions) {
        const label =
          v.action === "equip"
            ? s(strings, "camp.equip.do")
            : v.action === "unequip"
              ? s(strings, "camp.equip.unequip")
              : v.action === "identify"
                ? s(strings, "camp.item.identify", { rate: a.identifier?.rate ?? "?" })
                : s(strings, `character.${v.action}`);
        const who = v.action === "identify" ? (a.identifier?.name ?? owner) : owner;
        slots[ITEM_ACTION_SLOT[v.action]] = {
          label,
          disabled: v.block !== null,
          choice: { kind: "itemAction", action: v.action },
          ...(v.block === null ? {} : { reason: s(strings, `camp.itemReason.${v.block}`, { name: who, item: a.name }) }),
        };
      }
      return { layout: "grid", slots };
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
      // TW-16c（M21）: 銀行の状態では倉庫の候補を足し、外すは倉庫へ（可否は core の canUnequipToWarehouse）
      const bank = host === "bank";
      const stored = bank ? (x?.warehouseCandidates ?? []).filter((c) => c.slot === page.slot) : [];
      const unequipRow = (c: NonNullable<typeof cur>): CampEntry =>
        bank
          ? { label: s(strings, "camp.equip.unequipToWarehouse"), disabled: !c.canUnequipToWarehouse, choice: { kind: "unequip" } }
          : { label: s(strings, "camp.equip.unequip"), disabled: !c.canUnequip, choice: { kind: "unequip" } };
      if (page.stage === "detail") {
        // UI-59（M7）: 装備中の品なら 外す（外せなければ dim）、候補なら 装備する（装備できなければ理由を付けて dim）→ やめる
        if (cur !== undefined && cur.instanceId === page.instanceId) {
          return list([unequipRow(cur)]);
        }
        const c = (page.from === "warehouse" ? stored : cands).find((y) => y.instanceId === page.instanceId);
        if (c === undefined) return list([]);
        const label = s(strings, "camp.equip.do");
        // UI-59（M10）: dim の「装備する（{why}）」は押すと理由を語る（core の block ごとの文。転職の dim の行と同じ作法）
        return list([
          {
            label: c.block === null ? label : s(strings, "camp.equip.blocked", { name: label, why: s(strings, `camp.equipBlock.${c.block}`) }),
            disabled: c.block !== null,
            choice: { kind: "equip", instanceId: c.instanceId },
            ...(c.block === null ? {} : { reason: s(strings, `camp.equipReason.${c.block}`, { name: x?.name ?? "", item: c.name }) }),
          },
        ]);
      }
      // 外す → 装備中の品（M7: 押すと詳細）→ 候補（M7: 押すと詳細。装備できない品も詳細は見られるので dim にしない）
      const rows: CampEntry[] = [];
      if (cur !== undefined && cur.instanceId !== null) {
        rows.push(unequipRow(cur));
        rows.push({ label: s(strings, "camp.equip.current", { name: cur.name ?? "" }), disabled: false, choice: { kind: "detail", instanceId: cur.instanceId } });
      }
      for (const c of cands) {
        rows.push({
          label: c.block === null ? c.name : s(strings, "camp.equip.blocked", { name: c.name, why: s(strings, `camp.equipBlock.${c.block}`) }),
          disabled: false,
          choice: { kind: "detail", instanceId: c.instanceId },
        });
      }
      for (const c of stored) {
        rows.push({
          label: warehouseRowLabel(c.name, c.block === null ? null : s(strings, `camp.equipBlock.${c.block}`), strings),
          disabled: false,
          choice: { kind: "detail", instanceId: c.instanceId, from: "warehouse" },
        });
      }
      if (cands.length === 0 && stored.length === 0) rows.push({ label: s(strings, "camp.equip.none"), disabled: true, choice: { kind: "none" } });
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
    case "bestiary": {
      // UI-79（M18）: 2 体以上なら [次の敵][前の敵]（最後・最初の敵で dim）とやめる。1 体以下はやめるだけ
      const n = m.bestiary.rows.length;
      if (n <= 1) return list([]);
      return list([
        { label: s(strings, "bestiary.next"), disabled: page.focus >= n - 1, choice: { kind: "pageTurn", delta: 1 } },
        { label: s(strings, "bestiary.prev"), disabled: page.focus <= 0, choice: { kind: "pageTurn", delta: -1 } },
      ]);
    }
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
      if (choice.kind === "search") return { kind: "closeSend", command: { type: "dungeon.search" } };
      return choice.kind === "open" ? go(choice.page) : stay;
    case "members":
      return choice.kind === "member" ? go({ kind: "character", memberId: choice.memberId }) : stay;
    case "spellWho":
      // M18（設計 5-1）: 唱えられる呪文のある者だけ、その人の呪文の段（from top）へ
      if (choice.kind !== "member" || !hasCastable(m, choice.memberId)) return stay;
      return go({ kind: "spell", stage: "spell", memberId: choice.memberId, page: 0, from: "top" });
    case "character": {
      if (choice.kind === "nextMember") return go(campCycle(page, m, 1) ?? page);
      // UI-80（M20）: パネルの品（その人の装備か所持品）を押すと品の段、「ほか {n}」を押すと畳んだ所持品の次の頁（最後の次は最初）
      if (choice.kind === "openItem") {
        return ownsItem(m, page.memberId, choice.instanceId) ? go({ kind: "item", memberId: page.memberId, instanceId: choice.instanceId }) : stay;
      }
      if (choice.kind === "pageTurn") {
        const n = inventoryFoldCount(memberOf(m, page.memberId)?.inventory.length ?? 0);
        if (n <= 1) return stay;
        const f = ((((page.fold ?? 0) + choice.delta) % n) + n) % n;
        // UI-33（M21）: キーの注目は頁をめくっても同じ添字のまま（数が減れば次のキーで詰める）
        return go({ kind: "character", memberId: page.memberId, ...(f === 0 ? {} : { fold: f }), ...(page.focus === undefined ? {} : { focus: page.focus }) });
      }
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
    case "item": {
      // UI-80（M20）: 品の操作。送れない操作（core の block）と当てはまらない操作は同じ段のまま
      if (choice.kind !== "itemAction") return stay;
      const a = actionsOf(m, page.memberId, page.instanceId);
      const v = a?.actions.find((y) => y.action === choice.action);
      if (a === null || v === undefined || v.block !== null) return stay;
      const id = page.instanceId;
      const character: CampPage = { kind: "character", memberId: page.memberId };
      switch (v.action) {
        case "equip":
          return { kind: "send", command: { type: "party.equip", memberId: page.memberId, instanceId: id }, after: page };
        case "unequip":
          return a.equippedSlot === null ? stay : { kind: "send", command: { type: "party.unequip", memberId: page.memberId, slot: a.equippedSlot }, after: page };
        case "use": {
          // 既存の使うの段へ（対象の要る品は対象の段、帰還の糸は確認の段。どちらも from "item"）。それ以外は送ってキャラクター画面へ（品は消える）
          const it = m.items?.members.find((x) => x.id === page.memberId)?.items.find((x) => x.instanceId === id);
          if (it === undefined || !it.usable) return stay;
          if (it.target === "ally") return go({ kind: "use", stage: "target", memberId: page.memberId, instanceId: id, from: "item" });
          if (it.isReturn) return go({ kind: "use", stage: "confirmReturn", memberId: page.memberId, instanceId: id, from: "item" });
          return { kind: "send", command: { type: "dungeon.useItem", memberId: page.memberId, itemId: id }, after: character };
        }
        case "give":
          return go({ kind: "give", stage: "to", memberId: page.memberId, instanceId: id, from: "item" });
        case "drop":
          return go({ kind: "drop", stage: "confirm", memberId: page.memberId, instanceId: id, from: "item" });
        case "identify":
          return a.identifier === null ? stay : { kind: "send", command: { type: "party.identify", memberId: a.identifier.id, instanceId: id }, after: page };
      }
      return stay;
    }
    case "equip": {
      if (page.stage === "slot") {
        return choice.kind === "slot" ? go({ kind: "equip", stage: "item", memberId: page.memberId, slot: choice.slot }) : stay;
      }
      const slotStage: CampPage = { kind: "equip", stage: "slot", memberId: page.memberId };
      // TW-16c（M21）: 銀行の状態の外すは倉庫へ、倉庫の候補の装備は倉庫から（旧品は倉庫へ）
      const toWarehouse = host === "bank" ? { to: "warehouse" as const } : {};
      if (choice.kind === "unequip") {
        return { kind: "send", command: { type: "party.unequip", memberId: page.memberId, slot: page.slot, ...toWarehouse }, after: slotStage };
      }
      if (choice.kind === "equip") {
        const wh = host === "bank" && page.stage === "detail" && page.from === "warehouse" ? { from: "warehouse" as const, to: "warehouse" as const } : {};
        return { kind: "send", command: { type: "party.equip", memberId: page.memberId, instanceId: choice.instanceId, ...wh }, after: slotStage };
      }
      if (choice.kind === "detail" && page.stage === "item") {
        const from = host === "bank" && choice.from === "warehouse" ? { from: "warehouse" as const } : {};
        return go({ kind: "equip", stage: "detail", memberId: page.memberId, slot: page.slot, instanceId: choice.instanceId, ...from });
      }
      return stay;
    }
    case "use": {
      // UI-80（M20）: 品の段から来た段は、送った後はキャラクター画面（使った品は消える）
      const back: CampPage =
        page.stage !== "item" && page.from === "item" ? { kind: "character", memberId: page.memberId } : { kind: "use", stage: "item", memberId: page.memberId };
      if (page.stage === "confirmReturn") {
        if (choice.kind !== "confirm") return stay;
        return { kind: "send", command: { type: "dungeon.useItem", memberId: page.memberId, itemId: page.instanceId }, after: page.from === "top" ? { kind: "top" } : back };
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
      // UI-80（M20）: 品の段から来た段は、送った後はキャラクター画面（品は手元から消える）
      const after: CampPage =
        page.from === "item"
          ? { kind: "character", memberId: page.memberId }
          : { kind: page.kind, stage: "item", memberId: page.memberId, page: inventoryPageOf(m, page.memberId, page.instanceId) };
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
        return go({ kind: "spell", stage: "info", memberId: page.memberId, spellId: choice.spellId, ...fromTop(page.from) });
      }
      if (page.stage === "info") {
        if (choice.kind !== "confirm") return stay;
        // 戦闘外で唱えられる呪文（knownSpells の castable、対象は campMenu の spells）だけ先へ進む
        const sp = x?.spells.find((y) => y.spellId === page.spellId);
        if (sp === undefined || !(x?.knownSpells.find((y) => y.spellId === page.spellId)?.castable ?? false)) return stay;
        // M18（設計 5-1）: top の「呪文」から来たときは送った後に top へ戻る
        const after: CampPage = page.from === "top" ? { kind: "top" } : spellListPage(m, page.memberId, sp.spellId);
        if (sp.target === "none") return { kind: "send", command: { type: "dungeon.cast", memberId: page.memberId, spellId: sp.spellId }, after };
        return go({ kind: "spell", stage: "target", memberId: page.memberId, spellId: sp.spellId, ...fromTop(page.from) });
      }
      if (choice.kind !== "target") return stay;
      return {
        kind: "send",
        command: { type: "dungeon.cast", memberId: page.memberId, spellId: page.spellId, targetId: choice.targetId },
        after: page.from === "top" ? { kind: "top" } : spellListPage(m, page.memberId, page.spellId),
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
    case "bestiary": {
      if (choice.kind !== "pageTurn") return stay;
      const f = page.focus + choice.delta;
      return f < 0 || f >= m.bestiary.rows.length ? stay : go({ kind: "bestiary", focus: f });
    }
  }
}

/** その段の問い（ヘッダーに出す） */
export function campHeader(page: CampPage, m: CampInput, strings: Strings): string {
  switch (page.kind) {
    case "top":
      return s(strings, "camp.prompt.top");
    case "members":
      return s(strings, "camp.prompt.members");
    case "spellWho":
      return s(strings, "camp.prompt.spellWho");
    case "character":
      return s(strings, "camp.prompt.status", { name: nameOf(m, page.memberId) });
    case "item":
      return s(strings, "camp.prompt.item", { item: ownItemName(m, page.memberId, page.instanceId) });
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
    case "bestiary":
      return s(strings, "camp.prompt.bestiary");
  }
}

/** ビューに出すもの（キャラクター画面とその下の段は UI-59 の画面、品の詳細、並び順の表、図鑑、それ以外は場所の見出しだけ） */
export function campPanel(page: CampPage, m: CampInput, strings: Strings): CampPanel {
  if (page.kind === "equip" && page.stage === "detail") {
    // UI-67（M10）: 差分の引数。その枠の装備中の品なら外すとき（null）、候補なら装備するとき
    const cur = memberOf(m, page.memberId)?.slots.find((sl) => sl.slot === page.slot);
    const equipped = cur !== undefined && cur.instanceId === page.instanceId;
    // TW-16c（M21）: 倉庫の候補は from "warehouse" の差分
    const from = !equipped && page.from === "warehouse" ? { from: "warehouse" as const } : {};
    return { kind: "item", instanceId: page.instanceId, preview: { memberId: page.memberId, slot: page.slot, instanceId: equipped ? null : page.instanceId, ...from } };
  }
  if (page.kind === "item") {
    // UI-80（M20）/ UI-67: 品の詳細。装備中の品なら外すときの差分、所持品の装備品なら装備するときの差分（core の equipPreview が拒めば出ない）
    const x = memberOf(m, page.memberId);
    const cur = x?.slots.find((sl) => sl.instanceId === page.instanceId);
    if (cur !== undefined) return { kind: "item", instanceId: page.instanceId, preview: { memberId: page.memberId, slot: cur.slot, instanceId: null } };
    const cand = x?.equipCandidates.find((c) => c.instanceId === page.instanceId);
    if (cand !== undefined) return { kind: "item", instanceId: page.instanceId, preview: { memberId: page.memberId, slot: cand.slot, instanceId: page.instanceId } };
    return { kind: "item", instanceId: page.instanceId };
  }
  if (page.kind === "book") return { kind: "book" };
  if (page.kind === "bestiary") return { kind: "bestiary", focus: page.focus };
  const who = pageMember(page);
  if (who !== null) {
    const focusSlot = page.kind === "equip" && page.stage === "item" ? page.slot : null;
    const base = { kind: "character" as const, memberId: who, focusSlot };
    // UI-80（M20）: キャラクター画面そのものだけ品を押せる（注記と畳んだ所持品）
    if (page.kind === "character") {
      return { ...base, tappable: true as const, inventoryFold: page.fold ?? 0, ...(page.focus === undefined ? {} : { itemFocus: page.focus }) };
    }
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
      // DG-30 / UI-53（M16）: いま使える帰還の品があれば持ち主の名前を添える（core の returnItem。無ければ数だけ）
      sum.returnItem === null
        ? s(strings, "camp.summary.returnNoOwner", { count: sum.returnItems })
        : s(strings, "camp.summary.return", { count: sum.returnItems, owner: sum.returnItem.ownerName }),
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
    case "spellWho":
      return host === "camp" ? page : campFirstPage("tavern", "status", menu);
    case "order":
      return page.picked === null || member(page.picked) !== undefined ? page : { kind: "order", picked: null };
    case "book":
      return page;
    case "bestiary": {
      // UI-79: 行が減ることは無いが、範囲の外の focus は端へ寄せる
      const f = Math.max(0, Math.min(page.focus, m.bestiary.rows.length - 1));
      return f === page.focus ? page : { kind: "bestiary", focus: f };
    }
    default:
      break;
  }
  if (page.kind === "use" && page.stage === "confirmReturn" && page.from === "top") {
    // M16: top の「糸で帰る」の確認は、その品が使えなくなったら（消えた・持ち主が動けない）top へ
    const it = m.items?.members.find((y) => y.id === page.memberId);
    return it !== undefined && it.canAct && it.items.some((y) => y.instanceId === page.instanceId && y.usable) ? page : { kind: "top" };
  }
  const x = member(page.memberId);
  // M18（設計 5-1）: top の「呪文」から来た段で人がいなくなったら術者の段へ
  if (x === undefined) return page.kind === "spell" && page.from === "top" && host === "camp" ? { kind: "spellWho" } : lost();
  const character: CampPage = { kind: "character", memberId: page.memberId };
  switch (page.kind) {
    case "character": {
      // UI-80（M20）: 畳んだ所持品の頁が減ったら（渡した・捨てた後）最初の頁へ
      const f = page.fold ?? 0;
      return f === 0 || f < inventoryFoldCount(x.inventory.length) ? page : character;
    }
    case "item":
      // UI-80（M20）: 品がその人の装備にも所持品にも無くなったら（消えた・渡した）キャラクター画面へ
      return ownsItem(m, page.memberId, page.instanceId) ? page : character;
    case "equip": {
      // U6（M10）: 行動できない者・死亡・灰の者の段も成り立つ（外すは core の canUnequip、装備するは core の block で dim）
      if (page.stage !== "detail") return page;
      // UI-59（M7）: 詳細の品が、その枠の装備中の品でも候補でもなくなったら（付け外しの後など）同じ枠の品の段へ
      const id = page.instanceId;
      // TW-16c（M21）: 倉庫の候補の詳細は warehouseCandidates にある間だけ
      const pool = page.from === "warehouse" ? (x.warehouseCandidates ?? []) : x.equipCandidates;
      const here = x.slots.some((sl) => sl.slot === page.slot && sl.instanceId === id) || pool.some((c) => c.slot === page.slot && c.instanceId === id);
      return here ? page : { kind: "equip", stage: "item", memberId: page.memberId, slot: page.slot };
    }
    case "use": {
      const it = m.items?.members.find((y) => y.id === page.memberId);
      if (page.stage !== "item" && page.from === "item") {
        // UI-80（M20）: 品の段から来た段は、品が使えなくなったら品の段へ（品が消えていれば品の段の直しでキャラクター画面へ）
        const ok = it !== undefined && it.canAct && it.items.some((y) => y.instanceId === page.instanceId && y.usable);
        if (ok) return page;
        return ownsItem(m, page.memberId, page.instanceId) ? { kind: "item", memberId: page.memberId, instanceId: page.instanceId } : character;
      }
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
      // 相手・確認の段: 品が手元から消えたら同じ者の品の段へ（UI-80（M20）: 品の段から来た段はキャラクター画面へ）
      if (x.inventory.some((y) => y.instanceId === page.instanceId)) return page;
      return page.from === "item" ? character : { kind: page.kind, stage: "item", memberId: page.memberId, page: 0 };
    }
    case "spell": {
      if (page.stage === "spell") {
        const last = pageCount(x.knownSpells.length, CHARACTER_SPELL_CELLS) - 1;
        return page.page > last ? { ...page, page: last } : page;
      }
      // UI-68（M10）: 説明の段は、その呪文を覚えている間は成り立つ（唱えられなければ「唱える」が dim）
      if (page.stage === "info") return x.knownSpells.some((y) => y.spellId === page.spellId) ? page : spellListPage(m, page.memberId, page.spellId, page.from);
      // 対象の段で、その呪文が使えなくなった（MP 切れ・行動不能）→ 同じ者の呪文の一覧
      return x.spells.some((y) => y.spellId === page.spellId && y.usable) ? page : spellListPage(m, page.memberId, page.spellId, page.from);
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

/**
 * UI-33 / UI-80（M21）: キャラクター画面そのものの品のキー。taps は描いた画面の押せる所（characterHitRects の順。ビューの characterTaps）。
 * ↑（forward）↓（around）は注目を 1 つ動かし（注目なしからはどちらも先頭。端で止まる）、Enter（confirm）は注目している所を押したのと同じ
 * （品は openItem、「ほか」は pageTurn）。注目なしの Enter・押せる所が無い・キャラクター画面でないなどは null（campKeyIndex のまま）。純粋
 */
export function characterItemKey(
  a: Action,
  page: CampPage,
  taps: readonly CharacterTap[],
): { kind: "focus"; page: CampPage } | { kind: "choose"; choice: CampChoice } | null {
  if (page.kind !== "character" || taps.length === 0) return null;
  if (a === "forward" || a === "around") {
    const next = page.focus === undefined ? 0 : Math.max(0, Math.min(taps.length - 1, page.focus + (a === "forward" ? -1 : 1)));
    return { kind: "focus", page: { ...page, focus: next } };
  }
  if (a === "confirm" && page.focus !== undefined) {
    const t = taps[page.focus];
    if (t === undefined) return null;
    return { kind: "choose", choice: t.kind === "item" ? { kind: "openItem", instanceId: t.instanceId } : { kind: "pageTurn", delta: 1 } };
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
  /** UI-59（M10）: キャラクター画面（tallRect に広げる）。tappable は UI-80（M20）の品を押せる画面（characterTarget が行き先を返す） */
  | { kind: "character"; detail: CharacterDetail; focusSlot: number | null; tappable?: boolean; itemFocus?: number | null }
  | { kind: "order"; lines: { label: string; row: string; picked: boolean }[] }
  /** UI-59 の品の詳細・IT-66 の図鑑（M7）。見出しは accent、行は tone の色（danger / dim）。tall ならパネルを tallRect に広げる（図鑑・キャラクター画面の下の品の詳細。UI-11） */
  | { kind: "lines"; title: string; lines: PanelLine[]; tall?: boolean }
  /** UI-79（M18）: 敵の図鑑（formatBestiary。tallRect に広げる） */
  | BestiaryPanel;

/**
 * UI-79（M18。設計 5-5）: 敵の図鑑のパネル。title は見出し（accent）、rows は名前の一覧（focused は accent）、empty は 1 体もいないときの dim の 1 行、
 * pick は絵を出す敵（monsterId は chooseSprite に渡す。name と kills は絵の下の 2 行）
 */
export type BestiaryPanel = {
  kind: "bestiary";
  title: string;
  rows: { text: string; focused: boolean }[];
  empty: string | null;
  pick: { monsterId: string; name: string; kills: string } | null;
};

/**
 * UI-79（M18）: 敵の図鑑の配置（パネル内の座標）。左に名前の一覧の列（見出しの下から 10px の行）、右に絵の枠（96 角。48 の絵は 2 倍、96 の絵は等倍。
 * 戦闘と同じ chooseSprite で整数倍だけ。縮小しない）と、その下に名前と倒した数の 2 行
 */
export const BESTIARY_LAYOUT = {
  list: { left: 4, width: 128 },
  picture: { x: 136, y: 14, size: 96 },
  caption: { left: 136, width: 100, row: 11 },
} as const;

/** UI-79（M18）: core の bestiaryView から敵の図鑑のパネルを組む（文字列を組むだけ）。M19（D-7）: 一覧の行は「{name}（{unknown}）」（bestiary.row）。絵の下の名前は name だけ */
export function formatBestiary(v: BestiaryView, focus: number, strings: Strings): BestiaryPanel {
  const title = s(strings, "bestiary.title", { known: v.known, total: v.total });
  const f = Math.max(0, Math.min(focus, v.rows.length - 1));
  const r = v.rows[f];
  return {
    kind: "bestiary",
    title,
    rows: v.rows.map((x, i) => ({ text: s(strings, "bestiary.row", { name: x.name, unknown: x.unknownName }), focused: i === f })),
    empty: v.rows.length === 0 ? s(strings, "bestiary.none") : null,
    pick: r === undefined ? null : { monsterId: r.monsterId, name: r.name, kills: s(strings, "bestiary.kills", { kills: r.kills }) },
  };
}

/**
 * UI-79（M18）: 名前の一覧の見える範囲の先頭（表示のためだけの計算）。見える行数 visible に focus が入るように先頭をずらす
 */
export function bestiaryWindowStart(count: number, focus: number, visible: number): number {
  if (visible <= 0 || count <= visible) return 0;
  return Math.max(0, Math.min(focus - visible + 1, count - visible));
}

export type CampView = {
  el: HTMLElement;
  render(p: CampPanelView): void;
  /**
   * UI-80（M20）: パネルの左上からの論理 px (lx, ly) を押したときの行き先（最後に描いたのが品を押せるキャラクター画面のときだけ。
   * 矩形は detail の characterHitRects）。それ以外は null
   */
  characterTarget(lx: number, ly: number): CharacterTap | null;
  /** UI-33 / UI-80（M21）: 最後に描いた品を押せるキャラクター画面の押せる所（characterHitRects の順）。それ以外は空 */
  characterTaps(): CharacterTap[];
};

/**
 * rect はステージ座標のパネルの範囲（layout.camp = ビュー領域）。メッセージ窓とパーティ欄は覆わない。
 * tallRect は広げたパネル（キャラクター画面（UI-59。M10）・その下の品の詳細と、IT-66 の図鑑）の範囲（layout.character = ビューの上端から操作領域の上端まで）。
 * 幅は rect と同じ前提（行の幅は rect.w で決める）
 */
/** UI-79（M18）: 敵の図鑑の絵に使うもの（data は chooseSprite と塗りの色、sprites は GameAssets.sprites。無ければ絵を読まず塗るだけ） */
export type CampArt = { data: Pick<GameData, "monsters" | "unknownKinds">; sprites: Readonly<Record<string, SpriteInfo>> };

export function createCampView(rect: Rect, tallRect: Rect = rect, art?: CampArt): CampView {
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

  /** UI-79: 敵の図鑑の絵の枠（絵が無い・読めないときは戦闘と同じ塗りの矩形） */
  const pictureNode = (monsterId: string): HTMLElement => {
    const L = BESTIARY_LAYOUT.picture;
    const box = document.createElement("div");
    box.className = "camp-bestiary-picture";
    Object.assign(box.style, { position: "absolute", left: `${L.x}px`, top: `${L.y}px`, width: `${L.size}px`, height: `${L.size}px` });
    if (art === undefined) return box;
    const fill = PALETTE[enemyFill(art.data as GameData, monsterId, true)];
    const pick = chooseSprite(art.data, monsterId, true, art.sprites, L.size);
    if (pick === null) {
      box.style.background = fill;
      return box;
    }
    const img = document.createElement("img");
    img.className = "camp-bestiary-img";
    img.alt = "";
    img.draggable = false;
    const dw = pick.w * pick.scale;
    const dh = pick.h * pick.scale;
    Object.assign(img.style, {
      position: "absolute",
      left: `${Math.floor((L.size - dw) / 2)}px`,
      top: `${Math.floor((L.size - dh) / 2)}px`,
      width: `${dw}px`,
      height: `${dh}px`,
      imageRendering: "pixelated",
      pointerEvents: "none",
    });
    img.addEventListener("error", () => {
      img.style.display = "none";
      box.style.background = fill;
    });
    img.src = spriteUrl(pick.name, import.meta.env.BASE_URL);
    box.appendChild(img);
    return box;
  };

  /** UI-79: 見出し・名前の一覧（focus が見える範囲）・絵・絵の下の 2 行 */
  const bestiaryNodes = (p: BestiaryPanel): HTMLElement[] => {
    const L = BESTIARY_LAYOUT;
    const nodes = [line(0, p.title, "camp-title", "var(--c-accent)")];
    if (p.empty !== null) return [...nodes, line(1, p.empty, "camp-line", "var(--c-dim)")];
    const visible = Math.floor((tallRect.h - PAD) / LINE_H) - 1;
    const focus = Math.max(0, p.rows.findIndex((r) => r.focused));
    const start = bestiaryWindowStart(p.rows.length, focus, visible);
    p.rows.slice(start, start + Math.max(0, visible)).forEach((r, i) => {
      nodes.push(line(i + 1, r.text, "camp-bestiary-row", r.focused ? "var(--c-accent)" : undefined, L.list));
    });
    if (p.pick !== null) {
      nodes.push(pictureNode(p.pick.monsterId));
      nodes.push(line(L.caption.row, p.pick.name, "camp-bestiary-name", "var(--c-accent)", L.caption));
      nodes.push(line(L.caption.row + 1, p.pick.kills, "camp-bestiary-kills", undefined, L.caption));
    }
    return nodes;
  };

  /** UI-80: 最後に描いた品を押せるキャラクター画面（それ以外を描いたら null） */
  let tappable: CharacterDetail | null = null;

  return {
    el,
    characterTarget(lx: number, ly: number): CharacterTap | null {
      return tappable === null ? null : characterHitAt(characterHitRects(tappable, tallRect.w), lx, ly);
    },
    characterTaps(): CharacterTap[] {
      return tappable === null ? [] : characterHitRects(tappable, tallRect.w).map((r) => r.tap);
    },
    render(p: CampPanelView): void {
      place(p.kind === "character" || p.kind === "bestiary" || (p.kind === "lines" && p.tall === true) ? tallRect : rect);
      tappable = p.kind === "character" && p.tappable === true ? p.detail : null;
      if (p.kind === "character") {
        detail.render(p.detail, p.focusSlot, p.itemFocus ?? null);
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
      if (p.kind === "bestiary") {
        el.replaceChildren(...bestiaryNodes(p));
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
