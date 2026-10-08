# キャラクター仕様（CH）

【仮】は数値や選択がプロトタイプで変わる前提。実数は `data/config.json` と `data/*.json` を正とする。

## 1. パーティ

- CH-01 パーティは 6 人固定。並び順 1〜3 が前衛、4〜6 が後衛。
- CH-02 キャラクター作成はゲーム開始時のみ。1 人目に作ったキャラクターがリーダー（主人公）。
- CH-03 リーダーは変更も除外もできない。並び順の変更は街と迷宮内（非戦闘時）で可能。コマンドは `party.reorder {order}`（全員の id の並べ替え。リーダーの位置も自由）。受け付けは街と、迷宮の戦闘外かつ保留なし（それ以外は rejected `wrong screen`。保留中は choice pending）。配列でない・長さが違う・文字列でない・重複・未知の id は `bad order`、今と同じ並びは `no change`。受け付けたら並べ替えて `camp.reordered`。乱数は使わない（M4.5）。
- CH-04 メンバーの追加・除外は、将来の客将（EV-60、【未定】）を除いて発生しない。
- CH-05 タイトルの「新しく始める」で、おすすめ（簡易作成）か自分で作る（CH-06）を選ぶ（M5.5）。プロトタイプの簡易作成では、6 人の名前と性格（リーダー以外）だけを選ぶ。種族・職業・能力値は `data/config.json` の `prototypeParty` で固定。名前は前後の空白を除いて 1〜`config.creation.nameMaxLength`（6）【仮】文字（コードポイント数）。重複は可。性格の「ランダム」は core が乱数で決める。開始の語りは TW-36。
- CH-06 自分で作る（M5.5）: 6 人（1 人目がリーダー）を 1 人ずつ、種族 → 能力値（CH-11）→ 職業（CH-21）→ 性格（CH-30。リーダーは無し）→ 名前（CH-05 と同じ長さ）の順に決める。各段で 1 つ前へ戻れる。6 人そろったら確認して `game.new {party: {kind: "custom", members}}`（members の各人は `name` / `personality` / `raceId` / `classId` / `stats`）。core は 6 人であること、名前・性格（CH-05 / CH-30 / CH-31 と同じ）、各人の種族・職業の実在（`unknown race at i` / `unknown class at i`）、能力値が 6 つとも種族の基礎値以上 18 以下の整数（`bad stats at i`）、配分の合計（能力値 − 基礎値の和）≤ `bonusBase + bonusDie + bonusBig`（`too many bonus points at i`）、職業の条件（`class requirements not met at i`）をこの順に検証する。`kind` が無い setup は今どおりおすすめ、`custom` 以外の `kind` は `invalid party setup`。開始の装備・所持品・呪文・所持金は CH-24。性格の「ランダム」はおすすめと同じく添字の順に core が乱数で決める。作成中の乱数（CH-11 のボーナス）は表示層が持ち（GameState がまだ無いため。種は `crypto.getRandomValues`）、作成中の下書きは保存しない（SV-50）。開始の語りは TW-36。

## 2. 能力値

- CH-10 能力値は 力 `str`、知恵 `iq`、信仰心 `pie`、生命力 `vit`、素早さ `agi`、運 `luk` の 6 つ。上限 18。
- CH-11 作成時は種族基礎値（`data/races.json`）に、ボーナスポイント（`7 + 1d4`、5% で `+10`【仮】）を任意に配分する。振り直しは何度でも可。ボーナスは rollDie(`bonusDie`) → chance(`bonusBigChance`) の順で `bonusBase + 出目（当たれば + bonusBig）`。配分は 1 点ずつで、各能力値は基礎値以上 18 以下。残りが 0 になるまで職業へ進めない。振り直すと能力値は基礎値に戻る（M5.5）。作成画面（UI-62）はボーナスの値と内訳を出す: 外れは「ボーナス 9（7+2）」、当たりは「ボーナス 19（7+2+10）」。内訳は core の `rollBonusParts`（`{ base, die, big, total }`。big は当たれば bonusBig、外れは 0。乱数の順は上と同じ）の値で、`rollBonus` はその total を返す（M10）。簡易作成（UI-51）には出さない。能力値の説明は UI-74（M12.5）。
- CH-12 善悪（アライメント）は存在しない。
- CH-13 実効の能力値（M7）: 装備中の品のオプションの能力値（IT-34）を足した値。戦闘・判定・成長・寺院など、能力値を読むルールはすべて実効の値を使う。上限 18 は作成（CH-11）と職業の条件（CH-21）の素の能力値にだけ掛け、実効の値は 18 を超えてよく、1 未満にはしない。作成・職業の条件・`stats` の保存は素の値。計算は IT-35 の 1 か所。
- CH-14 実効の最大値（M7）: `hpMax` / `mpMax` / `sanMax` に装備中のオプション（IT-34 の hpMax / mpMax / sanMax）を足した値（1 未満にはしない。ただし素の mpMax が 0（呪文を使わない職業）なら mpMax は 0 のまま。sanMax は 0 以上）。保存するのは素の値で、ルールと表示は実効の値を使う。装備の付け外しで実効の最大値が下がったら、現在値をその値で止める（増えたときは現在値を変えない。寺院の解呪と全滅で装備中の品を失ったときも同じ。宿の士気の間の SAN は実効の sanMax + sanOver で止める）。

## 3. 種族と職業

- CH-20 種族は `data/races.json` の 5 つ【仮】: 人間、エルフ、ドワーフ、ノーム、ホビット。
- CH-21 職業は `data/classes.json` の 7 つ【仮】: 基本 4（戦士、盗賊、僧侶、魔術師）、上級 3（侍、君主、司教）。`requirements` の能力値を満たすと選べる。
- CH-22 （M10）転職: 酒場で GM に申し出て転職できる（`town.classChange`。TW-09）。新しい職業の `requirements` を素の能力値（CH-21）で満たすこと。リーダーも可。レベル 1・EXP 0 に戻り、HP の最大値・習得呪文・能力値・SAN・状態は変えない。MP の最大値は新しい職業の L1 の値になり、現在値はその上限に丸める。新しい職業で装備できない品（CH-75）は外す（呪われた品は外れない）。その職業に初めてなるときは `classes[].start.knownSpells` を得る。習得判定の記録（CH-63）は職業ごと。（M10 より前は「転職は無し【未定】」だった）
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
- CH-45 戦闘中に HP が 0 になったら即 `dead`。戦闘後も持続する。戦闘外（罠など）で HP が 0 になっても即 `dead`。仲間の死亡の SAN 減少（CH-51、本人以外の生存者）も起きる。死亡・灰になった時点で状態異常（`status`）をすべて外す（`lifeChanged` の直後に `status` の順で `statusChanged` off）。生き返るすべての経路（寺院の蘇生 TW-07、蘇生の呪文 MG-42、闇魔術 TW-08、GM の救済 TW-31、全滅でのリーダーの復活 TW-24）で、戻る者は常に状態異常なし（古い保存で死者・灰に状態異常が残っていても、戻るときに外す。`lifeChanged` alive → `hpChanged` → `statusChanged` off）。パーティ欄の状態の列は、死亡・灰ならその語だけを出す（UI-12）。2026-10-05 のユーザー決定（M7 の途中の「死亡しても外さない」は撤回）。

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
- CH-61 レベルアップは宿屋に泊まったときに処理する【仮】（TW-04）。レベルごとの HP 増分 `hpGain` と MP 増分 `mpGain` を `levelHistory[]` に記録する。増分は最大値と現在値の両方に足す。（M10）能力値の成長: 上げた後のレベルが全体の最高到達レベル（CH-63。職業ごとの記録の最大）を超える段でだけ、能力値を `STAT_KEYS` の順（力・知恵・信仰心・生命力・素早さ・運）に 1 つずつ `config.growth.statUpChance`（25%）【仮】で判定し、当たれば素の能力値を +1 する（`config.growth.statCap`（18）【仮】まで。作成の上限 CH-10 とは別の値）。上限に達している能力値も判定はする（1 段の消費は常に 6 回）が上げない。能力値は減らない（年齢の仕組みが無いため）。乱数の順は HP のダイス（CH-65）→ 能力値 6 回 → 習得判定（CH-63）。HP・MP の増分は能力値を上げる前の値で求める。上がった能力値は `levelUp` の出来事（`statGains`）にだけ載せ、`levelHistory` には記録しない。宿屋の語りは レベルアップ → 最大 HP の増加 → 最大 MP の増加（増分が 0 なら省く）→ 上がった能力値ごとに 1 行（`from → to`）の順。
- CH-62 EXP 減少（TW-22）でレベルダウンが起きる。レベルダウンは `levelHistory` の末尾を取り消す（HP/MP の最大値も戻す。現在値は最大値を超えない範囲に丸める）。覚えた呪文は失わない。（M10）成長で上がった能力値は戻さない（CH-61 の「能力値は減らない」）。EXP が閾値を下回っている間、1 段ずつ繰り返す。レベル 1 の初期値は取り消さない。
- CH-63 `maxLevelReached` を保持する。呪文習得判定（MG-20）は「初めて到達したレベル」でのみ行う。（M10）`maxLevelReached` は職業ごとの記録（`Record<classId, number>`。作成時は `{ [classId]: 1 }`）。習得判定は今の職業で初めて到達したレベル（`L > maxLevelReached[今の職業]`）でだけ行い、その後で今の職業の欄を L にする。ほかの職業の欄は見ない。今の職業の欄は常にあり、level 以上。全体の最高到達レベル（能力値の成長の判定に使う。U5）は各欄の最大で、別の欄は持たない。保存の形は SV-04（schemaVersion 5）。
- CH-64 必要経験値 `expFor(L)`: レベル L にいるのに必要な累計経験値。`expFor(1) = 0`。L ≥ 2 は `floor(config.growth.expBase × config.growth.expGrowth^(L−2) × classes[].expMultiplier)`【仮】（既定 `expBase` 50、`expGrowth` 1.5。戦士は L2 50 / L3 75 / L4 112）。`exp ≥ expFor(level+1)` でレベルアップでき、`exp < expFor(level)` でレベルダウンする。
- CH-65 HP 増分 = `max(config.growth.hpGainMin, 1d(classes[].hpDie) + floor((vit − config.growth.hpVitPivot) / config.growth.hpVitDivisor))`【仮】（職業 HP ダイス + 生命力補正。負も floor。最低は hpGainMin（1））。レベル 1 の hpMax = `hpDie + max(0, 生命力補正) + config.growth.level1Bonus`（4）【仮】（ダイスの最大値に、正の生命力補正だけを足し、さらに level1Bonus を足す。乱数なし。hpGainMin はレベルアップの増分にだけ使う）。レベル 2 以降の増分は上の式のまま。levelHistory には入れない。MP 増分は `classes[].mpPerLevel` + 関連能力値補正【仮】（MG-01）。

## 8. 装備と所持

M7 で、装備品の分類（汎用 / ユニーク）・実体の形・レベル・希少度・オプション・呪い・ドロップ・売買は `docs/spec/items.md`（IT）を正にする。この節の CH-72〜77 は、実体の欄（IT-10）と表示名（IT-11 / 12）を読み替えて今の手順のまま使う。

- CH-70 装備スロットは 6: 武器 `weapon`、防具 `armor`、盾 `shield`、兜 `helm`、小手 `gauntlet`、装飾 `accessory`。
- CH-71 所持枠は 8（装備中を含む）【仮】。`Character.inventory` は装備中の品を含まない。使用枠 = 装備数 + inventory の数。
- CH-72 未鑑定アイテムは `unidentifiedName` で表示され、装備できない（CH-76。CH-77 の取り憑きは例外）。鑑定は司教（CH-77。MP を使い、確率で成功する。M10）か店（IT-65。料金を払い、必ず成功する）。M7: 表示は IT-12、店の鑑定は IT-65（鑑定料は見た目の品種の売値から決まる。2026-10-05）。未鑑定のままでも店で見た目の品種の売値で売れる（IT-61）。「装備できない」は items.md §11 の Q2【衝突】で代替案（未鑑定のまま装備できる）を諮っている。
  - M10（2026-10-07 ユーザー承認）: 司教の鑑定（CH-77）の失敗で呪われた品が取り憑けなかったときの SAN −10（`possessSan`）は街でも起き、次に街へ入るまで残る（街にいる間は回復しない。SAN の回復は街に入った時点だけ。TW-02）。これは意図した仕様。失敗の SAN −3（`failSanDungeon`）は今どおり迷宮内だけ。
- CH-73 呪われたアイテムは装備すると外せない。寺院の解呪（TW-07）で外せる。呪いはアイテムの `cursed` で、未鑑定のうちは見えない（表示で呪いと示さないだけで、外せないことは鑑定と関係ない。CH-76）。M7: 呪いは実体の `cursed`（IT-10 / IT-32。ドロップの判定で付き、負のオプションを 1 つ持つ）で、`items[].cursed` は廃止する。
- CH-74 後衛が攻撃できるのは `reach` が `long` か `ranged`（IT-25。2026-10-06 に `ranged: true` から改めた）の武器を装備しているときだけ（CB-13）。M7: 固有スキル `reachFromBack`（IT-40）の品も同じ扱い。
- CH-75 職業ごとの装備制限は `items[].classes`（空なら全職業可）。M7: 装備のベース `equipment-bases.json` の `classes`（ユニークはベースのものを引き継ぐ。IT-03）。
- CH-76 装備の付け外し（M4.5）: `party.equip {memberId, instanceId}` / `party.unequip {memberId, slot}`。受け付けは街と、迷宮の戦闘外かつ保留なし。本人は行動可能（CH-44）であること。
  - `party.equip` の判定順: wrong screen → no such member → cannot act → item not in inventory（本人の inventory に無い。装備中の品も含まない）→ not equipment（`items[].type` が装備スロットでない）→ not identified（CH-72）→ class cannot equip（CH-75）→ slot cursed（その枠の今の品が `cursed`）。受け付けたら、inventory の新しい品の位置に旧品を入れ（旧品が無ければ取り除く）、枠に新しい品を入れる → `camp.equipped{name, item}`。新しい品が呪われていれば続けて `camp.cursed{item}`。所持枠（CH-71）と潜行台帳は変わらない。
  - `party.unequip` の判定順: wrong screen → no such member → cannot act → bad slot → slot empty → cursed（`items[].cursed` の品は鑑定と関係なく外せない）。受け付けたら枠を空にして inventory の末尾に入れる → `camp.unequipped{name, item}`。
    - M10（2026-10-07 ユーザー判断 U6）: `party.unequip` は本人の life と行動の可否を問わない（cannot act を外した。判定順は wrong screen → no such member → bad slot → slot empty → cursed）。死亡・灰の者の装備も、呪われていなければ外して回収できる（外した品は本人の inventory に入るので、CH-78 で他の者に渡す）。`party.equip` は今どおり本人が行動可能であること。
  - どちらも乱数は使わない。
- CH-77 鑑定（M4.5。M10 で MP・確率・取り憑きに書き換え。2026-10-07 ユーザー指示）: `party.identify {memberId, instanceId}`。鑑定する者は `classes[].abilities` に `identify` を持つ職業（司教）。対象はパーティの誰かの inventory にある未鑑定品（装備中は対象外）。受け付けは街と、迷宮の戦闘外かつ保留なし。判定順: wrong screen → no such member → cannot identify → cannot act → no mp（MP が `config.identify.mpCost` 未満）→ no such item → already identified。回数の制限は MP だけ（同じ品を何度でも試せる）。
  - 処理: MP を `mpCost`（1【仮】）減らす（`mpChanged`）→ d100（`randInt(1, 100)`）を 1 回 → 判定の箱（UI-40）に `dice` を出す → 出目 ≤ 成功率なら成功。
  - 成功率（`identifyChance`。UI-35 の問い合わせ）= `base`（60【仮】）+ (知恵 − `iqPivot`（10【仮】）) × `iqPerPoint`（3【仮】）+ `perLevelStep`（10【仮】）× floor(レベル / `levelStep`（10【仮】）) − `rarityPenalty`[希少度]（通常 0 / 上質 10 / 希少 20 / 伝説 30【仮】）−（ユニークなら `uniquePenalty`（15【仮】））を `min`（5【仮】）〜`max`（95【仮】）に収めた値。知恵は実効の値（CH-13）。鍵はすべて `config.identify`。
  - 格の感知（司教の職業の能力。2026-10-07 ユーザー承認）: 司教は未鑑定品の格（希少度とユニークかどうか）を鑑定の前に感じ取れる。この能力は成功率（`identifyChance` / `campMenu` の `identifyRates`）と判定の箱の内訳の希少度・ユニークの減点として表れる。名前・Lv・オプション・呪いは感じ取れない（IT-12 のまま）。店の鑑定（IT-65）は格を漏らさない。
  - 判定の箱: label `dice.identify{item: 鑑定前の表示名}`。行は内訳（基本（常に）→ 知恵 → レベル → 希少度 → ユニーク → 上下限（クランプが効いたとき）。基本以外は 0 の行を出さない。値は label の params `v` に符号付きで入れ、`base` が値で `dice` が空の補正の行）と、最後に出目の行 `identify.row.roll`（base null・dice [出目]）。基準 `identify.rule{rate}`、結果 `dice.identify.ok` / `dice.identify.ng`。拍の外で出たら続く語りの後でタップを待つ（UI-40 の強化の箱と同じ）。
  - 成功: `identified` を真にして `camp.identified{name, old, item, rarity}`（rarity は品の希少度。文には出さず、音の契機に使う。UI-66。M8）、呪われていれば続けて `camp.identifiedCursed{item}`。M7: ユニークなら図鑑（IT-66）に記録する。`item` は IT-11 の表示名。
  - 失敗: `camp.identifyFailed{name, item}`（item は未鑑定の表示名）。迷宮内（`dive` が null でない）なら司教の SAN を `failSanDungeon`（3【仮】）減らす（CH-51。タグなし）。街では減らない。品が呪われていれば続けて `chance(possessChance)`（50【仮】）を 1 回引き、当たれば品が司教に取り憑く（街でも迷宮でも）:
    - 司教が装備できる品（装備品で、職業が装備でき（CH-75）、その枠の今の品が呪われておらず、枠が空なら品が司教の inventory にあるか司教の使用枠（CH-71）に空きがある）なら強制装備: 品は未鑑定のまま枠に入り、枠の旧品は品があった持ち主の inventory の同じ位置へ入る（旧品が無ければその位置から取り除く）→ `camp.possessed{name, item}` → `camp.cursed{item}` → 実効の最大値を超えた HP・MP・SAN を止める（CH-14）。取り憑いた品は CH-73 のとおり外せず、装備中なので鑑定の対象にもならない（解呪 TW-07 で失う）。
    - 装備できない品なら品は元の場所のまま `camp.possessedSan{name, item}` → 司教の SAN を `possessSan`（10【仮】）減らす（タグなし）。街でも減らし、次に街へ入るまで残る（CH-72 の M10 の注記）。
  - 乱数の順: d100 →（失敗かつ品が呪われているときだけ）chance。呪われていない品の失敗と成功では chance を引かない。
- CH-78 渡す（M10。2026-10-07 ユーザー指示）: `party.give {memberId, instanceId, toId}`。memberId の inventory の品（装備中は対象外）を、パーティの他の者 toId に渡す。受け付けは街と、迷宮の戦闘外かつ保留なし（CH-76 と同じ）。
  - 判定順: wrong screen → no such member → item not in inventory（本人の inventory に無い）→ no such target（自分・パーティ外）→ target full（受け取る側の使用枠（CH-71）が `config.inventory.slotsPerCharacter` 以上）。
  - 渡す側・受け取る側とも life と行動の可否は問わない（操作するのはプレイヤー。死亡・灰の者の品も渡せ、死亡・灰の者にも渡せる。2026-10-07 ユーザー判断 U6）。呪われた品・未鑑定の品も渡せる。
  - 処理: 渡す側の inventory から外し、受け取る側の inventory の末尾に入れる → `camp.gave{name, item, to}`（item は IT-11 / IT-12 の表示名）。潜行台帳と品の実体は変わらない。乱数は使わない。
  - 表示層は相手の可否を `campMenu` の `members[].canReceive`（target full の逆。自分かどうかは見ない）で出す。
- CH-79 捨てる（M10。2026-10-07 ユーザー指示）: `party.drop {memberId, instanceId}`。受け付けは CH-78 と同じ。
  - 判定順: wrong screen → no such member → item not in inventory。本人の life と行動の可否は問わない（U6）。呪われた品・未鑑定の品も捨てられる（装備中の品は対象外なので、取り憑いた品は捨てられない）。
  - 処理: `camp.dropped{name, item}` → 品の実体を消す（潜行中なら潜行台帳からも消える。DG-41）。図鑑（IT-66）は消さない。乱数は使わない。確認は表示層が出す（core は確認を持たない）。
- CH-80 レベルアップ可（M10。2026-10-07 ユーザー指示・判断 U9）: メンバーが「レベルアップ可」なのは、`life` が `alive` で、かつ `exp ≥ expFor(level + 1)`（CH-64）のとき。宿（TW-04 / CH-61）が上げる者と同じ条件（宿は alive の者だけを上げる）。死亡・灰の者は exp が足りても可にしない（U9）。処理は今どおり宿屋だけで、レベルの上限は無い。
  - 次のレベルまでの残りは `max(0, expFor(level + 1) − exp)`（life を問わない）。
  - 表示の段 `levelUpView` は 3 値: `ready`（可）/ `next`（残りが 1 以上）/ `blocked`（残りが 0 だが alive でない。蘇生すれば `ready`）。
  - 値は core の `memberSheet`（UI-35 の許可リストの既存の問い合わせ）の `expNext`（`expFor(level + 1)`）・`expToNext`（残り）・`canLevelUp`（可。`levelUpView === "ready"` と同じ）・`levelUpView`。state に欄は足さない（exp・level・life から求める）。

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
`maxLevelReached` は職業ごとの記録 `{ [classId]: レベル }`（CH-63。M10）。
`equipment` は 6 スロットのキーをすべて持ち、空きは null。アイテムは実体の id（`GameState.items`）で持つ。
