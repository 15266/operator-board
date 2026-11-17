#!/usr/bin/env python3
"""negative-tests.py — 撞桥接的拒绝分支，确认坏输入不会悄悄派发出去。

每条用例断言 (HTTP 状态码, 是否产生了新记录)。全部通过退出码 0。
"""
import json
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:5180"
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def req(path, payload=None, method="GET"):
    data = json.dumps(payload, ensure_ascii=False).encode() if payload is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method,
                               headers={"Content-Type": "application/json"})
    try:
        with opener.open(r, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def count():
    return len(req("/bridge/dispatches")[1]["dispatches"])


CASES = [
    ("未知执行器", {"executor": "gpt5", "prompt": "x"}, 400),
    ("空 prompt", {"executor": "workbuddy", "prompt": "   "}, 400),
    ("prompt 不是字符串", {"executor": "workbuddy", "prompt": 123}, 400),
    ("expect_files 用绝对路径", {"executor": "workbuddy", "prompt": "x", "expect_files": ["C:\\Windows\\win.ini"]}, 400),
    ("expect_files 带 ..", {"executor": "workbuddy", "prompt": "x", "expect_files": ["../escape.txt"]}, 400),
    ("expect_files 是字符串不是数组", {"executor": "workbuddy", "prompt": "x", "expect_files": "a.txt"}, 400),
    ("expect_marker 空串", {"executor": "workbuddy", "prompt": "x", "expect_marker": "  "}, 400),
    ("force 绕过保护", {"executor": "workbuddy", "prompt": "x", "force": True}, 400),
    ("非法 sandbox", {"executor": "codex", "prompt": "x", "sandbox": "danger-full-access"}, 400),
    ("project_dir 越界", {"executor": "workbuddy", "prompt": "x", "project_dir": "C:\\Windows"}, 400),
    ("请求体不是对象", [1, 2, 3], 400),
]

fails = 0
for name, payload, want in CASES:
    before = count()
    code, body = req("/bridge/dispatch", payload, "POST")
    after = count()
    created = after - before
    ok = (code == want and created == 0)
    if not ok:
        fails += 1
    print(f"{'PASS' if ok else 'FAIL'}  {name:28s} -> HTTP {code} (期望 {want})  新记录 {created}  {str(body.get('error') or '')[:56]}")

# 未知路径、错误方法
code, _ = req("/bridge/dispatch", None, "GET")
ok = code == 404
fails += 0 if ok else 1
print(f"{'PASS' if ok else 'FAIL'}  {'GET /bridge/dispatch':28s} -> HTTP {code} (期望 404)")

code, _ = req("/bridge/nope")
ok = code == 404
fails += 0 if ok else 1
print(f"{'PASS' if ok else 'FAIL'}  {'未知路径':28s} -> HTTP {code} (期望 404)")

print("-" * 70)
print("失败用例:", fails)
sys.exit(0 if fails == 0 else 1)
