# イベントと性格の仕様（EV）

## 1. 種別

- EV-01 イベントの種別 `kind`: 選択型 `choice`（リーダーが選択肢を選ぶ）、衝動型 `impulse`（性格で行動者が決まり、勝手に動く）、混合型 `mixed`（衝動判定を先に行い、衝動が無ければ選択型として続く）。
- EV-02 イベント定義は `data/events.json`。発生の契機は、イベントセルを踏む（DG-22）が基本。酒場（TW-14）でも語りと効果だけの簡単なイベントが起きる（`data/tavern.json`。M5.5）。将来は戦闘後・宝箱でも使う。
- EV-03 誘いタグ `lure`: 宝 `treasure`、未知 `unknown`、危険 `danger`、弱者 `weak`。イベントはタグごとに重み 0〜3 を持つ。性格も同じタグごとに重み 0〜3 を持つ（`personalities[].lure`）。

## 2. 行動者の決定（衝動判定）

- EV-10 対象はリーダーを除く、行動可能（CH-44 の逆）なメンバー。
- EV-11 各メンバーの `score = Σ_tag personality.lure[tag] × event.lure[tag] + (stats[event.stat] − 10) + 1d6`。`event.stat` はイベントが指定する能力値（先に触るなら `agi`、気づくなら `iq`）。誘いの積 Σ_tag personality.lure[tag] × event.lure[tag] が 0 の者は衝動判定に乗らない（1d6 も振らない。A2、ユーザー決定）。1d6 は対象者を並び順に 1 人 1 回振る（M5）。
- EV-12 `score ≥ config.events.impulseThreshold`（8）【仮】のメンバーのうち最大の者が行動者。同点は `agi` が高い方、それも同じなら並び順が前の方。
- EV-13 誰も閾値に達しなければ「衝動なし」。`impulse` なら「何も起きない」の結果、`mixed` なら選択型として続行。
- EV-14 普通 `normal` は `lure` がすべて 0 で、衝動しない。ただし SAN が「錯乱」（CH-53、25% 未満）のメンバーは、性格に関わらずランダムな 1 タグに重み `config.events.confusedLureWeight`（2）【仮】を持つものとして計算する（普通も暴走する）。この重みは性格の `lure` を置き換える（加算しない）。タグはその者の 1d6 の前に randInt(0, 3) で `LURE_TAGS`（宝・未知・危険・弱者）の順から選び、積が 0 なら 1d6 は振らない（M5）。
- EV-15 判定のダイス（1d6）は表示しない。制止判定（EV-20）の 1d10 は表示する【仮】。

## 3. 制止判定

- EV-20 行動者が決まり、行動者以外に `canStop: true`（慎重）の行動可能なメンバーがいて、イベントが `stopCheck: true` なら制止判定を行う。制止者は該当者のうち `iq` が最も高い者（同値なら並び順が前の者。M5）。
- EV-21 `制止者の iq + 1d10 ≥ 行動者の agi + 1d10` なら制止成功（等しいときも成功）。1d10 は制止者 → 行動者の順に振り、判定の箱（UI-40）を 1 件 2 行（制止者の iq / 行動者の agi、基準は差）で出す（A3。M5）。M7: 制止者の側に、宿の士気の `judgeBonus`（TW-15）と制止者の固有スキル `judgeBonus`（IT-40）を足し合わせて足す（items.md §11 の Q6）。0 でない補正ごとに、制止者の行の直後に内訳の行（士気 → 固有スキルの順。`dice.bonus.morale`{value} / `dice.bonus.skill`{item, value}。base は値、dice は空、total は値）を置き、差は「制止者の合計 + 補正の合計 − 行動者の合計」で比べる（行は最大 4 行）。衝動の点数（EV-11）には足さない（items.md §11 の Q5）。乱数の消費は変えない。
- EV-22 成功: 衝動は不発。制止者と行動者の SAN +`config.events.stopSanGain`（3）【仮】（制止者 → 行動者の順）。`mixed` なら選択型として続行、`impulse` なら「何も起きない」。
- EV-23 失敗: 衝動を実行する。結果が `good` なら行動者に `impulseBonus`（イベント定義。金額増や SAN 回復）を加える。結果が `bad` なら、制止者が生きていれば（life alive）、効果の後に「言わんこっちゃない」（`event.stop.told`）と制止者の SAN +`config.events.stopSanGain`（3。同じ値を使う。M5）。`neutral` はどちらも無い。
- EV-24 制止者がいない場合（`stopCheck` が偽の場合も）はそのまま衝動を実行する（ボーナスや慰めはない）。`impulseBonus` と EV-23 の慰めは、制止者がいて失敗したときだけ（M5）。

## 4. 結果

- EV-30 衝動の結果は `impulseOutcomes[]` から重み付きで 1 つ引く。M7: 宿の士気（TW-15）があれば、quality が `good` の各結果の重みに `goodWeight` を足してから引く（weightedIndex の 1 回は変わらない）。各結果は `quality`（`good` / `bad` / `neutral`）と効果の列 `effects[]` を持つ。
- EV-31 選択型の選択肢は `choices[]`。各選択肢は効果の列と、表示のラベルの strings キー `labelKey`（規約 `event.<eventId>.choice.<choiceId>`。`label` はデータの説明として残し、表示には使わない。A9、M5）を持つ。選択肢の語り `text` を出してから効果を適用する。`requires: "impulse"` の結果は衝動でしか出ない（「良い結果は衝動でしか取れない」分岐。EV-41 の方針）。衝動の結果は常に衝動から出るので、処理では見ない印として扱う（M5）。
- EV-32 効果の種類 `effects[].type`【仮】: `gold`（`dice`）、`item`（`itemId` または `table`）、`damage`（`dice`、対象 `actor` / `party`）、`san`（`value`、対象 `actor` / `party` / `others`）、`revealFloor`（この階のマップを全て探索済みにする）、`revealStairs`（この階の下り階段だけを探索済みにする）、`consumeItem`（`itemId`、対象 `actor` / `party`。`optional: true` なら持っていなくても続行、無ければ以降の効果は起きない）、`encounter`（`monster`, `count`）、`status`（`status`, 対象）、`message`（`key`）、`nothing`。`applyEffects` は迷宮の階が無い場面（酒場。TW-14）でも使い、そのとき `revealFloor` / `revealStairs` は使えない（データの検証で止める。M5.5）。
  - プロトタイプ（M5）で実装するのは `gold` / `damage` / `san` / `revealFloor` / `revealStairs` / `consumeItem` / `message` / `nothing`。`item` / `encounter` / `status` はデータにあれば読み込み時の検証で起動を止める。
  - 対象（効果ごとに、その時点で解決）: `actor` は行動者（生きていなければ対象なし）、`party` は生存者（life alive）全員、`others` は生存者から行動者を除いた者。選択肢の効果の行動者はリーダー。
  - `gold`: 出目の合計（0 未満は 0）が正なら所持金と潜行台帳（DG-40）に足し、`event.gold`{gold}（強欲の財宝入手 CH-52）。0 なら何も出さない。`damage`: 対象を並び順に 1 回ずつ振り、落とし穴と同じ順（CH-45）。`san`: 符号付きの値、耐性なし（CH-54）。`revealFloor` / `revealStairs` は GameEvent を出さない（語りは結果の text）。`revealStairs` は下り階段が無い階（最下層）ではボスのセルを明かす（B9）。
  - `consumeItem`: 対象の持ち物（`party` なら生存者の並び順）から最初の実体（鑑定を問わない）を消し（潜行台帳からも外れる）、`event.consume`{name, item}。見つからなければ、`optional` なら語らずに続け、そうでなければ `event.noItem`{item} を出して以降の効果を飛ばす。
- EV-33 イベントの処理中は `screen: event`。結果の適用後、セルは通常セルになる（DG-22）。M5 の読み: `screen: event` を立てるのは選択を待つ間（保留中の選択 kind `event`、問いは `text.intro`）だけで、両者は同値。衝動だけで決着する場合は立てない（迷宮の screen のまま。A4）。選択を待つ間も全滅の判定（TW-20）は行い、全滅なら選択を下ろして街へ。イベントの再生は `eventStarted`{eventId, actorId?}（行動者が決まっていれば actorId）→ `text.intro` の順に始まる。
- EV-34 GM の語りはイベント定義の `text` キーで `strings.json` から引く。`{actor}` `{stopper}` を差し込む。問い（`text.intro`）・選択肢の `labelKey` と `text` は差し込みを持たず（保留中の選択の問いとして params なしで出し直すため。E3）、`text.impulse` と衝動の結果の `text` は `{actor}` だけを差し込む（読み込み時に検証する。M5）。

## 5. 性格の恩恵と SAN 耐性

- EV-40 恩恵と耐性は `data/personalities.json` を正とする。既定【仮】:

| 性格 | 誘い（宝/未知/危険/弱者） | 恩恵 | SAN 耐性 | オート戦闘 |
|---|---|---|---|---|
| 慎重 cautious | 0/0/0/1 | `trapDetect` +30%、`ambushAvoid` +20%、制止可 | 罠と仲間の負傷による減少 ×0.5 | HP 50% 未満で防御 |
| 無鉄砲 reckless | 0/3/2/0 | `initiative` +2、`damage` +1 | `fear` タグの減少 ×0.5 | HP に関わらず攻撃 |
| 強欲 greedy | 3/1/0/0 | `chestQuality` +1、`hiddenTreasure` +15% | 財宝入手で +2 | 金の多いグループを狙う |
| 普通 normal | 0/0/0/0 | なし | なし。SAN 50% 未満で指示無視 10% | 傾向なし |

- EV-41 「普通」が最強にならないことを守る原則: 普通には恩恵も耐性も付けない。イベントには「衝動でしか良い結果が出ない」分岐を一定数入れる。普通は追い詰められる（SAN 低下）と真っ先に崩れる。
- EV-42 慎重の `trapDetect` は DG-21 と CB-52、`ambushAvoid` は CB-04、無鉄砲の `initiative` と `damage` は CB-11 と CB-22、強欲の `chestQuality` は CB-52（M7 で宝箱の品の希少度を上げる段数として効かせる。IT-31。行動可能な者の最大）、`hiddenTreasure` は【未定】（隠し財宝セルは未設計）。M7 のオプション `trapDetect`（IT-34）は性格の `trapDetect` に足す。
- EV-43 仲間の死亡による SAN 減少（CH-51）は「仲間の負傷」の耐性の対象に含める。

## 6. プロトタイプのイベント

- EV-50 光る石板 `glowing_tablet`（未知 3、`stat: iq`、`mixed`、制止あり）。衝動: 触れる → 良: この階のマップが明かされる / 中立: 小銭 / 悪: 全員に SAN −5 と行動者に `1d6` ダメージ。選択: 「調べる（安全、何も起きない）」「無視する」。
- EV-51 打ち捨てられた宝袋 `abandoned_sack`（宝 3、危険 1、`stat: agi`、`mixed`、制止あり）。衝動: 掴む → 良: `5d10` 金（`requires: impulse`） / 悪: 罠、行動者に `2d6` ダメージ。選択: 「慎重に探る（`2d10` 金）」「放っておく」。
- EV-52 傷ついた冒険者 `wounded_adventurer`（弱者 2、`stat: pie`、`mixed`、制止なし）。衝動: 手当てする → 薬草を 1 つ消費して情報（この階の下り階段の位置を明かす。最下層ではボスのセル。EV-32 / B9）。選択: 「薬草を渡す（同上。差し出す語りの後、薬草があれば消費して good を語り、同じく明かす。M5、オーケストレーターの決定）」「見捨てる（全員 SAN −2）」。任意実装。

## 7. 客将【未定】

- EV-60 将来、酒場に一時的に同行する NPC（客将）を置く可能性がある。1 回の潜行だけ同行し、街に戻ると去る。プロトタイプでは実装しない。設計するときは CH-04 と TW-33 を更新する。

## 8. データ

`data/personalities.json`
```
{
  "id": "cautious", "name": "慎重",
  "lure": { "treasure": 0, "unknown": 0, "danger": 0, "weak": 1 },
  "canStop": true,
  "benefits": { "trapDetect": 30, "ambushAvoid": 20, "initiative": 0, "damage": 0, "chestQuality": 0, "hiddenTreasure": 0 },
  "san": { "trapLossMul": 0.5, "allyInjuryLossMul": 0.5, "fearLossMul": 1.0, "treasureGain": 0, "disobeyBelowHalf": 0 },
  "autoBattle": "defendBelowHalf"
}
```
`autoBattle`: `"none"` / `"defendBelowHalf"` / `"alwaysAttack"` / `"targetRichest"`。

`data/events.json` は EV-50〜52 を例として構造を示す。フィールドの追加は許すが、既存のフィールドの意味は変えない。
