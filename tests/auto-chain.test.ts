// CB-43 / UI-54: オートの連鎖（src/presenter/auto-chain.ts）。BattleMenu は手組み。
import { describe, expect, test } from "vitest";
import type { BattleMenu, Command } from "../src/core/types";
import { chainDecision, closesInput, runChain, type ChainStep } from "../src/presenter/auto-chain";

function menu(o: Partial<BattleMenu> = {}): BattleMenu {
  return { round: 1, auto: false, canFlee: true, canRepeat: true, ready: false, pending: [], groups: [], members: [], allies: [], ...o };
}

describe("CB-43/UI-54 chainDecision", () => {
  test("CB-43/UI-54 表: rejected→stop、戦闘外→stop、オートで予約→autoOff、オート→resolve、手動で ready→resolve、手動で未完→stop", () => {
    const rows: [Parameters<typeof chainDecision>[0], ChainStep][] = [
      [{ rejected: true, menu: menu({ auto: true }), stopRequested: false }, "stop"],
      [{ rejected: true, menu: menu({ ready: true }), stopRequested: true }, "stop"],
      [{ rejected: false, menu: null, stopRequested: false }, "stop"],
      [{ rejected: false, menu: null, stopRequested: true }, "stop"],
      [{ rejected: false, menu: menu({ auto: true }), stopRequested: true }, "autoOff"],
      [{ rejected: false, menu: menu({ auto: true }), stopRequested: false }, "resolve"],
      [{ rejected: false, menu: menu({ ready: true }), stopRequested: false }, "resolve"],
      [{ rejected: false, menu: menu({ ready: true }), stopRequested: true }, "resolve"],
      [{ rejected: false, menu: menu({ ready: false }), stopRequested: false }, "stop"],
    ];
    for (const [i, want] of rows) expect(chainDecision(i), JSON.stringify(i)).toBe(want);
  });
});

describe("UI-44 closesInput", () => {
  test("UI-44 送ったら再生の間は入力の UI を下げる: 逃走・前回と同じ・手動の battle.resolve。オート中の resolve・battle.input・battle.auto・戦闘外の resolve は下げない", () => {
    const rows: [Command, BattleMenu | null, boolean][] = [
      [{ type: "battle.flee" }, menu(), true],
      [{ type: "battle.repeat" }, menu(), true],
      [{ type: "battle.resolve" }, menu({ ready: true }), true],
      [{ type: "battle.resolve" }, menu({ auto: true }), false],
      [{ type: "battle.resolve" }, null, false],
      [{ type: "battle.input", memberId: "c1", action: { type: "defend" } }, menu(), false],
      [{ type: "battle.auto", on: true }, menu(), false],
      [{ type: "battle.auto", on: false }, menu({ auto: true }), false],
    ];
    for (const [cmd, m, want] of rows) expect(closesInput(cmd, m), JSON.stringify([cmd, m?.auto])).toBe(want);
  });
});

/** 偽の run: 送られたコマンドを記録し、script の i 番目の結果（menu と rejected）にする */
function fake(script: { menu: BattleMenu | null; rejected?: boolean }[], o: { stopAfter?: number } = {}) {
  const sent: Command[] = [];
  let cur: BattleMenu | null = null;
  let stop = false;
  let frames = 0;
  return {
    sent,
    frames: () => frames,
    stopFlag: () => stop,
    deps: {
      async run(cmd: Command) {
        sent.push(cmd);
        const s = script[sent.length - 1];
        if (s === undefined) throw new Error("chain did not stop");
        cur = s.menu;
        if (o.stopAfter === sent.length) stop = true;
        return { rejected: s.rejected === true };
      },
      menu: () => cur,
      stopRequested: () => stop,
      clearStop: () => {
        stop = false;
      },
      yieldFrame: async () => {
        frames++;
      },
    },
  };
}

describe("CB-43/UI-54 runChain", () => {
  test("CB-43 オート on の後、3 回目の resolve で auto が偽になる（解除）と resolve × 3 で止まる。段の間で 1 フレームずつ譲る", async () => {
    const f = fake([
      { menu: menu({ auto: true }) }, // battle.auto on
      { menu: menu({ auto: true }) }, // resolve 1
      { menu: menu({ auto: true }) }, // resolve 2
      { menu: menu({ auto: false, ready: false }) }, // resolve 3 で CB-43 の解除
    ]);
    await runChain({ type: "battle.auto", on: true }, f.deps);
    expect(f.sent).toEqual([{ type: "battle.auto", on: true }, { type: "battle.resolve" }, { type: "battle.resolve" }, { type: "battle.resolve" }]);
    expect(f.frames()).toBe(3);
  });

  test("UI-54 決着（menu が null）で止まる", async () => {
    const f = fake([{ menu: menu({ auto: true }) }, { menu: null }]);
    await runChain({ type: "battle.auto", on: true }, f.deps);
    expect(f.sent.map((c) => c.type)).toEqual(["battle.auto", "battle.resolve"]);
  });

  test("UI-44 の例外: 解除の予約があれば次の段で battle.auto off を送り、予約を下ろす", async () => {
    const f = fake(
      [
        { menu: menu({ auto: true }) },
        { menu: menu({ auto: true }) }, // resolve 1 の再生中に予約
        { menu: menu({ auto: false }) }, // battle.auto off
      ],
      { stopAfter: 2 },
    );
    await runChain({ type: "battle.auto", on: true }, f.deps);
    expect(f.sent).toEqual([{ type: "battle.auto", on: true }, { type: "battle.resolve" }, { type: "battle.auto", on: false }]);
    expect(f.stopFlag()).toBe(false);
  });

  test("UI-54 手動でも最後の入力で ready なら resolve を送り、次のラウンドの入力待ちで止まる", async () => {
    const f = fake([{ menu: menu({ ready: true }) }, { menu: menu({ ready: false }) }]);
    await runChain({ type: "battle.input", memberId: "c6", action: { type: "defend" } }, f.deps);
    expect(f.sent.map((c) => c.type)).toEqual(["battle.input", "battle.resolve"]);
  });

  test("UI-54 rejected と、門に捨てられた（null）結果では無限ループせずに止まる", async () => {
    const f = fake([{ menu: menu({ auto: true }), rejected: true }]);
    await runChain({ type: "battle.resolve" }, f.deps);
    expect(f.sent).toHaveLength(1);

    let n = 0;
    await runChain(
      { type: "battle.resolve" },
      {
        run: async () => {
          n++;
          return null;
        },
        menu: () => menu({ auto: true }),
        stopRequested: () => false,
        clearStop: () => {},
        yieldFrame: async () => {},
      },
    );
    expect(n).toBe(1);
  });
});
