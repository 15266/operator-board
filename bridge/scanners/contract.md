# Local AI interface scanner contract

This is the **stable plugin interface** for discovering AI interfaces already
present on the operator machine (process, `PATH`, install directory, loopback
port). WorkBuddy, Codex, and Doubao are **example scanner plugins**, not a
closed list and must not be hard-coded in `operator-board/bridge/server.mjs`.

Machine-readable copies: `types.ts` (Operator Board / TypeScript) and
`contract.py` (pack / tests). Behavior must match this document.

A **scanner** only finds and describes an interface. It does not register a
channel, does not verify tools, and does not dispatch a task. Promotion into
an adapter instance / MCP channel is a **user** step and then follows
[`adapters/contract.md`](../adapters/contract.md) (`auth_ref` / `api_key_env`
are variable *names* only).

---

## 1. Why this module exists

New environments should automatically surface local AI interfaces so the user
usually only fills in a secret (or confirms a running session). Adding a new
AI to the discovery list means adding one scanner plugin (a folder + a
`registry.json` row). The host (`server.mjs` or a CLI) loops the registry; it
does not grow a vendor `if / else`.

---

## 2. Layers (do not collapse)

| Layer | What it is | Where it lives |
|---|---|---|
| Scanner plugin | How to *find* one class of local interface | `scanners/registry.json` + `scanners/<id>/` |
| Discovery record | One scan result, **no secret values** | ephemeral, or gitignored `scanners/results.json` |
| Adapter type + instance | How to *talk* to it after the user confirms | existing `adapters/` |
| Channel runtime | Probe / capability matrix / tool verification | existing MCP `channels` |
| Task executor | User-chosen channel id on a project task | existing `projects/` |

Discovery never writes `executor_channel_id`, never sets
`dispatch_state` to dispatched, and never sets `layers.tool_verify=verified`.

---

## 3. Manifest (every scanner plugin)

Required: `id`, `display_name`, `discover`, `endpoint`, `auth`, `probe`.

### 3.1 `discover` — how to look

Declare one or more locators. The loader runs only what is declared (no
wide port sweeps, no LAN scans).

| Locator | Purpose |
|---|---|
| `processes[]` | Match a running process by name / regex. Optional `read_env: true` allows reading named env keys from that process to detect a *session* (see auth). `name_regex` is always matched **case-insensitively**. Do **not** put Python-only inline flags such as `(?i)` in the pattern — they are illegal in JavaScript `RegExp`. Loaders must strip a leading `(?AiLmsux)` group if an older manifest still has one. |
| `path[]` | `which` / `where` for a command (`ollama`, `codex`, `codebuddy`). |
| `install_dirs[]` | Well-known directories with `${HOME}`, `${USERPROFILE}`, `${LOCALAPPDATA}`, `${APPDATA}`, `${env:NAME}` expansion, plus an optional `exists_file` to confirm the install. |
| `ports[]` | Loopback only by default (`127.0.0.1` / `localhost` / `::1`). `protocol` is `tcp` or `http` / `https` with optional `probe_path`. A locator may use a numeric `port`, and/or `from_env` (environment-variable **name** whose value is an already-observed port number, not a hardcoded default — e.g. WorkBuddy `WB_PORT`), and/or `from_process: true` (observe loopback listen ports of a process already matched by `processes[]`). When `from_process` is combined with `probe_path`, the loader may GET that path on each observed loopback port (connect-and-close only; not a chat; does not set `evidence.probe` or upgrade status to `reachable`) and **must keep only ports that respond**, so a process with many listeners cannot steal `base_url`. Declared hint ports remain fallbacks if no observed port responds. `role` is `primary` \| `fallback` \| `hint` \| `observed`. A declared number such as Doubao `9225` is a **hint**, not the only port: if the CDP port moved, `from_process` still finds it. No wide or LAN sweep. |
| `registry_keys[]` | Windows registry **read-only** (never written). |

At least one locator is required.

### 3.2 `endpoint` — shape after a hit

| Field | Notes |
|---|---|
| `transport` | Adapter transports plus `acp` (Agent Client Protocol): `cli` \| `http` \| `mcp` \| `desktop_bridge` \| `a2a` \| `acp`. WorkBuddy's verified talk path on the board is ACP; a plugin may still say `desktop_bridge` during migration. |
| `adapter` | Existing adapter type to promote into (e.g. `openai-compatible`, `workbuddy`). |
| `base_url_template` | e.g. `http://127.0.0.1:${port}` or `.../${port}/v1`. `${port}` is filled from an observed / `from_env` / `from_process` hit, never from a guessed default. Required when a promote draft needs a URL and the port is only known after discovery (WorkBuddy). Never includes a key. |
| `openai_compatible` | If true, typical paths are `/v1/models` and `/v1/chat/completions` unless `paths` overrides. |
| `paths` | Named routes (`health`, `models`, `chat`, `acp`, `tags`, …). |
| `working_directory_supported` | Hint only (e.g. WorkBuddy ACP). Not verification. |
| `cli_path_from` | Which locator supplies `cli_path`: `path` \| `install_dirs`. |

### 3.3 `auth` — secret or session, never raw values

| `mode` | Meaning |
|---|---|
| `none` | No user key required (typical local Ollama). |
| `user_secret` | User supplies a secret into an environment variable named by `auth_ref`. |
| `running_session` | A running process already holds a session (token/port in its env, or an equivalent local session). The scanner may detect *presence* and the bridge may copy values into **its own process env**. Values are never written to git, `results.json`, logs, or HTTP responses. |

`auth_ref` is the environment-variable **name** only (`WB_TOKEN`,
`OPENAI_API_KEY`). Same rule as adapters' `api_key_env`.

`running_session` does **not** mean "if `auth_ref` is unset, the user must
fill a key". `needs_user_secret` is true only when `auth.mode=user_secret`
(or when the manifest sets `needs_user_secret_if_ref_missing: true`).
Finding a process or binary is `found`, not `session_available`.
`session_available` only when session detection actually confirms the
declared keys **and** `session.infer_session` is not `false`.

Desktop login (for example Codex `auth.json`) is not inferred from process
presence and is not `session_available` until a dedicated check exists.
Codex keeps `auth_ref=CODEX_API_KEY` as an optional name; a missing
variable is not "needs a secret" and does not mean the CLI is uninstalled.

`session.env_keys` lists names to look up in the process or bridge env.
The discovery record may set `session_present: true|false` and must not
echo values.

### 3.4 `probe` — reachability only

| Field | Notes |
|---|---|
| `method` | `tcp_connect` \| `http_get` \| `http_post` \| `cli_version` \| `none` |
| `path` | HTTP path or CLI `--version` equivalent |
| `ok_when` | `status_2xx` \| `exit_0` \| `tcp_accept` |
| `timeout_ms` | Short; default 1000 |
| `live_default` | Always `false`. A scan does not spend quota and does not send a chat. |


A successful probe may upgrade discovery `status` to `reachable` (or
`session_available` / `needs_secret`). It must **not** set adapter
`chat_bridge=ok` or any tool verification. Listing models (e.g. Ollama
`GET /api/tags`) is inventory on the discovery record, not
`tool_inventory=ok` on a channel.

HTTP probes MAY send `Authorization: Bearer <value>` when `auth_ref`
already exists in the **bridge process environment**. The value must never
appear in discovery records, probe notes, or logs. Evidence may record at
most `authorization_from: "auth_ref"` (the literal string, not the name's
value). A health or ACP hit must not set `jobs_ok=true`.

### 3.4.1 `catalog` — model inventory after a find

When a scanner finds an interface (`status` is not `not_found`), the
loader requests a model catalog. This is inventory, not a reachability
probe and not `chat_bridge=ok`. It may run on the default `/bridge/scan`
(`live: false`) because it does not start services, does not send a chat,
and must not run `codex exec`.

The loader is registry-driven: it uses `catalog.paths`, or falls back to
`endpoint.paths.tags` then `endpoint.paths.models`. The host must not
grow a vendor if/else for catalog URLs.

| Field | Notes |
|---|---|
| `method` | `http_get` \| `none`. Default `http_get` when paths exist, otherwise `none`. |
| `paths` | HTTP paths tried in order against the discovered loopback origin (scheme + host + port, not a `/v1` suffix). |
| `current_model_path` | Optional HTTP path for the currently selected model only. |
| `current_model_file` / `current_model_key` | Optional local config file and key (`model` by default). Never `auth.json`. |
| `timeout_ms` | Short; default 1000 |
| `note` | Shown when there is no catalog API, or a request returned no names. |
| `published_models` | Optional official published names. Used only when a live local catalog did not return names. This is inventory, not `chat_bridge=ok`. |
| `published_source` | URL of the official docs or official file the names came from. |
| `published_as_of` | Date the names were checked, `YYYY-MM-DD`. |

A failed or missing catalog is a soft failure: the scan still succeeds.
`evidence.model_catalog` records whether a request was attempted and which
path worked. `evidence.model_names` is filled from a live catalog response
when one returns names. If that request is missing or empty, the loader may
copy `published_models` onto `evidence.model_names` and set
`model_catalog.source` to `published_docs` (with `published_source` /
`published_as_of`). A live local catalog still wins over the published
list, and `model_catalog.ok` stays true only for a successful live catalog
response — a published fallback must not set `ok` to true. `evidence.current_model`
is the selected model if found. These fields must not appear on a
`not_found` record. Listing models must not set `chat_bridge` or
`tools_verified`.

HTTP catalog requests MAY send `Authorization: Bearer <value>` when
`auth_ref` already exists in the bridge process environment. The value
must never appear in records or logs; evidence may record at most
`authorization_from: "auth_ref"`.


### 3.5 `safety` (defaults; the loader enforces them)

```
may_restart: false
may_kill: false
may_bind_port: false
may_start_if_stopped: false
```

Do not restart, kill, rebind, or launch WorkBuddy, Codex, Doubao, Unreal
Engine, or FlClash in order to "fix" a probe. If a port is already
listening, leave the process alone (same rule as dsh-doubao-bridge's
"already listening → do not kill"). If a port is down, record
`not_found` / not reachable; do not start the app.

Port checks are connect-and-close on declared loopback ports only.

---

## 4. Discovery status

| Status | When |
|---|---|
| `not_found` | No process, PATH, install dir, or declared port hit. |
| `found` | At least one locator hit; reachability not confirmed or not attempted. |
| `reachable` | Declared probe succeeded (HTTP/TCP/CLI version). |
| `needs_secret` | Found or reachable, but `auth.mode=user_secret` and the named env is not set. |
| `session_available` | `auth.mode=running_session`, `session.infer_session` is not `false`, and the declared session keys are actually present (values not stored). Process or PATH alone is `found`. Desktop login ≠ `session_available`. |

`tools_verified` on a discovery record is always `false`.
`chat_bridge` on a discovery record is always `unverified`.
`jobs_ok`, if present, is `false` unless a *jobs-specific* probe later exists
(health / ACP must not set it true).

Choosing a discovered interface in the UI is not a live connection and is
not a successful dispatch.

---

## 5. Host API (Operator Board bridge)

`server.mjs` must not contain vendor branches for discovery. It imports the
loader and exposes generic routes (names may be tweaked, contract stays):

| Route | Behavior |
|---|---|
| `GET /bridge/scanners` | `list_scanners()` — plugins in the registry (id, display_name, auth.mode, endpoint shape). |
| `POST /bridge/scan` | `scan_local({ live: false })` — run every plugin, return discovery records (no secrets). `live=true` must be rejected. |
| `POST /bridge/scan/probe` | Reachability probe for one `scanner_id`. Still not `chat_bridge=ok`. |
| `POST /bridge/scan/promote` | **User-confirmed** only: return an adapter instance **draft** (`auth_ref` name + endpoint, no secret values). Must not register a channel or dispatch. |

Existing `/bridge/health`, `/bridge/discover`, `/bridge/credentials`, and
dispatch adapters stay as they are in the first integration step (additive
routes; the two discovery APIs may coexist). If the UI switches from
`/bridge/discover` to `/bridge/scanners` + `/bridge/scan`, the field mapping
needs a pass with 可视化官. A later step may *compose* health from scan
records via optional `compat_health_key` on a manifest, still without
putting vendor `if` chains back into `server.mjs`. Dispatch
(`adapterWorkBuddy*` / `adapterCodex` / `adapterDoubao`) is a separate
executor plugin split and is **not** required to land in the same change.

---

## 6. Hard rules (implementations must enforce)

1. **Discovery ≠ connected ≠ verified.** Found or reachable does not set
   `chat_bridge=ok` or `tool_verify=verified`.
2. **Listing models or routes ≠ tool verification.**
3. **No secrets in the tree, scan results, logs, or HTTP bodies.**
   `auth_ref` / `api_key_env` / `session.env_keys` / `from_env` are names.
   Values stay in process environment only. A probe may use a bearer from
   the bridge env; it must not write that value into a record or log line.
4. **No vendor list in the host.** New AI = new `scanners/<id>/` + registry
   row. The host only loops plugins.
5. **Loopback, declared ports only.** No full-range port scan, no bind, no
   LAN sweep unless a future manifest explicitly opts in (default off).
6. **Do not disturb running apps.** No restart / kill / rebind / auto-start
   of WorkBuddy, Codex, Doubao, UE, FlClash, or the discovered process.
7. **Do not treat a known default port as free to bind.** Example: do not
   assume WorkBuddy's desktop port is available; only *observe* a port if
   it is already listening.
8. **Jobs vs ACP (WorkBuddy).** A health or ACP hit must not mark the jobs
   API working. If jobs are known broken, say so in `notes`, not as
   `verified`.
9. **User promotion only.** The scanner does not auto-register a channel or
   auto-pick an executor.
10. **Skeleton / plugin folder ≠ live link.**

`apply_discovery_hard_rules()` in `contract.py` is the shared guard.

---

## 7. How to add a scanner

1. `cp -R scanners/_template scanners/<id>`
2. Fill `manifest.json` (locators, endpoint shape, auth mode, probe, safety).
   Most plugins need **only** the manifest — the loader runs declared locators.
3. Add `README.md`: how it is found, whether the user must set a key, what
   this plugin **does not** claim.
4. Custom `scanner.py` / `scanner.mjs` only when the generic locators are not
   enough (`create()` must still pass validation).
5. `python3 -m scanners register --id <id>` (validates, then writes
   `registry.json`). Failure does not modify the registry.

Then the next `GET /bridge/scanners` / `POST /bridge/scan` includes it. No
edit to `server.mjs`.

---

## 8. Learned from upstream implementations (citations, not live links)

Citing a repo is not a claim of a live integration or verified tools.

| Repo (commit / blob) | Source read | What we take | What we do not copy |
|---|---|---|---|
| [home-assistant/core](https://github.com/home-assistant/core) (`94f471d6c8cb` and current `loader.py` / `config_entries.py`) | `Manifest` declares `zeroconf` / `dhcp` / `ssdp` / `usb`; discovery starts a **config flow**; the user confirms before a config entry exists | Each plugin *declares* how it can be found; discovery ≠ configured connection; adding an integration is a folder + manifest, not a core if-chain | We are not implementing mDNS/DHCP. We do not auto-create a channel from a hit. |
| [continuedev/continue](https://github.com/continuedev/continue) (`cb273098`, `core/llm/llms/Ollama.ts`) | `defaultOptions.apiBase = "http://localhost:11434/"`; model list via `GET /api/tags`; `AUTODETECT` is a sentinel, not a real model (do not query `/api/show` for it) | Declare a default loopback base; listing local models is detection/inventory | Do not treat `/api/tags` as tool verification or `chat_bridge=ok`. Do not start Ollama if it is stopped. |
| [open-webui/open-webui](https://github.com/open-webui/open-webui) (`97ca2144be4f`, `backend/open_webui/config.py` `_resolve_ollama_base_url`) | If the user did not set a URL, try declared port `11434`, and only if that is down try declared fallback `12434`. Connections UI has a separate verify action. | Only **declared** ports; optional explicit fallback port; verify is a later step | Do not store raw API keys in JSON the way connection configs might. We only store `auth_ref` names. |

The adapter registry lessons in `MODULES.md` §7 (pluggy hookspec vs hookimpl,
LangChain delayed provider map, LiteLLM custom provider, HA `manifest.json`)
still apply: validate before writing the registry; do not add a vendor enum
in the host.
