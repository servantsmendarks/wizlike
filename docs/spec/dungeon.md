# ダンジョン仕様（DG）

## 1. 構成

- DG-01 ダンジョンは複数（`data/dungeons.json`）。配列の順に開放する。ダンジョン n+1 は n のクリア（ボス撃破 DG-32）で開放。最初のダンジョンは最初から開放。
- DG-02 各ダンジョンは階数が固定（`floors`、3〜6【仮】。プロトタイプの d01 は 2）。各階は `width × height` のグリッド（20×20【仮】）。`width` と `height` は 5 以上（読み込み時に検証する。生成の前提）。
- DG-03 入場（`dungeon.enter`）のたびに新しい `diveSeed` を発行し、全階を再生成する。潜行中の階の構造は `diveSeed` と階番号から決定的に再現できること。セーブには構造そのものではなく `diveSeed` と踏破情報（DG-13）だけを保存する。各階の構造は `diveSeed` と階番号から作る専用の乱数（`createRng((diveSeed ^ imul(floor, 0x9e3779b9)) >>> 0)`）だけで生成し、`state.rng` は使わない。`diveSeed` は入場時に `state.rng` から `nextUint32` で 1 回引く。
- DG-04 セルは 4 方向（北東南西）それぞれに `wall` / `door` / `open` を持つ。隣接セルと辺を共有するので、生成後に整合性を検査する（A の東が壁なら B の西も壁）。セル種別 `kind`: `corridor` / `room` / `stairsUp` / `stairsDown` / `boss` / `teleporter` / `event` / `trap`。
- DG-05 生成手順【仮】: 部屋を `dungeons[].rooms`（[最小, 最大]）の範囲の個数だけ重ならないように置く（`rooms` は任意。省略したダンジョンは既定値 `config.dungeon.defaultRooms` の 3〜6【仮】を使い、`rooms` があればそれを優先する） → 残りを迷路アルゴリズム（再帰的バックトラック）で通路にする → 部屋と通路の接点に扉を置く → 上り階段を置く → 上り階段からの距離が最大級のセルに下り階段（最下層はボス部屋）を置く → イベントセル・罠セルを部屋以外の行き止まりや部屋内に配る。上り階段から下り階段（またはボス部屋）への経路が必ず存在すること。到達性はテストで保証する。細目: 部屋の一辺は `config.dungeon.roomSize`（[2,4]）【仮】、外周から 1 セル離し、部屋どうしは 8 近傍で接しない間隔で置く。1 部屋あたり `config.dungeon.roomAttempts`（50）【仮】回試し、置けた数が `rooms` の最小に届かなければ配置を最大 `roomAttempts` 回やり直す（実データ d01 / d02 では最小を保証し、テストで確かめる。届かない小さな盤では最も多く置けた回を使う）。扉は部屋ごとに、通路に面した外周の辺から `config.dungeon.doorsPerRoom`（[1,2]）【仮】本。1 階の上り階段は部屋の外のセルから一様に選ぶ。下り階段（最下層はボス）は上り階段からの距離が最大のセルの中から乱数で 1 つ選ぶ（ボスは 1 セル）。行き止まり = 部屋の外で通れる辺が 1 本のセル。イベントと罠は候補（行き止まりと部屋の中。階段・ボスを除く）をシャッフルし、イベント→罠の順に先頭から置く。到達性は「全セルが上り階段から到達可能」に強めて保証する。
- DG-06 1 階の上り階段は街への出口（徒歩で帰る）。2 階以降の上り階段は前の階の下り階段の位置と一致させる。

## 2. 移動と視野

- DG-10 移動: 前進 1 歩（`dungeon.move`）、左右 90° 旋回、180° 反転（`dungeon.turn`）。壁は通れない（`blocked` イベント）。扉は通り抜けで開く（その場で `open` に書き換える）。
- DG-11 遭遇判定は前進が成立した歩ごとに行う（CB-01）。旋回、`blocked`、階段の昇降では行わない。
- DG-12 視野: 自分のセルから前方に奥行き 0〜`config.dungeon.viewDepth`（3）【仮】、左中右の 3 列。`viewDepth` は 1..3（UI-20 の座標表が奥行き 0..3 のため）を検証する。壁と扉で遮られる。core は「見えているセルとその辺の種別」を返す関数 `visibleCells(state)` を提供し、表示層はそれだけで線画を描く（UI-20）。
- DG-13 オートマップ: 見えたセル（現在位置と視野内のセル）をその階の `explored` に記録する。階ごとに保持し、潜行終了で破棄する。マップ画面は探索済みのセルの壁・扉・階段・現在位置と向きを描く。
- DG-14 階段の昇降はコマンドではなく、階段セルに入ったときに確認メッセージを出して選ばせる（`event.choose`）。降りたときに SAN −5（CH-51）。

## 3. 罠とイベント

- DG-20 罠セル【仮】: 落とし穴 `pit`（全員に `config.dungeon.pitDamage`（`1d6`）【仮】のダメージ）、回転床 `spinner`（向きがランダムに変わる）、転移 `teleport`（同じ階のランダムな通路セルへ）。
- DG-21 罠は踏んだときに発動する。慎重の `trapDetect`（EV-42）の判定に成功したメンバーがいれば、発動前に「引き返す」か「進む」かを選べる。
- DG-22 イベントセルはそのダンジョンの `events` から重複なく配置する。踏んだら `events.md` の手順で処理し、処理後は通常セルになる。イベントは潜行全体で各 1 回とし、`events` の i 番目を (i mod floors)+1 階に置く。

## 4. 脱出とボス

- DG-30 脱出手段: 帰還の糸（アイテム `effect.type === "return"`、非戦闘時いつでも、消費）、帰還呪文（MG-40）、徒歩（1 階の上り階段）、テレポーター（DG-32）。いずれも街へ戻り、潜行台帳の内容を持ち帰る。
- DG-31 最下層の `boss` セルには固定遭遇（`dungeons[].boss`）がある。逃走不可（CB-02）。
- DG-32 ボス撃破で、その場に街へのテレポーターが出現し（セルを `teleporter` に書き換える）、`progress.clearedDungeons` にそのダンジョンを加える（永続）。`onClear` で次のダンジョンの開放と店の在庫追加（TW-06）を行う。
- DG-33 クリア済みのダンジョンにも再入場できる（ファーミング用）。ボスは再入場ごとに再出現する【仮】。再撃破でも `onClear` は再度は起きない。
- DG-34 ボス以外のテレポーター（街へ戻る中継点）は `dungeons[].teleporterFloors` に列挙した階にだけ置く【仮】。プロトタイプでは無し。

## 5. 潜行台帳

- DG-40 入場時に `dive.ledger = { items: [], gold: 0 }` を作る。潜行中に得たアイテムのインスタンス ID を `items` に、得た金額を `gold` に加算する。
- DG-41 潜行中に消費・売却（店は無いので実質「使用」）したアイテムは台帳から外す。
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
  "groupCountWeights": { "1": [70, 25, 5, 0], "2": [50, 35, 12, 3] },  // グループ数 1〜4 の重み
  "boss": { "monster": "gatekeeper_armor" },
  "events": ["glowing_tablet", "abandoned_sack"],
  "traps": ["pit", "spinner"],
  "trapsPerFloor": [1, 3],
  "teleporterFloors": [],
  "onClear": { "unlockDungeon": "d02", "shopStock": ["chain_mail"] }
}
```

`GameState.dive`（潜行中のみ存在）:
`dungeonId, diveSeed, floor, pos {x,y}, facing ("N"|"E"|"S"|"W"), explored { [floor]: Set 相当の配列 }, openedDoors [], clearedCells [], bossDefeated, ledger`
