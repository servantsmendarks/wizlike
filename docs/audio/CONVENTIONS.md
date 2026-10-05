> 出典: make-assets の projects/wizlike/CONVENTIONS.md（ed4cd94、2026-10-05 に複製）。工房の版が正。変更は工房から提案として来る。

# wizlike 音源と MIDI の取り決め（CONVENTIONS）

この文書は make-assets の `projects/wizlike/CONVENTIONS.md` が正。ゲームのリポジトリに同じ内容を置き、ゲーム側の MIDI → JSON 変換と再生機はこれに従う。
変更するときはここを直してから、ゲーム側へ「提案」として渡す。【仮】は実装して鳴らしてから見直す数値。
道具が読む数値は `project.json` にも写してある。数値を変えるときは両方を直す（文章の正はこの文書）。

## 1. 音源モデル（ワンダースワン級）

- 4 チャンネル。ch1〜ch3 は波形テーブル音源、ch4 はノイズ。
- 波形テーブルは 32 サンプル、各サンプル 4 bit（0〜15）。`instruments/wavetables.json` に名前付きで定義する。初期セット【仮】: `pulse50`、`pulse25`、`pulse12`、`triangle`、`saw`、`organ`。
- 各チャンネルは同時に 1 音だけ鳴る。
- 音量は 15 段階（v1〜v15）。音を出さないときは休符（音符がない）で、v0 はない。音量の時間変化（エンベロープ）は持たない【仮】。必要になったら「減衰あり」の波形として別名で定義する。
- ch4 のノイズは種類を固定ノート番号で指定する（§2）。`noise` は波形名ではなく ch4 を表す固定の予約語。
- ピッチベンド、ビブラート、モジュレーション、CC は再生機が無視する。使わない。
- 音名は MIDI 60 = C4（国際式）。

### wavetables.json の形

```json
{
  "samples": 32,
  "depth": 4,
  "waves": {
    "pulse50":  { "program": 0, "data": [15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    "pulse25":  { "program": 1, "data": ["32 個の 0〜15"] },
    "pulse12":  { "program": 2, "data": ["…"] },
    "triangle": { "program": 3, "data": ["…"] },
    "saw":      { "program": 4, "data": ["…"] },
    "organ":    { "program": 5, "data": ["…"] }
  },
  "noise": {
    "kick":    { "note": 35, "clock": 1200 },
    "snare":   { "note": 38, "clock": 6000 },
    "hat":     { "note": 42, "clock": 44100 },
    "openhat": { "note": 46, "clock": 44100 }
  }
}
```

- `program` は Program Change の値（0 始まり）。pulse50 = 0、pulse25 = 1、pulse12 = 2、triangle = 3、saw = 4、organ = 5。
- `data` の中身（pulse50 以外）は初期セットを作るときに決める。上の `"…"` は形を示すだけ。
- `noise` の `note` は ch4 のノート番号、`clock` は LFSR を進める速さ（Hz）【仮】。

### 合成の数値（render.py と再生機の目安）【仮】

- 44100 Hz・16 bit・モノラル。
- 波形: 32 サンプルをノートの周波数でループし、最近傍で読む（補間なし）。周波数は平均律、A4（MIDI 69）= 440 Hz。
- 各チャンネルの出力 = (サンプル値 / 15 × 2 − 1) × v / 15。4 チャンネルを足して 4 で割る。エンベロープもクリック除けもなし。
- ノイズ（ch4）: 15 bit の LFSR（長周期モード、bit0 xor bit1 を帰還）を種類ごとの `clock` で進める。出力は bit0 を ±1 にしたもの × v / 15。
  - 種類ごとの clock【仮】: kick 1200、snare 6000、hat 44100、openhat 44100。
  - 音の長さは音符の長さ（ゲート）。音量の時間変化はなし。音色の違いは種類（clock）だけ。
  - 作曲の指針: kick と snare は長さ 1〜2、hat は 1（openhat は長め）。
- ループする曲は、既定で「頭から通し + ループ部分をもう 1 回」を書き出す（`render.py --loops` で回数を変える）。
- 音の長さは 16 分音符の整数倍。

## 2. MIDI の規約

- SMF フォーマット 1。
- トラック 0 は指揮トラック（名前 `conductor`）。テンポ・拍子・目印だけを置き、音符は置かない。
- トラック 1〜4 が `ch1`、`ch2`、`ch3`、`ch4`（トラック名）。対応はトラック名で決める（lint もトラック名で対応づける）。
- MIDI チャンネル（1 始まりの表記）: ch1〜ch3 は 1〜3、ch4 は 10。mido などの 0 始まりでは 0、1、2、9。
  - ch4 を 10 にするのは GM のドラムと同じ番号にするため。DAW でそのまま鳴る。
- 分解能（PPQ）: 書き出しは `project.json` の `music.ppq`（480）。読み込みはどの PPQ でも受ける。判定は PPQ に依存せず「16 分の格子に乗るか」で行う。
- テンポと拍子: 指揮トラックの tick 0 に 1 回ずつ。曲中の変更は不可。拍子は 4/4 または 3/4【仮】。
- 波形の指定: ch1〜ch3 の各トラックの tick 0 の Program Change。番号と波形名の対応は `wavetables.json` の `program`。曲中の変更は不可【仮】。ch4 には Program Change を置かない（あっても再生機は無視し、lint は警告）。
- 音量: 書き出しの velocity = v × 8（8〜120）。読み込みは v = clamp(round(velocity / 8), 1, 15)。round は四捨五入（0.5 は切り上げ）。Python の `round` は偶数丸めなので、道具は `floor(x + 0.5)` で実装する。
- ノートの終わりは Note Off（`note_off`、velocity 0）で書く。読み込みは velocity 0 の Note On も終わりとして受ける。
- 格子: すべてのノートの開始と終了が 16 分音符の位置にあること。3 連符は不可【仮】。
- 音域: ch1〜ch3 は MIDI ノート 36（C2）〜 96（C7）【仮】。
- ch4（ノイズ）はノート番号で種類を選ぶ。GM のドラムの番号に一致させる: 35 = kick、38 = snare、42 = hat（GM の closed hat）、46 = openhat（GM の open hat）。音高としては扱わない。
- 重なり: 同一トラック内でノートが重ならないこと（前の終了 ≤ 次の開始）。
- 目印（マーカー、指揮トラック）:
  - ループする曲（`project.json` の `songs`）: `loop: a-b` のとき、`loop_start` を a 小節の頭、`loop_end` を b+1 小節の頭（= b 小節の終わり）に置く。b ≤ bars。ループ点は小節の頭だけ。
  - ジングル（`jingles`）: `loop: none`。曲末に `end` を置き、ループの目印は置かない。
- 長さ: 全トラックの終端（End of Track）を曲末（bars × 1 小節の長さ）に置く。MIDI の長さ = 小節数。曲末を越える音は置かない。
- 1 ファイル 1 曲。ファイル名は場面名（`title.mid`、`town.mid`、`dungeon.mid`、`battle.mid`、`boss.mid`、`victory.mid`、`levelup.mid`、`wipe.mid`、`inn.mid`）。

## 3. 音符リストのテキスト形式（LLM が書く形）

`text2midi.py` が読み、`midi2text.py` が書く。1 曲 1 ファイル（`vN.txt`）。

```
song: dungeon
tempo: 120
time: 4/4
bars: 8
loop: 1-8            # ジングルは loop: none
card: ref-01         # 任意。音階の検査に使う様式カード
ch1: pulse50
ch2: pulse25
ch3: triangle
ch4: noise

[ch1]
1.1     D4  2  v12
1.1.3   r   2
1.2     F4  2
1.3     A4  4  v13
2.1     G4  2  v12
...

[ch4]
1.1     kick     2  v15
1.1.3   hat      1  v8
1.2     snare    2  v14
1.2.3   hat      1  v8
1.3     kick     2  v15
1.4     snare    2  v14
1.4.3   openhat  2  v8
...
```

- ヘッダ: `song`、`tempo`（4 分音符 / 分）、`time`（4/4 か 3/4）、`bars`、`loop`（`a-b` か `none`）、`card`（任意）、`ch1`〜`ch3: <波形名>`、`ch4: noise`（固定）。
- 曲名が `project.json` の `songs` にあれば `loop: a-b` が必須、`jingles` にあれば `loop: none` が必須。
- 位置は `小節.拍` または `小節.拍.16分位置`。16 分位置は 1 拍を 4 分割した 1〜4、省略時 1。3/4 では拍は 1〜3。
- 音名は `C4` のように英名とオクターブ（MIDI 60 = C4）。シャープ `C#4`、フラット `Bb3` も読める。ch4 は `kick` / `snare` / `hat` / `openhat`。
- 長さは 16 分音符を 1 とする整数だけ（16 分 = 1、8 分 = 2、付点 8 分 = 3、4 分 = 4、2 分 = 8、全 = 16）。
- 音量は `v1`〜`v15`。省略すると同じチャンネルの直前の値を引き継ぐ。各チャンネルの最初は `v12`。
- 休符 `r` は書いても書かなくてもよい。各行が位置を持つので、`r` は書式だけ検査して無視する。
- コメントは、行頭または空白の直後の `#` から行末まで（`C#4` の `#` はコメントにならない）。空行は無視。
- 行はチャンネルごとに時間順。同じチャンネルで前の音と重なる指定は `text2midi.py` が拒否する。
- `midi2text.py` の書き出しは正規形: `card` はオプションで渡されたときだけ、v は毎行書く、r は書かない、シャープで書く、チャンネルごとに時間順。
- `midi2text.py` の読み込みは任意の PPQ。16 分の格子から 16 分の 1/4 以内のずれは最寄りに寄せて警告、それを超えるずれは止める。

## 4. 様式カードの形式（`cards/<name>.md`）

```
# 様式カード: <name>
参考: <参考曲の説明。曲名が市販作品の場合はタイトルだけ。旋律は書かない>

## 機械集計
- テンポ / 拍子 / 小節数 / ループ点
- 推定した調と音階（第 2 候補も）
- 小節ごとの推定コード（例: i | i | VII | VI | ...）
- 形式（例: A A B A'、小節の類似度から）
- チャンネルごと: 音域、音の数、長さの分布（16 分 x% / 8 分 y% / 4 分 z%）、最頻のリズム型（1 小節を 16 分で表した出だしの位置）

## 言葉での説明（日常語を併記）
- リード: <専門の言い方> / <日常語>
- 伴奏: ...
- ベース: ...
- ドラム: ...
- 全体の印象の軸: 明るさ、速さ、跳ね、密度、音域、緊張、繰り返し（各 5 段階）

## 作曲の指示に使う制約
scale: D minor
- 使う音階、コード進行、各チャンネルのリズム型、形式、小節数
```

- `scale: <主音> <旋法>` の一行を「作曲の指示に使う制約」に必ず置く（機械が読む）。主音は音名（`C`、`F#`、`Bb` など）。
- 旋法: `major`、`minor`、`harmonic_minor`、`melodic_minor`、`dorian`、`phrygian`、`lydian`、`mixolydian`、`locrian`、`major_pentatonic`、`minor_pentatonic`。
- `analyze.py` はこの行を書く。`lint.py` は txt の `card:` から `cards/<カード名>.md` を開いてこの行を読む。

## 5. 検証（`lint.py`）

- 使い方: `lint.py --project wizlike <dir>/vN.txt`。同じ場所の `vN.mid` を読み、組で検査する。小節数は txt の `bars:`、音階は txt の `card:` が指すカードの `scale:` から読む。
- 参考曲の MIDI は lint の対象外（`analyze.py` だけ）。

止めるもの:
- `ch1`〜`ch4` の名前のトラックがちょうど 1 本ずつない。
- トラックと MIDI チャンネルの対応違い（§2）。
- ch 以外のトラック（指揮トラックなど）に音符がある。
- 同一トラックの重なり。
- 格子外（lint は許容なし。ずれのある MIDI は `midi2text.py` で寄せてから作り直す）。
- 音域外（ch1〜ch3 は 36〜96）。
- ループの目印の欠落・位置違い（小節の頭でない、§2 の位置と違う）、ジングルの `end` の欠落、songs / jingles と `loop:` の食い違い。
- テンポ・拍子が tick 0 以外にある、2 回以上ある。拍子が 4/4・3/4 以外。
- 曲末（End of Track）が txt の `bars` と違う、曲末を越える音がある。
- 未定義の波形（Program Change が `wavetables.json` にない）。
- ch4 の未定義ノート（35、38、42、46 以外）。
- txt と mid の不一致（音符の位置・音名・長さ・v、テンポ、拍子、目印）。

警告:
- カードの音階にない音（ch1〜ch3 のみ。`card:` がなければ検査しない）。
- 16 分の 16 連続: 1 つのチャンネルで、1 小節の中に長さ 1 の音符が 16 個並ぶ。
- 同じ 2 小節の 4 回以上の繰り返し: 全チャンネルをまとめた 2 小節の塊（1-2、3-4、… の頭そろえ）で、同じ塊が 4 回以上出る。
- ch4 の Program Change。
- ピッチベンド・CC など再生機が無視するイベント。

終了コード: 0 = 止めるものなし（警告は可）、1 = 止めるものあり、2 = 使い方やファイルの誤り。

## 6. 効果音のパラメータ（ZzFX 1.3.2）

- 形式: `music/sfx/params/<name>.json` に `{ "name": "<name>", "params": [ ... ] }`。`params` は ZzFX の引数配列をそのまま持つ。
- 版は ZzFX 1.3.2 に固定。出典: npm の `zzfx@1.3.2`（1.3 系の最新、2025-09-17 公開、tarball の sha1 `e3cee96e5405b05cfd641727e291804a5082220d`）、https://github.com/KilledByAPixel/ZzFX 。MIT ライセンス。
- `params` は 21 個以下。`null` と末尾の省略は既定値（JS の `[,,925]` は `[null, null, 925]` と書く）。
  - ZzFX が既定値に置き換えるのは `undefined` だけで、`null` は 0 として計算される。読む側は `null` を `undefined` に変えてから `zzfx(...params)` に渡す（§7）。
- 名前は `project.json` の `sfx.names`: ok、cancel、hit、damage、spell、door、stairs、trap の 8 つ。wipe と levelup は効果音ではなくジングル（曲）。
- 全体の音量 `ZZFX.volume` = 0.3、サンプリングレート 44100。
  - `zzfx()` で鳴らすと 0.3 が 2 回掛かる（`buildSamples` の中と、`playSamples` の GainNode）。実効は 0.3 × 0.3 = 0.09。`sfx_render.py` の WAV は既定でこれに揃える（`--no-play-gain` なら `buildSamples` の出力のまま）。
- `sfx_render.py` は 1.3.2 のアルゴリズムの Python 移植。randomness は固定の乱数の種で再現する（既定は種 0）。ゲームでは毎回ゆらぐので、試聴の WAV と完全には同じにならない。

| 添字 | 名前 | 既定値 | 単位・意味 |
|---|---|---|---|
| 0 | volume | 1 | 音量 |
| 1 | randomness | 0.05 | 周波数のゆらぎの幅 |
| 2 | frequency | 220 | Hz |
| 3 | attack | 0 | 秒 |
| 4 | sustain | 0 | 秒 |
| 5 | release | 0.1 | 秒 |
| 6 | shape | 0 | 0 sin、1 triangle、2 saw、3 tan、4 noise、5 square duty |
| 7 | shapeCurve | 1 | 波形の曲がり（shape 5 ではデューティ） |
| 8 | slide | 0 | 周波数の変化 |
| 9 | deltaSlide | 0 | 周波数の変化の変化 |
| 10 | pitchJump | 0 | 途中で跳ぶ高さ（Hz） |
| 11 | pitchJumpTime | 0 | 秒 |
| 12 | repeatTime | 0 | 秒 |
| 13 | noise | 0 | ノイズの量 |
| 14 | modulation | 0 | 周波数の揺れ |
| 15 | bitCrush | 0 | ビットクラッシュ |
| 16 | delay | 0 | 秒 |
| 17 | sustainVolume | 1 | sustain の音量 |
| 18 | decay | 0 | 秒 |
| 19 | tremolo | 0 | 音量の揺れ |
| 20 | filter | 0 | フィルタ（正で高域通過、負で低域通過） |

## 7. ゲーム側への要求

- 再生機は `wavetables.json` の波形を読み、§1 のとおりに鳴らす（§1 の合成の数値が目安）。
- 変換（MIDI → JSON）は §2 を満たさないファイルを拒否する（lint と同じ基準）。指揮トラックを読み、ch4 は MIDI チャンネル 10。
- ループ点とジングルの終端を JSON に持つ。
- 効果音: ZzFX 1.3.2 をゲームに同梱し（MIT、CDN からは読まない）、§6 の JSON を読んで鳴らす。`params` の `null` は `undefined` に変えてから `zzfx(...params)` に渡す。
- 絵: `<id>.png` に加えて `<id>_silhouette.png`（未鑑定の表示用）を受け取る。
- いずれも `docs/decisions.md` の「ゲーム側への提案」として渡す。ゲーム側が採るまでは提案。
