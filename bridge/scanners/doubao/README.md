# Doubao desktop (CDP) scanner

Looks for a Doubao process, `dsh-doubao-bridge/server.mjs` (`DOUBAO_SERVER`
or `~/agent-tools/dsh-doubao-bridge`), loopback listen ports of that
process (`from_process`), and a declared **hint** port 9225
(`GET /json/version`). 9225 is not the only default: if the CDP port
moved, the process-observed ports still count.

If a discovered port is already listening, leave the process alone —
never restart or kill Doubao to complete a probe.

CDP reachability is not `chat_bridge=ok` and not tool verification.
