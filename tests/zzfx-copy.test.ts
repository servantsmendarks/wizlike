// UI-65（M9.5）: 効果音の事前合成（worker の buildSfxSamples）が、今までの経路（ZzFX.js の ZZFX.buildSamples）と同じサンプルを作ること。
// ZzFX.js はモジュールの評価時に new AudioContext を作るので、このファイルだけ AudioContext を偽物にしてから動的 import する
// （vi.stubGlobal はファイルごと。ほかのテストに漏らさない）。@types/node は入れていないので node:fs は文字列の動的 import で読む。
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SfxData } from "../src/build/asset-types";
import { buildSfxSamples, sfxArgs, sfxRandomness, sfxRate, sfxSampleRate } from "../src/presenter/sfx-samples";
import { zzfxBuildSamples, zzfxSampleRate } from "../src/vendor/zzfx-1.3.2/build-samples.js";
import { data } from "./helpers/core";

const FS_MODULE = "node:fs";
const fs = (await import(/* @vite-ignore */ FS_MODULE)) as { readFileSync(p: URL, e: "utf8"): string };
const read = (path: string): string => fs.readFileSync(new URL(path, import.meta.url), "utf8");

type Vendor = typeof import("../src/vendor/zzfx-1.3.2/ZzFX.js");
let vendor: Vendor;
beforeAll(async () => {
  class StubAudioContext {}
  vi.stubGlobal("AudioContext", StubAudioContext);
  vendor = await import("../src/vendor/zzfx-1.3.2/ZzFX.js");
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** git に入っている効果音（data/audio.json の sfx.names の 26 個） */
const assets: SfxData[] = data.audio.sfx.names.map((n) => JSON.parse(read(`../assets/sfx/${n}.json`)) as SfxData);

/** ZzFX.js の書式で書かれた buildSamples の関数の本体（"buildSamples: function" から "return b; ..." の次の "    }," まで） */
function buildSamplesText(src: string): string {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((l) => l === "    buildSamples: function");
  const ret = lines.findIndex((l, i) => i > start && l.includes("return b; // return sample buffer"));
  if (start < 0 || ret < 0 || lines[ret + 1] !== "    },") throw new Error("buildSamples not found");
  return lines.slice(start, ret + 2).join("\n");
}

describe("UI-65 効果音の事前合成（M9.5）: ZzFX の buildSamples の写し", () => {
  it("UI-65 写し: build-samples.js の buildSamples の本体は ZzFX.js と 1 文字も違わない。volume 0.3・sampleRate 44100 も同じ", () => {
    const original = buildSamplesText(read("../src/vendor/zzfx-1.3.2/ZzFX.js"));
    const copy = buildSamplesText(read("../src/vendor/zzfx-1.3.2/build-samples.js"));
    expect(original.split("\n").length).toBeGreaterThan(100);
    expect(copy).toBe(original);
    expect(vendor.ZZFX.volume).toBe(0.3);
    expect(zzfxSampleRate).toBe(vendor.ZZFX.sampleRate);
    expect(sfxSampleRate).toBe(44100);
  });

  it("UI-65 写し: 26 個の効果音すべてで、写しと ZzFX.js の buildSamples は同じ引数（揺らぎを含む）・同じ乱数で同じサンプルを作る", () => {
    expect(assets).toHaveLength(26);
    for (const r of [0, 0.25, 0.5, 0.999]) {
      vi.spyOn(Math, "random").mockReturnValue(r);
      for (const s of assets) {
        const args = s.params.map((x) => x ?? undefined);
        expect(zzfxBuildSamples(...args), `${s.name} r=${r}`).toEqual(vendor.ZZFX.buildSamples(...args));
      }
      vi.restoreAllMocks();
    }
  });

  it("UI-65 事前合成: 26 個の効果音すべてで、保持するサンプル（buildSfxSamples）は今までの経路（ZZFX.buildSamples(null → undefined) を Float32Array にしたもの）で揺らぎが中央（乱数 0.5）のときと一致する", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    let total = 0;
    for (const s of assets) {
      const before = Float32Array.from(vendor.ZZFX.buildSamples(...s.params.map((x) => x ?? undefined)));
      const kept = buildSfxSamples(s.params);
      expect(kept.length, s.name).toBeGreaterThan(0);
      expect(kept, s.name).toEqual(before);
      total += kept.length;
    }
    expect(total).toBeGreaterThan(0);
  });

  it("UI-65 事前合成: 揺らぎ（randomness）は 0 にして合成し、再生の速さ 1 + randomness × (乱数 × 2 − 1) で付ける（ZzFX.js の ZZFXSound と同じ。null なら 0.05）", () => {
    const hit = assets.find((s) => s.name === "hit")!;
    const chest = assets.find((s) => s.name === "chest")!;
    expect(sfxArgs(hit.params)[1]).toBe(0);
    expect(sfxArgs([null, null, 220])).toEqual([undefined, 0, 220]);
    // 揺らぎ 0 の合成は乱数に依らない
    vi.spyOn(Math, "random").mockReturnValue(0);
    const a = buildSfxSamples(hit.params);
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    expect(buildSfxSamples(hit.params)).toEqual(a);
    // ZZFXSound も randomness を 0 にした params で buildSamples を呼ぶ
    vi.restoreAllMocks();
    const zs = new vendor.ZZFXSound([...sfxArgs(hit.params)]) as unknown as { samples: number[] };
    expect(Float32Array.from(zs.samples)).toEqual(a);
    expect(sfxRandomness(hit.params)).toBe(hit.params[1]);
    expect(chest.params[1]).toBeNull();
    expect(sfxRandomness(chest.params)).toBe(0.05);
    expect(sfxRate(hit.params, 0.5)).toBe(1);
    expect(sfxRate(hit.params, 0)).toBeCloseTo(1 - (hit.params[1] ?? 0), 12);
    expect(sfxRate(chest.params, 1)).toBeCloseTo(1.05, 12);
  });
});
