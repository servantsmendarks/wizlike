# キャラクター仕様（CH）

【仮】は数値や選択がプロトタイプで変わる前提。実数は `data/config.json` と `data/*.json` を正とする。

## 1. パーティ

- CH-01 パーティは 6 人固定。並び順 1〜3 が前衛、4〜6 が後衛。
- CH-02 キャラクター作成はゲーム開始時のみ。1 人目に作ったキャラクターがリーダー（主人公）。
- CH-03 リーダーは変更も除外もできない。並び順の変更は街と迷宮内（非戦闘時）で可能。コマンドは `party.reorder {order}`（全員の id の並べ替え。リーダーの位置も自由）。受け付けは街と、迷宮の戦闘外かつ保留なし（それ以外は rejected `wrong screen`。保留中は choice pending）。配列でない・長さが違う・文字列でない・重複・未知の id は `bad order`、今と同じ並びは `no change`。受け付けたら並べ替えて `camp.reordered`。乱数は使わない（M4.5）。
- CH-04 メンバーの追加・除外は、将来の客将（EV-60、【未定】）を除いて発生しない。
- CH-05 タイトルの「新しく始める」で、おすすめ（簡易作成）か自分で作る（CH-06）を選ぶ（M5.5）。プロトタイプの簡易作成では、6 人の名前と性格（リーダー以外）だけを選ぶ。種族・職業・能力値は `data/config.json` の `prototypeParty` で固定。名前は前後の空白を除いて 1〜`config.creation.nameMaxLength`（6）【仮】文字（コードポイント数）。重複は可。性格の「ランダム」は core が乱数で決める。
- CH-06 自分で作る（M5.5）: 6 人（1 人目がリーダー）を 1 人ずつ、種族 → 能力値（CH-11）→ 職業（CH-21）→ 性格（CH-30。リーダーは無し）→ 名前（CH-05 と同じ長さ）の順に決める。各段で 1 つ前へ戻れる。6 人そろったら確認して `game.new {party: {kind: "custom", members}}`（members の各人は `name` / `personality` / `raceId` / `classId` / `stats`）。core は 6 人であること、名前・性格（CH-05 / CH-30 / CH-31 と同じ）、各人の種族・職業の実在（`unknown race at i` / `unknown class at i`）、能力値が 6 つとも種族の基礎値以上 18 以下の整数（`bad stats at i`）、配分の合計（能力値 − 基礎値の和）≤ `bonusBase + bonusDie + bonusBig`（`too many bonus points at i`）、職業の条件（`class requirements not met at i`）をこの順に検証する。`kind` が無い setup は今どおりおすすめ、`custom` 以外の `kind` は `invalid party setup`。開始の装備・所持品・呪文・所持金は CH-24。性格の「ランダム」はおすすめと同じく添字の順に core が乱数で決める。作成中の乱数（CH-11 のボーナス）は表示層が持ち（GameState がまだ無いため。種は `crypto.getRandomValues`）、作成中の下書きは保存しない（SV-50）。

## 2. 能力値

- CH-10 能力値は 力 `str`、知恵 `iq`、信仰心 `pie`、生命力 `vit`、素早さ `agi`、運 `luk` の 6 つ。上限 18。
- CH-11 作成時は種族基礎値（`data/races.json`）に、ボーナスポイント（`7 + 1d4`、5% で `+10`【仮】）を任意に配分する。振り直しは何度でも可。ボーナスは rollDie(`bonusDie`) → chance(`bonusBigChance`) の順で `bonusBase + 出目（当たれば + bonusBig）`。配分は 1 点ずつで、各能力値は基礎値以上 18 以下。残りが 0 になるまで職業へ進めない。振り直すと能力値は基礎値に戻る（M5.5）。
- CH-12 善悪（アライメント）は存在しない。
- CH-13 実効の能力値（M7）: 装備中の品のオプションの能力値（IT-34）を足した値。戦闘・判定・成長・寺院など、能力値を読むルールはすべて実効の値を使う。上限 18 は作成（CH-11）と職業の条件（CH-21）の素の能力値にだけ掛け、実効の値は 18 を超えてよく、1 未満にはしない。作成・職業の条件・`stats` の保存は素の値。計算は IT-35 の 1 か所。
- CH-14 実効の最大値（M7）: `hpMax` / `mpMax` / `sanMax` に装備中のオプション（IT-34 の hpMax / mpMax / sanMax）を足した値（1 未満にはしない。ただし素の mpMax が 0（呪文を使わない職業）なら mpMax は 0 のまま。sanMax は 0 以上）。保存するのは素の値で、ルールと表示は実効の値を使う。装備の付け外しで実効の最大値が下がったら、現在値をその値で止める（増えたときは現在値を変えない。寺院の解呪と全滅で装備中の品を失ったときも同じ。宿の士気の間の SAN は実効の sanMax + sanOver で止める）。

## 3. 種族と職業

- CH-20 種族は `data/races.json` の 5 つ【仮】: 人間、エルフ、ドワーフ、ノーム、ホビット。
- CH-21 職業は `data/classes.json` の 7 つ【仮】: 基本 4（戦士、盗賊、僧侶、魔術師）、上級 3（侍、君主、司教）。`requirements` の能力値を満たすと選べる。
- CH-22 転職は無し【未定】。プロトタイプでは実装しない。
- CH-23 職業は HP ダイス、MP の伸び、呪文系統と習得開始レベル、攻撃回数の伸び、特殊能力（盗賊: 罠解除、司教: アイテム鑑定）を持つ。すべて `classes.json`。
- CH-24 自分で作ったキャラクター（CH-06）の開始の装備・所持品・呪文と所持金への寄与は `classes[].start`（`equipment` / `inventory` / `knownSpells` / `gold`）。装備・所持品・呪文の品目は職業ごとの汎用装備で【仮】。所持金への寄与は全職業 1 人 50G（ユーザー決定 2026-10-04。確定）。所持金はメンバーの `start.gold` の合計（M5.5。6 人で 300G）。データの検証は prototypeParty と同じ（CH-70 / CH-75 / CH-71 / MG-11）に加えて、呪文は重複なし・魔法書専用（`bookOnly`）でない・`learnLevel` 1。簡易作成（CH-05）は `prototypeParty` のまま。

## 4. 性格

- CH-30 作成時に性格を選ぶ: 慎重 `cautious`、無鉄砲 `reckless`、強欲 `greedy`、普通 `normal`。選択肢に「ランダム」があり、4 つから等確率で決まる。
- CH-31 リーダーは性格を持たない（プレイヤー自身が判断するため）。データ上は `personality: null`。
- CH-32 性格の効果（衝動、制止、恩恵、SAN 耐性、オート戦闘の傾向）は `data/personalities.json` を正とする。判定の手順は `events.md` と `combat.md`。
- CH-33 性格は変更できない。

## 5. 生死と状態異常

- CH-40 生死状態 `life`: 生存 `alive` / 死亡 `dead` / 灰 `ash`。
- CH-41 灰になるのは「蘇生を試みて失敗した」ときだけ（寺院 TW-07、蘇生呪文 MG-42）。全滅処理で灰になることはない。
- CH-42 灰からの復活は闇魔術の施設のみ（TW-08）。確定だが高額。
- CH-43 状態異常 `status`（複数同時可）:
  - 毒 `poison`: 迷宮で 1 歩ごと、戦闘で 1 ラウンドごとに HP −1【仮】。HP 1 で止まる（毒では死なない）。持続。解毒草、解毒呪文、寺院で回復。迷宮では、前進の moved（と探索）の直後、罠の前に HP −`poisonDamagePerTick` を適用する（hpChanged だけを出し、message は出さない）。
  - 麻痺 `paralysis`: 行動不能。戦闘後も持続。寺院か呪文で回復。
  - 睡眠 `sleep`: 行動不能。戦闘終了で解除。被弾で 50% 覚醒【仮】。
  - 石化 `stone`: 行動不能。持続。寺院で回復。
- CH-44 行動不能の定義: `life` が `dead`/`ash`、または `status` に麻痺・睡眠・石化、または SAN が 0。
- CH-45 戦闘中に HP が 0 になったら即 `dead`。戦闘後も持続する。戦闘外（罠など）で HP が 0 になっても即 `dead`。仲間の死亡の SAN 減少（CH-51、本人以外の生存者）も起きる。

## 6. SAN 値

- CH-50 各キャラクターは `san`（現在値）と `sanMax`（100【仮】）を持つ。SAN は 0..sanMax に収める。M7: 宿の士気（TW-15）の `sanOver` の間だけ、sanMax を超えてよい（上限は実効の sanMax（CH-14）+ sanOver。街に入ると sanMax に丸める）。
- CH-51 減少の契機と量（`config.san`）【仮】: 階を降りる −5（その潜行で初めて到達した階に降りたときだけ。上って降り直しても減らず、再入場で数え直す。DG-14）、未鑑定の敵グループとの遭遇 −2/グループ、仲間の死亡 −10（本人以外の生存者全員）、敵の SAN 攻撃（CB-31）、イベント。罠の発動時は、生存メンバー（`life` が `alive`）全員の SAN が `config.san.trap`（3）【仮】減る。慎重の `trapLossMul`（CH-54）が効く。罠を察知して回避した場合（DG-21 で「引き返す」を選んだ場合）は減らない。察知しても「進む」を選べば罠は発動し、SAN も減る。
- CH-52 回復: 街に戻ると全回復【仮】（TW-02）。迷宮内では性格の恩恵（EV-22、EV-23、強欲の treasureGain）とイベントだけ。強欲の treasureGain の「財宝入手」は迷宮で金を得た 1 回（戦闘の金 > 0、宝箱の金 > 0、イベントの gold 効果 > 0。M5）で、そのたびに life が alive かつ SAN > 0 の強欲の各人が +treasureGain。金のメッセージの直後に増える。M7: どの回復も sanMax で止まり、SAN が sanMax 以上（士気の超過中）なら増えない（超過分は回復で戻らない。TW-15）。
- CH-53 閾値（割合は `sanMax` 比）【仮】:
  - 50% 未満「不安」（`san < sanMax × config.san.uneasyRatio`）: 戦闘の各行動が 10% の確率で性格傾向の行動に置き換わる（普通は「防御」または対象ランダムの攻撃）。確率は性格の `san.disobeyBelowHalf` が正ならその値（普通 10）、でなければ `config.san.uneasyChance`（10）【仮】。「防御」または対象ランダムの攻撃で防御を選ぶ確率は `config.san.randomDefendChance`（50）【仮】。中身は CB-45。
  - 25% 未満「錯乱」（`san < sanMax × config.san.confusedRatio`）: 戦闘の各行動が 50% の確率でランダム（防御または対象ランダムの攻撃。CB-45）になる。普通も衝動判定に乗る（EV-14）。
  - 0「虚脱」（`san = 0`）: 行動不能（CH-44）。街に戻るまで回復しない。
  - 段は排他で、下の段が優先。虚脱中は SAN が増えず、TW-02 でだけ戻る。
- CH-54 性格による耐性は `personalities.json` の `san` 節（例: 無鉄砲は `fear` タグの減少を半減）。普通は耐性を持たない。減少量に、減少源のタグ（`fear` → fearLossMul、仲間の死亡 `allyInjury` → allyInjuryLossMul、罠 `trap` → trapLossMul）の倍率を掛け合わせ、最後に 1 回切り捨てる。リーダーは倍率 1。階を降りる減少、未鑑定の敵との遭遇、イベントの san 効果には耐性を掛けない。

## 7. 成長

- CH-60 経験値は戦闘勝利時に、生存メンバー（`alive` かつ戦闘に参加）で等分。端数切り捨て。参加者 = 戦闘終了時に life が alive の全員（麻痺・石化・SAN 0 を含む）。
- CH-61 レベルアップは宿屋に泊まったときに処理する【仮】（TW-04）。レベルごとの HP 増分 `hpGain` と MP 増分 `mpGain` を `levelHistory[]` に記録する。増分は最大値と現在値の両方に足す。
- CH-62 EXP 減少（TW-22）でレベルダウンが起きる。レベルダウンは `levelHistory` の末尾を取り消す（HP/MP の最大値も戻す。現在値は最大値を超えない範囲に丸める）。覚えた呪文は失わない。EXP が閾値を下回っている間、1 段ずつ繰り返す。レベル 1 の初期値は取り消さない。
- CH-63 `maxLevelReached` を保持する。呪文習得判定（MG-20）は「初めて到達したレベル」でのみ行う。
- CH-64 必要経験値 `expFor(L)`: レベル L にいるのに必要な累計経験値。`expFor(1) = 0`。L ≥ 2 は `floor(config.growth.expBase × config.growth.expGrowth^(L−2) × classes[].expMultiplier)`【仮】（既定 `expBase` 50、`expGrowth` 1.5。戦士は L2 50 / L3 75 / L4 112）。`exp ≥ expFor(level+1)` でレベルアップでき、`exp < expFor(level)` でレベルダウンする。
- CH-65 HP 増分 = `max(config.growth.hpGainMin, 1d(classes[].hpDie) + floor((vit − config.growth.hpVitPivot) / config.growth.hpVitDivisor))`【仮】（職業 HP ダイス + 生命力補正。負も floor。最低は hpGainMin（1））。レベル 1 の hpMax = `hpDie + max(0, 生命力補正) + config.growth.level1Bonus`（4）【仮】（ダイスの最大値に、正の生命力補正だけを足し、さらに level1Bonus を足す。乱数なし。hpGainMin はレベルアップの増分にだけ使う）。レベル 2 以降の増分は上の式のまま。levelHistory には入れない。MP 増分は `classes[].mpPerLevel` + 関連能力値補正【仮】（MG-01）。

## 8. 装備と所持

M7 で、装備品の分類（汎用 / ユニーク）・実体の形・レベル・希少度・オプション・呪い・ドロップ・売買は `docs/spec/items.md`（IT）を正にする。この節の CH-72〜77 は、実体の欄（IT-10）と表示名（IT-11 / 12）を読み替えて今の手順のまま使う。

- CH-70 装備スロットは 6: 武器 `weapon`、防具 `armor`、盾 `shield`、兜 `helm`、小手 `gauntlet`、装飾 `accessory`。
- CH-71 所持枠は 8（装備中を含む）【仮】。`Character.inventory` は装備中の品を含まない。使用枠 = 装備数 + inventory の数。
- CH-72 未鑑定アイテムは `unidentifiedName` で表示され、装備できない（CH-76）。鑑定は司教（無料。CH-77）か店（有料）。M7: 表示は IT-12、店の鑑定は IT-65。「装備できない」は items.md §11 の Q2【衝突】で代替案（未鑑定のまま装備できる）を諮っている。
- CH-73 呪われたアイテムは装備すると外せない。寺院の解呪（TW-07）で外せる。呪いはアイテムの `cursed` で、未鑑定のうちは見えない（表示で呪いと示さないだけで、外せないことは鑑定と関係ない。CH-76）。M7: 呪いは実体の `cursed`（IT-10 / IT-32。ドロップの判定で付き、負のオプションを 1 つ持つ）で、`items[].cursed` は廃止する。
- CH-74 後衛が攻撃できるのは `ranged: true` の武器を装備しているときだけ（CB-13）。M7: 固有スキル `reachFromBack`（IT-40）の品も同じ扱い。
- CH-75 職業ごとの装備制限は `items[].classes`（空なら全職業可）。M7: 装備のベース `equipment-bases.json` の `classes`（ユニークはベースのものを引き継ぐ。IT-03）。
- CH-76 装備の付け外し（M4.5）: `party.equip {memberId, instanceId}` / `party.unequip {memberId, slot}`。受け付けは街と、迷宮の戦闘外かつ保留なし。本人は行動可能（CH-44）であること。
  - `party.equip` の判定順: wrong screen → no such member → cannot act → item not in inventory（本人の inventory に無い。装備中の品も含まない）→ not equipment（`items[].type` が装備スロットでない）→ not identified（CH-72）→ class cannot equip（CH-75）→ slot cursed（その枠の今の品が `cursed`）。受け付けたら、inventory の新しい品の位置に旧品を入れ（旧品が無ければ取り除く）、枠に新しい品を入れる → `camp.equipped{name, item}`。新しい品が呪われていれば続けて `camp.cursed{item}`。所持枠（CH-71）と潜行台帳は変わらない。
  - `party.unequip` の判定順: wrong screen → no such member → cannot act → bad slot → slot empty → cursed（`items[].cursed` の品は鑑定と関係なく外せない）。受け付けたら枠を空にして inventory の末尾に入れる → `camp.unequipped{name, item}`。
  - どちらも乱数は使わない。
- CH-77 鑑定（M4.5）: `party.identify {memberId, instanceId}`。鑑定する者は `classes[].abilities` に `identify` を持つ職業（司教）。対象はパーティの誰かの inventory にある未鑑定品（装備中は対象外）。受け付けは街と、迷宮の戦闘外かつ保留なし。判定順: wrong screen → no such member → cannot identify → cannot act → no such item → already identified。成功は確定・無料・乱数なしで、`identified` を真にして `camp.identified{name, old, item}`、呪われていれば続けて `camp.identifiedCursed{item}`。M7: ユニークなら図鑑（IT-66）に記録する。`item` は IT-11 の表示名。

## 9. データ

`data/races.json`
```
{ "id": "human", "name": "人間", "baseStats": { "str": 8, "iq": 8, "pie": 5, "vit": 8, "agi": 8, "luk": 9 } }
```

`data/classes.json`
```
{
  "id": "fighter", "name": "戦士",
  "abbr": "WAR",  // 表示用の略称（ui §2 のパーティ欄）。1〜3 文字の ASCII 英大文字
  "requirements": { "str": 11 },          // 満たすべき最小値。無い能力値は制限なし
  "hpDie": 10, "mpPerLevel": 0,
  "spells": {},                            // { "mage": 1 } なら魔術師系をレベル1から
  "learnMod": 0,                           // 習得率の加算
  "attacksPerLevels": 5, "maxAttacks": 3,  // レベル5ごとに攻撃回数+1、最大3。0なら常に1回
  "abilities": [],                         // "disarm" | "identify"
  "expMultiplier": 1.0,
  "start": {                               // CH-24 自分で作ったときの開始の持ち物（品目は【仮】、gold 50 は確定）
    "equipment": { "weapon": "long_sword", "armor": "leather_armor", "shield": "wooden_shield" },
    "inventory": ["herb"], "knownSpells": [], "gold": 50
  }
}
```

`Character`（`src/core/types.ts`）に最低限必要なフィールド:
`id, name, raceId, classId, personality (PersonalityId | null), isLeader, stats, level, exp, maxLevelReached, levelHistory[], hp, hpMax, mp, mpMax, san, sanMax, life, status[], knownSpells[], equipment{slot: itemInstanceId}, inventory[itemInstanceId], lastBattleInput`
`equipment` は 6 スロットのキーをすべて持ち、空きは null。アイテムは実体の id（`GameState.items`）で持つ。
