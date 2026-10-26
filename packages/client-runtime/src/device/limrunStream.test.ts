import { describe, expect, it } from "vite-plus/test";

import {
  encodeLimrunKey,
  encodeLimrunPaste,
  encodeLimrunTouch,
  limrunKeyCode,
} from "./limrunStream.ts";

describe("Limrun control messages", () => {
  it("encodes a touch the way RemoteControl does", () => {
    const view = new DataView(encodeLimrunTouch("begin", 100.4, 200.6, 720, 1616));
    expect(view.byteLength).toBe(32);
    expect(view.getUint8(0)).toBe(2);
    expect(view.getUint8(1)).toBe(0);
    expect(view.getBigInt64(2, true)).toBe(-10n);
    expect(view.getInt32(10, true)).toBe(100);
    expect(view.getInt32(14, true)).toBe(201);
    expect(view.getUint16(18, true)).toBe(720);
    expect(view.getUint16(20, true)).toBe(1616);
    expect(view.getUint16(22, true)).toBe(0xffff);
    expect(view.getInt32(24, true)).toBe(1);
    expect(view.getInt32(28, true)).toBe(1);

    const up = new DataView(encodeLimrunTouch("end", 1, 2, 720, 1616));
    expect(up.getUint8(1)).toBe(1);
    expect(up.getUint16(22, true)).toBe(0);
    expect(up.getInt32(28, true)).toBe(0);
    expect(new DataView(encodeLimrunTouch("move", 1, 2, 720, 1616)).getUint8(1)).toBe(2);
  });

  it("encodes keys with Android key codes and modifiers", () => {
    const view = new DataView(encodeLimrunKey(limrunKeyCode("KeyA")!, "down", 1));
    expect(view.byteLength).toBe(14);
    expect([view.getUint8(0), view.getUint8(1)]).toEqual([0, 0]);
    expect(view.getInt32(2, true)).toBe(29);
    expect(view.getInt32(10, true)).toBe(1);
    expect(limrunKeyCode("Digit0")).toBe(7);
    expect(limrunKeyCode("Digit9")).toBe(16);
    expect(limrunKeyCode("Backspace")).toBe(67);
    expect(limrunKeyCode("F13")).toBeNull();
  });

  it("pastes text through the clipboard message", () => {
    const buffer = encodeLimrunPaste("čau");
    const view = new DataView(buffer);
    expect(view.getUint8(0)).toBe(9);
    expect(view.getUint8(9)).toBe(1);
    expect(view.getUint32(10, false)).toBe(4);
    expect(new TextDecoder().decode(new Uint8Array(buffer, 14))).toBe("čau");
  });
});
