# wizlike（仮称）

Wizardry ライクのスマホ向けローグライク RPG。ブラウザ（PWA）で動く。

## 中身

- `CLAUDE.md` — 設計の憲法と Claude Code 向けの作業手順。まずこれを読む。
- `docs/decisions.md` — 決定の記録。覆すときは追記で。
- `docs/milestones.md` — 作業の順番（M0〜M6）と完了条件。
- `docs/spec/` — 領域ごとの仕様。ルール ID（CH-01 など）はテスト名と対応させる。
- `data/` — コンテンツと調整値。コードにハードコードしない。

## 着手のしかた

1. このディレクトリを git リポジトリにする（`git init`）。
2. Claude Code をこのディレクトリで起動し、最初の指示は次の一文でよい。
   「CLAUDE.md と docs/ を読んで、docs/milestones.md の M0 から始めてください。」
3. マイルストーンごとに実機（iPhone / Android の縦持ち）で触り、`docs/decisions.md` の「動かしてから決めるもの」を埋めていく。

## 仕様の直し方

- 数値を変えたいだけなら `data/config.json`。
- ルールを変えるなら `docs/spec/*.md` の該当 ID を書き換え、対応するテストとデータも同じコミットで直す。
- 方針を変えるなら `docs/decisions.md` に「〜を撤回」と一行追記してから。
