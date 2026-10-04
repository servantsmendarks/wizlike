// SV-42: PWA の配布物（manifest・アイコン・index.html の meta）。
import { describe, expect, test } from "vitest";
import manifestText from "../public/manifest.webmanifest?raw";
import indexHtml from "../index.html?raw";
import { PALETTE } from "../src/presenter/palette";

const iconUrls = import.meta.glob("../public/icons/*.png", {
  query: "?inline",
  import: "default",
  eager: true,
}) as Record<string, string>;

const iconScript = Object.values(
  import.meta.glob("../scripts/make-icons.mjs", { query: "?raw", import: "default", eager: true }) as Record<
    string,
    string
  >,
)[0];

const iconPath = (src: string): string => `../public/${src}`;

/** data URL（base64）の PNG から署名と IHDR の幅・高さを読む */
function pngSize(dataUrl: string): { sig: boolean; w: number; h: number } {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bin = atob(b64);
  const byte = (i: number): number => bin.charCodeAt(i);
  const u32 = (i: number): number => ((byte(i) << 24) | (byte(i + 1) << 16) | (byte(i + 2) << 8) | byte(i + 3)) >>> 0;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => byte(i) === v);
  return { sig, w: u32(16), h: u32(20) };
}

describe("SV-42 manifest", () => {
  const m = JSON.parse(manifestText) as {
    name: string;
    short_name: string;
    start_url: string;
    scope: string;
    display: string;
    orientation: string;
    theme_color: string;
    background_color: string;
    icons: { src: string; sizes: string; type: string; purpose: string }[];
  };

  test("SV-42 manifest: display standalone、orientation portrait、start_url と scope は ./、theme / background は PALETTE.black", () => {
    expect(m.display).toBe("standalone");
    expect(m.orientation).toBe("portrait");
    expect(m.start_url).toBe("./");
    expect(m.scope).toBe("./");
    expect(m.theme_color).toBe(PALETTE.black);
    expect(m.background_color).toBe(PALETTE.black);
    expect(m.name.length).toBeGreaterThan(0);
    expect(m.short_name.length).toBeGreaterThan(0);
  });

  test("SV-42 manifest: icons は 192・512（any）と 512（maskable）で、src のファイルが public にある", () => {
    expect(m.icons.map((i) => [i.sizes, i.purpose, i.type])).toEqual([
      ["192x192", "any", "image/png"],
      ["512x512", "any", "image/png"],
      ["512x512", "maskable", "image/png"],
    ]);
    for (const i of m.icons) expect(Object.keys(iconUrls)).toContain(iconPath(i.src));
  });
});

describe("SV-42 アイコン", () => {
  test("SV-42 アイコン: PNG の署名と IHDR の幅・高さ（192・512・maskable 512・apple-touch-icon 180）", () => {
    const expected: Record<string, number> = {
      "icon-192.png": 192,
      "icon-512.png": 512,
      "icon-maskable-512.png": 512,
      "apple-touch-icon.png": 180,
    };
    expect(Object.keys(iconUrls).sort()).toEqual(Object.keys(expected).map((f) => `../public/icons/${f}`).sort());
    for (const [f, size] of Object.entries(expected)) {
      const url = iconUrls[`../public/icons/${f}`];
      expect(url, f).toMatch(/^data:image\/png;base64,/);
      expect(pngSize(url!), f).toEqual({ sig: true, w: size, h: size });
    }
  });

  test("SV-42 アイコンの色: scripts/make-icons.mjs の #RRGGBB はすべて PALETTE の値", () => {
    expect(iconScript).toBeDefined();
    const colors = iconScript!.match(/#[0-9A-Fa-f]{6}\b/g) ?? [];
    expect(colors.length).toBeGreaterThanOrEqual(3);
    const palette = Object.values(PALETTE).map((c) => c.toUpperCase());
    for (const c of colors) expect(palette).toContain(c.toUpperCase());
  });
});

describe("SV-42 index.html", () => {
  test("SV-42 index.html: manifest・apple-touch-icon・apple-mobile-web-app-capable・status-bar-style の link / meta がある", () => {
    expect(indexHtml).toContain('<link rel="manifest" href="/manifest.webmanifest">');
    expect(indexHtml).toContain('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">');
    expect(indexHtml).toContain('<meta name="apple-mobile-web-app-capable" content="yes">');
    expect(indexHtml).toMatch(/<meta name="apple-mobile-web-app-status-bar-style" content="[a-z-]+">/);
  });
});
