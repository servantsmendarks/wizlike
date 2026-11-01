# PROGRESS.md — セッションの引き継ぎ（2026-11-01。M26「遊びやすさ v9」完了、M26 の判断点へのユーザーの返事・「対象の行の表示の直し」・「帯の順の直し」を反映・push 済み）

次のセッションがこれだけ読めば再開できるように書く。設計の正は CLAUDE.md、`docs/spec/*.md`、`docs/decisions.md`、`docs/milestones.md`、`docs/balance.md`、`docs/checklist.md`。ここには「どこまで来たか」「何が決まっているか」「次に何をするか」だけを置く。

## 0. 今の状態（1 分で）

- **M26 は完了（2026-11-01。最後の記録は 413b174）。同日、M26 の判断点へのユーザーの返事を反映（fe623ef・5037203・d7a2784。ここまで push 済み）し、続けてユーザーの指示「対象の行の表示の直し（小コミット）」を実装した: 735195b（core(M26)。状態 1 つ・治す呪文優先・（傷はない）廃止。コード・テスト・データ・仕様・decisions・milestones・checklist を 1 コミット）・4043f8b（レビューの修正）・1fb7f8e（実機の記録。docs）・0d7331a（PROGRESS）。続けてユーザーの返事で帯の順を直した: 4f4c084（presenter(M26)。severity を 石 痺 眠 毒 に変え、帯も config の順）・56ff5ee（記録の表記の修正）。その次がこの PROGRESS.md のコミットで、そこまで push 済み。** 配信の確認は §2 の 2（手順は §2 の 4）。
- 検証: HEAD（56ff5ee）で `npm run typecheck` と `npm test`（79 ファイル・2957 件）が通る（オーケストレーターが手元で確認）。対象の行の直しのレビュー A（コードとテスト）・B（文書）の指摘 4 件（A-1 戦闘の道具から targets を引く経路のテストが無い、A-2 targetRowStatus の引数が構造型、B-1 ui.md UI-54 に `battleMenu.allies[].status` が残る、B-2 magic.md MG-44 の targets の形）はすべて反証を通り、4043f8b で修正。帯の順の直しのレビューの指摘は 1 件（decisions の追記の麻痺の表記）で 56ff5ee で修正。`npm run build` は実機の固定コピー（735195b）で通った。
- `save.schemaVersion` は 12 のまま（M26 の `BattleState.fleeTried?: true` は省略可能の欄。移行なし。対象の行の直しも state を変えない）。
- 次のマイルストーンはまだ決まっていない。M26 の判断点はすべて返事済み（§1 の 7。longtask の比較だけ返事なしで要観察のまま）。対象の行の直しで出た判断点（帯と対象の行の 眠・毒 の順。§1 の 8）は同日に返事があり反映した（§1 の 9）。次の指示を待つ。

## 1. M26 で決めたこと・分かったこと

1. 依頼は束 v9 の 8 項目（原文は milestones の M26 の節）。設計書（scratchpad の m26-design.md。§6 が確定した設計）を見せてから実装した。判断点 9 件はすべて推奨どおりで、追加の指示が 2 つ: 門番は取り巻きを足さず「10d8+20・攻撃 3 回（2d6・2d6・1d8）」、ボス戦の計測の条件は「満タン・初期装備・オートで 1 階に入った直後」で、実戦はこれより重い旨を balance.md に注記。
2. 依頼の前提と違った事実: 方角の一言は「多め」のときだけにすでになっていた（変えたのは歩数だけ）、150 は過去に使った値ではない、階段の印は点滅していなかった（点滅は新設）、勝利のジングルの列に levelUp は無い、「AU」の仕様 ID は無い（UI-06 の追補として UI-06b を新設）。
3. 実装（コミット。第 2 段の Workflow。担当 10 人 → レビュー A core・B 表示と音・C 文書とテスト・D 音 → 反証 → 修正）:
   - A-1 2dc66ed: `battle.noChest` の文とキーを廃止（箱が出なければ何も言わない）。乱数と noChestStreak は不変。
   - A-2 ac96f66・a7d83be: `dungeons[].lostHintSteps` を d01 100・d02/d03 150【仮】（balance.md「M26 の数値」）。長押しの前進（repeater）は `forwardStep` の省略可能な `visible`（filterHints）で続行を判定し、GM の助言で出さない一言の歩では止まらない。自動歩行（walker）は不変。
   - 探索の計測(M26) 0ab34d9: d01 1F の中央値 nearest 74.5（M25 と同じ）・random-hint 176.5（M25 143。目安 150 前後より約 27 歩長い）、未踏の口の平均 3.9〜6.8。調整なし。
   - B-1 f440a27・c2f065b: core の対象の候補 allies に `status`。表示は新規 `src/presenter/views/ally-row.ts` の `allyRowLabel`（状態は STATUS_ORDER の順・半角空白区切り、39 単位を超えたら名前だけ fitName）。strings は `dungeon.items.allyRow` / `allyRowStatus` の 1 組をキャンプと戦闘で共用し、`battle.targetAlly` を消した（設計書の `battle.targetAllyStatus` は作っていない）。21 字の決まりは当てず 39 単位だけ（§1 の 6）。
   - B-2 45faf69: `BattleState.fleeTried?: true`（fleeRound の先頭で立てる。migrate の形の検査と SV-04 に追記）、`BattleMenu.fleePercent` は `number | null`、null なら `battle.cmd.flee`「逃げる」（未使用で残っていたキーが決着）、数なら `battle.cmd.fleeRate`。CB-50c 新設。core と表示層を 1 コミットにした（型の変更で分けると typecheck が通らない）。
   - C-1 bfb7700・46a95bb: audio.json の cue に `silenceAfter`（jingle のある cue だけ。victory・wipe・bossDefeated の clear）。sound-cues はジングルの直後に song null、wiped の間は screen の song も null。closeWipe はコードを変えず、内訳を閉じた後の syncControls の街の枝が街の曲を始める。audio.ts は変えていない。
   - C-2 12de0c4（+ 修正 e91179d）: UI-06b。`Track.queued` は {source, seg, at}、`begin(kind, cache, seg)`、`sceneSegAt`、`restartAfterResume`（印は restartDue 1 つ。pausedSeg と pausedSong を覚え、曲が替わっていれば区間 0 から）、`wake`（running でなければ resume）、unlock は hidden を下ろす。既存テスト 1 か所（隠れている間の unlock の resume の回数 0 → 1）を変えた。
   - D-1 e7c669f・ca050df: `MapCellKind` に boss / event（済んだイベント・倒したボスは floorOf で別の kind になるので消える。テレポーターは印なし）。印は ◇ orange（役 mapBoss）・○ violet（役 mapEvent）【仮】、BLINK_KEYFRAMES を選んだ枠と共用、`render(v, title, blink)`、`stopBlink`（closeMap で呼ぶ）。凡例 10 項目 5 列 × 2 行（LEGEND_COL_W 47）。DG-13 / DG-15 / UI-24 / UI-78。
   - E b07b543・19e71d2: `tests/balance/boss.sim.ts`（BALANCE_BOTS=boss。許す値の検査は 4 か所）。門番の甲冑 hp 6d8+10 → 10d8+20・攻撃 2 回 → 3 回。基準は Lv3・4・5 とも 100%、調整後は Lv3 61.5%（400 シード 67.3%）・Lv4 94.5%・Lv5 100%。片方だけでは約 96.5% で目安に届かないので同時に変えた。
   - レビュー: 確かめた指摘 10 件（mid 1 件 = 隠れている間に曲が替わったら区間 0 から、low 9 件）はすべて修正 e91179d・b06e16f。退けた 1 件 C-3（門番の hp を固定するテストが無い。モンスターの hp はテストで固定しない慣例）。
4. 計測(M26) 200 シード（1fe2e47。HEAD b06e16f で `BALANCE_SEEDS=200 npm run balance`、14 本通り、所要 983 秒）:
   - 4 戦固定・セオリー・農夫 9 通りは M25 と全行一致（ログの diff）。探索ボットとボス戦の計測は第 2 段の記録と一致。
   - 動いたのは進行ボットだけ。d01 のボス戦の勝ち 99.5% → 91.5%（212 戦で全滅 18）、門番による死者 23 → 175、d01 の全滅率 1.9% → 2.9%、踏破までの潜行の平均 5.6 → 6.8、踏破 196 → 194 シード。死者の増分 170 人のうち 152 人が門番で、門番の強化で説明できる。
   - d02 以降のずれ（d02 の踏破 97 → 106、d03 の踏破 0 → 3、d02 の潜行 1 の全滅率 1.0% → 2.6%）は、ボス戦で乱数の消費が変わった分という推測で未確認。説明できない差は無し。数値は触っていない。
   - 進行ボットのボス戦の勝ち 91.5% が boss.sim の Lv3 61.5% より高いのは、2 階を歩いて装備を更新してから挑み、再挑戦では強くなっているためと推測（レベル別の勝敗はログに無い）。
   - 記録: balance.md の「計測(M26)」「M26 終了時の基準値」、基準値の表に M26 の列（進行の行だけ M25 と違う）。
5. 実機(M26)（a8a73dd。版 1fe2e47・sw e9883c91c52bed37 の固定コピー m26-snap1 に console.log の目印。Pixel 3a・Android 12・Chrome 155）: **直すべき点は無し**（第 3 段の修正の担当は走らなかった）。
   - 済: A-1（勝利 5 回以上で「宝箱は無かった」0 件）。A-2（d01 1F は 99 歩まで出ず、100 歩目の長押しの前進で降り口の方角 N が 1 回、lostHintFloors [1]、「多め」の長押しは止まる。2F を「少なめ」にすると一言は出ず長押しは続き lostHintFloors [1,2]）。B-1（キャンプと戦闘の対象の行が「名前 HP n/m」、6 字の名前の満タンの行「アアアアアア HP 87/87（傷はない）」が dim のまま 1 行に収まる）。B-2（最初は「逃げる」、失敗の次から「逃げる 62%」、開き直しても保つ、次の戦闘で戻る、ボス戦は dim で率なし）。C-1（victory・wipe・clear の後は setSong null で schedule が出ず、迷宮に戻る／「街へ」で曲が seg 0 から）。C-2（迷宮の曲で HOME → 戻ると隠れた区間 k の頭から予約し直す。2 回。戦闘の曲の頭と無音の最中でも壊れない。音が聞こえるかは目印と AudioContext の state で代えた）。D-1（○ violet rgb(152,120,248)・◇ orange rgb(252,160,68) が視野に入った時点で出て、4 倍の拡大写真で床の darkGreen の上でも円と菱形に読める。点滅は印 1 つに animate 1 本・400ms、演出スキップ ON と閉じた後は 0 本。済んだ出来事と倒したボスの印は消える。凡例 5×2 は 16×16・20×20 とも地と重ならない）。
   - 性能: 操作中（歩行・旋回・地図を 6 秒開いて点滅）の longtask 0、console の warning・error・例外・外部通信 0（4080 行）。読み込み直後の longtask は再読み込み 3 回とも 1 本（88〜96ms）で、M25 の 0 本とは読み込みの条件が違い M26 由来かは未判別（要観察）。move・turn は CMD → PLAY の時間しか測れず M25 と比べていない。
   - 未: GM の助言「なし」の長押し、状態異常の行、HP 3 桁の「…」、○ と ◇ の同時の点滅、UI-06b のジングル最中の HOME・隠れている間の曲替え・resume 拒否、clear の後の語りの間の無音（どれも単体テストで固定済み）。iPhone の音の復帰は checklist の U-12（ユーザー）。
   - 記録: checklist の §4・§5・§11・§13・§14 に M26 の行、【未・ユーザー】に U-12。M19 の noChest・M22 の率の行は履歴のまま。
   - 決まりから外れた操作（報告済み）: 名前の入力に CDP の Input.insertText（作成画面の入力欄。adb の input text は日本語を送れない）、debug の Lv=・イベント・階段前・全員HP1、GM の助言を多め → 少なめ → なしと巡回、演出スキップの ON/OFF、全滅を 1 回。証拠は scratchpad の m26-dev1/。
6. **ユーザーへ返した判断点（2026-11-01 に返事あり。反映は 7）**:
   - 探索の random-hint 176.5 歩が目安「150 歩前後」より約 27 歩長い（nearest 74.5 は M25 のまま）。閾値 100 のまま許容するか、d01 を 80〜90 に戻すか。
   - 対象の行（B-1）は 39 単位だけで測り、21 字の決まりは当てていない（名前 6 字・HP 999/999・（傷はない）で 23 字・33 単位。21 字に合わせると状態のない行でも名前が 3 字まで削れる）。当てるなら ally-row.ts の詰める量の 1 か所。
   - 地図の印の形と色（◇ orange・○ violet【仮】）。担当は拡大写真で読めると判断した。最後はユーザーの目で決める（写真は m26-dev1 の m2-blink1-z.png・m5-boss-z.png・m3-legend.png）。
   - iPhone の音の復帰（PWA のホーム画面からの復帰。UI-06b。checklist の U-12）。
   - 読み込み直後の longtask（1 本 88〜96ms）を次の実機で旧版と同じ条件で比べるか。
7. **ユーザーの返事（2026-11-01）と反映**（Workflow: 実装 worker → 記録 default → レビュー explorer 2 本 → 反証 → 修正。指摘 0 件）:
   - (1) d01 の lostHintSteps 100 のまま許容。176.5 歩は記録のみ（balance「探索の計測(M26)」の結び・decisions・milestones に追記。【仮】は残す）。
   - (2) 対象の行にも 21 字の決まりを当てた（fe623ef）。`town.ts` に `LIST_ROW_CHARS = 21`（コードポイントの数。テストの `[...row].length <= 21` と同じ測り方）、`party-band.ts` に `textChars` と `fitName` の省略可能な第 4 引数 chars（既定 Infinity。他の呼び出しは不変）、`ally-row.ts` だけが単位と字数の両方の余りを渡す。詰めるのは名前だけで、名前以外だけで 21 字以上なら名前は「…」だけ（行は「…」の分だけ超える）。例: 「アアアアアア HP 999/999（傷はない）」→「アアア… HP 999/999（傷はない）」、「アアアアアア（石 痺 眠 毒）HP 999/999」→「ア…（石 痺 眠 毒）HP 999/999」、「アアアアアア HP 87/87（傷はない）」（21 字）は詰めない。既存テストの「ベルク（痺 毒）HP 16/16（傷はない）」は「ベ…（痺 毒）HP 16/16（傷はない）」になった（3 字の名前でも状態 2 つ + 理由で 1 字に詰まる。21 字の帰結で、ユーザーに報告済み）。仕様 UI-53（ui.md 221 行）・decisions・milestones の判断点の行・checklist の M26 の行（実機は未）を直した。
   - (3) 地図の印の形と色（◇ orange・○ violet）は【仮】のまま。遊んで気になれば所感で。
   - (4) iPhone の音の復帰は U-12 のままユーザーが確認する。
   - (5) longtask の比較は返事なし。要観察のまま。
8. **対象の行の表示の直し（2026-11-01 ユーザーの指示「小コミット」。Workflow: 実装 worker 1 本 → レビュー explorer 2 本 → 反証 3 本/件 → 修正 worker、実機 default 1 本は修正と並行 → 記録 default 1 本。担当 18 本・約 10 分）**:
   - 状態は core が 1 つ決める: `config.status.severity`【仮】= stone > paralysis > poison > sleep（石化 > 麻痺 > 毒 > 睡眠。validate.ts の severityField で STATUS_IDS の 4 つをちょうど 1 回ずつ。tests/data.test.ts）。`src/core/rules/status.ts` に `heaviestStatus` / `targetRowStatus`（新しいモジュールではなく tryInflictStatus のある既存の status.ts に足した）。治す呪文・道具（効果 cureStatus。解毒 cure_poison・解縛 unbind・解毒草 antidote_herb）の対象は治す状態だけを出し、無い者は null（括弧なし）。
   - 置き場: `allies[]` から status を外し（id・name・hp・hpMax だけ）、`campMenu` の `spells[].targets[].status`・`fieldItemMenu` の `items[].targets[].status`（`CampTargetView = AllyTargetView & { block }`）・`battleMenu` の `spells[]` / `items[]` に新設の `targets: AllyTargetView[]`（target が ally の呪文・品だけ。allies と同じ順）に載せる。理由: 治す呪文の優先が呪文ごとに違い、menu 共通の allies[] には置けない。表示層は id で結合するだけ（camp.ts の targetRow は CampTargetView を受け、battle-input.ts の case ally は cursor.pick の cast / item から m.spells / m.items の targets を引く。見つからなければ括弧なし）。
   - 「（傷はない）」廃止: 満タン（block fullHp）は dim だけ。strings の `camp.target.blocked` / `camp.targetBlock.fullHp` を削除、`allyRowLabel(strings, a)` の why 引数も無し。21 字（UI-52）・39 単位（UI-47）の fitName は安全網として残す（最悪の「アアアアアア（石）HP 999/999」は 19 字・28 単位で詰まらない。テストは名前 3 字・6 字 × 状態 5 通り × HP 3 通りの全探索）。
   - 記録: 仕様 ui.md の UI-53 の段落（221 行）と UI-54 の一覧の行、magic.md MG-44 の targets の形、decisions の 2026-11-01 の 2 行（直しと実機）、milestones 1675 行・1681 行、checklist 117 行・363 行の注記と新しい行（M26 対象の行の実機）。帯 party-band.ts の STATUS_ORDER のコメントも直した。
   - 実機(M26 対象の行)（1fb7f8e。版 735195b・sw 355e335158c3db1f の固定コピー rowfix-snap1。Pixel 3a・Android 12・Chrome 155・縦持ち）: 酒場 → 状態 → ドナ → 呪文 → 治癒 → 唱える の対象の段で「アルド HP 15/15」「アアアアアア HP 16/16」「キリ HP 10/10」…が全行 dim・1 行・溢れなし（6 字の行の文字幅 122px／行の幅 167px）、「（傷はない）」なし（写真 rowfix-dev1/rows_full_hp.png。オーケストレーターも目視）。debug「全員HP1」の後は dim が外れ 1 行のまま（rows_hp1.png は DOM の計測のみ）。未: 状態異常の括弧つきの行・治す呪文の優先・HP 3 桁（単体テストで固定済み）、迷宮の戦闘の対象の段。気づき: 酒場上部の帯では 6 字の名前が「アアアア…」（従来どおり。今回の対象外）。直すべき点なし（senior-worker は走らなかった）。後片付け済み（preview 停止・adb reverse/forward 解除・原点の storage 削除・ジャンクション解除）。
   - 判断点（→ 同日に返事あり。反映は 9）: 帯（UI-13。STATUS_ORDER = 石 痺 眠 毒）と対象の行（config.status.severity = 石 痺 毒 眠）で 眠・毒 の順が違っていた。
9. **帯の順の直し（2026-11-01 ユーザーの返事 = 判断点 8 への指示。Workflow: 実装 worker 1 本 → レビュー explorer 2 本 → 反証 3 本/件 → 修正 worker。担当 13 本・約 4.5 分）**: 4f4c084・56ff5ee。
   - `config.status.severity`【仮】を 石化 > 麻痺 > 睡眠 > 毒（stone, paralysis, sleep, poison）に変えた（帯の従来の順に合わせた）。
   - 帯も同じ config の順: `party-band.ts` の STATUS_ORDER を削除し、`createPartyBand` の `o.severity` と `bandCell(ch, stage, strings, severity, levelUp)` で必須で受け取る（既定値なし）。呼び出し元は dungeon.ts だけで、`data.config.status.severity` を渡す。表示層は受け取った順で find するだけ。
   - テスト: tests/camp-view.test.ts「UI-13/UI-53 帯の印と対象の行の状態は同じ順（config.status.severity）」（STATUS_IDS の全部分集合 16 通りで bandCell の印 = heaviestStatus）と「campMenu の治癒の targets[].status を allyRowLabel に通した括弧の中 = 帯の印」（眠 毒 / 痺 毒 / 毒）。順を前提にした直前のテスト（camp・items・combat・data）は 眠 に直した。
   - 記録: ui.md の UI-13（44 行）と UI-53（221 行）、decisions 1 行、milestones 1681 行、types.ts・status.ts・party-band.ts のコメント。
   - 残り: パーティ欄の conditionText は付いた順のまま（対象外）。帯の印の順は実機で未。

## 2. 次の一手

1. 次の束の指示を待つ（M26 の判断点は返事済み。§1 の 7。帯の順も反映済み。§1 の 9）。対象の行の状態異常の行（括弧 1 つ・治す呪文の優先）と帯の印の順は実機で未（次の実機のついでに見る。checklist の M26 対象の行の実機の行の注記）。
2. 配信の確認: 735195b〜この PROGRESS.md の push の直後にオーケストレーターが 4 の手順で確かめる（結果はチャットで報告。未確認のまま終わっていたら次のセッションの冒頭で）。
3. 工房 make-assets の bank（銀行の絵と曲）は、シートの番号と design.md の承認を待っている（前から）。
4. push の後の配信の確認の手順:
   1. `gh run list --limit 4 --json headSha,status,conclusion` で完了を待つ。
   2. `curl -s https://servantsmendarks.github.io/wizlike/sw.js | grep -oE '[0-9a-f]{16}' | head -1` の版を取る。
   3. `GITHUB_SHA=$(git rev-parse HEAD) npm run build` で作った `dist/sw.js` の版と比べる。版はビルドの中身のハッシュで、buildId（sha の先頭 7 字）が入るので HEAD ごとに変わる。push した HEAD の sha で build すること。

## 3. 前から残っているもの

- 別の束の候補（milestones の候補の節）: 取り巻き付きのボス（データの形 `dungeons[].boss`、戦闘の枠 96×96 はグループ 1 つのときだけ、48 の絵は工房）、線画（一人称）のボスとイベントの印、倒した後のテレポーターの印、強くした門番の報酬（exp 400・gold 据え置き）、audio.ts の pageshow / onstatechange、装飾品（護符）の基礎の効果、v4 の (a) 呪われた触媒の印、(b) 呪文を使えなかった戦闘の割合、d02 の盤 18×18。
- パーティ欄の conditionText は状態を付いた順に並べ、帯と対象の行（重さの順）と並びが違う（前からの食い違い。B-1 の担当の報告。milestones の M26 の残したもの）。帯と対象の行の順は 2026-11-01 の帯の順の直しで揃えた（config.status.severity を共用。§1 の 9）。残るのは conditionText の付いた順だけ。
- M24 の実機で未のもの: C-3 護符の詳細（店に装飾品が無い）、D-1 の広げた後（debug に金のボタンが無い）、E-2 の lastSynced、司教の鑑定、人の指での「決める」。
- テストプレイの 2026-10-25 の D-1〜D-3・E-1 は checklist と docs/playtest に未取り込み（426ecd34 の scratchpad の m25-survey_history.md に要点）。
- M23 の見送り: hpWarn を宝箱の手でも出す、古い `dive.poisonWarned`、前進ボタンと「戦う」の重なり。
- 実機で未のまま残した M22 の項目（A-2 の「危ない（HP n/m）」、A-4 の帯の強調の写真、D-5 の点滅、金額が行末にかかる 2 行の文、iOS の NBSP）。A-3 の dim の率は M26 で率そのものを試した後だけにした。
- M25 の実機で未: 上質の行、司教の鑑定の行の色。GM の助言「少なめ」は M26 の実機で済（「なし」は未）。

## 4. 注意点（常設の指示。ユーザーの CLAUDE.md が優先）

### 進め方
- ユーザーへの応答は日本語（2026-10-25 ユーザー）。
- PROGRESS.md はリポジトリで追跡し、オーケストレーターだけが書いてコミットする（担当は触らない）。Workflow の COMMON には「PROGRESS.md はオーケストレーターだけが書く」「コミットの後に git status が空」と書く（M26 から）。
- 役割はオーケストレーター。実装は worker / senior-worker、調査は explorer、それ以外は default に委譲する。ultracode は ON（束の作業は Workflow で回す）。
- 貼り付けの指示は確認せずに実行する。聞くのは本当の判断点だけ。
- サブエージェントは push しない。push はオーケストレーターが行う（push = 配信。移行を含む版は実機の後に push する。M26 は移行なし）。
- Workflow に途中で項目を足すとき: 完了済みの prompt はバイト単位で変えず、新しいスクリプトのファイルで `resumeFromRunId` する（memory の workflow-stop-resume.md）。prompt はテンプレートリテラルなので中にバッククォートを書かない。
- Workflow の結果は tasks/<id>.output の JSON（{summary, agentCount, logs, result, …} の包み。`result` が担当ごとの map。文字列なら JSON として読む）を `python -X utf8 -I` で担当ごとに scratchpad の m26-s2_*.md / m26-s3_*.md に分けて読んだ。Bash の出力が 32KB を超えるとファイルに退避されるので、報告は 3〜4 本ずつ cat する。
- M26 の判断の反映の Workflow（2026-11-01。小さい束の雛形）: 実装 worker 1 本（コード・テスト・仕様・decisions・milestones・checklist を 1 コミット）→ 記録 default 1 本（docs だけ 1 コミット）→ レビュー explorer 2 本（A コードとテスト・B 文書の整合。schema で findings）→ 指摘ごとに反証 explorer 3 本（2 本以上が退けたら落とす）→ 確かめられた指摘だけ worker が修正。script は m26-decisions-followup-wf_17783a96-5a1.js（§5）。
- 対象の行の直しの Workflow（2026-11-01。小さい束 + 実機の雛形）: 実装 worker 1 本（1 コミット）→ レビュー explorer 2 本（A コードとテスト・B 文書）→ 指摘ごとに反証 explorer 3 本（correctness・spec・repro の観点。2 本以上が退けたら落とす）→ 確かめられた指摘だけ worker が修正、これと実機 default 1 本（実装のコミットの固定コピー。構造化出力の fixes）を parallel で並行 → fixes が空でなければ senior-worker → 記録 default 1 本（実機の結果を decisions と checklist に。docs だけ 1 コミット）。オーケストレーターは差分・写真・typecheck・npm test を手元で確かめてから PROGRESS.md を書く。script は ally-row-fix-wf_39bebeae-5c4.js（§5）。同じ形から実機を抜いたのが帯の順の直し（実装 → レビュー 2 本 → 反証 → 修正。13 本・約 4.5 分。script は band-severity-wf_7cc44953-ceb.js）。
- M26 の Workflow の形（雛形。M25 と同じ）: 調査（explorer 9 本）→ 設計書を見せて承認 → 第 2 段 = docs の節 → 実装の群を順に（同じ作業ツリーで 1 人ずつコミット）→ 探索の再計測 → レビュー A/B/C/D を pipeline で review → verify（反証）→ 確かめられた指摘だけ fix（各コミットの typecheck も fix の担当が確かめる）。第 3 段 = 計測 200 → 実機 → 直すべき点があれば senior-worker で修正（実機の担当の structured output の `fixes` が空なら走らない）→ 閉じる。実機が止まったら閉じる担当は「実機待ち」にする。script は m26-survey-wf_76f60f0a-c1f.js・m26-stage2-wf_c1a90282-a6b.js・m26-stage3-wf_c95a684f-35c.js。
- senior-worker の担当メモリは `.claude/agent-memory/senior-worker/`（リポジトリの中。`.git/info/exclude` 済み。M26 で lost-hint・ally-row・flee-tried・jingle-silence・audio-resume・map-marks・boss-sim・commit-typecheck-check を追加）。
- リポジトリの git の email は `297947290+servantsmendarks@users.noreply.github.com`。コミットは `領域(Mnn): …`、末尾に Co-Authored-By（ハーネスの指定どおり。担当ごとに名前が違ってよい）。各コミット単体で typecheck が通ること。仕様・テスト・データは同じコミット。decisions は追記のみ。
- 計測: `BALANCE_SEEDS=200 npm run balance`（約 16 分）。`BALANCE_BOTS=farm|progress|f1|explore|boss` で絞れる。探索ボットだけなら約 20 秒、ボス戦だけなら約 6 秒。

### 実機（Pixel 3a、serial 03JAYV28J3、Android 12、Chrome 155）
- URL は `adb shell am start -a android.intent.action.VIEW -d <URL> com.android.chrome` でだけ開く。Chrome の UI をタップしない。keyevent 4 を送らない。`adb shell settings` / `wm` を使わない。ホームへは `am start -a android.intent.action.MAIN -c android.intent.category.HOME`、Chrome へ戻すのは `am start -n com.android.chrome/com.google.android.apps.chrome.Main`（音の復帰の確認に使った）。
- adb が `unauthorized` のときは担当を止め、ユーザーに USB デバッグの許可を頼む（2026-10-25 に一度あった。2026-11-01 は device）。
- CDP は読み取り専用。許されるのは、自分の原点の後片付けと、固定コピーへの console.log の目印だけ。タイトルの「書き出し」「読み込み」「削除」はタップしない。端末の担当は同時に 1 人。
- 固定コピー: `git archive <sha>` + node_modules のジャンクション（`MSYS_NO_PATHCONV=1 cmd /c mklink /J`。`cmd //c` では作れない）。外すときは PowerShell の `.ps1` で LinkType が Junction のものだけ `.Delete()`。rm -r は使わない。
- SW / オフラインは `adb reverse tcp:<port>` + `http://localhost:<port>/wizlike/`。preview は `--host 127.0.0.1 --strictPort`。
- 使ったポート: 5262〜5270、9315〜9319。**次に空いているのは 5271 / 9320。**
- 道具の最新は対象の行の直しのセッションの scratchpad の rowfix-tools（m26-snap1-tools を 5270 / 9319 に置換したもの。§5）。debug パネル: 全員HP1・箱:{罠}・warp・呪いの品・Lv=（5 → 8 → 11 と循環）・イベント・階段前、2 頁目に「希少の品」「伝説の品」。金のボタンは無い。
- 日本語の名前の入力は adb の input text では送れない。M23 はひらがなを keyevent で、M26 は作成画面の入力欄に CDP の Input.insertText で入れた（ゲームの状態は変えない）。

### 工房とテストプレイ
- 工房 `D:\01_Data\projects\Python\make-assets` は、【make-assets】の見出しがあるときだけ触る。
- テストプレイの repo `D:\01_Data\projects\Other\wizlike_testplay` は読むだけ。全画面のテストプレイは止めたまま。

## 5. 場所

- 対象の行の直しのセッション（2026-11-01）: scratchpad は `C:\Users\shin\AppData\Local\Temp\claude\D--01-Data-projects-TypeScript-wizlike\dadd0988-d464-401e-8e9c-e2ddc4150eee\scratchpad`（rowfix-tools（実機の道具）・rowfix-snap1（735195b の固定コピー）・rowfix-dev1（写真 rows_full_hp.png・rows_hp1.png））。Workflow のスクリプト: `C:\Users\shin\.claude\projects\D--01-Data-projects-TypeScript-wizlike\dadd0988-d464-401e-8e9c-e2ddc4150eee\workflows\scripts\ally-row-fix-wf_39bebeae-5c4.js` と、同じフォルダの `band-severity-wf_7cc44953-ceb.js`（帯の順の直し）。
- 判断の反映のセッション（2026-11-01）: scratchpad は `C:\Users\shin\AppData\Local\Temp\claude\D--01-Data-projects-TypeScript-wizlike\4d039b64-322b-4985-beb3-af74f5c547f3\scratchpad`（progress-edit.py だけ）。Workflow のスクリプト: `C:\Users\shin\.claude\projects\D--01-Data-projects-TypeScript-wizlike\4d039b64-322b-4985-beb3-af74f5c547f3\workflows\scripts\m26-decisions-followup-wf_17783a96-5a1.js`。
- M26 のセッションの scratchpad: `C:\Users\shin\AppData\Local\Temp\claude\D--01-Data-projects-TypeScript-wizlike\3485c273-9d66-4d64-a445-a09b9cff23bf\scratchpad`
  - m26-request.md（依頼の原文）、m26-design.md（設計書。§4b 返事、§6 確定した設計）、m26-reply.md（返事の原文）、m26-survey_*.md（調査 9 本）
  - m26-boss-grid.mts と m26-boss-probe*.mts（門番の格子の試算 12 案）
  - m26-s2_*.md（第 2 段の各担当・レビュー）、m26-s3_*.md（第 3 段の measure・device・close）、m26-dev1/（実機の証拠。写真と mon.log・perf-reload*.json）、m26-balance.log と m26-balance.noansi.log、m26-explore-after.log、m26-boss-*.log
- 前のセッション（M25）の scratchpad: `C:\Users\shin\AppData\Local\Temp\claude\D--01-Data-projects-TypeScript-wizlike\bd596dad-c436-47d4-a930-d5cc468dddae\scratchpad`（m25-balance.noansi.log、m25-snap1-tools）
- Workflow のスクリプト: `C:\Users\shin\.claude\projects\D--01-Data-projects-TypeScript-wizlike\3485c273-9d66-4d64-a445-a09b9cff23bf\workflows\scripts\`
- 記録: milestones の M26 の節（完了）、decisions の 2026-11-01 の行、balance.md の「探索の計測(M26)」「ボス戦の計測(M26-基準)」「ボス戦の計測(M26)」「目安と調整の順（M26）」「計測(M26)」「M26 終了時の基準値」「M26 の数値」、checklist の M26 の行と U-12。
