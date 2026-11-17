import { probeAccess } from "../access-probe.mjs";
/**
 * Operator Board scanner loader (Node). Import from bridge/server.mjs:
 *
 *   import { listScanners, scanLocal, handleScanHttp } from "./scanners/loader.mjs";
 *
 * The host must not grow a vendor if/else. New AI = add scanners/<id>/manifest.json
 * and a registry row.
 *
 * This file is a drop-in copy target for operator-board/bridge/scanners/.
 * The shared pack's loader.mjs is catalog-only; this board copy keeps scanLocal,
 * createLiveHost, and the live locators. Do not overwrite it with the short pack file.
 * Safety: never restart/kill/bind; never put secret values in responses.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = process.env.ORCH_SCANNER_REGISTRY || path.join(HERE, "registry.json");

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const SECRET_VALUE = /^(sk-|ghp_|github_pat_|xox[baprs]-|Bearer\s+|eyJ[A-Za-z0-9_-]{20,}\.)/;
const TRANSPORTS = new Set(["cli", "http", "mcp", "desktop_bridge", "a2a", "acp"]);
const AUTH_MODES = new Set(["none", "user_secret", "running_session"]);

export class ScannerContractError extends Error {}

/** Strip Python-only inline flags such as (?i). Matching is always case-insensitive. */
export function normalizeNameRegex(pattern) {
  if (!pattern) return pattern;
  return String(pattern).replace(/^\(\?[AiLmsux]+\)/, "").replace(/\(\?i\)/g, "");
}

function looksLikeSecretValue(value) {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text) return false;
  if (SECRET_VALUE.test(text)) return true;
  return false;
}

export function assertNoSecrets(obj, p = "$") {
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => assertNoSecrets(item, `${p}[${i}]`));
    return;
  }
  if (obj && typeof obj === "object") {
    for (const [key, value] of Object.entries(obj)) {
      if (["auth_ref", "api_key_env", "from_env"].includes(key) && typeof value === "string" && value && !ENV_NAME.test(value)) {
        throw new ScannerContractError(`${p}.${key} must be an environment-variable name`);
      }
      if (typeof value === "string" && looksLikeSecretValue(value)) {
        throw new ScannerContractError(`${p}.${key} looks like a secret value`);
      }
      assertNoSecrets(value, `${p}.${key}`);
    }
  }
}

export function validateManifest(manifest) {
  for (const field of ["id", "display_name", "discover", "endpoint", "auth", "probe"]) {
    if (!manifest?.[field]) throw new ScannerContractError(`manifest missing ${field}`);
  }
  const locators = manifest.discover;
  if (![locators.processes, locators.path, locators.install_dirs, locators.ports, locators.registry_keys].some((x) => x && x.length)) {
    throw new ScannerContractError("discover must declare at least one locator");
  }
  for (const port of locators.ports || []) {
    const host = port.host || "127.0.0.1";
    if (!LOOPBACK.has(host)) throw new ScannerContractError(`ports may only target loopback, got ${host}`);
    if (port.from_env != null && (typeof port.from_env !== "string" || !ENV_NAME.test(port.from_env))) {
      throw new ScannerContractError("ports.from_env must be an environment-variable name");
    }
    const hasPort = port.port != null;
    if (hasPort && !(Number.isInteger(port.port) && port.port >= 1 && port.port <= 65535)) {
      throw new ScannerContractError("port must be an int 1-65535");
    }
    if (!hasPort && !port.from_env && !port.from_process) {
      throw new ScannerContractError("ports[] needs a numeric port, or from_env, or from_process");
    }
  }
  if (!TRANSPORTS.has(manifest.endpoint.transport)) throw new ScannerContractError("bad transport");
  if (!AUTH_MODES.has(manifest.auth.mode)) throw new ScannerContractError("bad auth.mode");
  if (manifest.auth.mode === "user_secret" && !manifest.auth.auth_ref) {
    throw new ScannerContractError("user_secret requires auth_ref");
  }
  if (manifest.probe.live_default !== false) throw new ScannerContractError("probe.live_default must be false");
  const safety = { may_restart: false, may_kill: false, may_bind_port: false, may_start_if_stopped: false, ...(manifest.safety || {}) };
  for (const k of ["may_restart", "may_kill", "may_bind_port", "may_start_if_stopped"]) {
    if (safety[k] !== false) throw new ScannerContractError(`safety.${k} must be false`);
  }
  assertNoSecrets(manifest);
  return { ...manifest, safety };
}

function loadRegistry(registryPath = REGISTRY_PATH) {
  return JSON.parse(fs.readFileSync(registryPath, "utf8"));
}

function loadManifest(dir) {
  return validateManifest(JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")));
}

export function listScanners(registryPath = REGISTRY_PATH) {
  const registry = loadRegistry(registryPath);
  const root = path.dirname(registryPath);
  return registry.scanners.filter((entry) => entry.id !== "_template").map((entry) => {
    const rel = (entry.module || `scanners/${entry.id}`).replace(/^scanners\//, "");
    const manifest = loadManifest(path.join(root, rel));
    return {
      id: manifest.id,
      display_name: manifest.display_name,
      module: entry.module,
      status: entry.status || "skeleton",
      auth_mode: manifest.auth.mode,
      auth_ref: manifest.auth.auth_ref || null,
      transport: manifest.endpoint.transport,
      adapter: manifest.endpoint.adapter || null,
      notes: manifest.notes || entry.notes || null,
      compat_health_key: manifest.compat_health_key || null,
    };
  });
}

/** HTTP helper used by server.mjs. Never writes secrets. */
export function handleScanHttp(url, method, send) {
  const pathname = typeof url === "string" ? new URL(url, "http://127.0.0.1").pathname : url.pathname;
  if (method === "GET" && pathname === "/bridge/scanners") {
    return send(200, { scanners: listScanners() });
  }
  return null; // caller handles POST /bridge/scan with a HostContext
}


import net from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const DISCOVERY_STATUSES = new Set(["not_found", "found", "reachable", "needs_secret", "session_available"]);

function hasHit(evidence) {
  return Boolean(
    (evidence.process_names && evidence.process_names.length)
    || (evidence.path_hits && evidence.path_hits.length)
    || (evidence.install_dirs && evidence.install_dirs.length)
    || (evidence.open_ports && evidence.open_ports.length)
  );
}

export function initialStatus(evidence, probeOk = null) {
  if (probeOk) return "reachable";
  if (hasHit(evidence)) return "found";
  return "not_found";
}

export function applyDiscoveryHardRules(record, manifest = null) {
  assertNoSecrets(record);
  const out = { ...record, tools_verified: false, chat_bridge: "unverified" };
  let status = out.status;
  if (!DISCOVERY_STATUSES.has(status)) throw new ScannerContractError(`invalid discovery status: ${status}`);
  const evidence = { ...(out.evidence || {}) };
  const catalogOk = Boolean(evidence.model_catalog && evidence.model_catalog.ok);
  if (status === "not_found" && (evidence.model_names || evidence.current_model || catalogOk)) {
    throw new ScannerContractError("model catalog fields cannot appear on a not_found record");
  }
  const probe = evidence.probe || {};
  if ((status === "reachable" || status === "session_available") && probe && probe.ok === false) {
    status = hasHit(evidence) ? "found" : "not_found";
  }
  const authIn = { ...(out.auth || {}) };
  const mode = authIn.mode || manifest?.auth?.mode || "none";
  if (!AUTH_MODES.has(mode)) throw new ScannerContractError(`invalid auth.mode: ${mode}`);
  let session_present = Boolean(authIn.session_present || evidence.session_present);
  let needs_user_secret = Boolean(authIn.needs_user_secret ?? (mode === "user_secret" && !session_present));
  if (status === "not_found") needs_user_secret = false;
  else if (mode === "user_secret" && needs_user_secret) status = "needs_secret";
  else if (mode === "running_session" && session_present && ["found", "reachable", "needs_secret", "session_available"].includes(status)) {
    status = "session_available";
    needs_user_secret = false;
  } else {
    needs_user_secret = Boolean(mode === "user_secret" && needs_user_secret);
  }
  const auth_ref = authIn.auth_ref || manifest?.auth?.auth_ref || null;
  if (auth_ref && !ENV_NAME.test(auth_ref)) throw new ScannerContractError("auth_ref must be an environment-variable name");
  out.status = status;
  out.evidence = evidence;
  out.auth = { mode, auth_ref, session_present, needs_user_secret };
  out.tools_verified = false;
  out.chat_bridge = "unverified";
  const jobsProbe = evidence.jobs?.ok;
  // A health / ACP hit must never mark jobs working.
  if (jobsProbe === true || "jobs_ok" in out || jobsProbe === false) {
    out.jobs_ok = false;
  }
  if (manifest?.id === "workbuddy") {
    const extra = "jobs 仍不可用（EADDRINUSE / 与 GUI serve 抢端口）。探活或 ACP 成功也不能写成 jobs 已核实。";
    if (!String(out.notes || "").includes("jobs")) out.notes = [out.notes, extra].filter(Boolean).join(" ");
    if (out.jobs_verified) throw new ScannerContractError("jobs must not be marked verified");
    out.jobs_ok = false;
  }
  assertNoSecrets(out);
  return out;
}

function matchProcess(matcher, names) {
  const hits = [];
  const raw = matcher.name || "";
  const rx = matcher.name_regex ? new RegExp(normalizeNameRegex(matcher.name_regex), "i") : null;
  for (const name of names) {
    if (rx && rx.test(name)) { hits.push(name); continue; }
    if (raw && (name.toLowerCase() === raw.toLowerCase() || name.toLowerCase().startsWith(raw.toLowerCase()))) hits.push(name);
  }
  return hits;
}

function fillEndpoint(manifest, evidence) {
  const shape = { ...manifest.endpoint };
  const ports = evidence.open_ports || [];
  if (shape.base_url_template && ports.length) {
    const preferred = ports.find((p) => p.source === "from_env")
      || ports.find((p) => p.source === "process")
      || ports[0];
    shape.base_url = shape.base_url_template.replace("${port}", String(preferred.port));
  }
  if (evidence.path_hits?.length && shape.cli_path_from === "path") shape.cli_path = evidence.path_hits[0];
  else if (evidence.install_dirs?.length && shape.cli_path_from === "install_dirs") shape.cli_path = evidence.install_dirs[0];
  return shape;
}

function portFromEnv(name) {
  const raw = process.env[name];
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return null;
  return n;
}

async function runProbe(manifest, evidence, host, timeout) {
  const method = manifest.probe.method;
  if (method === "tcp_connect") {
    const ok = Boolean(evidence.open_ports?.length);
    return { ok, info: { method, ok, note: "tcp connect-and-close only" } };
  }
  if (method === "http_get" || method === "http_post") {
    let pathName = manifest.probe.path || "/";
    let ports = evidence.open_ports || [];
    if (!ports.length) {
      for (const loc of manifest.discover.ports || []) {
        const hostName = loc.host || "127.0.0.1";
        let port = loc.port;
        if (loc.from_env) port = host.port_from_env(loc.from_env);
        if (!port) continue;
        if (loc.probe_path) pathName = loc.probe_path;
        const res = await host.http_get(`http://${hostName}:${port}${pathName}`, timeout, { auth_ref: manifest.auth?.auth_ref });
        if (res.ok) {
          evidence.open_ports = evidence.open_ports || [];
          evidence.open_ports.push({ host: hostName, port: Number(port) });
          const info = { method, ok: true, note: `GET ${pathName}` };
          if (res.model_names) info.model_names = res.model_names;
          return { ok: true, info };
        }
      }
      return { ok: false, info: { method, ok: false, note: "no declared or observed port responded" } };
    }
    const res = await host.http_get(`http://${ports[0].host}:${ports[0].port}${pathName}`, timeout, { auth_ref: manifest.auth?.auth_ref });
    const info = { method, ok: Boolean(res.ok), note: `GET ${pathName}` };
    if (res.model_names) info.model_names = res.model_names;
    return { ok: Boolean(res.ok), info };
  }
  if (method === "cli_version") {
    const result = await probeAccess({ id: manifest.id });
      const ok = result.status === "version_ok";
      return { ok, info: { method, ok, note: ok ? `CLI 版本 ${result.version}；登录与任务执行尚未验证` : result.missing } };
  }
  return { ok: false, info: { method, ok: false, note: "no probe" } };
}


const SECRETISH_MODEL = /^(sk-|ghp_|github_pat_|xox[baprs]-|Bearer\s+|eyJ[A-Za-z0-9_-]{20,}\.)/;
const SIMPLE_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

function safeModelName(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > 80) return null;
  if (SECRETISH_MODEL.test(text)) return null;
  return text;
}

function extractCurrentModel(payload) {
  if (!payload || typeof payload !== "object") return null;
  const direct = safeModelName(payload.model);
  if (direct) return direct;
  const data = payload.data;
  if (data && typeof data === "object") {
    const fromModel = safeModelName(data.model);
    if (fromModel) return fromModel;
    const fromValue = safeModelName(data.value);
    if (fromValue) return fromValue;
  }
  return safeModelName(payload.value);
}

function catalogPaths(manifest) {
  const catalog = manifest.catalog || {};
  const paths = [];
  for (const item of catalog.paths || []) {
    if (typeof item === "string" && item.startsWith("/")) paths.push(item);
  }
  const endpointPaths = manifest.endpoint?.paths || {};
  for (const key of ["tags", "models"]) {
    const item = endpointPaths[key];
    if (typeof item === "string" && item.startsWith("/") && !paths.includes(item)) paths.push(item);
  }
  return paths;
}

function extractKeyFromText(text, key) {
  if (!SIMPLE_KEY.test(key)) return null;
  const rx = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*"?([^"\\r\\n#]+?)"?\\s*(?:#.*)?$`, "m");
  const match = String(text || "").match(rx);
  return match ? safeModelName(match[1].trim()) : null;
}


function publishedModelNames(catalog) {
  const raw = catalog.published_models || [];
  const names = [];
  const seen = new Set();
  for (const item of raw) {
    const name = safeModelName(item);
    if (name && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

function applyPublishedModels(catalog, evidence, model_catalog) {
  if (evidence.model_names && evidence.model_names.length) {
    if (!model_catalog.source) model_catalog.source = "local_http";
    return;
  }
  const names = publishedModelNames(catalog);
  if (!names.length) return;
  evidence.model_names = names;
  model_catalog.source = "published_docs";
  if (catalog.published_source) model_catalog.published_source = catalog.published_source;
  if (catalog.published_as_of) model_catalog.published_as_of = catalog.published_as_of;
  const extra = "Filled from official published model list; not a live local catalog.";
  const note = model_catalog.note || catalog.note;
  model_catalog.note = note ? `${note} ${extra}` : extra;
}

async function runCatalog(manifest, evidence, host, timeout) {
  const catalog = manifest.catalog || {};
  const paths = catalogPaths(manifest);
  let method = catalog.method;
  if (!method) method = paths.length ? "http_get" : "none";
  timeout = Number(catalog.timeout_ms || timeout || 1000);
  const ports = evidence.open_ports || [];
  let origin = null;
  if (ports.length) {
    let hostName = ports[0].host || "127.0.0.1";
    if (hostName === "localhost") hostName = "127.0.0.1";
    origin = `http://${hostName}:${Number(ports[0].port)}`;
  }
  let model_catalog = {};
  const auth_ref = manifest.auth?.auth_ref || null;
  if (method === "http_get" && paths.length) {
    if (!origin) {
      model_catalog = { attempted: false, note: "no discovered port to request catalog" };
    } else {
      const tried = [];
      let foundNames = null;
      let usedPath = null;
      for (const pathName of paths) {
        const res = await host.http_get(`${origin}${pathName}`, timeout, { auth_ref });
        tried.push({ path: pathName, ok: Boolean(res.ok), status: res.status });
        const names = (res.model_names || []).map(safeModelName).filter(Boolean);
        if (res.ok && names.length) {
          foundNames = names;
          usedPath = pathName;
          break;
        }
      }
      if (foundNames) {
        evidence.model_names = foundNames;
        model_catalog = { attempted: true, ok: true, path: usedPath };
        if (auth_ref && host.env_present(auth_ref)) model_catalog.authorization_from = "auth_ref";
      } else {
        model_catalog = {
          attempted: true,
          ok: false,
          tried,
          note: catalog.note || "catalog request did not return model names",
        };
      }
    }
  } else {
    model_catalog = { attempted: false, note: catalog.note || "no catalog API declared" };
  }

  const currentPath = catalog.current_model_path;
  if (typeof currentPath === "string" && currentPath.startsWith("/") && origin) {
    const res = await host.http_get(`${origin}${currentPath}`, timeout, { auth_ref });
    let current = null;
    if (res.ok) current = safeModelName(res.current_model) || extractCurrentModel(res.json);
    if (current) {
      evidence.current_model = current;
      model_catalog.current_model_path = currentPath;
    }
  }

  const currentFile = catalog.current_model_file;
  const currentKey = catalog.current_model_key || "model";
  if (typeof currentFile === "string" && currentFile) {
    const normalized = currentFile.replaceAll("\\", "/");
    if (!normalized.toLowerCase().includes("auth.json") && typeof host.read_text === "function") {
      const raw = await host.read_text(host.expand(currentFile));
      if (typeof raw === "string") {
        const current = extractKeyFromText(raw, currentKey);
        if (current) {
          evidence.current_model = current;
          model_catalog.current_model_from = "config_file";
        }
      }
    }
  }

  applyPublishedModels(catalog, evidence, model_catalog);
  evidence.model_catalog = model_catalog;
}

export async function discoverOne(manifest, host, { probe = false } = {}) {
  manifest = validateManifest(manifest);
  const evidence = {};
  const names = await host.list_process_names();
  const procHits = [];
  let session_present = false;
  for (const matcher of manifest.discover.processes || []) {
    const hits = matchProcess(matcher, names);
    procHits.push(...hits);
    const keys = manifest.auth?.session?.env_keys || [];
    if (matcher.read_env && hits.length && keys.length) {
      for (const h of hits) {
        if (await host.process_env_present(h, keys)) { session_present = true; break; }
      }
    }
  }
  if (procHits.length) evidence.process_names = [...new Set(procHits)];
  const pathHits = [];
  for (const loc of manifest.discover.path || []) {
    const found = await host.which(loc.command);
    if (found) pathHits.push(found);
  }
  if (pathHits.length) evidence.path_hits = pathHits;
  const installHits = [];
  for (const loc of manifest.discover.install_dirs || []) {
    const expanded = host.expand(loc.path);
    const check = loc.exists_file ? path.join(expanded, loc.exists_file) : expanded;
    if (await host.path_exists(check) || await host.path_exists(expanded)) {
      installHits.push(loc.exists_file ? check : expanded);
    }
  }
  if (installHits.length) evidence.install_dirs = installHits;
  const timeout = Number(manifest.probe?.timeout_ms || 1000);
  const openPorts = [];
  const addPort = (hostName, port, source) => {
    const recHost = hostName === "localhost" ? "127.0.0.1" : hostName;
    if (!LOOPBACK.has(recHost)) return;
    const n = Number(port);
    if (!Number.isInteger(n) || n < 1 || n > 65535) return;
    if (openPorts.some((p) => p.host === recHost && p.port === n)) return;
    const rec = { host: recHost, port: n, source };
    if (source === "from_env" || source === "process") openPorts.unshift(rec);
    else openPorts.push(rec);
  };
  for (const loc of manifest.discover.ports || []) {
    const hostName = loc.host || "127.0.0.1";
    if (loc.from_env) {
      const observed = (host.env_port || host.port_from_env)(loc.from_env);
      if (observed != null && await host.port_open(hostName, observed, timeout)) addPort(hostName, observed, "from_env");
    }
    if (loc.from_process) {
      for (const procName of evidence.process_names || []) {
        const listened = host.process_listen_ports ? await host.process_listen_ports(procName) : [];
        let checked = 0;
        for (const item of listened || []) {
          if (checked >= 12) break;
          const h = item.host || "127.0.0.1";
          const port = item.port;
          if (!(Number.isInteger(port) && port >= 1 && port <= 65535)) continue;
          checked += 1;
          if (loc.probe_path) {
            const res = await host.http_get(`http://${h === "localhost" ? "127.0.0.1" : h}:${port}${loc.probe_path}`, Math.min(timeout, 400));
            if (!res.ok) continue;
          } else if (!(await host.port_open(h, port, timeout))) {
            continue;
          }
          addPort(h, port, "process");
        }
      }
    }
    if (loc.port != null) {
      if (await host.port_open(hostName, loc.port, timeout)) addPort(hostName, loc.port, "declared");
    }
  }
  if (openPorts.length) evidence.open_ports = openPorts;

  const auth = manifest.auth;
  const inferSession = (auth.session || {}).infer_session;
  if (inferSession === false) session_present = false;
  if (auth.mode === "running_session" && inferSession !== false) {
    const keys = auth.session?.env_keys || (auth.auth_ref ? [auth.auth_ref] : []);
    const source = auth.session?.source || "bridge_env";
    if (source === "bridge_env" && keys.length && keys.every((k) => host.env_present(k))) session_present = true;
    if (session_present) evidence.session_present = true;
  }

  let probeOk = null;
  if (probe && manifest.probe.method !== "none") {
    const ran = await runProbe(manifest, evidence, host, timeout);
    probeOk = ran.ok;
    evidence.probe = ran.info;
    if (probeOk && ["http_get", "http_post"].includes(manifest.probe.method) && ran.info.model_names) {
      evidence.model_names = ran.info.model_names;
    }
  }

  if (initialStatus(evidence, probe ? probeOk : null) !== "not_found") {
    await runCatalog(manifest, evidence, host, timeout);
  }

  const record = {
    scanner_id: manifest.id,
    display_name: manifest.display_name,
    status: initialStatus(evidence, probe ? probeOk : null),
    evidence,
    endpoint: fillEndpoint(manifest, evidence),
    auth: {
      mode: auth.mode,
      auth_ref: auth.auth_ref || null,
      session_present,
      needs_user_secret: auth.mode === "user_secret" && !host.env_present(auth.auth_ref || ""),
    },
    tools_verified: false,
    chat_bridge: "unverified",
    notes: manifest.notes,
  };
  return applyDiscoveryHardRules(record, manifest);
}

export async function scanLocal(host, { probe = false, scanner_id = null, registryPath = REGISTRY_PATH } = {}) {
  const registry = loadRegistry(registryPath);
  const root = path.dirname(registryPath);
  const records = [];
  for (const entry of registry.scanners) {
    if (entry.id === "_template") continue;
    if (scanner_id && entry.id !== scanner_id) continue;
    const rel = (entry.module || `scanners/${entry.id}`).replace(/^scanners\//, "");
    const manifest = loadManifest(path.join(root, rel));
    records.push(await discoverOne(manifest, host, { probe }));
  }
  return records;
}

export function promoteDraft(record) {
  if (!record || record.status === "not_found") {
    return { ok: false, error: "interface not found; cannot promote" };
  }
  if (record.auth?.needs_user_secret || record.status === "needs_secret") {
    return { ok: false, error: "needs_secret; fill the named env var before promoting" };
  }
  const draft = {
    scanner_id: record.scanner_id,
    adapter: record.endpoint?.adapter || null,
    transport: record.endpoint?.transport || null,
    endpoint: { base_url: record.endpoint?.base_url || null, cli_path: record.endpoint?.cli_path || null },
    auth_ref: record.auth?.auth_ref || null,
    auth_mode: record.auth?.mode || null,
    tools_verified: false,
    chat_bridge: "unverified",
    notes: "User-confirmed draft only. Not a registered channel and not a successful dispatch.",
  };
  if (record.scanner_id === "workbuddy") {
    draft.jobs_ok = false;
    draft.notes += " WorkBuddy jobs remain broken (EADDRINUSE); do not mark jobs verified.";
  }
  assertNoSecrets(draft);
  return { ok: true, draft };
}

function portOpen(host, port, timeoutMs) {
  const h = host || "127.0.0.1";
  if (!LOOPBACK.has(h)) return Promise.resolve(false);
  return new Promise((resolve) => {
    const sock = net.connect({ host: h, port: Number(port) });
    const t = setTimeout(() => { sock.destroy(); resolve(false); }, timeoutMs || 1000);
    sock.once("connect", () => { clearTimeout(t); sock.end(); sock.destroy(); resolve(true); });
    sock.once("error", () => { clearTimeout(t); sock.destroy(); resolve(false); });
  });
}

function extractModelNames(json) {
  if (!json || typeof json !== "object") return [];
  if (Array.isArray(json.models)) return json.models.map((m) => m.name || m.model).filter(Boolean);
  if (Array.isArray(json.data)) return json.data.map((m) => m.id).filter(Boolean);
  return [];
}

const SYSTEM_PORTS = new Set([135, 137, 138, 139, 445, 593, 902, 912, 5357, 7680]);

export function createLiveHost() {
  let processCache = null;
  let listenCache = null;
  return {
    async list_process_names() {
      if (processCache) return processCache;
      if (process.platform === "win32") {
        const { stdout } = await execFileP("powershell.exe", [
          "-NoProfile", "-Command",
          "Get-CimInstance Win32_Process | ForEach-Object { $_.Name }",
        ], { timeout: 20000, windowsHide: true });
        processCache = String(stdout).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        return processCache;
      }
      const { stdout } = await execFileP("ps", ["-eo", "comm="], { timeout: 10000 });
      processCache = String(stdout).split(/\n/).map((s) => s.trim()).filter(Boolean);
      return processCache;
    },
    async which(command) {
      try {
        const cmd = process.platform === "win32" ? "where.exe" : "which";
        const { stdout } = await execFileP(cmd, [command], { timeout: 5000, windowsHide: true });
        const line = String(stdout).split(/\r?\n/).map((s) => s.trim()).find(Boolean);
        return line || null;
      } catch {
        return null;
      }
    },
    async path_exists(p) {
      try { return fs.existsSync(p); } catch { return false; }
    },
    async port_open(host, port, timeoutMs) { return portOpen(host, port, timeoutMs); },
    async http_get(url, timeoutMs, opts = {}) {
      try {
        const u = new URL(url);
        if (!LOOPBACK.has(u.hostname)) return { ok: false, status: 0, note: "loopback only" };
        const headers = {};
        const ref = opts.auth_ref;
        if (ref && ENV_NAME.test(ref) && process.env[ref]) {
          headers.Authorization = "Bearer " + process.env[ref];
        }
        const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs || 1000), headers });
        let model_names;
        let json;
        const ct = r.headers.get("content-type") || "";
        if (ct.includes("json")) {
          try {
            json = await r.json();
            model_names = extractModelNames(json);
          } catch { /* ignore body */ }
        }
        const out = { ok: r.ok, status: r.status };
        if (model_names?.length) out.model_names = model_names;
        if (json && typeof json === "object") out.json = json;
        return out;
      } catch (e) {
        return { ok: false, status: 0, note: "probe failed" };
      }
    },
    env_present(name) { return Boolean(process.env[name]); },
    port_from_env(name) { return portFromEnv(name); },
    env_port(name) { return portFromEnv(name); },
    async process_listen_ports(processName) {
      const wanted = String(processName || "").replace(/\.exe$/i, "").toLowerCase();
      if (!wanted) return [];
      if (!listenCache) {
        listenCache = [];
        try {
          if (process.platform === "win32") {
            const script = [
              "$skip = @(135,137,138,139,445,593,902,912,5357,7680);",
              "$rows = @();",
              "$conns = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -in @('127.0.0.1','::1','0.0.0.0','::') -and $skip -notcontains [int]$_.LocalPort };",
              "$map = @{};",
              "foreach ($id in ($conns.OwningProcess | Select-Object -Unique)) { $p = Get-Process -Id $id -ErrorAction SilentlyContinue; if ($p) { $map[$id] = $p.ProcessName } }",
              "foreach ($c in $conns) { $n = $map[$c.OwningProcess]; if ($n) { $rows += [PSCustomObject]@{ name = [string]$n; port = [int]$c.LocalPort; host = '127.0.0.1' } } }",
              "if ($rows.Count) { $rows | ConvertTo-Json -Compress } else { '[]' }",
            ].join(" ");
            const { stdout } = await execFileP("powershell.exe", ["-NoProfile", "-Command", script], { timeout: 20000, windowsHide: true });
            const raw = String(stdout).trim() || "[]";
            const parsed = JSON.parse(raw);
            listenCache = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
          }
        } catch {
          listenCache = [];
        }
      }
      return listenCache
        .filter((row) => String(row.name || "").replace(/\.exe$/i, "").toLowerCase() === wanted)
        .filter((row) => Number.isInteger(row.port) && !SYSTEM_PORTS.has(row.port))
        .map((row) => ({ host: row.host || "127.0.0.1", port: Number(row.port) }));
    },
    async process_env_present(_processName, keys) {
      // Values are not read here. Presence is inferred from the bridge env
      // after start-bridge.ps1 has copied named session keys into this process.
      return keys.every((k) => Boolean(process.env[k]));
    },
    async read_text(p, maxBytes = 65536) {
      try {
        const expanded = this.expand(p);
        const norm = String(expanded || "").replaceAll("\\", "/");
        if (!expanded || /auth\.json$/i.test(norm)) return null;
        const st = fs.statSync(expanded);
        if (!st.isFile() || st.size > maxBytes) return null;
        return fs.readFileSync(expanded, "utf8");
      } catch {
        return null;
      }
    },
    expand(p) {
      const home = process.env.USERPROFILE || process.env.HOME || "";
      const map = {
        "${HOME}": home,
        "${USERPROFILE}": process.env.USERPROFILE || home,
        "${LOCALAPPDATA}": process.env.LOCALAPPDATA || "",
        "${APPDATA}": process.env.APPDATA || "",
      };
      let out = p;
      for (const [k, v] of Object.entries(map)) out = out.replaceAll(k, v);
      out = out.replace(/\$\{env:([A-Z0-9_]+)\}/g, (_, n) => process.env[n] || "");
      out = out.replace(/%([A-Z0-9_]+)%/g, (m, n) => process.env[n] || m);
      return out;
    },
  };
}

export default { listScanners, validateManifest, assertNoSecrets, handleScanHttp, normalizeNameRegex, scanLocal, discoverOne, createLiveHost, promoteDraft, applyDiscoveryHardRules };
