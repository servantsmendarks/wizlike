// UI-44: コマンドの再入の門。1 つのコマンドの処理（execute と再生）が終わるまで、次のコマンドを捨てる。
// app.ts の run から切り出した。DOM に触れないので node でテストできる。

export type RunGate<C, R, O = undefined> = {
  /**
   * 処理中なら cmd を捨てて null。そうでなければ onStart の後に exec を待ち、その結果を返す（例外は onError に渡して null）。
   * opt はそのまま exec に渡す（app では UI-25 の beforePlay）
   */
  run(cmd: C, opt?: O): Promise<R | null>;
  /** 処理中か */
  busy(): boolean;
};

export function createRunGate<C, R, O = undefined>(o: {
  exec: (cmd: C, opt?: O) => Promise<R>;
  /** 受け付けたコマンドの処理を始める直前（app ではタップの回数を 0 に戻す） */
  onStart?: () => void;
  onError?: (e: unknown) => void;
}): RunGate<C, R, O> {
  let busy = false;
  return {
    async run(cmd: C, opt?: O): Promise<R | null> {
      if (busy) return null;
      busy = true;
      try {
        o.onStart?.();
        return await o.exec(cmd, opt);
      } catch (e) {
        o.onError?.(e);
        return null;
      } finally {
        busy = false;
      }
    },
    busy: () => busy,
  };
}
