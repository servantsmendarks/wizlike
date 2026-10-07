// SV-30 / SV-33: 書き出しファイルの組み立てと検査（src/save/sha256.ts・transfer.ts。純粋）。
import { describe, expect, test } from "vitest";
import type { GameState } from "../src/core/types";
import { sha256Hex } from "../src/save/sha256";
import { buildExportFile, EXPORT_FORMAT, parseExportFile, serializeExportFile, stateChecksum } from "../src/save/transfer";
import { dived } from "./helpers/battle";
import { data, newGame } from "./helpers/core";
import { toV3 } from "./helpers/save";

const SCHEMA = data.config.save.schemaVersion;

function json<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

/** ファイルの中身を JSON で組む（欄を差し替えて壊すため。checksum は over に無ければ state から作り直す） */
function fileText(over: Record<string, unknown> = {}, state: unknown = json(newGame(1))): string {
  const base: Record<string, unknown> = {
    format: EXPORT_FORMAT,
    gameId: "g1",
    schemaVersion: SCHEMA,
    turn: 3,
    exportedAt: 1234,
    state,
    checksum: stateChecksum(state),
  };
  return JSON.stringify({ ...base, ...over });
}

/** 今の state から M5.5 の欄と M7 の morale を消した v1 の形（save.test.ts の toV1 と同じ） */
function toV1(s: GameState): Record<string, unknown> {
  const v1 = toV3(s); // M7 の B（v4）の欄も消す
  delete v1["morale"]; // M7（v3）の欄
  delete v1["adventureTurns"];
  delete v1["tavernEventMark"];
  const dive = v1["dive"] as Record<string, unknown> | null;
  if (dive !== null) delete dive["knownTraps"];
  return v1;
}

async function subtleHex(s: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("SV-30 sha256Hex", () => {
  test("SV-30 sha256Hex: 既知の値（FIPS 180-4 の例）", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  test("SV-30 sha256Hex: 55・56・64・119 バイト（パディングの境）・日本語・state の JSON で crypto.subtle.digest と一致", async () => {
    const cases = [
      "a".repeat(55),
      "a".repeat(56),
      "a".repeat(63),
      "a".repeat(64),
      "a".repeat(119),
      "a".repeat(120),
      "卓上の迷宮（仮題）・灰",
      JSON.stringify(newGame(1)),
    ];
    for (const s of cases) expect(sha256Hex(s), s.slice(0, 20)).toBe(await subtleHex(s));
  });
});

describe("SV-30 書き出しファイル", () => {
  test("SV-30 buildExportFile / serializeExportFile: 欄の順が format, gameId, schemaVersion, turn, exportedAt, state, checksum で、checksum = sha256Hex(JSON.stringify(state))", () => {
    const s = newGame(1);
    const f = buildExportFile({ gameId: "g1", schemaVersion: SCHEMA, turn: 3, state: s }, 5555);
    expect(f.state).toBe(s); // 複製しない
    expect(f.checksum).toBe(sha256Hex(JSON.stringify(s)));
    expect(f.checksum).toMatch(/^[0-9a-f]{64}$/);
    const text = serializeExportFile(f);
    expect(text).not.toContain("\n"); // 字下げなし
    // 欄の順を崩した入力でも、出力の順は固定
    const shuffled = { checksum: f.checksum, state: f.state, exportedAt: f.exportedAt, turn: f.turn, schemaVersion: f.schemaVersion, gameId: f.gameId, format: f.format };
    for (const t of [text, serializeExportFile(shuffled)]) {
      expect(Object.keys(JSON.parse(t) as object)).toEqual(["format", "gameId", "schemaVersion", "turn", "exportedAt", "state", "checksum"]);
    }
    expect(JSON.parse(text)).toMatchObject({ format: "wizlike-save", gameId: "g1", schemaVersion: SCHEMA, turn: 3, exportedAt: 5555 });
  });
});

describe("SV-33 parseExportFile", () => {
  test("SV-33 parseExportFile: 書き出したものはそのまま読め、state が等しい（JSON 往復）。字下げして整形したファイルも通る", () => {
    for (const s of [newGame(1), dived(2)]) {
      const f = buildExportFile({ gameId: "abc", schemaVersion: SCHEMA, turn: 9, state: s }, 777);
      const r = parseExportFile(serializeExportFile(f), SCHEMA);
      expect(r).toEqual({ ok: true, gameId: "abc", turn: 9, exportedAt: 777, state: json(s), fromVersion: SCHEMA });
      const pretty = parseExportFile(JSON.stringify(JSON.parse(serializeExportFile(f)), null, 2), SCHEMA);
      expect(pretty.ok).toBe(true);
    }
  });

  test("SV-33 parseExportFile: JSON でない・配列・format 違いは format、欄の型違いは broken", () => {
    for (const t of ["", "{", "not json", "[]", "null", "3", '"x"', fileText({ format: "other" }), fileText({ format: undefined })]) {
      expect(parseExportFile(t, SCHEMA), t.slice(0, 30)).toEqual({ ok: false, reason: "format" });
    }
    const broken: Record<string, unknown>[] = [
      { gameId: "" },
      { gameId: 1 },
      { gameId: "x".repeat(65) },
      { turn: 0 },
      { turn: 1.5 },
      { turn: "3" },
      { schemaVersion: 1.5 },
      { schemaVersion: 0 },
      { exportedAt: "NaN" },
      { exportedAt: null },
      { state: [] },
      { state: null },
      { checksum: "a".repeat(63) },
      { checksum: "A".repeat(64) },
      { checksum: 1 },
    ];
    for (const over of broken) expect(parseExportFile(fileText(over), SCHEMA), JSON.stringify(over)).toEqual({ ok: false, reason: "broken" });
  });

  test("SV-33 parseExportFile: schemaVersion が今より新しければ checksum が合わなくても tooNew", () => {
    expect(parseExportFile(fileText({ schemaVersion: SCHEMA + 1 }), SCHEMA)).toEqual({ ok: false, reason: "tooNew" });
    expect(parseExportFile(fileText({ schemaVersion: SCHEMA + 1, checksum: "0".repeat(64) }), SCHEMA)).toEqual({ ok: false, reason: "tooNew" });
  });

  test("SV-33 parseExportFile: state の値を 1 つ変えると checksum", () => {
    const s = json(newGame(1));
    const sum = stateChecksum(s);
    const changed = { ...s, gold: s.gold + 1 };
    expect(parseExportFile(fileText({ checksum: sum }, changed), SCHEMA)).toEqual({ ok: false, reason: "checksum" });
    expect(parseExportFile(fileText({ checksum: sum }, s), SCHEMA).ok).toBe(true);
  });

  test("SV-33/SV-04 parseExportFile: v1 の state（adventureTurns 無し）のファイルは今の版（v6）へ移行して通り、形の検査に落ちる state（party 空）は broken", () => {
    expect(SCHEMA).toBe(6); // M10（CH-63）で 4 → 5、M11（CB-60）で 5 → 6
    const v1 = toV1(newGame(1));
    const r = parseExportFile(fileText({ schemaVersion: 1 }, v1), SCHEMA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fromVersion).toBe(1);
    expect(r.state.adventureTurns).toBe(0);
    expect(r.state.tavernEventMark).toBe(0);
    expect(r.state.morale).toBeNull();
    const bad = { ...json(newGame(1)), party: [] };
    expect(parseExportFile(fileText({}, bad), SCHEMA)).toEqual({ ok: false, reason: "broken" });
    // v1 として出しても v2 の欄が無いだけでは broken にならないが、party 空は v1 でも broken
    expect(parseExportFile(fileText({ schemaVersion: 1 }, { ...v1, party: [] }), SCHEMA)).toEqual({ ok: false, reason: "broken" });
  });
});
