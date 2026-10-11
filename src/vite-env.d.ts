// UI-57 / SV-40（M18。設計 5-11）: vite.config.ts の define が埋め込むビルドの版（英小文字の 16 進 7 字か "dev"）。表示層の設定画面だけが読む（core では使わない）。
declare const __WIZLIKE_BUILD__: string;
