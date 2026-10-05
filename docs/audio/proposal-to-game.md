> 出典: make-assets の projects/wizlike/docs/proposal-to-game.md（ed4cd94、2026-10-05 に複製）。工房の版が正。変更は工房から提案として来る。

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
