// SV-42: PWA の配布物（manifest・アイコン・index.html の meta）と、Service Worker のテンプレート・登録。
import { describe, expect, test, vi } from "vitest";
import manifestText from "../public/manifest.webmanifest?raw";
import indexHtml from "../index.html?raw";
import { PALETTE } from "../src/presenter/palette";
import { precacheUrls, renderServiceWorker } from "../src/pwa/sw-template";
import { setupServiceWorker } from "../src/pwa/register";

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

// ---------------------------------------------------------------------------
// Service Worker のテンプレートと登録

type FakeReq = { url: string; method: string; mode: string; init?: { cache?: string } };
type FakeEvent = {
  request: FakeReq | undefined;
  waitUntil(p: Promise<unknown>): void;
  respondWith(p: Promise<unknown>): void;
};
type Listener = (e: FakeEvent) => void;

const ORIGIN = "https://x.test";

/** sw.js の本文を、差し替えた self・caches・fetch・Request・URL で評価する */
function runServiceWorker(code: string, initialCaches: Record<string, string[]> = {}) {
  const listeners: Record<string, Listener[]> = {};
  const calls = { skipWaiting: 0, claim: 0, fetched: [] as string[], reloadInits: 0 };
  const store = new Map<string, Map<string, string>>(
    Object.entries(initialCaches).map(([k, urls]) => [k, new Map(urls.map((u) => [u, `cached:${u}`]))]),
  );
  const self = {
    registration: { scope: `${ORIGIN}/` },
    location: { origin: ORIGIN },
    addEventListener: (t: string, f: Listener) => {
      (listeners[t] ??= []).push(f);
    },
    skipWaiting: async () => {
      calls.skipWaiting++;
    },
    clients: {
      claim: async () => {
        calls.claim++;
      },
    },
  };
  const openCache = (name: string) => {
    let m = store.get(name);
    if (!m) {
      m = new Map();
      store.set(name, m);
    }
    const cache = m;
    return {
      addAll: async (reqs: FakeReq[]) => {
        for (const r of reqs) {
          if (r.init?.cache === "reload") calls.reloadInits++;
          cache.set(r.url, `net:${r.url}`);
        }
      },
      match: async (r: FakeReq | string) => cache.get(typeof r === "string" ? r : r.url),
    };
  };
  const caches = {
    open: async (name: string) => openCache(name),
    keys: async () => [...store.keys()],
    delete: async (name: string) => store.delete(name),
  };
  class FakeRequest {
    url: string;
    init: { cache?: string } | undefined;
    method = "GET";
    mode = "cors";
    constructor(url: string, init?: { cache?: string }) {
      this.url = url;
      this.init = init;
    }
  }
  const fetchFn = async (r: FakeReq) => {
    calls.fetched.push(r.url);
    return `fetched:${r.url}`;
  };
  new Function("self", "caches", "fetch", "Request", "URL", code)(self, caches, fetchFn, FakeRequest, URL);

  const dispatch = async (type: string, request?: FakeReq) => {
    const waits: Promise<unknown>[] = [];
    let response: Promise<unknown> | undefined;
    for (const f of listeners[type] ?? []) {
      f({
        request,
        waitUntil: (p) => {
          waits.push(p);
        },
        respondWith: (p) => {
          response = p;
        },
      });
    }
    await Promise.all(waits);
    return { responded: response !== undefined, response: response === undefined ? undefined : await response };
  };
  return { store, calls, dispatch };
}

describe("SV-42 Service Worker", () => {
  test("SV-42 precacheUrls: sw.js・*.map・. で始まる名前を除き、./ を付けて昇順（重複なし）。index.html が無ければ例外", () => {
    expect(
      precacheUrls([
        "index.html",
        "sw.js",
        "assets/index-b.js",
        "assets/index-b.js.map",
        "assets/index-a.css",
        ".vite/manifest.json",
        "fonts/.DS_Store",
        "manifest.webmanifest",
        "index.html",
      ]),
    ).toEqual(["./assets/index-a.css", "./assets/index-b.js", "./index.html", "./manifest.webmanifest"]);
    expect(() => precacheUrls(["assets/a.js"])).toThrow();
  });

  test("SV-42 renderServiceWorker: 版と一覧を埋め込み、キャッシュ名は wizlike-{版}", () => {
    const code = renderServiceWorker({ version: "0123456789abcdef", urls: ["./index.html", "./a.js"] });
    expect(code).toContain('const VERSION = "0123456789abcdef";');
    expect(code).toContain('const CACHE = "wizlike-" + VERSION;');
    expect(code).toContain('const URLS = ["./index.html","./a.js"];');
  });

  test("SV-42 sw.js install: 一覧をすべて cache: reload の Request で wizlike-{版} に addAll し、skipWaiting する", async () => {
    const sw = runServiceWorker(renderServiceWorker({ version: "v2", urls: ["./index.html", "./assets/a.js"] }));
    await sw.dispatch("install");
    expect([...(sw.store.get("wizlike-v2")?.keys() ?? [])]).toEqual([`${ORIGIN}/index.html`, `${ORIGIN}/assets/a.js`]);
    expect(sw.calls.reloadInits).toBe(2);
    expect(sw.calls.skipWaiting).toBe(1);
  });

  test("SV-42 sw.js activate: wizlike- で始まる古いキャッシュだけ消し（other-cache は残す）、clients.claim する", async () => {
    const sw = runServiceWorker(renderServiceWorker({ version: "v2", urls: ["./index.html"] }), {
      "wizlike-v1": ["a"],
      "wizlike-v2": ["b"],
      "other-cache": ["c"],
    });
    await sw.dispatch("activate");
    expect([...sw.store.keys()].sort()).toEqual(["other-cache", "wizlike-v2"]);
    expect(sw.calls.claim).toBe(1);
  });

  test("SV-42 sw.js fetch: 一覧にある GET はキャッシュから、無ければ fetch、ナビゲーションは index.html、別オリジンと POST は respondWith しない", async () => {
    const sw = runServiceWorker(renderServiceWorker({ version: "v2", urls: ["./index.html", "./assets/a.js"] }));
    await sw.dispatch("install");
    const get = (url: string, mode = "cors"): FakeReq => ({ url, method: "GET", mode });

    expect(await sw.dispatch("fetch", get(`${ORIGIN}/assets/a.js`))).toEqual({
      responded: true,
      response: `net:${ORIGIN}/assets/a.js`,
    });
    expect(await sw.dispatch("fetch", get(`${ORIGIN}/other.txt`))).toEqual({
      responded: true,
      response: `fetched:${ORIGIN}/other.txt`,
    });
    expect(await sw.dispatch("fetch", get(`${ORIGIN}/some/page?x=1`, "navigate"))).toEqual({
      responded: true,
      response: `net:${ORIGIN}/index.html`,
    });
    expect(await sw.dispatch("fetch", get("https://elsewhere.test/a.js"))).toEqual({
      responded: false,
      response: undefined,
    });
    expect(await sw.dispatch("fetch", { url: `${ORIGIN}/assets/a.js`, method: "POST", mode: "cors" })).toEqual({
      responded: false,
      response: undefined,
    });
    expect(sw.calls.fetched).toEqual([`${ORIGIN}/other.txt`]);
  });
});

describe("SV-42 setupServiceWorker", () => {
  const container = (o: { regs?: number; failRegister?: boolean } = {}) => {
    const log: string[] = [];
    const c = {
      register: async (url: string | URL) => {
        log.push(`register ${String(url)}`);
        if (o.failRegister) throw new Error("nope");
        return {} as ServiceWorkerRegistration;
      },
      getRegistrations: async () =>
        Array.from(
          { length: o.regs ?? 0 },
          (_, i) =>
            ({
              unregister: async () => {
                log.push(`unregister ${i}`);
                return true;
              },
            }) as unknown as ServiceWorkerRegistration,
        ),
    };
    return { c, log };
  };

  test("SV-42 setupServiceWorker: prod なら ./sw.js を register、container が無ければ skipped", async () => {
    const { c, log } = container();
    expect(await setupServiceWorker({ prod: true, container: c })).toBe("registered");
    expect(log).toEqual(["register ./sw.js"]);
    expect(await setupServiceWorker({ prod: true, container: undefined })).toBe("skipped");
    expect(await setupServiceWorker({ prod: false, container: undefined })).toBe("skipped");
  });

  test("SV-42 setupServiceWorker: register の reject は failed（reject しない）", async () => {
    const { c } = container({ failRegister: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await setupServiceWorker({ prod: true, container: c })).toBe("failed");
    warn.mockRestore();
  });

  test("SV-42 setupServiceWorker: prod でなければ登録せず、残っている登録を全部 unregister（無ければ skipped）", async () => {
    const a = container({ regs: 2 });
    expect(await setupServiceWorker({ prod: false, container: a.c })).toBe("unregistered");
    expect(a.log).toEqual(["unregister 0", "unregister 1"]);
    const b = container({ regs: 0 });
    expect(await setupServiceWorker({ prod: false, container: b.c })).toBe("skipped");
    expect(b.log).toEqual([]);
  });
});
