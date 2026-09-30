// data/*.json の検証失敗など、起動を止めるときのエラー画面（CLAUDE.md §3-5）。
// strings.json 自体が壊れている可能性があるので strings は使わず、見出しは英語の固定文にする。
// ステージのスケーリングには載せず、普通の DOM（システムの等幅フォント、スクロール可）で出す。

/** データ検証に失敗したときの見出し（既定）。 */
export const DATA_ERROR_HEADING = "Game data is invalid";
/** データ検証以外の起動時の例外の見出し。 */
export const STARTUP_ERROR_HEADING = "Startup failed";

export function renderDataError(root: HTMLElement, issues: readonly string[], heading: string = DATA_ERROR_HEADING): void {
  const box = document.createElement("div");
  box.className = "data-error";
  box.setAttribute("role", "alert");

  const h = document.createElement("h1");
  h.className = "data-error-heading";
  h.textContent = heading;
  box.appendChild(h);

  const count = document.createElement("p");
  count.className = "data-error-count";
  count.textContent = `${issues.length} issue(s)`;
  box.appendChild(count);

  const list = document.createElement("ul");
  list.className = "data-error-list";
  for (const issue of issues) {
    const li = document.createElement("li");
    li.textContent = issue;
    list.appendChild(li);
  }
  box.appendChild(list);

  root.replaceChildren(box);
}
