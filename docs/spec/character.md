# キャラクター仕様（CH）

【仮】は数値や選択がプロトタイプで変わる前提。実数は `data/config.json` と `data/*.json` を正とする。

## 1. パーティ

- CH-01 パーティは 6 人固定。並び順 1〜3 が前衛、4〜6 が後衛。
- CH-02 キャラクター作成はゲーム開始時のみ。1 人目に作ったキャラクターがリーダー（主人公）。
- CH-03 リーダーは変更も除外もできない。並び順の変更は街と迷宮内（非戦闘時）で可能。
- CH-04 メンバーの追加・除外は、将来の客将（EV-60、【未定】）を除いて発生しない。
- CH-05 プロトタイプの簡易作成では、6 人の名前と性格（リーダー以外）だけを選ぶ。種族・職業・能力値は `data/config.json` の `prototypeParty` で固定。名前は前後の空白を除いて 1〜`config.creation.nameMaxLength`（6）【仮】文字（コードポイント数）。重複は可。性格の「ランダム」は core が乱数で決める。

## 2. 能力値

- CH-10 能力値は 力 `str`、知恵 `iq`、信仰心 `pie`、生命力 `vit`、素早さ `agi`、運 `luk` の 6 つ。上限 18。
- CH-11 作成時は種族基礎値（`data/races.json`）に、ボーナスポイント（`7 + 1d4`、5% で `+10`【仮】）を任意に配分する。振り直しは何度でも可。
- CH-12 善悪（アライメント）は存在しない。

## 3. 種族と職業

- CH-20 種族は `data/races.json` の 5 つ【仮】: 人間、エルフ、ドワーフ、ノーム、ホビット。
- CH-21 職業は `data/classes.json` の 7 つ【仮】: 基本 4（戦士、盗賊、僧侶、魔術師）、上級 3（侍、君主、司教）。`requirements` の能力値を満たすと選べる。
- CH-22 転職は無し【未定】。プロトタイプでは実装しない。
- CH-23 職業は HP ダイス、MP の伸び、呪文系統と習得開始レベル、攻撃回数の伸び、特殊能力（盗賊: 罠解除、司教: アイテム鑑定）を持つ。すべて `classes.json`。

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
  - 毒 `poison`: 迷宮で 1 歩ごと、戦闘で 1 ラウンドごとに HP −1【仮】。HP 1 で止まる（毒では死なない）。持続。解毒草、解毒呪文、寺院で回復。
  - 麻痺 `paralysis`: 行動不能。戦闘後も持続。寺院か呪文で回復。
  - 睡眠 `sleep`: 行動不能。戦闘終了で解除。被弾で 50% 覚醒【仮】。
  - 石化 `stone`: 行動不能。持続。寺院で回復。
- CH-44 行動不能の定義: `life` が `dead`/`ash`、または `status` に麻痺・睡眠・石化、または SAN が 0。
- CH-45 戦闘中に HP が 0 になったら即 `dead`。戦闘後も持続する。戦闘外（罠など）で HP が 0 になっても即 `dead`。仲間の死亡の SAN 減少（CH-51、本人以外の生存者）も起きる。

## 6. SAN 値

- CH-50 各キャラクターは `san`（現在値）と `sanMax`（100【仮】）を持つ。
- CH-51 減少の契機と量（`config.san`）【仮】: 階を降りる −5（その潜行で初めて到達した階に降りたときだけ。上って降り直しても減らず、再入場で数え直す。DG-14）、未鑑定の敵グループとの遭遇 −2/グループ、仲間の死亡 −10（本人以外の生存者全員）、敵の SAN 攻撃（CB-31）、イベント。罠の発動時は、生存メンバー（`life` が `alive`）全員の SAN が `config.san.trap`（3）【仮】減る。慎重の `trapLossMul`（CH-54）が効く。罠を察知して回避した場合（DG-21）は減らない。
- CH-52 回復: 街に戻ると全回復【仮】（TW-02）。迷宮内では性格の恩恵（EV-22、EV-23、強欲の treasureGain）とイベントだけ。
- CH-53 閾値（割合は `sanMax` 比）【仮】:
  - 50% 未満「不安」（`san < sanMax × config.san.uneasyRatio`）: 戦闘の各行動が 10% の確率で性格傾向の行動に置き換わる（普通は「防御」または対象ランダムの攻撃）。
  - 25% 未満「錯乱」（`san < sanMax × config.san.confusedRatio`）: 戦闘の各行動が 50% の確率でランダムになる。普通も衝動判定に乗る（EV-14）。
  - 0「虚脱」（`san = 0`）: 行動不能（CH-44）。街に戻るまで回復しない。
  - 段は排他で、下の段が優先。虚脱中は SAN が増えず、TW-02 でだけ戻る。
- CH-54 性格による耐性は `personalities.json` の `san` 節（例: 無鉄砲は `fear` タグの減少を半減）。普通は耐性を持たない。減少量に、減少源のタグ（`fear` → fearLossMul、仲間の死亡 `allyInjury` → allyInjuryLossMul、罠 `trap` → trapLossMul）の倍率を掛け合わせ、最後に 1 回切り捨てる。リーダーは倍率 1。階を降りる減少、未鑑定の敵との遭遇、イベントの san 効果には耐性を掛けない。

## 7. 成長

- CH-60 経験値は戦闘勝利時に、生存メンバー（`alive` かつ戦闘に参加）で等分。端数切り捨て。
- CH-61 レベルアップは宿屋に泊まったときに処理する【仮】（TW-04）。レベルごとの HP 増分 `hpGain` と MP 増分 `mpGain` を `levelHistory[]` に記録する。増分は最大値と現在値の両方に足す。
- CH-62 EXP 減少（TW-22）でレベルダウンが起きる。レベルダウンは `levelHistory` の末尾を取り消す（HP/MP の最大値も戻す。現在値は最大値を超えない範囲に丸める）。覚えた呪文は失わない。EXP が閾値を下回っている間、1 段ずつ繰り返す。レベル 1 の初期値は取り消さない。
- CH-63 `maxLevelReached` を保持する。呪文習得判定（MG-20）は「初めて到達したレベル」でのみ行う。
- CH-64 必要経験値 `expFor(L)`: レベル L にいるのに必要な累計経験値。`expFor(1) = 0`。L ≥ 2 は `floor(config.growth.expBase × config.growth.expGrowth^(L−2) × classes[].expMultiplier)`【仮】。`exp ≥ expFor(level+1)` でレベルアップでき、`exp < expFor(level)` でレベルダウンする。
- CH-65 HP 増分 = `max(config.growth.hpGainMin, 1d(classes[].hpDie) + floor((vit − config.growth.hpVitPivot) / config.growth.hpVitDivisor))`【仮】（職業 HP ダイス + 生命力補正。負も floor。最低は hpGainMin（1））。レベル 1 の hpMax はダイスの最大値 + 生命力補正で、最低 `ceil(hpDie × config.growth.initialHpMinDieRatio)`（0.5）【仮】（`max(ceil(hpDie × initialHpMinDieRatio), hpDie + 生命力補正)`。hpGainMin はレベルアップの増分にだけ使う）。levelHistory には入れない。MP 増分は `classes[].mpPerLevel` + 関連能力値補正【仮】（MG-01）。

## 8. 装備と所持

- CH-70 装備スロットは 6: 武器 `weapon`、防具 `armor`、盾 `shield`、兜 `helm`、小手 `gauntlet`、装飾 `accessory`。
- CH-71 所持枠は 8（装備中を含む）【仮】。`Character.inventory` は装備中の品を含まない。使用枠 = 装備数 + inventory の数。
- CH-72 未鑑定アイテムは `unidentifiedName` で表示され、装備できない。鑑定は司教（無料）か店（有料）。
- CH-73 呪われたアイテムは装備すると外せない。寺院の解呪（TW-07）で外せる。呪いはアイテムの `cursed` で、未鑑定のうちは見えない。
- CH-74 後衛が攻撃できるのは `ranged: true` の武器を装備しているときだけ（CB-13）。
- CH-75 職業ごとの装備制限は `items[].classes`（空なら全職業可）。

## 9. データ

`data/races.json`
```
{ "id": "human", "name": "人間", "baseStats": { "str": 8, "iq": 8, "pie": 5, "vit": 8, "agi": 8, "luk": 9 } }
```

`data/classes.json`
```
{
  "id": "fighter", "name": "戦士",
  "requirements": { "str": 11 },          // 満たすべき最小値。無い能力値は制限なし
  "hpDie": 10, "mpPerLevel": 0,
  "spells": {},                            // { "mage": 1 } なら魔術師系をレベル1から
  "learnMod": 0,                           // 習得率の加算
  "attacksPerLevels": 5, "maxAttacks": 3,  // レベル5ごとに攻撃回数+1、最大3。0なら常に1回
  "abilities": [],                         // "disarm" | "identify"
  "expMultiplier": 1.0
}
```

`Character`（`src/core/types.ts`）に最低限必要なフィールド:
`id, name, raceId, classId, personality (PersonalityId | null), isLeader, stats, level, exp, maxLevelReached, levelHistory[], hp, hpMax, mp, mpMax, san, sanMax, life, status[], knownSpells[], equipment{slot: itemInstanceId}, inventory[itemInstanceId], lastBattleInput`
`equipment` は 6 スロットのキーをすべて持ち、空きは null。アイテムは実体の id（`GameState.items`）で持つ。
