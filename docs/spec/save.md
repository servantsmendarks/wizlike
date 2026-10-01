# セーブ仕様（SV）

## 1. 原則

- SV-01 オートセーブのみ。手動セーブ、手動ロード、複製、スロット間コピーの UI は存在しない。
- SV-02 保存の契機は「状態を変えるコマンドの直後」。`execute` が返した新しい `state` を、表示層がイベント再生を始める前に保存する（再生中にリロードされても結果は確定している）。
- SV-03 `GameState` はそのまま JSON にできる（CLAUDE.md §3-11）。乱数の状態（`state.rng`）も含めて保存する。リロード後に同じコマンドを打てば同じ結果になる。
- SV-04 読み込み時に `schemaVersion` を見て移行する（`src/save/migrate.ts`）。移行関数は版ごとに 1 つ、順に適用する。移行関数の列の長さは `schemaVersion − 1`。新しすぎる版は読み込まない。移行後に `GameState` の形を最小限で検査し（`screen` が town / dungeon / battle、`party` が 1 件以上、`screen` と `battle` / `townVisit` の対応など）、通らなければ読み込まない。移行したレコードは書き戻さず、次のオートセーブで上書きする。

## 2. ゲーム（スロット）

- SV-10 「スロット」= 独立した別のゲーム。各ゲームは `gameId`（UUID v4、`crypto.randomUUID()`）を持つ。`crypto.randomUUID` が無い環境（secure context でない http の LAN など）では `crypto.getRandomValues` から UUID v4 を作る。
- SV-11 ゲーム数の上限は `config.save.maxGames`（5）【仮】。上限のときは新規作成できない（削除を促す）。
- SV-12 タイトル画面はゲーム一覧を出す: リーダー名、パーティの生存状況、クリア済みダンジョン数、最終更新日時。操作は「続きから」「新しく始める」「削除」「書き出し」「読み込み」。一覧は `updatedAt` の降順（同値は `gameId` の昇順）。生存状況は `aliveCount` / パーティの人数。読めない記録（壊れた・新しすぎる版）も一覧に出し、続きからはできないが削除はできる（上限の件数にも数える）。
- SV-13 同じデータを別のゲームとして保存する手段を作らない。`gameId` は不変で、保存は常に同じ `gameId` のレコードへの上書き。
- SV-14 削除は確認 2 段階。削除したゲームは復元できない。

## 3. 保存先

- SV-20 IndexedDB。データベース名 `wizlike`、オブジェクトストア `games`（キー `gameId`）と `settings`（キー `"settings"`）。
- SV-21 `games` のレコード: `{ gameId, schemaVersion, turn, updatedAt, summary: { leaderName, clearedCount, aliveCount }, state }`。`turn` は保存のたびに +1 する単調増加の番号。`summary` は一覧表示用で、`state` から作る。`turn` は game.new 直後の最初の保存で 1 にし、保存が成功するたびに +1（失敗では進めず、次の保存で同じ番号を試す）。`updatedAt` は保存時点の epoch ミリ秒。`leaderName` は `isLeader` の者の名前、`clearedCount` は `progress.clearedDungeons` の数、`aliveCount` は `life` が alive の人数。`gameId` と `turn` はセーブ側のメモリが持ち、`GameState` には入れない。
- SV-22 書き込みは `readwrite` トランザクションで 1 レコード丸ごと置き換える。部分更新はしない。
- SV-23 IndexedDB が使えない、または書き込みに失敗した場合は、画面上部に「保存できません」の帯を出し続ける。ゲームは続行できるが、その旨を明示する。
- SV-24 設定（`settings`）は `localStorage` に置いてもよい: `skipAnimations`、`textSpeed`、`inputMode`（swipe / buttons / both）、`volume`、`swipeThreshold`、`holdRepeatMs`（UI-31）。キーは `wizlike.settings` で、値はこれらの欄を持つ JSON。既定値は config（`ui.textSpeedMs`、`input.swipeThresholdPx`、`input.holdRepeatMs`）から取り、壊れた欄は既定値に戻す。`volume` は音を入れる M6 で足す。

## 4. 書き出しと読み込み

- SV-30 書き出しはゲーム 1 つを JSON ファイルにする: `{ format: "wizlike-save", gameId, schemaVersion, turn, exportedAt, state, checksum }`。`checksum` は `state` の JSON 文字列の SHA-256（改ざん検出ではなく破損検出）。
- SV-31 読み込みは同じ `gameId` のレコードへの上書きだけを行う。新しいゲームとしては作れない。`gameId` が一覧に無い場合は「このゲームの保存が無いため復元します」と表示して、その `gameId` で作成する（消してしまった保存の復元用）。上限 5 はこの場合も守る。
- SV-32 読み込むファイルの `turn` が既存レコードの `turn` より小さい場合は「古いデータです。進行が巻き戻ります」と警告し、明示的な確認を求める。
- SV-33 `checksum` が合わない、`format` が違う、`schemaVersion` が新しすぎる場合は読み込まない。
- SV-34 ブラウザである以上、開発者ツールでの複製までは防げない。この仕様は「正直に遊ぶ人が迷わない」ためのもので、対策ではない（決定の記録参照）。

## 5. 実機で守ること

- SV-40 iOS Safari のタブ表示では、長期間使わないサイトのストレージが消されることがある。タイトル画面に「ホーム画面に追加すると消えにくい」旨と書き出しの案内を出す。
- SV-41 保存は `visibilitychange`（`hidden`）でも念のため行う（直前のコマンドで保存済みなら何もしない）。
