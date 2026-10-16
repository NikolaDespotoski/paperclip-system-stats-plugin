import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { CONFIG_SCHEMA } from "./config.js";

export const PLUGIN_ID = "paperclip.system-stats";
export const PLUGIN_VERSION = "0.1.0";
export const ROUTE = "system-stats";
export const JOB_KEY = "sample-and-prune";
export const WEBHOOK_ENDPOINT = "host-stats";
export const STATE_NAMESPACE = "stats";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "System Stats",
  description: "Real-time CPU, RAM, disk, network and Docker monitoring for execution hosts.",
  author: "paperclip",
  categories: ["ui", "automation"],
  capabilities: [
    "ui.page.register",
    "ui.dashboardWidget.register",
    "plugin.state.read",
    "plugin.state.write",
    "jobs.schedule",
    "webhooks.receive",
    "secrets.read-ref",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },
  instanceConfigSchema: CONFIG_SCHEMA,
  jobs: [
    {
      jobKey: JOB_KEY,
      displayName: "Sample and prune",
      description: "Collects every host once and trims the rolling time series to history_window_seconds.",
      // Supervised heartbeat: the near-realtime cadence comes from the worker's
      // own timer plus sample-on-read, but this guarantees one collection a
      // minute even if the worker process is recycled. Cron is 1-minute
      // granularity, which is too coarse to be the only source.
      schedule: "*/1 * * * *",
    },
  ],
  webhooks: [
    {
      endpointKey: WEBHOOK_ENDPOINT,
      displayName: "Host stats push",
      description: "A remote host POSTs its collected stats here (Strategy B).",
    },
  ],
  ui: {
    slots: [
      { type: "page", id: "system-stats-page", displayName: "System", exportName: "SystemStatsPage", routePath: ROUTE },
      { type: "dashboardWidget", id: "system-stats-widget", displayName: "Host Health", exportName: "SystemStatsWidget" },
    ],
  },
};

export default manifest;
