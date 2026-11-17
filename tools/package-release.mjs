#!/usr/bin/env node
/**
 * package-release.mjs — build a shippable zip of this project.
 *
 *   node tools/package-release.mjs              # -> releases/operator-board-YYYYMMDD.zip
 *   node tools/package-release.mjs --out foo.zip
 *   node tools/package-release.mjs --list       # dry run, print what would ship
 *
 * What is excluded and why:
 *   node_modules   reinstall with `npm install`
 *   .git           history is not part of a release
 *   logs / work    runtime state, may contain other people's prompts
 *   evidence       test artifacts
 *   releases       never nest a release inside itself
 *   .vite/.pnpm-store/coverage   caches
 *   *.bak-*, *.tmp, *.log, *.orig, *.zip, .DS_Store, Thumbs.db   editor/OS noise
 *
 * What is *kept* on purpose:
 *   dist/          built UI, so the zip runs without a build step
 *   ai-dispatch-test/  fixtures used by the bridge self-tests
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

// fileURLToPath, not URL.pathname: paths with CJK chars get percent-encoded otherwise.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set(["node_modules", "releases", "evidence", "work", "logs", ".git", ".vite", "coverage", ".pnpm-store"]);
const SKIP_EXT = [".bak", ".tmp", ".log", ".zip", ".orig"];
const SKIP_NAMES = new Set([".DS_Store", "Thumbs.db"]);

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const value = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

function stamp() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function shouldSkipFile(name) {
  if (SKIP_NAMES.has(name)) return true;
  if (name.includes(".bak-")) return true;
  return SKIP_EXT.some((e) => name.toLowerCase().endsWith(e));
}

function walk(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      walk(path.join(dir, ent.name), acc);
    } else if (ent.isFile()) {
      if (shouldSkipFile(ent.name)) continue;
      acc.push(path.join(dir, ent.name));
    }
  }
  return acc;
}

let zipLib = null;
try {
  zipLib = require("adm-zip");
} catch {}

const files = walk(ROOT).map((abs) => ({ abs, rel: path.relative(ROOT, abs).split(path.sep).join("/") }));

if (flag("--list")) {
  const byTop = new Map();
  for (const f of files) {
    const top = f.rel.includes("/") ? f.rel.split("/")[0] : "(root)";
    byTop.set(top, (byTop.get(top) || 0) + 1);
  }
  console.log("files that would ship:", files.length);
  for (const [k, v] of [...byTop.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(String(v).padStart(6), " ", k);
  }
  process.exit(0);
}

const out = path.resolve(ROOT, value("--out", path.join("releases", `operator-board-${stamp()}.zip`)));
fs.mkdirSync(path.dirname(out), { recursive: true });

if (zipLib) {
  const zip = new zipLib();
  for (const f of files) zip.addLocalFile(f.abs, path.posix.dirname(f.rel) === "." ? "" : path.posix.dirname(f.rel));
  zip.writeZip(out);
} else {
  // No adm-zip: fall back to Python's zipfile (bundled with the Python that ships on Windows).
  const listFile = path.join(require("node:os").tmpdir(), `ob-pack-${process.pid}.txt`);
  fs.writeFileSync(listFile, files.map((f) => f.rel).join("\n"), "utf8");
  const { spawnSync } = require("node:child_process");
  const py = `
import os, sys, zipfile
root, out, listfile = sys.argv[1], sys.argv[2], sys.argv[3]
rels = [l.strip() for l in open(listfile, encoding="utf8").read().splitlines() if l.strip()]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for r in rels:
        z.write(os.path.join(root, r.replace("/", os.sep)), r)
print("entries", len(rels))
`;
  const r = spawnSync("python", ["-c", py, ROOT, out, listFile], { encoding: "utf8" });
  fs.unlinkSync(listFile);
  if (r.status !== 0) {
    console.error("packaging failed:", r.stderr || r.stdout);
    process.exit(1);
  }
}

const sizeMb = (fs.statSync(out).size / 1048576).toFixed(1);
console.log("zip    :", out);
console.log("entries:", files.length);
console.log("size_mb:", sizeMb);
console.log("note   : dist/ is included on purpose (zip runs without a build step)");
