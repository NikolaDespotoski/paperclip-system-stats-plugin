/**
 * The collector that runs *on the remote host*. It is a self-contained CommonJS
 * snippet: the worker base64-encodes it and runs it over SSH (`node -e`), and a
 * webhook-push host pipes it to `node` from a systemd timer. Producing the same
 * `RemoteStats` JSON either way keeps the two strategies identical.
 *
 * The snippet deliberately avoids backticks and template interpolation so it
 * can live inside this TypeScript template literal unchanged.
 */
export const REMOTE_COLLECT_SCRIPT = `(async () => {
  const { execSync } = require("node:child_process");
  const { readFileSync } = require("node:fs");
  const read = (p) => { try { return readFileSync(p, "utf8"); } catch (e) { return null; } };
  const run = (c) => { try { return execSync(c, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10000 }); } catch (e) { return null; } };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const round = (v, d) => { const f = Math.pow(10, d == null ? 1 : d); return Math.round(v * f) / f; };
  const includeLoopback = process.env.STATS_INCLUDE_LOOPBACK === "true";
  const includeDockerBridge = process.env.STATS_INCLUDE_DOCKER_BRIDGE === "true";

  function cpuSample() {
    const stat = read("/proc/stat");
    if (stat == null) return null;
    let total = 0, idle = 0, cores = 0;
    for (const line of stat.split("\\n")) {
      if (line.indexOf("cpu") !== 0) continue;
      const f = line.trim().split(/\\s+/);
      if (f[0] === "cpu") {
        const nums = f.slice(1).map((v) => parseInt(v, 10)).filter((v) => !isNaN(v));
        total = nums.reduce((a, b) => a + b, 0);
        idle = (nums[3] || 0) + (nums[4] || 0);
      } else if (/^cpu\\d+$/.test(f[0])) {
        cores++;
      }
    }
    return { total: total, idle: idle, cores: cores };
  }

  function meminfo() {
    const text = read("/proc/meminfo") || "";
    const kb = {};
    for (const line of text.split("\\n")) {
      const m = /^(\\w+):\\s+(\\d+)\\s*kB/.exec(line);
      if (m) kb[m[1]] = parseInt(m[2], 10);
    }
    const g = (k) => (kb[k] || 0) * 1024;
    return { total: g("MemTotal"), free: g("MemFree"), available: g("MemAvailable"), buffers: g("Buffers"), cached: g("Cached"), swapTotal: g("SwapTotal"), swapFree: g("SwapFree") };
  }

  function loadavg() {
    const f = (read("/proc/loadavg") || "").trim().split(/\\s+/);
    return { load1: parseFloat(f[0]) || 0, load5: parseFloat(f[1]) || 0, load15: parseFloat(f[2]) || 0 };
  }

  function uptimeSeconds() {
    const f = (read("/proc/uptime") || "").trim().split(/\\s+/)[0];
    return f ? Math.round(parseFloat(f) || 0) : 0;
  }

  function pressureCpu() {
    const text = read("/proc/pressure/cpu");
    if (text == null) return null;
    const line = text.split("\\n").find((l) => l.indexOf("some") === 0);
    if (!line) return null;
    const m = /avg10=([\\d.]+)/.exec(line);
    return m ? parseFloat(m[1]) : null;
  }

  function netDev() {
    const text = read("/proc/net/dev");
    const out = {};
    if (text == null) return out;
    for (const line of text.split("\\n")) {
      const c = line.indexOf(":");
      if (c === -1) continue;
      const name = line.slice(0, c).trim();
      const f = line.slice(c + 1).trim().split(/\\s+/).map((v) => parseInt(v, 10));
      if (f.length < 16 || f.some((v) => isNaN(v))) continue;
      out[name] = { rxBytes: f[0], rxPackets: f[1], rxErrors: f[2], txBytes: f[8], txPackets: f[9], txErrors: f[10] };
    }
    return out;
  }

  function interfaceMeta(name) {
    const state = read("/sys/class/net/" + name + "/operstate");
    const speedText = read("/sys/class/net/" + name + "/speed");
    const speed = speedText == null ? NaN : parseFloat(speedText);
    return { state: state && state.trim() === "up" ? "up" : "down", speedMbps: isFinite(speed) && speed > 0 ? speed : null };
  }

  function netRates(prev, next, dtMs) {
    const dt = dtMs > 0 ? dtMs / 1000 : 0;
    const delta = (a, b) => (dt > 0 ? Math.max(0, a - b) / dt : 0);
    const interfaces = [];
    let totalRx = 0, totalTx = 0;
    for (const name of Object.keys(next)) {
      if (name === "lo" && !includeLoopback) continue;
      if (!includeDockerBridge && /^(docker|br-|veth)/.test(name)) continue;
      const cur = next[name];
      const old = prev[name] || { rxBytes: 0, rxPackets: 0, rxErrors: 0, txBytes: 0, txPackets: 0, txErrors: 0 };
      const meta = interfaceMeta(name);
      const rx = delta(cur.rxBytes, old.rxBytes);
      const tx = delta(cur.txBytes, old.txBytes);
      totalRx += rx; totalTx += tx;
      interfaces.push({ name: name, rx_bytes_per_sec: round(rx), tx_bytes_per_sec: round(tx), rx_packets_per_sec: round(delta(cur.rxPackets, old.rxPackets)), tx_packets_per_sec: round(delta(cur.txPackets, old.txPackets)), rx_errors: cur.rxErrors - old.rxErrors, tx_errors: cur.txErrors - old.txErrors, state: meta.state, speed_mbps: meta.speedMbps });
    }
    return { interfaces: interfaces, total_rx_per_sec: round(totalRx), total_tx_per_sec: round(totalTx) };
  }

  const VIRTUAL = { devfs: 1, none: 1, tmpfs: 1, devtmpfs: 1, shm: 1, ramfs: 1, sysfs: 1, proc: 1, cgroup: 1, cgroup2: 1, autofs: 1, udev: 1, efivarfs: 1, nsfs: 1, tracefs: 1, debugfs: 1, pstore: 1, bpf: 1, securityfs: 1, configfs: 1, fusectl: 1, mqueue: 1, hugetlbfs: 1, binfmt_misc: 1, sunrpc: 1, rpc_pipefs: 1, nfsd: 1 };
  function virtualMount(source, mount) {
    if (VIRTUAL[source] === 1) return true;
    if (source === "map" || source.indexOf("map ") === 0) return true;
    return mount === "/snap" || mount.indexOf("/snap/") === 0;
  }
  function diskRow(source, mount, blocks, used, avail, pcent) {
    if (!mount || virtualMount(source, mount)) return null;
    const total = parseInt(blocks, 10), usedB = parseInt(used, 10), availB = parseInt(avail, 10);
    if (isNaN(total) || isNaN(usedB) || isNaN(availB)) return null;
    if (total * 1024 <= 0) return null;
    const pct = parseFloat(pcent.replace("%", ""));
    return { mount: mount, total_bytes: total * 1024, used_bytes: usedB * 1024, available_bytes: availB * 1024, usage_pct: isFinite(pct) ? pct : round(usedB / total * 100) };
  }
  function dfModern(text) {
    const rows = [];
    if (text == null) return rows;
    for (const line of text.split("\\n").slice(1)) {
      const t = line.trim().split(/\\s+/);
      if (t.length < 6) continue;
      const r = diskRow(t[0], t.slice(5).join(" "), t[1], t[2], t[3], t[4]);
      if (r) rows.push(r);
    }
    return rows;
  }

  function dfPosix(text) {
    const rows = [];
    if (text == null) return rows;
    for (const line of text.split("\\n").slice(1)) {
      const t = line.trim().split(/\\s+/);
      if (t.length < 6) continue;
      const mount = t.slice(5).join(" ");
      if (mount === "on") continue;
      const r = diskRow(t[0], mount, t[1], t[2], t[3], t[4]);
      if (r) rows.push(r);
    }
    return rows;
  }

  function topProcs() {
    const text = run("ps -eo pid,pcpu,pmem,comm --sort=-pcpu --no-headers | head -6");
    const rows = [];
    if (text == null) return rows;
    for (const line of text.split("\\n")) {
      const t = line.trim().split(/\\s+/);
      if (t.length < 4) continue;
      const pid = parseInt(t[0], 10), cpu = parseFloat(t[1]), mem = parseFloat(t[2]);
      if (isNaN(pid) || isNaN(cpu) || isNaN(mem)) continue;
      rows.push({ pid: pid, cpu_pct: cpu, mem_pct: mem, command: t[3] });
    }
    return rows.slice(0, 6);
  }

  function sizeToBytes(text) {
    const m = /^([\\d.]+)\\s*([a-zA-Z]*)$/.exec(String(text).trim());
    if (!m) return NaN;
    const v = parseFloat(m[1]);
    if (!isFinite(v)) return NaN;
    const powers = { "": 0, b: 0, k: 1, kb: 1, kib: 1, m: 2, mb: 2, mib: 2, g: 3, gb: 3, gib: 3, t: 4, tb: 4, tib: 4, p: 5, pb: 5, pib: 5 };
    const power = powers[m[2].toLowerCase()];
    if (power === undefined) return NaN;
    return v * Math.pow(1024, power);
  }

  function parsePair(text) {
    const parts = String(text).split("/");
    return [sizeToBytes(parts[0] || ""), sizeToBytes(parts[1] || "")];
  }

  function dockerSystemDf(text) {
    if (text == null) return null;
    const rows = {};
    for (const line of text.split("\\n").slice(1)) {
      const t = line.trim().split(/\\s+/);
      if (t.length < 4) continue;
      let countIndex = -1;
      for (let i = 0; i < t.length; i++) { if (/^\\d+$/.test(t[i])) { countIndex = i; break; } }
      if (countIndex < 1) continue;
      const kind = t.slice(0, countIndex).join(" ").toLowerCase();
      const count = parseInt(t[countIndex], 10);
      const size = sizeToBytes(t[countIndex + 2] || "");
      if (!isFinite(count) || isNaN(size)) continue;
      rows[kind] = { count: count, size: size };
    }
    if (Object.keys(rows).length === 0) return null;
    const get = (k) => rows[k] || { count: 0, size: 0 };
    return { images_total: get("images").count, images_size: get("images").size, containers_total: get("containers").count, containers_size: get("containers").size, volumes_total: get("local volumes").count + get("volumes").count, volumes_size: get("local volumes").size + get("volumes").size, build_cache_size: get("build cache").size };
  }

  function dockerStats() {
    const text = run("docker stats --no-stream --format json");
    if (text == null) return null;
    const containers = [];
    for (const line of text.split("\\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let raw;
      try { raw = JSON.parse(trimmed); } catch (e) { continue; }
      const mem = parsePair(raw.MemUsage || "");
      const net = parsePair(raw.NetIO || "");
      const block = parsePair(raw.BlockIO || "");
      containers.push({ id: String(raw.ID || raw.Container || ""), name: String(raw.Name || ""), image: String(raw.Image || ""), status: String(raw.Status || ""), cpu_percent: parseFloat(String(raw.CPUPerc || "").replace("%", "")) || 0, mem_usage_bytes: mem[0], mem_limit_bytes: mem[1], mem_percent: parseFloat(String(raw.MemPerc || "").replace("%", "")) || 0, net_rx_bytes: net[0], net_tx_bytes: net[1], block_read_bytes: block[0], block_write_bytes: block[1], pids: parseInt(String(raw.PIDs || "0"), 10) || 0 });
    }
    const disk = dockerSystemDf(run("docker system df"));
    return { containers: containers, disk: disk, running_count: containers.length, total_count: containers.length };
  }

  const first = cpuSample();
  if (first == null) {
    process.stdout.write(JSON.stringify({ available: false, error: "No /proc filesystem (not a Linux host?)" }));
    return;
  }
  const firstNet = netDev();
  const firstAt = Date.now();
  await sleep(200);
  const second = cpuSample();
  const secondNet = netDev();
  const secondAt = Date.now();

  const totalDelta = second.total - first.total;
  const idleDelta = second.idle - first.idle;
  const cpu = { usage_pct: totalDelta > 0 ? round(Math.min(100, Math.max(0, (1 - idleDelta / totalDelta) * 100))) : 0, load1: loadavg().load1, load5: loadavg().load5, load15: loadavg().load15, cores: second.cores, psi_cpu_some10: pressureCpu() };
  const mem = meminfo();
  const memUsed = Math.max(0, mem.total - mem.available);
  const out = {
    available: true,
    error: null,
    cpu: cpu,
    mem: { total_bytes: mem.total, used_bytes: memUsed, available_bytes: mem.available, usage_pct: mem.total > 0 ? round(memUsed / mem.total * 100) : 0, swap_total_bytes: mem.swapTotal, swap_used_bytes: Math.max(0, mem.swapTotal - mem.swapFree), buffers_bytes: mem.buffers, cached_bytes: mem.cached },
    disk: dfModern(run("df -k --output=source,size,used,avail,pcent,target")) || dfPosix(run("df -kP")),
    network: netRates(firstNet, secondNet, secondAt - firstAt),
    docker: dockerStats(),
    top_procs: topProcs(),
    uptime_seconds: uptimeSeconds()
  };
  process.stdout.write(JSON.stringify(out));
})();
`;

export function remoteCollectScriptBase64(): string {
  // `RemoteStats` is ASCII; Buffer is available in every Node the plugin supports.
  return Buffer.from(REMOTE_COLLECT_SCRIPT, "utf8").toString("base64");
}
