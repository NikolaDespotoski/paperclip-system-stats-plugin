import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { CONFIG_SCHEMA } from "./config.js";

export const PLUGIN_ID = "paperclip.system-stats";
export const PLUGIN_VERSION = "0.1.0";
export const ROUTE = "system-stats";
export const JOB_KEY = "collect-stats";
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
      displayName: "Collect host stats",
      description: "Refreshes the local and SSH host snapshots. The worker also polls every poll_interval_seconds.",
      // 5-field cron: the worker's own timer handles the 15s cadence; this is
      // the supervised fallback and manual-run trigger.
      schedule: "* * * * *",
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
