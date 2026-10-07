# イベントと性格の仕様（EV）

## 1. 種別

- EV-01 イベントの種別 `kind`: 選択型 `choice`（リーダーが選択肢を選ぶ）、衝動型 `impulse`（性格で行動者が決まり、勝手に動く）、混合型 `mixed`（衝動判定を先に行い、衝動が無ければ選択型として続く）。
- EV-02 イベント定義は `data/events.json`。発生の契機は、イベントセルを踏む（DG-22）が基本。酒場（TW-14）でも語りと効果だけの簡単なイベントが起きる（`data/tavern.json`。M5.5）。宝箱は events.json の定義を使わず、衝動判定と制止判定の仕組みだけを使う（EV-16 / EV-25。M11）。
- EV-03 誘いタグ `lure`: 宝 `treasure`、未知 `unknown`、危険 `danger`、弱者 `weak`。イベントはタグごとに重み 0〜3 を持つ。性格も同じタグごとに重み 0〜3 を持つ（`personalities[].lure`）。
- EV-04 イベント定義の任意の欄 `impulseClasses`（衝動できる職業の id の一覧。1 件以上、重複なし、classes.json にある id）。省略時は全職業。一覧の外の職業のメンバーは衝動判定（EV-10）の対象外（乱数も引かない）。リーダーは職業に関わらず対象外のまま（M11）。

## 2. 行動者の決定（衝動判定）

- EV-10 対象はリーダーを除く、行動可能（CH-44 の逆）なメンバー。イベントに `impulseClasses` があれば、その職業のメンバーだけ（EV-04。M11）。
- EV-11（M11 で確率型に変更。M10.5 までは `score = 積 + (stat − 10) + 1d6` が閾値 8 以上）各対象メンバーの衝動確率 `p = clamp(config.events.floor, config.events.cap, Σ_tag personality.lure[tag] × event.lure[tag] × config.events.lureMul + (stats[event.stat] − 10))`（%。`lureMul` 12【仮】、`cap` 60【仮】、`floor` 0【仮】）。`stats` は実効の能力値（CH-13）。`event.stat` はイベントが指定する能力値（先に触るなら `agi`、気づくなら `iq`）。誘いの積 Σ_tag personality.lure[tag] × event.lure[tag] が 0 以下の者は衝動判定に乗らない（d100 も振らない。A2、ユーザー決定）。`p` が 0 以下の者も d100 を振らない（`cap` 0 で衝動を止められる）。d100 は対象者を並び順に 1 人 1 回振り、`d100 ≤ p` で成功（M5 の順のまま、1d6 が d100 に変わった）。
- EV-12 成功者のうち「`p` − 出目」が最大の者が行動者。同点は `agi` が高い方、それも同じなら並び順が前の方（M10.5 までの同点の規則のまま）。
- EV-13 成功者がいなければ「衝動なし」。`impulse` なら「何も起きない」の結果、`mixed` なら選択型として続行。
- EV-14 普通 `normal` は `lure` がすべて 0 で、衝動しない（0%）。ただし SAN が「錯乱」（CH-53、25% 未満）のメンバーは、性格に関わらずランダムな 1 タグに重み `config.events.confusedLureWeight`（2）【仮】を持つものとして EV-11 の積を計算する（普通も暴走する）。この重みは性格の `lure` を置き換える（加算しない）。タグはその者の d100 の前に randInt(0, 3) で `LURE_TAGS`（宝・未知・危険・弱者）の順から選び、積が 0 なら d100 は振らない（M5）。`impulseClasses` の外の者は錯乱していてもタグを選ばない（EV-04）。
- EV-15 判定のダイス（衝動の d100）は表示しない。制止判定（EV-20）の 1d10 は表示する【仮】。
- EV-16 宝箱の衝動（M11）: 宝箱を見つけたとき（combat.md の CB-60。ランダム遭遇の勝利の後。警報の戦闘に勝って同じ箱に戻ったとき（CB-67）と開発用の `debug.chest` ではしない）、`config.chest.impulse` を spec にして EV-10〜14 の衝動判定を行う。誘いは宝 2・危険 1【仮】、能力値は `agi`【仮】、`impulseClasses` は `["thief"]`【仮】（EV-04）。錯乱（EV-14）の仮の重みも `impulseClasses` の内側だけ（盗賊でない者は錯乱しても宝箱では衝動しない）。行動者がいれば `chestImpulse{actorId}` → message `chest.impulse.actor`{actor} を出し、制止判定（EV-25）に進む。制止できなければ message `chest.impulse.open`{actor} の後、行動者が「調べずに開ける」（combat.md の CB-65。作動させた人は罠を問わず行動者）。衝動で開けたら（中身・転移・警報のどれでも）職業の掛け合い（EV-71）と `chest.prompt` は無い。

## 3. 制止判定

- EV-20 行動者が決まり、行動者以外に `canStop: true`（慎重）の行動可能なメンバーがいて、イベントが `stopCheck: true` なら制止判定を行う。制止者は該当者のうち `iq` が最も高い者（同値なら並び順が前の者。M5）。
- EV-21 `制止者の iq + 1d10 ≥ 行動者の agi + 1d10` なら制止成功（等しいときも成功）。1d10 は制止者 → 行動者の順に振り、判定の箱（UI-40）を 1 件 2 行（制止者の iq / 行動者の agi、基準は差）で出す（A3。M5）。M7: 制止者の側に、宿の士気の `judgeBonus`（TW-15）と制止者の固有スキル `judgeBonus`（IT-40）を足し合わせて足す（items.md §11 の Q6）。0 でない補正ごとに、制止者の行の直後に内訳の行（士気 → 固有スキルの順。`dice.bonus.morale`{value} / `dice.bonus.skill`{item, value}。base は値、dice は空、total は値）を置き、差は「制止者の合計 + 補正の合計 − 行動者の合計」で比べる（行は最大 4 行）。衝動の点数（EV-11）には足さない（items.md §11 の Q5）。乱数の消費は変えない。
- EV-22 成功: 衝動は不発。制止者と行動者の SAN +`config.events.stopSanGain`（3）【仮】（制止者 → 行動者の順）。`mixed` なら選択型として続行、`impulse` なら「何も起きない」。
- EV-23 失敗: 衝動を実行する。結果が `good` なら行動者に `impulseBonus`（イベント定義。金額増や SAN 回復）を加える。結果が `bad` なら、制止者が生きていれば（life alive）、効果の後に「言わんこっちゃない」（`event.stop.told`）と制止者の SAN +`config.events.stopSanGain`（3。同じ値を使う。M5）。`neutral` はどちらも無い。
- EV-24 制止者がいない場合（`stopCheck` が偽の場合も）はそのまま衝動を実行する（ボーナスや慰めはない）。`impulseBonus` と EV-23 の慰めは、制止者がいて失敗したときだけ（M5）。
- EV-25 宝箱の制止: 宝箱の衝動（EV-16）で行動者が決まったら、宝箱を `stopCheck: true` として EV-20〜21 の制止判定をそのまま行う（制止者の選び方・判定の箱・補正は同じ。語りは `event.stop.roll`{stopper} と、成功 `event.stop.success`{stopper, actor}・失敗 `event.stop.fail`{stopper}）。成功: 衝動は不発。制止者 → 行動者の順に SAN +`config.events.stopSanGain`（EV-22）。箱は残り、職業の掛け合い（EV-71）を経て開封の選択へ。失敗（制止者がいない場合も）: 行動者が開ける（EV-16）。開けて罠が作動し、制止者がいて生きていて（life alive）、戦闘に入っておらず（警報でない）全滅処理にも入っていなければ、開封の後（`chestEnd` の後、転移なら `moved` の後）に `event.stop.told`{stopper} と制止者の SAN +`stopSanGain`（EV-23 の bad と同じ扱い）。罠なしの箱を開けたら good として扱い、何も足さない（宝箱に `impulseBonus` は無い）。

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
- EV-42 慎重の `trapDetect` は DG-21 と CB-63 / CB-64（M11。宝箱の調べる・解除の成功率に足す。以前は CB-52）、`ambushAvoid` は CB-04、無鉄砲の `initiative` と `damage` は CB-11 と CB-22、強欲の `chestQuality` は CB-52（M7 で宝箱の品の希少度を上げる段数として効かせる。IT-31。行動可能な者の最大）、`hiddenTreasure` は【未定】（隠し財宝セルは未設計）。M7 のオプション `trapDetect`（IT-34）は性格の `trapDetect` に足す。
- EV-43 仲間の死亡による SAN 減少（CH-51）は「仲間の負傷」の耐性の対象に含める。

## 6. プロトタイプのイベント

- EV-50 光る石板 `glowing_tablet`（未知 3、`stat: iq`、`mixed`、制止あり）。衝動: 触れる → 良: この階のマップが明かされる / 中立: 小銭 / 悪: 全員に SAN −5 と行動者に `1d6` ダメージ。選択: 「調べる（安全、何も起きない）」「無視する」。
- EV-51 打ち捨てられた宝袋 `abandoned_sack`（宝 3、危険 1、`stat: agi`、`mixed`、制止あり）。衝動: 掴む → 良: `5d10` 金（`requires: impulse`） / 悪: 罠、行動者に `2d6` ダメージ。選択: 「慎重に探る（`2d10` 金）」「放っておく」。
- EV-52 傷ついた冒険者 `wounded_adventurer`（弱者 2、`stat: pie`、`mixed`、制止なし）。衝動: 手当てする → 薬草を 1 つ消費して情報（この階の下り階段の位置を明かす。最下層ではボスのセル。EV-32 / B9）。選択: 「薬草を渡す（同上。差し出す語りの後、薬草があれば消費して good を語り、同じく明かす。M5、オーケストレーターの決定）」「見捨てる（全員 SAN −2）」。任意実装。
- EV-53 沈んだ献金箱 `sunken_offering_box`（宝 3、危険 1、`stat: agi`、`mixed`、制止あり。M9、d02）。衝動: 箱の隙間を探る → 良: 金（`requires: impulse`。制止の失敗で `impulseBonus` の金） / 中立: 小銭 / 悪: 行動者にダメージと SAN 減少。選択: 「錠を壊して開ける（少しの金）」「放っておく」。
- EV-54 囁く洗礼盤 `murmuring_font`（未知 3、危険 1、`stat: iq`、`mixed`、制止あり。M9、d02）。衝動: 水面を覗く → 良: この階の下り階段の位置を明かし（`revealStairs`）行動者の SAN が減る（`requires: impulse`。`impulseBonus` で SAN 回復） / 中立: 行動者の SAN 減少 / 悪: 全員の SAN 減少。選択: 「祈りを捧げる（全員の SAN が少し戻る）」「立ち去る」。
- EV-55 瓦礫の下の巡礼者 `pinned_pilgrim`（弱者 3、`stat: str`、`mixed`、制止なし。M9、d02）。衝動: 瓦礫をどける → 良: 礼の金と行動者の SAN 回復（`requires: impulse`） / 悪: 行動者にダメージ。選択: 「皆で瓦礫をどける（全員に小さなダメージと少しの金）」「見捨てる（全員 SAN 減少）」。
- 各イベントの数値（重み・ダイス・SAN の値）は `data/events.json` が正で、暫定の値は decisions に記録する（M9）。

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

## 9. 職業の掛け合い（M11）

- EV-70 職業の掛け合いは、同じ職業のメンバーが 2 人以上いるときに起きる寸劇。定義は `data/rivalries.json`（空の配列は可）。契機 `trigger` は今は宝箱 `chest` だけ。
- EV-71 発生: 宝箱を見つけ（combat.md §6b）、衝動（EV-16）と制止（EV-25）を終えて箱が残り、戦闘中でないときに判定する（衝動で開けた・転移で失った・警報の戦闘に入ったときは判定しない）。警報の戦闘に勝って同じ箱に戻ったとき（CB-67）と開発用の `debug.chest` では判定しない。対象は `classId` の職業で行動可能なメンバー（リーダーを含む。性格は問わない）。2 人以上いれば d100 ≤ `chance` で発生。`trigger` が `chest` の定義が複数あれば、データの順に判定して最初に発生した 1 つだけ。
- EV-72 競り合い: 対象者ごとに並び順で `contest.stats` の能力値（実効の値。CH-13）の合計 + `contest.dice` を振り、最大の者が担当（同点は並び順が前の者）。勝者以外は全員が負け。`contest.stats` は 1 個以上で重複しない（検証で止める）。
- EV-73 語りと判定の箱: 文言は `text.start`（差し込み `{a}` `{b}`）・`text.win`（`{winner}` `{loser}`）・`text.fail`（`{name}`）の strings キー。ほかの差し込みは検証で止める。順は message `text.start`{a, b}（対象者の先頭の 2 人）→ 判定の箱 → message `text.win`{winner, loser}（loser は負けた者の先頭。文言は 2 人を前提に書く）→ 負けの SAN（EV-74）。判定の箱は `dice{label: dice.rivalry, rows, rule: dice.rivalry.rule, result: dice.rivalry.win{winner}}` で、行は対象者ごとに 1 行（並び順。label `dice.rivalry.member`{name と contest.stats の各能力値}、base は能力値の合計、dice は contest.dice の出目、total は合計）。担当は箱に `rivalry{id, ownerId}` として残す（箱が片付けば消える。放っておいた宝箱のセルを踏み直すと新しい箱として EV-71 からやり直す）。
- EV-74 負けた者それぞれに SAN −`loserSan`（耐性なし。並び順）。
- EV-75 担当者がその箱を調べる（CB-63）ときだけ、成功率に `bonus.inspect` を足す（clamp の前）。判定の箱には `chest.row.rivalry`{v} の行を罠の勘の行の後に置き、危険度を引く前の値（`chest.row.subtotal`）に含める。ほかのメンバーの調べると解除（CB-64）には効かない。
- EV-76 担当者が調べるに失敗するたびに、その調べるの語りと効果（偽りの名前・不明・作動）の後に `text.fail`{name} を語り、担当者の SAN −`failSan`（耐性なし。乱数なし）。担当者が生きていない（作動で死んだ）とき、作動が警報で戦闘に入った（または全滅処理に入った）ときは出さない。成功では出さない。
- 乱数の順（`state.rng`）: 宝箱の衝動と制止（EV-16 / EV-25）の乱数の後に（衝動で開けたときは判定しない）、[対象が 2 人以上なら d100（chance）] →[発生すれば対象者ごとに並び順で contest.dice]。対象が 1 人以下なら何も引かない。

`data/rivalries.json`
```
{
  "id": "thief_chest", "trigger": "chest", "classId": "thief",
  "chance": 50,
  "contest": { "stats": ["agi", "luk"], "dice": "1d6" },
  "bonus": { "inspect": 10 },
  "loserSan": 1, "failSan": 3,
  "text": { "start": "rivalry.thief_chest.start", "win": "rivalry.thief_chest.win", "fail": "rivalry.thief_chest.fail" }
}
```
