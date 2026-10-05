// UI-52 の街。施設メニューは 酒場・宿屋・寺院 / 闇魔術・迷宮へ・店 の 3 列 × 2 段の 6 枠（操作領域の layout.townMenu）。各施設はリスト選択。
// 街の画面は迷宮の画面（views/dungeon.ts）の 5 領域をそのまま使う（ビューは枠だけ）。ここはページの中身を決める純粋な部分。
// 料金・押せるか・候補（宿のランク、寺院・闇魔術の対象、救済の候補、店の売り物・売れる品・買い戻し・鑑定・持たせる者、倉庫、入れる迷宮）は
// core の townMenu の値だけで決める（UI-35）。
// 表示層は式を持たない。どの項目で何を送るか（town.inn / town.temple / town.dark / town.mercy / town.shop / town.storage / town.upgrade / dungeon.enter）は app が決める。
// M7: 闇魔術は最初に 灰から戻す / 装備を鍛える / 戻る の一覧。強化（TW-17）の成功率・料金・可否は app が core の upgradePreview で取って渡す。
// M7: 店は最初に 買う / 売る / 買い戻す / 鑑定 / 倉庫 / 戻る の一覧。倉庫（TW-16）の入口は店の一覧の中（items.md §11 の Q9 の既定。銀行を作る段で移す）。
import type { EquipSlot, Strings } from "../../core/data/index";
import type { TownMenu, UpgradePreview } from "../../core/types";
import type { CampOpen } from "./camp";
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
  | { upConfirm: UpgradeSel };
/** TW-17: 強化の選択中の対象（本人・部位）と触媒 */
export type UpgradeSel = { memberId: string; slot: EquipSlot; picked: string[] };
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
  | { kind: "enter"; dungeonId: string; label: string; disabled: boolean }
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
  /** TW-17: 触媒の行。押すと選択の印を付け外しした { upCat } へ（語りは出さない）。3 個選んだ後の未選択の行は disabled */
  | { kind: "upPick"; to: TownPage; label: string; disabled: boolean }
  /** TW-17: 確認の「鍛える」。押すと town.upgrade（upgradePreview の block が null でなければ disabled） */
  | { kind: "upgrade"; memberId: string; slot: EquipSlot; catalysts: string[]; label: string; disabled: boolean }
  /** TW-03 / UI-52: 酒場のキャンプと同じ項目（状態・呪文・道具・装備・並び順・鑑定）。押すとキャンプと同じ部品（views/camp.ts）をその段で開く */
  | { kind: "camp"; open: CampOpen; label: string }
  | { kind: "back"; label: string };

const TEMPLE_SERVICES: readonly TempleService[] = ["resurrect", "cure", "uncurse"];

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
    return "storageWithdraw";
  }
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
 * そのページのリストの項目（menu は 3 列 × 2 段の 6 枠。それ以外は一覧で末尾が戻る）。
 * preview は { upConfirm } のときに app が core の upgradePreview で取った値（それ以外のページでは使わない）
 */
export function townEntries(page: TownPage, menu: TownMenu, strings: Strings, preview: UpgradePreview | null = null): TownEntry[] {
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
    // TW-13: 見回す → TW-03: キャンプと同じ項目（状態・呪文・道具・装備・並び順・鑑定（canIdentify のときだけ））。どれも disabled にしない（可否は各段で dim）
    // → IT-66（M7）: 図鑑 → TW-31: 救済の申し出の間だけ、dead / ash の者の行（押すと town.mercy）→ 戻る（UI-11 の固定の位置）
    const opens: readonly CampOpen[] = menu.canIdentify
      ? ["status", "spell", "item", "equip", "order", "identify", "book"]
      : ["status", "spell", "item", "equip", "order", "book"];
    const camp: TownEntry[] = [
      { kind: "look", label: s(strings, "town.tavern.look") },
      ...opens.map((open): TownEntry => ({ kind: "camp", open, label: s(strings, `camp.${open}`) })),
    ];
    const rows = (menu.mercy ?? []).map((m): TownEntry => ({ kind: "mercy", memberId: m.memberId, label: s(strings, "town.tavern.mercyRow", { name: m.name }) }));
    return [...camp, ...rows, back];
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
    const rows = menu.dungeons.map((d): TownEntry => ({ kind: "enter", dungeonId: d.id, label: d.name, disabled: !d.canEnter }));
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
        label: s(strings, "town.upgrade.do"),
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
 * 酒場は救済の申し出（menu.mercy が null でない）の間だけ town.mercy.offer も続けて出す
 */
export function townPageIntro(page: TownPage, menu: TownMenu): string[] {
  if (page === "tavern") return menu.mercy !== null ? ["town.tavern.intro", "town.mercy.offer"] : ["town.tavern.intro"];
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
  }
}

/**
 * UI-52 / TW-17（M7）: ページに入ったときの語り（整形済み）のうち、窓の下に見えている直近の文（recent。app は履歴の末尾
 * LIST_TALL_MESSAGE_LINES 件を渡す）と同じものを省く。段を戻ってまた進んだときに同じ語りを重ねて出さない。新しい配列を返す
 */
export function townFreshIntro(texts: readonly string[], recent: readonly string[]): string[] {
  return texts.filter((x) => !recent.includes(x));
}

/**
 * TW-17: 確認の段（{ upConfirm }）に入ったときにメッセージ窓へ出す文（整形済み）。「対象 {item}　触媒 {count} 個」→
 * 「成功率 {rate}（うち大成功 {great}）　料金 {fee}G」→（払えなければ）所持金が足りない。値は core の townMenu.upgrade と upgradePreview。
 * 他のページ・preview が null なら []
 */
export function upgradeConfirmLines(page: TownPage, menu: TownMenu, preview: UpgradePreview | null, strings: Strings): string[] {
  if (typeof page !== "object" || !("upConfirm" in page) || preview === null) return [];
  const sel = page.upConfirm;
  const item = menu.upgrade.members.find((m) => m.memberId === sel.memberId)?.slots.find((x) => x.slot === sel.slot)?.name ?? "";
  const lines = [
    s(strings, "town.upgrade.confirm", { item, count: sel.picked.length }),
    s(strings, "town.upgrade.preview", { rate: preview.rate, great: preview.great, fee: preview.fee }),
  ];
  if (!preview.affordable) lines.push(s(strings, "town.upgrade.noGold"));
  return lines;
}

/**
 * UI-11 / UI-52（M7）: 一覧をビューとメッセージの領域に広げるページか（layout.listTall。メッセージ窓は下 2 行だけ見える）。
 * 店（最初の一覧・買う・持たせる者・売る者と品・買い戻しと持たせる者）、倉庫（最初の一覧・預ける者と品・引き出す品と受け取る者）、酒場の一覧、
 * 闇魔術の強化（TW-17）の 鍛える者・部位・触媒 の段（6 人と戻る、触媒 3 つと決めるが操作領域の 3 行に入らないため）。
 * 施設メニュー（3 列 × 2 段）・宿・寺院・闇魔術の最初の一覧と灰から戻す・強化の確認（成功率と料金の語りが 3 行になることがある）・迷宮の入口は広げない。
 * 店の鑑定も広げない（呪われた品では結果の語りが 3 行になり、窓の下 2 行に収まらない）
 */
export function townListTall(page: TownPage): boolean {
  if (typeof page === "object")
    return "shop" in page || "sell" in page || "buyback" in page || "deposit" in page || "withdraw" in page || "upSlot" in page || "upCat" in page;
  return (
    page === "upgrade" ||
    page === "tavern" ||
    page === "shop" ||
    page === "shopBuy" ||
    page === "shopSell" ||
    page === "shopBuyback" ||
    page === "storage" ||
    page === "storageDeposit" ||
    page === "storageWithdraw"
  );
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
