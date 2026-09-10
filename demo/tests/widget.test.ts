import { expect, it, vi } from "vitest";
vi.mock("@deck.gl/core", () => ({ Widget: class { updateHTML() {} } }));
import { ThorWidget } from "../../src/ThorWidget";
it("reattaches its canvas when deck.gl recreates the widget root after restart", () => {
  const canvas = { style: {}, parentElement: null as unknown, getBoundingClientRect: () => ({ width: 640, height: 480 }), getContext: () => null };
  vi.stubGlobal("document", { createElement: () => canvas });
  vi.stubGlobal("window", { devicePixelRatio: 1 });
  const makeRoot = () => ({ style: {}, appendChild: vi.fn(function (this: unknown, child: typeof canvas) { child.parentElement = this; }) });
  const first = makeRoot(), second = makeRoot();
  const widget = new ThorWidget();
  widget.onRenderHTML(first as unknown as HTMLElement);
  widget.onRenderHTML(second as unknown as HTMLElement);
  expect(first.appendChild).toHaveBeenCalledOnce(); expect(second.appendChild).toHaveBeenCalledOnce();
  expect(canvas.parentElement).toBe(second);
  vi.unstubAllGlobals();
});
