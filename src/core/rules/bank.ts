// 銀行の金（TW-10。M17）。街（screen town・dive null）でだけ、所持金 gold と預金 bank の間で金を移す。乱数は使わない。
// 預金は全滅の金の損失（TW-22）の対象外（wipe.ts は gold だけに掛ける）。TW-27 の総資産と TW-30 の救済の判定は gold + bank で数える。
import type { GameData } from "../data/index";
import type { GameState, RuleContext, TownMenu, TownMenuBankRow } from "../types";

/**
 * town.bank を受け付けない理由。順: wrong screen（街でない）→ bad amount（整数でない・0・正で所持金を超える・負で |amount| が預金を超える）
 */
export function checkBank(state: GameState, amount: unknown): string | null {
  if (state.screen !== "town" || state.dive !== null) return "wrong screen";
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount === 0) return "bad amount";
  if (amount > 0 && amount > state.gold) return "bad amount";
  if (amount < 0 && -amount > state.bank) return "bad amount";
  return null;
}

/**
 * TW-10。checkBank が null を返した前提。正: 所持金から預金へ → message town.bank.deposited{amount, bank}。
 * 負: 預金から所持金へ → message town.bank.withdrawn{amount（正の額）, gold}
 */
export function doBank(ctx: RuleContext, amount: number): void {
  const { state } = ctx;
  state.gold -= amount;
  state.bank += amount;
  if (amount > 0) ctx.events.push({ kind: "message", key: "town.bank.deposited", params: { amount, bank: state.bank } });
  else ctx.events.push({ kind: "message", key: "town.bank.withdrawn", params: { amount: -amount, gold: state.gold } });
}

/** 預入（sign 1。元は所持金）・引出（sign −1。元は預金）の額の行。順: 全額 → 半分（floor）→ config.bank.amounts の順 */
function amountRows(state: GameState, data: GameData, sign: 1 | -1): TownMenuBankRow[] {
  const pool = sign > 0 ? state.gold : state.bank;
  const rows: { kind: TownMenuBankRow["kind"]; amount: number }[] = [
    { kind: "all", amount: pool },
    { kind: "half", amount: Math.floor(pool / 2) },
    ...data.config.bank.amounts.map((n) => ({ kind: "fixed" as const, amount: n })),
  ];
  return rows.map((r) => {
    const delta = sign * r.amount;
    return { kind: r.kind, amount: r.amount, delta, ok: checkBank(state, delta) === null };
  });
}

/** UI-52 の銀行のページの値（townMenu.bank。純粋） */
export function bankMenu(state: GameState, data: GameData): TownMenu["bank"] {
  return { bank: state.bank, gold: state.gold, deposit: amountRows(state, data, 1), withdraw: amountRows(state, data, -1) };
}
