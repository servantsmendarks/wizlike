// 入力のテスト用の最小の偽の DOM（node 環境）。input/tap.ts の attachStageInput が使う分だけを持つ。
// FakeNode は親をたどる closest("[data-tap]")・classList・getBoundingClientRect を持ち、FakeStage はイベントを受ける。

type Listener = (e: never) => void;

export class FakeClassList {
  readonly set = new Set<string>();
  add(c: string): void {
    this.set.add(c);
  }
  remove(c: string): void {
    this.set.delete(c);
  }
  contains(c: string): boolean {
    return this.set.has(c);
  }
}

export class FakeNode {
  readonly attrs = new Map<string, string>();
  readonly classList = new FakeClassList();
  isConnected = true;
  /** getBoundingClientRect の左上（CSS px） */
  left = 0;
  top = 0;
  blurred = 0;
  constructor(
    public tagName: string,
    public parent: FakeNode | null = null,
  ) {}
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
  }
  getAttribute(k: string): string | null {
    return this.attrs.get(k) ?? null;
  }
  /** "[data-tap]" だけを解釈する */
  closest(sel: string): FakeNode | null {
    const m = /^\[([a-z-]+)\]$/.exec(sel);
    if (m === null) throw new Error(`unsupported selector ${sel}`);
    for (let n: FakeNode | null = this; n !== null; n = n.parent) if (n.attrs.has(m[1]!)) return n;
    return null;
  }
  getBoundingClientRect(): { left: number; top: number } {
    return { left: this.left, top: this.top };
  }
  /** Node.contains: n が自分か子孫か（親をたどる） */
  contains(n: unknown): boolean {
    for (let x = n instanceof FakeNode ? n : null; x !== null; x = x.parent) if (x === this) return true;
    return false;
  }
  blur(): void {
    this.blurred++;
  }
}

export type EmitResult = { prevented: boolean };

export class FakeStage extends FakeNode {
  listeners: Record<string, Array<{ f: Listener; opt: unknown }>> = {};
  captured: number[] = [];
  constructor(left: number) {
    super("DIV");
    this.left = left;
  }
  addEventListener(t: string, f: Listener, opt?: unknown): void {
    (this.listeners[t] ??= []).push({ f, opt });
  }
  removeEventListener(t: string, f: Listener): void {
    this.listeners[t] = (this.listeners[t] ?? []).filter((x) => x.f !== f);
  }
  setPointerCapture(id: number): void {
    this.captured.push(id);
  }
  /** イベントを送る。preventDefault を呼んだかを返す */
  emit(t: string, e: object): EmitResult {
    const r: EmitResult = { prevented: false };
    const ev = {
      preventDefault() {
        r.prevented = true;
      },
      ...e,
    };
    for (const x of this.listeners[t] ?? []) (x.f as (e: object) => void)(ev);
    return r;
  }
  count(): number {
    return Object.values(this.listeners).reduce((n, l) => n + l.length, 0);
  }
}
