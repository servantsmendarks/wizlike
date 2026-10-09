> 出典: make-assets の projects/wizlike/docs/proposal-to-game.md（053c2d0、2026-10-09 に複製）。工房の版が正。変更は工房から提案として来る。

# ゲーム側への提案（wizlike）

- 日付: 2026-10-05
- 宛先: wizlike のリポジトリ
- 状態: 提案（ゲーム側が採るまでは決定ではない）

工房（make-assets）はゲームのコードとデータ形式を変えない。ここに書くのはお願いで、採るか・どう実装するかはゲーム側が決める。
工房側の出典は `projects/wizlike/CONVENTIONS.md`（以下 CONV）と `projects/wizlike/docs/decisions.md`（2026-10-05 の「ゲーム側への提案」）。

## 背景

- 敵の絵は今、色付きの矩形で代用している。鑑定済みは `ENEMY_FILLS` を monsters.json の添字で巡回、未鑑定と未知の id は `dim`（src/presenter/views/battle.ts:65-71、src/presenter/palette.ts:41）。コメントに「PNG（public/sprites）は M3 では読まない」（battle.ts:11）。
- UI-60 はすでに `public/sprites/<monsterId>.png` と未鑑定の `<monsterId>_silhouette.png` を予定し、無ければ矩形で代用と書いている（docs/spec/ui.md:175）。
- 音: ゲームのソース（src、index.html、package.json）に zzfx・AudioContext・MIDI の実装は見当たらない（grep）。UI-06 は Web Audio を予定（docs/spec/ui.md:10）。M6 では音を入れないと決めている（docs/decisions.md:596）。BGM はプロトタイプ後（docs/milestones.md:134）。
- 工房の export は次へコピーする（tools/export.py、project.json の export）:
  - 曲 `music/final/<song>.mid` → `assets/music/`
  - 効果音 `music/sfx/params/<name>.json` → `assets/sfx/`
  - 怪物・ボスの `art/out/<id>.png` と `<id>_silhouette.png` → `public/sprites/`
  - 場面の絵 `art/out/<id>.png` → `public/town/`
  - ゲーム側のファイルは消さない。同じ名前は上書きする。

## お願い（項目ごと）

1. 絵の読み込み: `public/sprites/<id>.png` を敵の絵に使う。ファイルが無ければ今の色付きの矩形のまま（フォールバック）。
   - ファイル名は monsters.json の `id`。`sprite` 欄（Monster 型、src/core/data/types.ts:276）は今は 6 体とも id と同じ（data/monsters.json:4,12,20,28,37,46）。戦闘のビュー `EnemyGroupView` が持つのは `monsterId` だけ（src/core/types.ts:405-412）。`sprite` に id と違う値を使うなら知らせてほしい（工房のファイル名を合わせる）。
2. 大きさ: 工房の出力は怪物 48×48、ボス 96×96（project.json の `art.sizes`）。ボスは dungeons.json の `boss.monster`（今は gatekeeper_armor。data/dungeons.json:22,41）か tags に `boss` を含むもの（data/monsters.json:50）。ゲームの `special.boss: true`（data/monsters.json:49、src/core/data/types.ts:285）とも一致する。
   - 背景は透過。工房は元画像の背景をクロマキー（#FF00FF）で抜き、アルファを 50% で二値化している（不透明か完全透過のどちらか。project.json の `art.chromaKey`・`art.alphaThreshold`、工房の docs/decisions.md）。矩形の代わりにそのまま重ねてよい。
   - 今の描画は 48×48、1 グループだけのとき 64×64（battle.ts:23-24、40-47）。UI-60 は 48×48〜64×64【仮】（ui.md:175）。
3. 未鑑定はシルエット: `identified` が偽のとき `<id>_silhouette.png` を使う。不透明の画素を 1 色で塗ったもの。色は #7C7C7C【仮】で、今の未鑑定の矩形の `dim`（palette.ts:10）と同じ（project.json の `art.silhouetteColor`）。
4. 効果音: ZzFX 1.3.2 をゲームに同梱する（MIT。CDN からは読まない）。出典と版は CONV §6（npm の `zzfx@1.3.2`、tarball の sha1 付き）。工房の `tools/music/vendor/zzfx-1.3.2/` に `ZzFX.js` と `LICENSE` があり、これを使えば工房の試聴と同じファイルになる。
   - JSON は `{ "name": "<name>", "params": [ ... ] }`。params は ZzFX の引数配列そのまま（21 個以下）。
   - 名前は 8 つ: ok、cancel、hit、damage、spell、door、stairs、trap（project.json の `sfx.names`）。置き場は `assets/sfx/<name>.json`。wipe と levelup は効果音ではなくジングル（曲）。
   - `null` の扱い: JSON の `null` は「既定値」の意味。ZzFX は `undefined` だけを既定値に置き換え、`null` は 0 として計算する（CONV §6）。次のどちらかを選んでほしい。
     - 案 A: ゲーム側で `null` を `undefined` に変えてから `zzfx(...params)` に渡す（CONV §6・§7 の今の書き方）。
     - 案 B: 工房の書き出し側で既定値を埋め、`null` を無くしてから渡す。この場合は工房が export を直す（今の export は JSON をそのままコピーする）。
   - 工房の試聴用 WAV は `zzfx()` で鳴らしたときと同じ音量（0.3 × 0.3 = 0.09）に揃えてある（CONV §6）。randomness は試聴では固定の種なので、ゲームの音とは完全には同じにならない。
5. CONVENTIONS.md の複製: 工房の `projects/wizlike/CONVENTIONS.md` が正。ゲーム側にも同じ内容を置き、MIDI → JSON の変換と再生機はそれに従う（CONV §7）。
   - 要点: SMF フォーマット 1、トラック 0 は指揮トラック（テンポ・拍子・目印。音符なし）、トラック 1〜4 が ch1〜ch4、ch4 は MIDI チャンネル 10（ノイズ。ノート 35/38/42/46）、音量 v1〜v15（velocity = v × 8）、ループの目印 `loop_start` / `loop_end`、ジングルは `end`、波形は `wavetables.json`（CONV §1・§2）。
   - 変換は CONV §2 を満たさないファイルを拒否する（工房の lint と同じ基準）。ループ点とジングルの終端を JSON に持つ。

## ゲーム側で決めてほしいこと

- ボスを 96×96 で描くか。描くなら今の 1 グループ 64×64 の枠（battle.ts:24）とラベルの位置（battle.ts:49-63）をどうするか。
- 1 グループのときの 64×64 を残すか。48 の絵を 64 の枠に入れると整数倍にならない。拡大するなら整数倍（48 → 96 など）・最近傍（CSS の `image-rendering: pixelated` など）でお願いしたい。縮小は避けてほしい（工房は大きさごとに作り直せる）。
- 効果音の `null` の扱い: 案 A（ゲーム側で変換）か案 B（工房で既定値を埋める）か。
- CONVENTIONS.md の届け方: ゲーム側が手でコピーするか、工房の export に含めるか（含めるなら置き場所を指定してほしい。今の export は含めていない）。
- 曲・効果音を `assets/` に置くままでよいか（Vite の `public/` 以外に置く前提の読み込み方はゲーム側の判断）。

## 工房側の準備（済み・未）

- 済み: 規格（CONV §1〜§7）、`instruments/wavetables.json` の初期セット【仮】、`palette/fc54.json`（ゲームの UI の 10 色をすべて含む 54 色。Shin の確認待ち）、`manifest.yaml`（6 体: 怪物 5、ボス 1）、6 体分のプロンプト票、道具（pixelize・silhouette・lint・export・sfx_render・render ほか）。
- 未: 絵の採用分（`art/out/` はまだ無い。giant_rat 1 体で設定を固めてから残りへ）、効果音の JSON（`music/sfx/params/` はまだ無い）、曲（`music/final/` はまだ無い）、場面の絵（第 2 段）。
- 未: 上の「決めてほしいこと」の回答に合わせた export の修正（案 B、CONVENTIONS の同梱を選んだ場合）。

## 2026-10-06 追記

- シルエットの項（上の「未鑑定はシルエット」と、受け渡しの `<id>_silhouette.png`）は取り下げる。ゲーム側が UI-60 で敵ごとのシルエットを廃止済みのため。工房も `<id>_silhouette.png` を作らず、渡さない（Shin の決定）。上の「工房側の準備」の道具のうち silhouette も廃止した。
- 未鑑定の表示は系統ごとの `unknown_<kind>.png` で渡す（`public/sprites/`、48×48、系統の placeholderColor と黒の 2 色。ボスの枠ではゲーム側が 2 倍に拡大）。

## 2026-10-06 追記（曲の名前）

- 曲の受け渡しの名前を `dungeon1`（以後 `dungeon2`、`dungeon3` …）にしたい。`data/audio.json` の `music.songs` に `"dungeon1"` を足し（`"dungeon"` は外す）、`screenSongs.dungeon` を `"dungeon1"` にしてほしい。ダンジョンごとに曲を変える仕組みは、ゲーム側の設計に任せる。
- 工房は `music/final/dungeon1.mid` を用意済み。`audio.json` が変わるまで、曲の export は行わない（今の `audio.json` のままだと、ビルドの E01 で止まるため）。
- 曲の中身は、工房の `render.py` の合成（CONV §1）と同じ数値で鳴る前提で作っている。v2b で試した「各音の頭と尻の 3 ms のフェード」は採用しておらず、再生機の仕様は今のままでよい。

## 2026-10-06 追記（音の一覧の確定）

Shin の決定で、工房の音の一覧を次のように確定した（工房の `project.json` と CONVENTIONS §2・§6 は更新済み）。

- 曲（11、ループする）: `title`（イントロ 4 小節 + ループ 16 小節。`loop_start` は 5 小節目の頭）、`town`、`dungeon1`、`dungeon2`、`camp`、`battle1`、`battle2`（ボス）、`tavern`、`shop`、`temple`、`dark`。
  - `tavern`・`shop`・`temple`・`dark` は `town` の編曲違い（town の動機を使う）。
- ジングル（7、ループなし）: `encounter`、`victory`、`wipe`、`levelup`、`inn`、`clear`（ダンジョン制覇）、`rare`（伝説品の入手）。
- 効果音（22、ZzFX のパラメータ）: `ok`、`cancel`、`hit`、`miss`、`damage`、`spell`、`door`、`stairs`、`trap`、`wall`、`heal`、`chest`、`gold`、`dice`、`death`、`flee`、`san`、`identify`、`upgrade_ok`、`upgrade_fail`、`teleport`、`stop`。

旧い一覧（今の `data/audio.json`）との差:

- 曲: `battle` → `battle1`、`boss` → `battle2`、`dungeon` → `dungeon1`（前の追記のとおり）。`dungeon2`・`camp`・`tavern`・`shop`・`temple`・`dark` を追加。
- ジングル: `encounter`・`clear`・`rare` を追加（`victory`・`wipe`・`levelup`・`inn` はそのまま）。
- 効果音: 8 → 22。`miss`・`wall`・`heal`・`chest`・`gold`・`dice`・`death`・`flee`・`san`・`identify`・`upgrade_ok`・`upgrade_fail`・`teleport`・`stop` を追加。

`data/audio.json` で変えてほしい点:

- `music.songs`・`music.jingles`・`sfx.names` を上の一覧に。
- `bossSong` を `"battle2"` に、`screenSongs.battle` を `"battle1"` に、`screenSongs.dungeon` を `"dungeon1"` に。
- `screenSongs` に街の施設ごとの曲（`tavern`・`shop`・`temple`）を割り当てるか、`camp`・`dungeon2`・`dark` をどの画面・状況で鳴らすかは、ゲーム側の設計に任せる。
- `cues` に新しい効果音とジングルの契機を足す（例: 遭遇で `encounter`、ダンジョン制覇で `clear`、伝説品の入手で `rare`、攻撃の空振りで `miss`、壁にぶつかったら `wall` など。契機のイベント名はゲーム側の定義に従う）。

工房は `audio.json` が変わるまで、曲と効果音の export は行わない（今の `audio.json` のままだと名前が合わずビルドの検証で止まるため）。

## 2026-10-07 追記（効果音 4 つの受け入れ）

ゲーム側が `data/audio.json` の `sfx.names` に先に足した 4 つ（ゲームの `docs/decisions.md` の工房への提案 (2)）を工房でも受け入れ、効果音は 22 → 26 になった（Shin の指示「効果音 26 個」）。並びは `audio.json` と同じ。

- `learn`: 呪文の習得。
- `ailment`: 毒・麻痺・睡眠・石化を受ける。
- `tent`: 迷宮のキャンプを開く。
- `page`: 会話の箱の送り。

工房の `projects/wizlike/project.json` の `sfx.names` と `CONVENTIONS.md` §6 を 26 にした。パラメータの JSON（`music/sfx/params/<name>.json`）はこれから作る。届くまでゲーム側は今どおり無音。

## 2026-10-08 追記（曲 dungeon3 の受け入れのお願い）

工房で曲 `dungeon3`（3 つ目の迷宮「灰の地下墓所」を歩く間のループ。Eb harmonic minor、テンポ 60、4/4、16 小節、loop 1-16）を採用した（Shin の決定「dungeon3 は採用で良いです。」）。工房の `projects/wizlike/project.json` の `music.songs` と `CONVENTIONS.md` §2 の曲の一覧を 11 → 12 にした（`dungeon2` の次に `dungeon3`）。

ゲーム側にお願いしたい変更:

- `data/audio.json` の `music.songs` に `dungeon3` を足す。
- `data/dungeons.json` の d03 の `song` を `dungeon2` → `dungeon3` に。
- `docs/audio/CONVENTIONS.md`（工房の `CONVENTIONS.md` の写し）を更新する（§2 の曲の一覧と数）。

それまでは、工房の `tools/export.py` の事前検査（ゲームの `data/audio.json` との照合）が `dungeon3` で ERROR になり、export は何もコピーせずに止まる。

## 2026-10-09 追記（迷宮に入るとき・出るときに stairs を鳴らす）

Shin の要望（原文）: 「迷宮に入るとき、出るときは階段の音の方がいいかな。これはゲーム本体の方に伝える内容ですね。」

工房で今のゲームのコードを読んで確かめた、今鳴っている音（実機では鳴らしていない）:

- `stairs` が鳴るのは `data/audio.json:28` の `{ "event": "floorChanged", "sfx": "stairs" }` だけ。`floorChanged` を出すのは迷宮の中で階を移る 2 か所（`src/core/rules/dungeon.ts:478` の降りる、`:490` の上る）だけなので、迷宮に入るとき・出るときは `stairs` は鳴らない。
- 入るとき:
  - 施設メニューの「迷宮へ」（`src/presenter/views/town.ts:225`）で `door`（`ui.facility`。`src/presenter/app.ts:675-676`、`data/audio.json:59`）。
  - 門のページで迷宮の行（kind `enter`、`views/town.ts:302-315`）を選ぶと `ok`（sound の指定なし。`src/presenter/views/controls.ts:358-364`、`app.ts:721-722`）。
  - 続く `dungeon.enter` の再生（`dungeon.ts:244-250`: screen → message `dungeon.enter` → 初回の enterSpeech → 噂話）には cue がなく、効果音はない。`screen` は曲の切り替えだけ（`src/presenter/sound-cues.ts:157-162`。cue にできる event に `screen` はない。`src/core/data/types.ts:857-876`）。
- 歩いて出るとき:
  - 1 階の上り階段に入ると確認（message `dungeon.stairsUp`「上りの階段だ。地上へ戻るか？」。`dungeon.ts:326-338`、`src/core/rules/choices.ts:26-28`）。この時点は無音。
  - 「地上へ戻る」（exit）で `ok`、「やめる」（stay）で `cancel`（`app.ts:912-917`）。
  - exit の再生（`dungeon.ts:466-468` → `src/core/rules/town.ts:127-135` returnToTown（message `dungeon.exit`「階段を上り、地上へ出た。」）→ `town.ts:101-121` arriveTown）には cue がなく、効果音はない（town の曲に替わるだけ）。
- ほかの帰り方（参考）: テレポーターは `ok` のあと `teleport`（`audio.json:51` の message `dungeon.teleport`）。帰還の呪文（`src/core/rules/camp.ts:119-138`）と帰還の糸（`src/core/rules/items.ts:64-84`）は最後の項目の `ok` だけ。全滅（`src/core/rules/wipe.ts:101-218`）は `dice`・ジングル `wipe` など。

お願いしたいこと:

- 門から迷宮に入るときと、1 階の上り階段から歩いて地上へ出るときに `stairs` を鳴らす。

ゲーム側で決めるか、Shin に確かめてほしい点（工房はゲームのデータ形式・実装を決めない）:

- 選んだ行の `ok` と `stairs` を重ねるか、`ok` の代わりに `stairs` にするか。
- 歩いて出る以外の帰り方（帰還の呪文・帰還の糸・テレポーター・全滅）にも鳴らすか（テレポーターは今 `teleport` が鳴る）。
- 鳴らす場所（例: `cues` に message の key 条件 `dungeon.enter`・`dungeon.exit` を足す、または門の行に操作の音を足す。`ui` の型は 5 つのキーに固定なので、後者は型の変更が要る）。

あわせて: 効果音 `door` は工房で作り直し中（試しの版、Shin の試聴待ち）。採用したら受け渡しで `assets/sfx/door.json` が変わり、迷宮の扉（message `dungeon.door`）と施設に入る音（`ui.facility`）の両方が変わる。

## 2026-10-09 追記（効果音の差し替え）

工房で効果音 `door` と `hit` を差し替えた（Shin の決定「doorは v4a にしましょうか。hit も v3a がいいですね。」）。受け渡しはまだ（Shin の指示待ち）。次の受け渡しで `assets/sfx/door.json` と `assets/sfx/hit.json` が変わる。ゲーム側のデータ形式・cue の変更は要らない。

- `door`: 細いパルスのクリックの連なり、40 → 60 Hz に上がる、0.27 秒。迷宮の扉（message `dungeon.door`。`data/audio.json:27`）と施設に入る音（`ui.facility`。`data/audio.json:59`）の両方が変わる。
- `hit`: ノイズを 1200 Hz 相当（37 サンプルごと）で保持した音、0.08 秒。味方の通常攻撃が敵に当たったとき（`data/audio.json:24`）。

## 2026-10-09 追記（効果音 stairs の差し替え）

工房で効果音 `stairs` を差し替えた（Shin の決定「階段も音は軽いが v3 で」）。受け渡しはまだ（Shin の指示待ち）。次の受け渡しで `assets/sfx/stairs.json` が変わる。ゲーム側のデータ形式・cue の変更は要らない。

- `stairs`: ノイズの 3 歩（0.1 秒ごとに繰り返し）、下がる、0.3 秒。迷宮の階段で降りる・上るとき（event `floorChanged`。`data/audio.json:28`）。上の「迷宮の出入りに `stairs` を鳴らす」お願いの音もこれになる。

## 2026-10-09 追記（効果音 stairs・damage の差し替え）

工房で効果音 `stairs` と `damage` を差し替えた（Shin の決定「階段はv4bがいいです。ダメージもv4bにしましょう」）。受け渡しはまだ（Shin の指示待ち）。次の受け渡しで `assets/sfx/stairs.json` と `assets/sfx/damage.json` が変わる。ゲーム側のデータ形式・cue の変更は要らない。

- `stairs`: 直前の追記（v3）を v4b に置き換える。ノイズの 3 歩（0.1 秒ごとに繰り返し）、下がる、0.3 秒、1000 Hz を境に高い音を削る（低域通過）。迷宮の階段で降りる・上るとき（event `floorChanged`。`data/audio.json:28`）。上の「迷宮の出入りに `stairs` を鳴らす」お願いの音もこれになる。
- `damage`: ノイズを 37 サンプルごと（1191.9 Hz 相当）に保持（bitCrush）した音、下がる、0.15 秒。味方の HP が減るとき（`{hpChanged, target: party, loss: true}`。`data/audio.json:25`）。

## 2026-10-09 追記（効果音 4 つの受け渡し）

工房の `tools/export.py --project wizlike` で、効果音 `door`・`hit`・`stairs`・`damage` を `assets/sfx/` に渡した（2026-10-09。Shin の指示「受け渡しはこちらのプロジェクトでやっていましたっけ？であればしていただいても良いですが」）。ゲームのリポジトリでは未コミット（`git status --short` で `assets/sfx/damage.json`・`door.json`・`hit.json`・`stairs.json` の 4 件が変更になっている。コミットはゲーム側で行う）。直前までの 3 つの追記（効果音の差し替え、`stairs` の差し替え、`stairs`・`damage` の差し替え）にあった「受け渡しはまだ（Shin の指示待ち）」は、これで済み。ゲーム側のデータ形式・cue の変更は要らない。

- `door`（v4a）: `data/audio.json:27`（message `dungeon.door`）と `data/audio.json:59`（`ui.facility`）。
- `hit`（v3a）: `data/audio.json:24`（`{attack, hit: true, target: enemy}`）。
- `stairs`（v4b）: `data/audio.json:28`（event `floorChanged`）。
- `damage`（v4b）: `data/audio.json:25`（`{hpChanged, target: party, loss: true}`）。

「迷宮に入るとき・出るときに `stairs` を鳴らす」お願い（上の「2026-10-09 追記（迷宮に入るとき・出るときに stairs を鳴らす）」）は変わらず未決。
