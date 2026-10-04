// SV-41: ページが隠れたとき（visibilitychange で hidden・pagehide）に保存を念のため行うための受け口。
// モジュールのトップレベルでは DOM に触れない（doc と win は呼び出し側が渡す）。

type VisibilityDoc = {
  visibilityState: string;
  addEventListener(t: "visibilitychange", f: () => void): void;
  removeEventListener(t: "visibilitychange", f: () => void): void;
};
type PageHideWin = {
  addEventListener(t: "pagehide", f: () => void): void;
  removeEventListener(t: "pagehide", f: () => void): void;
};

/** SV-41: ページが隠れた（visibilitychange で hidden）・pagehide のときに onHide を呼ぶ。戻り値で外す */
export function attachSaveOnHide(doc: VisibilityDoc, win: PageHideWin, onHide: () => void): () => void {
  const onVisibility = (): void => {
    if (doc.visibilityState === "hidden") onHide();
  };
  const onPageHide = (): void => onHide();
  doc.addEventListener("visibilitychange", onVisibility);
  win.addEventListener("pagehide", onPageHide);
  return () => {
    doc.removeEventListener("visibilitychange", onVisibility);
    win.removeEventListener("pagehide", onPageHide);
  };
}
