// SV-42: PWA の配布物（manifest・アイコン・index.html の meta）と、Service Worker のテンプレート・登録。
import { describe, expect, test, vi } from "vitest";
import manifestText from "../public/manifest.webmanifest?raw";
import indexHtml from "../index.html?raw";
import { PALETTE } from "../src/presenter/palette";
import { NAVIGATION_TIMEOUT_MS, precacheUrls, renderServiceWorker } from "../src/pwa/sw-template";
import { setupServiceWorker, watchServiceWorkerUpdate, type UpdateContainer, type UpdateRegistration } from "../src/pwa/register";
import strings from "../data/strings.json";
import { UPDATE_NOTICE_KEYS } from "../src/presenter/views/update-notice";

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
    expect(indexHtml).toContain('<link rel="manifest" href="./manifest.webmanifest">');
    expect(indexHtml).toContain('<link rel="apple-touch-icon" href="./icons/apple-touch-icon.png">');
    expect(indexHtml).toContain('<meta name="apple-mobile-web-app-capable" content="yes">');
    expect(indexHtml).toMatch(/<meta name="apple-mobile-web-app-status-bar-style" content="[a-z-]+">/);
  });

  test("SV-42 相対パス: index.html の href / src に / から始まるパスが無い（サブパスの配信で動くように）", () => {
    const paths = [...indexHtml.matchAll(/\b(?:href|src)="([^"]*)"/g)].map((m) => m[1]!);
    expect(paths.length).toBeGreaterThanOrEqual(4);
    for (const p of paths) expect(p, p).toMatch(/^\.\//);
  });
});

// ---------------------------------------------------------------------------
// Service Worker のテンプレートと登録

/** origin は Origin ヘッダー（crossorigin の script / link は送り、事前キャッシュの Request は送らない） */
type FakeReq = { url: string; method: string; mode: string; init?: { cache?: string }; origin?: string };
/** 偽の Response。body は出どころ（net: = install で入れた、fetched: = ネットワーク）と URL */
type FakeRes = { ok: boolean; body: string };
type FakeEvent = {
  request: FakeReq | undefined;
  data: unknown;
  waitUntil(p: Promise<unknown>): void;
  respondWith(p: Promise<unknown>): void;
};
type Listener = (e: FakeEvent) => void;

const ORIGIN = "https://x.test";

/**
 * sw.js の本文を、差し替えた self・caches・fetch・Request・URL で評価する。
 * network(url) はネットワークの応答（"offline" なら fetch が reject する。Promise ならその解決を待つ）。既定は 200。scope は登録の scope。
 * varyOrigin が真なら、install で入れた応答はサーバーが Vary: Origin を付けたものとして持ち、Origin の違う要求には
 * ignoreVary が無いと当たらない（Cache API の Vary の照合）。タイマーは timers.fire() で進める
 */
function runServiceWorker(
  code: string,
  initialCaches: Record<string, string[]> = {},
  network: (url: string) => FakeRes | "offline" | Promise<FakeRes | "offline"> = (url) => ({ ok: true, body: `fetched:${url}` }),
  scope = `${ORIGIN}/`,
  o: { varyOrigin?: boolean } = {},
) {
  const listeners: Record<string, Listener[]> = {};
  const calls = { skipWaiting: 0, claim: 0, fetched: [] as string[], reloadInits: 0 };
  type Entry = FakeRes & { vary?: { origin: string | undefined } };
  const store = new Map<string, Map<string, Entry>>(
    Object.entries(initialCaches).map(([k, urls]) => [k, new Map(urls.map((u) => [u, { ok: true, body: `cached:${u}` }]))]),
  );
  /** self.setTimeout の偽物。fire() で待っているものを全部呼ぶ。delays は渡された ms */
  const timers = {
    pending: new Map<number, () => void>(),
    delays: [] as number[],
    next: 1,
    fire(): void {
      const fs = [...this.pending.values()];
      this.pending.clear();
      for (const t of fs) t();
    },
  };
  const self = {
    registration: { scope },
    location: { origin: ORIGIN },
    setTimeout: (f: () => void, ms: number) => {
      const id = timers.next++;
      timers.pending.set(id, f);
      timers.delays.push(ms);
      return id;
    },
    clearTimeout: (id: number) => {
      timers.pending.delete(id);
    },
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
          const e: Entry = { ok: true, body: `net:${r.url}` };
          if (o.varyOrigin) Object.defineProperty(e, "vary", { value: { origin: r.origin }, enumerable: false });
          cache.set(r.url, e);
        }
      },
      match: async (r: FakeReq | string, opt?: { ignoreVary?: boolean }) => {
        const e = cache.get(typeof r === "string" ? r : r.url);
        if (e === undefined) return undefined;
        const origin = typeof r === "string" ? undefined : r.origin;
        if (e.vary !== undefined && opt?.ignoreVary !== true && e.vary.origin !== origin) return undefined;
        return e;
      },
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
    const res = await network(r.url);
    if (res === "offline") throw new TypeError("Failed to fetch");
    return res;
  };
  new Function("self", "caches", "fetch", "Request", "URL", code)(self, caches, fetchFn, FakeRequest, URL);

  const dispatch = async (type: string, request?: FakeReq, data?: unknown) => {
    const waits: Promise<unknown>[] = [];
    let response: Promise<unknown> | undefined;
    for (const f of listeners[type] ?? []) {
      f({
        request,
        data,
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
  return { store, calls, dispatch, timers };
}

const get = (url: string, mode = "cors"): FakeReq => ({ url, method: "GET", mode });
const ok = (body: string): FakeRes => ({ ok: true, body });

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

  test("SV-42 sw.js install（条件 1・2）: 埋め込んだ一覧をすべて cache: reload の Request で wizlike-{版} に addAll する。skipWaiting はしない（更新は待機する）", async () => {
    const sw = runServiceWorker(renderServiceWorker({ version: "v2", urls: ["./index.html", "./assets/a.js"] }));
    await sw.dispatch("install");
    expect([...sw.store.keys()]).toEqual(["wizlike-v2"]);
    expect([...(sw.store.get("wizlike-v2")?.keys() ?? [])]).toEqual([`${ORIGIN}/index.html`, `${ORIGIN}/assets/a.js`]);
    expect(sw.calls.reloadInits).toBe(2);
    expect(sw.calls.skipWaiting).toBe(0);
    expect(sw.calls.fetched).toEqual([]);
  });

  test("SV-42 sw.js message（条件 5）: ページからの { type: skipWaiting } でだけ skipWaiting する（ほかの message は無視）", async () => {
    const sw = runServiceWorker(renderServiceWorker({ version: "v2", urls: ["./index.html"] }));
    await sw.dispatch("message", undefined, { type: "other" });
    await sw.dispatch("message", undefined, null);
    expect(sw.calls.skipWaiting).toBe(0);
    await sw.dispatch("message", undefined, { type: "skipWaiting" });
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

  test("SV-42 sw.js fetch（条件 4）: ハッシュ付き資産（assets/）などキャッシュにある GET はネットワークに出ずキャッシュから、無ければ fetch。別オリジンと POST は respondWith しない", async () => {
    const sw = runServiceWorker(renderServiceWorker({ version: "v2", urls: ["./index.html", "./assets/a-1234abcd.js"] }));
    await sw.dispatch("install");

    expect(await sw.dispatch("fetch", get(`${ORIGIN}/assets/a-1234abcd.js`))).toEqual({
      responded: true,
      response: ok(`net:${ORIGIN}/assets/a-1234abcd.js`),
    });
    expect(await sw.dispatch("fetch", get(`${ORIGIN}/other.txt`))).toEqual({
      responded: true,
      response: ok(`fetched:${ORIGIN}/other.txt`),
    });
    expect(await sw.dispatch("fetch", get("https://elsewhere.test/a.js"))).toEqual({
      responded: false,
      response: undefined,
    });
    expect(await sw.dispatch("fetch", { url: `${ORIGIN}/assets/a-1234abcd.js`, method: "POST", mode: "cors" })).toEqual({
      responded: false,
      response: undefined,
    });
    expect(sw.calls.fetched).toEqual([`${ORIGIN}/other.txt`]);
  });

  test("SV-42 sw.js fetch（条件 3）: ナビゲーションはネットワーク優先（200 ならその応答。キャッシュには書き戻さない）", async () => {
    const sw = runServiceWorker(renderServiceWorker({ version: "v2", urls: ["./index.html"] }));
    await sw.dispatch("install");
    expect(await sw.dispatch("fetch", get(`${ORIGIN}/`, "navigate"))).toEqual({
      responded: true,
      response: ok(`fetched:${ORIGIN}/`),
    });
    expect(sw.calls.fetched).toEqual([`${ORIGIN}/`]);
    expect(sw.store.get("wizlike-v2")?.get(`${ORIGIN}/index.html`)).toEqual(ok(`net:${ORIGIN}/index.html`));
    expect(sw.store.get("wizlike-v2")?.has(`${ORIGIN}/`)).toBe(false);
  });

  test("SV-42 sw.js fetch（条件 3）: ナビゲーションはオフライン（fetch が reject）やサーバーの誤り（ok でない）ならキャッシュの index.html。キャッシュにも無ければ reject・その応答", async () => {
    const offline = runServiceWorker(renderServiceWorker({ version: "v2", urls: ["./index.html"] }), {}, () => "offline");
    await offline.dispatch("install");
    expect(await offline.dispatch("fetch", get(`${ORIGIN}/some/page?x=1`, "navigate"))).toEqual({
      responded: true,
      response: ok(`net:${ORIGIN}/index.html`),
    });

    const notFound = runServiceWorker(renderServiceWorker({ version: "v2", urls: ["./index.html"] }), {}, () => ({ ok: false, body: "404" }));
    await notFound.dispatch("install");
    expect(await notFound.dispatch("fetch", get(`${ORIGIN}/`, "navigate"))).toEqual({
      responded: true,
      response: ok(`net:${ORIGIN}/index.html`),
    });

    // install 前（キャッシュが空）
    const empty404 = runServiceWorker(renderServiceWorker({ version: "v2", urls: ["./index.html"] }), {}, () => ({ ok: false, body: "404" }));
    expect(await empty404.dispatch("fetch", get(`${ORIGIN}/`, "navigate"))).toEqual({
      responded: true,
      response: { ok: false, body: "404" },
    });
    const emptyOffline = runServiceWorker(renderServiceWorker({ version: "v2", urls: ["./index.html"] }), {}, () => "offline");
    await expect(emptyOffline.dispatch("fetch", get(`${ORIGIN}/`, "navigate"))).rejects.toThrow("Failed to fetch");
  });

  test("SV-42 sw.js fetch（Vary）: サーバーが Vary: Origin を付けた事前キャッシュにも、Origin を送る crossorigin の要求（script type=module・link rel=stylesheet）がネットワークに出ずに当たる（オフラインで起動する）", async () => {
    const sw = runServiceWorker(
      renderServiceWorker({ version: "v2", urls: ["./index.html", "./assets/index-1234abcd.js", "./assets/index-5678ef.css"] }),
      {},
      () => "offline",
      `${ORIGIN}/`,
      { varyOrigin: true },
    );
    await sw.dispatch("install");
    for (const f of ["assets/index-1234abcd.js", "assets/index-5678ef.css"]) {
      expect(await sw.dispatch("fetch", { ...get(`${ORIGIN}/${f}`), origin: ORIGIN }), f).toEqual({
        responded: true,
        response: ok(`net:${ORIGIN}/${f}`),
      });
    }
    expect(await sw.dispatch("fetch", get(`${ORIGIN}/`, "navigate"))).toEqual({
      responded: true,
      response: ok(`net:${ORIGIN}/index.html`),
    });
    expect(sw.calls.fetched).toEqual([`${ORIGIN}/`]);
  });

  const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

  test("SV-42 sw.js fetch（条件 3・時間制限）: ナビゲーションのネットワークが NAVIGATION_TIMEOUT_MS 以内に応答しなければキャッシュの index.html を返し、後から来た応答は使わない", async () => {
    expect(NAVIGATION_TIMEOUT_MS).toBe(3000);
    let answer: (r: FakeRes) => void = () => {};
    const slow = new Promise<FakeRes>((r) => {
      answer = r;
    });
    const sw = runServiceWorker(renderServiceWorker({ version: "v2", urls: ["./index.html"] }), {}, (url) =>
      url.endsWith("/index.html") ? ok(`fetched:${url}`) : slow,
    );
    await sw.dispatch("install");
    const pending = sw.dispatch("fetch", get(`${ORIGIN}/`, "navigate"));
    await tick();
    expect(sw.timers.delays).toEqual([NAVIGATION_TIMEOUT_MS]);
    sw.timers.fire();
    expect(await pending).toEqual({ responded: true, response: ok(`net:${ORIGIN}/index.html`) });
    answer(ok("late"));
    await tick();
    // 応答が時間内に来れば、その応答（タイマーは片付ける）
    const fast = runServiceWorker(renderServiceWorker({ version: "v2", urls: ["./index.html"] }));
    await fast.dispatch("install");
    expect(await fast.dispatch("fetch", get(`${ORIGIN}/`, "navigate"))).toEqual({ responded: true, response: ok(`fetched:${ORIGIN}/`) });
    expect(fast.timers.pending.size).toBe(0);
  });

  test("SV-42 sw.js fetch（条件 3・時間制限）: 時間切れでもキャッシュに index.html が無ければネットワークの応答を待つ", async () => {
    let answer: (r: FakeRes) => void = () => {};
    const slow = new Promise<FakeRes>((r) => {
      answer = r;
    });
    const sw = runServiceWorker(renderServiceWorker({ version: "v2", urls: ["./index.html"] }), {}, () => slow);
    const pending = sw.dispatch("fetch", get(`${ORIGIN}/`, "navigate"));
    await tick();
    sw.timers.fire();
    await tick();
    answer(ok("late"));
    expect(await pending).toEqual({ responded: true, response: ok("late") });
  });

  test("SV-42 sw.js（条件 2）: サブパスの scope（/wizlike/）では一覧とキャッシュの index.html を scope からの相対で解決する", async () => {
    const code = renderServiceWorker({ version: "v3", urls: ["./index.html", "./assets/a.js"] });
    const sw = runServiceWorker(code, {}, () => "offline", `${ORIGIN}/wizlike/`);
    await sw.dispatch("install");
    expect([...(sw.store.get("wizlike-v3")?.keys() ?? [])]).toEqual([`${ORIGIN}/wizlike/index.html`, `${ORIGIN}/wizlike/assets/a.js`]);
    expect(await sw.dispatch("fetch", get(`${ORIGIN}/wizlike/`, "navigate"))).toEqual({
      responded: true,
      response: ok(`net:${ORIGIN}/wizlike/index.html`),
    });
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
      controller: null,
      addEventListener: () => {},
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

// ---------------------------------------------------------------------------
// ビルドのプラグイン（vite.config.ts）と相対パス。@types/node は入れていないので node の型は手で書き、
// vite.config.ts は tsconfig の外なので文字列の動的 import で読む（tap.test.ts の node:fs と同じ）。

type NodeFs = {
  mkdtempSync(prefix: string): string;
  mkdirSync(p: string, o: { recursive: true }): void;
  writeFileSync(p: string, s: string): void;
  readFileSync(p: string, enc: "utf8"): string;
  rmSync(p: string, o: { recursive: true; force: true }): void;
};
type SwPlugin = { name: string; configResolved(c: { root: string; build: { outDir: string } }): void; closeBundle(): void };
const NODE_FS = "node:fs";
const NODE_OS = "node:os";
const nfs = (await import(/* @vite-ignore */ NODE_FS)) as NodeFs;
const nos = (await import(/* @vite-ignore */ NODE_OS)) as { tmpdir(): string };
const viteConfig = (await import(/* @vite-ignore */ new URL("../vite.config.ts", import.meta.url).href)).default as {
  base?: string;
  plugins: SwPlugin[];
};

describe("SV-42 ビルドの sw.js", () => {
  /** 一時の root に dist を作り、プラグインの closeBundle で sw.js を書いて、VERSION と URLS を読む */
  function build(files: Record<string, string>): { version: string; urls: string[] } {
    const root = nfs.mkdtempSync(`${nos.tmpdir()}/wizlike-sw-`);
    try {
      for (const [p, body] of Object.entries(files)) {
        const full = `${root}/dist/${p}`;
        nfs.mkdirSync(full.slice(0, full.lastIndexOf("/")), { recursive: true });
        nfs.writeFileSync(full, body);
      }
      const plugin = viteConfig.plugins.find((x) => x.name === "wizlike-sw");
      if (!plugin) throw new Error("wizlike-sw not found");
      plugin.configResolved({ root, build: { outDir: "dist" } });
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      plugin.closeBundle();
      log.mockRestore();
      const sw = nfs.readFileSync(`${root}/dist/sw.js`, "utf8");
      const version = /const VERSION = "([^"]*)";/.exec(sw)?.[1] ?? "";
      const urls = JSON.parse(/const URLS = (\[[^\n]*\]);/.exec(sw)?.[1] ?? "null") as string[];
      expect(sw).toContain('const CACHE = "wizlike-" + VERSION;');
      return { version, urls };
    } finally {
      nfs.rmSync(root, { recursive: true, force: true });
    }
  }

  const FILES = {
    "index.html": "<html></html>",
    "assets/index-AAAA.js": "console.log(1)",
    "assets/index-AAAA.js.map": "{}",
    "assets/index-BBBB.css": "body{}",
    "fonts/f.ttf": "font",
    "manifest.webmanifest": "{}",
    "sw.js": "old",
  };

  test("SV-42 ビルド（条件 1）: dist のファイル一覧（sw.js と *.map を除く）を昇順で sw.js に埋め込む", () => {
    expect(build(FILES).urls).toEqual([
      "./assets/index-AAAA.js",
      "./assets/index-BBBB.css",
      "./fonts/f.ttf",
      "./index.html",
      "./manifest.webmanifest",
    ]);
  });

  test("SV-42 ビルド（条件 2）: キャッシュ名の版は中身の sha256 の 16 字で、同じ中身なら同じ、1 ファイルでも中身が変われば変わる（*.map と古い sw.js は版に入らない）", () => {
    const a = build(FILES);
    expect(a.version).toMatch(/^[0-9a-f]{16}$/);
    expect(build({ ...FILES, "sw.js": "older", "assets/index-AAAA.js.map": "[]" }).version).toBe(a.version);
    expect(build({ ...FILES, "index.html": "<html>2</html>" }).version).not.toBe(a.version);
    expect(build({ ...FILES, "fonts/f.ttf": "font2" }).version).not.toBe(a.version);
  });

  test("SV-42 相対パス: Vite の base は ./（サブパスの配信で動くように。public の / から始まるパスはビルドで相対に書き換わる）", () => {
    expect(viteConfig.base).toBe("./");
  });
});

// ---------------------------------------------------------------------------
// 更新の検知と案内（条件 5）

type FakeWorker = { state: string; posted: unknown[]; listeners: (() => void)[] };

/** 偽の registration と container。controlled は読み込み時に controller があったか */
function updateFakes(o: { controlled: boolean; waiting?: boolean; installing?: boolean }) {
  const worker = (state: string): FakeWorker => ({ state, posted: [], listeners: [] });
  const regListeners: (() => void)[] = [];
  const containerListeners: (() => void)[] = [];
  const state = {
    waiting: o.waiting ? worker("installed") : null as FakeWorker | null,
    installing: o.installing ? worker("installing") : null as FakeWorker | null,
  };
  const registration: UpdateRegistration = {
    get waiting() {
      return state.waiting === null ? null : { postMessage: (m: unknown) => void state.waiting!.posted.push(m) };
    },
    get installing() {
      const w = state.installing;
      if (w === null) return null;
      return {
        get state() {
          return w.state;
        },
        addEventListener: (_t: "statechange", f: () => void) => void w.listeners.push(f),
      };
    },
    addEventListener: (_t: "updatefound", f: () => void) => void regListeners.push(f),
  };
  const container: UpdateContainer = {
    controller: o.controlled ? {} : null,
    addEventListener: (_t: "controllerchange", f: () => void) => void containerListeners.push(f),
  };
  const log: string[] = [];
  const applies: (() => void)[] = [];
  const run = (): void =>
    watchServiceWorkerUpdate({
      registration,
      container,
      onUpdate: (apply) => {
        log.push("notice");
        applies.push(apply);
      },
      reload: () => log.push("reload"),
    });
  /** 新しい Service Worker のインストールが始まり（updatefound）、installed になる */
  const installNew = (): FakeWorker => {
    const w = worker("installing");
    state.installing = w;
    for (const f of regListeners) f();
    w.state = "installed";
    state.installing = null;
    state.waiting = w;
    for (const f of w.listeners) f();
    return w;
  };
  const controllerChange = (): void => {
    for (const f of containerListeners) f();
  };
  return { state, log, applies, run, installNew, controllerChange };
}

describe("SV-42 更新の案内", () => {
  test("SV-42 更新の検知（条件 5）: 制御下のページで新しい Service Worker が installed になったら案内を 1 回だけ出す。読み込み時に待機中があればすぐ出す", () => {
    const a = updateFakes({ controlled: true });
    a.run();
    expect(a.log).toEqual([]);
    a.installNew();
    expect(a.log).toEqual(["notice"]);
    a.installNew();
    expect(a.log).toEqual(["notice"]);

    const b = updateFakes({ controlled: true, waiting: true });
    b.run();
    expect(b.log).toEqual(["notice"]);
  });

  test("SV-42 更新の検知（条件 5）: 登録の解決の時点でインストール中だったものも、installed になれば案内を出す", () => {
    const f = updateFakes({ controlled: true, installing: true });
    f.run();
    const w = f.state.installing!;
    w.state = "installed";
    f.state.waiting = w;
    f.state.installing = null;
    for (const l of w.listeners) l();
    expect(f.log).toEqual(["notice"]);
  });

  test("SV-42 更新の検知: 初回のインストール（読み込み時に controller が無い）は更新ではないので案内を出さず、clients.claim の controllerchange でも読み込み直さない", () => {
    const f = updateFakes({ controlled: false, installing: true });
    f.run();
    f.installNew();
    f.controllerChange();
    expect(f.log).toEqual([]);
  });

  test("SV-42 読み込み直す（条件 5）: 待機中の Service Worker に { type: skipWaiting } を送り、controllerchange で 1 回だけ reload する（待機中が無ければすぐ reload）", () => {
    const f = updateFakes({ controlled: true });
    f.run();
    const w = f.installNew();
    f.applies[0]!();
    expect(w.posted).toEqual([{ type: "skipWaiting" }]);
    expect(f.log).toEqual(["notice"]);
    f.controllerChange();
    f.controllerChange();
    expect(f.log).toEqual(["notice", "reload"]);

    const g = updateFakes({ controlled: true, waiting: true });
    g.run();
    g.state.waiting = null;
    g.applies[0]!();
    expect(g.log).toEqual(["notice", "reload"]);
  });

  test("SV-42 読み込み直す: 制御下で読み込んだページは、ほかのタブで有効にされた（controllerchange）ときも読み込み直す（古い版のページを新しい版の下で動かさない）", () => {
    const f = updateFakes({ controlled: true });
    f.run();
    f.controllerChange();
    expect(f.log).toEqual(["reload"]);
  });

  test("SV-42 setupServiceWorker: onUpdate を渡すと登録した registration の更新を見張る", async () => {
    let notices = 0;
    const c = {
      register: async () => ({
        waiting: { postMessage: () => {} },
        installing: null,
        addEventListener: () => {},
      }) as unknown as ServiceWorkerRegistration,
      getRegistrations: async () => [],
      controller: {} as ServiceWorker,
      addEventListener: () => {},
    };
    expect(await setupServiceWorker({ prod: true, container: c, onUpdate: () => notices++, reload: () => {} })).toBe("registered");
    expect(notices).toBe(1);
  });

  test("SV-42 案内の文言は strings にある（pwa.update.message・pwa.update.reload・common.close）", () => {
    const S = strings as Record<string, string>;
    for (const k of UPDATE_NOTICE_KEYS) expect(S[k], k).toBeTruthy();
  });

  test("SV-42 案内の文言は常体で、読み込み直すと更新を終える（切り替える）ことを語る（新しい版で動いているページでも合う語り）", () => {
    const S = strings as Record<string, string>;
    const m = S["pwa.update.message"]!;
    expect(m).not.toMatch(/です|ます/);
    expect(m).not.toContain("新しい版になる");
    expect(m).toContain("更新");
  });
});
