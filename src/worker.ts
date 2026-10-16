/**
 * Worker entrypoint. Registers the UI data/action handlers, the collection job
 * and the webhook handler, then starts the polling timer. Every collection goes
 * through `collectAllHosts`; the newest snapshot lives in instance-scoped plugin
 * state so any open view can read it.
 */
import { definePlugin, runWorker, type PluginContext, type PluginWebhookInput } from "@paperclipai/plugin-sdk";
import { parseConfig, validateConfig, type PluginConfig } from "./config.js";
import { JOB_KEY, WEBHOOK_ENDPOINT } from "./manifest.js";
import { collectAllHosts, toHostStats } from "./remote.js";
import { readRemoteStats, readSnapshot, storeRemoteStats, storeSnapshot } from "./state.js";
import type { HostStats, HostsSnapshot, RemoteStats } from "./types.js";

let workerCtx: PluginContext | null = null;
let timer: NodeJS.Timeout | null = null;
let collecting = false;

function requireCtx(): PluginContext {
  if (!workerCtx) throw new Error("worker context is not initialised");
  return workerCtx;
}

async function loadConfig(ctx: PluginContext): Promise<PluginConfig> {
  try {
    return parseConfig(await ctx.config.get());
  } catch {
    return parseConfig(null);
  }
}

function stopPolling(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function startPolling(ctx: PluginContext, config: PluginConfig): void {
  stopPolling();
  if (config.poll_interval_seconds <= 0) return;
  timer = setInterval(() => {
    void runCollection("interval").catch((error: unknown) => {
      ctx.logger.warn("interval collection failed", { error: String(error) });
    });
  }, config.poll_interval_seconds * 1000);
  timer.unref?.();
}

async function runCollection(trigger: string): Promise<{ collected_at: string; hosts: number; skipped?: boolean }> {
  if (collecting) return { collected_at: "", hosts: 0, skipped: true };
  collecting = true;
  try {
    const ctx = requireCtx();
    const config = await loadConfig(ctx);
    const snapshot = await collectAllHosts(config, ctx.logger);
    await storeSnapshot(ctx, snapshot);
    ctx.logger.debug("collected host stats", { trigger, hosts: snapshot.hosts.length });
    return { collected_at: snapshot.collected_at, hosts: snapshot.hosts.length };
  } finally {
    collecting = false;
  }
}

function headerValue(headers: Record<string, string | string[]>, name: string): string {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  const value = entry?.[1];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

/** Constant-time string comparison so the webhook secret never leaks by timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const plugin = definePlugin({
  async setup(ctx) {
    workerCtx = ctx;

    // UI data feed: local + SSH hosts from the snapshot, plus fresh webhook
    // pushes merged in from their own per-host state keys.
    ctx.data.register("host-stats", async () => {
      const config = await loadConfig(ctx);
      const snapshot = await readSnapshot(ctx);
      const hosts: HostStats[] = [...(snapshot?.hosts ?? [])];
      const maxAgeMs = Math.max(60_000, config.poll_interval_seconds * 1000 * 4);
      for (const host of config.remote_hosts) {
        if (host.mode !== "webhook") continue;
        const pushed = await readRemoteStats(ctx, host.id);
        if (!pushed) continue;
        const ageMs = Date.now() - Date.parse(pushed.collected_at);
        hosts.push(ageMs > maxAgeMs ? { ...pushed, available: false, error: "stale — no recent push" } : pushed);
      }
      const result: HostsSnapshot & { thresholds: PluginConfig["thresholds"] } = {
        hosts,
        collected_at: snapshot?.collected_at ?? new Date().toISOString(),
        thresholds: config.thresholds,
      };
      return result;
    });

    // UI action: force a refresh now.
    ctx.actions.register("refresh", async () => {
      const result = await runCollection("manual");
      return { ok: true, ...result };
    });

    // Scheduled collection (manifest cron, manual runs and retries).
    ctx.jobs.register(JOB_KEY, async () => {
      await runCollection("schedule");
    });

    const config = await loadConfig(ctx);
    startPolling(ctx, config);
  },

  async onHealth() {
    const snapshot = workerCtx ? await readSnapshot(workerCtx) : null;
    return {
      status: "ok",
      message: snapshot ? `tracking ${snapshot.hosts.length} host(s)` : "no snapshot yet",
    };
  },

  async onShutdown() {
    stopPolling();
    workerCtx = null;
  },

  async onConfigChanged(newConfig: Record<string, unknown>) {
    const ctx = workerCtx;
    if (!ctx) return;
    startPolling(ctx, parseConfig(newConfig));
  },

  async onValidateConfig(config: Record<string, unknown>) {
    return validateConfig(config);
  },

  async onWebhook(input: PluginWebhookInput) {
    if (input.endpointKey !== WEBHOOK_ENDPOINT) return;
    const ctx = workerCtx;
    if (!ctx) return;
    const body = input.parsedBody as { host?: unknown; stats?: unknown } | null;
    const hostId = typeof body?.host === "string" ? body.host : "";
    if (!hostId || !body?.stats || typeof body.stats !== "object") return;
    const config = await loadConfig(ctx);
    const host = config.remote_hosts.find((h) => h.id === hostId && h.mode === "webhook");
    if (!host || !host.webhook_secret) return;
    let expected: string;
    try {
      expected = await ctx.secrets.resolve(host.webhook_secret, { configPath: "remote_hosts.webhook_secret" });
    } catch {
      return;
    }
    if (!timingSafeEqual(headerValue(input.headers, "x-paperclip-secret"), expected)) return;
    const stats = toHostStats(host.id, host.label, "webhook", body.stats as RemoteStats);
    await storeRemoteStats(ctx, host.id, stats);
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
