# PROGRESS.md — セッションの引き継ぎ（2026-10-25。M25「階段探しと触媒の印」完了・push 済み）

次のセッションがこれだけ読めば再開できるように書く。設計の正は CLAUDE.md、`docs/spec/*.md`、`docs/decisions.md`、`docs/milestones.md`、`docs/balance.md`、`docs/checklist.md`。ここには「どこまで来たか」「何が決まっているか」「次に何をするか」だけを置く。

## 0. 今の状態（1 分で）

- **M25 は完了（2026-10-25）。HEAD e98233f（master、push 済み。3f5b9d4..e98233f の 12 コミット）。** 配信の確認は §2 の 3。
- 検証: e98233f で `npm run typecheck` と `npm test`（79 ファイル・2917 件）が通る。各コミット単体の typecheck も確認済み（第 2 段の修正の担当）。
- `save.schemaVersion` は 12（M25 で 11 → 12。migrateV11toV12 が潜行中の記録に dive.board {20,20} と dive.lostHintFloors [] を入れる）。
- 次のマイルストーンはまだ決まっていない。M25 の判断点（§1 の 5）はユーザーの返事で決着した（7585df9 で記録）。次の指示を待つ。
- 未 push: 0a26734（PROGRESS.md の追跡）・7585df9（判断の記録）と、この PROGRESS.md の更新のコミット。push はユーザーの指示を待つ。

## 1. M25 で決めたこと・分かったこと

1. 群 0（UI-84 符号を ASCII の -、CH-61 レベルアップの文）と第 1 段（探索ボット tests/balance/explore.ts、計測 2 回）は前のセッション。
2. ユーザーの返事（判断点 10 個。原文は milestones の M25 の節と scratchpad の m25-reply.md）: 判断 5 だけ推奨と違い、閾値は `dungeons[].lostHintSteps`（d01 50・d02/d03 100）。
3. 実装（コミット）:
   - A-1 f4351a7: d01 16×16、`Dive.board`（入場で記録。floorOf はこれで盤を作る）、v12。d01 16×16 は 100000 シードで生成の Error 0。DIVE_HASH の d02/d03 は不変、旧 d01 は `d01@20x20` として残した。DG-05 の d01 の範囲 30〜80。
   - A-2 fe394ba: 方角の一言は各潜行・各階で 1 回（`Dive.lostHintFloors`。オーケストレーターの判断: 設計書の「新しい状態は不要」は階の出入りと転移を見落としていた）。ボスの階は `hint.lostBossDir.*`（倒した後は出ない）。`lostHintDirection`・`hint.lostExits`・HINT_IDS の lostExits・`config.dungeon.lostHintSteps` は廃止。tellHintOnce は使わない。キーは hint. なので GM の助言の設定に従う。
   - B-1 0742df1・9f7cbd6: `config.economy.upgradeCatalystWarnFrom` "rare"【仮】、触媒の候補に rarity / warn、★（`town.upgrade.mark.rare`）、付けたときだけ赤の `town.upgrade.catWarn`。
   - 4d36156: debug パネル 2 頁目に「希少の品」「伝説の品」（`debug.giveRare`。実機で ★ を確かめるため）。
4. 計測:
   - 探索の計測(M25)（0942e06）: d01 1F の中央値 nearest 74.5 / random-hint 143（M25 前 122.5 / 約 291）、未踏の口の平均 3.9〜4.6。d02/d03 のボスでない階は基準と同じ。
   - 計測(M25) 200 シード（496534d）: d01 を通らない農夫 d02 1F は M24 と全行一致（乱数の順は不変）。d01 系は盤で説明（進行の d01 の踏破までの潜行 9.3 → 5.6 など）。説明できない差は無い。balance の判定は全部通過。「M25 終了時の基準値」の列を足した。
   - 実機(M25)（485b831、Pixel 3a）: 移行 v11 → v12（旧版で d01 に潜った記録が 20×20 の盤のまま続く）、16×16 の地図、50 歩の一言（1F 南東・2F ボス南西。自動歩行は止まらない）、★ と赤の一言、解呪した品を外せる、性能（move 11.8ms・turn 11.5ms、longtask 0）。未: GM の助言「少なめ」（50 歩を歩く間に全滅）、上質の行（debug で作れない）、司教の鑑定の色（司教がいない）。どれも単体テストで固定済み。
5. **ユーザーの判断（2026-10-25。決着。milestones の M25 の節・balance.md・decisions に記録 7585df9）**:
   - d01 1F の nearest 74.5 は許容（最寄りの口へ歩く人が早く着くだけ。目安は random-hint の 143 で満たす）。
   - 農夫 d01 1F の目安の超過 2 つ（Lv5 の 15 分の品 15.4、Lv8 の満杯 16.0%）は誤差として記録のみ。数値は変えない。
   - d02 の盤 18×18 は d01 を遊んでから（milestones の候補の節に残す）。
   - 見送った低の指摘 B-2: decisions の 1726 行付近の行の頭に「- 」が無い（追記のみなので直していない）。

## 2. 次の一手

1. 次の指示を待つ（M25 の判断は決着済み）。
2. 工房 make-assets の bank（銀行の絵と曲）は、シートの番号と design.md の承認を待っている。
3. push の後の配信の確認の手順:
   1. `gh run list --limit 4 --json headSha,status,conclusion` で完了を待つ。
   2. `curl -s https://servantsmendarks.github.io/wizlike/sw.js | grep -oE '[0-9a-f]{16}' | head -1` の版を取る。
   3. `GITHUB_SHA=$(git rev-parse HEAD) npm run build` で作った `dist/sw.js` の版と比べる（e98233f の版は f7142c8325d1f15b）。

## 3. 前から残っているもの

- 別の束の候補（milestones の候補の節）: 装飾品（護符）の基礎の効果、v4 の (a) 呪われた触媒の印「（呪い）」と語り（★ と両方付くと行が 39 単位を超えるので縮め方が要る）、(b) 呪文を使えなかった戦闘の割合、d02 の盤 18×18。
- M24 の実機で未のもの: C-3 護符の詳細（店に装飾品が無い）、D-1 の広げた後（debug に金のボタンが無い）、E-2 の lastSynced、司教の鑑定、人の指での「決める」。解呪した品の取り外しは M25 の実機で済。
- テストプレイの 2026-10-25 の D-1〜D-3・E-1（階段が見つからない など）は checklist と docs/playtest に未取り込み（前のセッションの m25-survey_history.md に要点）。
- M23 の見送り: hpWarn を宝箱の手でも出す、古い `dive.poisonWarned`、前進ボタンと「戦う」の重なり。
- `battle.cmd.flee` は未使用のキーとして残っている（消すかはユーザー）。
- 実機で未のまま残した M22 の項目（A-2 の「危ない（HP n/m）」、A-3 の dim の率、A-4 の帯の強調の写真、D-5 の点滅、金額が行末にかかる 2 行の文、iOS の NBSP）。C-1 の方角は M25 の実機で見た。

## 4. 注意点（常設の指示。ユーザーの CLAUDE.md が優先）

### 進め方
- ユーザーへの応答は日本語（2026-10-25 ユーザー）。
- PROGRESS.md はリポジトリで追跡する（2026-10-25 ユーザー: 「PROGRESS.md も commit してよい」）。Workflow の COMMON に書いてきた「PROGRESS.md は追跡しない」「コミットの後に git status が ?? PROGRESS.md だけ」は、「PROGRESS.md はオーケストレーターだけが書く（担当は触らない）」「コミットの後に git status が空」に直す。
- 役割はオーケストレーター。実装は worker / senior-worker、調査は explorer、それ以外は default に委譲する。ultracode は ON（束の作業は Workflow で回す）。
- 貼り付けの指示は確認せずに実行する。聞くのは本当の判断点だけ。
- サブエージェントは push しない。push はオーケストレーターが行う（push = 配信。移行を含む版は実機の後に push した）。
- Workflow に途中で項目を足すとき: 完了済みの prompt はバイト単位で変えず、新しいスクリプトのファイルで `resumeFromRunId` する（memory の workflow-stop-resume.md）。prompt はテンプレートリテラルなので中にバッククォートを書かない。
- Workflow の結果は tasks/<id>.output の JSON の result を、python（`python -X utf8`）で担当ごとに scratchpad の m25-s2_*.md / m25-s3_*.md に分けて読んだ。
- M25 の Workflow の形（雛形）: 第 2 段 = docs → 実装の群を順に → 探索の再計測 → レビュー A（core・セーブ）/ B（文書）/ C（テストの意図）を pipeline で review → verify（反証）→ 確かめられた指摘だけ fix（各コミットの typecheck も fix の担当が確かめる。explorer はジャンクションを作れない）。第 3 段 = 道具 → 計測 200 → 実機 → 閉じる。実機が止まったら閉じる担当は「実機待ち」にする。
- senior-worker の担当メモリは `.claude/agent-memory/`（リポジトリの中。`.git/info/exclude` 済み）。
- リポジトリの git の email は `297947290+servantsmendarks@users.noreply.github.com`。コミットは `領域(Mnn): …`、末尾に Co-Authored-By（ハーネスの指定どおり。担当ごとに名前が違ってよい）。各コミット単体で typecheck が通ること。仕様・テスト・データは同じコミット。decisions は追記のみ。
- 計測: `BALANCE_SEEDS=200 npm run balance`（約 15 分）。`BALANCE_BOTS=farm|progress|f1|explore` で絞れる。探索ボットだけなら約 20 秒。

### 実機（Pixel 3a、serial 03JAYV28J3、Android 12、Chrome 155）
- URL は `adb shell am start -a android.intent.action.VIEW -d <URL> com.android.chrome` でだけ開く。Chrome の UI をタップしない。keyevent 4 を送らない。`adb shell settings` / `wm` を使わない。
- adb が `unauthorized` のときは担当を止め、ユーザーに USB デバッグの許可を頼む（2026-10-25 に一度あった）。
- CDP は読み取り専用。許されるのは、自分の原点の後片付けと、固定コピーへの console.log の目印だけ。タイトルの「書き出し」「読み込み」「削除」はタップしない。端末の担当は同時に 1 人。
- 固定コピー: `git archive <sha>` + node_modules のジャンクション（`MSYS_NO_PATHCONV=1 cmd /c mklink /J`。`cmd //c` では作れない）。外すときは PowerShell の `.ps1` で LinkType が Junction のものだけ `.Delete()`。rm -r は使わない。
- SW / オフラインは `adb reverse tcp:<port>` + `http://localhost:<port>/wizlike/`。preview は `--host 127.0.0.1 --strictPort`。
- 使ったポート: 5262〜5268、9315〜9317。**次に空いているのは 5269 / 9318。**
- 道具の最新は scratchpad の m25-snap1-tools（M24 の m24-snap1-tools を 5268 / 9317 に置換したもの）。debug パネル 2 頁目に「希少の品」「伝説の品」。debug の「Lv=」は 5 → 8 → 11 と循環する。金のボタンは無い。

### 工房とテストプレイ
- 工房 `D:\01_Data\projects\Python\make-assets` は、【make-assets】の見出しがあるときだけ触る。
- テストプレイの repo `D:\01_Data\projects\Other\wizlike_testplay` は読むだけ。全画面のテストプレイは止めたまま。

## 5. 場所

- このセッションの scratchpad: `C:\Users\shin\AppData\Local\Temp\claude\D--01-Data-projects-TypeScript-wizlike\bd596dad-c436-47d4-a930-d5cc468dddae\scratchpad`
  - m25-design.md（設計書の写し。§4b 返事、§6 確定した設計）、m25-reply.md（返事の原文）、m25-request.md
  - m25-s2_*.md / *.json（第 2 段の各担当）、m25-s3_*.md（第 3 段）、m25-dev1/（実機の証拠）、m25-balance*.log、m25-explore-after.log
- 前のセッションの scratchpad（第 1 段・調査）: `C:\Users\shin\AppData\Local\Temp\claude\D--01-Data-projects-TypeScript-wizlike\426ecd34-d994-4503-94f0-82d5b0b80257\scratchpad`（m25-survey_*.md、explore-probe/）
- Workflow のスクリプト（`C:\Users\shin\.claude\projects\D--01-Data-projects-TypeScript-wizlike\bd596dad-c436-47d4-a930-d5cc468dddae\workflows\scripts\`）: m25-stage2-wf_09379e81-6aa.js、m25-stage3-wf_ce30702f-1d7.js、m25-stage4-wf_623fb6ef-0fb.js（実機 + 閉じる）。
- 記録: milestones の M25 の節（完了）、decisions の 2026-10-25 の M25 の行、balance.md の「探索の計測(M25)」「計測(M25)」「M25 終了時の基準値」「M25 の数値」、checklist の M25 の行。
