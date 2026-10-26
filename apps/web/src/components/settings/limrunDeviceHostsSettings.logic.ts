import {
  LimrunDeviceHostConfig,
  type LimrunDeviceHostConfig as LimrunDeviceHostConfigType,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const parseLimrunDeviceHostDraft = Schema.decodeUnknownOption(LimrunDeviceHostConfig);

export const newLimrunDeviceHost = (id: string): LimrunDeviceHostConfigType => ({
  kind: "limrun",
  id,
  label: "Limrun",
  apiKey: "",
  maxSessionMinutes: 30,
  idleMinutes: 10,
  maxConcurrentSessions: 2,
});

/** Adds, replaces, or removes one Limrun host. */
export function updateLimrunDeviceHosts(
  hosts: ReadonlyArray<LimrunDeviceHostConfigType>,
  host: LimrunDeviceHostConfigType,
  remove: boolean,
): ReadonlyArray<LimrunDeviceHostConfigType> {
  if (remove) return hosts.filter((candidate) => candidate.id !== host.id);
  return hosts.some((candidate) => candidate.id === host.id)
    ? hosts.map((candidate) => (candidate.id === host.id ? host : candidate))
    : [...hosts, host];
}

export function limrunInstanceLimits(host: LimrunDeviceHostConfigType) {
  const devices =
    host.maxConcurrentSessions === 1 ? "1 device" : `${host.maxConcurrentSessions} devices`;
  return `Up to ${devices} at once, each stopped after ${host.maxSessionMinutes} min or ${host.idleMinutes} idle min`;
}
