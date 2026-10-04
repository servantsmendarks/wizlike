// SV-42: Service Worker の登録。トップレベルで DOM や navigator に触れない（node のテストから import するため）。

export type ServiceWorkerSetup = "registered" | "unregistered" | "skipped" | "failed";

/**
 * SV-42: 本番ビルド（prod）でだけ ./sw.js を登録する。container が無い（http の LAN など secure context でない）なら何もしない。
 * 開発（prod が偽）では、以前に preview などで登録された Service Worker が同じオリジンに残っていれば解除する
 * （キャッシュで実機確認が混乱しないように）。reject しない
 */
export async function setupServiceWorker(o: {
  prod: boolean;
  container: Pick<ServiceWorkerContainer, "register" | "getRegistrations"> | undefined;
}): Promise<ServiceWorkerSetup> {
  const c = o.container;
  if (!c) return "skipped";
  try {
    if (o.prod) {
      await c.register("./sw.js");
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
