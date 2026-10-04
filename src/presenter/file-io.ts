// SV-30 / SV-31: 書き出しファイルの名前と保存（Blob と a[download]）、読み込みのファイル選択のボタン。
// モジュールのトップレベルでは DOM に触れない。タイマーを使わない（CLAUDE.md §2）。
import type { Rect } from "./layout";
import { formatUpdatedAt } from "./views/title";

/** SV-30: wizlike-{gameId の先頭 8 字}-{YYYYMMDD}-{HHmm}.json（端末のローカル時刻）（純粋） */
export function exportFileName(gameId: string, ms: number): string {
  const t = formatUpdatedAt(ms);
  return `wizlike-${gameId.slice(0, 8)}-${t.y}${t.mo}${t.d}-${t.hh}${t.mm}.json`;
}

/** 前回の書き出しの object URL（次の書き出しで revoke する） */
let lastUrl: string | null = null;

/**
 * SV-30: text を application/json の Blob にして a[download] で保存させる。
 * 前回の object URL はここで revoke する（タイマーを使わない。CLAUDE.md §2）
 */
export function downloadText(name: string, text: string): void {
  if (lastUrl !== null) URL.revokeObjectURL(lastUrl);
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  lastUrl = url;
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export type FileButton = {
  el: HTMLElement;
  setDisabled(d: boolean): void;
  /** キーボード（数字キー）用。disabled なら何もしない */
  open(): void;
};

/**
 * SV-31: 「読み込み」のボタン。ボタンの見た目の div（class ui-button）の上に、透明の <input type="file" accept="application/json,.json">
 * を全面に重ねる（tap.ts は INPUT の上の押下を追わず touchend も止めないので、タップでブラウザ本来のファイル選択が開く）。
 * この要素と祖先に onTap（data-tap）を付けない。open() はキーボード（数字キー）用で input.click() を呼ぶ。
 * change でファイルを 1 つ onFile に渡し、input.value を "" に戻す（同じファイルを選び直せるように）。disabled なら input を disabled にし、見た目を dim にする
 */
export function createFileButton(o: { label: string; rect: Rect; onFile(f: File): void }): FileButton {
  const el = document.createElement("div");
  el.className = "ui-button";
  Object.assign(el.style, { position: "absolute", left: `${o.rect.x}px`, top: `${o.rect.y}px`, width: `${o.rect.w}px`, height: `${o.rect.h}px` });
  const label = document.createElement("span");
  label.textContent = o.label;
  el.appendChild(label);

  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  // display:none にしない（iOS でプログラムの click が効かない報告があるため）。font-size 16px は iOS のズーム対策の慣例
  Object.assign(input.style, {
    position: "absolute",
    left: "0",
    top: "0",
    width: "100%",
    height: "100%",
    opacity: "0",
    margin: "0",
    padding: "0",
    fontSize: "16px",
    cursor: "pointer",
  });
  input.addEventListener("change", () => {
    const f = input.files?.[0];
    input.value = "";
    if (f !== undefined) o.onFile(f);
  });
  el.appendChild(input);

  let disabled = false;
  const setDisabled = (d: boolean): void => {
    disabled = d;
    input.disabled = d;
    el.style.color = d ? "var(--c-dim)" : "";
    el.style.borderColor = d ? "var(--c-dim)" : "";
    if (d) el.setAttribute("aria-disabled", "true");
    else el.removeAttribute("aria-disabled");
  };

  return {
    el,
    setDisabled,
    open() {
      if (!disabled) input.click();
    },
  };
}
