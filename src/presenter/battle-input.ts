// UI-54 / CB-10〜12: 戦闘のコマンド入力の段階（command → spell / item → 対象 → 次のメンバー、戻る）。純粋な状態機械で、DOM に触れない。
// 行動できるか・使えるか・揃ったかは core の battleMenu（BattleMenu）の値だけで知る（UI-35、§3-4）。ここは判定しない。
// - entries は今の段階で出す選択肢（ラベル・押せるか・選んだときの Choice）。command は 8 枠の 0..6（上段 攻撃・呪文・防御・道具、
//   下段 逃走・オート・戻る）、それ以外は一覧で末尾が「戻る」。
// - step は選択を受けて次の cursor と、送る Command（無ければ null）を返す。送るときの cursor は元のまま
//   （rejected なら呼び出し側はそのまま描き直し、受け付けられたら nextCursor で次のメンバーへ進む）。
// - 押せない（disabled）選択や、段階に合わない選択は cursor 不変・send null。
import type { SpellTarget, Strings } from "../core/data/index";
import type { BattleAction, BattleMenu, BattleMenuMember, BattleTarget, Command } from "../core/types";
import { formatMessage } from "./views/message";

export type InputStage = "command" | "spell" | "item" | "enemy" | "ally";
export type Pick = { kind: "attack" } | { kind: "cast"; spellId: string } | { kind: "item"; instanceId: string };
export type InputCursor = { memberId: string; stage: InputStage; pick: Pick | null };
export type Choice =
  | { kind: "cmd"; cmd: "attack" | "spell" | "defend" | "item" | "flee" | "auto" | "back" }
  | { kind: "spell"; spellId: string }
  | { kind: "item"; instanceId: string }
  | { kind: "group"; index: number }
  | { kind: "ally"; id: string }
  | { kind: "back" };
export type MenuEntry = { label: string; disabled: boolean; choice: Choice };

/**
 * オート中・入力が揃った（ready。flee が 1 件あれば pending が残っていても真）・入力待ちが無ければ null。
 * それ以外は pending の先頭の command
 */
export function firstCursor(menu: BattleMenu): InputCursor | null {
  if (menu.auto || menu.ready) return null;
  const id = menu.pending[0];
  return id === undefined ? null : { memberId: id, stage: "command", pick: null };
}

/** 並び順で prev の後ろにいる入力待ちのメンバー、無ければ pending の先頭、それも無ければ null（オート中・ready も null） */
export function nextCursor(menu: BattleMenu, prevMemberId: string): InputCursor | null {
  if (menu.auto || menu.ready) return null;
  const order = menu.members.map((m) => m.id);
  const pi = order.indexOf(prevMemberId);
  const id = menu.pending.find((p) => order.indexOf(p) > pi) ?? menu.pending[0];
  return id === undefined ? null : { memberId: id, stage: "command", pick: null };
}

/** 対象の一覧（と敵の列）に付ける番号。体数が 1 以上のグループを添字順に 1 から数える。体数 0 や範囲外は null */
export function targetNumber(groups: BattleMenu["groups"], index: number): number | null {
  let n = 0;
  for (const g of groups) {
    if (g.count <= 0) continue;
    n++;
    if (g.index === index) return n;
  }
  return null;
}

function memberOf(menu: BattleMenu, id: string): BattleMenuMember | undefined {
  return menu.members.find((m) => m.id === id);
}

/** 並び順で id より前にいる、行動可能なメンバーのうち最も近い者（入力済みでもよい） */
function prevActable(menu: BattleMenu, id: string): BattleMenuMember | null {
  const i = menu.members.findIndex((m) => m.id === id);
  for (let k = i - 1; k >= 0; k--) {
    const m = menu.members[k];
    if (m !== undefined && m.canAct) return m;
  }
  return null;
}

const COMMANDS = ["attack", "spell", "defend", "item", "flee", "auto", "back"] as const;
type Cmd = (typeof COMMANDS)[number];

function commandDisabled(menu: BattleMenu, m: BattleMenuMember, cmd: Cmd): boolean {
  switch (cmd) {
    case "spell":
      return m.spells.length === 0;
    case "item":
      return m.items.length === 0;
    case "flee":
      return !menu.canFlee;
    case "back":
      return prevActable(menu, m.id) === null;
    default:
      return false;
  }
}

/** 今の段階の選択肢。cursor のメンバーが見つからなければ [] */
export function entries(menu: BattleMenu, cursor: InputCursor, strings: Strings): MenuEntry[] {
  const s = (key: string, params?: Record<string, string | number>): string => formatMessage(strings[key] ?? key, params);
  const m = memberOf(menu, cursor.memberId);
  if (m === undefined) return [];
  const back: MenuEntry = { label: s("common.back"), disabled: false, choice: { kind: "back" } };
  switch (cursor.stage) {
    case "command":
      return COMMANDS.map((cmd) => ({
        label: s(cmd === "back" ? "common.back" : `battle.cmd.${cmd}`),
        disabled: commandDisabled(menu, m, cmd),
        choice: { kind: "cmd", cmd },
      }));
    case "spell":
      return [
        ...m.spells.map(
          (sp): MenuEntry => ({
            label: s("battle.spellRow", { name: sp.name, mp: sp.mp }),
            disabled: !sp.usable,
            choice: { kind: "spell", spellId: sp.spellId },
          }),
        ),
        back,
      ];
    case "item":
      return [
        ...m.items.map((it): MenuEntry => ({ label: it.name, disabled: false, choice: { kind: "item", instanceId: it.instanceId } })),
        back,
      ];
    case "enemy":
      return [
        ...menu.groups
          .filter((g) => g.count > 0)
          .map(
            (g): MenuEntry => ({
              label: s("battle.targetGroup", { n: targetNumber(menu.groups, g.index) ?? g.index + 1, name: g.name, count: g.count }),
              disabled: false,
              choice: { kind: "group", index: g.index },
            }),
          ),
        back,
      ];
    case "ally":
      return [
        ...menu.allies.map(
          (a): MenuEntry => ({
            label: s("battle.targetAlly", { name: a.name, hp: a.hp, hpMax: a.hpMax }),
            disabled: false,
            choice: { kind: "ally", id: a.id },
          }),
        ),
        back,
      ];
  }
}

/** 対象の種類 → 次の段階（enemy / ally）。対象を選ばない種類は null */
function targetStage(t: SpellTarget): "enemy" | "ally" | null {
  if (t === "enemy" || t === "enemyGroup") return "enemy";
  if (t === "ally") return "ally";
  return null;
}

function input(memberId: string, action: BattleAction): Command {
  return { type: "battle.input", memberId, action };
}

/** pick を target で送る Command（attack は enemy 側だけ） */
function sendPick(memberId: string, pick: Pick, target: BattleTarget): Command | null {
  switch (pick.kind) {
    case "attack":
      return target.side === "enemy" ? input(memberId, { type: "attack", group: target.group }) : null;
    case "cast":
      return input(memberId, { type: "cast", spellId: pick.spellId, target });
    case "item":
      return input(memberId, { type: "item", instanceId: pick.instanceId, target });
  }
}

export function step(menu: BattleMenu, cursor: InputCursor, choice: Choice): { cursor: InputCursor; send: Command | null } {
  const stay = { cursor, send: null };
  const m = memberOf(menu, cursor.memberId);
  if (m === undefined) return stay;
  const id = m.id;
  if (choice.kind === "back" || (choice.kind === "cmd" && choice.cmd === "back")) {
    if (choice.kind === "cmd" && cursor.stage !== "command") return stay;
    return { cursor: back(menu, cursor), send: null };
  }
  switch (cursor.stage) {
    case "command": {
      if (choice.kind !== "cmd" || commandDisabled(menu, m, choice.cmd)) return stay;
      switch (choice.cmd) {
        case "attack":
          return { cursor: { memberId: id, stage: "enemy", pick: { kind: "attack" } }, send: null };
        case "spell":
          return { cursor: { memberId: id, stage: "spell", pick: null }, send: null };
        case "item":
          return { cursor: { memberId: id, stage: "item", pick: null }, send: null };
        case "defend":
          return { cursor, send: input(id, { type: "defend" }) };
        case "flee":
          return { cursor, send: input(id, { type: "flee" }) };
        case "auto":
          return { cursor, send: { type: "battle.auto", on: true } };
        case "back":
          return stay; // 上で処理済み
      }
    }
    case "spell": {
      if (choice.kind !== "spell") return stay;
      const sp = m.spells.find((x) => x.spellId === choice.spellId);
      if (sp === undefined || !sp.usable) return stay;
      const pick: Pick = { kind: "cast", spellId: sp.spellId };
      const next = targetStage(sp.target);
      if (next !== null) return { cursor: { memberId: id, stage: next, pick }, send: null };
      return { cursor, send: sendPick(id, pick, { side: "none" }) };
    }
    case "item": {
      if (choice.kind !== "item") return stay;
      const it = m.items.find((x) => x.instanceId === choice.instanceId);
      if (it === undefined) return stay;
      const pick: Pick = { kind: "item", instanceId: it.instanceId };
      const next = targetStage(it.target);
      if (next !== null) return { cursor: { memberId: id, stage: next, pick }, send: null };
      return { cursor, send: sendPick(id, pick, { side: "none" }) };
    }
    case "enemy": {
      if (choice.kind !== "group" || cursor.pick === null) return stay;
      const g = menu.groups.find((x) => x.index === choice.index);
      if (g === undefined || g.count <= 0) return stay;
      const send = sendPick(id, cursor.pick, { side: "enemy", group: g.index });
      return send === null ? stay : { cursor, send };
    }
    case "ally": {
      if (choice.kind !== "ally" || cursor.pick === null) return stay;
      if (!menu.allies.some((a) => a.id === choice.id)) return stay;
      const send = sendPick(id, cursor.pick, { side: "ally", memberId: choice.id });
      return send === null ? stay : { cursor, send };
    }
  }
}

/**
 * 戻る。enemy / ally → 親（攻撃なら command、呪文なら spell、道具なら item）、spell / item → command、
 * command → 並び順で前の行動可能なメンバーの command（入力済みでも選び直せる。core は再入力を上書きで受ける）。先頭では不変
 */
export function back(menu: BattleMenu, cursor: InputCursor): InputCursor {
  const id = cursor.memberId;
  switch (cursor.stage) {
    case "enemy":
    case "ally": {
      const p = cursor.pick;
      if (p !== null && p.kind === "cast") return { memberId: id, stage: "spell", pick: null };
      if (p !== null && p.kind === "item") return { memberId: id, stage: "item", pick: null };
      return { memberId: id, stage: "command", pick: null };
    }
    case "spell":
    case "item":
      return { memberId: id, stage: "command", pick: null };
    case "command": {
      const prev = prevActable(menu, id);
      return prev === null ? cursor : { memberId: prev.id, stage: "command", pick: null };
    }
  }
}
