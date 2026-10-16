/**
 * Worker entrypoint.
 *
 * Every `sample_interval_seconds` the worker collects the local host plus every
 * SSH host, appends one raw `SeriesPoint` per available host to an in-memory
 * ring buffer, and persists the windowed buffer to instance-scoped plugin state
 * so a restart does not blank the graphs. The UI reads the newest snapshot plus
 * the rolling series, and appends deltas with the `series-since` action.
 *
 * The timer lives here rather than in a manifest job because cron granularity
 * is one minute, which cannot deliver the near-realtime charts the plan asks
 * for. The manifest job is the once-a-minute retention sweep.
 */
import { definePlugin, runWorker, type PluginContext, type PluginWebhookInput } from "@paperclipai/plugin-sdk";
import { parseConfig, validateConfig, type PluginConfig } from "./config.js";
import { JOB_KEY, WEBHOOK_ENDPOINT } from "./manifest.js";
import { collectAllHosts, toHostStats } from "./remote.js";
import { RingBuffer } from "./series.js";
import { readRemoteStats, readSnapshot, storeRemoteStats, storeSnapshot } from "./state.js";
import {
  downsample,
  toSeriesPoint,
  type HostSeries,
  type HostStats,
  type HostsSnapshot,
  type RemoteStats,
  type SeriesPoint,
  type SparklinePayload,
} from "./types.js";

/** Max points shipped to the dashboard-widget sparklines (full res on the page). */
const SPARKLINE_MAX = 180;

let workerCtx: PluginContext | null = null;
let timer: NodeJS.Timeout | null = null;
let sampling = false;
/** Timestamp of the last successful collection, used for staleness checks. */
let lastSampleAt = 0;
const buffers = new RingBuffer();

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

/** Every host this plugin tracks: the local box plus configured remotes. */
function knownHostIds(config: PluginConfig): string[] {
  return ["localhost", ...config.remote_hosts.map((host) => host.id)];
}

function windowMs(config: PluginConfig): number {
  return config.history_window_seconds * 1000;
}

function stopSampling(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function startSampling(ctx: PluginContext, config: PluginConfig): void {
  stopSampling();
  if (config.sample_interval_seconds <= 0) return;
  timer = setInterval(() => {
    void sample("interval").catch((error: unknown) => {
      ctx.logger.warn("interval sampling failed", { error: String(error) });
    });
  }, config.sample_interval_seconds * 1000);
  timer.unref?.();
}

/**
 * Collect every host once, store the newest full snapshot (for the tables) and
 * append a raw series point per available host. Unreachable hosts are skipped
 * so a failure does not punch a bogus zero into the chart.
 */
async function sample(trigger: string): Promise<{ collected_at: string; hosts: number; skipped?: boolean }> {
  if (sampling) return { collected_at: "", hosts: 0, skipped: true };
  sampling = true;
  try {
    const ctx = requireCtx();
    const config = await loadConfig(ctx);
    const window = windowMs(config);
    const snapshot = await collectAllHosts(config, ctx.logger);
    await storeSnapshot(ctx, snapshot);
    lastSampleAt = Date.now();
    const now = lastSampleAt;
    for (const host of snapshot.hosts) {
      if (!host.available) continue;
      buffers.push(host.id, toSeriesPoint(host), window, now);
      await buffers.persist(ctx, host.id);
    }
    ctx.logger.debug("sampled host stats", { trigger, hosts: snapshot.hosts.length });
    return { collected_at: snapshot.collected_at, hosts: snapshot.hosts.length };
  } finally {
    sampling = false;
  }
}

/**
 * Collect only when the newest sample is older than `sample_interval_seconds`.
 *
 * The charts must not depend on the worker process staying alive (it can be
 * recycled between invocations, taking the interval timer with it), so every
 * read of the data feeds first makes the data fresh. Cheaper than it sounds:
 * a single collection covers all hosts, `sampling` collapses concurrent
 * requests, and `lastSampleAt` is seeded from the persisted snapshot at boot so
 * the first paint after a restart is not blocked.
 *
 * A configured interval of `0` means "operator drives sampling" — reads then
 * never collect; the cron sweep and the Refresh button still do.
 */
async function ensureFresh(config: PluginConfig, reason: string): Promise<void> {
  if (config.sample_interval_seconds <= 0 || sampling) return;
  if (Date.now() - lastSampleAt < config.sample_interval_seconds * 1000) return;
  await sample(reason).catch(() => undefined);
}

/** Merge the newest SSH/local snapshot with freshly pushed webhook hosts. */
async function currentHosts(ctx: PluginContext, config: PluginConfig): Promise<{ hosts: HostStats[]; collected_at: string }> {
  const snapshot = await readSnapshot(ctx);
  const hosts: HostStats[] = [...(snapshot?.hosts ?? [])];
  const maxAgeMs = Math.max(60_000, config.sample_interval_seconds * 1000 * 4);
  for (const host of config.remote_hosts) {
    if (host.mode !== "webhook") continue;
    const pushed = await readRemoteStats(ctx, host.id);
    if (!pushed) continue;
    const ageMs = Date.now() - Date.parse(pushed.collected_at);
    hosts.push(ageMs > maxAgeMs ? { ...pushed, available: false, error: "stale — no recent push" } : pushed);
  }
  return { hosts, collected_at: snapshot?.collected_at ?? new Date().toISOString() };
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
    const config = await loadConfig(ctx);
    // Fresh bootstrap: drop any in-process history, then re-hydrate what was persisted.
    buffers.clear();
    await buffers.hydrate(ctx, knownHostIds(config), windowMs(config), Date.now());
    // Seed freshness from the persisted snapshot so a restart does not make the
    // very first read block on a full collection.
    const boot = await readSnapshot(ctx);
    lastSampleAt = boot ? Date.parse(boot.collected_at) || 0 : 0;

    // --- Latest snapshot (headline numbers + detailed tables) ---
    ctx.data.register("host-stats", async () => {
      const cfg = await loadConfig(ctx);
      await ensureFresh(cfg, "read:host-stats");
      const { hosts, collected_at } = await currentHosts(ctx, cfg);
      return {
        hosts,
        collected_at,
        thresholds: cfg.thresholds,
        sample_interval_seconds: cfg.sample_interval_seconds,
        history_window_seconds: cfg.history_window_seconds,
        ui_refresh_seconds: cfg.ui_refresh_seconds,
        sampled_at: new Date(lastSampleAt).toISOString(),
      };
    });

    // --- Full rolling window for one host (initial chart load) ---
    ctx.data.register("host-series", async (params): Promise<HostSeries> => {
      const cfg = await loadConfig(ctx);
      await ensureFresh(cfg, "read:host-series");
      const { hostId, windowMs: requested } = (params ?? {}) as { hostId?: string; windowMs?: number };
      const window = requested ?? windowMs(cfg);
      return { hostId: hostId ?? "", windowMs: window, points: buffers.window(hostId ?? "", window, Date.now()) };
    });

    // --- Downsampled arrays for the dashboard-widget sparklines ---
    ctx.data.register("host-sparklines", async (): Promise<SparklinePayload> => {
      const cfg = await loadConfig(ctx);
      await ensureFresh(cfg, "read:host-sparklines");
      const now = Date.now();
      const window = windowMs(cfg);
      const hosts = knownHostIds(cfg)
        .map((id) => {
          const points = downsample(buffers.window(id, window, now), SPARKLINE_MAX);
          return {
            id,
            cpu: points.map((p) => p.cpu_pct),
            mem: points.map((p) => p.mem_pct),
            disk: points.map((p) => p.disk_pct),
          };
        })
        .filter((host) => host.cpu.length > 0);
      return { hosts };
    });

    // --- Incremental delta (realtime chart append) ---
    ctx.actions.register("series-since", async (params): Promise<{ hostId: string; points: SeriesPoint[] }> => {
      const cfg = await loadConfig(ctx);
      await ensureFresh(cfg, "read:series-since");
      const { hostId, sinceTs } = (params ?? {}) as { hostId?: string; sinceTs?: number };
      if (!hostId) return { hostId: "", points: [] };
      return { hostId, points: buffers.since(hostId, sinceTs ?? 0, windowMs(cfg), Date.now()) };
    });

    // --- Force an immediate sample ---
    ctx.actions.register("refresh", async () => ({ ok: true, ...(await sample("manual")) }));

    // --- Supervised heartbeat: sample, then trim every buffer to the window. ---
    // Runs regardless of the interval so a host whose worker gets recycled
    // still receives one sample a minute.
    ctx.jobs.register(JOB_KEY, async () => {
      const cfg = await loadConfig(ctx);
      await sample("cron").catch(() => undefined);
      const window = windowMs(cfg);
      const now = Date.now();
      for (const id of buffers.hostIds()) buffers.trim(id, window, now);
      await buffers.persistAll(ctx);
    });

    startSampling(ctx, config);
  },

  async onHealth() {
    if (!workerCtx) return { status: "ok", message: "not initialised" };
    const snapshot = await readSnapshot(workerCtx);
    const hosts = buffers.hostIds().length;
    return {
      status: "ok",
      message: snapshot ? `tracking ${snapshot.hosts.length} host(s), ${hosts} series` : "no snapshot yet",
    };
  },

  async onShutdown() {
    stopSampling();
    workerCtx = null;
  },

  async onConfigChanged(newConfig: Record<string, unknown>) {
    const ctx = workerCtx;
    if (!ctx) return;
    const config = parseConfig(newConfig);
    const window = windowMs(config);
    const now = Date.now();
    for (const id of buffers.hostIds()) buffers.trim(id, window, now);
    startSampling(ctx, config);
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
    // Pushed hosts get the same 30-minute graphs as locally sampled ones.
    if (stats.available) {
      buffers.push(host.id, toSeriesPoint(stats), windowMs(config), Date.now());
      await buffers.persist(ctx, host.id);
    }
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
