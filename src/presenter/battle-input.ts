// UI-54 / CB-10〜12: 戦闘のコマンド入力の段階（party → member → spell / item → 対象 → 次のメンバー、戻る）。純粋な状態機械で、DOM に触れない。
// 行動できるか・使えるか・揃ったかは core の battleMenu（BattleMenu）の値だけで知る（UI-35、§3-4）。ここは判定しない。
// - party はラウンドの始めのパーティの選択（2 列 × 2 段: 戦う・前回と同じ / 逃げる・オート）。前回と同じは battle.repeat、
//   逃げるは battle.flee、オートは battle.auto on を送る。戦うで先頭の行動可能なメンバーの member へ。
// - member は 5 枠（上段 攻撃・呪文・防御・道具、下段の右端 戻る）。戻るは並び順で前の行動可能なメンバー、先頭なら party。
//   攻撃は canStrike が偽なら dim で「攻撃(届かず)」（M16。CB-13）。押すと理由（reason: battle.reason.noReach）を窓に出す（M18。設計 4-6）。
// - 入力の問い（ヘッダー）は battlePrompt。member の段は core の row で「{name}（前衛 / 後衛）は？」（M18。設計 4-6 / D1）。
// - spell / item / enemy / ally は一覧で、末尾が「戻る」（親の段へ）。enemy / ally は注目（focus。一覧の添字）を持つ。
// - UI-68（M10）/ U4: 呪文を選ぶと、対象を選ぶ呪文（enemy / enemyGroup / ally）は対象の段へ、対象を選ばない呪文（allEnemies / party / self / none）と、
//   体数 1 以上の敵グループが 1 つだけのときの敵の呪文は確認の段 spellConfirm（[唱える][戻る]）へ進む（説明を読む 1 タップ。対象の有無で手数を揃える）。
//   説明を出す段は spellNote が返す（呪文の対象の段と確認の段）。確認の段の戻るは呪文の一覧。
//   唱えられない（MP 不足で dim の）呪文の行は peek で、押すと確認の段で説明だけ見せる（唱えるは dim。2026-10-07。キャンプと同じ）。
// - 体数 1 以上の敵グループが 1 つだけなら enemy の段を飛ばしてそのグループを送る。enemy / ally の段の初期の注目は、
//   並び順で 1 つ前の行動可能なメンバーの入力の対象（今も選べるとき）。無ければ 0。
// - step は選択を受けて次の cursor と、送る Command（無ければ null）を返す。送るときの cursor は元のまま
//   （rejected なら呼び出し側はそのまま描き直し、受け付けられたら nextCursor / firstCursor で次へ進む）。
// - 押せない（disabled）選択や、段階に合わない選択は cursor 不変・send null。
import type { SpellTarget, Strings } from "../core/data/index";
import type { BattleAction, BattleMenu, BattleMenuMember, BattleTarget, Command } from "../core/types";
import { formatMessage } from "./views/message";

export type InputStage = "party" | "member" | "spell" | "item" | "enemy" | "ally" | "spellConfirm";
export type Pick = { kind: "attack" } | { kind: "cast"; spellId: string } | { kind: "item"; instanceId: string };
export type InputCursor =
  | { stage: "party" }
  | { stage: "member" | "spell" | "item"; memberId: string }
  /** UI-68（M10）: 呪文の確認の段（説明を窓に出し、[唱える][戻る]） */
  | { stage: "spellConfirm"; memberId: string; spellId: string }
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
  /** UI-68（M10）: 確認の段の「唱える」 */
  | { kind: "castConfirm" }
  | { kind: "back" };
/**
 * peek: dim でも押せば選ぶ行（UI-68。唱えられない呪文の説明を見る。キャンプの CampEntry の peek と同じ）。
 * reason: dim の行を押したときに窓に出す理由の文（UI-54。M18 設計 4-6。届かない攻撃）。peek とは併せない
 */
export type MenuEntry = { label: string; disabled: boolean; choice: Choice; peek?: boolean; reason?: string };

/** UI-66（2026-10-07）: 戻るの意味の選択肢か（メンバーの枠の「戻る」と、一覧の末尾の戻る。取り消しの音を鳴らす項目） */
export function isBackChoice(c: Choice): boolean {
  return c.kind === "back" || (c.kind === "member" && c.cmd === "back");
}

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

/**
 * UI-54: 対象の一覧の敵の行（battle.targetGroup「{n}. {name} {count}体」。番号は targetNumber）。
 * M18（設計 5-12）: 2-5 の丸数字（battle.groupNo）はやめて数字に戻した（絵の左上の番号の札と同じ数）
 */
function targetGroupLabel(menu: BattleMenu, g: BattleMenu["groups"][number], strings: Strings): string {
  const n = targetNumber(menu.groups, g.index) ?? g.index + 1;
  return formatMessage(strings["battle.targetGroup"] ?? "battle.targetGroup", { n, name: g.name, count: g.count });
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

/** CB-02: 逃げられない戦闘の逃げる。CB-12/40（M16）: core の canRepeat が偽なら前回と同じ */
function partyDisabled(menu: BattleMenu, cmd: PartyCmd): boolean {
  if (cmd === "flee") return !menu.canFlee;
  if (cmd === "repeat") return !menu.canRepeat;
  return false;
}

/**
 * UI-54 / CB-13（M16。2026-10-11 の設計 2-5）: 攻撃は core の canStrike が偽（後衛で届かない）なら dim（表示では選べない。core は受け付けて防御に置き換える）
 */
function memberDisabled(m: BattleMenuMember, cmd: MemberCmd): boolean {
  if (cmd === "attack") return !m.canStrike;
  if (cmd === "spell") return m.spells.length === 0;
  if (cmd === "item") return m.items.length === 0;
  return false;
}

/**
 * UI-54 / CB-12（M20。設計 D-2）: 呪文・道具の dim の理由の文のキー。core の spellBlock / itemBlock をキーに写すだけ（判定はしない）。
 * 理由が無ければ null
 */
function blockReason(m: BattleMenuMember, cmd: MemberCmd): string | null {
  if (cmd === "spell" && m.spellBlock !== null) return m.spellBlock === "none" ? "battle.reason.spellNone" : "battle.reason.spellUnusable";
  if (cmd === "item" && m.itemBlock !== null) return m.itemBlock === "none" ? "battle.reason.itemNone" : "battle.reason.itemFieldOnly";
  return null;
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
    // UI-54 / CB-12（M18。設計 2-6）: core の canRepeat が偽なら「前回と同じ」は出さない（dim にせず一覧から外し、後ろを詰める）
    return PARTY_CMDS.filter((cmd) => cmd !== "repeat" || menu.canRepeat).map((cmd) => ({
      // CB-50b: 逃げるは core の fleePercent を添える（dim のときも出す）
      label: cmd === "flee" ? s("battle.cmd.fleeRate", { rate: menu.fleePercent }) : s(`battle.cmd.${cmd}`),
      disabled: partyDisabled(menu, cmd),
      choice: { kind: "party", cmd },
    }));
  }
  const m = memberOf(menu, cursor.memberId);
  if (m === undefined) return [];
  const back: MenuEntry = { label: s("common.back"), disabled: false, choice: { kind: "back" } };
  switch (cursor.stage) {
    case "member":
      return MEMBER_CMDS.map((cmd): MenuEntry => {
        const noReach = cmd === "attack" && !m.canStrike;
        const reason = noReach ? "battle.reason.noReach" : blockReason(m, cmd);
        return {
          // UI-54 / CB-13: 届かない者の攻撃は「攻撃(届かず)」（battle.cmd.attackNoReach。56px の枠に収まる 48px）
          label: s(cmd === "back" ? "common.back" : noReach ? "battle.cmd.attackNoReach" : `battle.cmd.${cmd}`),
          disabled: memberDisabled(m, cmd),
          choice: { kind: "member", cmd },
          // UI-54（M18。設計 4-6）: 押すと理由を窓に出す（段は変えない。送らない）。M20（D-2）: 呪文・道具の dim も core の spellBlock / itemBlock で理由を出す
          ...(reason !== null ? { reason: s(reason) } : {}),
        };
      });
    case "spell":
      return [
        ...m.spells.map(
          (sp): MenuEntry => ({
            label: s("battle.spellRow", { name: sp.name, mp: sp.mp }),
            disabled: !sp.usable,
            choice: { kind: "spell", spellId: sp.spellId },
            ...(sp.usable ? {} : { peek: true }),
          }),
        ),
        back,
      ];
    case "spellConfirm": {
      // UI-68（2026-10-07）: 唱えられない（MP 不足の）呪文の確認の段は説明だけで、唱えるは dim
      const sp = m.spells.find((x) => x.spellId === cursor.spellId);
      return [{ label: s("spell.info.cast"), disabled: sp === undefined || !sp.usable, choice: { kind: "castConfirm" } }, back];
    }
    case "item":
      return [
        ...m.items.map((it): MenuEntry => ({ label: it.name, disabled: false, choice: { kind: "item", instanceId: it.instanceId } })),
        back,
      ];
    case "enemy":
      return [
        ...liveGroups(menu).map(
          (g): MenuEntry => ({
            label: targetGroupLabel(menu, g, strings),
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

/**
 * UI-54: 入力の問い（ヘッダーの文）。strings `battle.prompt.<stage>` に名前を差し込む。
 * member の段は core の BattleMenuMember.row の表記（battle.row.front / back）も差し込む（M18。設計 4-6 / D1）。判定はしない
 */
export function battlePrompt(menu: BattleMenu, cursor: InputCursor, strings: Strings): string {
  const m = cursor.stage === "party" ? undefined : memberOf(menu, cursor.memberId);
  const row = m === undefined ? "" : (strings[`battle.row.${m.row}`] ?? `battle.row.${m.row}`);
  return formatMessage(strings[`battle.prompt.${cursor.stage}`] ?? `battle.prompt.${cursor.stage}`, { name: m?.name ?? "", row });
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
      if (sp === undefined) return stay;
      // UI-68（2026-10-07）: 唱えられない（MP 不足の）呪文は送らず、確認の段で説明だけ見せる（唱えるは dim。キャンプの peek と同じ）
      if (!sp.usable) return { cursor: { stage: "spellConfirm", memberId: id, spellId: sp.spellId }, send: null };
      const next = targetStage(sp.target);
      // UI-68 / U4: 対象の段を飛ばす（対象なし・敵グループが 1 つだけの敵の呪文）ときは確認の段で説明を見せる
      if (next === null || (next === "enemy" && liveGroups(menu).length === 1)) {
        return { cursor: { stage: "spellConfirm", memberId: id, spellId: sp.spellId }, send: null };
      }
      return toTarget(menu, cursor, id, { kind: "cast", spellId: sp.spellId }, next);
    }
    case "spellConfirm": {
      if (choice.kind !== "castConfirm") return stay;
      const sp = m.spells.find((x) => x.spellId === cursor.spellId);
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
    case "spellConfirm":
      return { stage: "spell", memberId: cursor.memberId };
    case "spell":
    case "item":
      return { stage: "member", memberId: cursor.memberId };
    case "member": {
      const prev = prevActable(menu, cursor.memberId);
      return prev === null ? { stage: "party" } : { stage: "member", memberId: prev.id };
    }
  }
}

/**
 * UI-68（M10）: 呪文の説明を窓に出す段なら、その者と呪文（確認の段と、呪文の対象の段）。それ以外（一覧に戻った・攻撃・道具）は null。
 * 説明の値は core の spellInfo（呼ぶのは app）
 */
export function spellNote(cursor: InputCursor): { memberId: string; spellId: string } | null {
  if (cursor.stage === "spellConfirm") return { memberId: cursor.memberId, spellId: cursor.spellId };
  if ((cursor.stage === "enemy" || cursor.stage === "ally") && cursor.pick.kind === "cast") return { memberId: cursor.memberId, spellId: cursor.pick.spellId };
  return null;
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

/**
 * CB-47 / UI-57（M21）: 設定「オートの呪文」を core の command に乗せる。battle.auto の ON と battle.repeat にだけ spells を足す
 * （battle.auto off・ほかの command はそのまま）。判定は core（表示層は値を運ぶだけ）
 */
export function withAutoSpells(cmd: Command, spells: boolean): Command {
  if (cmd.type === "battle.auto" && cmd.on) return { ...cmd, spells };
  if (cmd.type === "battle.repeat") return { ...cmd, spells };
  return cmd;
}
