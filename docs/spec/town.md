# 街仕様（TW）

## 1. 施設

- TW-01 施設は 8 つ: 酒場、宿屋、店、寺院、闇魔術、訓練所、銀行、迷宮入口。プロトタイプで実装するのは宿屋・寺院・闇魔術・迷宮入口と、店の消耗品の購入（TW-05）と、酒場の GM の語り・見回す（TW-13）・キャンプと同じ項目（TW-03。M5.5）・救済。M7 で、宿屋の士気（TW-15）、店の装備の売買・買い戻し・鑑定（TW-05 / IT-60〜65）、銀行に併設の倉庫（TW-16。銀行の金は items.md §11 の Q9 のとおりプロトタイプ後）、闇魔術の強化（TW-17）を足す。
- TW-02 街に入った時点（`town.enter`）で全員の SAN を `sanMax` に戻す【仮】（M7: 士気の超過分 TW-15 もここで `sanMax` に丸め、士気 `morale` を null にする。`sanMax` は CH-14 の実効の値）。街に入る処理は帰還（DG-30）と全滅（TW-26）だけが内部で行い、`town.enter` コマンドは受け付けない（rejected `internal command`）。順は `town.enter` の語り → SAN の回復（life を問わず全員）→ 救済の判定（TW-30）→ 街の画面。
- TW-03 酒場: パーティの状態確認、並び順変更（CH-03）、GM の語り（進行の案内、救済の提示 TW-30）。M4.5 では、酒場の一覧に 状態を見る・装備を替える・並び順を変える を置き、迷宮のキャンプと同じ部品（UI-53 / UI-59。`campMenu` の place town）で開く。装備の付け外し（CH-76）もできる。呪文・道具・鑑定は酒場には出さない（鑑定のコマンド自体は街でも受け付ける。CH-77）。M5.5 でこれを改め、酒場は GM の語り、見回す（TW-13）、迷宮のキャンプと同じ項目（状態・呪文・道具・装備・並び順・鑑定（鑑定できる者がいるとき。`townMenu.canIdentify`））、救済の提示（TW-30）にする。項目はキャンプと同じ部品（UI-53 / UI-59。`campMenu` の place town と `fieldItemMenu`）で開く。街ではフィールドの呪文（MG-32。治癒・解毒・蘇生）と道具（薬草・解毒草・魔法書）も `dungeon.cast` / `dungeon.useItem` で使える。帰還（呪文と帰還の糸）は街では使えない（rejected `not usable here`、一覧では dim）。
- TW-04 宿屋: 部屋のランク（`config.town.innRanks`: 料金と HP 回復量）を選んで泊まる。泊まると、必要経験値に達しているメンバーのレベルアップを処理する（CH-61。複数レベルなら順に）。レベルアップごとに呪文習得判定（MG-20〜24）を行い、ダイスを表示する。料金は 1 泊につき `cost`（馬小屋 0 / 相部屋 20 / 個室 60【仮】）を 1 回払う（満タンでも泊まれる）。回復は `alive` の者だけで、HP は `ceil(hpMax × hpRatio)` を足して `hpMax` で止める（`hpRatio` は馬小屋 0 / 相部屋 1.0 / 個室 1.0【仮】。M7 で相部屋を 0.5 から 1.0 にした。馬小屋では HP は増えない）。MP はどのランクでも `mpMax` まで全回復する（MG-02）。レベルアップはどのランクでも（0G の馬小屋でも）行い、`alive` の者だけ（並び順）。状態異常は治さない（寺院の役目）。
  - M7（ユーザー指示 2026-10-04。宿は時間・運・情報を売る）: 馬小屋 0G は MP 全回復とレベルアップだけ（HP は増えない）。相部屋 20G は HP・MP 全回復（`hpRatio` 0.5 → 1.0【仮】）。個室 60G は HP・MP 全回復に加えて士気（TW-15）。`innRanks` の各ランクは `sanOver` / `goodWeight` / `judgeBonus` / `gossip` を持ち（馬小屋・相部屋は 0 / 0 / 0 / false、個室は 10 / 1 / 1 / true【仮】）、どれかが 0 / false でないランクに泊まると士気が立つ。処理の順は 払う → `town.inn.stay` → HP・MP の回復 →（士気が立つランクなら）士気（TW-15 の SAN の超過回復と `town.inn.morale`）→ レベルアップ。保留: 上位の部屋でのレベルアップの質（HP ダイスを 2 回振って高い方、習得 +10）は後で検討する（ユーザー指示。M7 では作らない）。
- TW-05 店（M7 で実装した形。items.md IT-60〜65）: `town.shop` の kind は `buy` / `sell` / `buyback` / `identify`。売り物は消耗品（`items[].type` が `consumable` かつ `infinite: true` の品。薬草 10G・解毒草 15G・帰還の糸 50G【仮】。在庫無限）と、流通レベルの汎用装備（IT-62）。買うと所持金から買値（消耗品は `price`、装備は IT-60）を払い、鑑定済みの品を本人の所持品の末尾に入れる（乱数なし。街で買った品は潜行台帳に入れない）。売値は IT-61（`config.economy.sellRatio` 0.5）で、ユニークだけが買い戻しのストックに入る（IT-63）。鑑定料は品ごと（見た目の品種の売値 × `identifyFeeRatio`、最低 `identifyFeeMin`【仮】。IT-65）。未鑑定の品も見た目の品種の売値で売れる（IT-61。2026-10-05 ユーザー指示）。詳細と受け付けの順は下の注記。M6 までは在庫制（`items[].stock`。売った品は在庫 +1）の説明で、作っていたのは消耗品の購入だけ（`sell` / `identify` は rejected `not implemented`）だった。
  - M7 で在庫制を置き換えた（items.md §11 の Q3【衝突】）: 売り物は 消耗品（今どおり `infinite` の品）と、流通レベルの汎用装備（IT-62。`buy` の `itemId` はベースの id で、Lv は `progress.shopLevel`。買値は IT-60）。`sell {memberId, instanceId}` は本人の inventory の品を IT-61 の店での売値で売る（鑑定済みのユニークは買い戻しのストックへ。IT-63。2026-10-05 から未鑑定の品も見た目の品種の売値で売れる）。`buyback {memberId, instanceId}` はストックのユニークを `uniques[].price` で本人の inventory の末尾へ戻す。`identify {memberId, instanceId}` は IT-65（品ごとの鑑定料）。受け付けの順は今の buy に揃え、wrong screen → bad action → （kind ごとに）no such member → not alive（buy / buyback だけ）→ not for sale / item not in inventory / not in stock → already identified（identify）→ inventory full（buy / buyback）→ not enough gold（buy / buyback / identify）。乱数は使わない。`items[].stock` は廃止する。
- TW-06 店の流通レベル `progress.shopLevel` は、ダンジョンの初回クリアで `dungeons[].onClear.shopLevel` により上がる（IT-62。max(今の値, shopLevel)）。M6 までは `onClear.shopStock` で在庫を追加していた（各 1 個。`infinite` の品なら無限として解放）が、M7 で流通レベルに置き換えて廃止した。
- TW-07 寺院: 
  - 蘇生: `dead` → `alive`（HP 1）。成功率% = `config.economy.templeSuccessBase`（60）+ `vit × config.economy.templeSuccessPerVit`（2）【仮】、上限 95（`templeSuccessMax`）。M7（2026-10-05 ユーザー指示「灰の経済」）で templeSuccessBase を 50 から 60 にした（vit 12 で 74% → 84%）。式と判定は `rules/town.ts` の `resurrectRate` / `rollResurrect` で、呪文の蘇生（MG-42）と共有する。失敗すると `ash`。費用 = `level × config.economy.templeCostPerLevel`（100）【仮】。費用は成否に関わらず支払う。
  - 治療: 毒・麻痺・石化を回復。費用 = `config.economy.cureCost[status]`。
  - 解呪: 呪われた装備を外す（アイテムは失われる【仮】）。費用 = `config.economy.uncurseCost`。
  - 蘇生の対象は `dead` だけ（`ash` は闇魔術）。判定は d100 ≤ 成功率で、ダイスは表示しない（UI-40 の一覧に寺院は無い）。蘇生しても MP・SAN はそのまま。状態異常は常に無しで戻る（CH-45。死亡の時点で外れている。失敗して灰になっても状態異常は持たない）。M7 の途中までは「状態異常もそのまま」だった（2026-10-05 のユーザー決定で改めた）。
  - 治療は対象の毒・麻痺・石化をすべて治し、`cureCost` の合計を払う。対象は `alive` の者だけ。
  - 解呪は対象が装備している呪われた品をすべて失い、費用は 1 回分。対象の life は問わない。
- TW-08 闇魔術（`town.dark`）: `ash` → `alive`（HP 1）。確定（乱数を使わない）。費用 = `level × config.economy.darkCostPerLevel`（500）【仮】を所持金から払う（M7。2026-10-05 ユーザー指示「灰の経済」で 1000 から 500 にした）（銀行の残高は使わない）。対象は `ash` の者だけ（`alive` / `dead` は rejected `not ash`）、所持金が足りなければ rejected `not enough gold`。戻しても MP・SAN はそのまま、状態異常は常に無し（寺院の蘇生と同じ。CH-45）。M7 で同じ施設に汎用装備の強化（TW-17）を足す。
- TW-09 訓練所: ゲーム開始時のキャラクター作成。以降はステータス閲覧のみ（転職は【未定】）。
- TW-10 銀行: 預入・引出（`town.bank`）。銀行残高 `bank` は全滅ペナルティ（TW-22）の対象外。M7 では併設の倉庫（TW-16）だけを作る（金の預入・引出はプロトタイプ後。items.md §11 の Q9）。
- TW-11 迷宮入口: 開放済みダンジョン（`progress.unlockedDungeons`）を選んで入場（`dungeon.enter`）。入場時に `diveSeed` を発行する（DG-03）。行動可能な者（CH-44）がいなければ入れない（rejected `no one can act`）。M9: 準備中（`placeholder`）のダンジョンは開放済みでも入れない（rejected `not ready`。DG-35。`not unlocked` の後・`no one can act` の前で判定）。`townMenu().dungeons` の各行は `notReady`（準備中か）を持つ（表示層は準備中の行を押したときに理由の文を出す。UI-52）。
- TW-12 冒険のターン数 `adventureTurns`: `dungeon.move` の前進が成立した 1 歩ごとに +1、戦闘のラウンド（CB-10。敵の奇襲・逃走失敗のラウンドを含む）を 1 つ解決するごとに +1。旋回・壁・階段の昇降・罠の引き返し・逃走の成功・debug の移動では増えない。game.new で 0、全滅・帰還で戻さない（M5.5）。
- TW-13 見回す（`town.lookAround`）: 街でだけ受け付ける（それ以外は rejected `wrong screen`。選択の保留中は `choice pending`）。`data/tavern.json` の `lookTexts` から randInt で 1 つを語る。続けて TW-14 の判定をする（M5.5）。
- TW-14 酒場のイベント: `adventureTurns − tavernEventMark ≥ config.town.tavernEventTurns`（200）【仮】のとき、見回すたびに `config.town.tavernEventChance`（30）【仮】% で、`data/tavern.json` の `events` から weight の重みで 1 つを起こし、`tavernEventMark` を今の `adventureTurns` にする。イベントは語り（`text`）と効果（EV-32 のうち `gold` / `san`（対象 `party`）/ `message` / `nothing`。行動者はリーダー）だけで、選択肢・衝動・制止は無い。gold は所持金に足す（台帳は無い）。乱数は 見回すの randInt → chance（条件を満たすときだけ）→ weightedIndex（当たったときだけ）→ 効果の順。`tavernEventMark` の初期値は 0（game.new）。語り・効果の文言は差し込みを持たない（M5.5）。
- TW-15 士気（M7）: 士気が立つランク（TW-04）に泊まると `GameState.morale = { rankId }`（items.md §11 の Q1。指示の `party.morale` の置き場所）にする。次に街に入る（TW-02。帰還・全滅）まで有効で、そこで null に戻す。その間に士気の立たないランクに泊まっても消えず、士気の立つランクに泊まり直すとそのランクで上書きする。効果はそのランクの値（士気が null なら全部 0 / false）【仮】:
  - `sanOver`: 泊まった時点で life alive の者の SAN を「実効の `sanMax`（CH-14）+ sanOver」にする（今より下げない。`sanChanged`）。超過分は回復で戻らない: SAN の増加（CH-52 の回復、EV-22 / EV-23 の制止の報酬など）は `sanMax` で止まり、SAN が `sanMax` 以上なら増えない。減少は超過分から引く。CH-53 の段は `sanMax` 比のまま。表示は「SAN 110/100」で、超過中は色を変える（表示のための比較なので表示層で決めてよい）。
  - `goodWeight`: 衝動の結果（EV-30）の重みで、quality good の各結果に +goodWeight。
  - `judgeBonus`: 制止判定（EV-21）の制止者の側に +judgeBonus。判定の箱に内訳の行「士気 +1」（`dice.bonus.morale`{value}）を出す。制止者の固有スキル `judgeBonus`（IT-40）とは足し合わせ、内訳の行は士気 → 固有スキルの順に 2 行になる（items.md §11 の Q6）。
  - `gossip`: 宿の主人の噂話。次の `dungeon.enter`（diveSeed を引いた直後）で、入るダンジョンの `encounterTable`（全階。ボスは除く）に出る敵のうち図鑑（`bestiary`）で未鑑定の種類を `monsters.json` の順に並べ、randInt で 1 種を選んで鑑定済みにする（図鑑に無ければ kills 0 で作る）。語りは `dungeon.gossip`{monster}（鑑定済みの名前）で、入場の語り `dungeon.enter` の直後に出す（screen{dungeon} → dungeon.enter → dungeon.gossip）。候補が無ければ何もしない（乱数も引かない）。街を出るのは 1 回の士気につき 1 回なので、使った印は持たない。
  - 泊まった再生で `town.inn.morale`（params なし）を語る。
- TW-16 倉庫（M7。IT-64）: `town.storage {action: "deposit" | "withdraw", memberId, instanceId}`。街（`dive` が null）でだけ受け付ける。deposit は本人の inventory の品（装備中は外してから。未鑑定・呪われた品も可）を `warehouse` の末尾へ、withdraw は `warehouse` の品を本人の inventory の末尾へ移す。本人の life は問わない。判定順は wrong screen → bad action → no such member → item not in inventory（deposit）/ not in warehouse（withdraw）→ warehouse full（`config.items.warehouseSlots`）/ inventory full（CH-71）。語りは `town.storage.deposited`{name, item} / `town.storage.withdrawn`{name, item}。乱数は使わない。倉庫の品は全滅（TW-21 / TW-22）の対象外。
- TW-17 汎用装備の強化（M7。闇魔術の施設。IT-70）: `town.upgrade {memberId, slot, catalysts}`。街（`dive` が null）でだけ受け付ける。
  - 対象: 本人の `equipment[slot]` の汎用装備（`uniqueId` が null）1 つ。ユニークは rejected `unique`。呪われていても可。本人の life は問わない。
  - 触媒: 本人の inventory の汎用装備（装備品のベースで `uniqueId` が null）を 0〜`config.economy.upgradeMaxCatalysts`（3）個、重複なし、鑑定済み（未鑑定は Lv が分からないので不可。指示は「所持品の汎用装備」なので items.md §11 の Q13 で【仮】）。呪われた品も可。成否に関わらず実体を消す。オプション・希少度は引き継がない。
  - 成功率 p = min(100, floor(`upgradeRateBase`（10）+ Σ 触媒ごとに `upgradeRatePerCatalyst`（30）× `upgradeDecay`（0.66）^max(0, 対象Lv − 触媒Lv)))【仮】（floor は `floorRatio` と同じく +1e-9）。大成功の率 q = max(1, floor(p ÷ 10))。
  - 判定は d100（randInt(1, 100)）を 1 回。出目 r ≤ q なら大成功で Lv +2、r ≤ p なら成功で Lv +1、それ以外は失敗で Lv −1（0 で止まる）。オプション・希少度・呪いはそのまま。
  - 成功率の小数: p は上の floor で整数にしてから使い、表示（確認の段の成功率・判定の箱の基準）も判定（r ≤ p）もこの同じ整数で行う（UI-40 / CB-04 と同じく、表示している値で比べる。例: Lv1 の対象に Lv0 の触媒 1 個は 10 + 19.8 = 29.8 → p 29 で、出目 29 は成功・30 は失敗）。q もこの整数の p から出す。
  - Lv0 の失敗は Lv0 のまま、語りは同じ `town.upgrade.ng`（「鍛えそこねた。{name}の手に{item}が戻る。」。item は変更後の表示名なので Lv の増減はそこに出る）。
  - 料金 = `config.economy.upgradeBase`（50）× (対象Lv + 1)【仮】。触媒なしでも取る。所持金から払う（銀行は使わない）。
  - 判定順は wrong screen → bad action（形。catalysts が配列でない・多すぎる・重複）→ no such member → bad slot → slot empty → unique → bad catalyst（inventory に無い・装備でない・ユニーク・未鑑定）→ not enough gold。
  - 処理の順は 払う → 触媒を消す → 判定の箱（dice。label `dice.upgrade`{item}、行 `dice.row.roll`（base null、d100）、基準 `dice.upgrade.rule`{rate: p, great: q}（「成功率 p（うち大成功 q）」）、結果 `dice.upgrade.great` / `ok` / `ng`）→ Lv の変更 → `town.upgrade.great` / `ok` / `ng`{name, item}（item は変更後の表示名）。
  - 画面（UI）: キャラ → 部位 → 触媒（0〜3 個を選ぶ）→ 成功率と料金の表示 → 実行 → 判定の箱。成功率・大成功・料金・可否は core の問い合わせ（`upgradePreview`）の値を描き、表示層は計算しない（UI-35）。者ごとの部位（空き・ユニークは対象にできない）と触媒の候補は `townMenu.upgrade` の値を描く。

## 2. 全滅処理

- TW-20 発生は CB-53。パーティは街に戻る。GM の語り（`strings.wipe.*`）で始める。
- TW-21 潜行台帳（DG-40）の取得アイテムと取得金は出目に関係なく全損（DG-42）。語りは `wipe.ledgerLost`。失った金も品も無い（台帳が空）ときは代わりに `wipe.ledgerNone` を出し、内訳の「持ち帰るはずのものは無かった」（`wipe.summary.ledgerNone`）と食い違わないようにする（M4.5）。
- TW-22 2d10 を振り、画面に表示する（UI-40）。`data/penalty-table.json` の帯で次を決める。2d10 を振る前に、出目ごとの帯の表（`penaltyTable` イベント。見出し `wipe.table.title`{dice} と、帯の順に各帯の出目の範囲・名前・金・品・経験の損失（`wipe.table.row`{min, max, name, gold, items, exp}。min = max の帯は `wipe.table.rowOne`{roll, …}。gold / exp は割合 × 100 の四捨五入）。行の文は core が作る）を hit null で出し、振った後に当たった帯の添字を hit に入れてもう一度出す（UI-56。M5.5）。帯は 8 以下（表の箱が 2d10 の箱と重ならないため。検証で止める）。乱数の消費は変えない。
  - `goldLossRatio`: 所持金（台帳分を引いた後）から失う割合。切り捨て（floor(所持金 × ratio + 1e-9)。浮動小数の誤差で 1 ずれないように）。
  - `itemLoss`: 失う所持アイテムの個数。対象は台帳分を除いた所持品（M7: 倉庫 TW-16 と買い戻しのストック IT-63 の品は所持品ではないので対象外）。非装備品から先にランダムに選び、足りなければ装備品から。`infinite` 消耗品も対象。1 個ずつ、候補（非装備が残っていれば 並び順 × inventory の順の非装備、尽きたら 並び順 × 装備枠の順の装備）を作り直して randInt(0, 候補数 − 1) を 1 回引く（候補が 1 個でも引く）。所持品が尽きたら打ち切る。
  - `expLossRatio`: 全メンバー（死亡・灰を含む）の現在 EXP から失う割合。切り捨て（floor(EXP × ratio + 1e-9)）。EXP がレベル閾値を下回ったらレベルダウン（CH-62。1 段ずつ）。語り `wipe.levelDown` は 1 人 1 回、最終レベルで出す。
- TW-23 全滅時点で `alive` だったメンバーは HP を `hpMax × config.wipe.reviveHpRatio`（0.5、切り上げ、最低 1）にして復活（今の HP より下がることもある。全滅時点で alive なら麻痺・石化・SAN 0 の者も対象）。MP は残量のまま。状態異常はすべて解除【仮】。SAN は TW-02 で回復する。
- TW-24 リーダーは全滅時点の状態に関わらず（`dead` でも `ash` でも）TW-23 と同じ扱いで復活する。ゲームルールとして GM が宣言する（`wipe.leaderRule` は、リーダーが全滅時点で `alive` でなかったときだけ出す）。死亡・灰から戻るリーダーは `config.wipe.clearStatus` に関わらず状態異常なしで戻る（CH-45）。
- TW-25 全滅より前に `dead` / `ash` だったメンバー（リーダー以外）はそのまま。
- TW-26 処理後に `town.enter` と同じ処理（SAN 回復、救済判定）を行い、オートセーブする。
- TW-27 全滅した方が安い状況を作らないための不変条件（テストで守る）: 全滅後の総資産（所持金 + 所持品の売値（M7 は IT-61。倉庫の品も両方の側で数える）+ 全員の EXP を金換算しない素の値）は、同じ状態から徒歩で帰還した場合（DG-06。0G で、帰還の糸を消費しない）を上回らない。台帳全損だけで必ず成立するが、ペナルティ表の帯が「損失なし」でもこの不変条件が壊れないことを確認する。帰還の糸で帰った場合とは比べない（糸の売値だけ総資産が下がるので、台帳が空で損失 0 の帯では全滅の方が上回る）。

## 3. GM の救済

- TW-30 判定は街に入るたび（TW-02 の直後）。条件: リーダー以外の全員が `dead` または `ash`、かつ `所持金 + 銀行残高 < 全員のうち最も安い蘇生費`（`dead` なら寺院費用、`ash` なら闇魔術費用）。最も安い蘇生費は `dead` / `ash` の者それぞれの費用の最小。
- TW-31 条件を満たすと GM が「一人を無償で蘇生する」と申し出る。プレイヤーがメンバーを選ぶ（`town.mercy`）。`dead` なら寺院と同じ処理だが失敗しない（HP 1）。`ash` なら闇魔術と同じ処理。どちらも状態異常なしで戻る（CH-45）。
- TW-32 条件が続く限り、街に入るたびに再度申し出る（1 回の来訪につき 1 人）。申し出は来訪ごとに 1 回だけ判定し（同じ来訪の中で条件が変わっても判定し直さない）、`town.mercy` を受けるか `dungeon.enter` で下ろす。申し出の間も宿屋・店・寺院・闇魔術・迷宮入口は使える。`town.mercy` の対象は `dead` / `ash` の誰でもよい（リーダーも含む）。
- TW-33 客将（EV-60）は【未定】。プロトタイプでは実装しない。

## 4. データ

`config.json` の `town` と `economy` 節を参照。`config.town.tavernEventTurns` / `tavernEventChance` は TW-14【仮】。

`data/tavern.json`（TW-13 / TW-14。M5.5）: `lookTexts`（strings のキー。差し込みなし。1 件以上）と `events`（`id` / `name` / `weight`（正の整数）/ `text`（strings のキー。差し込みなし）/ `effects`（`gold` / `san`（`target` は `party`）/ `message` / `nothing` だけ））。events は 1 件以上で id は一意。

`config.town.innRanks` は次の形【仮】（`mpRatio` は無い。MP は全ランクで全回復）。M7（TW-04 / TW-15）の A の実装で `sanOver` / `goodWeight` / `judgeBonus` / `gossip` を足し、相部屋の `hpRatio` を 1.0 にした。
```
"innRanks": [
  { "id": "stable", "name": "馬小屋", "cost": 0,  "hpRatio": 0,   "sanOver": 0,  "goodWeight": 0, "judgeBonus": 0, "gossip": false },
  { "id": "cheap",  "name": "相部屋", "cost": 20, "hpRatio": 1.0, "sanOver": 0,  "goodWeight": 0, "judgeBonus": 0, "gossip": false },
  { "id": "good",   "name": "個室",   "cost": 60, "hpRatio": 1.0, "sanOver": 10, "goodWeight": 1, "judgeBonus": 1, "gossip": true }
]
```
`sanOver` / `goodWeight` / `judgeBonus` は 0 以上の整数、`gossip` は真偽値。M7 の強化（TW-17）の数値は `config.economy` に `upgradeBase` 50・`upgradeRateBase` 10・`upgradeRatePerCatalyst` 30・`upgradeDecay` 0.66・`upgradeMaxCatalysts` 3【仮】を足した（C の実装で。`upgradeBase` は 0 以上の整数、`upgradeRateBase` / `upgradeRatePerCatalyst` は 0..100 の整数、`upgradeDecay` は 0..1 の数、`upgradeMaxCatalysts` は 1 以上の整数）。倉庫の容量は `config.items.warehouseSlots`（items.md §10）。
