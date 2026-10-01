# CLAUDE.md — Wizardryライク・スマホ向けローグライク（仮称 wizlike）

このリポジトリは、ブラウザ（PWA）で動く Wizardry ライクのローグライク RPG です。
このファイルは設計の憲法です。詳細ルールは `docs/spec/*.md`、決定の経緯は `docs/decisions.md`、
作業の順番は `docs/milestones.md` を正とします。仕様と実装が食い違ったら、どちらを直すかを決めて
`docs/decisions.md` に一行残してください。

## 1. ゲームの要約

- 一人称・線画（ワイヤーフレーム）のダンジョン、6人パーティ（前衛3・後衛3）、ターン制コマンド戦闘。
- 世界観は「プレイヤーたちが卓を囲んでゲーム内ゲーム（TRPG）を遊んでいる」。GM の語りがシステムメッセージ。
- ダンジョンは複数。前のダンジョンをクリアすると次が開く。入場ごとに再生成。ファーミングして帰り、ボスを倒し、全踏破が目的。
- パーマデスは「灰」まで。ロストは無い。SAN 値がある。全滅は 2d10 のペナルティ表で処理する。
- 性格（慎重・無鉄砲・強欲・普通）で、イベント時に勝手に動く仲間がいる。リーダー（主人公）は性格を持たない。
- FC 級グラフィック、縦持ち、まずはブラウザ配布。

## 2. 技術スタックと制約（変更不可）

- TypeScript（strict）、Vite、Vitest。UI フレームワークは使わない（React / Vue / Svelte 等は禁止）。
- 描画は DOM とインライン SVG。ダンジョンの線画は SVG の `<path>`。Canvas、WebGL、ゲームエンジン（Phaser / Pixi 等）は使わない。
- アニメーションは Web Animations API（`Element.animate` と `animation.finished`）。文字送りと長押し連打だけは `setTimeout` と Promise。
- 常駐のゲームループ（`requestAnimationFrame` を回し続ける構造）は持たない。表示層はイベント列を順に再生するだけ。
- セーブは IndexedDB。`localStorage` は設定値にしか使わない。
- 実行時にネットワークへ出ない。CDN 読み込み禁止。フォント・画像・音は同梱。
- 論理解像度は縦 240×400。CSS `transform: scale()` で端末に合わせ、整数倍を優先する。`image-rendering: pixelated`。
- 対象は iOS Safari と Android Chrome の縦持ち。開発用に PC ブラウザでも動くこと（キーボード操作も付ける）。
- 依存パッケージは最小限。追加するときは `docs/decisions.md` に理由を書く。

## 3. アーキテクチャの憲法

1. `src/core/` は純粋な TypeScript。DOM、Web API、タイマー、`Math.random`、`Date` を一切使わない。import してよいのは `src/core/` 内のモジュールと `data/` の型だけ。
2. 状態変更はすべて `execute(state, command, data) → { state, events }` を通す。同じ `state` と `command` からは必ず同じ結果になる（乱数の状態も `state` に含める）。
3. 乱数は `src/core/rng.ts` のシード付き乱数のみ。ダンジョン生成、ダイス、判定はすべてこれを通す。`Math.random` を core で使ったらバグ。
4. `src/presenter/` はゲームロジックを持たない。`state` を描き、`events` を順に再生（アニメーション）するだけ。判定・計算・分岐をここに書かない。「表示のためだけの計算」（座標、色）は可。
5. コンテンツ（種族・職業・呪文・敵・アイテム・性格・ペナルティ表・ダンジョン・イベント・文言）は `data/*.json` が正。コードにハードコードしない。JSON は読み込み時に検証し、不正なら起動を止める。
6. 調整用の数値は `data/config.json`。仕様書で【仮】が付いた数値は必ずここに置く。
7. `docs/spec/*.md` の各ルールには ID がある（例: `CB-21`）。ルールを実装したら、その ID をテスト名に含むテストを書く。
8. オートセーブは「状態を変えるコマンドの直後」に表示層が呼ぶ。手動セーブ・ロードの UI は作らない。
9. 演出スキップ設定を必ず尊重する。`settings.skipAnimations` が真なら、再生は即時解決する。
10. 表示層の文字列は `data/strings.json`。GM の語り口はデータで差し替えられるようにし、表示層のコードに日本語をベタ書きしない。
11. `GameState` は JSON にそのまま保存できるプレーンなオブジェクトにする。クラスインスタンス、`Map`、`Set`、関数を入れない。

## 4. ディレクトリ構成

```
CLAUDE.md
docs/
  decisions.md          決定の記録（追記のみ。消さない）
  milestones.md         作業の順番と完了条件
  spec/
    character.md  magic.md  combat.md  dungeon.md  town.md  events.md  save.md  ui.md
data/
  config.json  races.json  classes.json  spells.json  monsters.json  items.json
  personalities.json  penalty-table.json  dungeons.json  events.json  strings.json
src/
  core/
    types.ts            GameState / Character / Command / GameEvent
    engine.ts           execute()
    rng.ts              シード付き乱数、ダイス記法（"2d10", "1d8+2"）
    data/               JSON の型と検証（loadGameData）
    rules/
      creation.ts       キャラ作成、能力値
      growth.ts         経験値、レベルアップ、レベルダウン、maxLevelReached
      learning.ts       呪文習得判定
      combat.ts         遭遇、ラウンド解決、命中、状態異常、オート
      dungeon-gen.ts    生成、到達性
      dungeon.ts        移動、視野、オートマップ、罠
      san.ts            SAN の増減と閾値
      town.ts           施設、蘇生、店の在庫
      wipe.ts           全滅処理、潜行台帳、ペナルティ表
      events.ts         衝動判定、制止判定
  presenter/
    app.ts              画面遷移の親
    playback.ts         GameEvent[] を順に再生する
    stage.ts            240×400 のスケーリング、safe area
    input/swipe.ts      スワイプと長押し、キーボード
    views/              dungeon-svg.ts  battle.ts  town.ts  party.ts  message.ts  dice.ts  title.ts
    audio.ts            Web Audio（プロトタイプでは任意）
  save/
    db.ts               IndexedDB（games ストア）、書き出し・読み込み
    migrate.ts          schemaVersion の移行
  main.ts
tests/                  Vitest。ファイル名は対象ルールの領域名（combat.test.ts 等）
public/                 manifest、アイコン、フォント
```

## 5. コアの型（骨格）

```ts
// src/core/types.ts の骨格。詳細は実装時に育てるが、この形は崩さない。
export type Command =
  | { type: "game.new"; party: PartySetup }
  | { type: "town.enter" }
  | { type: "town.inn"; rank: number }
  | { type: "town.temple"; memberId: string; service: "resurrect" | "cure" | "uncurse" }
  | { type: "town.dark"; memberId: string }
  | { type: "town.shop"; action: ShopAction }
  | { type: "town.bank"; amount: number }           // 正で預入、負で引出
  | { type: "town.mercy"; memberId: string }
  | { type: "dungeon.enter"; dungeonId: string }
  | { type: "dungeon.move" }                         // 前進1歩
  | { type: "dungeon.turn"; dir: "left" | "right" | "around" }
  | { type: "dungeon.useItem"; memberId: string; itemId: string }
  | { type: "dungeon.cast"; memberId: string; spellId: string; targetId?: string }
  | { type: "battle.input"; memberId: string; action: BattleAction }
  | { type: "battle.resolve" }                       // 全員分の入力が揃ったら1ラウンド解決
  | { type: "battle.auto"; on: boolean }
  | { type: "event.choose"; optionId: string }
  | { type: "party.reorder"; order: string[] };

export type GameEvent =
  | { kind: "message"; key: string; params?: Record<string, string | number> }
  | { kind: "moved"; pos: Pos; facing: Facing }
  | { kind: "turned"; facing: Facing }
  | { kind: "blocked" }
  | { kind: "encounter"; groups: EnemyGroupView[] }
  | { kind: "attack"; actorId: string; targetId: string; hit: boolean; damage: number }
  | { kind: "spell"; actorId: string; spellId: string; targets: string[] }
  | { kind: "hpChanged"; id: string; delta: number; hp: number }
  | { kind: "sanChanged"; id: string; delta: number; san: number }
  | { kind: "statusChanged"; id: string; status: StatusId; on: boolean }
  | { kind: "lifeChanged"; id: string; life: "alive" | "dead" | "ash" }
  | { kind: "dice"; label: string; dice: number[]; total: number }
  | { kind: "battleEnd"; result: "win" | "flee" | "wipe" }
  | { kind: "wipe"; penalty: PenaltyResult }
  | { kind: "levelUp"; id: string; level: number }
  | { kind: "spellLearned"; id: string; spellId: string }
  | { kind: "eventStarted"; eventId: string; actorId?: string }
  | { kind: "screen"; to: "title" | "town" | "dungeon" | "battle" | "event" };

export function execute(
  state: GameState,
  command: Command,
  data: GameData,
): { state: GameState; events: GameEvent[] };
```

- `execute` は引数の `state` を書き換えず、新しい `state` を返す（`structuredClone` でよい）。
- `GameEvent` は「何が起きたか」であって「どう見せるか」ではない。演出の種類は表示層が `kind` から決める。
- 表示に必要な情報が足りないときは `GameEvent` に足す。表示層から `state` を掘り直して推測しない。

## 6. 開発コマンド

```
npm run dev        開発サーバー（LAN 公開して実機で確認する: vite --host）
npm test           Vitest（watch なし）
npm run typecheck  tsc --noEmit
npm run build      本番ビルド（dist/）
npm run preview    ビルド結果の確認
```

作業の区切りごとに `npm test` と `npm run typecheck` を通す。どちらかが赤いまま次の作業に進まない。

## 7. 作業手順

1. 着手前に `docs/decisions.md` と、その作業に関係する `docs/spec/*.md` を読む。仕様 ID を確認してから書く。
2. `docs/milestones.md` の順に進める。マイルストーンをまたぐ実装は先にやらない。
3. 仕様が沈黙している点は、いちばん単純な解釈を選んで実装し、`docs/decisions.md` の「実装中の判断」に日付付きで一行書く。数値が必要なら `data/config.json` に置き、仕様書のその箇所に【仮】を付ける。質問して止まらない。
4. 仕様と衝突する実装をしたくなったら、実装せずに `docs/decisions.md` に「衝突」として書き、代替案を添える。
5. コンテンツはデータで増やす。敵やアイテムを増やすときにコードを触ったら設計ミスを疑う。
6. core のルールは必ずテストと一緒に書く。シードを固定し、期待する出目と結果を明示する。
7. 表示層は実機で確認する。`vite --host` で LAN 公開し、iPhone / Android の縦持ちで触る。確認したことを milestones の完了条件に照らして記録する。
8. コミットは小さく。メッセージ先頭に領域（core/presenter/data/docs）とマイルストーン番号を書く。例: `core(M3): CB-21 命中判定`。各コミット単体で `npm run typecheck` が通ること（依存するファイルは同じコミットに入れる）。
9. 仕様書を直したときは、対応するテストとデータも同じコミットで直す。

## 8. やらないこと

- UI フレームワーク、状態管理ライブラリ、CSS フレームワーク、ゲームエンジンの導入。
- core での `Math.random` / `Date.now()` / `setTimeout` の使用。
- 手動セーブ、ロード、セーブの複製、スロット間コピー。
- プロトタイプの範囲（§9）を超える機能の先回り実装（キャラ作成の全工程、店の在庫、銀行、客将、転職、音楽）。
- 既存の商用作品の固有名（呪文名、モンスター名、アイテム名）の流用。名前はすべてこのリポジトリのオリジナル。
- 実行時の外部通信、解析、広告。

## 9. プロトタイプの完成条件

`docs/milestones.md` の M0〜M6 が終わり、以下が実機（iOS Safari と Android Chrome、縦持ち）で通ること。

1. タイトル → 簡易作成（6人の名前と性格を選ぶ。リーダーは性格なし）→ 街。
2. 街の宿屋と寺院が使える。
3. 迷宮に入り、2 階分の生成ダンジョンを線画で歩ける（スワイプとボタンの両方）。オートマップが出る。
4. 5 種以上の敵と戦える。攻撃・呪文 2 つ・防御・逃走・オート。前衛後衛と ranged 武器のルールが効く。
5. 帰還の糸で街に戻れる。徒歩でも戻れる。
6. 全滅すると 2d10 が画面に出て、ペナルティ表どおりに資産と EXP が減り、街に戻る。潜行中の取得物は消える。
7. 性格付きの衝動イベントが 2 つ動き、慎重の制止判定が起きる。SAN が減り、閾値で挙動が変わる。
8. どの画面でリロードしても続きから再開する（オートセーブ）。
9. 演出スキップを ON にすると待ち時間なく遊べる。

## 10. 仕様書の索引

| ファイル | 内容 | ID 接頭辞 |
|---|---|---|
| docs/spec/character.md | パーティ、能力値、種族・職業、性格、状態、SAN、成長、装備枠 | CH |
| docs/spec/magic.md | MP、呪文レベル、習得判定、魔法書 | MG |
| docs/spec/combat.md | 遭遇、ラウンド、命中、状態異常、SAN 攻撃、オート、逃走、全滅 | CB |
| docs/spec/dungeon.md | 生成、移動、視野、マップ、罠、脱出、ボス、潜行台帳 | DG |
| docs/spec/town.md | 施設、店の在庫、蘇生、銀行、全滅処理、GM の救済 | TW |
| docs/spec/events.md | 衝動判定、制止判定、性格の恩恵と SAN 耐性 | EV |
| docs/spec/save.md | オートセーブ、ゲーム一覧、書き出し・読み込み、移行 | SV |
| docs/spec/ui.md | レイアウト、線画、入力、メッセージ、ダイス、演出、設定 | UI |
