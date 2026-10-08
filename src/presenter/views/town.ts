// UI-52 の街。施設メニューは 酒場・宿屋・寺院・闇魔術・迷宮へ・店 の 6 行の一覧（M8.5。UI-13 の街の一覧）。各施設もリスト選択。
// 街の画面の配置は UI-13（layout の townLayout。views/dungeon.ts が組む）。ここはページの中身・見出し・施設を決める純粋な部分。
// 料金・押せるか・候補（宿のランク、寺院・闇魔術の対象、救済の候補、店の売り物・売れる品・買い戻し・鑑定・持たせる者、倉庫、入れる迷宮）は
// core の townMenu の値だけで決める（UI-35）。
// 表示層は式を持たない。どの項目で何を送るか（town.inn / town.temple / town.dark / town.mercy / town.shop / town.storage / town.upgrade / dungeon.enter）は app が決める。
// M7: 闇魔術は最初に 灰から戻す / 装備を鍛える / 戻る の一覧。強化（TW-17）の成功率・料金・可否は app が core の upgradePreview で取って渡す。
// M7: 店は最初に 買う / 売る / 買い戻す / 鑑定 / 倉庫 / 戻る の一覧。倉庫（TW-16）の入口は店の一覧の中（items.md §11 の Q9 の既定。銀行を作る段で移す）。
import type { EquipSlot, Strings } from "../../core/data/index";
import type { ClassChangeOption } from "../../core/rules/town";
import type { TownMenu, UpgradePreview } from "../../core/types";
import type { CampOpen } from "./camp";
import { STAT_ORDER } from "./detail";
import { formatMessage } from "./message";

export type TempleService = "resurrect" | "cure" | "uncurse";
/**
 * 街のページ。{ temple: s } は寺院のサービス s の対象の一覧。店（M7）:
 * shop は店の最初の一覧、shopBuy は売り物、{ shop: itemId } はその品を持たせる者、shopSell は売る者、{ sell: memberId } はその者の売れる品、
 * shopBuyback は買い戻しの品、{ buyback: instanceId } はその品を持たせる者、shopIdentify は鑑定する品。
 * 倉庫（TW-16）: storage は 預ける / 引き出す、storageDeposit は預ける者、{ deposit: memberId } はその者の品、
 * storageWithdraw は倉庫の品、{ withdraw: instanceId } はその品を受け取る者。
 * 闇魔術（M7）: dark は 灰から戻す / 装備を鍛える / 戻る、darkRevive は灰の者（TW-08）。強化（TW-17）: upgrade は者、{ upSlot: memberId } は部位、
 * { upCat } は触媒の選択（picked は選んだ順の実体 id）、{ upConfirm } は成功率と料金の確認
 */
export type TownPage =
  | "menu"
  | "tavern"
  | "inn"
  | "temple"
  | "dark"
  | "darkRevive"
  | "upgrade"
  | "gate"
  | "shop"
  | "shopBuy"
  | "shopSell"
  | "shopBuyback"
  | "shopIdentify"
  | "storage"
  | "storageDeposit"
  | "storageWithdraw"
  | { temple: TempleService }
  | { shop: string }
  | { sell: string }
  | { buyback: string }
  | { deposit: string }
  | { withdraw: string }
  | { upSlot: string }
  | { upCat: UpgradeSel }
  | { upConfirm: UpgradeSel }
  /** TW-09 / CH-22（M10）: 転職。classChange は申し出る者、{ ccClass } はその者の転職先、{ ccConfirm } は確認 */
  | "classChange"
  | { ccClass: string }
  | { ccConfirm: ClassChangeSel };
/** TW-17: 強化の選択中の対象（本人・部位）と触媒 */
export type UpgradeSel = { memberId: string; slot: EquipSlot; picked: string[] };
/** TW-09（M10）: 転職の確認の対象（者と転職先） */
export type ClassChangeSel = { memberId: string; classId: string };
/**
 * TW-09（M10）: 転職の段に要る core の値。members はパーティ全員（並び順。app が campMenu の members から渡す）、
 * options はページの者の classChangeOptions（申し出る者の段では []）
 */
export type ClassChangeView = { members: { memberId: string; name: string }[]; options: ClassChangeOption[] };
export type TownEntry =
  | { kind: "page"; to: TownPage; label: string }
  /** M7: 次のページへ移る行で、押せないことがあるもの（売れる品の無い者・払えない買い戻しの品など）。disabled なら dim */
  | { kind: "pick"; to: TownPage; label: string; disabled: boolean }
  | { kind: "inn"; rank: number; label: string; disabled: boolean }
  | { kind: "temple"; service: TempleService; memberId: string; label: string; disabled: boolean }
  | { kind: "dark"; memberId: string; label: string; disabled: boolean }
  /** 寺院のサービス・闇魔術の対象がいない（「その必要がある者はいない」。押すと同じ文を語る） */
  | { kind: "templeNone"; label: string }
  /** M7: 一覧が空（「売れる物がない」など）。押しても何もしない */
  | { kind: "empty"; label: string; disabled: true }
  | { kind: "mercy"; memberId: string; label: string }
  /** notReady: 準備中（DG-35。core の notReady）なら押したときに会話の箱へ出す理由の文、そうでなければ null（UI-52 / TW-11。M9） */
  | { kind: "enter"; dungeonId: string; label: string; disabled: boolean; notReady: string | null }
  /** TW-05: 店の売り物の行（名前と価格。払えなければ disabled）。押すと { shop: itemId } のページへ */
  | { kind: "shopItem"; itemId: string; label: string; disabled: boolean }
  /** TW-05: 持たせるメンバーの行（名前と所持枠の空き。空きが無いか払えなければ disabled）。押すと town.shop の buy */
  | { kind: "buy"; itemId: string; memberId: string; label: string; disabled: boolean }
  /** IT-61: 売る品の行（名前と売値）。押すと town.shop の sell */
  | { kind: "sell"; memberId: string; instanceId: string; label: string; disabled: boolean }
  /** IT-63: 買い戻した品を持たせる者の行。押すと town.shop の buyback */
  | { kind: "buyback"; memberId: string; instanceId: string; label: string; disabled: boolean }
  /** IT-65: 鑑定する品の行（持ち主・未鑑定の名前・料金。払えなければ disabled）。押すと town.shop の identify */
  | { kind: "identify"; memberId: string; instanceId: string; label: string; disabled: boolean }
  /** TW-16: 預ける品の行（倉庫が満杯なら disabled）。押すと town.storage の deposit */
  | { kind: "deposit"; memberId: string; instanceId: string; label: string; disabled: boolean }
  /** TW-16: 引き出した品を受け取る者の行（所持枠の空きが無ければ disabled）。押すと town.storage の withdraw */
  | { kind: "withdraw"; memberId: string; instanceId: string; label: string; disabled: boolean }
  /** TW-13 / UI-52（M5.5）: 酒場の「見回す」。押すと town.lookAround（酒場の一覧にとどまる） */
  | { kind: "look"; label: string }
  /** TW-35 / UI-73（M12。U-2）: 酒場の「戦績」（townMenu.canShowRecord のときだけ）。押すと戦績の画面（コマンドは送らない） */
  | { kind: "record"; label: string }
  /** TW-17: 触媒の行。押すと選択の印を付け外しした { upCat } へ（語りは出さない）。3 個選んだ後の未選択の行は disabled */
  | { kind: "upPick"; to: TownPage; label: string; disabled: boolean }
  /** TW-17: 確認の「鍛える」。押すと town.upgrade（upgradePreview の block が null でなければ disabled） */
  | { kind: "upgrade"; memberId: string; slot: EquipSlot; catalysts: string[]; label: string; disabled: boolean }
  /** TW-03 / UI-52: 酒場の状態（キャラクター画面 UI-59）・並び順・図鑑。押すとキャンプと同じ部品（views/camp.ts）をその段で開く */
  | { kind: "camp"; open: CampOpen; label: string }
  /**
   * TW-09 / CH-22（M10）: 転職先の行。押すと確認の段（{ ccConfirm }）へ。core の classChangeOptions の ok が偽なら dim で、
   * 押すと会話の箱に reason（core の理由から作った文。無ければ null）を語る
   */
  | { kind: "ccClass"; to: TownPage; label: string; disabled: boolean; reason: string | null }
  /** TW-09（M10）: 確認の「転職する」。押すと town.classChange */
  | { kind: "classChange"; memberId: string; classId: string; label: string; disabled: boolean }
  | { kind: "back"; label: string };

const TEMPLE_SERVICES: readonly TempleService[] = ["resurrect", "cure", "uncurse"];

/** TW-09（M10）: core の checkClassChange の理由 → 語る文の strings キー（受け付けの段の理由は表に無いので語らない） */
const CLASS_CHANGE_REASON: Readonly<Record<string, string>> = {
  "not alive": "town.classChange.reason.notAlive",
  "same class": "town.classChange.reason.same",
  "requirements not met": "town.classChange.reason.need",
  "not enough gold": "town.classChange.reason.noGold",
};

/**
 * TW-09 / CH-22（M10）: 転職先の dim の行を押したときに語る文。要る能力値は core の requirements を能力値の順に並べるだけ
 * （満たしているかを表示層で比べない）。ok か、表に無い理由なら null
 */
function classChangeReason(o: ClassChangeOption, name: string, strings: Strings): string | null {
  const key = o.reason === null ? undefined : CLASS_CHANGE_REASON[o.reason];
  if (key === undefined) return null;
  const stats = STAT_ORDER.flatMap((k) => {
    const n = o.requirements[k];
    return n === undefined ? [] : [s(strings, "town.classChange.stat", { stat: s(strings, `stat.${k}`), n })];
  }).join(s(strings, "town.classChange.statSep"));
  return s(strings, key, { name, cls: o.name, stats });
}

function s(strings: Strings, key: string, params?: Record<string, string | number>): string {
  return formatMessage(strings[key] ?? key, params);
}

/** オブジェクトのページの種類（{ temple } なら "temple"）と値 */
function objPage(p: Exclude<TownPage, string>): { key: string; value: string } {
  const [key, value] = Object.entries(p)[0] ?? ["", ""];
  return { key, value: typeof value === "string" ? value : JSON.stringify(value) };
}

/** 同じページか（オブジェクトのページは種類と値で比べる） */
export function samePage(a: TownPage, b: TownPage): boolean {
  if (typeof a === "string" || typeof b === "string") return a === b;
  const x = objPage(a);
  const y = objPage(b);
  return x.key === y.key && x.value === y.value;
}

/** 1 つ上のページ（Esc・戻る）。menu は null */
export function townParent(page: TownPage): TownPage | null {
  if (page === "menu") return null;
  if (typeof page === "object") {
    if ("temple" in page) return "temple";
    if ("shop" in page) return "shopBuy";
    if ("sell" in page) return "shopSell";
    if ("buyback" in page) return "shopBuyback";
    if ("deposit" in page) return "storageDeposit";
    if ("upSlot" in page) return "upgrade";
    if ("upCat" in page) return { upSlot: page.upCat.memberId };
    if ("upConfirm" in page) return { upCat: page.upConfirm };
    if ("ccClass" in page) return "classChange";
    if ("ccConfirm" in page) return { ccClass: page.ccConfirm.memberId };
    return "storageWithdraw";
  }
  if (page === "classChange") return "tavern";
  if (page === "darkRevive" || page === "upgrade") return "dark";
  if (page === "shopBuy" || page === "shopSell" || page === "shopBuyback" || page === "shopIdentify" || page === "storage") return "shop";
  if (page === "storageDeposit" || page === "storageWithdraw") return "storage";
  return "menu";
}

/**
 * M7: townMenu を取り直した後に、成り立たなくなったページを 1 つ上へ直す（買い戻した品・引き出した品がストックから消えた、など）。
 * 成り立つならそのまま返す
 */
export function townRepair(page: TownPage, menu: TownMenu): TownPage {
  if (typeof page === "string") return page;
  if ("shop" in page) {
    const id = page.shop;
    return menu.shop.items.some((r) => r.itemId === id) || menu.shop.equipment.some((r) => r.itemId === id) ? page : "shopBuy";
  }
  if ("sell" in page) return menu.shop.sellable.some((m) => m.memberId === page.sell) ? page : "shopSell";
  if ("buyback" in page) return menu.shop.buyback.some((r) => r.instanceId === page.buyback) ? page : "shopBuyback";
  if ("deposit" in page) return menu.storage.members.some((m) => m.memberId === page.deposit) ? page : "storageDeposit";
  if ("withdraw" in page) return menu.storage.items.some((r) => r.instanceId === page.withdraw) ? page : "storageWithdraw";
  if ("upSlot" in page) return menu.upgrade.members.some((m) => m.memberId === page.upSlot) ? page : "upgrade";
  if ("upCat" in page || "upConfirm" in page) {
    // TW-17: 本人がいない → 者の段、部位が対象にできない → 部位の段、消えた触媒は選択から外す
    const sel = "upCat" in page ? page.upCat : page.upConfirm;
    const m = menu.upgrade.members.find((x) => x.memberId === sel.memberId);
    if (m === undefined) return "upgrade";
    if (m.slots.find((x) => x.slot === sel.slot)?.block !== null) return { upSlot: sel.memberId };
    const picked = sel.picked.filter((id) => m.catalysts.some((c) => c.instanceId === id));
    if (picked.length === sel.picked.length) return page;
    return "upCat" in page ? { upCat: { ...sel, picked } } : { upConfirm: { ...sel, picked } };
  }
  return page;
}

/**
 * そのページのリストの項目（menu は 6 行で戻るは無い。それ以外は一覧で末尾が戻る）。
 * preview は { upConfirm } のときに app が core の upgradePreview で取った値（それ以外のページでは使わない）
 */
export function townEntries(
  page: TownPage,
  menu: TownMenu,
  strings: Strings,
  preview: UpgradePreview | null = null,
  cc: ClassChangeView | null = null,
): TownEntry[] {
  const back: TownEntry = { kind: "back", label: s(strings, "common.back") };
  const empty = (key: string): TownEntry => ({ kind: "empty", label: s(strings, key), disabled: true });
  /** 空なら empty の行を 1 つ置く */
  const orEmpty = (rows: TownEntry[], key: string): TownEntry[] => [...(rows.length === 0 ? [empty(key)] : rows), back];
  if (page === "menu") {
    return [
      { kind: "page", to: "tavern", label: s(strings, "town.menu.tavern") },
      { kind: "page", to: "inn", label: s(strings, "town.menu.inn") },
      { kind: "page", to: "temple", label: s(strings, "town.menu.temple") },
      { kind: "page", to: "dark", label: s(strings, "town.menu.dark") },
      { kind: "page", to: "gate", label: s(strings, "town.menu.dungeon") },
      { kind: "page", to: "shop", label: s(strings, "town.menu.shop") },
    ];
  }
  if (page === "tavern") {
    // TW-13: 見回す → TW-03: 状態（M10: キャラクター画面 UI-59。呪文・道具・装備・鑑定はその画面の操作に移した）・並び順
    // → IT-66（M7）: 図鑑 → TW-31: 救済の申し出の間だけ、dead / ash の者の行（押すと town.mercy）→ 戻る（UI-11 の固定の位置）
    const opens: readonly CampOpen[] = ["status", "order", "book"];
    const camp: TownEntry[] = [
      { kind: "look", label: s(strings, "town.tavern.look") },
      ...opens.map((open): TownEntry => ({ kind: "camp", open, label: s(strings, `camp.${open}`) })),
    ];
    // TW-09（M10）: GM に申し出る（転職）は図鑑の後。dim にしない（可否は職業の段で dim）
    camp.push({ kind: "page", to: "classChange", label: s(strings, "town.tavern.classChange") });
    // TW-35 / UI-73（M12。U-2）: 戦績は全ダンジョン制覇の後だけ（出すかは core の canShowRecord）。転職の後
    if (menu.canShowRecord) camp.push({ kind: "record", label: s(strings, "town.tavern.record") });
    const rows = (menu.mercy ?? []).map((m): TownEntry => ({ kind: "mercy", memberId: m.memberId, label: s(strings, "town.tavern.mercyRow", { name: m.name }) }));
    return [...camp, ...rows, back];
  }
  if (page === "classChange") {
    // TW-09（M10）: 申し出る者（全員。並び順。dim にしない。死亡・灰の者は職業の段で理由を語る）
    const rows = (cc?.members ?? []).map((x): TownEntry => ({ kind: "pick", to: { ccClass: x.memberId }, label: x.name, disabled: false }));
    return [...rows, back];
  }
  if (typeof page === "object" && "ccClass" in page) {
    // TW-09 / CH-22（M10）: 転職先（classes.json の順。今の職業は印）。可否と理由は core の classChangeOptions だけで決める
    const memberId = page.ccClass;
    const name = cc?.members.find((x) => x.memberId === memberId)?.name ?? "";
    const rows = (cc?.options ?? []).map(
      (o): TownEntry => ({
        kind: "ccClass",
        to: { ccConfirm: { memberId, classId: o.classId } },
        label: o.current ? s(strings, "town.classChange.current", { cls: o.name }) : o.name,
        disabled: !o.ok,
        reason: classChangeReason(o, name, strings),
      }),
    );
    return [...rows, back];
  }
  if (typeof page === "object" && "ccConfirm" in page) {
    // TW-09（M10）: 転職する（core の ok が偽なら dim）→ 戻る（職業の段へ）
    const sel = page.ccConfirm;
    const ok = cc?.options.find((o) => o.classId === sel.classId)?.ok ?? false;
    return [{ kind: "classChange", memberId: sel.memberId, classId: sel.classId, label: s(strings, "town.classChange.yes"), disabled: !ok }, back];
  }
  if (page === "inn") {
    // TW-15（M7）: 士気の立つランク（core の townMenu の morale）は行の末尾に印（town.inn.moraleMark）
    const rows = menu.inn.map((r): TownEntry => {
      const row = s(strings, "town.inn.rank", { name: r.name, cost: r.cost });
      return { kind: "inn", rank: r.rank, label: r.morale ? s(strings, "town.inn.moraleMark", { row }) : row, disabled: !r.affordable };
    });
    return [...rows, back];
  }
  if (page === "temple") {
    return [...TEMPLE_SERVICES.map((sv): TownEntry => ({ kind: "page", to: { temple: sv }, label: s(strings, `town.temple.${sv}`) })), back];
  }
  if (page === "dark") {
    // M7 UI-52: 灰から戻す / 装備を鍛える（TW-17）/ 戻る。どちらも dim にしない（中が空なら空の行）
    return [
      { kind: "page", to: "darkRevive", label: s(strings, "town.dark.menu.revive") },
      { kind: "page", to: "upgrade", label: s(strings, "town.dark.menu.upgrade") },
      back,
    ];
  }
  if (page === "upgrade") {
    // TW-17: 全員（並び順。life を問わない）。対象にできる部位が無い者は disabled
    const rows = menu.upgrade.members.map((m): TownEntry => ({ kind: "pick", to: { upSlot: m.memberId }, label: m.name, disabled: !m.canUpgrade }));
    return [...rows, back];
  }
  if (page === "darkRevive") {
    // TW-08: ash の者の行（名前と料金。払えなければ disabled）。押すと town.dark
    const rows = menu.dark.map(
      (r): TownEntry => ({ kind: "dark", memberId: r.memberId, label: s(strings, "town.dark.row", { name: r.name, cost: r.cost }), disabled: !r.affordable }),
    );
    if (rows.length === 0) return [{ kind: "templeNone", label: s(strings, "town.temple.none") }, back];
    return [...rows, back];
  }
  if (page === "gate") {
    // DG-35（M9）: 準備中の行は「名前（準備中）」。dim は canEnter だけで決まる（判定は core）
    const rows = menu.dungeons.map(
      (d): TownEntry => ({
        kind: "enter",
        dungeonId: d.id,
        label: d.notReady ? s(strings, "town.gate.notReady", { name: d.name }) : d.name,
        disabled: !d.canEnter,
        notReady: d.notReady ? s(strings, "town.gate.notReadyReason", { name: d.name }) : null,
      }),
    );
    return [...rows, back];
  }
  if (page === "shop") {
    // M7 UI-52: 買う / 売る / 買い戻す / 鑑定 / 倉庫（TW-16。Q9 の既定）/ 戻る。どれも dim にしない（中が空なら空の行）
    return [
      { kind: "page", to: "shopBuy", label: s(strings, "town.shop.menu.buy") },
      { kind: "page", to: "shopSell", label: s(strings, "town.shop.menu.sell") },
      { kind: "page", to: "shopBuyback", label: s(strings, "town.shop.menu.buyback") },
      { kind: "page", to: "shopIdentify", label: s(strings, "town.shop.menu.identify") },
      { kind: "page", to: "storage", label: s(strings, "town.shop.menu.storage") },
      back,
    ];
  }
  if (page === "shopBuy") {
    // TW-05: 消耗品の行 → IT-62: 流通レベルの汎用装備の行（名前は core の表示名「長剣 +2」）。どちらも名前と価格、払えなければ disabled
    const rows = [...menu.shop.items, ...menu.shop.equipment].map(
      (r): TownEntry => ({ kind: "shopItem", itemId: r.itemId, label: s(strings, "town.shop.row", { name: r.name, cost: r.price }), disabled: !r.affordable }),
    );
    return [...rows, back];
  }
  if (page === "shopSell") {
    // IT-61: 全員（並び順。life を問わない）。売れる品（所持品。未鑑定も売れる）が無い者は disabled
    const rows = menu.shop.sellable.map(
      (m): TownEntry => ({ kind: "pick", to: { sell: m.memberId }, label: s(strings, "town.shop.sellWho", { name: m.name, count: m.items.length }), disabled: m.items.length === 0 }),
    );
    return [...rows, back];
  }
  if (page === "shopBuyback") {
    // IT-63: 買い戻しのストック（売った順）の行（名前と値段。払えなければ disabled）
    const rows = menu.shop.buyback.map(
      (r): TownEntry => ({ kind: "pick", to: { buyback: r.instanceId }, label: s(strings, "town.shop.row", { name: r.name, cost: r.price }), disabled: !r.affordable }),
    );
    return orEmpty(rows, "town.shop.buyback.none");
  }
  if (page === "shopIdentify") {
    // IT-65: 全員の未鑑定の品（持ち主・未鑑定の名前・品ごとの鑑定料。払えなければ disabled）
    const rows = menu.shop.identify.items.map(
      (r): TownEntry => ({
        kind: "identify",
        memberId: r.memberId,
        instanceId: r.instanceId,
        label: s(strings, "town.shop.identifyRow", { owner: r.memberName, name: r.name, cost: r.fee }),
        disabled: !r.affordable,
      }),
    );
    return orEmpty(rows, "camp.identify.none");
  }
  if (page === "storage") {
    // TW-16: 預ける / 引き出す（倉庫の数と容量）/ 戻る
    const st = menu.storage;
    return [
      { kind: "page", to: "storageDeposit", label: s(strings, "town.storage.menu.deposit") },
      { kind: "page", to: "storageWithdraw", label: s(strings, "town.storage.menu.withdraw", { count: st.items.length, capacity: st.capacity }) },
      back,
    ];
  }
  if (page === "storageDeposit") {
    // TW-16: 全員（並び順。life を問わない）。所持品の無い者は disabled
    const rows = menu.storage.members.map(
      (m): TownEntry => ({ kind: "pick", to: { deposit: m.memberId }, label: s(strings, "town.shop.sellWho", { name: m.name, count: m.items.length }), disabled: m.items.length === 0 }),
    );
    return [...rows, back];
  }
  if (page === "storageWithdraw") {
    const rows = menu.storage.items.map((r): TownEntry => ({ kind: "pick", to: { withdraw: r.instanceId }, label: r.name, disabled: false }));
    return orEmpty(rows, "town.storage.empty");
  }
  if ("upSlot" in page) {
    // TW-17: 装備の部位（EQUIP_SLOTS の順）。空き・ユニークは disabled。押すと触媒の段（選択なし）へ
    const memberId = page.upSlot;
    const m = menu.upgrade.members.find((x) => x.memberId === memberId);
    const rows = (m?.slots ?? []).map((x): TownEntry => {
      const slot = s(strings, `detail.slot.${x.slot}`);
      const label = x.name === null ? s(strings, "town.upgrade.slotEmpty", { slot }) : s(strings, "town.upgrade.slotRow", { slot, item: x.name });
      return { kind: "pick", to: { upCat: { memberId, slot: x.slot, picked: [] } }, label, disabled: x.block !== null };
    });
    return [...rows, back];
  }
  if ("upCat" in page) {
    // TW-17: 触媒の候補（本人の鑑定済みの汎用装備）。押すと印を付け外し（maxCatalysts 個まで）→ 決める → 戻る
    const sel = page.upCat;
    const m = menu.upgrade.members.find((x) => x.memberId === sel.memberId);
    const full = sel.picked.length >= menu.upgrade.maxCatalysts;
    const rows = (m?.catalysts ?? []).map((c): TownEntry => {
      const on = sel.picked.includes(c.instanceId);
      const picked = on ? sel.picked.filter((id) => id !== c.instanceId) : [...sel.picked, c.instanceId];
      return {
        kind: "upPick",
        to: { upCat: { ...sel, picked } },
        label: s(strings, on ? "town.upgrade.catOn" : "town.upgrade.catOff", { name: c.name }),
        disabled: !on && full,
      };
    });
    const decide: TownEntry = { kind: "page", to: { upConfirm: sel }, label: s(strings, "town.upgrade.decide") };
    return [...(rows.length === 0 ? [empty("town.upgrade.catNone")] : rows), decide, back];
  }
  if ("upConfirm" in page) {
    // TW-17: 鍛える（core の upgradePreview の block が null のときだけ押せる）→ 戻る（触媒の段へ）
    const sel = page.upConfirm;
    return [
      {
        kind: "upgrade",
        memberId: sel.memberId,
        slot: sel.slot,
        catalysts: [...sel.picked],
        label: s(strings, "town.upgrade.do", { item: upgradeTarget(menu, sel), count: sel.picked.length }),
        disabled: preview === null || preview.block !== null,
      },
      back,
    ];
  }
  if ("shop" in page) {
    // TW-05: 持たせるメンバーの行（生きている者を並び順で。所持枠の空きが無い者・払えないときは disabled）
    const itemId = page.shop;
    const affordable = [...menu.shop.items, ...menu.shop.equipment].find((r) => r.itemId === itemId)?.affordable ?? false;
    const rows = menu.shop.members.map(
      (m): TownEntry => ({
        kind: "buy",
        itemId,
        memberId: m.memberId,
        label: s(strings, "town.shop.member", { name: m.name, slots: m.slotsFree }),
        disabled: !affordable || m.slotsFree <= 0,
      }),
    );
    return [...rows, back];
  }
  if ("sell" in page) {
    // IT-61: その者の売れる品（名前と売値）。売った後もこのページにとどまる
    const memberId = page.sell;
    const m = menu.shop.sellable.find((x) => x.memberId === memberId);
    const rows = (m?.items ?? []).map(
      (r): TownEntry => ({ kind: "sell", memberId, instanceId: r.instanceId, label: s(strings, "town.shop.sellRow", { name: r.name, gold: r.price }), disabled: false }),
    );
    return orEmpty(rows, "town.shop.sell.none");
  }
  if ("buyback" in page) {
    // IT-63: 持たせる者（生きている者。所持枠の空きが無い者・払えないときは disabled）
    const instanceId = page.buyback;
    const affordable = menu.shop.buyback.find((r) => r.instanceId === instanceId)?.affordable ?? false;
    const rows = menu.shop.members.map(
      (m): TownEntry => ({
        kind: "buyback",
        memberId: m.memberId,
        instanceId,
        label: s(strings, "town.shop.member", { name: m.name, slots: m.slotsFree }),
        disabled: !affordable || m.slotsFree <= 0,
      }),
    );
    return [...rows, back];
  }
  if ("deposit" in page) {
    // TW-16: その者の所持品（未鑑定・呪われた品も可）。倉庫が満杯なら disabled
    const memberId = page.deposit;
    const m = menu.storage.members.find((x) => x.memberId === memberId);
    const full = menu.storage.slotsFree <= 0;
    const rows = (m?.items ?? []).map((r): TownEntry => ({ kind: "deposit", memberId, instanceId: r.instanceId, label: r.name, disabled: full }));
    return orEmpty(rows, "town.storage.none");
  }
  if ("withdraw" in page) {
    // TW-16: 受け取る者（全員。life を問わない。所持枠の空きが無ければ disabled）
    const instanceId = page.withdraw;
    const rows = menu.storage.members.map(
      (m): TownEntry => ({
        kind: "withdraw",
        memberId: m.memberId,
        instanceId,
        label: s(strings, "town.shop.member", { name: m.name, slots: m.slotsFree }),
        disabled: m.slotsFree <= 0,
      }),
    );
    return [...rows, back];
  }
  const sv = page.temple;
  const rows = menu.temple[sv].map(
    (r): TownEntry => ({
      kind: "temple",
      service: sv,
      memberId: r.memberId,
      label: s(strings, "town.temple.row", { name: r.name, cost: r.cost }),
      disabled: !r.affordable,
    }),
  );
  if (rows.length === 0) return [{ kind: "templeNone", label: s(strings, "town.temple.none") }, back];
  return [...rows, back];
}

/**
 * ページに入ったときにメッセージ窓へ出す語りの strings キー（params なし。再生の外で出す）。
 * 答えのボタンが続く問い（強化・転職の確認、救済の申し出）は語らず、見出し（townHeadingText）に出す（M10.5 追補。未定-22）
 */
export function townPageIntro(page: TownPage, menu: TownMenu): string[] {
  if (page === "tavern") return ["town.tavern.intro"]; // M10.5 追補（未定-22）: 救済の申し出の問いは見出し（townHeadingText）
  if (page === "inn") return menu.morale !== null ? ["town.inn.intro", "town.inn.moraleNow"] : ["town.inn.intro"]; // TW-15: 士気がある間は続けて語る
  if (page === "temple") return ["town.temple.intro"];
  if (page === "dark") return ["town.dark.intro"];
  if (page === "upgrade") return ["town.upgrade.intro"]; // TW-17
  if (page === "gate") return ["town.dungeonGate.intro"];
  if (page === "shop") return ["town.shop.intro"];
  if (page === "shopSell") return ["town.shop.sellIntro"];
  if (page === "shopBuyback") return ["town.shop.buybackIntro"];
  if (page === "shopIdentify") return ["town.shop.identifyIntro"];
  if (page === "storage") return ["town.storage.intro"];
  if (page === "classChange") return ["town.classChange.intro"]; // TW-09（M10）
  // M8.5: 問いだけの語り（買う・持たせる者・受け取る者・強化の部位と触媒）は一覧の見出し（townHeading）に移した
  return [];
}

/** UI-61 / UI-13（M8.5）: 施設の id（施設の絵 public/town/<id>.png・ヘッダーの場所 town.place.<id>） */
export type TownFacility = "town" | "tavern" | "inn" | "temple" | "dark" | "gate" | "shop";

/**
 * UI-61（M8.5）: ページの施設。menu は town、寺院のサービスの対象は temple、闇魔術（灰から戻す・強化の各段）は dark、
 * 店（売る・買う・買い戻す・鑑定・倉庫の各段）は shop
 */
export function townFacility(page: TownPage): TownFacility {
  if (typeof page === "object") {
    if ("temple" in page) return "temple";
    if ("ccClass" in page || "ccConfirm" in page) return "tavern"; // TW-09（M10）
    if ("upSlot" in page || "upCat" in page || "upConfirm" in page) return "dark";
    return "shop"; // shop / sell / buyback / deposit / withdraw
  }
  switch (page) {
    case "menu":
      return "town";
    case "tavern":
    case "inn":
    case "temple":
    case "dark":
    case "gate":
    case "shop":
      return page;
    case "classChange":
      return "tavern";
    case "darkRevive":
    case "upgrade":
      return "dark";
    default:
      return "shop"; // shopBuy / shopSell / shopBuyback / shopIdentify / storage / storageDeposit / storageWithdraw
  }
}

/** UI-52（M8.5）: ヘッダーの場所の strings キー（town.place.<施設>） */
export function townPlace(page: TownPage): string {
  return `town.place.${townFacility(page)}`;
}

/**
 * UI-52 / UI-13（M8.5）: 一覧の先頭に固定する見出し（段の問い）の strings キー。ログ（UI-46）には入れない。
 * 1 行（見出しの幅 224 = 全角 28 字）に収める
 */
export function townHeading(page: TownPage): string {
  if (typeof page === "object") {
    if ("temple" in page) return "town.ask.templeWho";
    if ("upSlot" in page) return "town.upgrade.slot";
    if ("upCat" in page) return "town.upgrade.catalyst";
    if ("upConfirm" in page) return "town.ask.upConfirm";
    if ("ccClass" in page) return "town.ask.classChangeTo";
    if ("ccConfirm" in page) return "town.ask.classChangeConfirm";
    if ("shop" in page || "buyback" in page) return "town.shop.whom";
    if ("sell" in page) return "town.ask.sellItem";
    if ("deposit" in page) return "town.ask.depositItem";
    return "town.storage.whom"; // withdraw
  }
  switch (page) {
    case "menu":
      return "town.ask.menu";
    case "tavern":
    case "shop":
    case "storage":
      return "town.ask.what";
    case "inn":
      return "town.ask.inn";
    case "temple":
    case "dark":
      return "town.ask.service";
    case "darkRevive":
      return "town.ask.revive";
    case "upgrade":
      return "town.upgrade.whom";
    case "gate":
      return "town.ask.gate";
    case "shopBuy":
      return "town.shop.buyIntro";
    case "shopSell":
      return "town.ask.sellWho";
    case "shopBuyback":
      return "town.ask.buyback";
    case "shopIdentify":
      return "town.ask.identify";
    case "storageDeposit":
      return "town.ask.depositWho";
    case "storageWithdraw":
      return "town.ask.withdraw";
    case "classChange":
      return "town.ask.classChangeWho";
  }
}

/** UI-52（M8.5）: townFreshIntro が照合する全文の履歴の末尾の件数【仮】（M7 の窓の下 2 行の名残。広げた一覧は UI-13 に置き換えた） */
export const TOWN_INTRO_DEDUP = 2;

/**
 * UI-52 / TW-17（M7）: ページに入ったときの語り（整形済み）のうち、直近の文（recent。app は全文の履歴の末尾
 * TOWN_INTRO_DEDUP 件を渡す）と同じものを省く。段を戻ってまた進んだときに同じ語りを重ねて出さない。新しい配列を返す
 */
export function townFreshIntro(texts: readonly string[], recent: readonly string[]): string[] {
  return texts.filter((x) => !recent.includes(x));
}

/** TW-17: 確認の段の対象の品名（townMenu.upgrade の部位の name。見つからなければ空） */
function upgradeTarget(menu: TownMenu, sel: UpgradeSel): string {
  return menu.upgrade.members.find((m) => m.memberId === sel.memberId)?.slots.find((x) => x.slot === sel.slot)?.name ?? "";
}

/**
 * UI-52 / UI-47（M10.5 追補。2026-10-07 ユーザーの指示「ボタンが隠れてはまずいので問いがある場合はその出し方に。全体表示はボタンがない場合」。未定-22）:
 * 一覧の見出し（1 行・全角 28 字）に出す文（整形済み）。答えのボタンが続く問いは会話の箱（広い箱は答えのボタンを覆う）で語らず、ここに値を入れて出す。
 * - 強化の確認（{ upConfirm }）: core の upgradePreview の値で「成功率 {rate}（大成功 {great}）料金 {fee}G。鍛えるか？」、払えなければ問いの代わりに
 *   「…。所持金が足りない。」（town.upgrade.ask / askNoGold）。対象と触媒の数は答えのボタンのラベル（town.upgrade.do）。preview が null なら town.ask.upConfirm
 * - 転職の確認（{ ccConfirm }）: 「{name}を{cls}にする。レベルは 1 に戻る。よいか。」（town.classChange.confirm）。cc が null なら town.ask.classChangeConfirm
 * - 酒場で救済の申し出（TW-30。menu.mercy が null でない）の間: town.ask.mercy（答えは救済の行）
 * - 施設メニューで救済の申し出の間: town.ask.menuMercy（酒場へ行けば戻してもらえる、と施設の問い。街に入るときの語り town.mercy.offer は問いを含まない）
 * - ほかは townHeading のキーの文
 */
export function townHeadingText(
  page: TownPage,
  menu: TownMenu,
  strings: Strings,
  preview: UpgradePreview | null = null,
  cc: ClassChangeView | null = null,
): string {
  if (typeof page === "object" && "upConfirm" in page && preview !== null) {
    return s(strings, preview.affordable ? "town.upgrade.ask" : "town.upgrade.askNoGold", { rate: preview.rate, great: preview.great, fee: preview.fee });
  }
  if (typeof page === "object" && "ccConfirm" in page && cc !== null) {
    const sel = page.ccConfirm;
    const name = cc.members.find((x) => x.memberId === sel.memberId)?.name ?? "";
    const cls = cc.options.find((o) => o.classId === sel.classId)?.name ?? "";
    return s(strings, "town.classChange.confirm", { name, cls });
  }
  if (page === "tavern" && menu.mercy !== null) return s(strings, "town.ask.mercy");
  if (page === "menu" && menu.mercy !== null) return s(strings, "town.ask.menuMercy");
  return s(strings, townHeading(page));
}

/**
 * UI-44（M7）: 押して送ったら、再生が終わるまで入力の UI（ヘッダーの所持金・一覧と固定の戻る）を下げる項目か。
 * 判定の箱（UI-40）を出してタップを待つ強化（TW-17）の「鍛える」だけ（戦闘の逃走・全滅の 2d10 と同じ扱い）。
 * 他の項目は判定の箱を出さないので、一覧を出したまま再生する
 */
export function townLowersInput(e: TownEntry): boolean {
  return e.kind === "upgrade";
}

/** UI-52（M8.5）: 街のヘッダー（場所と所持金。「{place}　{gold}G」） */
export function townHeader(menu: TownMenu, strings: Strings, page: TownPage): string {
  return s(strings, "town.header", { place: s(strings, townPlace(page)), gold: menu.gold });
}
