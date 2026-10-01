// 比率の丸め（TW-04 の宿屋の回復、TW-22 の金と EXP の損失、TW-23 の復活の HP）。
// 浮動小数の誤差で 1 ずれないように、floor は +1e-9、ceil は −1e-9 してから丸める（growth.expFor の +1e-9 と同じ流儀）。
// 例: 100 × 0.07 = 7.000000000000001 なので素の Math.ceil では 8、100 × 0.29 = 28.999999999999996 なので素の Math.floor では 28 になる。

/** floor(x × r)。誤差で 1 小さくならないように +1e-9 する */
export function floorRatio(x: number, r: number): number {
  return Math.floor(x * r + 1e-9);
}

/** ceil(x × r)。誤差で 1 大きくならないように −1e-9 する。x × r が 0 のときの -0 は + 0 で 0 にする（state に -0 を入れない） */
export function ceilRatio(x: number, r: number): number {
  return Math.ceil(x * r - 1e-9) + 0;
}
