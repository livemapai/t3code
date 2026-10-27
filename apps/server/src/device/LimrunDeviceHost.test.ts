import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import type { LimrunDeviceHostConfig } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import { makeLimrunApi, readLimLoginKey } from "./LimrunApi.ts";
import * as LimrunDeviceHost from "./LimrunDeviceHost.ts";

const config = (overrides: Partial<LimrunDeviceHostConfig> = {}): LimrunDeviceHostConfig => ({
  kind: "limrun",
  id: "limrun",
  label: "Limrun",
  apiKey: "lim-key",
  jurisdiction: "eu",
  maxSessionMinutes: 25,
  idleMinutes: 5,
  maxConcurrentSessions: 2,
  ...overrides,
});

interface FakeInstance {
  readonly id: string;
  readonly platform: "ios" | "android";
  readonly labels: Record<string, string>;
  state: string;
}

const wire = (instance: FakeInstance) => ({
  metadata: { id: instance.id, labels: instance.labels },
  status: {
    state: instance.state,
    token: `token-${instance.id}`,
    apiUrl: `https://${instance.id}.limrun.test/api`,
    endpointWebSocketUrl: `wss://${instance.id}.limrun.test/endpointWebSocket`,
    ...(instance.platform === "android"
      ? { adbWebSocketUrl: `wss://${instance.id}.limrun.test/adb` }
      : {}),
  },
});

/** Limrun's REST API, recording what was asked of it. */
const fakeLimrun = (options: { readonly leftovers?: ReadonlyArray<FakeInstance> } = {}) => {
  const instances = new Map<string, FakeInstance>(
    (options.leftovers ?? []).map((instance) => [instance.id, instance]),
  );
  const created: Array<Record<string, unknown>> = [];
  const deleted: Array<string> = [];
  let next = 0;
  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      expect(request.headers.authorization).toBe("Bearer lim-key");
      const url = new URL(request.url);
      const match = /^\/v1\/(ios|android)_instances(?:\/([^/]+))?$/.exec(url.pathname);
      if (!match) return HttpClientResponse.fromWeb(request, new Response("", { status: 404 }));
      const platform = match[1] as "ios" | "android";
      const id = match[2];
      if (request.method === "POST") {
        const body = JSON.parse(
          new TextDecoder().decode(
            request.body._tag === "Uint8Array" ? request.body.body : new Uint8Array(),
          ),
        ) as { metadata: { labels: Record<string, string> } };
        created.push({ platform, query: url.searchParams.get("wait"), ...body });
        const instance: FakeInstance = {
          id: `${platform}_${++next}`,
          platform,
          labels: body.metadata.labels,
          state: "ready",
        };
        instances.set(instance.id, instance);
        return HttpClientResponse.fromWeb(request, Response.json(wire(instance)));
      }
      if (request.method === "DELETE" && id) {
        deleted.push(id);
        const instance = instances.get(id);
        if (instance) instance.state = "terminated";
        return HttpClientResponse.fromWeb(request, Response.json({}));
      }
      if (id) {
        const instance = instances.get(id);
        return instance
          ? HttpClientResponse.fromWeb(request, Response.json(wire(instance)))
          : HttpClientResponse.fromWeb(request, new Response("", { status: 404 }));
      }
      const selector = Object.fromEntries(
        (url.searchParams.get("labelSelector") ?? "")
          .split(",")
          .filter(Boolean)
          .map((pair) => pair.split("=") as [string, string]),
      );
      return HttpClientResponse.fromWeb(
        request,
        Response.json(
          [...instances.values()]
            .filter(
              (instance) =>
                instance.platform === platform &&
                Object.entries(selector).every(([key, value]) => instance.labels[key] === value),
            )
            .map(wire),
        ),
      );
    }),
  );
  return { http, instances, created, deleted };
};

const layer = Layer.mergeAll(
  ProcessRunner.layer,
  ServerConfig.layerTest(process.cwd(), { prefix: "t3-limrun-host-" }),
).pipe(Layer.provideMerge(NodeServices.layer));

const makeHost = (
  limrun: ReturnType<typeof fakeLimrun>,
  hostConfig: LimrunDeviceHostConfig,
  scope: Scope.Scope,
) =>
  LimrunDeviceHost.make(hostConfig).pipe(
    Effect.provideService(HttpClient.HttpClient, limrun.http),
    Effect.provideService(Scope.Scope, scope),
  );

describe("Limrun host", () => {
  it.effect("starts a bounded, labelled instance and routes its stream to it", () =>
    Effect.gen(function* () {
      const limrun = fakeLimrun();
      const scope = yield* Scope.make();
      const host = yield* makeHost(limrun, config(), scope);
      const ready = yield* host.ensureReady(() => Effect.void);
      const catalog = (yield* ready.devices.list).devices;
      expect(catalog.map((device) => [device.id, device.platform, device.booted])).toEqual([
        ["limrun-ios", "ios", false],
        ["limrun-android", "android", false],
      ]);

      const id = yield* ready.devices.boot(catalog[1]!);
      expect(id).toBe("android_1");
      expect(limrun.created).toHaveLength(1);
      const create = limrun.created[0] as {
        query: string;
        metadata: { labels: Record<string, string> };
        spec: Record<string, unknown>;
      };
      expect(create.query).toBe("true");
      expect(create.spec).toEqual({
        hardTimeout: "25m",
        inactivityTimeout: "5m",
        jurisdiction: "eu",
      });
      expect(Object.keys(create.metadata.labels).toSorted()).toEqual([
        "t3-code-host",
        "t3-code-start",
      ]);
      const listed = (yield* ready.devices.list).devices;
      expect(listed.find((device) => device.id === id)?.booted).toBe(true);

      // The client never holds the instance token: the proxy adds it upstream.
      const routed = yield* ready.upstream!(
        LimrunDeviceHost.LIMRUN_STREAM_PATH,
        new URLSearchParams({ device: id }),
      );
      expect(routed?.url).toBe(
        "wss://android_1.limrun.test/endpointWebSocket?token=token-android_1",
      );
      expect(
        yield* ready.upstream!("/vendor/serve-sim/api", new URLSearchParams({ device: id })),
      ).toBeNull();
      expect(
        yield* ready.upstream!(
          LimrunDeviceHost.LIMRUN_STREAM_PATH,
          new URLSearchParams({ device: "someone-else" }),
        ),
      ).toBeNull();

      yield* ready.devices.shutdown({ id, platform: "android" });
      expect(limrun.deleted).toEqual([id]);
      expect((yield* ready.devices.list).devices.map((device) => device.id)).toEqual([
        "limrun-ios",
        "limrun-android",
      ]);
      yield* Scope.close(scope, Exit.void);
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect("refuses a start past its limit without creating anything", () =>
    Effect.gen(function* () {
      const limrun = fakeLimrun();
      const scope = yield* Scope.make();
      const host = yield* makeHost(limrun, config({ maxConcurrentSessions: 1 }), scope);
      const ready = yield* host.ensureReady(() => Effect.void);
      const [ios, android] = (yield* ready.devices.list).devices;
      yield* ready.devices.boot(ios!);
      const refused = yield* ready.devices.boot(android!).pipe(Effect.flip);
      expect(refused.message).toContain("limited to 1 running device");
      expect(limrun.created).toHaveLength(1);
      yield* Scope.close(scope, Exit.void);
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect("deletes every running instance when the host stops", () =>
    Effect.gen(function* () {
      const limrun = fakeLimrun();
      const scope = yield* Scope.make();
      const host = yield* makeHost(limrun, config(), scope);
      const ready = yield* host.ensureReady(() => Effect.void);
      const [ios, android] = (yield* ready.devices.list).devices;
      const first = yield* ready.devices.boot(ios!);
      const second = yield* ready.devices.boot(android!);
      yield* Scope.close(scope, Exit.void);
      expect(limrun.deleted.toSorted()).toEqual([first, second].toSorted());
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect("deletes instances a previous server left, and only its own", () =>
    Effect.gen(function* () {
      // A first host learns its label by starting an instance, then its server dies.
      const previous = fakeLimrun();
      const firstScope = yield* Scope.make();
      const first = yield* makeHost(previous, config(), firstScope);
      const firstReady = yield* first.ensureReady(() => Effect.void);
      yield* firstReady.devices.boot((yield* firstReady.devices.list).devices[0]!);
      const owner = (previous.created[0] as { metadata: { labels: Record<string, string> } })
        .metadata.labels["t3-code-host"]!;

      const limrun = fakeLimrun({
        leftovers: [
          { id: "ios_left", platform: "ios", labels: { "t3-code-host": owner }, state: "ready" },
          {
            id: "android_other",
            platform: "android",
            labels: { "t3-code-host": "another-server" },
            state: "ready",
          },
        ],
      });
      const scope = yield* Scope.make();
      const host = yield* makeHost(limrun, config(), scope);
      yield* host.ensureReady(() => Effect.void);
      yield* TestClock.adjust("1 second");
      yield* Effect.yieldNow;
      expect(limrun.deleted).toEqual(["ios_left"]);
      yield* Scope.close(scope, Exit.void);
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect("stops listing an instance Limrun ended at its limit", () =>
    Effect.gen(function* () {
      const limrun = fakeLimrun();
      const scope = yield* Scope.make();
      const host = yield* makeHost(limrun, config(), scope);
      const ready = yield* host.ensureReady(() => Effect.void);
      const id = yield* ready.devices.boot((yield* ready.devices.list).devices[0]!);
      limrun.instances.get(id)!.state = "terminated";
      yield* TestClock.adjust("20 seconds");
      expect((yield* ready.devices.list).devices.some((device) => device.id === id)).toBe(false);
      yield* Scope.close(scope, Exit.void);
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );
});

describe("lim login credential", () => {
  it("reads the API key lim login saved", () => {
    expect(readLimLoginKey("api-key: lim_abc123\n")).toBe("lim_abc123");
    expect(readLimLoginKey('region: eu\napi-key: "lim_quoted"\n')).toBe("lim_quoted");
    expect(readLimLoginKey("region: eu\n")).toBeNull();
  });
});

describe("Limrun API errors", () => {
  const refusing = (response: Response) =>
    makeLimrunApi(
      HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, response))),
      { source: "settings", apiKey: Redacted.make("lim-key") },
    );
  const start = (response: Response) =>
    refusing(response)
      .create({
        platform: "ios",
        displayName: "t3",
        labels: {},
        hardTimeoutMinutes: 30,
        inactivityTimeoutMinutes: 10,
        jurisdiction: undefined,
      })
      .pipe(Effect.flip);

  it.effect("passes on why Limrun refused", () =>
    Effect.gen(function* () {
      const error = yield* start(
        Response.json(
          {
            message:
              "cannot create an instance when organization has no remaining credits and no active subscription.",
            reason: "NoSubscription",
          },
          { status: 400 },
        ),
      );
      expect(error.message).toBe(
        "Limrun could not start an instance: HTTP 400: cannot create an instance when organization has no remaining credits and no active subscription.",
      );
      expect(error.rejected).toBe(true);
    }),
  );

  it.effect("falls back to the status when the refusal has no message", () =>
    Effect.gen(function* () {
      const error = yield* start(new Response("<html>bad gateway</html>", { status: 502 }));
      expect(error.message).toBe("Limrun could not start an instance: HTTP 502");
    }),
  );
});
