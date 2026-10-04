// SV-42: Service Worker の登録と更新の検知。トップレベルで DOM や navigator に触れない（node のテストから import するため）。

export type ServiceWorkerSetup = "registered" | "unregistered" | "skipped" | "failed";

/** 更新の検知に使う registration の部分 */
export type UpdateRegistration = {
  readonly waiting: { postMessage(message: unknown): void } | null;
  readonly installing: { readonly state: string; addEventListener(type: "statechange", f: () => void): void } | null;
  addEventListener(type: "updatefound", f: () => void): void;
};

/** 更新の検知に使う container の部分 */
export type UpdateContainer = {
  readonly controller: unknown;
  addEventListener(type: "controllerchange", f: () => void): void;
};

/**
 * SV-42 条件 5: 新しい版の Service Worker が待機に入ったら onUpdate(apply) を 1 回だけ呼ぶ（案内を出す）。
 * - 待機に入った = 読み込み時に registration.waiting がある、または updatefound の installing が installed になった。
 *   読み込み時にインストール中のものも追う。どちらもページが Service Worker の制御下で読み込まれたとき（controller があったとき）だけ。初回のインストールは更新ではない。
 * - apply() は待機中の Service Worker に { type: "skipWaiting" } を送る（待機中のものが無ければすぐ reload）。
 * - controllerchange では、読み込み時に controller があったページだけ 1 回 reload する（古い版のページが新しい版の
 *   Service Worker の下で動き続けないように。apply を押したタブ以外のタブも読み込み直す。初回の clients.claim では読み込み直さない）。
 */
export function watchServiceWorkerUpdate(o: {
  registration: UpdateRegistration;
  container: UpdateContainer;
  onUpdate(apply: () => void): void;
  reload(): void;
}): void {
  const { registration: reg, container: c } = o;
  const controlled = c.controller !== null && c.controller !== undefined;
  let notified = false;
  let reloading = false;
  const reloadOnce = (): void => {
    if (reloading) return;
    reloading = true;
    o.reload();
  };
  const apply = (): void => {
    const w = reg.waiting;
    if (w === null) reloadOnce();
    else w.postMessage({ type: "skipWaiting" });
  };
  const notify = (): void => {
    if (notified || !controlled) return;
    notified = true;
    o.onUpdate(apply);
  };
  c.addEventListener("controllerchange", () => {
    if (controlled) reloadOnce();
  });
  const track = (): void => {
    const w = reg.installing;
    if (w === null) return;
    w.addEventListener("statechange", () => {
      if (w.state === "installed") notify();
    });
  };
  if (reg.waiting !== null) notify();
  // 登録の解決より前に更新のインストールが始まっていた場合（updatefound を聞き逃す）も追う
  track();
  reg.addEventListener("updatefound", track);
}

/**
 * SV-42: 本番ビルド（prod）でだけ {base}sw.js を scope {base} で登録する（base は import.meta.env.BASE_URL。本番は /wizlike/）。container が無い（http の LAN など secure context でない）なら何もしない。
 * 登録できたら watchServiceWorkerUpdate で更新を見張る（onUpdate があるとき）。
 * 開発（prod が偽）では、以前に preview などで登録された Service Worker が同じオリジンに残っていれば解除する
 * （キャッシュで実機確認が混乱しないように）。reject しない
 */
export async function setupServiceWorker(o: {
  prod: boolean;
  /** ビルドの base（"/" で終わる）。sw.js の置き場所と登録の scope */
  base: string;
  container: (Pick<ServiceWorkerContainer, "register" | "getRegistrations"> & UpdateContainer) | undefined;
  onUpdate?: (apply: () => void) => void;
  reload?: () => void;
}): Promise<ServiceWorkerSetup> {
  const c = o.container;
  if (!c) return "skipped";
  try {
    if (o.prod) {
      const registration = await c.register(`${o.base}sw.js`, { scope: o.base });
      const onUpdate = o.onUpdate;
      if (onUpdate) watchServiceWorkerUpdate({ registration, container: c, onUpdate, reload: o.reload ?? (() => {}) });
      return "registered";
    }
    const regs = await c.getRegistrations();
    if (regs.length === 0) return "skipped";
    await Promise.all(regs.map((r) => r.unregister()));
    return "unregistered";
  } catch (e) {
    console.warn(e);
    return "failed";
  }
}
