# アイテム仕様（IT）

敵・アイテム・呪文の個別の数値はすべて暫定で、コンテンツ拡充の段で見直す。

M7「装備・ドロップ・強化・宿の士気」で新設する（2026-10-05）。装備・ドロップ・希少度・オプション・ユニーク・店の売買・倉庫・図鑑はこの文書を正とし、character.md（CH-70〜77）・town.md（TW-05 / 06 / 10 / 16 / 17）・combat.md（CB-20〜23 / 52）・dungeon.md（DG-31 / 32 / 40〜43）・magic.md（MG-33）からはここの ID を参照する。
【仮】は数値や選択がプロトタイプ後も変わる前提。数値の置き場所は `data/config.json` の `items` 節（M7 の実装で足す。下の §10）と `data/*.json` を正とする。
M7 の A（宿の士気）と B（装備・ドロップ・希少度・オプション・ユニーク・店の売買・倉庫・図鑑。§1〜7・§9・§10）は実装済み（2026-10-05）。items.json の装備の行・`config.combat.acMin`・在庫制（`items[].stock` / `onClear.shopStock`）は M6 までの形で、B で置き換えて消した。§8 の強化（IT-70〜。M7 の C。TW-17）も実装済み（2026-10-05。`config.economy` の upgrade* を入れた）。

## 1. 分類

- IT-01 アイテムは 装備（汎用 / ユニーク）・消耗品・魔法書 の 3 種。消耗品と魔法書は今どおり `data/items.json`（M7 の実装で装備の行を `data/equipment-bases.json` に移す）。
- IT-02 汎用装備: 流通している装備。ベースは `data/equipment-bases.json`（汎用ベース表）。実体ごとにレベル（Lv、0 以上の整数）を持つ。店で「流通レベル」（IT-62）のものを無限に買える（オプションなし・通常・鑑定済み）。売却しても店のストックには入らない（IT-61）。
- IT-03 ユニーク: 固有名の装備。`data/uniques.json`（ユニーク表）。性能（ダメージのダイス・AC・魔法攻撃力）は表の固定値で、レベルを持たない（実体の level は常に 0 で、IT-20〜23 のレベルの効果も強化（TW-17）も無い。ダンジョンが進むと時代遅れになる）。固有スキル（IT-40）を 1 つ持つ。売却すると店のストックに入り買い戻せる（IT-63。鑑定済みのときだけ）。鑑定すると図鑑に記録する（IT-66）。部位・装備できる職業・`ranged`・`caster` はベースの値を引き継ぐ。
- IT-04 初期装備（`config.prototypeParty`、`classes[].start`）は汎用 Lv0・通常・オプションなし・鑑定済み・呪いなし。

## 2. 実体と表示

- IT-10 アイテムの実体 `ItemInstance` は `{ id, itemId, level, rarity, options, uniqueId, identified, cursed, foundIn }`（M7。今の `{ id, itemId, identified }` を広げる）。
  - `id`: 実体の id（"i1"〜。コマンドの `instanceId` はこれを指す）。`itemId`: ベースの id（装備は `equipment-bases.json`、消耗品・魔法書は `items.json`）。ユーザー指示の `instanceId` / `baseId` はこの 2 つの今の名前のまま。
  - `level`: 汎用装備の Lv（0 以上）。ユニーク・消耗品・魔法書は 0。
  - `rarity`: `"normal"`（通常）/ `"fine"`（上質）/ `"rare"`（希少）/ `"legendary"`（伝説）。消耗品・魔法書は `normal`。
  - `options`: `{ optionId, tier, value }` の配列（IT-33）。value は符号付きで、生成時に決めた値を持つ（後からレベルが変わっても変わらない）。
  - `uniqueId`: ユニークなら `uniques.json` の id、そうでなければ null。
  - `identified`: 鑑定済みか（CH-72）。`cursed`: 呪われているか（IT-32）。呪いは実体ごとに持つ（今の `items[].cursed` は M7 で廃止）。
  - `foundIn`: ドロップしたダンジョンの id。店で買った品・初期装備は null（IT-66 の入手ダンジョン）。
  - GameState に入れる値なので省略可能な欄は持たない（無いは null か空配列）。
- IT-11 表示名（§11 の Q11 は既定の案で確定: core の `itemDisplayName` が strings の `item.rarity.<rarity>` と `item.plus`（{n} を 1 つだけ持つ。どちらも読み込み時の検証で必須）を引いて組む）: 鑑定済みなら「希少度の接頭辞 + 名前 + Lv」。接頭辞は 通常 なし / 上質「上質な」/ 希少「希少な」/ 伝説「伝説の」（strings の `item.rarity.<rarity>`）。名前はユニークならユニークの名前、それ以外はベースの名前。Lv は汎用装備で 1 以上のときだけ「 +N」（例「上質な長剣 +5」）。オプション・呪い・固有スキルは名前に出さず、詳細の画面（UI-59 の装備の行から開く）に出す。
- IT-12 未鑑定（CH-72）の実体は、ベースの `unidentifiedName`（例「剣？」）だけを出す（希少度・Lv・ユニークかどうか・オプション・呪いは見せない）。未鑑定の品は装備できない（CH-72 / CH-76 のまま。§11 の Q2【衝突】があるので【仮】）。鑑定すると希少度・Lv・オプション・呪い・ユニークの名前と固有スキルが分かる。鑑定は司教（CH-77。無料）か店（IT-65。有料）。未鑑定のままでも店で売れる（見た目の品種の売値。IT-61）。
- IT-13 ドロップ（IT-50）の品は未鑑定で生まれる（魔法書は例外で鑑定済み。IT-55）。店で買った品・買い戻した品・初期装備は鑑定済み。

## 3. レベルの効果

- IT-20 武器（`slot` が weapon で `caster` でないもの）の汎用装備は、ダメージ +floor(Lv ÷ `config.items.weaponLvPerDamage`（2）)【仮】（CB-22）。
- IT-21 防具・盾・兜・小手（armor / shield / helm / gauntlet）の汎用装備は、AC −floor(Lv ÷ `config.items.armorLvPerAc`（3）)【仮】（CB-20）。
- IT-22 術者用武器（ベースの `caster: true`。杖など）の汎用装備は、ダメージは増えず、魔法攻撃力 = ベースの `magicPower` + floor(Lv ÷ `config.items.casterLvPerPower`（2）)【仮】（MG-33）。ベースの `magicPower`（M9。0 以上の整数）は任意で、省略は 0。`caster` が偽の武器には書けない（読み込み時に止める）。上位の杖はこの値で表す（店では Lv = 流通レベルで売るので、Lv だけでは杖の段差が出ないため）。ユニークはベースの値を使わず `uniques[].magicPower`（IT-03）。
- IT-23 装飾（accessory）のレベルは、オプションの段階（IT-33）と値段（IT-60 / 61）にだけ効く。
- IT-24 AC の下限（`config.combat.acMin` −10）は M7 で撤廃し、命中率の `hitMin`〜`hitMax`（5〜95%）のクランプに任せる（CB-20 / CB-21）。

## 4. 希少度・呪い・オプション

- IT-30 希少度は 4 段階で、オプションの個数は 通常 0 / 上質 1 / 希少 2 / 伝説 3（`config.items.rarities[].options`）。ドロップのたびに `config.items.rarities[].weight`（通常 75 / 上質 18 / 希少 6 / 伝説 1）【仮】の重みで引く。ユニークも同じ判定を受ける（同じユニークでも当たり外れがある）。店で買う汎用装備は常に通常。
- IT-31 宝箱（CB-52）の品は、行動可能（CH-44）な味方の性格の `benefits.chestQuality`（強欲 1）の最大（合計しない）だけ、引いた希少度を上げる（伝説で止まる。乱数は使わない）。ボスの戦利品には効かない。CB-52 の旧文「1 段階上の表を引く」はこれで置き換える。
- IT-32 呪い: ドロップのたびに `config.items.curseChance`（8）%【仮】で呪われる（ユニークも同じ。店の品は呪われない）。呪われた品は、希少度の個数より 1 つ多くオプションを持ち、最後に引いた 1 つの値の符号を反転する（負の効果）。呪われた品は装備すると外せず（CH-73）、寺院の解呪（TW-07）で失う。呪いと負のオプションは鑑定するまで見えない（IT-12）。
- IT-33 オプションは `data/item-options.json`（オプション表）から、重み `weight` で、同じ実体の中で重複しないように引く。値は段階 `tier`（1〜3）の値 `values[tier − 1]`。段階は汎用装備なら min(3, 1 + floor(Lv ÷ `config.items.optionTierStep`（4）))【仮】（Lv0〜3 は 1、4〜7 は 2、8 以上は 3）、ユニークは `uniques[].optionTier` の固定値。生成した後でレベルが変わってもオプションは変わらない（TW-17）。
- IT-34 オプションの効果（装備中の品のものだけを、全部位の分を足して使う。鑑定の有無に関係なく効く）【仮】:
  - 能力値 `stat`（6 種。+1 / +2 / +3）: 能力値に足す（CH-13 の実効の能力値）。
  - 最大 HP `hpMax`（+3 / +6 / +10）・最大 MP `mpMax`（+2 / +4 / +6）: 実効の最大値に足す（CH-14）。
  - 命中 `hit`（+5 / +10 / +15 %）: CB-21 の命中率の clamp の内側に足す（味方の攻撃）。
  - ダメージ `damage`（+1 / +2 / +3）: CB-22 の味方の攻撃ダメージに足す。
  - AC `ac`（−1 / −1 / −1）: CB-20 の AC から引く（値は AC を下げる量）。
  - 行動順 `initiative`（+1 / +2 / +3）: CB-11 の initiative に足す。
  - 最大 SAN `sanMax`（+5 / +10 / +15）: 実効の sanMax に足す（CH-14）。
  - 恐怖系の SAN 減少 `fearLoss`（−10 / −20 / −30 %）: CB-31 / CH-54 の fear タグの減少に (1 − 値 ÷ 100) を掛ける（性格の fearLossMul と掛け合わせ、最後に 1 回切り捨て）。
  - 状態異常の付与率 `statusResist`（毒・麻痺・睡眠・石化の 4 種。−10 / −20 / −30 %）: CB-30 の付与の確率から引く（その状態だけ）。
  - 罠察知 `trapDetect`（+5 / +10 / +15 %）: DG-21 のその者の察知の確率に足す（性格の `trapDetect` と合わせて正なら、リーダーも振る）。
  - 鑑定率 `identifyRate`（+5 / +10 / +15 %）: CB-05 のラウンド終了の確率鑑定に、行動可能な味方の値の合計を足す（敵の鑑定と読んだ。§11 の Q4）。
  - 金運 `goldLuck`（+2 / +4 / +6 %。控えめ）: 戦闘の金（CB-51）と宝箱の金（CB-52）を、行動可能な味方の値の合計 % だけ増やす（floor(金 × (100 + 合計) ÷ 100)）。
  - 負のオプション（IT-32）は同じ式に負の値を入れる（能力値・最大値は 1 未満にしない。確率は 0 未満にしない）。
- IT-35 実効の値の計算は core の 1 か所（`rules/equip-stats.ts` の `equipStats(state, data, ch)`）で行い、ルールはそこから読む。表示層は計算しない（UI-35）。

## 5. 固有スキル

- IT-40 ユニークだけが持つ。閉じた集合から始めて後で増やす。`uniques[].skill` は `{ type, value }`【仮】（value を使わない `reachFromBack` / `fearImmune` / `autoIdentify` は 0）。装備中だけ効く。
  - `mpCostDown`: その者の呪文の MP 消費 −value（最低 1。ただし元の消費より増やさない（`spells[].mp` が 0 の呪文は 0 のまま）。MG-30。複数の品なら合計）。
  - `extraAttack`: CB-23 の攻撃回数 +value（`maxAttacks` を超えてよい）。
  - `reachFromBack`: 後衛からでも近接攻撃できる（CB-13 の `ranged` と同じ扱い）。
  - `initiativeUp`: CB-04 の先手判定で味方側の合計に +value（パーティに 1 人でも行動可能な装備者がいれば。複数でも（1 人が 2 つ装備していても）品の値の最大の 1 つ）。
  - `fearImmune`: その者の fear タグの SAN 減少を 0 にする（CB-31）。
  - `lifeSteal`: その者の攻撃が当たるたびに、与えたダメージ（attack の damage の値。残り HP で頭打ちにしない）の value % を切り捨てで HP に戻す（実効の hpMax で止まる。0 なら何もしない）。語りは battle.hit の後に `battle.lifeSteal`{name, hp}。
  - `autoIdentify`: 遭遇の時点で装備者が行動可能なら、全グループを鑑定済みにする（MG-41 と同じ語り `battle.identified` と `enemyGroups` を `battle.encounter` の後に出す。CB-06 の SAN 減少より前）。
  - `walkRegen`: 迷宮の前進が成立した歩で、`adventureTurns` が value の倍数になったとき、装備者（life alive）の HP +1（毒の後。CH-43。品ごとに判定し、hpChanged だけを出す）。
  - `judgeBonus`: 装備者が制止者のとき、EV-21 の制止者の側に +value（宿の士気 TW-15 の judgeBonus と足し合わせる。判定の箱には士気の行の後に内訳の行 `dice.bonus.skill`{item, value} を出す。§11 の Q6）。

## 6. 入手（ドロップ）

- IT-50 ドロップ元は 宝箱（CB-52。ランダム遭遇の勝利時に、部屋のセルなら `config.combat.chestChance`（60）%【仮】、通路のセルなら `config.combat.chestChanceCorridor`（15）%【仮】。2026-10-05 に通路を足した）と ボスの戦利品（DG-31。ボスに勝つたび。再撃破でも）の 2 つ。どちらも `data/drops.json`（ドロップ表）を引く。宝箱の金（`config.combat.chestGoldDice`）は今のまま出し、品はその後に引く。ボスの戦利品はボスの語り（`battle.bossDefeated`・初回の `battle.dungeonCleared`・`dungeon.unlocked`）の後、`screen`{dungeon} とテレポーターの申し出（DG-32）の前に引く。
- IT-51 ドロップ表 `drops.json` は `tables`（表の配列）・`chest`（ダンジョン id → 階番号の文字列 → 表の id）・`boss`（ダンジョン id → 表の id）を持つ。表は `{ id, itemChance, rolls, entries }` で、`entries` の各要素は `{ base, weight }` か `{ unique, weight }` か `{ item, weight }`（魔法書。IT-55。M9）のどれか 1 つ。`rolls` 回だけ、`itemChance` % で 1 品を引く（rolls 回とも独立）。
- IT-52 1 品の生成と乱数の順: chance(itemChance) → weightedIndex(entries) →（魔法書の項目ならここで終わり。IT-55）→（汎用なら）Lv の randInt(−`config.items.dropLevelSpread`（1）, +spread) → weightedIndex(rarities) → chance(curseChance) → オプションの個数（IT-30 / IT-32）だけ weightedIndex（オプション表から既に引いたものを除いた残り）。宝箱の chestQuality（IT-31）は希少度を引いた直後に足す（乱数なし）。
- IT-53 ドロップの Lv = 落とした敵の Lv（`monsters[].level`）± spread、最低 1【仮】。宝箱の「落とした敵」はその戦闘で倒した敵のうち `level` が最大の種類。ボスはボスの `level`。
- IT-54 生成した品は未鑑定（IT-13）で、並び順に最初に所持枠（CH-71）が空いている者（life を問わない）の inventory の末尾に入れ、潜行台帳（DG-40）に入れる。誰も空いていなければ置いていく（`item.leftBehind`{item}。品は作らないので item はベースの `unidentifiedName`。乱数は引いた分を消費したまま）。語りは `item.found`{name, item}（item は未鑑定の表示名）。
- IT-55 ドロップ表の魔法書の項目（M9）: `{ item, weight }` の `item` は `items.json` の id で、`type` が `book` のものだけ（読み込み時に止める）。引いた品は Lv0・通常・オプションなし・呪いなし・`uniqueId` null・**鑑定済み**で生まれる（隠す中身が無いため。IT-13 の例外）。乱数は weightedIndex(entries) の後に何も引かない（Lv・希少度・呪い・オプションを引かない）。所持枠（IT-54）が空いていなければ置いていき、語り `item.leftBehind` の item は品の `name`。

## 7. 経済と施設

- IT-60 汎用装備の買値 = floor(ベースの `price` × (1 + `config.items.levelPriceRatio`（0.5）× Lv))【仮】。
- IT-61 売値: 汎用装備 = floor(ベースの `price` × `config.economy.sellRatio`（0.5）× (1 + levelPriceRatio × Lv)) + オプションの分（正のオプションごとに `config.items.optionSellValue[tier − 1]`（20 / 40 / 80）【仮】。負のオプションは 0）。ユニーク = floor(`uniques[].price` × sellRatio)（希少度・オプションに関わらず固定）。消耗品・魔法書 = floor(`price` × sellRatio)（TW-05 の旧規則のまま）。装備中の品は売れない（inventory に無いので rejected `item not in inventory`）。
  - 2026-10-05 ユーザー指示（経済【仮】）: 未鑑定の品も売れる。店での売値（`shopSellPrice`）は、鑑定済みなら上の本当の売値、未鑑定なら「見た目の品種の売値」= 未鑑定の表示（IT-12）が出しているベース（装備。ユニークならそのベース）または品（消耗品・魔法書）の Lv0・通常・オプションなしの売値 floor(`price` × sellRatio)（例: 未鑑定の長剣は Lv・希少度・オプション・ユニークに関わらず 50G）。それまでの rejected `not identified`（sell）は廃止した。未鑑定のまま売った品はユニークでも実体を消す（買い戻しのストックに入れない・図鑑に記録しない。IT-63）。品の詳細（UI-59）の売値も店での売値を出す（未鑑定なら見た目の品種の売値）。TW-27 の総資産は今どおり本当の売値（`sellPrice`）で数える（全滅と徒歩の帰還の両方の側で同じ関数なので不変条件は変わらない）。
- IT-62 店の流通レベル `progress.shopLevel`: game.new で 0。ダンジョンの初回クリア（DG-32）で max(今の値, `dungeons[].onClear.shopLevel`)（d01 2 / d02 4【仮】）にする。店は `equipment-bases.json` のうち `shopMinLevel ≤ shopLevel` のベースを、Lv = shopLevel・通常・鑑定済み・オプションなしで無限に売る（TW-05）。`onClear.shopStock`（TW-06 の在庫の追加）は M7 で廃止する。上がったときだけ、品の語り（IT-50 の `item.found`）の後に message `dungeon.shopLevel`（params なし）を出す（すでに同じか高ければ変えず語らない）。購入の語りは `town.shop.bought`{name, item（表示名「長剣 +2」）, cost}。
- IT-63 ユニークの買い戻し: 鑑定済みのユニークを売ると（未鑑定のまま売ったユニークは汎用と同じく実体を消す。IT-61 の 2026-10-05 の注記）、その実体を店の買い戻しのストック `buyback`（実体の id の配列。売った順）に入れる。ストックの品は `uniques[].price` で買い戻せ（その実体をそのまま返す。希少度・オプション・呪いもそのまま）、ストックから外れる。汎用・消耗品・魔法書は売ると実体を消す（ストックに入らない）。ストックは全滅（TW-22）の対象外。語りは売却 `town.shop.sold`{name, item, gold}、買い戻し `town.shop.boughtBack`{name, item, cost}。乱数は使わない。
- IT-64 倉庫（TW-16）: 銀行に併設。品の実体の id の配列 `warehouse`。容量は `config.items.warehouseSlots`（40）【仮】。全滅（TW-21 / 22）の対象外。
- IT-65 店の鑑定: `town.shop {kind: "identify"}` で鑑定料（品ごと。下の注記。M7-B までは一律の `config.economy.identifyFee`（100））を払い、本人の inventory の未鑑定の品を鑑定する（結果は CH-77 と同じ。乱数なし）。本人の life は問わない（TW-05 の M7 の順）。語りは `town.shop.identified`{name, old, item, cost, rarity}（rarity は CH-77 と同じく音の契機。UI-66。料金を見せるため CH-77 の `camp.identified` とは別のキー）、呪われていれば続けて `camp.identifiedCursed`{item}。
  - 2026-10-05 ユーザー指示（経済【仮】）: 鑑定料 = max(`config.economy.identifyFeeMin`（10）, floor(見た目の品種の売値（IT-61）× `config.economy.identifyFeeRatio`（0.5）))【仮】。品の本当の Lv・希少度・オプション・ユニークは料金に反映しない（鑑定料から中身を推測できないようにする）。例: 長剣 50 → 25G、護符 100 → 50G、短剣 7 → 3 → 10G。司教の鑑定（CH-77）は無料のまま。`townMenu.shop.identify` は品ごとの `fee` と `affordable`（gold ≥ fee）を持つ（全体の fee / affordable は外した）。
- IT-66 図鑑（ユニーク）`uniqueBook`: uniqueId → `{ foundIn, bestRarity }`。ユニークを鑑定した時点（司教・店）で記録し（指示は「入手は図鑑に記録」。§11 の Q12 で【仮】）、既にあれば bestRarity だけを良い方に更新する（foundIn は最初の記録のまま。foundIn が null の実体なら null）。ゲーム単位で永続（全滅・売却でも消えない）。名前は uniques.json から出す。

## 8. 強化

- IT-70 汎用装備の強化は闇魔術の施設のサービス（TW-17）。ユニークは強化できない。

## 9. 保存

- IT-80 保存の移行（M7）。A（宿の士気）で schemaVersion 3（v2 → v3 で `morale` null を足す。TW-15）、B（この文書）で schemaVersion 4 にする（A は単独で公開され得るので、公開した v3 の移行を後から書き換えない）。v3 → v4 の移行: 各 `items` の実体に `level` 0・`rarity` "normal"・`options` []・`uniqueId` null・`cursed` false（v3 までの遊びに呪われた品を手に入れる経路は無い。cursed_dagger はテストでしか作らず、§11 の Q10 で廃止する）・`foundIn` null を足す（`identified` は今の値のまま）。GameState に `warehouse` []・`buyback` []・`uniqueBook` {}・`progress.shopLevel`（`clearedDungeons` の各 `onClear.shopLevel` の最大。無ければ 0）を足す。SV-04 の形の検査に、これらの型を足す。

## 10. データ

`data/equipment-bases.json`（汎用ベース表。M7 の雛形。B の実装で読み込みと検証を足し、`items.json` の装備の行を消す）
```
{ "id": "long_sword", "name": "長剣", "unidentifiedName": "剣？", "slot": "weapon",
  "damage": "1d8", "ranged": false, "caster": false,      // 武器だけ
  "magicPower": 1,                                         // 任意。caster の武器だけ（IT-22。M9）
  "ac": 0,                                                 // 防具類と装飾（武器は持たない）
  "classes": ["fighter", "samurai", "lord"], "price": 100, "shopMinLevel": 0 }
```

`data/item-options.json`（オプション表）
```
{ "options": [ { "id": "str", "name": "力", "effect": { "type": "stat", "stat": "str" }, "unit": "", "values": [1, 2, 3], "weight": 4 } ] }
```
`effect.type`: `stat` / `hpMax` / `mpMax` / `hit` / `damage` / `ac` / `initiative` / `sanMax` / `fearLoss` / `statusResist`（`status`）/ `trapDetect` / `identifyRate` / `goldLuck`。`values` は段階 1〜3 の正の値。

`data/uniques.json`（ユニーク表）
```
{ "id": "dawn_flint_staff", "name": "…", "base": "staff",
  "damage": "1d6", "magicPower": 2,          // 武器（caster なら magicPower）。防具類は "ac"
  "skill": { "type": "mpCostDown", "value": 1 }, "optionTier": 2, "price": 900, "description": "…" }
```

`data/drops.json`（ドロップ表）
```
{ "tables": [ { "id": "d01_f1", "itemChance": 40, "rolls": 1,
                "entries": [ { "base": "dagger", "weight": 4 }, { "unique": "twin_tongue_dagger", "weight": 1 },
                             { "item": "tome_sanctuary_hymn", "weight": 1 } ] } ],   // item は魔法書だけ（IT-55）
  "chest": { "d01": { "1": "d01_f1", "2": "d01_f2" } },
  "boss":  { "d01": "d01_boss" } }
```

`config.items`（M7 の B3 で config.json に入れた。検証は rarities の順と件数・重みの合計 > 0・個数 0〜3、optionSellValue 3 件、*LvPer* と optionTierStep は正の整数）【仮】:
`rarities`（`[{ id, weight, options }]` 通常 75/0・上質 18/1・希少 6/2・伝説 1/3）、`curseChance` 8、`optionTierStep` 4、`dropLevelSpread` 1、`weaponLvPerDamage` 2、`armorLvPerAc` 3、`casterLvPerPower` 2、`levelPriceRatio` 0.5、`optionSellValue` [20, 40, 80]、`warehouseSlots` 40。`config.economy` に `upgradeBase` 50・`upgradeRateBase` 10・`upgradeRatePerCatalyst` 30・`upgradeDecay` 0.66・`upgradeMaxCatalysts` 3（TW-17）。`config.combat.acMin` は削除（IT-24）。`dungeons[].onClear` は `shopStock` を `shopLevel` に置き換える。

## 11. 未決（ユーザーに確認すること。2026-10-05）

既定の案で仕様を書いた。代替案を選ぶときはこの文書と関係する仕様を直す。経緯は `docs/decisions.md` の 2026-10-05 の行。

- Q1【衝突】士気の置き場所。指示は `GameState.party.morale` だが、`party` は `Character[]`（配列）で欄を足せない。既定: `GameState.morale`（`{ rankId } | null`）に置く（TW-15）。代替: `party` を `{ members, morale }` のオブジェクトにする（全ルール・表示層・保存の書き換えになる）。
- Q2【衝突】未鑑定の装備。CH-72 は「未鑑定の品は装備できない」だが、指示の「呪いは鑑定するまで見えない」は、未鑑定のまま装備できるときにだけ罠として効く。既定: CH-72 のまま（呪いは鑑定で分かってから装備するかを選ぶ負のオプションになる）。代替: 未鑑定の装備を許し（Wizardry 式）、装備して初めて呪いが効く（CH-76 の判定から not identified を外す）。
- Q3【衝突】店の在庫制。2026-09-30 の決定「店は在庫制。売った物は買値で買い戻せる。ダンジョンクリアで在庫が増える」と TW-05 / TW-06 は、指示の「汎用は流通レベルで無限に買え、売ってもストックに入らない。ユニークだけ買い戻せる」と食い違う。既定: 指示に従い、装備の在庫（`items[].stock`、`onClear.shopStock`）を廃止して流通レベル（IT-62）と買い戻し（IT-63）にする。消耗品は今どおり無限。代替: 汎用も売った実体をストックに入れて買い戻せるようにする。
- Q4 鑑定率 +x% の読み。アイテムの鑑定（CH-77 / IT-65）は確定で率が無い。既定: 敵の確率鑑定（CB-05）の率に足す。代替: アイテムの鑑定に成功率を入れ（司教・店）、それに足す。
- Q5 士気の「イベントの能力値判定に +1」の読み。今のイベントで能力値を使う判定は、衝動の点数（EV-11。高いほど勝手に動く）と制止判定（EV-21）だけ。既定: 制止判定の制止者の側だけに足す（衝動の点数に足すと暴走が増え、士気の利点と逆になるため）。代替: 衝動の点数にも足す。
- Q6 固有スキル「判定の出目 +1（士気と同じ枠）」。決定（2026-10-05、ユーザー）: 足し合わせる（IT-40 / TW-15 / EV-21）。判定の箱には内訳を士気 → 固有スキルの順に 2 行で出す。当初の既定は「士気と重ねず大きい方」だった。
- Q7 宝箱の罠と A7。M5 で「宝箱の罠・chestQuality はプロトタイプ後」（A7）とした。指示で chestQuality は M7 に入る（IT-31。CB-52 の旧文「1 段階上の表」は希少度 +1 に置き換え）。既定: 宝箱の罠（調べる・解除・発動）はプロトタイプ後のまま。代替: 罠も M7 で作る。
- Q8 CLAUDE.md §10 の仕様書の索引に `docs/spec/items.md`（接頭辞 IT）を足す承認。
- Q9 銀行。指示は「倉庫は銀行に併設」。既定: M7 で作るのは倉庫だけで、金の預け入れ・引き出し（TW-10、`town.bank`）はプロトタイプ後のまま。代替: 銀行の金も M7 で作る。
- Q10【衝突】`cursed_dagger` と `items[].cursed`。呪いは実体ごとにドロップの判定で付く（IT-32）ので、固定で呪われた品（血濡れの短剣。説明の「攻撃のたびに SAN −1」は未実装）は M7 で廃止する（テストは実体の `cursed` を立てた短剣で書き直す）。廃止の時期は、実体に `cursed` を足す B2（IT-10 の実体化）のコミットで、`items[].cursed` の削除・テストの置き換えと同時にする（それより前のコミットでは今の `items[].cursed` が呪いの出どころのまま）。代替: 「常に呪われたユニーク」として uniques.json に残す（SAN −1 の固有スキルを足す）。
- Q11 表示名を誰が組むか（IT-11）。今の core は strings の値を読まない（`data.strings` を見るのは検証だけ）。既定【仮】: core の `itemDisplayName` が `data.strings` の `item.rarity.<rarity>` と `item.plus` を引いて組む（core が strings の値を読む初めての場所になる。§3-10 の「表示層のコードに日本語を書かない」は守れる）。代替: message の params に部品（接頭辞のキー・名前・Lv）を入れて表示層が組む（今の formatMessage は params の値をキーとして引き直さないので、その仕組みを足す）。B6 の前に決める。
- Q12 図鑑に記録する時点（IT-66）。指示は「入手は図鑑に記録」。既定: 鑑定した時点（入手の時点だと未鑑定の品の正体が図鑑から漏れるため）。代替: 入手した時点で記録する（図鑑は「名前は鑑定まで ？？？」などで正体を隠すか、漏れを許す）。
- Q13 強化の触媒（TW-17）。指示は「所持品の汎用装備」。既定: 本人の inventory の鑑定済みの汎用装備に限る（未鑑定だと成功率から Lv が漏れるため）。ドロップは未鑑定で生まれる（IT-13）ので、触媒にする前に鑑定が要る。代替: 未鑑定の品も触媒にできる（成功率の表示から Lv が推し量れるのは許す）。
- Q14 M7 の config の数値。`innRanks` の 4 欄・`config.items`・`config.economy` の強化の数値（upgrade*）は、今の検証が未知の欄・節で起動を止めるので、まだ config に入れず docs（§10・town.md §4・設計書）にだけある。A / B / C の各実装の最初のコミットで config に入れる（指示の「数値はすべて【仮】で config か data に置く」はその時点で満たす）。
- あわせて決めてほしい細部（既定で書いた）: 実体の欄名は今の `id` / `itemId` のまま（指示の `instanceId` / `baseId`）で、`uniqueId` は省略可能ではなく null（IT-10）／売値の式の「基本額」を `price × sellRatio` と読んだ（IT-61）。
