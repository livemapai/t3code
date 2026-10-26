/**
 * Limrun's REST API for cloud iOS Simulators and Android Emulators: the
 * instance calls `@limrun/api` makes, without the SDK.
 */
import type { DevicePlatform, LimrunJurisdiction } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import * as HostProcess from "@t3tools/shared/HostProcess";

const LIMRUN_API_URL = "https://api.limrun.com";
const REQUEST_TIMEOUT = Duration.seconds(30);
// `wait=true` answers once the instance is ready, which takes seconds.
const CREATE_TIMEOUT = Duration.minutes(3);

export type LimrunCredentialSource = "settings" | "env" | "lim-login";

export interface LimrunCredential {
  readonly source: LimrunCredentialSource;
  readonly apiKey: Redacted.Redacted<string>;
}

export class LimrunNotSignedInError extends Schema.TaggedError<LimrunNotSignedInError>()(
  "LimrunNotSignedInError",
  {},
) {
  override get message(): string {
    return "No Limrun credential on the server: save an API key for this host, set LIM_API_KEY, or run `lim login`.";
  }
}

const CREDENTIAL_SOURCE_NAMES: Record<LimrunCredentialSource, string> = {
  settings: "The API key saved for this host",
  env: "LIM_API_KEY",
  "lim-login": "The lim login session",
};

export class LimrunInvalidCredentialError extends Schema.TaggedError<LimrunInvalidCredentialError>()(
  "LimrunInvalidCredentialError",
  { source: Schema.Literals(["settings", "env", "lim-login"]) },
) {
  override get message(): string {
    return `${CREDENTIAL_SOURCE_NAMES[this.source]} is not a usable Limrun API key. Replace it.`;
  }
}

/** Anything but printable ASCII would fail inside fetch with the key in its message. */
const credential = (source: LimrunCredentialSource, value: string) =>
  /^[\x21-\x7e]+$/.test(value)
    ? Effect.succeed({ source, apiKey: Redacted.make(value) } satisfies LimrunCredential)
    : Effect.fail(new LimrunInvalidCredentialError({ source }));

/** `lim login` keeps the key as `api-key: <key>` in ~/.lim/config.yaml. */
export const readLimLoginKey = (config: string): string | null => {
  const match = /^api-key:[ \t]*["']?([^"'\s]+)["']?[ \t]*$/m.exec(config);
  return match?.[1] ?? null;
};

/** A key saved for the host, then LIM_API_KEY, then the `lim login` session. */
export const resolveLimrunCredential = Effect.fn("LimrunApi.resolveLimrunCredential")(function* (
  savedKey: string,
) {
  const saved = savedKey.trim();
  if (saved !== "") return yield* credential("settings", saved);
  const env = yield* HostProcess.Environment;
  const fromEnv = (env.LIM_API_KEY ?? env.LIMRUN_API_KEY)?.trim();
  if (fromEnv) return yield* credential("env", fromEnv);
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const configPath = path.join(yield* HostProcess.HomeDirectory, ".lim", "config.yaml");
  const key = (yield* fs.readFileString(configPath).pipe(Effect.option)).pipe(
    Option.flatMap((config) => Option.fromNullishOr(readLimLoginKey(config))),
  );
  if (Option.isNone(key)) return yield* new LimrunNotSignedInError();
  return yield* credential("lim-login", key.value);
});

export class LimrunApiError extends Schema.TaggedError<LimrunApiError>()("LimrunApiError", {
  operation: Schema.String,
  detail: Schema.optional(Schema.String),
  /** Limrun answered and refused, so a create made nothing. Otherwise it may have run. */
  rejected: Schema.optional(Schema.Boolean),
  status: Schema.optional(Schema.Int),
}) {
  override get message(): string {
    return `Limrun could not ${this.operation}${this.detail ? `: ${this.detail}` : "."}`;
  }
}

const InstanceWire = Schema.Struct({
  metadata: Schema.Struct({
    id: Schema.String,
    labels: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    terminatedAt: Schema.optional(Schema.String),
  }),
  status: Schema.Struct({
    state: Schema.String,
    token: Schema.optional(Schema.String),
    apiUrl: Schema.optional(Schema.String),
    endpointWebSocketUrl: Schema.optional(Schema.String),
    adbWebSocketUrl: Schema.optional(Schema.String),
    errorMessage: Schema.optional(Schema.String),
  }),
});
const decodeInstance = Schema.decodeUnknownEffect(InstanceWire);
const decodeInstances = Schema.decodeUnknownEffect(Schema.Array(InstanceWire));

export type LimrunInstanceState = "creating" | "ready" | "terminated" | "other";

export interface LimrunInstance {
  readonly id: string;
  readonly platform: DevicePlatform;
  readonly state: LimrunInstanceState;
  readonly labels: Readonly<Record<string, string>>;
  readonly errorMessage: string | undefined;
  /** Present once the instance is ready; the token grants full device control. */
  readonly endpoints: {
    readonly apiUrl: string;
    readonly webSocketUrl: string;
    readonly adbWebSocketUrl: string | undefined;
    readonly token: Redacted.Redacted<string>;
  } | null;
}

const toInstance = (platform: DevicePlatform, wire: typeof InstanceWire.Type): LimrunInstance => {
  const { status } = wire;
  const state: LimrunInstanceState =
    wire.metadata.terminatedAt !== undefined || status.state === "terminated"
      ? "terminated"
      : status.state === "ready"
        ? "ready"
        : status.state === "creating" || status.state === "assigned" || status.state === "unknown"
          ? "creating"
          : "other";
  return {
    id: wire.metadata.id,
    platform,
    state,
    labels: wire.metadata.labels ?? {},
    errorMessage: status.errorMessage,
    endpoints:
      state === "ready" && status.apiUrl && status.endpointWebSocketUrl && status.token
        ? {
            apiUrl: status.apiUrl,
            webSocketUrl: status.endpointWebSocketUrl,
            adbWebSocketUrl: status.adbWebSocketUrl,
            token: Redacted.make(status.token),
          }
        : null,
  };
};

export interface CreateLimrunInstanceInput {
  readonly platform: DevicePlatform;
  readonly displayName: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly hardTimeoutMinutes: number;
  readonly inactivityTimeoutMinutes: number;
  readonly jurisdiction: LimrunJurisdiction | undefined;
}

export interface LimrunApi {
  readonly create: (
    input: CreateLimrunInstanceInput,
  ) => Effect.Effect<LimrunInstance, LimrunApiError>;
  /** None once Limrun no longer knows the instance. */
  readonly get: (
    platform: DevicePlatform,
    id: string,
  ) => Effect.Effect<Option.Option<LimrunInstance>, LimrunApiError>;
  readonly delete: (platform: DevicePlatform, id: string) => Effect.Effect<void, LimrunApiError>;
  /** Instances that have not ended, carrying every one of these labels. */
  readonly list: (
    platform: DevicePlatform,
    labels: Readonly<Record<string, string>>,
  ) => Effect.Effect<ReadonlyArray<LimrunInstance>, LimrunApiError>;
}

const collection = (platform: DevicePlatform) =>
  `${LIMRUN_API_URL}/v1/${platform === "ios" ? "ios" : "android"}_instances`;

/**
 * Errors carry no cause: a transport error holds the request with its
 * credential header, and these errors also reach clients as RPC defects.
 */
export const makeLimrunApi = (http: HttpClient.HttpClient, credential: LimrunCredential) => {
  const authorized = HttpClientRequest.bearerToken(Redacted.value(credential.apiKey));

  const send = <A, E>(
    operation: string,
    request: HttpClientRequest.HttpClientRequest,
    read: (response: HttpClientResponse.HttpClientResponse) => Effect.Effect<A, E>,
    timeout: Duration.Input = REQUEST_TIMEOUT,
  ) =>
    http.execute(authorized(request)).pipe(
      Effect.flatMap((response) =>
        response.status >= 200 && response.status < 300
          ? read(response).pipe(
              Effect.mapError(
                () =>
                  new LimrunApiError({
                    operation,
                    detail: "the answer could not be read",
                    status: response.status,
                  }),
              ),
            )
          : Effect.fail(
              new LimrunApiError({
                operation,
                detail: `HTTP ${response.status}`,
                status: response.status,
                rejected: response.status < 500,
              }),
            ),
      ),
      Effect.scoped,
      Effect.timeoutOrElse({
        duration: timeout,
        orElse: () => Effect.fail(new LimrunApiError({ operation, detail: "no answer in time" })),
      }),
      Effect.catchIf(
        (error) => error._tag !== "LimrunApiError",
        () => Effect.fail(new LimrunApiError({ operation, detail: "the request failed" })),
      ),
    );

  const api: LimrunApi = {
    create: (input) =>
      send(
        "start an instance",
        HttpClientRequest.post(`${collection(input.platform)}?wait=true`).pipe(
          HttpClientRequest.bodyJsonUnsafe({
            metadata: { displayName: input.displayName, labels: input.labels },
            spec: {
              hardTimeout: `${input.hardTimeoutMinutes}m`,
              inactivityTimeout: `${input.inactivityTimeoutMinutes}m`,
              ...(input.jurisdiction ? { jurisdiction: input.jurisdiction } : {}),
            },
          }),
        ),
        (response) =>
          response.json.pipe(
            Effect.flatMap(decodeInstance),
            Effect.map((wire) => toInstance(input.platform, wire)),
          ),
        CREATE_TIMEOUT,
      ),
    get: (platform, id) =>
      send(
        "read an instance",
        HttpClientRequest.get(`${collection(platform)}/${encodeURIComponent(id)}`),
        (response) =>
          response.json.pipe(
            Effect.flatMap(decodeInstance),
            Effect.map((wire) => Option.some(toInstance(platform, wire))),
          ),
      ).pipe(
        Effect.catchIf(
          (error) => error.status === 404,
          () => Effect.succeed(Option.none<LimrunInstance>()),
        ),
      ),
    delete: (platform, id) =>
      send(
        "stop an instance",
        HttpClientRequest.delete(`${collection(platform)}/${encodeURIComponent(id)}`),
        (response) => response.arrayBuffer.pipe(Effect.asVoid),
      ).pipe(
        Effect.catchIf(
          (error) => error.status === 404,
          () => Effect.void,
        ),
      ),
    list: (platform, labels) =>
      send(
        "list instances",
        HttpClientRequest.get(
          `${collection(platform)}?${new URLSearchParams({
            labelSelector: Object.entries(labels)
              .map(([key, value]) => `${key}=${value}`)
              .join(","),
          }).toString()}`,
        ),
        (response) =>
          response.json.pipe(
            Effect.flatMap(decodeInstances),
            Effect.map((wires) =>
              wires
                .map((wire) => toInstance(platform, wire))
                .filter((instance) => instance.state !== "terminated"),
            ),
          ),
      ),
  };
  return api;
};
