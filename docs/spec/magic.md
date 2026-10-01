# 呪文仕様（MG）

## 1. MP

- MG-01 MP 制。各キャラクターは単一の MP プール（`mp` / `mpMax`）を持つ。レベルごとの増分は `classes[].mpPerLevel + max(0, floor((関連能力値 − config.growth.mpStatPivot) / config.growth.mpStatDivisor))`【仮】（既定 10 と 2）。関連能力値は魔術師系なら知恵、僧侶系なら信仰心、両方持つ職業は高い方、系統を持たない職業は補正 0。開始レベルに関係なく増える。レベル 1 の `mpMax` はこの増分 1 回分。
- MG-02 MP は宿屋で全回復（TW-04）。迷宮内では回復手段を用意しない【仮】。【衝突】`config.town.innRanks` の `mpRatio`（0.25 / 0.5 / 1.0）と食い違う。実装は TW-04 とデータどおり `mpRatio` に従う（decisions の「衝突 MG-02」。ユーザーの判断待ち）。
- MG-03 全滅時の復活で MP は回復しない（TW-23）。

## 2. 系統とレベル

- MG-10 系統は魔術師系 `mage` と僧侶系 `priest` の 2 つ。各系統に呪文レベル 1〜7 がある。
- MG-11 職業が使える系統と開始レベルは `classes[].spells`【仮】: 魔術師 `{mage:1}`、僧侶 `{priest:1}`、司教 `{mage:1, priest:1}`（`learnMod: -10`）、侍 `{mage:4}`、君主 `{priest:4}`。開始レベルはキャラクターレベルで、それ未満では習得判定を行わない。
- MG-12 各呪文は `learnLevel`（習得基準となるキャラクターレベル）を持つ。呪文レベル n の標準 `learnLevel` は `2n − 1`【仮】（1, 3, 5, 7, 9, 11, 13）。データで個別に上書きできる。
- MG-13 呪文レベルは「習得の目安」と「コスト段階」のためにある。使用回数の制限には使わない。

## 3. 習得判定

- MG-20 判定の契機は「キャラクターがレベル L に初めて到達したとき」（CH-63）。対象は、系統が使えて開始レベル以上、`learnLevel ≤ L`、未習得、`bookOnly` でない呪文すべて。
- MG-21 呪文ごとに d100（1〜100）を振る。`roll ≤ 成功率` で習得（成功率が 0 以下なら必ず失敗、100 以上なら必ず成功。どちらの場合もダイスは振る）。判定は `data/spells.json` の並び順で行う。
- MG-22 成功率 = `config.learning.base + config.learning.perLevelDiff × (L − learnLevel) + statMod + classes[].learnMod`。上限 100。`L − learnLevel ≥ config.learning.guaranteeDiff` なら無条件で 100。`statMod = (関連能力値 − config.learning.statPivot) × config.learning.statPerPoint`。既定は base 35、perLevelDiff 20、guaranteeDiff 4、statPivot 10、statPerPoint 3【仮】。`statMod` の関連能力値は呪文の系統で決める（魔術師系は知恵、僧侶系は信仰心。両系統を持つ職業も呪文ごとに決まる）。下限は設けない。
- MG-23 保証: 帯は (系統, 呪文レベル `level`) の組。帯の解放レベル = max(そのキャラクターの職業のその系統の開始レベル `classes[].spells[系統]`, 帯に属する `bookOnly` でない呪文の `learnLevel` の最小値)。帯に `bookOnly` でない呪文が 1 つも無ければ、その帯は保証の対象にならない。レベル L に初めて到達したときの判定（MG-20〜22）の後、解放レベルが L に等しい帯ごとに、その帯の今回の判定対象（MG-20 の対象のうちその帯のもの）から 1 つも習得しなかったなら、その帯の今回の判定対象から等確率で 1 つを習得する。その帯の今回の判定対象が空なら保証は無い。保証する帯の順は、判定対象（`data/spells.json` の並び順）に帯が初めて現れた順。乱数は、判定の d100 をすべて振ってから、保証の抽選を帯の順に引く。保証による習得ではダイスを表示しない。MG-22 の成功率は呪文の `learnLevel` 基準のまま変わらない。
- MG-24 判定のダイスは画面に表示する（`dice` イベント、UI-40）。1 呪文につき 1 回。
- MG-25 `bookOnly: true` の呪文は魔法書アイテム（`items[].effect.type === "learn"`）を使って習得する。魔法書は消費される。職業がその系統を使えない（`classes[].spells` にその系統が無い。開始レベルは問わない）場合は使えない（アイテムは消費されない）。すでに知っている場合も使えない。迷宮の非戦闘時に `dungeon.useItem` で使い、習得の語りは `town.inn.learned` を使い回す。
- MG-26 レベルダウンで呪文を失うことはない（CH-62）。

## 4. コストと役割

- MG-30 呪文の MP コストは `spells[].mp`。高レベルほど高く、範囲が広い。戦闘では MP は行動の時点で消費する。入力時（`battle.input`）は mp ≥ cost の検査だけ行う。
- MG-31 設計原則: 低レベルの単体呪文は、単体相手なら上位の範囲呪文より確実に MP 効率が良い。上位呪文は「複数相手」「状態異常付き」「フィールド用途」で差別化する。同レベルの呪文は役割（攻撃 / 状態異常 / 回復 / 補助）が重ならないようにする。
- MG-32 `usableIn`: `battle` / `field` / `both`。フィールド呪文は迷宮内の非戦闘時に `dungeon.cast` で使う。`dungeon.cast` は M4 では未実装【未定】。

## 5. 特定呪文

- MG-40 帰還 `return`（僧侶系 Lv3【仮】、field）: 迷宮からその場で街へ。帰還の糸（DG-30）と同じ効果。潜行台帳の内容は持ち帰る。`dungeon.cast` は M4 では未実装【未定】。
- MG-41 識別 `identify`（僧侶系 Lv3【仮】、battle）: 戦闘中の全敵グループを鑑定済みにする（CB-05）。
- MG-42 蘇生 `resurrect`（僧侶系 Lv5【仮】、field）: 対象 `dead` → `alive`（HP 1）。成功率は寺院と同式（TW-07）。失敗すると `ash`。`dungeon.cast` は M4 では未実装【未定】。
- MG-43 睡眠 `sleep_mist`（魔術師系 Lv1【仮】、battle）: 対象グループに睡眠を付与。付与判定は CB-30。

## 6. データ

`data/spells.json`
```
{
  "id": "fire_arrow", "name": "火矢", "school": "mage", "level": 1, "learnLevel": 1,
  "mp": 2, "target": "enemy", "usableIn": "battle",
  "effect": { "type": "damage", "dice": "1d8" },
  "bookOnly": false,
  "description": "一体に火の矢を放つ。"
}
```

- `target`: `enemy`（敵 1 体）/ `enemyGroup` / `allEnemies` / `ally` / `party` / `self` / `none`
- `effect.type`: `damage` / `heal` / `status`（`status`, `chance`）/ `acBonus`（`value`, 戦闘中のみ）/ `cureStatus`（`status`）/ `identify` / `return` / `resurrect` / `sanHeal`（`value`）
- `tags`: 省略可。`fear` など、耐性の参照用。
