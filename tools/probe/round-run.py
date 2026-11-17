#!/usr/bin/env python3
"""round-run.py — 一次派发一整轮多执行器任务，并统一盯完全部终态。

用法：python tools/probe/round-run.py tools/probe/round-r3-closeout.json [--timeout 900]

round.json 结构：
{
  "title": "卡美洛 R3 收尾轮",
  "project_dir": "D:\\...\\ai-dispatch-test\\adhoc",
  "tasks": [
    {"executor": "codex", "task_id": "...", "title": "...", "prompt_file": "p1.txt",
     "expect_files": ["r3-logs/x.md"], "expect_marker": "..."}
  ]
}

可选项：sandbox（codex 专用，read-only / workspace-write）、model（豆包专用，如 kimipro = Kimi K3.1 Pro）。

prompt_file 先按当前目录找，找不到就按清单文件所在目录找，所以清单与提示词放一起即可。

退出码：0 全部 verified；2 有任务结束但未通过校验；3 有任务仍在跑；1 请求被拒。
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:5180"
TERMINAL = ("verified", "replied_unverified", "failed", "handoff_closed", "partial")
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def post(path, payload):
    req = urllib.request.Request(BASE + path, data=json.dumps(payload, ensure_ascii=False).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with opener.open(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def all_records():
    with opener.open(BASE + "/bridge/dispatches", timeout=20) as r:
        return {d["id"]: d for d in json.loads(r.read().decode())["dispatches"]}


def resolve_prompt(p, manifest_dir):
    """按当前目录找，找不到就按清单目录（含同名 basename）兜底。"""
    cands = [p, os.path.join(manifest_dir, p), os.path.join(manifest_dir, os.path.basename(p))]
    for c in cands:
        if os.path.isfile(c):
            return c
    return p


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("manifest")
    ap.add_argument("--timeout", type=int, default=900)
    a = ap.parse_args()

    m = json.load(open(a.manifest, encoding="utf-8"))
    manifest_dir = os.path.dirname(os.path.abspath(a.manifest))
    print(f"=== {m.get('title', '轮次')} ===")

    ids = []
    for t in m["tasks"]:
        payload = {"executor": t["executor"], "title": t.get("title", ""), "task_id": t.get("task_id")}
        prompt_path = resolve_prompt(t["prompt_file"], manifest_dir)
        try:
            payload["prompt"] = open(prompt_path, encoding="utf-8").read().strip()
        except OSError as e:
            print(f"  ✗ 读不到提示词 {t['prompt_file']}（试过 {prompt_path}）: {e}")
            continue
        if m.get("project_dir"):
            payload["project_dir"] = m["project_dir"]
        if t.get("expect_files"):
            payload["expect_files"] = t["expect_files"]
        if t.get("expect_marker"):
            payload["expect_marker"] = t["expect_marker"]
        if t.get("sandbox"):
            payload["sandbox"] = t["sandbox"]
        if t.get("model"):
            payload["model"] = t["model"]
        code, body = post("/bridge/dispatch", payload)
        name = t.get("title") or t.get("task_id")
        if code != 202:
            print(f"  ✗ {name[:28]:30s} 被拒 {code}: {body.get('error')}")
            continue
        did = body["dispatch"]["id"]
        ids.append((did, name, t["executor"]))
        print(f"  → {name[:28]:30s} {t['executor']:9s} {did}")

    if not ids:
        return 1

    t0 = time.time()
    seen = {}
    last_note = {}
    while time.time() - t0 < a.timeout:
        recs = all_records()
        pending = 0
        for did, name, ex in ids:
            r = recs.get(did)
            if not r:
                pending += 1
                continue
            if seen.get(did) != r["state"]:
                print(f"  [{time.time()-t0:6.1f}s] {name[:24]:26s} -> {r['state']}")
                seen[did] = r["state"]
            ev = r.get("events") or []
            if last_note.get(did, 0) != len(ev):
                for e in ev[last_note.get(did, 0):]:
                    print(f"  [{time.time()-t0:6.1f}s]      ev: {(e.get('msg') or '')[:120]}")
                last_note[did] = len(ev)
            if r["state"] not in TERMINAL:
                pending += 1
        if pending == 0:
            break
        time.sleep(3)

    print("-" * 74)
    recs = all_records()
    bad = 0
    still = 0
    for did, name, ex in ids:
        r = recs.get(did) or {}
        st = r.get("state")
        if st == "verified":
            mark = "✓"
        elif st in TERMINAL:
            mark = "✗"
            bad += 1
        else:
            mark = "…"
            still += 1
        print(f"{mark} {name[:26]:28s} {ex:9s} {str(st):20s} {r.get('finished_at') or '-'}")
        for c in (r.get("checks") or []):
            if c.get("warn") or not c.get("ok"):
                print(f"      {'提醒' if c.get('warn') else '未通过'}: {c.get('name')} · {str(c.get('detail') or '')[:80]}")
        if r.get("error"):
            print(f"      错误: {str(r['error'])[:150]}")
    print("-" * 74)
    print(f"总计 {len(ids)}  | verified {len(ids)-bad-still}  | 未通过 {bad}  | 仍在跑 {still}")
    return 0 if bad == 0 and still == 0 else (3 if still else 2)


if __name__ == "__main__":
    sys.exit(main())
