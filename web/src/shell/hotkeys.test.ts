import { describe, expect, it } from "vitest";
import { isTyping, matchesHotkey } from "./hotkeys";

const key = (k: string, mods: Partial<KeyboardEventInit> = {}, code?: string) =>
  new KeyboardEvent("keydown", { key: k, code, ...mods });

describe("matchesHotkey", () => {
  it("'mod' accepts both ⌘ and Ctrl", () => {
    expect(matchesHotkey(key("k", { metaKey: true }), "mod+k")).toBe(true);
    expect(matchesHotkey(key("k", { ctrlKey: true }), "mod+k")).toBe(true);
    expect(matchesHotkey(key("k"), "mod+k")).toBe(false);
  });
  it("a bare key does not fire with a modifier held", () => {
    expect(matchesHotkey(key("c"), "c")).toBe(true);
    expect(matchesHotkey(key("c", { metaKey: true }), "c")).toBe(false);
    expect(matchesHotkey(key("C", { shiftKey: true }), "c")).toBe(false);
    expect(matchesHotkey(key("X", { shiftKey: true }), "shift+x")).toBe(true);
  });
  it("digits match by key code, whatever the layout produces", () => {
    expect(matchesHotkey(key("&", { ctrlKey: true }, "Digit1"), "mod+1")).toBe(true);
    expect(matchesHotkey(key("2", { ctrlKey: true }, "Digit2"), "mod+1")).toBe(false);
  });
});

describe("isTyping", () => {
  it("is true in inputs, textareas and editable elements", () => {
    expect(isTyping(document.createElement("input"))).toBe(true);
    expect(isTyping(document.createElement("textarea"))).toBe(true);
    expect(isTyping(document.createElement("button"))).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
});
