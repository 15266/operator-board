# WorkBuddy scanner

Looks for a running `WorkBuddy.exe`, `codebuddy` on `PATH`, and well-known
install dirs (`WB_EXE` / `D:/workbuddy`). The desktop port is observed from
the `WB_PORT` environment-variable **name** (`ports[].from_env`), never a
hardcoded default. `endpoint.base_url_template` is
`http://127.0.0.1:${port}` so a promote draft can include a URL.
`endpoint.transport` is `acp`.

Session auth uses env names `WB_TOKEN` and `WB_PORT` (bridge already reads
these from the running serve process; values never go into the discovery
record). A health probe may send a bearer from the bridge env when
`WB_TOKEN` is present; the value must not be logged.

Known channel shape (recorded by the host, not claimed by a mere scan):
ACP + `workingDirectory`. The jobs API is still broken. A health/ACP hit
must not be stored as jobs-verified (`jobs_ok` stays false).

Never restart or bind over the GUI serve port.
