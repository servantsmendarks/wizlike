// data/*.json の読み込み口。JSON の値そのものは import しない（呼び出し側が RawGameData として渡す）。

import type { GameData, RawGameData } from "./types";
import { validateGameData } from "./validate";

export * from "./types";

const MESSAGE_HEAD = 10;

/** data/*.json の検証に失敗した。issues に全件が入る。 */
export class GameDataError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    const head = issues.slice(0, MESSAGE_HEAD).map((s) => `  - ${s}`);
    const more = issues.length > MESSAGE_HEAD ? [`  ... and ${issues.length - MESSAGE_HEAD} more`] : [];
    super([`invalid game data: ${issues.length} issue(s)`, ...head, ...more].join("\n"));
    this.name = "GameDataError";
    this.issues = Object.freeze([...issues]);
  }
}

/**
 * 生データを検証して GameData として返す。全ファイルの問題をすべて集めてから、
 * 1 件でもあれば GameDataError を投げる。返す値は raw の各値そのもの（コピーしない）。
 */
export function loadGameData(raw: RawGameData): GameData {
  const issues = validateGameData(raw);
  if (issues.length > 0) throw new GameDataError(issues);
  return raw as unknown as GameData;
}
