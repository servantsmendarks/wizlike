// UI-63 / UI-65 / UI-60（M8）: vite.config.ts のプラグイン wizlike-assets が作る仮想モジュール（ビルド時に検証した曲・効果音・絵の一覧）。
declare module "virtual:wizlike-assets" {
  const assets: import("./build/asset-types").GameAssets;
  export default assets;
}
