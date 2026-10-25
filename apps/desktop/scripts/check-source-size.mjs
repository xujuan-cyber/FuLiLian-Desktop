#!/usr/bin/env node
/**
 * check-source-size.mjs — 新文件行数软策略（T-F4b，F4 架构治理最小化 · 第二步）
 *
 * 规则（参照 ZCode architecture-check / source-size-policy 的最小可用版）：
 *   1. 扫描 apps/desktop 下 src/ 与 electron/ 的实现源文件（.ts .tsx .js .jsx .mjs .cjs .css，
 *      排除 *.d.ts —— ambient 声明面不属于实现规模治理对象）。
 *   2. 行数超过阈值（默认 800，语义与 eslint max-lines 一致：max 800 允许恰好 800 行，
 *      即「行数 > 阈值」才判超限）的文件 = 超限文件。
 *   3. 超限文件三选一，否则报错（EXIT=1）：
 *        a. 已收录于基线 JSON（存量 adopt，`scripts/source-size-baseline.json`）；
 *        b. 文件头 20 行内含豁免标记 `source-size-exempt`（学 ZCode App.tsx 的
 *           `eslint-disable max-lines -- 理由` 姿态；豁免必须带理由，review 把关）；
 *        c. ——没有第三条，fail-closed。
 *   4. 基线内文件当前行数低于记录 → 提示「改善，可下次 adopt 收编」；高于记录 → 提示
 *      增长（warn-growth，暂不影响退出码；基线行数记录供人审对拍）。
 *
 * 用法：
 *   node scripts/check-source-size.mjs           # 检查（EXIT 0=通过 1=违规 2=结构错误）
 *   node scripts/check-source-size.mjs --adopt   # 以当前现状重建基线 JSON（存量收编）
 *
 * 零第三方依赖（仅 node 内置模块）；可独立运行，不依赖 vitest；不在 lint 范围（eslint src/ electron/）。
 * 单测：node --test scripts/check-source-size.test.mjs（fixture 不触碰真实工作树）。
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEFAULT_THRESHOLD = 800;
export const EXEMPT_MARKER = "source-size-exempt";
export const EXEMPT_HEADER_LINES = 20;
export const SCANNED_DIRS = ["src", "electron"];
export const EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".css",
]);

/**
 * 判断文件是否在扫描范围（按扩展名；*.d.ts 一律排除）。
 * @param {string} fileName
 */
export function isScannableFile(fileName) {
  if (fileName.endsWith(".d.ts")) return false;
  return EXTENSIONS.has(path.extname(fileName));
}

/**
 * 数一个文件的行数（与 wc -l 同语义：换行符计数）。
 * @param {string} filePath
 * @returns {number}
 */
export function countLines(filePath) {
  const buf = fs.readFileSync(filePath);
  let n = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] === 0x0a) n++;
  return n;
}

/**
 * 文件头 EXEMPT_HEADER_LINES 行内是否含豁免标记。
 * @param {string} filePath
 * @returns {boolean}
 */
export function hasExemptMarker(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(8192);
    const read = fs.readSync(fd, buf, 0, buf.length, 0);
    const head = buf.subarray(0, read).toString("utf8");
    const lines = head.split(/\r?\n/).slice(0, EXEMPT_HEADER_LINES);
    return lines.some((line) => line.includes(EXEMPT_MARKER));
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * 递归收集扫描范围内的文件（相对 root 的 posix 风格路径，排序稳定）。
 * @param {string} root
 * @param {string[]} dirs
 * @returns {{ relPath: string, absPath: string }[]}
 */
export function collectFiles(root, dirs = SCANNED_DIRS) {
  const out = [];
  for (const dir of dirs) {
    const absDir = path.join(root, dir);
    if (!fs.existsSync(absDir)) {
      throw new Error(`scan dir not found: ${absDir}`);
    }
    walk(absDir);
  }
  out.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
  return out;

  function walk(absDir) {
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
      const abs = path.join(absDir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile() && isScannableFile(entry.name)) {
        out.push({
          relPath: path.relative(root, abs).split(path.sep).join("/"),
          absPath: abs,
        });
      }
    }
  }
}

/**
 * 扫描全部文件行数，并按阈值分桶。
 * @param {string} root
 * @param {number} threshold
 */
export function scan(root, threshold = DEFAULT_THRESHOLD) {
  const files = collectFiles(root);
  const over = [];
  for (const f of files) {
    const lines = countLines(f.absPath);
    if (lines > threshold) over.push({ relPath: f.relPath, absPath: f.absPath, lines });
  }
  return { totalFiles: files.length, over };
}

/**
 * 核心检查：超限文件必须「基线收录」或「头部豁免」，否则违规。
 * @param {string} root
 * @param {{ files: Record<string, number>, threshold?: number }} baseline
 * @param {number} [threshold]
 */
export function check(root, baseline, threshold = baseline.threshold ?? DEFAULT_THRESHOLD) {
  const { over } = scan(root, threshold);
  const violations = [];
  const exempted = [];
  const adopted = [];
  for (const item of over) {
    if (Object.prototype.hasOwnProperty.call(baseline.files, item.relPath)) {
      adopted.push(item);
    } else if (hasExemptMarker(item.absPath)) {
      exempted.push(item);
    } else {
      violations.push(item);
    }
  }
  const improvements = [];
  const growths = [];
  for (const [relPath, recorded] of Object.entries(baseline.files)) {
    const abs = path.join(root, relPath);
    if (!fs.existsSync(abs)) continue; // 文件已删除：改善方向，adopt 时自然移除
    const lines = countLines(abs);
    if (lines <= threshold) improvements.push({ relPath, recorded, lines });
    else if (lines > recorded) growths.push({ relPath, recorded, lines });
  }
  return { violations, exempted, adopted, improvements, growths, threshold };
}

/**
 * 以当前现状重建基线（adopt 语义：存量收编，不拆文件）。
 * @param {string} root
 * @param {number} threshold
 * @param {string} [gitRev]
 */
export function buildBaseline(root, threshold = DEFAULT_THRESHOLD, gitRev = null) {
  const { over } = scan(root, threshold);
  const files = {};
  for (const item of over) files[item.relPath] = item.lines;
  return {
    $comment:
      "source-size baseline (T-F4b). Over-threshold files adopted as-is; new over-threshold files must join this baseline via --adopt or carry a `source-size-exempt` header comment. Do not hand-edit line numbers; regenerate with `node scripts/check-source-size.mjs --adopt`.",
    generatedAt: new Date().toISOString(),
    gitRev,
    threshold,
    scannedDirs: SCANNED_DIRS,
    extensions: [...EXTENSIONS].sort(),
    exclude: ["**/*.d.ts"],
    files,
  };
}

function resolveGitRev(root) {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}

async function main(argv) {
  const root = path.resolve(fileURLToPath(import.meta.url), "..", "..");
  const baselinePath = path.join(root, "scripts", "source-size-baseline.json");
  const adopt = argv.includes("--adopt");

  console.log("[source-size] 新文件行数软策略（阈值 800，> 阈值判超限）");
  console.log(`[source-size] 扫描 ${SCANNED_DIRS.join(" + ")}（排除 *.d.ts）`);

  if (adopt) {
    const baseline = buildBaseline(root, DEFAULT_THRESHOLD, resolveGitRev(root));
    const count = Object.keys(baseline.files).length;
    fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`[source-size] ADOPT: 基线已重建 ${baselinePath}（收录 ${count} 个超限文件）`);
    console.log("[source-size] OK");
    return 0;
  }

  if (!fs.existsSync(baselinePath)) {
    console.error(`[source-size] STRUCTURAL: 基线不存在：${baselinePath}`);
    console.error('[source-size] 首次建立请运行：node scripts/check-source-size.mjs --adopt');
    return 2;
  }
  let baseline;
  try {
    baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  } catch (err) {
    console.error(`[source-size] STRUCTURAL: 基线 JSON 不可解析：${err.message}`);
    return 2;
  }
  if (!baseline || typeof baseline.files !== "object") {
    console.error("[source-size] STRUCTURAL: 基线缺少 files 字段");
    return 2;
  }

  const result = check(root, baseline);
  console.log(
    `[source-size] 超限 ${result.violations.length + result.exempted.length + result.adopted.length} 个：` +
      `基线收录 ${result.adopted.length} / 头部豁免 ${result.exempted.length} / 违规 ${result.violations.length}`
  );
  for (const item of result.adopted) {
    console.log(`[source-size]   adopted  ${item.relPath} (${item.lines})`);
  }
  for (const item of result.exempted) {
    console.log(`[source-size]   exempt   ${item.relPath} (${item.lines})`);
  }
  for (const item of result.violations) {
    console.error(
      `[source-size]   VIOLATION ${item.relPath} (${item.lines} 行 > ${result.threshold})：` +
        `既不在基线，文件头 ${EXEMPT_HEADER_LINES} 行内也无 ${EXEMPT_MARKER} 豁免声明`
    );
  }
  for (const item of result.growths) {
    console.log(
      `[source-size]   warn-growth ${item.relPath}: 基线记录 ${item.recorded} → 当前 ${item.lines}`
    );
  }
  for (const item of result.improvements) {
    console.log(
      `[source-size]   improved  ${item.relPath}: 基线记录 ${item.recorded} → 当前 ${item.lines}（已回到阈值内，可下次 adopt 收编）`
    );
  }

  if (result.violations.length > 0) {
    console.error(`[source-size] FAIL: ${result.violations.length} 个新增超限文件未豁免`);
    return 1;
  }
  console.log("[source-size] OK");
  return 0;
}

/* CLI 入口（import 为模块时不执行） */
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`[source-size] STRUCTURAL: ${err && err.stack ? err.stack : err}`);
      process.exit(2);
    }
  );
}
