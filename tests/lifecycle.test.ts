// SV-41: ページが隠れたときの受け口（src/presenter/lifecycle.ts）。node の EventTarget で偽の document / window を作る。
import { describe, expect, test } from "vitest";
import { attachSaveOnHide } from "../src/presenter/lifecycle";

class FakeDoc extends EventTarget {
  visibilityState = "visible";
}

describe("SV-41 attachSaveOnHide", () => {
  test("SV-41 attachSaveOnHide: visibilitychange で visibilityState が hidden のときと pagehide で onHide、visible では呼ばない。戻り値で外す", () => {
    const doc = new FakeDoc();
    const win = new EventTarget();
    let n = 0;
    const off = attachSaveOnHide(doc, win, () => {
      n++;
    });
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(n).toBe(0); // visible
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(n).toBe(1);
    win.dispatchEvent(new Event("pagehide"));
    expect(n).toBe(2);
    off();
    doc.dispatchEvent(new Event("visibilitychange"));
    win.dispatchEvent(new Event("pagehide"));
    expect(n).toBe(2);
  });
});
