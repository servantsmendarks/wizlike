// SV-10: gameId（UUID v4）。
// crypto.randomUUID は secure context でしか無い（vite --host の http の LAN アドレスでは未定義）ので、
// 無ければ getRandomValues から組む。

/** UUID v4 の小文字の文字列 */
export function newGameId(c: Crypto): string {
  if (typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
