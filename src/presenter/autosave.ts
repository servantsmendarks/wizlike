// SV-02 / SV-23: オートセーブ（DOM なし。node でテストできる）。
// - 状態を変えるコマンドの直後、再生を始める前に保存を await する（§3-8、SV-02）。保存に失敗しても state は巻き戻さない。
// - game.new は新しいゲームの記録を作り（begin）、それ以外は今のゲームの記録へ上書きする（save）。
// - 結果は onStatus に "ok" / "failed" で渡す。帯（SV-23）を出すかどうかは createSaveBannerState が決める。
// - 保存にタイムアウトは置かない（put が終わらなければ門が閉じたままになる。実機で起きたら見直す）。
// - SV-41: ページが隠れたときの flush は、進行中の保存を待ってから、最後に保存に成功した state と同じ参照なら書かない。
import type { Command, GameEvent, GameState } from "../core/types";
import type { SaveService } from "../save/types";

export type SaveStatus = "ok" | "failed";

/** SV-41: flush の結果。skipped = 保存済みの state なので書かなかった */
export type FlushResult = "ok" | "failed" | "skipped";

export type Autosaver = {
  /** before と after が同じ参照なら何もしない。保存が終わる（成功・失敗）まで解決しない。reject しない */
  afterCommand(cmd: Command, before: GameState, after: GameState): Promise<void>;
  /**
   * SV-41: 進行中の保存（afterCommand・flush）を待ってから、最後に保存に成功した state と同じ参照なら何もしない（skipped）。
   * 違えば save して onStatus に渡す。reject しない
   */
  flush(state: GameState): Promise<FlushResult>;
  /** SV-41 / SV-50: 読み込んだ state を「保存済み」とする（続きからの直後の flush で書かない） */
  markSaved(state: GameState): void;
};

export function createAutosaver(o: { saves: Pick<SaveService, "begin" | "save">; onStatus(s: SaveStatus): void }): Autosaver {
  /** 最後に保存に成功した（または読み込んだ）state の参照 */
  let saved: GameState | null = null;
  /** 進行中の保存（afterCommand・flush）。同期部分で差し替えるので、続けて呼ばれても順に待つ */
  let inflight: Promise<unknown> = Promise.resolve();

  const track = <T>(p: Promise<T>): Promise<T> => {
    inflight = p;
    return p;
  };

  return {
    afterCommand(cmd, before, after) {
      if (after === before) return Promise.resolve();
      return track(
        (async () => {
          let ok = false;
          try {
            const r = cmd.type === "game.new" ? await o.saves.begin(after) : await o.saves.save(after);
            ok = r.ok;
          } catch {
            ok = false;
          }
          if (ok) saved = after;
          o.onStatus(ok ? "ok" : "failed");
        })(),
      );
    },
    flush(state) {
      const prev = inflight;
      return track(
        (async (): Promise<FlushResult> => {
          await prev.catch(() => undefined);
          if (state === saved) return "skipped";
          let ok = false;
          try {
            ok = (await o.saves.save(state)).ok;
          } catch {
            ok = false;
          }
          if (ok) saved = state;
          o.onStatus(ok ? "ok" : "failed");
          return ok ? "ok" : "failed";
        })(),
      );
    },
    markSaved(state) {
      saved = state;
    },
  };
}

/**
 * SV-23 の帯の状態。帯は「IndexedDB を開けなかった（available が偽）」なら起動からずっと、そうでなければ直近の保存が
 * 失敗している間だけ出す（次の成功で消す）。announce は失敗に変わった最初の 1 回だけ真（メッセージ窓に save.failed を出す）。
 */
export type SaveBannerState = {
  visible(): boolean;
  update(s: SaveStatus): { visible: boolean; announce: boolean };
};

export function createSaveBannerState(available: boolean): SaveBannerState {
  let failing = false;
  const visible = (): boolean => !available || failing;
  return {
    visible,
    update(s) {
      const announce = s === "failed" && !failing;
      failing = s === "failed";
      return { visible: visible(), announce };
    },
  };
}

export type CommandResult = { events: readonly GameEvent[]; rejected: boolean };
/** UI-25: beforePlay は rejected でない手の結果が出た時点（state を差し替えた直後、保存と再生の前）に呼ぶ */
export type CommandExecOptions = { beforePlay?(events: readonly GameEvent[]): void };

/**
 * app の run の門の中身（UI-35 / SV-02）: execute → rejected（ちょうど 1 件の rejected）なら state を変えずに返す →
 * state を差し替える → opt.beforePlay(events) → 保存を await → 再生を await。保存と再生の順をここで固定する。
 */
export function createCommandExec(o: {
  execute(state: GameState, cmd: Command): { state: GameState; events: GameEvent[] };
  getState(): GameState;
  setState(st: GameState): void;
  autosaver: Autosaver;
  play(events: readonly GameEvent[], before: GameState, after: GameState): Promise<void>;
  onRejected?(ev: Extract<GameEvent, { kind: "rejected" }>): void;
}): (cmd: Command, opt?: CommandExecOptions) => Promise<CommandResult> {
  return async (cmd, opt) => {
    const before = o.getState();
    const r = o.execute(before, cmd);
    const only = r.events.length === 1 ? r.events[0] : undefined;
    if (only !== undefined && only.kind === "rejected") {
      o.onRejected?.(only);
      return { events: r.events, rejected: true };
    }
    o.setState(r.state);
    opt?.beforePlay?.(r.events);
    await o.autosaver.afterCommand(cmd, before, r.state); // SV-02: 再生を始める前
    await o.play(r.events, before, r.state);
    return { events: r.events, rejected: false };
  };
}
