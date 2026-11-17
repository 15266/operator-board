#!/usr/bin/env python3
"""dispatch-and-watch.py — 派发一条任务并盯着状态迁移，用于人工联调。

用法：
  python tools/probe/dispatch-and-watch.py --executor workbuddy --prompt-file tools/probe/p1-kay.txt \
      --expect-marker SAMPLE-WB-1117 --expect-file out/hello.md [--timeout 900]

--prompt-file 先按当前目录找，找不到再按本脚本所在目录找。

退出码：0 = verified；2 = 已结束但未通过校验；3 = 超时仍在跑；1 = 请求被拒。
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:5180"
HERE = os.path.dirname(os.path.abspath(__file__))


def read_prompt(path):
    """先按当前目录找，找不到再按脚本所在目录找（示例提示词就放在脚本旁边）。"""
    for c in (path, os.path.join(HERE, path), os.path.join(HERE, os.path.basename(path))):
        if os.path.isfile(c):
            return open(c, encoding="utf-8").read().strip()
    raise SystemExit(f"读不到提示词文件：{path}（也试过 {os.path.join(HERE, os.path.basename(path))}）")


def post(path, payload):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    # 绕过系统/环境代理：本机回环不需要代理，走了反而可能拿到假 502
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8") or "{}")


def get(path):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(BASE + path, timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))


def find(did):
    for d in get("/bridge/dispatches")["dispatches"]:
        if d["id"] == did:
            return d
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--executor", required=True)
    ap.add_argument("--prompt-file", required=True)
    ap.add_argument("--expect-marker")
    ap.add_argument("--expect-file", action="append", default=[])
    ap.add_argument("--title", default="示例任务：交付文件 + marker 校验")
    ap.add_argument("--task-id")
    ap.add_argument("--project-dir", help="共享项目目录；给了它，expect_files 相对这个目录解析")
    ap.add_argument("--timeout", type=int, default=900,
                    help="等待上限（秒）。豆包写长文档实测 7 分钟，默认 900；不要设太小，否则会把正常慢当成卡死")
    a = ap.parse_args()

    prompt = read_prompt(a.prompt_file)
    payload = {"executor": a.executor, "prompt": prompt, "title": a.title}
    if a.expect_marker:
        payload["expect_marker"] = a.expect_marker
    if a.expect_file:
        payload["expect_files"] = a.expect_file
    if a.task_id:
        payload["task_id"] = a.task_id
    if a.project_dir:
        payload["project_dir"] = a.project_dir

    code, body = post("/bridge/dispatch", payload)
    if code != 202:
        print(f"POST /bridge/dispatch -> {code}\n{json.dumps(body, ensure_ascii=False, indent=2)}")
        return 1

    rec = body["dispatch"]
    did = rec["id"]
    print(f"accepted {did}  state={rec['state']}  cwd={rec.get('cwd')}")
    t0 = time.time()
    seen = None
    last_len = 0
    while time.time() - t0 < a.timeout:
        r = find(did)
        if r is None:
            print("!! 记录消失了（被 200 条上限挤出？）")
            return 3
        if r["state"] != seen:
            print(f"  [{time.time()-t0:6.1f}s] state -> {r['state']}")
            seen = r["state"]
        ev = r.get("events") or []
        for e in ev[last_len:]:
            msg = (e.get("msg") or "").replace("\n", " ")[:150]
            print(f"  [{time.time()-t0:6.1f}s]   ev: {msg}")
        last_len = len(ev)
        if r["state"] in ("verified", "replied_unverified", "failed", "handoff_closed"):
            break
        time.sleep(2)

    r = find(did)
    print("-" * 66)
    print("state   :", r["state"])
    print("via     :", r.get("via"))
    print("elapsed :", f"{time.time()-t0:.1f}s")
    if r["state"] in ("queued", "running", "awaiting_user", "sent_awaiting_result"):
        print("⚠ 只是我这边的等待上限到了，服务端还在跑（记录仍是运行态）。")
        print("  先看 evidence/elapsedMs 与 logs/bridge.log，别急着判定卡死；豆包长文档实测约 7 分钟。")
    if r.get("error"):
        print("error   :", r["error"])
    for c in r.get("checks") or []:
        print(f"  check {'OK ' if c.get('ok') else 'NG '} [{c.get('type')}] {c.get('name')}  {str(c.get('detail') or '')[:90]}")
    rep = (r.get("reply") or "").strip()
    print("reply   :", (rep[:400] + " …") if len(rep) > 400 else (rep or "(空)"))
    print("DIR     :", r.get("cwd"))
    return 0 if r["state"] == "verified" else (3 if r["state"] in ("queued", "running", "awaiting_user", "sent_awaiting_result") else 2)


if __name__ == "__main__":
    sys.exit(main())
