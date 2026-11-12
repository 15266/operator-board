# Ollama scanner

Looks for the `ollama` process / `PATH` / well-known install dirs, then
declared loopback ports **11434** (primary) and **12434** (fallback only).
Promote into the existing `openai-compatible` adapter
(`http://127.0.0.1:${port}/v1`). Listing `/api/tags` is inventory, not
verification. Do not start or restart Ollama to complete a scan.
