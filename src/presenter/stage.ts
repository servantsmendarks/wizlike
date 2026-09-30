// UI-01 / UI-02: 論理解像度のステージを端末に合わせて拡大・中央寄せし、safe area の内側に収める。
// モジュールのトップレベルでは DOM に触れない（node 環境のテストから computeStageLayout を import するため）。

export type Insets = { top: number; right: number; bottom: number; left: number };

/** 長さは CSS px（stageWidth / stageHeight は論理 px）。 */
export type StageLayoutInput = {
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  insets: Insets;
  stageWidth: number;
  stageHeight: number;
};

/**
 * scale: 論理 1px あたりの CSS px。
 * deviceScale: 論理 1px あたりの端末 px。
 * integer: deviceScale が整数か（端末ピクセル基準の整数倍）。
 * left / top: ステージ左上の CSS px 座標。
 */
export type StageLayout = {
  scale: number;
  deviceScale: number;
  integer: boolean;
  left: number;
  top: number;
};

// 浮動小数の誤差で 5.0 が 4.999... になって floor が 1 段下がるのを防ぐ。
const EPS = 1e-9;

function positive(v: number, fallback: number): number {
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function nonNegative(v: number): number {
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * 1 軸ぶんの配置。中央に置いて端末ピクセル境界に丸め、[lo, hi] からはみ出すなら内側へ寄せる。
 * 端末ピクセル境界に揃えられる余地が無いとき（余白が 1 端末 px 未満など）は丸めない中央値を使う。
 */
function place(insetStart: number, avail: number, size: number, dpr: number): number {
  const lo = insetStart;
  const hi = insetStart + avail - size;
  const center = insetStart + (avail - size) / 2;
  const within = (v: number): boolean => v >= lo - EPS && v <= hi + EPS;

  let v = Math.round(center * dpr) / dpr;
  if (v < lo - EPS) v = Math.ceil(lo * dpr - EPS) / dpr;
  if (v > hi + EPS) v = Math.floor(hi * dpr + EPS) / dpr;
  if (within(v)) return v;
  return center;
}

/** 純粋関数。DOM に触れない。 */
export function computeStageLayout(input: StageLayoutInput): StageLayout {
  const dpr = positive(input.devicePixelRatio, 1);
  const sw = positive(input.stageWidth, 1);
  const sh = positive(input.stageHeight, 1);
  const insets: Insets = {
    top: nonNegative(input.insets.top),
    right: nonNegative(input.insets.right),
    bottom: nonNegative(input.insets.bottom),
    left: nonNegative(input.insets.left),
  };
  const availW = nonNegative(input.viewportWidth - insets.left - insets.right);
  const availH = nonNegative(input.viewportHeight - insets.top - insets.bottom);

  // UI-01 の「整数」は端末ピクセル基準で解釈する（CSS px 基準だと高 dpr 端末で画面の大半が余る）。
  const kDev = Math.floor(Math.min((availW * dpr) / sw, (availH * dpr) / sh) + EPS);

  let scale: number;
  let deviceScale: number;
  let integer: boolean;
  if (kDev >= 1) {
    deviceScale = kDev;
    scale = kDev / dpr;
    integer = true;
  } else {
    scale = Math.min(availW / sw, availH / sh);
    deviceScale = scale * dpr;
    integer = false;
  }

  const left = place(insets.left, availW, sw * scale, dpr);
  const top = place(insets.top, availH, sh * scale, dpr);
  return { scale, deviceScale, integer, left, top };
}

const PROBE_CLASS = "stage-safe-area-probe";

function readInsets(probe: HTMLElement): Insets {
  const cs = getComputedStyle(probe);
  const px = (v: string): number => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    top: px(cs.paddingTop),
    right: px(cs.paddingRight),
    bottom: px(cs.paddingBottom),
    left: px(cs.paddingLeft),
  };
}

/**
 * ビューポート寸法の選び方:
 * - window.innerWidth / innerHeight を使う。iOS Safari ではツールバーの伸縮に追従して innerHeight が
 *   変わる（その際 visualViewport の resize も飛ぶので購読している）。
 * - visualViewport.height は使わない。ピンチズームやソフトウェアキーボード（名前入力時）でも縮むため、
 *   キーボードを出した瞬間にステージが縮むのを避けたい。
 * - document.documentElement.clientHeight は iOS でツールバー展開時の小さい値に固定されがちで、
 *   ツールバーが引っ込んだときの余白を活かせない。
 */
function readInput(probe: HTMLElement, size: { width: number; height: number }): StageLayoutInput {
  return {
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio || 1,
    insets: readInsets(probe),
    stageWidth: size.width,
    stageHeight: size.height,
  };
}

/**
 * #stage に寸法・拡大率・位置を適用し、画面の変化で再計算する。戻り値は購読解除（プローブも除去）。
 * onLayout の第 2 引数は計測に使った入力（デバッグ表示用）。
 */
export function mountStage(
  stage: HTMLElement,
  size: { width: number; height: number },
  onLayout?: (layout: StageLayout, input: StageLayoutInput) => void,
): () => void {
  const probe = document.createElement("div");
  probe.className = PROBE_CLASS;
  probe.setAttribute("aria-hidden", "true");
  document.body.appendChild(probe);

  stage.style.width = `${size.width}px`;
  stage.style.height = `${size.height}px`;

  let disposed = false;
  let rafId = 0;

  const update = (): void => {
    if (disposed) return;
    const input = readInput(probe, size);
    const layout = computeStageLayout(input);
    stage.style.transform = `scale(${layout.scale})`;
    stage.style.left = `${layout.left}px`;
    stage.style.top = `${layout.top}px`;
    onLayout?.(layout, input);
  };

  // orientationchange 直後は寸法が未確定のことがあるので、次のフレームでもう一度だけ測る（常駐ループではない）。
  const updateNowAndNextFrame = (): void => {
    update();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      update();
    });
  };

  window.addEventListener("resize", updateNowAndNextFrame);
  window.addEventListener("orientationchange", updateNowAndNextFrame);
  const vv = window.visualViewport;
  vv?.addEventListener("resize", updateNowAndNextFrame);

  // devicePixelRatio の変化（ブラウザのズーム、別ディスプレイへの移動）。
  // 一致クエリは現在の dpr 専用なので、変化のたびに張り直す。
  let mql: MediaQueryList | null = null;
  const onDprChange = (): void => {
    watchDpr();
    updateNowAndNextFrame();
  };
  const watchDpr = (): void => {
    mql?.removeEventListener("change", onDprChange);
    mql = null;
    if (disposed || typeof window.matchMedia !== "function") return;
    mql = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    mql.addEventListener("change", onDprChange);
  };
  watchDpr();

  update();

  return () => {
    disposed = true;
    cancelAnimationFrame(rafId);
    window.removeEventListener("resize", updateNowAndNextFrame);
    window.removeEventListener("orientationchange", updateNowAndNextFrame);
    vv?.removeEventListener("resize", updateNowAndNextFrame);
    mql?.removeEventListener("change", onDprChange);
    mql = null;
    probe.remove();
  };
}
