// @effect-diagnostics globalTimers:off - This browser and WebView transport runs without an Effect runtime.

import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { createCanvasFrameSink, type DeviceFrameSink } from "./frame.ts";
import { withDeviceHubQuery } from "./hubAccess.ts";
import type {
  DeviceScreenSize,
  DeviceStreamClient,
  DeviceStreamEvents,
  DeviceStreamTarget,
} from "./stream.ts";

/**
 * Limrun streams over WebRTC and takes input on a data channel, in the
 * scrcpy-style messages `@limrun/ui`'s RemoteControl sends. Signalling goes
 * through T3's device hub proxy, which adds the instance token upstream.
 */

const RETRY_DELAY_MS = 1_000;
const MAX_ATTEMPTS = 3;
const FIRST_FRAME_TIMEOUT_MS = 20_000;
const KEEP_ALIVE_MS = 10_000;
const FRAME_REQUEST_MS = 250;
const MOUSE_POINTER_ID = -10;

const CONTROL_KEYCODE = 0;
const CONTROL_TOUCH = 2;
const CONTROL_CLIPBOARD = 9;
const ACTION_DOWN = 0;
const ACTION_UP = 1;
const ACTION_MOVE = 2;
const BUTTON_PRIMARY = 1;

const SignalMessage = Schema.Struct({
  type: Schema.String,
  sdp: Schema.optional(Schema.String),
  candidate: Schema.optional(Schema.String),
  sdpMid: Schema.optional(Schema.NullOr(Schema.String)),
  sdpMLineIndex: Schema.optional(Schema.NullOr(Schema.Number)),
  rtcConfiguration: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.String),
});
const decodeSignal = Schema.decodeUnknownOption(Schema.fromJsonString(SignalMessage));
const encodeSignal = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

/** A touch at (x, y) in a width x height frame, in video pixels. */
export function encodeLimrunTouch(
  phase: "begin" | "move" | "end",
  x: number,
  y: number,
  width: number,
  height: number,
): ArrayBuffer {
  const buffer = new ArrayBuffer(32);
  const view = new DataView(buffer);
  const action = phase === "begin" ? ACTION_DOWN : phase === "move" ? ACTION_MOVE : ACTION_UP;
  view.setUint8(0, CONTROL_TOUCH);
  view.setUint8(1, action);
  view.setBigInt64(2, BigInt(MOUSE_POINTER_ID), true);
  view.setInt32(10, Math.round(x), true);
  view.setInt32(14, Math.round(y), true);
  view.setUint16(18, width, true);
  view.setUint16(20, height, true);
  view.setUint16(22, phase === "end" ? 0 : 0xffff, true);
  view.setInt32(24, BUTTON_PRIMARY, true);
  view.setInt32(28, phase === "end" ? 0 : BUTTON_PRIMARY, true);
  return buffer;
}

export function encodeLimrunKey(keycode: number, phase: "down" | "up", metaState = 0): ArrayBuffer {
  const buffer = new ArrayBuffer(14);
  const view = new DataView(buffer);
  view.setUint8(0, CONTROL_KEYCODE);
  view.setUint8(1, phase === "down" ? ACTION_DOWN : ACTION_UP);
  view.setInt32(2, keycode, true);
  view.setInt32(6, 0, true);
  view.setInt32(10, metaState, true);
  return buffer;
}

/** Sets the device clipboard and pastes it, which is how arbitrary text gets in. */
export function encodeLimrunPaste(text: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(text);
  const buffer = new ArrayBuffer(14 + bytes.length);
  const view = new DataView(buffer);
  view.setUint8(0, CONTROL_CLIPBOARD);
  view.setBigInt64(1, 0n, false);
  view.setUint8(9, 1);
  view.setUint32(10, bytes.length, false);
  new Uint8Array(buffer, 14).set(bytes);
  return buffer;
}

const KEYCODE_BY_CODE: Readonly<Record<string, number>> = {
  Space: 62,
  Enter: 66,
  NumpadEnter: 66,
  Backspace: 67,
  Delete: 112,
  Tab: 61,
  Escape: 111,
  ArrowUp: 19,
  ArrowDown: 20,
  ArrowLeft: 21,
  ArrowRight: 22,
  Home: 122,
  End: 123,
  PageUp: 92,
  PageDown: 93,
  Minus: 69,
  Equal: 70,
  BracketLeft: 71,
  BracketRight: 72,
  Backslash: 73,
  Semicolon: 74,
  Quote: 75,
  Slash: 76,
  Comma: 55,
  Period: 56,
  Backquote: 68,
  ShiftLeft: 59,
  ShiftRight: 60,
  AltLeft: 57,
  AltRight: 58,
  ControlLeft: 113,
  ControlRight: 114,
  MetaLeft: 117,
  MetaRight: 118,
};

/** Android key codes, which Limrun takes on both platforms. */
export function limrunKeyCode(code: string): number | null {
  if (/^Key[A-Z]$/.test(code)) return 29 + (code.charCodeAt(3) - 65);
  if (/^Digit[0-9]$/.test(code)) return 7 + (code.charCodeAt(5) - 48);
  return KEYCODE_BY_CODE[code] ?? null;
}

const metaState = (event: KeyboardEvent) =>
  (event.shiftKey ? 1 : 0) |
  (event.altKey ? 2 : 0) |
  (event.ctrlKey ? 4096 : 0) |
  (event.metaKey ? 65536 : 0);

const BUTTON_KEYCODES = { home: 3, back: 4, recents: 187, appSwitcher: 187, power: 26 } as const;
// iOS takes hardware buttons as named actions on the signalling socket, not key codes.
const IOS_BUTTONS: Partial<Record<keyof typeof BUTTON_KEYCODES, string>> = {
  home: "home",
  power: "lock",
};

export function createLimrunStreamClient(
  target: DeviceStreamTarget,
  output: HTMLCanvasElement | DeviceFrameSink,
  events: DeviceStreamEvents,
): DeviceStreamClient {
  const { access, platform, deviceId } = target;
  const sink = "present" in output ? output : createCanvasFrameSink(output);
  const signalingUrl = () =>
    withDeviceHubQuery(
      `${access.wsBase}/vendor/limrun/ws?device=${encodeURIComponent(deviceId)}`,
      access,
    );

  let stopped = true;
  let generation = 0;
  let attempts = 0;
  let socket: WebSocket | null = null;
  let peer: RTCPeerConnection | null = null;
  let control: RTCDataChannel | null = null;
  let video: HTMLVideoElement | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let frameTimer: ReturnType<typeof setTimeout> | null = null;
  let frameRequests: ReturnType<typeof setInterval> | null = null;
  let screen: DeviceScreenSize | null = null;
  let streaming = false;
  let buttonRequests = 0;
  const sessionId = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

  const send = (message: Record<string, unknown>) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(encodeSignal({ ...message, sessionId }));
  };
  const sendControl = (message: ArrayBuffer) => {
    if (control?.readyState === "open") control.send(message);
  };

  const stopFrameRequests = () => {
    if (frameRequests !== null) clearInterval(frameRequests);
    frameRequests = null;
  };

  const teardown = () => {
    stopFrameRequests();
    if (keepAlive !== null) clearInterval(keepAlive);
    if (retryTimer !== null) clearTimeout(retryTimer);
    if (frameTimer !== null) clearTimeout(frameTimer);
    keepAlive = retryTimer = frameTimer = null;
    control?.close();
    peer?.close();
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      socket.close();
    }
    if (video) {
      video.srcObject = null;
      video.remove();
    }
    control = peer = socket = video = null;
    streaming = false;
  };

  const fail = (detail: string) => {
    if (stopped) return;
    stop();
    events.onInputConnected(false, detail);
    events.onStatus("error", detail);
  };

  const retry = (detail: string) => {
    if (stopped) return;
    teardown();
    if (++attempts >= MAX_ATTEMPTS) return fail(detail);
    events.onInputConnected(false);
    events.onStatus("connecting", detail);
    retryTimer = setTimeout(connect, RETRY_DELAY_MS);
  };

  const paint = (source: HTMLVideoElement) => {
    const width = source.videoWidth;
    const height = source.videoHeight;
    if (width === 0 || height === 0) return;
    if (screen?.width !== width || screen.height !== height) {
      screen = { width, height, orientation: width > height ? "landscape_left" : "portrait" };
      events.onScreen(screen);
    }
    if (!sink.present(source, width, height)) {
      fail("Could not display the device stream. Reconnect to try again.");
      return;
    }
    if (!streaming) {
      streaming = true;
      attempts = 0;
      stopFrameRequests();
      if (frameTimer !== null) clearTimeout(frameTimer);
      frameTimer = null;
      events.onStatus("streaming");
    }
  };

  const startPeer = async (lifecycle: number, configuration: RTCConfiguration) => {
    const connection = new RTCPeerConnection({ ...configuration, iceTransportPolicy: "relay" });
    peer = connection;
    connection.addTransceiver("audio", { direction: "recvonly" });
    connection.addTransceiver("video", { direction: "recvonly" });
    // iOS instances also offer camera and microphone input; their answer expects these lines.
    if (platform === "ios") {
      connection.addTransceiver("video", { direction: "sendonly" });
      connection.addTransceiver("audio", { direction: "sendonly" });
    }
    const channel = connection.createDataChannel("control", {
      ordered: true,
      negotiated: true,
      id: 1,
    });
    control = channel;
    channel.binaryType = "arraybuffer";
    channel.onopen = () => {
      if (generation !== lifecycle) return;
      events.onInputConnected(true);
      // The instance sends no video until asked, and an ask can land before its encoder is up.
      send({ type: "requestFrame" });
      frameRequests = setInterval(() => send({ type: "requestFrame" }), FRAME_REQUEST_MS);
    };
    channel.onclose = () => {
      if (generation === lifecycle) events.onInputConnected(false);
    };

    // Frames only reach requestVideoFrameCallback from a video in the document; the sink paints them.
    const element = document.createElement("video");
    element.muted = true;
    element.playsInline = true;
    element.setAttribute("aria-hidden", "true");
    element.style.cssText =
      "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:0;top:0";
    document.body.append(element);
    video = element;
    const present = () => {
      if (generation !== lifecycle || video !== element) return;
      paint(element);
      element.requestVideoFrameCallback(present);
    };
    connection.ontrack = (event) => {
      if (generation !== lifecycle || event.track.kind !== "video") return;
      element.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      void element.play().catch(() => {});
      element.requestVideoFrameCallback(present);
    };
    connection.onicecandidate = (event) => {
      if (generation !== lifecycle || !event.candidate) return;
      send({
        type: "candidate",
        candidate: event.candidate.candidate,
        sdpMid: event.candidate.sdpMid,
        sdpMLineIndex: event.candidate.sdpMLineIndex,
      });
    };
    connection.onconnectionstatechange = () => {
      if (generation === lifecycle && connection.connectionState === "failed") {
        retry("Device stream connection failed. Reconnecting…");
      }
    };
    const offer = await connection.createOffer();
    if (generation !== lifecycle) return;
    await connection.setLocalDescription(offer);
    if (generation !== lifecycle) return;
    send({ type: "offer", sdp: offer.sdp });
  };

  const onSignal = async (lifecycle: number, raw: string) => {
    const message = decodeSignal(raw);
    if (Option.isNone(message) || generation !== lifecycle) return;
    const { value } = message;
    switch (value.type) {
      case "rtcConfiguration":
        return startPeer(lifecycle, (value.rtcConfiguration ?? {}) as RTCConfiguration);
      case "answer":
        if (peer && value.sdp) await peer.setRemoteDescription({ type: "answer", sdp: value.sdp });
        return;
      case "candidate":
        if (peer && value.candidate) {
          await peer.addIceCandidate({
            candidate: value.candidate,
            sdpMid: value.sdpMid ?? null,
            sdpMLineIndex: value.sdpMLineIndex ?? null,
          });
        }
        return;
      case "signalingError":
        return retry(value.error ?? "The device refused the stream.");
    }
  };

  function connect() {
    if (stopped) return;
    const lifecycle = ++generation;
    events.onStatus("connecting");
    if (typeof RTCPeerConnection === "undefined") {
      return fail("This browser cannot play the device stream (WebRTC is unavailable).");
    }
    frameTimer = setTimeout(
      () => retry("No video received from the device. Reconnecting…"),
      FIRST_FRAME_TIMEOUT_MS,
    );
    const ws = new WebSocket(signalingUrl());
    socket = ws;
    ws.onopen = () => {
      if (generation !== lifecycle) return;
      send({ type: "requestRtcConfiguration" });
      keepAlive = setInterval(() => send({ type: "keepAlive" }), KEEP_ALIVE_MS);
    };
    ws.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      onSignal(lifecycle, event.data).catch((cause: unknown) =>
        retry(cause instanceof Error ? cause.message : "Device stream failed. Reconnecting…"),
      );
    };
    ws.onclose = () => {
      if (generation !== lifecycle) return;
      // A refused ticket closes the socket before it opens; a fresh one starts a new session.
      if (!streaming && attempts === MAX_ATTEMPTS - 1) {
        stop();
        events.onInputConnected(false);
        events.onUnauthorized();
        return;
      }
      retry("Device stream disconnected. Reconnecting…");
    };
  }

  function stop() {
    stopped = true;
    generation++;
    teardown();
  }

  const touch = (phase: "begin" | "move" | "end", x: number, y: number) => {
    if (!screen) return;
    sendControl(
      encodeLimrunTouch(phase, x * screen.width, y * screen.height, screen.width, screen.height),
    );
  };

  const pressKey = (keycode: number) => {
    sendControl(encodeLimrunKey(keycode, "down"));
    sendControl(encodeLimrunKey(keycode, "up"));
  };

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      attempts = 0;
      connect();
    },
    stop,
    setMjpegImage() {},
    sendTouch: touch,
    sendRawTouch: touch,
    sendKey(event, phase) {
      const keycode = limrunKeyCode(event.code);
      if (keycode === null) return;
      sendControl(encodeLimrunKey(keycode, phase, metaState(event)));
    },
    sendText(text) {
      if (text.length > 0) sendControl(encodeLimrunPaste(text));
    },
    pressButton(button) {
      if (platform !== "ios") return pressKey(BUTTON_KEYCODES[button]);
      const name = IOS_BUTTONS[button];
      if (!name) return;
      send({
        type: "performActions",
        id: `t3-button-${++buttonRequests}`,
        actions: [
          { type: "buttonDown", button: name },
          { type: "buttonUp", button: name },
        ],
      });
    },
    rotate() {},
    setOrientation() {},
    controlDuo() {},
    setDuoPanels() {},
  };
}
