/**
 * Cloud iOS Simulators and Android Emulators from Limrun. Every instance bills
 * until it ends, so this host bounds each one, deletes them all when it stops,
 * and deletes leftovers labelled with this server and host, never others.
 */
import {
  DeviceBootError,
  type DeviceHostSummary,
  DeviceHostUnavailableError,
  DeviceOperationError,
  type DevicePlatform,
  type LimrunDeviceHostConfig,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as FiberSet from "effect/FiberSet";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Random from "effect/Random";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { HttpClient } from "effect/http";
import * as Socket from "effect/socket/Socket";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { resolveNodeExecutable } from "@t3tools/shared/nodeRuntime";

import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as DeviceHost from "./DeviceHost.ts";
import { ensureAgentDevice } from "./DeviceToolchain.ts";
import { androidSdk, deviceHostEnvironment } from "./LocalDeviceHost.ts";
import {
  type LimrunApi,
  type LimrunInstance,
  makeLimrunApi,
  resolveLimrunCredential,
} from "./LimrunApi.ts";

export const LIMRUN_STREAM_PATH = "/vendor/limrun/ws";
export const LIMRUN_SCREENSHOT_PATH = "/vendor/limrun/screenshot";
const OWNER_LABEL = "t3-code-host";
// How stale a running instance's state may get before listing rechecks it.
const STATUS_TTL_MS = 15_000;
// How often listing looks for labelled instances this host does not track.
const REAP_INTERVAL_MS = 60_000;
const DAEMON_TIMEOUT = Duration.seconds(30);
const SCREENSHOT_TIMEOUT = Duration.seconds(20);

const CATALOG: ReadonlyArray<DeviceHost.HostDevice> = [
  {
    id: "limrun-ios",
    platform: "ios",
    name: "iPhone (Limrun)",
    version: "Cloud",
    booted: false,
    physical: false,
  },
  {
    id: "limrun-android",
    platform: "android",
    name: "Android (Limrun)",
    version: "Cloud",
    booted: false,
    physical: false,
  },
];

const DaemonFile = Schema.Struct({ httpPort: Schema.Int, token: Schema.String });
const decodeDaemonFile = Schema.decodeUnknownEffect(Schema.fromJsonString(DaemonFile));
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const ScreenshotMessage = Schema.Struct({
  type: Schema.String,
  id: Schema.optional(Schema.String),
  base64: Schema.optional(Schema.String),
  dataUri: Schema.optional(Schema.String),
  payload: Schema.optional(Schema.Struct({ dataUri: Schema.optional(Schema.String) })),
  message: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
});
const decodeScreenshotMessage = Schema.decodeUnknownOption(
  Schema.fromJsonString(ScreenshotMessage),
);

interface AgentDaemon {
  readonly dir: string;
  readonly baseUrl: string;
  readonly token: string;
  /** Set once `connect limrun` has bound the instance's agent session. */
  connected: boolean;
}

interface RunningInstance {
  readonly instance: LimrunInstance & {
    readonly endpoints: NonNullable<LimrunInstance["endpoints"]>;
  };
  daemon: AgentDaemon | null;
  /** Set once a delete has been asked for but Limrun has not confirmed it. */
  stopping: boolean;
}

/** The instance's request socket: `/signaling` on iOS, `/ws` on Android. */
const limrunRequestUrl = (platform: DevicePlatform, apiUrl: string, token: string): string => {
  const url = new URL(apiUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/${platform === "ios" ? "signaling" : "ws"}`;
  url.search = "";
  url.searchParams.set("token", token);
  return url.toString();
};

/** Screenshot answers carry base64, bare or as a data URI. */
const screenshotBytes = (dataUriOrBase64: string): Uint8Array => {
  const base64 = dataUriOrBase64.startsWith("data:")
    ? dataUriOrBase64.slice(dataUriOrBase64.indexOf(",") + 1)
    : dataUriOrBase64;
  return Uint8Array.from(Buffer.from(base64, "base64"));
};

export const make = Effect.fn("LimrunDeviceHost.make")(function* (config: LimrunDeviceHostConfig) {
  const http = yield* HttpClient.HttpClient;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const server = yield* ServerConfig.ServerConfig;
  const runner = yield* ProcessRunner.ProcessRunner;
  const crypto = yield* Crypto.Crypto;
  // agent-device reaches Limrun's Android emulators through a local adb.
  const sdk = yield* androidSdk;
  const environment = deviceHostEnvironment(
    yield* HostProcess.Environment,
    sdk.root,
    yield* HostProcess.Platform,
    path,
  );
  const services = yield* Effect.context<
    | FileSystem.FileSystem
    | Path.Path
    | ProcessRunner.ProcessRunner
    | Effect.Services<ReturnType<typeof resolveLimrunCredential>>
    | Effect.Services<ReturnType<typeof resolveNodeExecutable>>
  >();
  const hostId = config.id;
  const hostDir = path.join(server.stateDir, "device", "limrun", hostId);
  // A server and host of its own, so two servers on one Limrun account never reap each other's.
  const serverId = (yield* fs
    .readFileString(server.environmentIdPath)
    .pipe(Effect.orElseSucceed(() => server.stateDir))).trim();
  const owner = Hex.encode(
    yield* crypto
      .digest("SHA-256", new TextEncoder().encode(`${serverId}\u0000${hostId}`))
      .pipe(Effect.orDie),
  ).slice(0, 32);
  const labels = { [OWNER_LABEL]: owner };

  const instances = new Map<string, RunningInstance>();
  const checkedAt = new Map<string, number>();
  // Creates in flight, by the nonce label each carries, so the reaper leaves them alone.
  const starting = new Set<string>();
  const startLock = yield* Semaphore.make(1);
  const reapLock = yield* Semaphore.make(1);
  const daemonLock = yield* Semaphore.make(1);
  const background = yield* FiberSet.make<void, never>();
  let reapedAt = 0;
  let closed = false;
  let ready: DeviceHost.DeviceHostReady | null = null;

  const unavailable = (reason: string, cause?: unknown) =>
    new DeviceHostUnavailableError({
      hostId,
      hostLabel: config.label,
      reason,
      ...(cause === undefined ? {} : { cause }),
    });

  const credential = resolveLimrunCredential(config.apiKey).pipe(
    Effect.provide(services),
    Effect.mapError((error) => unavailable(error.message, error)),
  );
  const api: Effect.Effect<LimrunApi, DeviceHostUnavailableError> = credential.pipe(
    Effect.map((resolved) => makeLimrunApi(http, resolved)),
  );

  const agentTool = ensureAgentDevice(server.baseDir).pipe(
    Effect.provide(services),
    Effect.mapError((cause) => unavailable("Could not install agent-device.", cause)),
  );
  const nodePath = resolveNodeExecutable("Device automation").pipe(
    Effect.provide(services),
    Effect.mapError((cause) => unavailable(cause.message, cause)),
  );

  /**
   * agent-device reaches an instance it did not create through these, and never
   * deletes it. The API key only uploads apps; it stays in the daemon, which
   * agents reach over HTTP without seeing its environment.
   */
  const instanceEnvironment = (
    running: RunningInstance,
    apiKey: Redacted.Redacted<string>,
  ): NodeJS.ProcessEnv => {
    const { instance } = running;
    const prefix = instance.platform === "ios" ? "LIM_IOS_INSTANCE" : "LIM_ANDROID_INSTANCE";
    const { LIM_API_KEY: _key, ...rest } = environment;
    return {
      ...rest,
      LIMRUN_API_KEY: Redacted.value(apiKey),
      [`${prefix}_URL`]: instance.endpoints.apiUrl,
      [`${prefix}_TOKEN`]: Redacted.value(instance.endpoints.token),
      ...(instance.platform === "android" && instance.endpoints.adbWebSocketUrl
        ? { LIM_ANDROID_INSTANCE_ADB_URL: instance.endpoints.adbWebSocketUrl }
        : {}),
      AGENT_DEVICE_NO_UPDATE_NOTIFIER: "1",
      ELECTRON_RUN_AS_NODE: "1",
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    };
  };

  const runAgentDevice = Effect.fn("LimrunDeviceHost.runAgentDevice")(function* (
    running: RunningInstance,
    args: ReadonlyArray<string>,
    extra: NodeJS.ProcessEnv = {},
  ) {
    const tool = yield* agentTool;
    const node = yield* nodePath;
    const { apiKey } = yield* credential;
    return yield* runner
      .run({
        command: node,
        args: [tool.entryPath, ...args],
        env: { ...instanceEnvironment(running, apiKey), ...extra },
        timeout: DAEMON_TIMEOUT,
        timeoutBehavior: "timedOutResult",
      })
      .pipe(Effect.mapError((cause) => unavailable("agent-device could not run.", cause)));
  });

  /** One HTTP daemon per instance: it keeps the instance credentials it started with. */
  const ensureDaemon = (running: RunningInstance) =>
    daemonLock.withPermit(
      Effect.gen(function* () {
        if (running.daemon) return running.daemon;
        const dir = path.join(hostDir, running.instance.id);
        const daemonDir = path.join(dir, "daemon");
        yield* fs
          .makeDirectory(daemonDir, { recursive: true })
          .pipe(Effect.mapError((cause) => unavailable("Could not prepare agent tools.", cause)));
        // No `daemon start` exists; `devices` is the cheapest command that starts and awaits it.
        yield* runAgentDevice(running, ["devices", "--json"], {
          AGENT_DEVICE_STATE_DIR: daemonDir,
          AGENT_DEVICE_DAEMON_SERVER_MODE: "http",
          // The instance's own limits end it; the daemon goes with it.
          AGENT_DEVICE_DAEMON_IDLE_TIMEOUT_MS: "0",
        });
        const file = yield* fs.readFileString(path.join(daemonDir, "daemon.json")).pipe(
          Effect.flatMap(decodeDaemonFile),
          Effect.mapError((cause) => unavailable("agent-device did not start.", cause)),
        );
        const daemon: AgentDaemon = {
          dir,
          baseUrl: `http://127.0.0.1:${file.httpPort}`,
          token: file.token,
          connected: false,
        };
        running.daemon = daemon;
        return daemon;
      }),
    );

  const agentSession = (running: RunningInstance) => `t3-limrun-${running.instance.id}`;

  /** Binds the instance's one agent session; agents need no credential of their own. */
  const ensureSession = Effect.fn("LimrunDeviceHost.ensureSession")(function* (
    running: RunningInstance,
  ) {
    if (running.instance.platform === "android" && !sdk.adb) {
      return yield* unavailable(
        "Agents drive Limrun Android emulators through adb. Install the Android SDK Platform-Tools on this environment's machine, or set ANDROID_HOME.",
      );
    }
    const daemon = yield* ensureDaemon(running);
    if (daemon.connected) return daemon;
    const connectConfig = path.join(daemon.dir, "connect.json");
    yield* fs
      .writeFileString(
        connectConfig,
        encodeJson({ daemonBaseUrl: daemon.baseUrl, daemonAuthToken: daemon.token }),
        { mode: 0o600 },
      )
      .pipe(Effect.mapError((cause) => unavailable("Could not prepare agent tools.", cause)));
    const result = yield* runAgentDevice(running, [
      "connect",
      "limrun",
      "--platform",
      running.instance.platform,
      "--config",
      connectConfig,
      "--state-dir",
      path.join(daemon.dir, "client"),
      "--session",
      agentSession(running),
      "--json",
    ]);
    if (result.code !== 0) {
      return yield* unavailable("agent-device could not connect to the Limrun instance.", result);
    }
    daemon.connected = true;
    return daemon;
  });

  const stopDaemon = Effect.fn("LimrunDeviceHost.stopDaemon")(function* (running: RunningInstance) {
    const daemon = running.daemon;
    running.daemon = null;
    if (!daemon) return;
    yield* runAgentDevice(running, [
      "daemon",
      "stop",
      "--state-dir",
      path.join(daemon.dir, "daemon"),
    ]).pipe(Effect.ignore);
    yield* fs.remove(daemon.dir, { recursive: true, force: true }).pipe(Effect.ignore);
  });

  const forget = (running: RunningInstance) =>
    stopDaemon(running).pipe(
      Effect.andThen(
        Effect.sync(() => {
          instances.delete(running.instance.id);
          checkedAt.delete(running.instance.id);
        }),
      ),
    );

  /** Deletes a tracked instance. Until Limrun confirms, it stays tracked and counted. */
  const stopTracked = (limrun: LimrunApi, running: RunningInstance) =>
    Effect.suspend(() => {
      running.stopping = true;
      return limrun.delete(running.instance.platform, running.instance.id);
    }).pipe(Effect.andThen(forget(running)));

  /** Deletes labelled instances this host does not track: a previous server's, or a failed start's. */
  const reapLeftovers = Effect.fn("LimrunDeviceHost.reapLeftovers")(
    function* (limrun: LimrunApi) {
      if (closed) return;
      reapedAt = yield* Clock.currentTimeMillis;
      for (const platform of ["ios", "android"] as const) {
        const listed = yield* limrun.list(platform, labels);
        yield* Effect.forEach(
          listed.filter(
            (instance) =>
              !instances.has(instance.id) && !starting.has(instance.labels["t3-code-start"] ?? ""),
          ),
          (instance) => limrun.delete(platform, instance.id).pipe(Effect.ignore),
          { discard: true, concurrency: 4 },
        );
      }
    },
    reapLock.withPermit,
    Effect.catch((cause) =>
      Effect.logWarning("Could not delete leftover Limrun instances", { cause }),
    ),
  );

  /** Limrun ends instances at their limits on its own; stop listing those. */
  const dropEnded = Effect.gen(function* () {
    if (closed) return;
    const now = yield* Clock.currentTimeMillis;
    const stale = [...instances.values()].filter(
      (running) =>
        running.stopping || now - (checkedAt.get(running.instance.id) ?? 0) > STATUS_TTL_MS,
    );
    const reapDue = now - reapedAt > REAP_INTERVAL_MS;
    if (stale.length === 0 && !reapDue) return;
    const limrun = yield* api;
    yield* Effect.forEach(
      stale,
      (running) =>
        (running.stopping
          ? stopTracked(limrun, running)
          : limrun
              .get(running.instance.platform, running.instance.id)
              .pipe(
                Effect.flatMap((current) =>
                  Option.isNone(current) || current.value.state === "terminated"
                    ? forget(running)
                    : Effect.sync(() => void checkedAt.set(running.instance.id, now)),
                ),
              )
        ).pipe(Effect.ignore),
      { discard: true, concurrency: 4 },
    );
    if (reapDue) yield* reapLeftovers(limrun);
  }).pipe(Effect.ignore);

  const reserveSlot = (nonce: string) =>
    startLock.withPermit(
      Effect.suspend(() => {
        if (instances.size + starting.size >= config.maxConcurrentSessions) {
          return Effect.fail(
            unavailable(
              `${config.label} is limited to ${config.maxConcurrentSessions} running ${config.maxConcurrentSessions === 1 ? "device" : "devices"}. Close one in the Device panel first.`,
            ),
          );
        }
        starting.add(nonce);
        return Effect.void;
      }),
    );

  const startInstance = Effect.fn("LimrunDeviceHost.startInstance")(function* (
    device: DeviceHost.HostDevice,
  ) {
    const limrun = yield* api;
    const nonce = (yield* Random.nextIntBetween(0, 0xffffff)).toString(16).padStart(6, "0");
    return yield* Effect.acquireUseRelease(
      reserveSlot(nonce),
      () =>
        // A create Limrun answered is tracked or deleted before anything can interrupt it.
        Effect.uninterruptible(
          Effect.gen(function* () {
            const instance = yield* limrun
              .create({
                platform: device.platform,
                displayName: `T3 Code · ${config.label}`,
                labels: { ...labels, "t3-code-start": nonce },
                hardTimeoutMinutes: config.maxSessionMinutes,
                inactivityTimeoutMinutes: config.idleMinutes,
                jurisdiction: config.jurisdiction,
              })
              .pipe(Effect.mapError((error) => unavailable(error.message, error)));
            if (closed) {
              yield* limrun.delete(device.platform, instance.id).pipe(Effect.ignore);
              return yield* unavailable(`${config.label} was stopped while the device started.`);
            }
            const endpoints = instance.endpoints;
            if (!endpoints) {
              yield* limrun.delete(device.platform, instance.id).pipe(Effect.ignore);
              return yield* new DeviceBootError({
                hostId,
                deviceId: instance.id,
                reason: "launch_failed",
                cause: new Error(
                  instance.errorMessage ?? `Limrun instance is ${instance.state}, not ready`,
                ),
              });
            }
            instances.set(instance.id, {
              instance: { ...instance, endpoints },
              daemon: null,
              stopping: false,
            });
            checkedAt.set(instance.id, yield* Clock.currentTimeMillis);
            return instance.id;
          }),
        ),
      () => Effect.sync(() => void starting.delete(nonce)),
    );
  });

  const runningFor = (deviceId: string) => Option.fromNullishOr(instances.get(deviceId));

  const screenshot = (running: RunningInstance) =>
    Effect.scoped(
      Effect.gen(function* () {
        const socket = yield* Socket.makeWebSocket(
          limrunRequestUrl(
            running.instance.platform,
            running.instance.endpoints.apiUrl,
            Redacted.value(running.instance.endpoints.token),
          ),
          { openTimeout: "10 seconds" },
        );
        const write = yield* socket.writer;
        const { pull } = yield* socket.reader;
        const id = `t3-${(yield* Random.nextIntBetween(0, 0xffffff)).toString(16)}`;
        yield* write.write(
          encodeJson({
            type: "screenshot",
            id,
            ...(running.instance.platform === "ios" ? { format: "png", size: "full" } : {}),
          }),
        );
        for (;;) {
          for (const chunk of yield* pull) {
            const text = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
            const message = decodeScreenshotMessage(text);
            if (Option.isNone(message) || message.value.id !== id) continue;
            const { value } = message;
            const image = value.base64 ?? value.dataUri ?? value.payload?.dataUri;
            if (image) return screenshotBytes(image);
            return yield* new DeviceOperationError({
              operation: "screenshot",
              reason: "request_failed",
              cause: value.message ?? value.error ?? value.type,
            });
          }
        }
      }),
    ).pipe(
      Effect.provide(NodeSocket.layerWebSocketConstructor),
      Effect.timeout(SCREENSHOT_TIMEOUT),
      Effect.mapError(
        (cause) =>
          new DeviceOperationError({ operation: "screenshot", reason: "request_failed", cause }),
      ),
    );

  const devices: DeviceHost.DeviceOperations = {
    list: dropEnded.pipe(
      Effect.andThen(
        Effect.sync(() => ({
          devices: [
            ...CATALOG,
            ...[...instances.values()].map(({ instance }): DeviceHost.HostDevice => ({
              id: instance.id,
              platform: instance.platform,
              name: instance.platform === "ios" ? "iPhone (Limrun)" : "Android (Limrun)",
              version: "Cloud",
              booted: true,
              physical: false,
            })),
          ],
          detail: undefined,
        })),
      ),
    ),
    boot: (device) =>
      instances.has(device.id) ? Effect.succeed(device.id) : startInstance(device),
    attach: () => Effect.void,
    shutdown: (device) =>
      Option.match(runningFor(device.id), {
        onNone: () => Effect.void,
        onSome: (running) =>
          api.pipe(
            Effect.flatMap((limrun) => stopTracked(limrun, running)),
            Effect.mapError(
              (cause) =>
                new DeviceOperationError({
                  operation: "shutdown",
                  reason: "request_failed",
                  cause,
                }),
            ),
          ),
      }),
    screenshot: (device) =>
      Option.match(runningFor(device.id), {
        onNone: () =>
          Effect.fail(
            new DeviceOperationError({
              operation: "screenshot",
              reason: "request_failed",
              cause: new Error("The Limrun device is not running"),
            }),
          ),
        onSome: screenshot,
      }),
    agentEndpoint: (deviceId) =>
      Option.match(runningFor(deviceId), {
        onNone: () => Effect.fail(unavailable("This Limrun device is no longer running.")),
        onSome: (running) =>
          ensureSession(running).pipe(
            // agent-device picks the instance from the session; device selectors would conflict.
            Effect.map((daemon) => ({
              baseUrl: daemon.baseUrl,
              token: daemon.token,
              stateDir: path.join(daemon.dir, "client"),
              agentDeviceId: null,
              session: agentSession(running),
            })),
          ),
      }),
    endsDevices: true,
  };

  /** The viewer's signalling socket, with the instance token added here so clients never hold it. */
  const upstream: NonNullable<DeviceHost.DeviceHostReady["upstream"]> = (hubPath, search) =>
    Effect.sync(() => {
      if (hubPath !== LIMRUN_STREAM_PATH) return null;
      const running = instances.get(search.get("device") ?? "");
      if (!running) return null;
      const url = new URL(running.instance.endpoints.webSocketUrl);
      url.searchParams.set("token", Redacted.value(running.instance.endpoints.token));
      return { url: url.toString(), headers: {}, protocols: [] };
    });

  const executablePath = yield* HostProcess.ExecutablePath;
  const ensureReady: DeviceHost.DeviceHost["Service"]["ensureReady"] = Effect.fn(
    "LimrunDeviceHost.ensureReady",
  )(function* () {
    if (ready) return ready;
    // Without a credential the host is still ready: opening a device then says how to sign in.
    yield* FiberSet.run(background)(api.pipe(Effect.flatMap(reapLeftovers), Effect.ignore));
    ready = {
      nodePath: executablePath,
      hub: { origin: "https://api.limrun.com" },
      devices,
      upstream,
      run: () =>
        Effect.succeed({
          stdout: "",
          stderr: "Limrun devices cannot run host commands.",
          code: 127,
        }),
      helpers: { serveSimAxSettings: null, serveSimCli: null },
    };
    return ready;
  });

  // Every running instance is billed, so stopping the host deletes them all.
  const stopAll = Effect.gen(function* () {
    yield* FiberSet.clear(background);
    const limrun = yield* api;
    yield* Effect.forEach(
      [...instances.values()],
      (running) => stopTracked(limrun, running).pipe(Effect.ignore),
      { discard: true, concurrency: 4 },
    );
    yield* reapLeftovers(limrun);
  }).pipe(Effect.ignore);
  yield* Effect.addFinalizer(() =>
    stopAll.pipe(
      Effect.andThen(
        Effect.sync(() => {
          closed = true;
        }),
      ),
    ),
  );

  const platformAvailability = (platform: DevicePlatform) =>
    Effect.succeed({ platform, available: true });

  const summary: Effect.Effect<DeviceHostSummary> = Effect.all([
    platformAvailability("ios"),
    platformAvailability("android"),
  ]).pipe(
    Effect.map((platforms) => ({
      id: hostId,
      label: config.label,
      kind: "limrun" as const,
      platforms,
      // The device runs in Limrun; agent-device installs on first agent use.
      hubInstalled: true,
      agentDeviceInstalled: true,
    })),
  );

  return DeviceHost.DeviceHost.of({
    id: hostId,
    label: config.label,
    summary,
    platformAvailability,
    ensureReady,
    ensureAgentReady: Effect.fn("DeviceHost.ensureAgentReady")(function (onPhase) {
      return ensureReady(onPhase).pipe(Effect.map((value) => ({ ...value, agentDevice: null })));
    }),
    current: Effect.sync(() => ready),
    stopAgent: Effect.forEach([...instances.values()], stopDaemon, { discard: true }),
    stop: stopAll,
  });
});
