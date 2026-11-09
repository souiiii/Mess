import { JSDOM } from "jsdom";
import { vi } from "vitest";
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost:5173",
});
for (const name of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLDialogElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "HTMLSelectElement",
  "MutationObserver",
  "Node",
  "Event",
  "MouseEvent",
  "FormData",
])
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value: (dom.window as any)[name],
  });
globalThis.getComputedStyle = dom.window.getComputedStyle;
Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
  value() {
    this.setAttribute("open", "");
  },
});
Object.defineProperty(HTMLDialogElement.prototype, "close", {
  value() {
    this.removeAttribute("open");
  },
});
window.scrollTo = vi.fn();
