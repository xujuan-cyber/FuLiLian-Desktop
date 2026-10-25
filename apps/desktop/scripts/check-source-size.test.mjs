/**
 * check-source-size.test.mjs — T-F4b 行数软策略脚本自身单测（node --test）。
 * 全部用 fixture（os.tmpdir 临时树），不触碰真实工作树、不进 vitest 产品测试面。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_THRESHOLD,
  buildBaseline,
  check,
  countLines,
  hasExemptMarker,
  isScannableFile,
} from "./check-source-size.mjs";

/** 建带 src/deep 与 electron 目录的临时根，测试结束自动清理 */
function makeTmpRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "f4b-source-size-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src", "deep"), { recursive: true });
  fs.mkdirSync(path.join(root, "electron"), { recursive: true });
  return root;
}

function writeFile(root, relPath, content) {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

/** 生成 n 行文本（每行有内容，行数语义与真实代码一致） */
function lines(n, prefix = "export const x = 1;") {
  return Array.from({ length: n }, (_, i) => `${prefix} // line ${i + 1}`).join("\n") + "\n";
}

test("isScannableFile: 实现源文件收录，*.d.ts 与其他扩展名排除", () => {
  assert.equal(isScannableFile("a.ts"), true);
  assert.equal(isScannableFile("a.tsx"), true);
  assert.equal(isScannableFile("plugin.js"), true);
  assert.equal(isScannableFile("style.css"), true);
  assert.equal(isScannableFile("global.d.ts"), false);
  assert.equal(isScannableFile("data.json"), false);
  assert.equal(isScannableFile("logo.woff2"), false);
});

test("countLines: 换行符计数（wc -l 同语义）", (t) => {
  const root = makeTmpRoot(t);
  const p = path.join(root, "x.ts");
  fs.writeFileSync(p, "a\nb\nc\n");
  assert.equal(countLines(p), 3);
});

test("check: 900 行未豁免文件 → 违规（新增报错）", (t) => {
  const root = makeTmpRoot(t);
  writeFile(root, "src/big.ts", lines(900));
  const r = check(root, { threshold: DEFAULT_THRESHOLD, files: {} });
  assert.equal(r.violations.length, 1);
  assert.equal(r.violations[0].relPath, "src/big.ts");
  assert.equal(r.violations[0].lines, 900);
});

test("check: 加 source-size-exempt 头注释 → 绿（豁免通道）", (t) => {
  const root = makeTmpRoot(t);
  writeFile(root, "src/big.ts", `// source-size-exempt: 临时红证文件\n${lines(900)}`);
  const r = check(root, { threshold: DEFAULT_THRESHOLD, files: {} });
  assert.equal(r.violations.length, 0);
  assert.equal(r.exempted.length, 1);
});

test("check: 豁免标记超出头部 20 行 → fail-closed 判违规", (t) => {
  const root = makeTmpRoot(t);
  const filler = Array.from({ length: 30 }, (_, i) => `// filler ${i}`).join("\n") + "\n";
  writeFile(root, "src/big.ts", `${filler}// source-size-exempt: 迟到的豁免\n${lines(900)}`);
  const r = check(root, { threshold: DEFAULT_THRESHOLD, files: {} });
  assert.equal(r.violations.length, 1);
  assert.equal(r.exempted.length, 0);
});

test("check: 基线收录 → adopted；未收录未豁免的另一文件 → 违规（对拍精确到文件）", (t) => {
  const root = makeTmpRoot(t);
  writeFile(root, "src/big.ts", lines(900));
  writeFile(root, "src/other.ts", lines(801));
  const r = check(root, { threshold: DEFAULT_THRESHOLD, files: { "src/big.ts": 900 } });
  assert.deepEqual(
    r.violations.map((v) => v.relPath),
    ["src/other.ts"]
  );
  assert.deepEqual(
    r.adopted.map((v) => v.relPath),
    ["src/big.ts"]
  );
});

test("check: 恰好 800 行不判超限（与 eslint max-lines 一致：> 阈值才算）", (t) => {
  const root = makeTmpRoot(t);
  writeFile(root, "src/exact.ts", lines(800));
  const r = check(root, { threshold: DEFAULT_THRESHOLD, files: {} });
  assert.equal(r.violations.length, 0);
  assert.equal(r.adopted.length, 0);
});

test("check: 基线文件回落阈值内 → improvements；基线内增长 → growths（不影响退出判定）", (t) => {
  const root = makeTmpRoot(t);
  writeFile(root, "src/shrunk.ts", lines(500));
  writeFile(root, "src/grown.ts", lines(1000));
  const r = check(root, {
    threshold: DEFAULT_THRESHOLD,
    files: { "src/shrunk.ts": 900, "src/grown.ts": 950 },
  });
  assert.equal(r.violations.length, 0);
  assert.equal(r.improvements.length, 1);
  assert.equal(r.improvements[0].relPath, "src/shrunk.ts");
  assert.equal(r.growths.length, 1);
  assert.equal(r.growths[0].relPath, "src/grown.ts");
});

test("buildBaseline: 收录全部超限文件、不含未超限文件与 .d.ts", (t) => {
  const root = makeTmpRoot(t);
  writeFile(root, "src/big.ts", lines(900));
  writeFile(root, "src/small.ts", lines(10));
  writeFile(root, "src/ambient.d.ts", lines(2000));
  const baseline = buildBaseline(root, DEFAULT_THRESHOLD, "abc1234");
  assert.deepEqual(Object.keys(baseline.files), ["src/big.ts"]);
  assert.equal(baseline.threshold, DEFAULT_THRESHOLD);
  assert.equal(baseline.gitRev, "abc1234");
  assert.ok(baseline.generatedAt);
});

test("hasExemptMarker: 头部含标记即真（CRLF 兼容）", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "f4b-exempt-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const p = path.join(root, "a.ts");
  fs.writeFileSync(p, "// source-size-exempt: reason\r\nbody\r\n");
  assert.equal(hasExemptMarker(p), true);
});
