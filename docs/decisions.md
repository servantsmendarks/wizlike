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
