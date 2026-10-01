# 戦闘仕様（CB）

## 1. 遭遇

- CB-01 ランダム遭遇は歩行 1 歩ごとに判定する（旋回では判定しない）。確率は `dungeons[].encounterRate` のセル種別（`room` / `corridor`）ごとの値。`room` / `corridor` はセルが部屋の中か否か（セルの `roomId`）で決まる。判定は d100 ≤ round(rate×100) で、前進が成立した 1 歩につき 1 回。
- CB-02 固定遭遇: ボス部屋（DG-31）、イベント由来（EV）。固定遭遇は逃走できない【仮】。
- CB-03 敵編成は最大 `config.combat.maxEnemyGroups`（4）グループ。各グループは同種の敵 1〜`config.combat.maxPerGroup`（9）体で、体数は `monsters[].groupSize` のダイス。グループ数は `dungeons[].groupCountWeights[階]` の重みづけの抽選で決める（要素 i がグループ数 i+1。重みは【仮】）。ランダム遭遇で出る敵の種類は、いる階の `dungeons[].encounterTable[階]` から `weight` の重みで選ぶ。どの敵がどのダンジョンのどの階に出るかは `dungeons[].encounterTable` のみを正とし、`monsters.json` は出現場所を持たない。
- CB-04 先手判定: 各側の合計 = floor(`agi` 平均) + 1d10（味方 → 敵の順に振る）、差 = 味方の合計 − 敵の合計。差 ≥ `surpriseDiff`（5【仮】）なら味方の奇襲、差 ≤ −(`surpriseDiff` + `ambushAvoid`) なら敵の奇襲で、奇襲側だけが 1 ラウンド行動する。慎重の恩恵 `ambushAvoid`（EV-42。M5 までは 0）は敵の奇襲の閾値だけを広げる。平均は行動可能な味方と生存個体の `agi` で取り、表示している整数の合計どうしで比べる（M4.5。表示と判定を一致させる）。dice は 1 件で、行は 味方 / 敵（base = floor(平均)、total = base + 出目）、基準は `dice.initiative.rule`（params diff / need / ambush）、結果は `dice.initiative.party` / `enemy` / `none`。敵の奇襲ラウンドは遭遇の直後（同じ処理の中）に解決する。味方の奇襲は次のラウンドで敵が行動しない。ただし逃走に失敗したラウンドでは敵が行動する。ボス戦でも判定する。
- CB-05 未鑑定: 遭遇時、各グループは `monsters[].unidentifiedName` で表示される。鑑定済みになる契機: 識別呪文（MG-41）、各ラウンド終了時に `config.combat.identifyChancePerRound`（15）% + 味方の知恵最大値補正【仮】、同種を通算 `config.combat.identifyKills`（5）体倒した図鑑フラグ【仮】。図鑑フラグはゲーム単位で永続。知恵補正 = max(0, 行動可能な味方の `iq` 最大 − 10) × `config.combat.identifyIqPerPoint`（1）【仮】。図鑑は `GameState.bestiary`（monsterId → {kills, identified}）。通算撃破数による鑑定は撃破の瞬間に行う（勝利したラウンドでも残る。逃げた戦闘の撃破も数える）。ラウンド終了の判定は、生存個体のある未鑑定のグループを添字順に 1 回ずつ行う（同じ種類が先に鑑定されれば以降は判定しない）。
- CB-06 未鑑定グループとの遭遇で SAN −2/グループ（CH-51）。鑑定済み（図鑑フラグあり）の敵では減らない。

## 2. ラウンド

- CB-10 ラウンド = 入力フェーズ → 解決フェーズ。入力は行動可能な味方全員分（オート ON のメンバーは自動入力）。全員分が揃ったら `battle.resolve`。
- CB-11 解決順は各行動者の `initiative = agi + 1d10 + 性格恩恵` の降順。敵は `monsters[].agi`。同値は味方優先。敵は、ラウンド開始時に行動可能な生存個体（麻痺・睡眠・石化を除く）ごとに 1 行動者（initiative = `monsters[].agi` + 1d10）。行動不能な個体は initiative を振らず、そのラウンドの途中で覚めても行動しない（味方の入力対象が行動可能者だけなのと対称）。同値の順は味方 → 敵、味方同士は並び順、敵同士はグループ → 個体の添字順。
- CB-12 コマンド: ラウンドの入力フェーズは、パーティの選択とメンバーごとの行動に分かれる（表示は UI-54）。
  - パーティの選択は「戦う / 前回と同じ / 逃げる / オート」の 4 つ。
  - 「戦う」を選ぶと、行動可能なメンバーごとに行動を入力する（`battle.input`）。行動は次の 4 つ。
    - 攻撃 `attack`（対象グループ）
    - 呪文 `cast`（呪文と対象）
    - 防御 `defend`（そのラウンドは被ダメージ半減）
    - 道具 `item`
  - 「前回と同じ」は `battle.repeat`。行動可能な全員の入力を CB-40〜42 のオート入力の規則で作り、そのラウンドを 1 回だけ解決する。オートは ON にしないので CB-43 は効かない。`lastBattleInput` は変えない。
  - 「逃げる」は `battle.flee`。パーティの行動として、入力済みの行動を捨て、すぐに CB-50 の逃走判定をする。
  - オートの ON/OFF は `battle.auto` で入力フェーズ中に切り替える。
  - `battle.flee` と `battle.repeat` は、オートが OFF の入力フェーズでだけ受け付ける。
  - 入力は、同じメンバーへの再入力で上書きできる。
  - 防御（CB-13 の後衛の攻撃と CB-41 の MP 不足の置き換えを含む）はラウンド開始時に決まり、そのラウンド全体に効く。
- CB-13 前衛（並び 1〜3）は近接攻撃可。後衛（4〜6）は装備武器が `ranged: true` のときだけ攻撃可。`ranged` でない武器（または素手）で「攻撃」を選んだ後衛は、防御として解決する。呪文と道具は位置に関係なく使える。
- CB-14 前衛 3 人全員が行動不能（CH-44）のとき、後衛を前衛として扱う。近接攻撃可、敵の通常攻撃の対象になる。前衛が 1 人でも回復すれば元に戻る。
- CB-15 敵の通常攻撃の対象は前衛（CB-14 適用後）の生存者（life が dead / ash の者と石化の者を除く。睡眠・麻痺の者は対象に含む）からランダム。行動可能かどうかは問わない。全体攻撃（ブレス等）は全員。敵の攻撃は `attacks[]` の要素ごとに対象を選び直す。敵が対象を選べない（候補が空）ときは何もしない。
- CB-16 行動しようとした時点で行動不能なら、その行動は飛ばす。対象が消えていたら CB-42 の規則で振り替える。

## 3. 命中とダメージ

- CB-20 AC は基礎 10。装備の `ac` を合計して下げる（低いほど良い）。呪文 `acBonus` は戦闘中だけ加算。下限 −10【仮】。
- CB-21 命中率% = `clamp(hitBase + hitPerLevel × 攻撃側レベル + hitPerAC × 対象AC, hitMin, hitMax)`。`config.combat` の既定は hitBase 20、hitPerLevel 5、hitPerAC 4、hitMin 5、hitMax 95【仮】。敵のレベルは `monsters[].level`。1〜100 を振り、出目 ≤ 命中率で命中。睡眠中の対象への +`sleepHitBonus`（CB-32）は clamp の内側に足す。呪文には命中判定が無い。範囲の damage / status は個体ごとに振る。状態付与の呪文は、グループで 1 体以上に付けば `battle.status.<s>`、1 体も付かなければ `battle.noEffect` を出す。戦闘で使える呪文・道具は、damage / status は敵側、heal / acBonus / cureStatus は味方側、identify は任意の対象の組み合わせだけ。
- CB-22 味方の攻撃ダメージ = 武器ダイス（素手 `1d2`）+ 力補正（`(str − 10) / 2` 切り捨て）+ 性格恩恵 `damage`。最低 1。防御中の対象には半減（切り上げ）。敵が防御中の味方に与えるダメージも max(1, 出目) を半減し、切り上げる。
- CB-23 攻撃回数: `classes[].attacksPerLevels` ごとに +1、`maxAttacks` まで【仮】。各回ごとに命中判定。式は `attacksPerLevels` が 0 なら 1、それ以外は `min(maxAttacks, 1 + floor(level / attacksPerLevels))`。複数回の攻撃は毎回グループの先頭の生存個体に当て直し、グループが全滅したら残りは打ち切る（他のグループへは移らない）。
- CB-24 敵の攻撃は `monsters[].attacks[]` の各要素につき 1 回。各攻撃は `dice` のダメージと、任意で `status`（`chance`）と `sanDrain`（`tags` 付き）を持つ。
- CB-25 敵グループ内の各個体は個別の HP を持つ。単体対象の攻撃はグループ内の先頭の生存個体に当たる（Wizardry 準拠、対象個体は選べない）。

## 4. 状態異常と SAN 攻撃

- CB-30 状態異常の付与判定: 1〜100 を振り、出目 ≤ `chance − (対象の luk − 10) × config.combat.statusLukPerPoint`（2）【仮】で付与。敵は luk を持たないので 10 とみなす。`monsters[].resist` にある状態は付与されない（判定しない）。すでに同じ状態なら何もしない。
- CB-31 レベルドレインは存在しない。代わりに `sanDrain: n` を持つ攻撃が命中すると、対象の SAN を n 減らす。攻撃の `tags` に `fear` があれば無鉄砲の耐性（EV-40）で半減（切り捨て）。SAN が 0 になったメンバーは行動不能（CH-53）。
- CB-32 睡眠中の対象は被弾のたびに 50%【仮】で覚醒する。睡眠中は命中率 +30【仮】。また、決着しなかったラウンドの終了時に、眠っている者（敵味方とも。味方は life が alive、敵は生存個体）は `config.combat.sleepNaturalWake`（20）%【仮】で自然に覚める。判定は並び順の味方 → グループ → 個体の添字順に 1 人 1 回で、覚めたら `statusChanged`（sleep off）と message `battle.wake` を出す。
- CB-33 毒は各ラウンド終了時に HP −1（CH-43）。

## 5. オート戦闘

- CB-40 オートは各メンバーの `lastBattleInput`（前回の入力）を繰り返す。`lastBattleInput` が無いメンバーは攻撃（後衛で `ranged` 武器がなければ防御）。
  `lastBattleInput` を更新するのは `battle.input` の手入力だけ。オートと `battle.repeat`（前回と同じ。CB-12）で作った入力では変わらない。`battle.repeat` もこの節の規則（CB-40〜42。MP 不足の置き換えは CB-41）で入力を作る。
- CB-41 呪文で MP 不足なら、前衛は攻撃、後衛（`ranged` 無し）は防御に置き換える。
- CB-42 対象グループが消えていたら、インデックスが最も小さい生存グループへ振り替える。単体対象の味方（回復）が対象不適（死亡等）なら、HP 割合が最も低い生存メンバーへ。
- CB-43 オート解除条件（満たしたらオートを OFF にして入力フェーズに戻す）: 味方の HP 割合が `config.combat.autoInterrupt.hpRatio`（0.3）未満になった、味方に状態異常が付いた、味方が死亡した、敵の増援または新グループが出た、味方の SAN が閾値（CH-53）を下回った。判定はラウンドの終わりに、ラウンド開始時の値との遷移で行う（HP は割合が hpRatio 以上から未満になったとき、状態異常は新しく付いたとき、SAN は段階が悪化したとき）。理由が複数なら 死亡 > HP > 状態異常 > SAN の順で 1 つを選ぶ。解除時は message `battle.autoOff` と `battle.autoReason.<理由>` の 2 件を出す。
- CB-44 性格傾向（`personalities[].autoBattle`）はオート入力の生成時に適用する【仮】: 無鉄砲は HP に関わらず攻撃（CB-43 は効く）、慎重は HP 50% 未満で防御、強欲は `gold` 期待値が最も高いグループを対象に選ぶ、普通は傾向なし。
- CB-45 SAN の閾値効果（CH-53）はオートの有無に関わらず解決フェーズで適用する。

## 6. 逃走・勝利・全滅

- CB-50 逃走は `battle.flee`（CB-12）で行う。
  - 成功率% = `floor(config.combat.fleeBase（50）+ (味方 agi 平均 − 敵 agi 平均) × config.combat.fleeAgiMul（3）)`【仮】。平均は、行動可能な味方と生存個体で取る。
  - 1〜100 を振り、出目 ≤ 成功率で成功する（成功率はクランプしない）。
  - 受け付けたら、入力済みの行動は捨てる。
  - 受け付けないとき: 逃走できない戦闘（CB-02）、オート中、行動可能な味方が 0 人。
  - 成功すると戦闘終了（経験値なし）。失敗すると敵だけが 1 ラウンド行動し、次のラウンドへ進む（CB-04 の味方の奇襲は消費する）。
- CB-51 勝利: EXP を生存者で等分（CH-60）。金は `monsters[].gold` の合計を所持金へ加え、潜行台帳（DG-40）に記録。宝箱判定は部屋セルでの遭遇のみ、`config.combat.chestChance`（30）%【仮】。金は倒した個体ごとに `monsters[].gold` を振り（負は 0）、所持金と潜行台帳の両方に加える。EXP の等分の対象は、戦闘終了時に life が alive の全員（麻痺・石化・SAN 0 を含む）。
- CB-52 宝箱: 罠付きの可能性 `config.combat.chestTrapChance`（40）%【仮】。手順は「調べる（慎重の `trapDetect` で罠の有無が分かる）→ 解除（盗賊の `disarm`、失敗で罠発動）→ 開ける」。中身は階のドロップ表から、強欲の `chestQuality` で 1 段階上の表を引く。プロトタイプでは罠は「ダメージ」1 種類【仮】。M3 の仮実装: ランダム遭遇の部屋のセルでの勝利時だけ chestChance% で出て、罠なし、中身は `config.combat.chestGoldDice`（2d10）【仮】の金。ボス戦では判定しない。罠・解除・`chestQuality` は M5。
- CB-53 全滅 = 味方全員が行動不能（CH-44）。睡眠だけの場合は全滅としない（睡眠は覚める）。全滅時は `battleEnd(wipe)` → `battle.wipe` → 味方の睡眠の解除 → 全滅処理（TW-20〜26）で、screen は town になる（screen{dungeon} は出さない）。「睡眠だけ」とは、行動可能な者が 0 人でも、alive・SAN>0・睡眠あり・麻痺と石化なしの者が 1 人でもいる状態で、このときは戦闘を続ける。
- CB-54 戦闘中の死亡は即座に `dead`。戦闘後も持続する（CH-45）。

## 7. 表示層への引き渡し

戦闘中に core が返す `GameEvent` は最低限次を含む。表示層はこれだけで画面を組める。
`encounter`（グループ一覧: 表示名、体数、鑑定済みか）、`attack`、`spell`、`hpChanged`、`sanChanged`、`statusChanged`、`lifeChanged`、`message`、`battleEnd`、`dice`（逃走判定と先手判定は出目を見せる【仮】）。

- `encounter` / `enemyGroups` の各グループの `name` は core が選ぶ表示名（鑑定済みなら `name`、未鑑定なら `unidentifiedName`）。鑑定で表示名が変わったら `enemyGroups` を 1 件出して全グループを出し直す。
- 敵の個体の id は `e{グループ添字}-{個体添字}`（添字は戦闘中に詰めない）。敵の被弾にも `hpChanged`（id は敵の id）を出し、撃破は `lifeChanged` dead。
- MP の変化は `mpChanged`。
- dice の形は UI-40（`{label, rows, rule, result}`、どれも strings のキーと params）。先手判定の dice は 1 件 2 行（CB-04）。逃走の dice は label `dice.flee`、行は `dice.row.roll`（base null、出目 d100）、基準は `dice.rule.rate`（params rate = 逃走の成功率。クランプしない）、結果は 出目 ≤ 成功率なら `dice.flee.ok`、そうでなければ `dice.flee.ng`。
- ラウンド終了（決着しなかったラウンドだけ）の順は 毒（CB-33）→ 自然覚醒（CB-32）→ 確率鑑定（CB-05）→ オート解除（CB-43）。
- 遭遇の順は screen{battle} → encounter → message → （未鑑定の message と sanChanged）→（CB-06 の SAN で CB-53 の全滅になれば、先手判定の dice を出さずに戦闘の終わりの順へ進む）→ 先手判定の dice 1 件 → 奇襲の message →（敵の奇襲ならそのラウンド）。戦闘の終わりの順は battleEnd → 結果の message → 味方の睡眠の解除 → screen{dungeon}（全滅では screen{dungeon} の代わりに全滅処理 TW-20〜26 が続き、最後が screen{town}）。
- `battle.flee` のイベント順: dice（`dice.flee`）→ 成功なら戦闘の終わりの順 / 失敗なら message `battle.fleeFail` → 敵だけのラウンド →（決着しなければ）ラウンド終了の順。
- `battle.repeat` のイベントの形と順は `battle.resolve` と同じ（違うのは入力を自動で作ることだけ）。
