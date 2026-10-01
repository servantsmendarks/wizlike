// UI-54 / CB-10〜12: 戦闘のコマンド入力の段階（party → member → spell / item → 対象 → 次のメンバー、戻る）。純粋な状態機械で、DOM に触れない。
// 行動できるか・使えるか・揃ったかは core の battleMenu（BattleMenu）の値だけで知る（UI-35、§3-4）。ここは判定しない。
// - party はラウンドの始めのパーティの選択（2 列 × 2 段: 戦う・前回と同じ / 逃げる・オート）。前回と同じは battle.repeat、
//   逃げるは battle.flee、オートは battle.auto on を送る。戦うで先頭の行動可能なメンバーの member へ。
// - member は 5 枠（上段 攻撃・呪文・防御・道具、下段の右端 戻る）。戻るは並び順で前の行動可能なメンバー、先頭なら party。
// - spell / item / enemy / ally は一覧で、末尾が「戻る」（親の段へ）。enemy / ally は注目（focus。一覧の添字）を持つ。
// - 体数 1 以上の敵グループが 1 つだけなら enemy の段を飛ばしてそのグループを送る。enemy / ally の段の初期の注目は、
//   並び順で 1 つ前の行動可能なメンバーの入力の対象（今も選べるとき）。無ければ 0。
// - step は選択を受けて次の cursor と、送る Command（無ければ null）を返す。送るときの cursor は元のまま
//   （rejected なら呼び出し側はそのまま描き直し、受け付けられたら nextCursor / firstCursor で次へ進む）。
// - 押せない（disabled）選択や、段階に合わない選択は cursor 不変・send null。
import type { SpellTarget, Strings } from "../core/data/index";
import type { BattleAction, BattleMenu, BattleMenuMember, BattleTarget, Command } from "../core/types";
import { formatMessage } from "./views/message";

export type InputStage = "party" | "member" | "spell" | "item" | "enemy" | "ally";
export type Pick = { kind: "attack" } | { kind: "cast"; spellId: string } | { kind: "item"; instanceId: string };
export type InputCursor =
  | { stage: "party" }
  | { stage: "member" | "spell" | "item"; memberId: string }
  /** focus は一覧（末尾の戻るを含む）の添字 */
  | { stage: "enemy" | "ally"; memberId: string; pick: Pick; focus: number };
export type PartyCmd = "fight" | "repeat" | "flee" | "auto";
export type MemberCmd = "attack" | "spell" | "defend" | "item" | "back";
export type Choice =
  | { kind: "party"; cmd: PartyCmd }
  | { kind: "member"; cmd: MemberCmd }
  | { kind: "spell"; spellId: string }
  | { kind: "item"; instanceId: string }
  | { kind: "group"; index: number }
  | { kind: "ally"; id: string }
  | { kind: "back" };
export type MenuEntry = { label: string; disabled: boolean; choice: Choice };

const PARTY_CMDS: readonly PartyCmd[] = ["fight", "repeat", "flee", "auto"];
const MEMBER_CMDS: readonly MemberCmd[] = ["attack", "spell", "defend", "item", "back"];

/** オート中・入力が揃った（ready）・入力待ちが無ければ null。それ以外はパーティの選択 */
export function firstCursor(menu: BattleMenu): InputCursor | null {
  if (menu.auto || menu.ready || menu.pending.length === 0) return null;
  return { stage: "party" };
}

/** 並び順で prev の後ろにいる入力待ちのメンバー、無ければ pending の先頭、それも無ければ null（オート中・ready も null） */
export function nextCursor(menu: BattleMenu, prevMemberId: string): InputCursor | null {
  if (menu.auto || menu.ready) return null;
  const order = menu.members.map((m) => m.id);
  const pi = order.indexOf(prevMemberId);
  const id = menu.pending.find((p) => order.indexOf(p) > pi) ?? menu.pending[0];
  return id === undefined ? null : { stage: "member", memberId: id };
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

/** 体数 1 以上のグループ（添字順） */
function liveGroups(menu: BattleMenu): BattleMenu["groups"] {
  return menu.groups.filter((g) => g.count > 0);
}

function partyDisabled(menu: BattleMenu, cmd: PartyCmd): boolean {
  return cmd === "flee" && !menu.canFlee;
}

function memberDisabled(m: BattleMenuMember, cmd: MemberCmd): boolean {
  if (cmd === "spell") return m.spells.length === 0;
  if (cmd === "item") return m.items.length === 0;
  return false;
}

/** enemy / ally の段の選択肢（文言なし。末尾は戻る） */
function targetChoices(menu: BattleMenu, stage: "enemy" | "ally"): Choice[] {
  const rows: Choice[] =
    stage === "enemy"
      ? liveGroups(menu).map((g): Choice => ({ kind: "group", index: g.index }))
      : menu.allies.map((a): Choice => ({ kind: "ally", id: a.id }));
  return [...rows, { kind: "back" }];
}

/** 入力の対象（attack は敵のグループ、cast / item は target） */
function targetOf(a: BattleAction | null): BattleTarget | null {
  if (a === null) return null;
  if (a.type === "attack") return { side: "enemy", group: a.group };
  if (a.type === "cast" || a.type === "item") return a.target;
  return null;
}

/** UI-54: enemy / ally の段の初期の注目。1 つ前の行動可能なメンバーの入力の対象が今も選べればその添字、無ければ 0 */
function initialFocus(menu: BattleMenu, memberId: string, stage: "enemy" | "ally"): number {
  const t = targetOf(prevActable(menu, memberId)?.input ?? null);
  if (t === null) return 0;
  const cs = targetChoices(menu, stage);
  let i = -1;
  if (stage === "enemy" && t.side === "enemy") i = cs.findIndex((c) => c.kind === "group" && c.index === t.group);
  if (stage === "ally" && t.side === "ally") i = cs.findIndex((c) => c.kind === "ally" && c.id === t.memberId);
  return i < 0 ? 0 : i;
}

/** 今の段階の選択肢。cursor のメンバーが見つからなければ []（party はメンバーに依らない） */
export function entries(menu: BattleMenu, cursor: InputCursor, strings: Strings): MenuEntry[] {
  const s = (key: string, params?: Record<string, string | number>): string => formatMessage(strings[key] ?? key, params);
  if (cursor.stage === "party") {
    return PARTY_CMDS.map((cmd) => ({ label: s(`battle.cmd.${cmd}`), disabled: partyDisabled(menu, cmd), choice: { kind: "party", cmd } }));
  }
  const m = memberOf(menu, cursor.memberId);
  if (m === undefined) return [];
  const back: MenuEntry = { label: s("common.back"), disabled: false, choice: { kind: "back" } };
  switch (cursor.stage) {
    case "member":
      return MEMBER_CMDS.map((cmd) => ({
        label: s(cmd === "back" ? "common.back" : `battle.cmd.${cmd}`),
        disabled: memberDisabled(m, cmd),
        choice: { kind: "member", cmd },
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
        ...liveGroups(menu).map(
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

/**
 * pick の対象の段へ進む。enemy で体数 1 以上のグループがちょうど 1 つなら段を飛ばしてそのグループを送る（UI-54 / W5）。
 * stay は送るときの cursor（元のまま）
 */
function toTarget(
  menu: BattleMenu,
  stay: InputCursor,
  memberId: string,
  pick: Pick,
  stage: "enemy" | "ally",
): { cursor: InputCursor; send: Command | null } {
  if (stage === "enemy") {
    const live = liveGroups(menu);
    const only = live.length === 1 ? live[0] : undefined;
    if (only !== undefined) {
      const send = sendPick(memberId, pick, { side: "enemy", group: only.index });
      if (send !== null) return { cursor: stay, send };
    }
  }
  return { cursor: { stage, memberId, pick, focus: initialFocus(menu, memberId, stage) }, send: null };
}

export function step(menu: BattleMenu, cursor: InputCursor, choice: Choice): { cursor: InputCursor; send: Command | null } {
  const stay = { cursor, send: null };
  if (cursor.stage === "party") {
    if (choice.kind !== "party" || partyDisabled(menu, choice.cmd)) return stay;
    switch (choice.cmd) {
      case "fight": {
        const first = menu.members.find((m) => m.canAct);
        return first === undefined ? stay : { cursor: { stage: "member", memberId: first.id }, send: null };
      }
      case "repeat":
        return { cursor, send: { type: "battle.repeat" } }; // CB-12/40
      case "flee":
        return { cursor, send: { type: "battle.flee" } }; // CB-12/50
      case "auto":
        return { cursor, send: { type: "battle.auto", on: true } };
    }
  }
  const m = memberOf(menu, cursor.memberId);
  if (m === undefined) return stay;
  const id = m.id;
  if (choice.kind === "back" || (choice.kind === "member" && choice.cmd === "back")) {
    if (choice.kind === "member" && cursor.stage !== "member") return stay;
    return { cursor: back(menu, cursor), send: null };
  }
  switch (cursor.stage) {
    case "member": {
      if (choice.kind !== "member" || memberDisabled(m, choice.cmd)) return stay;
      switch (choice.cmd) {
        case "attack":
          return toTarget(menu, cursor, id, { kind: "attack" }, "enemy");
        case "spell":
          return { cursor: { stage: "spell", memberId: id }, send: null };
        case "item":
          return { cursor: { stage: "item", memberId: id }, send: null };
        case "defend":
          return { cursor, send: input(id, { type: "defend" }) };
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
      if (next !== null) return toTarget(menu, cursor, id, pick, next);
      return { cursor, send: sendPick(id, pick, { side: "none" }) };
    }
    case "item": {
      if (choice.kind !== "item") return stay;
      const it = m.items.find((x) => x.instanceId === choice.instanceId);
      if (it === undefined) return stay;
      const pick: Pick = { kind: "item", instanceId: it.instanceId };
      const next = targetStage(it.target);
      if (next !== null) return toTarget(menu, cursor, id, pick, next);
      return { cursor, send: sendPick(id, pick, { side: "none" }) };
    }
    case "enemy": {
      if (choice.kind !== "group") return stay;
      const g = menu.groups.find((x) => x.index === choice.index);
      if (g === undefined || g.count <= 0) return stay;
      const send = sendPick(id, cursor.pick, { side: "enemy", group: g.index });
      return send === null ? stay : { cursor, send };
    }
    case "ally": {
      if (choice.kind !== "ally") return stay;
      if (!menu.allies.some((a) => a.id === choice.id)) return stay;
      const send = sendPick(id, cursor.pick, { side: "ally", memberId: choice.id });
      return send === null ? stay : { cursor, send };
    }
  }
}

/**
 * 戻る。enemy / ally → 親（攻撃なら member、呪文なら spell、道具なら item）、spell / item → member、
 * member → 並び順で前の行動可能なメンバーの member（入力済みでも選び直せる。core は再入力を上書きで受ける）。先頭では party。
 * party は不変
 */
export function back(menu: BattleMenu, cursor: InputCursor): InputCursor {
  switch (cursor.stage) {
    case "party":
      return cursor;
    case "enemy":
    case "ally": {
      const id = cursor.memberId;
      if (cursor.pick.kind === "cast") return { stage: "spell", memberId: id };
      if (cursor.pick.kind === "item") return { stage: "item", memberId: id };
      return { stage: "member", memberId: id };
    }
    case "spell":
    case "item":
      return { stage: "member", memberId: cursor.memberId };
    case "member": {
      const prev = prevActable(menu, cursor.memberId);
      return prev === null ? { stage: "party" } : { stage: "member", memberId: prev.id };
    }
  }
}

/** enemy / ally の段の選択肢の数（末尾の戻るを含む）。それ以外は 0 */
function focusLength(menu: BattleMenu, cursor: InputCursor): number {
  return cursor.stage === "enemy" || cursor.stage === "ally" ? targetChoices(menu, cursor.stage).length : 0;
}

/** enemy / ally の段で注目を index に置く（0..len-1 にクランプ）。それ以外の段は不変 */
export function setFocus(menu: BattleMenu, cursor: InputCursor, index: number): InputCursor {
  if (cursor.stage !== "enemy" && cursor.stage !== "ally") return cursor;
  const len = focusLength(menu, cursor);
  const focus = Math.max(0, Math.min(len - 1, Math.trunc(index)));
  return { ...cursor, focus };
}

/** enemy / ally の段で注目を上下に 1 つ動かす（端で止まる） */
export function moveFocus(menu: BattleMenu, cursor: InputCursor, delta: -1 | 1): InputCursor {
  if (cursor.stage !== "enemy" && cursor.stage !== "ally") return cursor;
  return setFocus(menu, cursor, cursor.focus + delta);
}

/** 注目している選択肢（enemy / ally の段だけ。それ以外は null） */
export function focusedChoice(menu: BattleMenu, cursor: InputCursor): Choice | null {
  if (cursor.stage !== "enemy" && cursor.stage !== "ally") return null;
  return targetChoices(menu, cursor.stage)[cursor.focus] ?? null;
}

/** enemy の段で注目がグループならその添字（ビューの枠に使う）。戻る・他の段は null */
export function focusedGroup(menu: BattleMenu, cursor: InputCursor): number | null {
  if (cursor.stage !== "enemy") return null;
  const c = focusedChoice(menu, cursor);
  return c !== null && c.kind === "group" ? c.index : null;
}
