# Connections learnings: Open WebUI, Continue, LibreChat

Sourced notes for a Windows operator board that must auto-discover local AI backends, expose `GET /bridge/discover` (plus a refresh), ask for a secret only when an interface was found but credentials are missing, and store only `auth_ref` / environment variable **names** — never secret values in state, logs, or git.

This document does **not** claim that any of these projects is installed or connected on the operator machine. Citations are from public `main` as fetched on 2026-11-11 (Asia/Shanghai). Local copies of the cited files live under `/workspace/_upstream/{open-webui,continue,LibreChat}` for line-accurate review. Nothing here was pushed.

| Project | Repo | `main` HEAD at fetch |
|---|---|---|
| Open WebUI | https://github.com/open-webui/open-webui | `b0e6098e940942281d9c83f3529ea117287a3a22` |
| Continue | https://github.com/continuedev/continue | `5522c6f44ca0ac3528b37244818fbfa39b5af470` |
| LibreChat | https://github.com/danny-avila/LibreChat | `e6567c7a681ce67869dce31486a21d3a25d6931b` |

Blob URLs below pin those SHAs. Line ranges refer to the fetched files.

---

## 1) Open WebUI — Connections, Ollama default host, OpenAI-compatible keys, verify vs assumed-up

### What it actually does

**Default Ollama host, with a narrow auto-resolve.** `OLLAMA_BASE_URL` may be empty, `/ollama` (Docker), or a user-supplied URL. In `prod`, `/ollama` is rewritten to `http://localhost:11434` (all-in-one Docker) or `http://host.docker.internal:11434` (Ollama on the host), or a Kubernetes service URL.

When the user did **not** set an explicit `OLLAMA_BASE_URL` / `OLLAMA_BASE_URLS`, `_resolve_ollama_base_url` TCP-probes the hostname on **11434** and fallback **12434** (1s timeout, in parallel). If 11434 is down and 12434 is up, the URL’s port is rewritten. If **both** are unreachable, it **still returns the original default URL** and only logs that fact — it does not mark the connection failed.

Source: [`backend/open_webui/config.py` L227–L285](https://github.com/open-webui/open-webui/blob/b0e6098e940942281d9c83f3529ea117287a3a22/backend/open_webui/config.py#L227-L285)

```257:284:backend/open_webui/config.py
def _resolve_ollama_base_url(url: str) -> str:
    """If the default Ollama port (11434) is unreachable, try the fallback port (12434)."""
    def reachable(host: str, port: int) -> bool:
        try:
            with socket.create_connection((host, port), timeout=1.0):
                return True
        except (OSError, TimeoutError):
            return False
    # ...
    if not default.result() and fallback.result():
        url = url.replace(':11434', ':12434')
    elif not default.result():
        log.info('Ollama ports 11434 and 12434 both unreachable on %s', host)
    return url
```

This is **not** a process / PATH / install-dir scan. It is a well-known-port TCP fallback. Adopt the candidate-port idea; do not treat “TCP open” or “default URL retained” as connected.

**Explicit Verify Connection (HTTP, protocol-aware).** The admin Connections UI has a “Verify Connection” button. It does not assume the configured URL is up.

- Ollama: `POST …/verify` → `GET {url}/api/version` (HTTP 200 + JSON). Not a TCP-only check.
- OpenAI-compatible: `POST …/verify` → `GET {url}/models` with auth headers (Azure and Anthropic have their own paths). A 200 with a model list is “verified”; that is still **not** a chat completion probe.

Sources:

- Backend Ollama: [`backend/open_webui/routers/ollama.py` L230–L267](https://github.com/open-webui/open-webui/blob/b0e6098e940942281d9c83f3529ea117287a3a22/backend/open_webui/routers/ollama.py#L230-L267)
- Backend OpenAI: [`backend/open_webui/routers/openai.py` L972–L1064](https://github.com/open-webui/open-webui/blob/b0e6098e940942281d9c83f3529ea117287a3a22/backend/open_webui/routers/openai.py#L972-L1064)
- Frontend handlers + button: [`src/lib/components/AddConnectionModal.svelte` L70–L171, L417–L424](https://github.com/open-webui/open-webui/blob/b0e6098e940942281d9c83f3529ea117287a3a22/src/lib/components/AddConnectionModal.svelte#L70-L171)
- API clients: [`src/lib/apis/ollama/index.ts` L3–L33](https://github.com/open-webui/open-webui/blob/b0e6098e940942281d9c83f3529ea117287a3a22/src/lib/apis/ollama/index.ts#L3-L33), [`src/lib/apis/openai/index.ts` L333–L397](https://github.com/open-webui/open-webui/blob/b0e6098e940942281d9c83f3529ea117287a3a22/src/lib/apis/openai/index.ts#L333-L397)

**Model discovery after a URL is known.** `get_all_models` fans out `GET {url}/api/tags` to every configured Ollama base URL, skips disabled or failed backends (`failed_idxs`), and merges tags. A failed backend is omitted, not treated as healthy.

Source: [`backend/open_webui/routers/ollama.py` L378–L431](https://github.com/open-webui/open-webui/blob/b0e6098e940942281d9c83f3529ea117287a3a22/backend/open_webui/routers/ollama.py#L378-L431)

**API keys: env as initial input, then plaintext persistence in config storage, then returned to the admin UI.** Defaults come from `OPENAI_API_KEY` / `OPENAI_API_KEYS` and per-connection `OLLAMA_API_CONFIGS`. Those values are written into `DEFAULT_CONFIG` as `openai.api_keys` / `ollama.api_configs`. Admin `GET/POST /config` returns and upserts the **literal key list**.

Sources:

- Env + defaults: [`backend/open_webui/config.py` L306–L337, L2961–L2974](https://github.com/open-webui/open-webui/blob/b0e6098e940942281d9c83f3529ea117287a3a22/backend/open_webui/config.py#L306-L337)
- Config I/O returns keys: [`backend/open_webui/routers/openai.py` L218–L247, L456–L504](https://github.com/open-webui/open-webui/blob/b0e6098e940942281d9c83f3529ea117287a3a22/backend/open_webui/routers/openai.py#L218-L247)
- UI binds `OPENAI_API_KEYS`: [`src/lib/components/admin/Settings/Connections.svelte` L42, L140, L177, L278](https://github.com/open-webui/open-webui/blob/b0e6098e940942281d9c83f3529ea117287a3a22/src/lib/components/admin/Settings/Connections.svelte#L42)

**Do not copy** storing raw key values in state / DB and shipping them back to the client. Also do not copy Docker-only hostnames (`host.docker.internal:11434`) or a single machine path as the only default. Use them only as **scan candidates**, then verify.

**Reusable for us:** well-known port candidates + HTTP verify (`/api/version` or `/models`); do not override a user-supplied URL; fan-out and drop failed backends; Verify is a distinct action from “URL is configured.”

---

## 2) Continue — provider defaults, AUTODETECT, secret locations, health/status

### What it actually does

**Local providers have well-known default `apiBase` values, not a machine scan.**

- Ollama: `apiBase: "http://localhost:11434/"`
- LM Studio: `apiBase: "http://localhost:1234/v1/"`
- Docs: LM Studio “The default `apiBase` is `http://localhost:1234/v1`”; Ollama docs only mention `:11434` when overriding a remote host.

Sources:

- [`core/llm/llms/Ollama.ts` L152–L156](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/llm/llms/Ollama.ts#L152-L156)
- [`core/llm/llms/LMStudio.ts` L5–L10](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/llm/llms/LMStudio.ts#L5-L10)
- [`docs/customize/model-providers/top-level/lmstudio.mdx`](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/docs/customize/model-providers/top-level/lmstudio.mdx)

**AUTODETECT lists models on an already-configured endpoint.** If `model === "AUTODETECT"`, Continue calls `llm.listModels()` and expands one config entry into one model per name. For Ollama, `listModels()` is `GET {apiBase}/api/tags`. Errors are caught, warned, and yield an empty list — the service is not marked “connected” just because a default port was written down. The sentinel `AUTODETECT` itself is not sent to `/api/show`.

Sources:

- [`core/config/yaml/models.ts` L148–L219](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/config/yaml/models.ts#L148-L219)
- [`core/config/load.ts` L274–L298](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/config/load.ts#L274-L298)
- [`core/llm/llms/Ollama.ts` L178–L180, L704–L728](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/llm/llms/Ollama.ts#L704-L728)

**Windows / packaged-binary loopback quirk.** `getEndpoint` rewrites `localhost` → `127.0.0.1` when `process.env.IS_BINARY` is set, with a comment that `localhost` caused fetch failures for some Ollama endpoints in the packaged binary.

Source: [`core/llm/llms/Ollama.ts` L408–L414, L713–L714](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/llm/llms/Ollama.ts#L408-L414)

**Optional auth for local Ollama.** Authorization is added only `if (this.apiKey)`. A local daemon with no key is allowed. Do not invent a dummy key and call that “authenticated.”

Source: [`core/llm/llms/Ollama.ts` L186–L187, L709–L711](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/llm/llms/Ollama.ts#L186-L187)

**Secrets are stored as locations / names, then resolved at runtime.** `@continuedev/config-yaml` defines `SecretType` including `local_env`, `process_env`, and `not_found`. `encodeSecretLocation` produces strings such as `process_env:OPENAI_API_KEY` — the **name**, not the value. `LocalPlatformClient` resolves a named secret in order: `~/.continue/.env`, `<workspace>/.continue/.env`, `<workspace>/.env`, then `process.env`. If found in process env, `secretType` is `ProcessEnv` and the name is preserved.

YAML templates use `${{ secrets.NAME }}`. When rendering for a proxy, non-user secrets are re-emitted as `${{ secrets.<encoded location> }}` rather than inlined values. The hub `resolveFQSN` helper only sends a `value` back for **user** secrets; org/package locations are returned without the secret.

Sources:

- [`packages/config-yaml/src/interfaces/SecretResult.ts` L3–L11, L66–L84, L87–L138](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/packages/config-yaml/src/interfaces/SecretResult.ts#L3-L11)
- [`core/config/yaml/LocalPlatformClient.ts` L15–L120](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/config/yaml/LocalPlatformClient.ts#L15-L120)
- [`packages/config-yaml/src/load/unroll.ts` L187–L201](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/packages/config-yaml/src/load/unroll.ts#L187-L201)
- [`packages/config-yaml/src/interfaces/index.ts` `resolveFQSN` (only user secrets include `value`)](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/packages/config-yaml/src/interfaces/index.ts)

**Doctor-style configuration status, distinct from “the HTTP server answered.”**

```ts
enum LLMConfigurationStatuses {
  VALID = "valid",
  MISSING_API_KEY = "missing-api-key",
  MISSING_ENV_SECRET = "missing-env-secret",
}
```

`ContinueProxy.getConfigurationStatus()` returns `MISSING_API_KEY` / `MISSING_ENV_SECRET` when a stored location decodes to `SecretType.NotFound`. That is “config points at a secret that is not present,” not “port is open.”

Sources:

- [`core/llm/constants.ts` L17–L21](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/llm/constants.ts#L17-L21)
- [`core/llm/llms/stubs/ContinueProxy.ts` L77–L98](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/llm/llms/stubs/ContinueProxy.ts#L77-L98)

**Do not copy:** `llmToSerializedModelDescription` still includes `apiKey: llm.apiKey` in the object sent toward the browser config ([`core/config/load.ts` L599–L621](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/config/load.ts#L599-L621)). Also, `resolveSerializedConfig` will string-replace env values into `config.json` content in memory ([`core/config/load.ts` L79–L97](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/config/load.ts#L79-L97)). BaseLLM’s default `getConfigurationStatus()` is always `VALID` ([`core/llm/index.ts` L309–L311](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/llm/index.ts#L309-L311)) — do not treat “object constructed” as ready.

**Reusable for us:** default ports as scan candidates only; `listModels` / `/api/tags` as a models probe; rewrite `localhost` → `127.0.0.1` on Windows; optional auth; `auth_ref` as `process_env:<NAME>` / `local_env:<NAME>`; resolve process env before prompting; status enum for missing creds vs valid refs.

---

## 3) LibreChat — endpoints in `librechat.yaml`, `.env` vs DB, OpenAI/Ollama fetch, tests

### What it actually does

**Endpoints are declared in YAML; secrets should be references, not literals.** Custom endpoints use `apiKey: '${XAI_API_KEY}'` / `'${MISTRAL_API_KEY}'` and `baseURL` plus `models.fetch: true|false`. Comments say: for `apiKey` and `baseURL` you can use environment variables; **prefer `${ENV_VAR}` references over literal credentials**; Langfuse “verifies the credentials and stores the secret key encrypted; do not place a plaintext `langfuse.secretKey` in this file”; values “are masked in admin config reads and in the startup config log.”

Sources:

- [`librechat.example.yaml` L54–L78, L1256–L1353](https://github.com/danny-avila/LibreChat/blob/e6567c7a681ce67869dce31486a21d3a25d6931b/librechat.example.yaml#L54-L78)
- Example: `apiKey: '${XAI_API_KEY}'` + `models.fetch: true` at L1263–L1267; Mistral comment + fetch at L1343–L1353.

**`.env` uses a sentinel, not a fake key, when the user must type one.** `OPENAI_API_KEY=user_provided` (also Anthropic, Assistants). `AuthType.USER_PROVIDED = 'user_provided'`. `isUserProvided(value)` is a strict equality check against that enum. Runtime then knows to collect the user’s key and, when `models.fetch` is set, to fetch models **per user** rather than with a missing or placeholder key.

Sources:

- [`.env.example` L513, L672, L693](https://github.com/danny-avila/LibreChat/blob/e6567c7a681ce67869dce31486a21d3a25d6931b/.env.example#L672)
- [`packages/data-provider/src/schemas.ts` L20–L24](https://github.com/danny-avila/LibreChat/blob/e6567c7a681ce67869dce31486a21d3a25d6931b/packages/data-provider/src/schemas.ts#L20-L24)
- [`packages/api/src/utils/common.ts` L45–L50](https://github.com/danny-avila/LibreChat/blob/e6567c7a681ce67869dce31486a21d3a25d6931b/packages/api/src/utils/common.ts#L45-L50)

**Credential references stay references.** `isCredentialReference` treats `user_provided` and `${ENV_VAR}` as “values that name where a credential comes from, not the credential.” Those are **not encrypted** as if they were secrets; they stay readable. Encrypted user/admin secrets use v3 (`v3:<iv>:<ciphertext>`) with a random IV; reads redact and may store a preview companion (`apiKeyPreview`). Unpreviewed secrets become `'********'`. A stored preview, if shown, is only the last four characters of a long secret — never a prefix (and never the full value).

`extractEnvVariable` expands `${NAME}` from `process.env`, but if the var is unset it **leaves the placeholder** (`${NAME}`) rather than inventing success. Infrastructure names (`JWT_SECRET`, `CREDS_KEY`, `CREDS_IV`, `MONGO_URI`, …) are **never** interpolated into outbound headers.

Sources:

- [`packages/api/src/admin/secrets.ts` L23–L31, L96–L102, L373–L397, L573–L584](https://github.com/danny-avila/LibreChat/blob/e6567c7a681ce67869dce31486a21d3a25d6931b/packages/api/src/admin/secrets.ts#L96-L102)
- [`packages/data-provider/src/utils.ts` L1–L21, L39–L54](https://github.com/danny-avila/LibreChat/blob/e6567c7a681ce67869dce31486a21d3a25d6931b/packages/data-provider/src/utils.ts#L1-L54)
- User-credential encryption keys are named in `.env` as `CREDS_KEY` / `CREDS_IV` ([`.env.example` L709–L710](https://github.com/danny-avila/LibreChat/blob/e6567c7a681ce67869dce31486a21d3a25d6931b/.env.example#L709-L710)) — we should similarly keep only the **names** of env vars that hold secrets.

**Model fetch is a connection probe, with a soft failure and an Ollama-then-OpenAI fallback.** `fetchModels` returns `[]` if `baseURL` or `apiKey` is missing (so a `user_provided` key that has not been filled does not pretend to list models). For endpoint names starting with `ollama`, it first `GET {derivedBase}/api/tags` (5s timeout); on failure it logs and falls back to the OpenAI-compatible `GET {baseURL}/models`. `loadConfigModels` uses `Promise.allSettled` and `logger.warn` on rejected fetches — a failed list is empty, not “connected.”

There is no separate “chat completion self-test” in this path. Langfuse’s settings flow is documented as the place that “verifies the credentials” before storing them encrypted — still not a chat_ok probe for LLM endpoints.

Sources:

- [`packages/api/src/endpoints/models.ts` L87–L123, L157–L245, L294](https://github.com/danny-avila/LibreChat/blob/e6567c7a681ce67869dce31486a21d3a25d6931b/packages/api/src/endpoints/models.ts#L87-L245)
- [`packages/api/src/endpoints/config/models.ts` L162–L176, L227, L307–L316](https://github.com/danny-avila/LibreChat/blob/e6567c7a681ce67869dce31486a21d3a25d6931b/packages/api/src/endpoints/config/models.ts#L307-L316)

**Local loopback is not assumed allowed just because it is local.** User-provided base URLs go through an SSRF allowlist. `librechat.example.yaml` documents `endpoints.allowedAddresses` entries such as `localhost:11434`, `127.0.0.1:11434`, `ollama:11434` — host+port pairs, not “any port on localhost.”

Source: [`librechat.example.yaml` L667–L682](https://github.com/danny-avila/LibreChat/blob/e6567c7a681ce67869dce31486a21d3a25d6931b/librechat.example.yaml#L667-L682)

**Do not copy:** putting literal API keys in YAML; using a dummy string like `"ollama"` as `apiKey` just to satisfy a required field and then treating the endpoint as authenticated (common in community snippets, and `fetchModels` currently requires *some* `apiKey` even for Ollama); logging raw Authorization headers; treating `models.fetch` success as chat_ok.

**Reusable for us:** `${ENV_VAR}` and `user_provided` as first-class refs; encrypt at rest only the values the user actually typed, never the ref; redact in reads/logs; expand env at runtime and keep the placeholder if unset; Ollama `/api/tags` then OpenAI `/models`; soft-fail fetches; allowlist host:port rather than trusting every loopback port.

---

## 4) Practices the operator board should adopt

Concrete, cited practices (12). These are the parts to reuse — not a claim that any of the three apps is running here.

1. **Treat well-known loopback ports as scan candidates, then HTTP-verify.** Open WebUI’s `_resolve_ollama_base_url` TCP-probes 11434 then 12434 ([`config.py` L257–L285](https://github.com/open-webui/open-webui/blob/b0e6098e940942281d9c83f3529ea117287a3a22/backend/open_webui/config.py#L257-L285)); Continue defaults Ollama to `localhost:11434` and LM Studio to `localhost:1234/v1` ([`Ollama.ts` L154](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/llm/llms/Ollama.ts#L154), [`LMStudio.ts` L8](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/llm/llms/LMStudio.ts#L8)). Our scan should also include processes, PATH, and common install dirs — none of these three does a full machine scan — and must not stop at TCP.

2. **Verify with a protocol probe, not “port is listening.”** Ollama: `GET /api/version` (Open WebUI verify, [`ollama.py` L238–L250](https://github.com/open-webui/open-webui/blob/b0e6098e940942281d9c83f3529ea117287a3a22/backend/open_webui/routers/ollama.py#L238-L250)) and/or `GET /api/tags` (Continue `listModels`, LibreChat `fetchOllamaModels`). OpenAI-compatible: `GET {base}/models` with auth if required (Open WebUI [`openai.py` L1036–L1040](https://github.com/open-webui/open-webui/blob/b0e6098e940942281d9c83f3529ea117287a3a22/backend/open_webui/routers/openai.py#L1036-L1040); LibreChat [`models.ts` L294](https://github.com/danny-avila/LibreChat/blob/e6567c7a681ce67869dce31486a21d3a25d6931b/packages/api/src/endpoints/models.ts#L294)). Expose this as an explicit verify / refresh, like Open WebUI’s “Verify Connection” button ([`AddConnectionModal.svelte` L417](https://github.com/open-webui/open-webui/blob/b0e6098e940942281d9c83f3529ea117287a3a22/src/lib/components/AddConnectionModal.svelte#L417)).

3. **Doctor-first layers: port_listening ≠ authenticated ≠ models_ok ≠ chat_ok.** Continue already separates “secret missing” from “config valid” (`LLMConfigurationStatuses`, [`constants.ts` L17–L21](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/llm/constants.ts#L17-L21)). All three projects’ “connection tests” stop at version or model-list. None of them proves `chat_ok`. The board must keep these flags independent and never promote a default port to “connected.”

4. **Ollama-native first, then OpenAI-compatible fallback.** LibreChat: if the endpoint name starts with `ollama`, try `/api/tags`, and only then “Attempting to fetch via OpenAI-compatible endpoint” (`/models`) ([`models.ts` L226–L245](https://github.com/danny-avila/LibreChat/blob/e6567c7a681ce67869dce31486a21d3a25d6931b/packages/api/src/endpoints/models.ts#L226-L245)). Use the same for locally discovered OpenAI-compatible servers (Ollama, LM Studio, etc.).

5. **Store only `auth_ref` / env names, never secret values, in discover state, logs, or git.** Continue encodes `process_env:<NAME>` / `local_env:<NAME>` ([`SecretResult.ts` L66–L84](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/packages/config-yaml/src/interfaces/SecretResult.ts#L66-L84)). LibreChat keeps `user_provided` and `${ENV_VAR}` as references that “name where a credential comes from, not the credential” ([`secrets.ts` L100–L102](https://github.com/danny-avila/LibreChat/blob/e6567c7a681ce67869dce31486a21d3a25d6931b/packages/api/src/admin/secrets.ts#L100-L102)) and tells operators to prefer `${ENV_VAR}` over literals in YAML ([`librechat.example.yaml` L78](https://github.com/danny-avila/LibreChat/blob/e6567c7a681ce67869dce31486a21d3a25d6931b/librechat.example.yaml#L78)).

6. **Resolve an already-present process / local env secret and do not re-ask.** Continue’s `LocalPlatformClient` walks dotenv files then `process.env`, tagging the hit as `LocalEnv` or `ProcessEnv` ([`LocalPlatformClient.ts` L90–L114](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/config/yaml/LocalPlatformClient.ts#L90-L114)). For a logged-in desktop app (e.g. WorkBuddy `CODEBUDDY_GATEWAY_PASSWORD` already in the serve process environment), this is `auth_status: from_process_env` with `auth_ref` equal to the **variable name only**.

7. **Ask the user only when the interface was found and credentials are missing.** LibreChat’s `OPENAI_API_KEY=user_provided` + `isUserProvided` ([`.env.example` L672](https://github.com/danny-avila/LibreChat/blob/e6567c7a681ce67869dce31486a21d3a25d6931b/.env.example#L672), [`schemas.ts` L20–L24](https://github.com/danny-avila/LibreChat/blob/e6567c7a681ce67869dce31486a21d3a25d6931b/packages/data-provider/src/schemas.ts#L20-L24)) and Continue’s `SecretType.NotFound` → `MISSING_API_KEY` / `MISSING_ENV_SECRET` ([`ContinueProxy.ts` L77–L98](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/llm/llms/stubs/ContinueProxy.ts#L77-L98)). If no key is required (local Ollama with auth unset), set `auth_status` accordingly and do not prompt. If a key is required and absent, `auth_status: missing` and collect a user secret into an env var, recording only `auth_status: user_provided_ref` + that env name.

8. **Optional Authorization: send a Bearer header only when a real key exists.** Continue Ollama ([`Ollama.ts` L186–L187, L709–L711](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/llm/llms/Ollama.ts#L186-L187)). Do not mint a dummy `"ollama"` key to satisfy a form and then report `authenticated`.

9. **On Windows, prefer `127.0.0.1` over `localhost` when talking to loopback HTTP.** Continue rewrites this in packaged binaries because `localhost` broke some Ollama fetches ([`Ollama.ts` L408–L414](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/llm/llms/Ollama.ts#L408-L414)).

10. **Fan-out candidates; soft-fail; never let one dead backend poison discover.** Open WebUI records `failed_idxs` and skips them ([`ollama.py` L407–L415](https://github.com/open-webui/open-webui/blob/b0e6098e940942281d9c83f3529ea117287a3a22/backend/open_webui/routers/ollama.py#L407-L415)). LibreChat `Promise.allSettled` + warn ([`config/models.ts` L307–L316](https://github.com/danny-avila/LibreChat/blob/e6567c7a681ce67869dce31486a21d3a25d6931b/packages/api/src/endpoints/config/models.ts#L307-L316)). Continue AUTODETECT catches list errors and returns `[]` ([`yaml/models.ts` L185–L187](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/config/yaml/models.ts#L185-L187)).

11. **Respect an explicit user/discovered URL; only auto-pick when unset.** Open WebUI auto-resolves only when `OLLAMA_BASE_URL` is empty or `/ollama` and `OLLAMA_BASE_URLS` is unset ([`config.py` L283–L285](https://github.com/open-webui/open-webui/blob/b0e6098e940942281d9c83f3529ea117287a3a22/backend/open_webui/config.py#L283-L285)). Health and dispatch must consume `/bridge/discover` results, not a hardcoded install path or port.

12. **Redact everywhere a secret might leak; never interpolate infrastructure secrets.** LibreChat masks admin reads and startup logs, stores previews not values ([`secrets.ts` L373–L397](https://github.com/danny-avila/LibreChat/blob/e6567c7a681ce67869dce31486a21d3a25d6931b/packages/api/src/admin/secrets.ts#L373-L397)), leaves unset `${VAR}` placeholders intact ([`utils.ts` L47–L54](https://github.com/danny-avila/LibreChat/blob/e6567c7a681ce67869dce31486a21d3a25d6931b/packages/data-provider/src/utils.ts#L47-L54)), and refuses to expand `CREDS_KEY` / `JWT_SECRET` / etc. ([`utils.ts` L11–L21](https://github.com/danny-avila/LibreChat/blob/e6567c7a681ce67869dce31486a21d3a25d6931b/packages/data-provider/src/utils.ts#L11-L21)). If a user types a key, persist it only in an environment variable (or equivalent secret store), and keep solely the name in discover JSON.

13. **Refresh is a first-class API, not a stale default.** Open WebUI’s verify and model-list are on-demand; LibreChat fetch can be skipped or cached briefly (2 minutes) but is not “port 11434 forever.” `GET /bridge/discover` should re-scan (or a dedicated refresh should invalidate) so health/dispatch never reuse a hardcoded path after the process moved.

---

## 5) Recommended `GET /bridge/discover` JSON shape

Values in `auth_ref` are **environment variable names only**. Secret material must not appear in this document, in this payload, in logs, or in git.

```json
{
  "discovered_at": "2026-11-11T09:44:00+08:00",
  "refresh": { "method": "POST", "path": "/bridge/discover/refresh" },
  "interfaces": [
    {
      "id": "workbuddy",
      "display_name": "WorkBuddy",
      "kind": "workbuddy_acp",
      "transport": "acp",
      "endpoint": "http://127.0.0.1:<discovered_port>",
      "source": {
        "via": ["process_env", "loopback_port"],
        "process_name": "WorkBuddy",
        "pid": 0,
        "install_path": null,
        "loopback_port": 0
      },
      "doctor": {
        "port_listening": true,
        "authenticated": false,
        "models_ok": false,
        "chat_ok": false
      },
      "auth_status": "from_process_env",
      "auth_ref": "CODEBUDDY_GATEWAY_PASSWORD",
      "auth_required": true,
      "notes": [
        "ACP session/new must include workingDirectory; cwd alone is not sufficient.",
        "auth_ref is the env var name already present on the serve process; do not re-ask or print it."
      ]
    },
    {
      "id": "ollama",
      "display_name": "Ollama",
      "kind": "ollama_native",
      "transport": "http",
      "endpoint": "http://127.0.0.1:11434",
      "openai_compatible_endpoint": "http://127.0.0.1:11434/v1",
      "source": {
        "via": ["loopback_port", "process"],
        "process_name": "ollama",
        "loopback_port": 11434
      },
      "doctor": {
        "port_listening": true,
        "authenticated": false,
        "models_ok": true,
        "chat_ok": false,
        "probes": {
          "tcp": { "ok": true, "port": 11434 },
          "version_or_tags": { "ok": true, "path": "/api/tags" },
          "openai_models": { "ok": true, "path": "/v1/models" },
          "chat": { "ok": false, "reason": "not_probed" }
        }
      },
      "auth_status": "not_required",
      "auth_ref": null,
      "auth_required": false,
      "models": ["<names from /api/tags only if the probe succeeded>"]
    },
    {
      "id": "codex",
      "display_name": "Codex",
      "kind": "codex",
      "transport": "http",
      "endpoint": null,
      "source": { "via": ["process", "path", "install_dir"] },
      "doctor": {
        "port_listening": false,
        "authenticated": false,
        "models_ok": false,
        "chat_ok": false
      },
      "auth_status": "missing",
      "auth_ref": null,
      "auth_required": true,
      "prompt_user_for_secret": true
    }
  ]
}
```

Field rules:

| Field | Meaning |
|---|---|
| `transport` | How the board talks to it (`http`, `acp`, `cdp`, …). Not invented protocol behavior — only transports we have already verified elsewhere. |
| `endpoint` | Discovered loopback URL or null if the process exists but no listening port was confirmed. Never a hardcoded foreign-machine path. |
| `doctor.port_listening` | TCP (or equivalent) accept on the discovered port. |
| `doctor.authenticated` | A probe that requires credentials succeeded, **or** auth is not required and the unauthenticated protocol probe succeeded. False if 401/403 or key missing. |
| `doctor.models_ok` | `GET /api/tags` or `GET /v1/models` (or equivalent) succeeded. |
| `doctor.chat_ok` | Only after a real chat/session probe the board already supports. Default false / `not_probed`. |
| `auth_status` | `missing` \| `from_process_env` \| `user_provided_ref` \| `not_required`. |
| `auth_ref` | Env var **name** only (`CODEBUDDY_GATEWAY_PASSWORD`, `OPENAI_API_KEY`, …). Never a value, never a passphrase, never a sessionToken. |
| `prompt_user_for_secret` | True only when the interface was found, `auth_required` is true, and `auth_status` is `missing`. |

`id` values above are illustrative shapes, not evidence that WorkBuddy, Codex, Doubao, or Ollama were found on this machine.

---

## 6) What NOT to copy

- **Persisting raw API keys in config/state/DB and returning them to a UI.** Open WebUI `openai.api_keys` is upserted and returned from `GET /config` ([`openai.py` L218–L247, L456–L504](https://github.com/open-webui/open-webui/blob/b0e6098e940942281d9c83f3529ea117287a3a22/backend/open_webui/routers/openai.py#L456-L504)). Continue also serializes `apiKey` into browser model descriptions ([`load.ts` L604](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/config/load.ts#L604)).

- **Hardcoding one machine’s install path, or a Docker-only hostname, as the only default.** Open WebUI `host.docker.internal:11434` / K8s service URL ([`config.py` L246–L254](https://github.com/open-webui/open-webui/blob/b0e6098e940942281d9c83f3529ea117287a3a22/backend/open_webui/config.py#L246-L254)). The operator board’s current hardcodes (`D:\workbuddy`, a default npm Codex path, Doubao CDP `9225`) fail on the next machine for the same reason.

- **Treating a default or listening port as connected.** `_resolve_ollama_base_url` still returns the default URL when both 11434 and 12434 are unreachable ([`config.py` L277–L281](https://github.com/open-webui/open-webui/blob/b0e6098e940942281d9c83f3529ea117287a3a22/backend/open_webui/config.py#L277-L281)). Continue will happily construct an Ollama LLM with `localhost:11434` without probing. Port open ≠ authenticated ≠ `chat_ok`.

- **Dummy keys.** Filling `apiKey: "ollama"` (or any non-empty placeholder) so a required field validates, then reporting the backend as authenticated. LibreChat `fetchModels` even refuses to fetch if `apiKey` is empty ([`models.ts` L189–L191](https://github.com/danny-avila/LibreChat/blob/e6567c7a681ce67869dce31486a21d3a25d6931b/packages/api/src/endpoints/models.ts#L189-L191)) — do not satisfy that by inventing a string.

- **Logging or printing secrets, Authorization headers, or session tokens.** LibreChat’s own docs insist values are masked in startup logs; community issue reports have leaked bearer tokens — do not reproduce that. Continue’s `resolveSerializedConfig` inlines env values into file text in memory — do not log that text.

- **Assuming “model list succeeded” means chat works.** All three verify/list endpoints stop at `/api/version`, `/api/tags`, or `/models`.

- **Writing `.env` values, `CREDS_KEY` material, or discovered passwords into git or discover JSON.** Store names only. If a user must paste a key, put the value in an environment variable (or OS secret store) and record `user_provided_ref` + the name.

- **Skipping refresh and pinning a port or path after first boot.** Health/dispatch must reread discover results.

- **Calling `/bridge/discover` a “connected instance” inventory of Open WebUI, Continue, or LibreChat.** Those projects were studied as design sources only.

---

## 7) Mapping onto this board (implementation hints, not live evidence)

- **WorkBuddy:** Prefer the already-verified official ACP path. Discover port + `CODEBUDDY_GATEWAY_PASSWORD` from the running serve process environment (name only in JSON). `auth_status: from_process_env` when that env name is present on the process; do not re-ask. `session/new` must send `workingDirectory`.
- **Codex / Doubao / other desktop apps:** Scan process, PATH, common install dirs, and loopback ports. If a logged-in app already has a credential in its process env, use `from_process_env`. If the interface is up but the env name is absent, prompt once and store a user-provided env name.
- **OpenAI-compatible local servers (Ollama, LM Studio, …):** Candidate ports 11434 / 12434 / 1234 (and any discovered listeners). Probe `/api/tags` or `/api/version`, then `/v1/models`. Auth often `not_required`. `chat_ok` stays false until a real chat probe runs.
- **Jobs `EADDRINUSE`:** Out of scope here; do not treat it as fixed.
- **Restarts:** Only `start-bridge.ps1` may restart the bridge. Do not restart WorkBuddy / Codex / Doubao / UE / FlClash as part of discovery.

---

## Source file index (local copies)

- Open WebUI: `/workspace/_upstream/open-webui/…`
- Continue: `/workspace/_upstream/continue/…`
- LibreChat: `/workspace/_upstream/LibreChat/…`
