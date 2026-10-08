# ダンジョン仕様（DG）

## 1. 構成

- DG-01 ダンジョンは複数（`data/dungeons.json`）。配列の順に開放する。ダンジョン n+1 は n のクリア（ボス撃破 DG-32）で開放。最初のダンジョンは最初から開放。
- DG-02 各ダンジョンは階数が固定（`floors`、3〜6【仮】。プロトタイプの d01 は 2）。各階は `width × height` のグリッド（20×20【仮】）。`width` と `height` は 5 以上（読み込み時に検証する。生成の前提）。
- DG-03 入場（`dungeon.enter`）のたびに新しい `diveSeed` を発行し、全階を再生成する。潜行中の階の構造は `diveSeed` と階番号から決定的に再現できること。セーブには構造そのものではなく `diveSeed` と踏破情報（DG-13）だけを保存する。各階の構造は `diveSeed` と階番号から作る専用の乱数（`createRng((diveSeed ^ imul(floor, 0x9e3779b9)) >>> 0)`）だけで生成し、`state.rng` は使わない。`diveSeed` は入場時に `state.rng` から `nextUint32` で 1 回引く。M7: 宿の士気の噂話（TW-15 の `gossip`）があるときは、`diveSeed` の `nextUint32` の直後に `state.rng` から `randInt(0, 候補数 − 1)` を 1 回引いて 1 種を選ぶ（候補は TW-15 のとおり、入るダンジョンの出現表の未鑑定の敵を `monsters.json` の順）。士気が無い・その士気のランクの `gossip` が偽・候補が 0 種なら `randInt` は引かない（入場で引くのは `nextUint32` の 1 回だけ）。入場で `state.rng` から引くのはこの 2 つだけで、この順に引く。
- DG-04 セルは 4 方向（北東南西）それぞれに `wall` / `door` / `open` を持つ。隣接セルと辺を共有するので、生成後に整合性を検査する（A の東が壁なら B の西も壁）。セル種別 `kind`: `corridor` / `room` / `stairsUp` / `stairsDown` / `boss` / `teleporter` / `event` / `trap` / `chest`（M11 で 9 種。宝箱のセル DG-23）。`chestTrapId`（chest-traps.json の id か null）は kind が `chest` のときだけ意味を持ち、それ以外は null。
- DG-05 生成手順【仮】: 部屋を `dungeons[].rooms`（[最小, 最大]）の範囲の個数だけ重ならないように置く（`rooms` は任意。省略したダンジョンは既定値 `config.dungeon.defaultRooms` の 3〜6【仮】を使い、`rooms` があればそれを優先する） → 残りを迷路アルゴリズム（再帰的バックトラック）で通路にする → 部屋と通路の接点に扉を置く → 行き止まりの一部を壁抜きでループにする → 上り階段を置く → 上り階段からの距離が最大級のセルに下り階段（最下層はボス部屋）を置く → イベントセル・罠セルを部屋以外の行き止まりや部屋内に配る。上り階段から下り階段（またはボス部屋）への経路が必ず存在すること。到達性はテストで保証する。細目: 部屋の一辺は `config.dungeon.roomSize`（[4,8]）【仮】、外周から 1 セル離し、部屋どうしは 8 近傍で接しない間隔で置く。1 部屋あたり `config.dungeon.roomAttempts`（50）【仮】回試し、置けた数が `rooms` の最小に届かなければ配置を最大 `roomAttempts` 回やり直す（実データ d01 / d02 では最小を保証し、テストで確かめる。届かない小さな盤では最も多く置けた回を使う）。扉は部屋ごとに、通路に面した外周の辺から `config.dungeon.doorsPerRoom`（[1,2]）【仮】本。迷路（再帰的バックトラック）は、入ってきた向きにまだ掘れるとき、確率 `config.dungeon.straightBias`（0.3）【仮】で直進する（それ以外は候補から一様。直進も候補に含む）。ループ化: 扉を置いた後の行き止まりのうち、階ごとに `config.dungeon.braidRatio`（[0.3, 0.5]）【仮】の範囲から一様に引いた整数パーセントの割合（行き止まり数 × 割合を四捨五入した本数）を、隣の非部屋セルへの壁を 1 本抜いてループにする（部屋への壁は抜かない。抜く行き止まりと壁は乱数で選ぶ。先に抜いた壁で行き止まりでなくなったセルは飛ばす）。ループ化の後でも、実データ d01 の 200 シードで、階ごとの上り階段から下り階段（最下層はボス）までの最短路の中央値が 40〜80 歩に入ること（統計テストで保証する）。1 階の上り階段は部屋の外のセルから一様に選ぶ。下り階段（最下層はボス）は上り階段からの距離が最大のセルの中から乱数で 1 つ選ぶ（ボスは 1 セル）。行き止まり = 部屋の外で通れる辺が 1 本のセル。イベントと罠は候補（行き止まりと部屋の中。階段・ボスを除く）をシャッフルし、イベント→罠の順に先頭から置く（M11: その後に宝箱のセル。DG-23）。候補が尽きてイベントを置けない盤は生成を Error で止め（DG-22 の各 1 回を破らないため）、罠は置ける分だけ置く（`trapsPerFloor` の下限を満たさないことがある）。実データの 20×20 ではどちらも起きない（5×5 のような小さな盤では、ループ化で行き止まりが無くなってイベントを置けないことがある）。到達性は「全セルが上り階段から到達可能」に強めて保証する。
- DG-06 1 階の上り階段は街への出口（徒歩で帰る）。2 階以降の上り階段は前の階の下り階段の位置と一致させる。

## 2. 移動と視野

- DG-10 移動: 前進 1 歩（`dungeon.move`）、左右 90° 旋回、180° 反転（`dungeon.turn`）。壁は通れない（`blocked` イベント）。扉は通り抜けられる（通り抜ける 1 歩で止まらない）。扉は通り抜けても扉のまま（辺の種別を `open` に書き換えない。開けた記録も持たない）で、通り抜けるたびに「扉を開けた」の語り（`dungeon.door`）を出す。扉は視線を遮り（DG-12）、地図（UI-24）でも扉として描く。`blocked` では乱数を消費しない。
- DG-11 遭遇判定は前進が成立した歩ごとに行う（CB-01）。旋回、`blocked`、階段の昇降では行わない。階段セルへの前進と昇降では遭遇判定をしない。迷宮で行動可能な者（CH-44）がいなくなったら、その execute の中で全滅処理（TW-20）をする（遭遇の d100 は振らない）。
- DG-12 視野: 自分のセルから前方に奥行き 0〜`config.dungeon.viewDepth`（3）【仮】、左中右の 3 列。`viewDepth` は 1..3（UI-20 の座標表が奥行き 0..3 のため）を検証する。壁と扉で遮られる。core は「見えているセルとその辺の種別」を返す関数 `visibleCells(state, data, at?)` を提供し（`at` は再生中の視点 {floor, pos, facing}。省略時は現在の dive）、表示層はそれだけで線画を描く（UI-20）。遮りの規則: 正面の列は、手前のセルの前の辺が `open` のときだけ奥へ進む。左右の列のセルは、同じ奥行きの正面の列のセルの側の辺が `open` のときだけ見える。扉は閉じた壁と同じく遮る。返す値はセルの座標と辺（front / left / right）と階段の記号（`stairs`: 上り階段なら `"up"`、下り階段なら `"down"`、それ以外は `null`。左中右のどのレーンの見えているセルでも返す。UI-20 の階段の記号に使う）だけで、それ以外のセルの種別（罠・イベント・ボス）は返さない。察知した罠（DG-21 の `knownTraps`）だけは、別の問い合わせ `visibleKnownTraps(state, data, at?)` が視野の中のセルの {depth, lane} を返す（UI-20 の罠の印。M5.5）。`visibleCells` は今どおり罠を返さない。M11: 開ける前の宝箱のセル（DG-23。実効のセルの kind が `chest`）は隠れた仕掛けではないので視野に出す。察知した罠と同じく別の問い合わせ `visibleChests(state, data, at?)` が視野の中のそのセルの {depth, lane}（`visibleCells` の順）を返す（UI-72 の床の印。罠の有無は返さない。`VisibleCell` の形は変えない）。
- DG-13 オートマップ: 見えたセル（現在位置と視野内のセル）をその階の `explored` に記録する。階ごとに保持し、潜行終了で破棄する。マップ画面は探索済みのセルの壁・扉・階段・現在位置と向きを描く。地図（`mapView`）は探索済みセルの 4 辺を生成のままの値（通った扉も `door`）で描き、イベント・ボスと、察知していない罠は描かない（記号は上り・下り階段と、察知した罠）。察知した罠（`knownTraps` にあり、実効のセルの kind が trap のもの）は罠の記号で描く（M5.5）。M11: 開ける前の宝箱のセル（実効のセルの kind が `chest`）は記号 `chest` で描く（開けた・転移で失った箱は `clearedCells` に入って消える。放っておいた箱は残る）。地図のセルをタップして歩く経路は DG-15 で探す。
- DG-14 階段の昇降はコマンドではなく、階段セルに入ったときに確認メッセージを出して選ばせる（`event.choose`）。降りたときに SAN −5（CH-51。`config.san.floorDescend`）。確認は前進で階段セルに入ったときだけ出す（入場直後、昇降直後、やめた後は出さない）。選択肢は「降りる」/「上る」と「やめる」。選択の保留中（`GameState.pendingChoice`）は `event.choose` 以外のコマンドを受け付けない。昇降では座標と向きを保つ。その潜行で初めて到達した階に降りたときだけ、生存者全員が SAN を減らす（耐性なし）。到達した最深の階を `dive.deepestFloor`（入場時 1）に持ち、`floor > deepestFloor` になる降下でだけ減らして更新する。上ったときは減らず、上ってから同じ階へ降り直しても減らない。再入場（DG-03）で数え直す。昇降では遭遇判定をしない。1 階の上り階段では確認（`pendingChoice`。promptKey `dungeon.stairsUp`、選択肢は「地上へ戻る」`exit` /「やめる」`stay`）を出し、`exit` で街へ戻る（DG-06 / DG-43）。確認を立てるときは、同じ execute の中で promptKey の語りを必ず出す。
- DG-15 地図のタップ移動の経路探索（UI-25）: `planRoute(state, data, target)`（`rules/pathfind.ts`）が、現在位置と向きから `target` のセルまでの手（`dungeon.move` と `dungeon.turn`）の列 `RouteStep[]` を返す。各手は、送って受け付けられた後に居るはずの位置と向き（`pos` / `facing`）を持つ。探索に使うのはその階の探索済みのセル（DG-13 の `explored`）と、その実効の辺（`floorOf`）だけで、`open` と `door` の辺を通れる（未探索のセルは通らない）。(x, y, 向き) を状態にした幅優先探索で、前進と旋回（左・右・反転）をどれも 1 手として手数の合計を最短にし、同じ手数なら move → left → right → around の順で先に見つかった経路を採る。目標のセルに着いた時点で止め、着いたときの向きは問わない。target が現在位置なら `[]`。迷宮の戦闘外・保留なし（`screen` が `dungeon`、`battle` と `pendingChoice` が null）でないとき、target が盤の外・未探索のとき、探索済みのセルと辺だけでは届かないときは `null`。階段・罠・ボス・イベントのセルは特別扱いしない（地図に出さない種類を経路で避けると、その存在を明かすため。踏めば core のイベントで止まる）。乱数は使わず、state を書き換えない。自動歩行を続けてよいかは `routeStepOk(step, events, after)` が決める。真になるのは、events から（move のときだけ）先頭の `message dungeon.door` を 1 件除いた残りの先頭が、move なら `moved`、turn なら `turned` で、その後ろが `hpChanged`（毒の 1 歩。CH-43）だけであり、`after` が迷宮の戦闘外・保留なしで、`dive` の位置と向きが step の予定と一致するときだけ。遭遇・罠の語り・回転床（向きが違う）・階段などの確認（`pendingChoice`）・壁（`blocked`）・rejected では偽になる。扉では止まらない（長押しの前進 UI-31 は今どおり扉で止まる）。

## 3. 罠とイベント

- DG-20 罠セル【仮】: 落とし穴 `pit`（生存メンバー全員に、メンバーごとに `config.dungeon.trap.pitDice`（`1d4`）【仮】を振ってダメージ。ダメージは max(0, 出目) で、HP が増えることはなく、0 なら HP は変わらない）、回転床 `spinner`（向きが 4 方向から一様に変わる。同じ向きもありうる）、転移 `teleport`（同じ階のランダムな通路セルへ）。発動した罠は `clearedCells` に入り、二度目は発動しない。罠の SAN 減少（CH-51、`config.san.trap`、tags `trap`）は罠の種類を問わず生存者全員。`teleport` は M2 では未実装（踏んでも何も起きない）。罠（ダメージや SAN）で行動可能な者（CH-44）がいなくなったら、その歩では階段・遭遇を起こさず、同じ execute の中で全滅処理（TW-20）をする。
- DG-21 罠は踏んだときに発動する。慎重の `trapDetect`（EV-42）の判定に成功したメンバーがいれば、発動前に「引き返す」か「進む」かを選べる。判定（M5）: 罠のセルに入った歩（扉・moved・毒の後）で、行動可能（CH-44）で性格の `benefits.trapDetect` が正の者を並び順に d100 ≤ `trapDetect`（30。確率として読む）で振り、最初の成功者で止める（それ以降は振らない）。リーダー（性格なし）は振らない（M7: 確率はその者の性格の `trapDetect` + オプション `trapDetect`（IT-34）の合計で、それが正の者が振る。リーダーもオプションで正になれば振る）。判定の箱（UI-40）は出さない（失敗を見せると罠の有無が分かるため。失敗は何も出さない）。`teleport` の罠は判定しない。成功したら message `dungeon.trap.detected`{name} と保留中の選択（kind `trap`、問い `dungeon.trap.prompt`、選択肢 `retreat`「引き返す」/ `proceed`「進む」）を出し、その歩では階段・遭遇を起こさない。引き返す: 1 歩前のセル（向きの逆の隣）へ戻る（向きはそのまま、`moved` と `dungeon.trap.retreat`）。遭遇判定・毒・SAN の減少は無く、罠は残る（次に入るとまた判定する）。進む: その場で罠が通常どおり発動し（DG-20。SAN も減る）、その後は普段の歩の続き（行動可能な者がいれば遭遇判定）。察知に成功したら、そのセルを `dive.knownTraps`（階番号の文字列 → セル添字の昇順・重複なしの配列。入場時 {}）に入れる。発動して `clearedCells` に入ったら外す（察知せずに発動したときも）。印のある罠（`knownTraps` にあり、実効のセルの kind が trap のもの）に入った歩では、察知の d100 を振らずに（慎重がいなくても・行動不能でも）必ず保留中の選択（kind `trap`、問い `dungeon.trap.knownPrompt`、選択肢は同じ `retreat` / `proceed`）を出し、その歩では階段・遭遇を起こさない（`dungeon.trap.detected` は出さない）。引き返す・進むは上と同じ（ユーザー決定 2026-10-04。M6）。再度発動し得る罠（発動しても `clearedCells` に入らず罠のまま残る種類）は印を残す（発動した時点で `knownTraps` に入れる）。今の pit・spinner は発動すると床に戻るので印を外し、そのセルはただの床になる（今のデータに発動後も残る罠は無く、それを表す欄も無い）。
- DG-22 イベントセルはそのダンジョンの `events` から重複なく配置する。踏んだら `events.md` の手順で処理し、処理後は通常セルになる（`clearedCells` に入れる。選択を待つ間はまだ入れないので、リロード後も同じ問いが出る。M5）。イベントセルに入った歩では遭遇の d100 を振らない（階段と同じ扱い。毒・扉・行動可能な者の確認は普段どおりで、行動可能な者がいなければイベントも起こさない。M5）。イベントは潜行全体で各 1 回とし、`events` の i 番目を (i mod floors)+1 階に置く。
- DG-23 宝箱のセルの生成（M11）: 生成の (7)（イベントと罠）の後に (8) を足す。個数 `randInt(dungeons[].chestsPerFloor)`（[min, max]。d01・d02・d03 とも [1, 3]。[0, 0] でも 1 回引く）を階の乱数で 1 回引き、(7) の残りの候補（行き止まりと部屋の中。階段・ボス・イベント・罠を除く）の先頭から置く。箱ごとに、CB-61 の順（`chance(config.chest.noTrapChance)` → `weightedIndex(chestTrapDangerWeights)` → その危険度の罠から `randInt`）で罠 `chestTrapId` を階の乱数で引く（罠なしは null）。候補が尽きたら、その分は置かず罠も引かない。ボスの階も対象。(7) までの乱数の消費は変えないので、既存の構造（階段・部屋・イベント・罠）は宝箱のセルを足しても変わらない。罠の抽選の材料（noTrapChance・危険度の重み・危険度ごとの罠の id）は `generateFloor` の引数 `chestGen`（組み立ては `chestGenOf(data, dungeonId)` の 1 か所。ドロップの箱の CB-61 も同じ関数で引く）。
- DG-24 宝箱のセルに乗る（M11）: 前進の歩の続き（DG-11 の行動可能な者の確認・階段・テレポーター・ボス・イベントの後）で、実効のセルの kind が `chest` なら遭遇の d100 を振らずに箱を置き（`dive.chest`: source `cell`、cell はその位置、`inRoom` は roomId が null でないか、`trapId` は `chestTrapId`（`disarmedChests` にあれば null）、`danger` は `chestTrapId` の罠の危険度（解除した箱でも残す。罠なしは 0。IT-56）、`level` はその階の遭遇表の敵の level の最大（IT-53。debug.chest と同じ）、`finding` / `rivalry` は null）、CB-60 の流れ（`chestFound{cell}` → message `chest.found.cell` → 衝動と制止 EV-16 / EV-25 → 職業の掛け合い EV-71 → `chest.prompt`）に進む。放っておいた箱（CB-66）は残り、次に乗るとまた見つかる（調べた結果と掛け合いの担当は覚えない。`finding` / `rivalry` は null）。衝動判定・制止（EV-16 / EV-25）と職業の掛け合い（EV-71）は、その潜行でそのセルについて一度だけ行う（D-2）: 初めて乗ったときにセルを `dive.judgedChests`（`{floor, x, y}` の配列。重複なし。schemaVersion 6 のまま足した省略可能な欄で、無ければ空）に入れてから判定し、入っているセルに乗り直したら `chestFound{cell}` → message `chest.found.cell` → `chest.prompt` だけを出す（乱数を引かない）。開けた箱と転移で失った箱は `clearedCells` に入り、`floorOf` が部屋・通路に戻す（`chestTrapId` も null）。罠が無くなった箱（解除・作動）は `disarmedChests` に入り、箱のまま残る。着地で歩の続きを起こさない移動（DG-25 の転移、DG-21 の引き返す、debug.warp）では箱を見つけない。
- DG-25 転移（M11。宝箱の転移の罠 CB-62 が使う。床の `teleport` 罠（DG-20）にはまだ使わない）: 今の階の実効の構造（clearedCells を重ねたもの）で、`kind` が `corridor` かつ `roomId` が null の、今の位置ではないセルを添字の昇順に並べ、`randInt(0, n−1)`（`state.rng`）で 1 つ選んで位置を移す。向きはそのまま。視野を `explored` に足し（DG-13。explored は階ごとに保つので、地図は転移の前後で続く）、`moved{pos, facing}` を出す。着地したセルでは歩の続き（遭遇・罠・イベント・階段）を起こさない。候補が無ければ何もしない（乱数も引かない）。

## 4. 脱出とボス

- DG-30 脱出手段: 帰還の糸（アイテム `effect.type === "return"`、非戦闘時いつでも、消費）、帰還呪文（MG-40）、徒歩（1 階の上り階段）、テレポーター（DG-32）。いずれも街へ戻り、潜行台帳の内容を持ち帰る。帰還の糸は `dungeon.useItem` で使う（使う者は行動可能（CH-44）で、品は本人の所持品（装備中でないもの）。戦闘中・選択の保留中は使えない（rejected `wrong screen` / `choice pending`）。街では `dungeon.useItem` の薬草などは使えるが、帰還の糸は rejected `not usable here`（M5.5。TW-03））。
- DG-31 最下層の `boss` セルには固定遭遇（`dungeons[].boss`）がある。逃走不可（CB-02）。ボスが未撃破なら、そのセルへの前進では遭遇の d100 を振らずに固定遭遇にする。M7: ボスに勝つたび（再入場での再撃破も）、戦利品を `drops.json` の `boss`（ダンジョンごとの表）から引く（IT-50〜54）。M9: `dungeons[].boss.monster` の敵は `special.boss: true` であること（読み込み時の検証）。
- DG-32 ボス撃破で、その場に街へのテレポーターが出現し（セルを `teleporter` に書き換える）、`progress.clearedDungeons` にそのダンジョンを加える（永続）。`onClear` で次のダンジョンの開放と店の在庫追加（TW-06）を行う（M7: 在庫追加 `shopStock` は流通レベルの更新 `shopLevel`（IT-62）に置き換える）。実装ではセルを書き換えず、`bossDefeated` が真なら floorOf がボスのセルを `teleporter` に重ねる。撃破の語りは `battle.bossDefeated`（params `boss` = そのダンジョンの `boss.monster` の本名。鑑定の有無を問わない。M9 実機 B1）。ボス撃破の直後（一行はテレポーターの上に立っている）と、前進でテレポーターのセルに入ったときに確認（`pendingChoice`。kind `teleporter`、promptKey `dungeon.teleporter`、選択肢は「街へ戻る」`teleport` /「やめる」`stay`）を出し、`teleport` で街へ戻る（DG-43）。テレポーターのセルでは遭遇判定をしない。`clearedDungeons` への追加と `onClear` の開放は初回の撃破だけ。
- DG-33 クリア済みのダンジョンにも再入場できる（ファーミング用）。ボスは再入場ごとに再出現する【仮】。再撃破でも `onClear` は再度は起きない。
- DG-34 ボス以外のテレポーター（街へ戻る中継点）は `dungeons[].teleporterFloors` に列挙した階にだけ置く【仮】。プロトタイプでは無し。
- DG-35 準備中のダンジョン（M9。2026-10-06）: `dungeons[].placeholder`（任意の真偽値。省略は偽）が真のダンジョンは「準備中」の枠。前のダンジョンのクリアで開放（DG-01 / DG-32）はされ `dungeon.unlocked` も語るが、入場はできない（rejected `not ready`。TW-11）。検証: 準備中の後ろに準備中でないダンジョンを置けない、`floors` は 1、`onClear.unlockDungeon` は null。他の欄（出現表・ボス・`drops.json` の chest / boss）は普通のダンジョンと同じに要る（中身は前のダンジョンの表を参照してよい）。M9 の d03（灰の地下墓所。名前は仮）がこれ。

## 5. 潜行台帳

- DG-40 入場時に `dive.ledger = { items: [], gold: 0 }` を作る。潜行中に得たアイテムのインスタンス ID を `items` に、得た金額を `gold` に加算する。
- DG-41 潜行中に消費・売却（売却は未実装（TW-05）で、店は街でしか使えないので実質「使用」）したアイテムは台帳から外す。M7: ドロップ（IT-54）の品を台帳に入れる。売却・倉庫は街だけなので、潜行中に台帳から外れるのは使用と、イベントの消費（EV-32）だけ。
- DG-42 全滅処理（TW-21）は台帳の `items` を所持から削除し、所持金から `gold` を引く（所持金が足りない場合は 0 まで）。
- DG-43 帰還（DG-30）で台帳は破棄され、内容は正式な所持品になる。

## 6. データ

`data/dungeons.json`
```
{
  "id": "d01", "name": "試しの坑道",
  "floors": 2, "width": 20, "height": 20, "rooms": [3, 6],  // rooms は任意。省略時は config.dungeon.defaultRooms（DG-05）
  "unlock": null,                       // 開放条件になるダンジョン id。null なら最初から
  "encounterRate": { "room": 0.12, "corridor": 0.05 },
  "encounterTable": { "1": [ { "monster": "giant_rat", "weight": 5 } ], "2": [ ... ] },  // 階ごとの出現表。出現する敵はこれだけで決まる（CB-03）
  "groupCountWeights": { "1": [80, 20, 0, 0], "2": [50, 35, 12, 3] },  // グループ数 1〜4 の重み【仮】
  "boss": { "monster": "gatekeeper_armor" },
  "song": "dungeon1",                   // 任意。迷宮の曲（audio.json の music.songs）。省略時は screenSongs.dungeon（UI-63。M8 の拡充）
  "events": ["glowing_tablet", "abandoned_sack"],
  "traps": ["pit", "spinner"],
  "trapsPerFloor": [1, 3],
  "chestsPerFloor": [1, 3],             // M11: 階ごとの宝箱のセルの個数 [min, max]（DG-23）
  "chestTrapMaxDanger": 2,              // M11: 宝箱の罠の危険度の上限 1〜4（CB-61）
  "chestTrapDangerWeights": [60, 40, 0, 0],  // M11: 危険度 1〜4 の重み。上限より上は 0、合計 > 0（CB-61）
  "teleporterFloors": [],
  "onClear": { "unlockDungeon": "d02", "shopLevel": 2 }  // M7: shopStock は廃止し、流通レベル shopLevel（IT-62）【仮】
}
```

`GameState.dive`（潜行中のみ存在）:
`dungeonId, diveSeed, floor, deepestFloor, pos {x,y}, facing ("N"|"E"|"S"|"W"), explored { [floor]: Set 相当の配列 }, clearedCells [], knownTraps { [floor]: 配列 }, bossDefeated, ledger`

- `deepestFloor`: この潜行で到達した最深の階（入場時 1、常に `floor` 以上。DG-14）。
- `explored`: 階番号の文字列 → その階の探索済みセルの添字（`y*width+x`）の昇順・重複なしの配列。
- `clearedCells`: `{floor, x, y}` の配列（発動済みの罠など。通常のセルとして扱う）。
- `knownTraps`: 階番号の文字列 → 察知した罠のセルの添字の昇順・重複なしの配列（DG-21。M5.5）。

`GameState.pendingChoice`（選択の保留中のみ非 null）: `{ kind: "stairs", promptKey, options: [{ id, labelKey }] } | null`。
