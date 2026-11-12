# Codex CLI scanner

Looks for `codex` on `PATH`, a running process, and well-known `codex.js`
install locations (`CODEX_JS`, npm roaming prefix). Finding the process or
binary is `found`, not `session_available`.

`auth_ref=CODEX_API_KEY` is an optional variable **name**. A missing
variable does not mean the CLI is uninstalled and does not set
`needs_user_secret`. Desktop login (`auth.json`) is not inferred from
process presence and is not `session_available` until a dedicated check
exists (`session.infer_session` is false).

Does not run `codex exec`, does not start Codex or FlClash, and does not
persist `~/.codex` auth files.
