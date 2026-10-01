# 決定の記録

追記のみ。過去の行は消さず、覆すときは新しい行で「〜を撤回」と書く。
【仮】は数値や選択がプロトタイプで変わる前提のもの。【未定】はまだ決めていないもの。

## 2026-09-29 技術選定

- 配布はブラウザ中心（PWA）。ストア配布は後回し。必要になれば Capacitor で包む。
- TypeScript + Vite + Vitest。UI フレームワーク無し。描画は DOM とインライン SVG。
- アニメーションは Web Animations API。常駐ゲームループは持たない。表示層はイベント列の再生機。
- ゲームコアは純粋 TS の状態機械。コマンド → イベント列。乱数はシード付き。
- 論理解像度は縦 240×400、整数倍スケーリング、ピクセルフォント（美咲ゴシック / PixelMplus のどちらか）。
- ダンジョンは線画のみ（画像なし）。モンスター絵、街の絵、文字ウィンドウ、SE、BGM は用意する。

## 2026-09-30 ゲーム設計

- 世界観: プレイヤーたちが卓を囲んでゲーム内ゲーム（TRPG）を遊んでいる。GM の語り＝システムメッセージ。
- ダンジョンは生成。複数あり、前のダンジョンをクリアすると次が開く（これが引継ぎ要素）。入場ごとに再生成。
- 脱出手段: 帰還の糸、徒歩、帰還呪文、テレポーター（ボス撃破後のマスなど）。
- 目的: ファーミングして帰り、ボスを倒し、全ダンジョン踏破。
- パーティ 6 人、前衛 3・後衛 3。画面の情報量は少なく保つ。
- キャラ作成はゲーム開始時のみ。1 人目がリーダー（主人公）。編成が変わるのは客将がいるときだけ（客将は【未定】、プロトタイプ外）。
- 善悪（アライメント）は廃止。種族 5・職業 7（基本 4 + 上級 3）・能力値 6 は仮案どおり【仮】。
- パーマデスは灰まで。ロスト無し。灰は「蘇生を試みて失敗した状態」のみ（呪文か寺院）。灰からの復活は闇魔術の施設で確定・高額。
- 戦闘: 前回入力を維持するオート（MP 不足なら攻撃）。AC 制、敵最大 4 グループ×9 体、状態異常は毒・麻痺・睡眠・石化。レベルドレインは廃止し、SAN を削る攻撃に置き換え。後衛は ranged 武器のときだけ攻撃可、無ければ防御。前衛全滅で後衛が前衛扱い。
- 魔法: MP 制だが呪文レベルは残す。習得はレベル到達時にダイス判定（習得レベルより上に離れるほど成功しやすく、+4 で確定）。新しい呪文レベル解放時に最低 1 つ保証。魔法書でしか覚えられない呪文がある。習得判定は「初めて到達したレベル」でのみ行う（レベルダウン→再上昇で再抽選させない）。
- マッピングは自動。セーブはオートセーブのみ。
- 規模の目安はダイヤモンドの騎士級（敵 80〜90 種、アイテム 100 前後、ダンジョン 5〜6 本）。
- SAN 値: 階を降りる・未鑑定の敵との遭遇・仲間の死亡で減少、街で全回復、一定以下で戦闘中にランダム行動、0 で行動不能【仮】。
- 全滅処理: 潜行中に拾った物と金は出目に関係なく全損。2d10 で「持ち込んだ資産と EXP をどれだけ削るか」を決める（レベルダウンあり）。全滅時点で生存していたメンバーは HP 50% で復活、MP は残量のまま。リーダーは状態を問わず（灰でも）復活。全滅より前に死亡・灰だったメンバーはそのまま。全滅した方が安い状況を作らない。
- GM の救済: リーダー以外の全員が死亡か灰で、資産合計が最安の蘇生費に届かないとき、GM が一人を無償で蘇生する。
- 施設: 酒場・宿屋・店・寺院・闇魔術・訓練所・銀行を全部置く。銀行の金は全滅ペナルティから守られる。店は在庫制。売った物は買値で買い戻せる。ダンジョンクリアで在庫が増える。消耗品は無限。
- ペナルティ表の帯は後で決める【仮】。
- 性格: 慎重・無鉄砲・強欲・普通の 4 つ。作成時に選ぶ（ランダム選択あり）。リーダーは性格を持たない。プレイヤーが行動者を選べないイベントでは、性格と能力値で行動者が決まる。「普通」は自分から動かずリーダーに従う。
- 「普通」が最強にならないために: 固定の性格だけが恩恵（探索/戦闘の実利）と SAN 耐性を持つ。良い結果は衝動でしか取れない分岐を用意する。普通は SAN が下がると指示を聞かなくなる。慎重は暴走を制止でき、制止の成否に小さな報酬が付く。
- セーブスロット: スロット = 独立した別のゲーム。同じデータを別スロットに保存できない。書き出し・読み込みは同じ gameId への上書きのみ。ゲーム数上限 5【仮】。
- スプライトは Stable Diffusion で生成し、同じ縮小手順と固定パレットで後処理して揃える。未鑑定の汎用シルエットは鑑定済み絵から機械生成。

## プロトタイプの範囲

- 固定 6 人（名前と性格だけ選ぶ簡易作成）、ダンジョン 1 本 2 階、線画とスワイプ移動、敵 5〜6 種、攻撃・呪文 2・防御・逃走・オート、宿と寺院だけの街、全滅→出目→ペナルティ、オートセーブ、性格付きイベント 2 つ、SAN の基本。
- 動かしてから決めるもの: スワイプかボタンか、閾値、長押し間隔、遭遇率、階の広さ、1 回の潜行の長さ（10〜20 分目安）、戦闘 1 ラウンドの体感時間、メッセージ速度、オート解除の閾値、SAN と MP コストの実数、性格の恩恵と耐性の実数、6 人表示で足りるか。

## 実装中の判断

（Claude Code が作業中に追記する。形式: `- YYYY-MM-DD 領域: 判断内容。理由。`）

- 2026-10-01 build: tsconfig は共通オプションを tsconfig.base.json に置き、tsconfig.json（DOM+vite/client、src と tests）と tsconfig.core.json（lib ES2022 のみ、types []、src/core）が extends する構成にし、typecheck は両方を検査する。core が DOM/Web API を使うと typecheck が落ち、型に現れない Math.random / Date などは tests/architecture.test.ts で検出する。依存を増やさずに CLAUDE.md §3-1 を機械的に担保するため。
- 2026-10-01 build: vite.config.ts は tsconfig の include に入れない。@types/node を依存に加えないためで、Vite が自前で変換する。vitest の設定は vite.config.ts 内で vitest/config の defineConfig を使って書く。
- 2026-10-01 build: 導入した版は typescript 7.0.2（ネイティブ版 tsc）、vite 8.3.1、vitest 5.0.3。npm install -D で入った最新安定版をそのまま使った。
- 2026-10-01 core: splitmix32 は加算 0x9e3779b9、乗算 0x21f0aaad / 0x735a2d97、シフト 16/15/15 の JS で一般的な 32 ビット版を採用した（createRng の回帰値はこの定数に依存する）。広く使われていて検証しやすいため。
- 2026-10-01 core: parseDice は "1d6-0" を受理し、modifier を +0 に正規化する（-0 を残さない）。文法 [+-](0|...) が -0 を許すため。JSON 保存や比較で -0 が紛れ込むのを避けた。
- 2026-10-01 core: rollDice に DiceSpec を直接渡して範囲外（count 1..100、sides 1..1000、|modifier|<=9999、整数）の場合は RangeError とし、DiceParseError とは区別した。文字列の構文エラーではなく、呼び出し側のプログラム誤りのため。
- 2026-10-01 core: randInt の min/max は Number.isSafeInteger で検証し、chance の percent は NaN だけを RangeError とした（0 未満や 100 超は常に false / true）。いちばん単純な解釈を選んだため。
- 2026-10-01 core: GameData は各 JSON ファイルの形をそのまま型にする（配列は配列のまま）。id 引きの補助は必要になったマイルストーンで core に足す。
- 2026-10-01 presenter: UI-01 の「整数倍」は端末ピクセル基準（CSS px × devicePixelRatio）で判定する。deviceScale = floor(min(availW*dpr/240, availH*dpr/400))、CSS 上の scale = deviceScale/dpr とし、deviceScale が 1 未満なら CSS px 基準の小数倍にする。CSS px 基準だと iPhone（390px 幅、dpr 3）で k=1 となり画面幅の 6 割しか使えないため。端末ピクセルで整数倍なら線と文字は滲まない（オーケストレーター判断）。
- 2026-10-01 presenter: ステージの left/top は端末ピクセル境界に丸める。丸めで safe area からはみ出すときは ceil/floor で内側に寄せ、それも無理なら丸めない中央値を使う。1px の模様を滲ませず、UI-02 の「safe area の内側」を必ず守るため。
- 2026-10-01 presenter: ビューポート寸法には window.innerWidth/innerHeight を使う（visualViewport.height と documentElement.clientHeight は使わない）。iOS Safari のツールバー伸縮には追従しつつ、名前入力時のソフトウェアキーボードやピンチズームでステージが縮むのを避けるため。
- 2026-10-01 presenter: safe area は env(safe-area-inset-*) を padding に持つ不可視の固定配置プローブを getComputedStyle で読んで取得する。カスタムプロパティ経由より、ブラウザ間で数値を確実に得られるため。
- 2026-10-01 presenter: mountStage の onLayout は第 2 引数に計測入力（StageLayoutInput）も渡す。M0 の確認画面で insets と dpr をライブ表示するため。後方互換は保っている。
- 2026-10-01 presenter/data: UI-03 のフォントは美咲ゴシック第2（misaki_ttf_2021-05-05.zip の misaki_gothic_2nd.ttf）を public/fonts/ に同梱する【仮】。配布物の misaki.txt を原文のまま misaki-LICENSE.txt として置く。文字サイズ 8px 固定の仕様に 8×8 の美咲がそのまま合い、配布物の readme.txt がライセンスは misaki.txt に従うと明記し、misaki.txt は改変の有無・商用非商用を問わず利用・複製・再配布を無条件に許しているため。
- 2026-10-01 core/data: ダイス記法のフィールドは、rng.ts の isDiceExpr（NdM[+-K]）に加えて非負整数の定数形 "0"〜"9999" も有効として検証する（isDiceField）。実データの monsters.gold に "0"、monsters.groupSize に "1" があり、rng.ts の parseDice は定数形を受け付けないため（rollDice で振る前に rng 側の対応かデータの書き換えが必要）。
- 2026-10-01 core/data: 能力値（races.baseStats、prototypeParty.stats、classes.requirements）は整数 1..18 で検証する。CH-10 は上限 18 だけを定めており、下限 1 は最も単純な解釈のため。
- 2026-10-01 core/data: 装備品の slot は type と一致することを検証する（CH-70）。type 自体がスロット名であり、食い違いは打ち間違い以外に意味が無いため。
- 2026-10-01 core/data: 【仮】の既定値の表（EV-40 の canStop は慎重だけ、CH-20/21 の種族・職業の件数）と、推測に基づく制約（CB-23 の attacksPerLevels=0 なら maxAttacks=1、ペナルティ帯の単調性、bookOnly の呪文を教える魔法書が必ずあること、prototypeParty の stats が種族基礎値以上であること）は検証しない。仕様が明確に定めていない範囲を発明しないため。
- 2026-10-01 core/data: monsters[].floors は int>=1 の配列かどうかだけを検証し、dungeons.encounterTable との整合は検査しない。floors の意味が仕様に無く、d02 の表（雛形）と矛盾するため。
- 2026-10-01 core/data: CH-53 は confusedRatio < uneasyRatio を検証する。DG-01 は dungeons[0].unlock=null、dungeons[i].unlock=dungeons[i-1].id、onClear.unlockDungeon=次のダンジョンの id（末尾は null）として検証する。DG-01「配列の順に開放する」と、CH-53 の段階の順序をそのまま読んだため。
- 2026-10-01 core/data: events の item 効果は itemId と table のどちらか一方だけを持つとし、table は文字列であることだけを検証する。encounter の count は正の整数かダイス文字列とする。EV-32 が型を定めておらず、データでも使われていないため。
- 2026-10-01 core/data: loadGameData は検証後の raw の値をそのまま返す（コピーも freeze もしない）。未知キーを拒否しているので形は型と一致しており、core の lib に structuredClone の型が無いため。
- 2026-10-01 presenter: データ検証に失敗したら src/presenter/views/data-error.ts のエラー画面（黒地、英語の固定見出し "Game data is invalid"、issues の全件、システムの等幅フォント、スクロール可、ステージのスケーリングに載せない）を出し、console.error にも出して起動を止める。想定外の例外も同じ画面に "name: message" の 1 件として出す。strings.json 自体が壊れている可能性があり、文言を strings から引けないため（§3-10 の例外）。
- 2026-10-01 presenter: main.ts は document.fonts.load('8px "Misaki"') を待ってからステージを出す。フォントの読み込みに失敗しても console.warn だけで起動は続ける。確認画面の見本がフォールバック表示になるので実機確認で気付けるため。
- 2026-10-01 tests: tests/architecture.test.ts は依存を増やさないため、コメント・文字列・テンプレート・正規表現リテラルを見分ける最小限の字句解析を自前で持つ。§3-1 の禁止語はコメントを除いたコード（文字列を含む）で検査し、core の import は src/core 内に実在するファイルへの相対パスか data/ への import type だけを許し、動的 import と require は禁止する。§3-10 は presenter の文字列リテラル（テンプレートは ${} の外側）に日本語（ひらがな・カタカナ・CJK 統合漢字と拡張 A・CJK 記号・全角形）が無いことを検査する。検査器自体の誤検出・見逃しもテストする。
- 2026-10-01 core: ダイス記法に定数形 "N"（0..9999。DiceSpec は count 0・sides 0・modifier N、振らずに N を返し乱数を消費しない）を加え、rng.ts を唯一の文法とする。上の isDiceField の行（data 側で定数形を独自に通す判断）を撤回し、data の検証は rng の isDiceExpr / diceRange を直接使う。monsters の gold "0" と groupSize "1" を後のマイルストーンでそのまま rollDice に渡せるようにするため。
- 2026-10-01 docs: magic.md の MG-43 の呪文 id を `sleep` から `sleep_mist` に直した。data/spells.json の id が正（CLAUDE.md §3-5）で、仕様側の表記ゆれのため。
- 2026-10-01 data: monsters[].floors は仕様に定義が無く、d02.encounterTable と矛盾する（1 階・3 階に floors [2] の敵がいる）。出現は dungeons.encounterTable を正とし、floors は当面使わない【未定】。M3 の遭遇編成で扱いを決める。
- 2026-10-01 data: d02.rooms が [4,7] で DG-05 の 3〜6【仮】を超えている。検証は min<=max だけにしている【未定】。M2 の生成で決める。
- 2026-10-01 data: events.choices[].label、config.town.innRanks[].name、penalty-table.bands[].name は日本語をデータに直接持つ。§3-10 は表示層のコードの話なので M0 では違反としない【未定】。GM の語り口を差し替えるときに strings.json へ寄せるかを決める。
- 2026-10-01 data: cursed_dagger の「攻撃のたびに SAN −1」は description にしか無く、charm.sanResist と unidentifiedName（cursed_dagger だけが持つ）は仕様に定義が無い。呪い・鑑定はプロトタイプ外のため、今は検証で型だけ見る【未定】。
- 2026-10-01 docs: 【仮】の数値のうち config.json に無いもの（MG-01 の MP 能力値補正、CB-03 のグループ数 1d4、CB-05 の知恵補正、CB-44 の慎重の防御切替 HP 50%、CB-52 の宝箱の罠ダメージ、DG-12 の視野の奥行き 3、DG-20 の落とし穴 1d6）は、各ルールを実装するマイルストーンで config.json に移す（CLAUDE.md §3-6）。
- 2026-10-01 core: tsconfig.core.json は lib ES2022 のみなので structuredClone の型が無い。M1 で execute を書くときに src/core に最小の宣言を置く。
- 2026-10-01 core: 乱数は milestones M0 の候補（xoshiro128** か mulberry32）のうち xoshiro128** を採用し、シードは splitmix32 で 4 語に展開する。RngState に algo を持たせ、保存データで方式を区別できるようにした。周期が長く、状態が 4 語のプレーンな配列で JSON にそのまま保存できるため。
- 2026-10-01 core: 53 行目の rollDice の DiceSpec の範囲に、定数形（count 0・sides 0・modifier 0..9999 の整数）を加える（73 行目の定数形の追加に伴う訂正。実装の checkSpec は当初からこの範囲を受け付けている）。
- 2026-10-01 core: cloneRng（restoreRng も通る）は各語を >>> 0 して -0 を 0 に正規化し、rollDice に DiceSpec を直接渡したときも count・sides・modifier の -0 を 0 にして返す。parseDice の -0 正規化（52 行目）と揃えるため。余分なキーは isRngState で拒否せず、cloneRng が捨てる。
- 2026-10-01 core/data: spells[].tags は magic.md §6 のとおり省略可とし、検証は opt(L(S))、型は tags?: string[] にした。当初は必須にしていたが、仕様どおり tags を省いた呪文が起動時に落ちるため。
- 2026-10-01 core/data: events[].impulseOutcomes はフィールドとしては必須（空配列可）とし、1 件以上を要求するのは kind が impulse / mixed のときだけにした（EV-01）。choice は衝動判定をしないので、使われないダミーの結果を書かせないため。
- 2026-10-01 core/data: 防具類（armor/shield/helm/gauntlet/accessory）の ac の上限 0 を撤回し、整数であることだけを検証する。CB-20 は装備の ac の合計で AC を下げるとしか定めておらず、呪いの装備（CH-73）のように AC を悪化させる品を拒否しないため。
- 2026-10-01 core/data: dungeons.json は 1 件以上を要求する（DG-01）。空配列だと迷宮に入れないのにエラー画面にもならず、ほかに dungeons を参照する検査が無いため。
- 2026-10-01 presenter: 70 行目の補足。エラー画面に出すのは起動時（main.ts の start()）のすべての例外とする。loadGameData の失敗は従来どおり見出し "Game data is invalid"、それより後の例外（#stage が無い、ステージの描画中の例外など）は見出し "Startup failed" で "name: message" の 1 件を出す（renderDataError に見出しの引数を足した）。start() の reject を捨てていて、load 以降の例外で黒い画面のまま止まっていたため。
- 2026-10-01 tests: 72 行目の architecture.test.ts の補足。§3-10 の検査対象に表示層の入口 src/main.ts を加えた。Math.random は行単位ではなくコメントを除いたコード全体で、改行・?.・ブラケット記法を含めて検出し、別名や分割代入を追えないので素の Math 参照（後ろに .名前 が続かない Math）も違反にする。core の三斜線ディレクティブ（/// <reference>）は生テキストで探して違反にする（lib="dom" 1 つで core 全体の DOM 型検査が外れるため）。import type の判定は import と export の両方で「type」で始まるか（空白なしも可）で行い、"./x.js" は x.ts に読み替える。字句解析は直前が ++ / -- の / を除算とみなし、) の直後の正規表現リテラルは誤判定する制約をコメントに明記した。
- 2026-10-01 tests: tests/data.test.ts に検証の網羅性の恒久テストを置く。実データの全ての値（葉と配列・オブジェクト自身）を別の JSON 型に差し替えるとそのファイルの issue になること、strings.json のトップレベルを除く全てのオブジェクトに未知のキーを足すと検出されることを確かめ、検出されなかったパスを全件まとめて報告する。型を変えても正当な値の除外リスト（TYPE_SWAP_EXEMPT）は、現時点で該当が無いので空。フィールドの追加時に検証の書き漏れを機械的に見つけるため。
- 2026-10-01 data: monsters.json の floors を削除し、出現場所は dungeons[].encounterTable のみを正とした（CB-03 に明記し、検証と型からも除いたので floors があれば未知キーのエラーになる）。66 行目（floors の形だけを検証）と 75 行目（monsters[].floors【未定】）を撤回し、解決とする。ユーザー指示。
- 2026-10-01 docs: CB-03 に「グループごとの敵の種類はいる階の encounterTable から weight の重みで選ぶ」と書いた。encounterTable の形（monster と weight の組）から読める最も単純な解釈のため。
- 2026-10-01 docs/data: DG-05 の部屋数 3〜6 は既定値（config.dungeon.defaultRooms【仮】）とし、dungeons[].rooms があればそれを優先する（rooms は任意フィールド）。76 行目（d02.rooms【未定】）を解決し、d02 の [4,7] は rooms 優先により正当とする。defaultRooms は 1 以上の整数の [min, max] で検証し、rooms の検査（0 以上の整数の [min, max]）は従来どおり。ユーザー指示。
- 2026-10-01 docs: UI-01 の文面を「整数倍は端末ピクセル（CSS px × devicePixelRatio）で数える」に直し（倍率 k は収まる最大の整数、CSS 上の倍率は k / devicePixelRatio、1 倍も収まらなければ小数）、位置は 1/devicePixelRatio 単位に丸め、丸めると safe area をはみ出す場合（内側の境界に寄せても収まらない場合）は safe area 優先と仕様に明記した。56・57 行目の M0 の判断を仕様へ反映したもので、stage.ts と tests/stage.test.ts は既にこの文面どおりのため変更しない。ユーザー指示。
- 2026-10-01 M0: 実機確認。PC（Chrome）と iPhone で、ステージが整数倍で表示されフォントが出ることをユーザーが確認した。Android（Chrome）は未確認【未定】。次の実機確認（M2）で併せて見る。
- 2026-10-01 core: execute は state を一度だけ JSON 往復（JSON.parse(JSON.stringify(state))）で複製し、その下書きをルール関数が直接書き換えてイベントを積む。「M1 で execute を書くときに src/core に structuredClone の最小の宣言を置く」とした判断は撤回する。core の lib に structuredClone が無く、GameState は JSON 安全が前提（§3-11）なので、JSON 往復で十分で、JSON 安全であることも同時に担保できるため。
- 2026-10-01 core: 受け付けないコマンド（画面が合わない、引数が不正、未実装、形が壊れている）は、引数の state を同じ参照のまま返し、events を [{kind:"rejected", command, reason}] の 1 件にする（reason は英語の短文、形が壊れていれば command は "unknown"）。例外は投げない。判定は複製の前に行うので、rejected では乱数を消費しない。同じ参照なら表示層は保存を省略できるため。
- 2026-10-01 core: ゲーム開始前の状態は createInitialState(seed, data) で作る（screen title、party []）。キャラ作成画面（UI-51）は表示層だけの画面とし、milestones M1 の「title → creation → town」の creation は core の screen に含めない。game.new は title かつ party が空のときだけ受け付け、出すイベントは screen town の 1 件だけにする。town.enter の文言は「街に戻った」で初回には合わず、TW-02 と TW-30 は作成直後には結果が変わらないため。
- 2026-10-01 core: game.new で command.party が無いか壊れているときは、validatePartySetup に unknown として渡し、rejected（invalid party setup）にする。例外は投げない。上の rejected の規約に揃えるため。
- 2026-10-01 core: PartySetup は {members:[{name, personality: PersonalityId|"random"|null}]} とする。members[0] は null、それ以外は null 不可。random は core が randInt(0, personalities.length−1) で data.personalities の配列順から決め、乱数は random のメンバーだけが添字の順に消費する。表示層は乱数を持たないため（CH-30）。
- 2026-10-01 core: 名前は trim した後のコードポイント数が 1〜config.creation.nameMaxLength（6）【仮】のとき有効とし、範囲外は rejected にする。重複は許す。validatePartySetup は形 → 人数 → 全員の名前 → 全員の性格の順に検査し、最初に見つけた理由を返す。UI のパーティ欄が 6 文字で、仕様に制約が無いため。
- 2026-10-01 core: キャラクター id は作成時の添字 + 1 で "c1".."c6" とする（CH-04 によりメンバーの追加が無いので、カウンタは持たない）。アイテムは実体の表 state.items（id → {id, itemId, identified}）に置き、state.nextItemSeq で "i1" から再利用せずに振る。採番の順は、メンバーの添字順、各メンバーの中では EQUIP_SLOTS 順 → inventory 順。初期の品は identified true。乱数も UUID も使えず、DG-40 の台帳、TW-22 の itemLoss、CH-72 の鑑定済みを、すべて実体の id で扱えるようにするため。
- 2026-10-01 core: createItemInstance は、採番しようとした id が state.items に既にあれば Error を投げ、destroyItemInstance は未知の実体 id で Error を投げる。前提の崩れは Error にするという規約（次の行）に揃えるため。
- 2026-10-01 core: data の id 引きと、アイテム実体の作成・削除を src/core/state.ts に置く。見つからない id は Error にする（起動時に検証済みなので、来たらバグ）。ルール関数は、data のオブジェクトや配列を state に入れるときにコピーする。loadGameData は freeze もコピーもしない（検証後の raw をそのまま返すとした判断）ため。CH-44 の isIncapacitated は、使う M3 で置く。
- 2026-10-01 core: Character.equipment は 6 スロットのキーを常にすべて持ち、空きは null にする。Character.inventory は装備していない品だけを持ち、CH-71 の使用枠は「装備数 + inventory.length」とする。キーの有無と undefined の違いで JSON 往復の前後が変わるのを避けるためで、validate.ts の prototypeParty の検査とも一致する。
- 2026-10-01 core: GameState は M1 では screen, rng, party, items, nextItemSeq, gold, bank, progress{unlockedDungeons, clearedDungeons} だけを持つ。dive（M2）、battle と図鑑（M3）、来訪ごとのフラグ（M4）は、使うマイルストーンで足す。保存が始まる M4 より前なら migrate が要らず、先に推測で型を決めると dungeon.md の dive の形とずれるため。schemaVersion、turn、updatedAt は保存レコード側の欄に置く（SV-21）。
- 2026-10-01 core: game.new で progress.unlockedDungeons を [dungeons[0].id] にする（DG-01。dungeons[0].unlock は null と検証済み）。
- 2026-10-01 core: types.ts は CLAUDE.md §5 の骨格に GameEvent の rejected と levelDown を足し、levelUp に hpGain/mpGain/hpMax/mpMax、spellLearned に via を足した。§5 は骨格として残し、型の正は src/core/types.ts とする。§5 の『表示に必要な情報が足りないときは GameEvent に足す』に従ったため。
- 2026-10-01 core: Facing は dungeon.md の表記（"N"|"E"|"S"|"W"）にした。仕様書の表記に揃えるため。
- 2026-10-01 core: dice イベントの label には strings.json のキーを入れる（習得なら town.inn.learnRoll）。message の params には core が表示名（character.name、spells[].name）を入れる。UI-40 の各判定で label を使い回せて、表示層が名前を引き直さずに済むため。
- 2026-10-01 core: dungeon.useItem の itemId（§5 の名前のまま）は、アイテムの実体 id を指す。§5 の形を崩さずに、同じ品を複数持つ場合を区別するため。
- 2026-10-01 core: 「切り捨て」は core 全体で Math.floor（負は負の方向）に統一する。CH-65 の生命力補正は vit 7 で −2、MG-01 の補正も floor にする。仕様に負の場合の指定が無く、1 つの規則に揃えるのが最も単純なため。
- 2026-10-01 core: CH-65 の「最低 1」は HP 増分の合計に掛ける（max(hpGainMin, 1dhpDie + 生命力補正)）。生命力補正だけに掛けると、vit が 10 未満でも +1 になり、補正の意味が無くなるため。
- 2026-10-01 core: レベル 1 の hpMax は max(hpGainMin, hpDie + 生命力補正)（ダイスの最大値で、乱数を使わない）とし、mpMax は MG-01 の 1 レベル分の増分とする。どちらも levelHistory には入れない。仕様にも prototypeParty にも初期値が無く、作成時に乱数を消費しない最も単純な案で、レベルダウンの下限にもなるため。
- 2026-10-01 core: MG-01 の MP 補正の定数を config.growth.mpStatPivot（10）と mpStatDivisor（2）【仮】に移した（【仮】の数値のうち config.json に無いものを各マイルストーンで移すとした判断の、MG-01 分の実施）。あわせて config.creation.nameMaxLength（6）【仮】を足した。系統を持たない職業の補正は 0 とする。侍と君主は、開始レベル前でも同じ式で MP が伸びる。仕様の式に開始レベルの条件が無いため。
- 2026-10-01 core: CH-64 は「レベル L にいるのに必要な累計 EXP」と読み、expFor(1)=0、L≥2 は floor(expBase × expGrowth^(L−2) × expMultiplier + 1e-9) とする。レベルアップの条件は exp ≥ expFor(level+1)、レベルダウンの条件は exp < expFor(level)。レベルの上限は設けない。浮動小数の誤差で切り捨てが 1 ずれるのを防ぐためで、TW-22 とも整合する。
- 2026-10-01 core: レベルアップでは、増分を最大値と現在値（hp、mp）の両方に足す。乱数を引く順は、HP のダイス → 習得の d100（spells.json 順）→ 保証の randInt（帯の順）。習得判定は L > maxLevelReached のときだけ行い、その後で maxLevelReached を更新する。growth と learning の関数は渡された 1 人だけを処理し、life を見ない。誰を上げ下げするかは、M4 の宿屋（TW-04）と全滅処理（TW-22）が決める。
- 2026-10-01 core: レベルダウンは、levelHistory の末尾を 1 段ずつ取り消し、1 段ごとに levelDown イベントを出す。乱数は使わない。message wipe.levelDown は M4 の全滅処理が出す。文言が全滅の文脈だけのものだから。
- 2026-10-01 core: MG-21 は、d100（1〜100）の出目が成功率以下なら習得とする。文面の roll < rate だと、MG-22 の「無条件で 100」でも 1% 失敗して矛盾するため。仕様の文面も直した。CB-21 などほかの d100 判定の不等号は、それぞれのルールを実装するマイルストーンで見直す。
- 2026-10-01 core: MG-22 の statMod の関連能力値は、呪文の系統で決める（mage は iq、priest は pie。司教も同じ）。成功率に下限は設けない（0 以下なら必ず失敗するが、乱数は 1 回消費する）。MG-22 に両系統を持つ職業の指定が無いため。
- 2026-10-01 core: MG-23 の保証で選ぶ候補は、その帯で今回判定対象になった呪文すべて（learnLevel < L のものも含む。帯から 1 つも覚えていないので、全員が未習得）とし、spells.json の順に並べて randInt で選ぶ。帯の並び順は、帯の呪文が判定対象（spells.json 順）に初めて現れた順。保証では dice を出さず、spellLearned（via guarantee）と message town.inn.learned を出す。実データでは同じ L で保証の対象になる帯は常に 1 つなので、帯の順は結果に影響しない。
- 2026-10-01 衝突 MG-23: 文面どおり、保証の対象を「learnLevel がちょうど L の判定対象呪文を含む帯」とした。このため侍と君主（開始レベル 4）は、L4 で開く帯（learnLevel 1 と 3）に learnLevel 4 の呪文が無く、保証が働かない。代替案は「帯の解放レベル = max(系統の開始レベル, 帯の非 bookOnly 呪文の最小 learnLevel)」が L に等しい帯を保証の対象にすること。M4 の宿屋より前にどちらにするかを決める。tests/learning.test.ts で現状を固定した（侍 iq 9、seed 13 で 3 つとも失敗し、保証の乱数を引かない）。
- 2026-10-01 core: MG-25 の「職業がその系統を使えない」は、classes[].spells にその系統があるかだけで判定し、開始レベルは問わない。仕様の文面に開始レベルの条件が無いため。M1 では learning.ts に checkLearnFromBook と learnFromBook を置くだけにし、dungeon.useItem への配線は M2 以降で行う。
- 2026-10-01 core: checkLearnFromBook は、inventory に id があっても state.items に実体が無ければ "item not in inventory" とする。learnFromBook は、前提が崩れていれば（実体が無い、または book でない）Error を投げる。check で弾くべき入力と、呼び出し側のバグを分けるため。
- 2026-10-01 core: 魔法書で覚えたときの message は、宿屋の習得と同じ town.inn.learned を使う（文言「{name}は{spell}を覚えた。」が場所に依存しないため）。キーの名前空間が宿屋なので、M2 で dungeon.useItem に配線するときに専用キーへ分けるかを決める。
- 2026-10-01 core: SAN は 0..sanMax にクランプする。耐性の倍率は、減少源の tags（fear / allyInjury / trap）に当てはまるものを掛け合わせ、最後に 1 回だけ切り捨てる。リーダー（null）の倍率は 1。耐性を掛けるのは、攻撃の fear（CB-31）と仲間の死亡（EV-43）だけで、階を降りる減少、未鑑定のグループとの遭遇、events.json の san 効果には掛けない。仕様が耐性の対象として挙げているのがこれだけのため。
- 2026-10-01 core: 虚脱（san 0）中は SAN の増加を受け付けず（変化 0、イベントなし）、TW-02 の restoreSan だけが戻せる。sanChanged は、実際の変化が 0 でないときだけ出す。段階のメッセージ san.uneasy / confused / broken は、段階が下がったときだけ出す（上がったときのキーが無い）。CH-53 の「街に戻るまで回復しない」を最も単純に読んだため。
- 2026-10-01 tests: tests/helpers/core.ts の newGame の既定の性格を [null, cautious, reckless, greedy, normal, cautious] に固定した。乱数を消費させず、4 種類の性格がすべて出るようにするため。
- 2026-10-01 tests: core のテストは、出した message の key と dice の label がすべて data/strings.json に実在することを tests/helpers/core.ts の expectKnownStringKeys で確かめる。§3-10 の文言をデータで差し替えられる前提を、キーの打ち間違いで崩さないため。
- 2026-10-01 docs: 仕様書内の ID 参照の誤り 15 件を直した（CB-02 DG-13→DG-31、CB-51 DG-14→DG-40、CB-04 EV-10→EV-42、CB-31 EV-10→EV-40、DG-01 DG-13→DG-32、DG-03 DG-07→DG-13、DG-21 EV-10→EV-42、MG-40 DG-12→DG-30、CH-41 MG-14→MG-42、CH-63 MG-05→MG-20、CH-52 EV-10→EV-22/EV-23、CH-53 EV-05→EV-14、CH-04 EV-12→EV-60、TW-33 EV-12→EV-60、EV-31 EV-08→EV-41）。ID の振り直しで参照がずれていたため。
- 2026-10-01 docs: M1 設計の仕様の明確化を仕様書に反映した（MG-01/21/22/23/25、CH-05/41/52/53/54/61/62/63/64/65/71/§9）。CLAUDE.md §5 と milestones.md は変更しない（§5 は骨格として残す）。
- 2026-10-01 core: san.ts の loseSan と gainSan は、amount が負または非有限なら Error を投げる（0 は受け付けて変化なし）。負の減少で虚脱から増える、負の増加で耐性なしに減る、という CH-53/CH-54 の迂回を呼び出し側の誤りとして止めるためで、前提の崩れは Error にするという規約に揃えた。符号付きの値は従来どおり applySanValue が振り分ける。
- 2026-10-01 core: MG-23 の行の「実データでは同じ L で保証の対象になる帯は常に 1 つなので、帯の順は結果に影響しない」を訂正する。司教（mage:1, priest:1）の L3 では mage:2（flame_burst）と priest:2（cure_poison）の 2 帯が同時に保証の対象になる。各帯の候補は 1 つなので、覚える呪文の集合と乱数の消費数（randInt(0,0) も 1 つ消費する）は帯の順によらないが、knownSpells に積む順と spellLearned・message の順は帯の順（spells.json に初めて現れた順で、mage が先）になる。司教の L5 は lightning_tome が bookOnly なので priest:3 の 1 帯だけ。候補が 2 つ以上の帯が同じ L で複数保証に回るデータを足すと、選ばれる呪文も帯の順に依存する。tests/learning.test.ts で司教 L3（seed 4）と L5（seed 13）を固定した。
- 2026-10-01 core: SAN の行の「耐性を掛けるのは、攻撃の fear（CB-31）と仲間の死亡（EV-43）だけ」と、その理由「仕様が耐性の対象として挙げているのがこれだけのため」を撤回する。耐性を掛ける減少源は、CH-54 と EV-40 のとおり fear（CB-31）、仲間の死亡 allyInjury（EV-43）、罠 trap の 3 つで、san.ts の sanLossMultiplier と tests/san.test.ts もこのとおり。階を降りる減少、未鑑定の敵との遭遇、events.json の san 効果には掛けない。ただし罠で SAN が減る契機は CH-51 にも DG-20/21 にも無いので、trapLossMul は今のところ効く場面が無い【未定】。M2 の罠の実装で、CH-51 に罠の減少を足すかを決める。
- 2026-10-01 core: src と tests のコメント・テスト名にある D1〜D7 は M1 設計のラベルで、この節の M1 の行に次のとおり対応する。D1 = execute の JSON 往復の複製、D2 = 受け付けないコマンドの rejected、D3 = createInitialState と creation を表示層だけの画面にしたこと、D4 = PartySetup の形、D5 = MG-21 の roll ≤ rate、D6 = CH-64 の累計 EXP、D7 = 衝突 MG-23（侍と君主の保証）。設計書はリポジトリに無いため、ここを対応の正とする。
- 2026-10-01 core: 衝突 MG-23 は代替案を採用する（ユーザー決定）。帯の解放レベル = max(系統の開始レベル, 帯の bookOnly でない呪文の最小 learnLevel) が L に等しい帯ごとに保証を適用し、帯に bookOnly でない呪文が無ければ保証なし。MG-22 の成功率は呪文の learnLevel 基準のまま。文面どおりとした先の判断（D7）を撤回する。侍・君主が開始レベル 4 で開く帯でも保証が働くようにするため。
- 2026-10-01 core: 罠が発動したら生存メンバー全員の SAN を config.san.trap（3）【仮】減らし、慎重の trapLossMul を掛ける。察知して回避した場合は減らない（ユーザー決定）。罠の SAN 減少の契機を【未定】とした先の判断を解決する。
