# 街仕様（TW）

## 1. 施設

- TW-01 施設は 8 つ: 酒場、宿屋、店、寺院、闇魔術、訓練所、銀行、迷宮入口。プロトタイプで実装するのは宿屋・寺院・迷宮入口（酒場は GM のメッセージ表示だけ）。
- TW-02 街に入った時点（`town.enter`）で全員の SAN を `sanMax` に戻す【仮】。
- TW-03 酒場: パーティの状態確認、並び順変更（CH-03）、GM の語り（進行の案内、救済の提示 TW-30）。
- TW-04 宿屋: 部屋のランク（`config.town.innRanks`: 料金と HP/MP 回復量）を選んで泊まる。泊まると、必要経験値に達しているメンバーのレベルアップを処理する（CH-61。複数レベルなら順に）。レベルアップごとに呪文習得判定（MG-20〜24）を行い、ダイスを表示する。
- TW-05 店: 在庫制。`items[].stock` が初期在庫数、`infinite: true` の品は在庫無限。買値は `price`、売値は `price × config.economy.sellRatio`（0.5）。売った品は在庫 +1 になり、買値で買い戻せる。鑑定は `config.economy.identifyFee` で有料【仮】。プロトタイプ外。
- TW-06 店の在庫は `dungeons[].onClear.shopStock` で追加される（各 1 個。`infinite` の品なら無限として解放）。
- TW-07 寺院: 
  - 蘇生: `dead` → `alive`（HP 1）。成功率% = `config.economy.templeSuccessBase`（50）+ `vit × config.economy.templeSuccessPerVit`（2）【仮】、上限 95。失敗すると `ash`。費用 = `level × config.economy.templeCostPerLevel`（250）。費用は成否に関わらず支払う。
  - 治療: 毒・麻痺・石化を回復。費用 = `config.economy.cureCost[status]`。
  - 解呪: 呪われた装備を外す（アイテムは失われる【仮】）。費用 = `config.economy.uncurseCost`。
- TW-08 闇魔術: `ash` → `alive`（HP 1）。確定。費用 = `level × config.economy.darkCostPerLevel`（1000）【仮】。
- TW-09 訓練所: ゲーム開始時のキャラクター作成。以降はステータス閲覧のみ（転職は【未定】）。
- TW-10 銀行: 預入・引出（`town.bank`）。銀行残高 `bank` は全滅ペナルティ（TW-22）の対象外。
- TW-11 迷宮入口: 開放済みダンジョン（`progress.unlockedDungeons`）を選んで入場（`dungeon.enter`）。入場時に `diveSeed` を発行する（DG-03）。

## 2. 全滅処理

- TW-20 発生は CB-53。パーティは街に戻る。GM の語り（`strings.wipe.*`）で始める。
- TW-21 潜行台帳（DG-40）の取得アイテムと取得金は出目に関係なく全損（DG-42）。
- TW-22 2d10 を振り、画面に表示する（UI-40）。`data/penalty-table.json` の帯で次を決める。
  - `goldLossRatio`: 所持金（台帳分を引いた後）から失う割合。切り捨て。
  - `itemLoss`: 失う所持アイテムの個数。対象は台帳分を除いた所持品。非装備品から先にランダムに選び、足りなければ装備品から。`infinite` 消耗品も対象。
  - `expLossRatio`: 全メンバー（死亡・灰を含む）の現在 EXP から失う割合。切り捨て。EXP がレベル閾値を下回ったらレベルダウン（CH-62）。
- TW-23 全滅時点で `alive` だったメンバーは HP を `hpMax × config.wipe.reviveHpRatio`（0.5、切り上げ、最低 1）にして復活。MP は残量のまま。状態異常はすべて解除【仮】。SAN は TW-02 で回復する。
- TW-24 リーダーは全滅時点の状態に関わらず（`dead` でも `ash` でも）TW-23 と同じ扱いで復活する。ゲームルールとして GM が宣言する。
- TW-25 全滅より前に `dead` / `ash` だったメンバー（リーダー以外）はそのまま。
- TW-26 処理後に `town.enter` と同じ処理（SAN 回復、救済判定）を行い、オートセーブする。
- TW-27 全滅した方が安い状況を作らないための不変条件（テストで守る）: 全滅後の総資産（所持金 + 所持品の売値 + 全員の EXP を金換算しない素の値）は、同じ状態から帰還の糸で帰った場合を上回らない。台帳全損だけで必ず成立するが、ペナルティ表の帯が「損失なし」でもこの不変条件が壊れないことを確認する。

## 3. GM の救済

- TW-30 判定は街に入るたび（TW-02 の直後）。条件: リーダー以外の全員が `dead` または `ash`、かつ `所持金 + 銀行残高 < 全員のうち最も安い蘇生費`（`dead` なら寺院費用、`ash` なら闇魔術費用）。
- TW-31 条件を満たすと GM が「一人を無償で蘇生する」と申し出る。プレイヤーがメンバーを選ぶ（`town.mercy`）。`dead` なら寺院と同じ処理だが失敗しない（HP 1）。`ash` なら闇魔術と同じ処理。
- TW-32 条件が続く限り、街に入るたびに再度申し出る（1 回の来訪につき 1 人）。
- TW-33 客将（EV-12）は【未定】。プロトタイプでは実装しない。

## 4. データ

`config.json` の `town` と `economy` 節を参照。`config.town.innRanks` は `[{ "name": "馬小屋", "cost": 0, "hpRatio": 0.25, "mpRatio": 0.25 }, ...]` の形。
