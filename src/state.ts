/** Scoped plugin-state helpers (instance-wide, so one dashboard serves the host). */
import type { PluginContext, ScopeKey } from "@paperclipai/plugin-sdk";
import { STATE_NAMESPACE } from "./manifest.js";
import type { HostStats, HostsSnapshot } from "./types.js";

export const SNAPSHOT_STATE_KEY = "latest";

export function snapshotScope(): ScopeKey {
  return { scopeKind: "instance", namespace: STATE_NAMESPACE, stateKey: SNAPSHOT_STATE_KEY };
}

export function remoteStatsScope(hostId: string): ScopeKey {
  return { scopeKind: "instance", namespace: "remote", stateKey: hostId };
}

export async function storeSnapshot(ctx: PluginContext, snapshot: HostsSnapshot): Promise<void> {
  await ctx.state.set(snapshotScope(), snapshot);
}

export async function readSnapshot(ctx: PluginContext): Promise<HostsSnapshot | null> {
  const value = await ctx.state.get(snapshotScope());
  return (value as HostsSnapshot | null) ?? null;
}

export async function storeRemoteStats(ctx: PluginContext, hostId: string, stats: HostStats): Promise<void> {
  await ctx.state.set(remoteStatsScope(hostId), stats);
}

export async function readRemoteStats(ctx: PluginContext, hostId: string): Promise<HostStats | null> {
  const value = await ctx.state.get(remoteStatsScope(hostId));
  return (value as HostStats | null) ?? null;
}
