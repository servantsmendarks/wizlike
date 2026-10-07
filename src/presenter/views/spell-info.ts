// UI-68（M10）: 呪文の説明の行（キャラクター画面の呪文の段と、戦闘の呪文の一覧の後の段で共通）。
// 値は core の spellInfo の値だけ（UI-35。mp は唱える者の消費）。ここは文字列を組むだけの純粋な部分で、DOM に触れない。
// 行は 1. 見出し（spell.info.head{name, mp}）2. 対象（spell.info.target{v}。v は spell.target.{target}）
// 3. 場面（spell.info.scene{v}。v は spell.usableIn.{usableIn}）4. 効果の文（spells.json の description）。
import type { Strings } from "../../core/data/index";
import type { SpellInfo } from "../../core/types";
import { formatMessage } from "./message";

function s(strings: Strings, key: string, params?: Record<string, string | number>): string {
  return formatMessage(strings[key] ?? key, params);
}

/** 4 行（見出し・対象・場面・効果の文）。効果の文は切らない（折り返しは描く側。キャラクター画面は chunkDescription、窓は幅で折り返す） */
export function formatSpellInfo(info: SpellInfo, strings: Strings): [head: string, target: string, scene: string, description: string] {
  return [
    s(strings, "spell.info.head", { name: info.name, mp: info.mp }),
    s(strings, "spell.info.target", { v: s(strings, `spell.target.${info.target}`) }),
    s(strings, "spell.info.scene", { v: s(strings, `spell.usableIn.${info.usableIn}`) }),
    info.description,
  ];
}
