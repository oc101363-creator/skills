import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PRODUCT_DIR = process.argv[2];
const STEPS = process.argv.slice(3);

if (!PRODUCT_DIR) {
  console.error("Usage: node pipeline.mjs <product_dir> [steps...]");
  console.error("");
  console.error("Steps (default: all):");
  console.error("  refine      — 精修工厂图 (Refinement.mjs)");
  console.error("  normalize   — 标准化 info.json (normalize_info.mjs)");
  console.error("  main-specs  — 生成 主图_specs.json");
  console.error("  aplus-specs — 生成 A_Plus_specs.json");
  console.error("  main-images — 生成主图 (generate_main_images.mjs)");
  console.error("  aplus-images— 生成 A+ 图 (poster_a_plus_generator.mjs)");
  console.error("");
  console.error("Example:");
  console.error("  node pipeline.mjs ./products/ADR0368大超电机");
  console.error("  node pipeline.mjs ./products/ADR0368大超电机 refine normalize main-specs");
  process.exit(1);
}

const runAll = STEPS.length === 0;
const shouldRun = (step) => runAll || STEPS.includes(step);

const productName = path.basename(PRODUCT_DIR);
console.log(`=== Pipeline: ${productName} ===`);
console.log(`Directory: ${PRODUCT_DIR}`);
console.log("");

// ── Validate directory structure ──
const 素材Dir = path.join(PRODUCT_DIR, "图片素材");
const has素材 = fs.existsSync(素材Dir);
const hasRawInfo = fs.existsSync(path.join(素材Dir, "info.json")) ||
                    fs.existsSync(path.join(PRODUCT_DIR, "info.json"));

if (!has素材) {
  console.error(`[ERROR] 未找到 图片素材/ 目录: ${素材Dir}`);
  console.error("请确保产品目录结构正确：");
  console.error("  {product}/");
  console.error("    ├── 图片素材/");
  console.error("    │   ├── 1.jpg ~ 7.jpg");
  console.error("    │   └── info.json (原始)");
  process.exit(1);
}

// ── Helper: run script ──
function runScript(scriptName, args = []) {
  const scriptPath = path.join(__dirname, scriptName);
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Script not found: ${scriptPath}`);
  }
  return new Promise((resolve, reject) => {
    console.log(`[RUN] node ${scriptName} ${args.join(" ")}`);
    const child = spawn("node", [scriptPath, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: __dirname
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", d => { stdout += d.toString(); process.stdout.write(d); });
    child.stderr.on("data", d => { stderr += d.toString(); process.stderr.write(d); });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${scriptName} exited with ${code}\n${stderr.slice(0, 500)}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

// ── Step 1: Refine ──
if (shouldRun("refine")) {
  console.log("\n--- Step 1: 精修图片 ---");
  // 如果 processed/ 已存在且有文件，询问是否跳过
  const processedDir = path.join(PRODUCT_DIR, "processed");
  const hasProcessed = fs.existsSync(processedDir) &&
    fs.readdirSync(processedDir).some(f => /\.(jpg|jpeg|png)$/i.test(f));

  if (hasProcessed) {
    console.log("[SKIP] processed/ 已存在，跳过精修（如需重新精修请删除 processed/）");
  } else {
    // 优先使用 图片素材/ 作为输入，否则用产品目录本身
    const inputDir = fs.readdirSync(素材Dir).some(f => /^\d+\.(jpg|jpeg|png)$/i.test(f))
      ? 素材Dir
      : PRODUCT_DIR;
    await runScript("Refinement.mjs", [inputDir]);
  }
}

// ── Step 2: Normalize info.json ──
if (shouldRun("normalize")) {
  console.log("\n--- Step 2: 标准化 info.json ---");
  const rawInfoPath = path.join(素材Dir, "info.json");
  const infoPath = path.join(PRODUCT_DIR, "info.json");
  const procInfoPath = path.join(PRODUCT_DIR, "processed", "info.json");

  // 如果素材目录有 info.json 但产品根目录没有，复制过去
  if (fs.existsSync(rawInfoPath) && !fs.existsSync(infoPath)) {
    fs.copyFileSync(rawInfoPath, infoPath);
    console.log("[COPY] 图片素材/info.json → info.json");
  }

  // 运行标准化
  if (fs.existsSync(infoPath)) {
    console.log("[INFO] 运行 normalize_info.mjs...");
    await runScript("normalize_info.mjs", [PRODUCT_DIR]);
  } else {
    console.error("[ERROR] 未找到 info.json，无法标准化");
  }
}

// ── Step 3: Generate main specs ──
if (shouldRun("main-specs")) {
  console.log("\n--- Step 3: 生成 主图_specs.json ---");
  await runScript("generate_main_specs.mjs", [PRODUCT_DIR, PRODUCT_DIR]);
}

// ── Step 4: Generate A+ specs ──
if (shouldRun("aplus-specs")) {
  console.log("\n--- Step 4: 生成 A_Plus_specs.json ---");
  await runScript("generate_a_plus_specs.mjs", [PRODUCT_DIR, PRODUCT_DIR]);
}

// ── Step 5: Generate main images ──
if (shouldRun("main-images")) {
  console.log("\n--- Step 5: 生成主图 ---");
  await runScript("generate_main_images.mjs", [PRODUCT_DIR]);
}

// ── Step 6: Generate A+ images ──
if (shouldRun("aplus-images")) {
  console.log("\n--- Step 6: 生成 A+ 图片 ---");
  await runScript("poster_a_plus_generator.mjs", [path.dirname(PRODUCT_DIR), productName]);
}

console.log("\n=== Pipeline complete ===");
console.log(`Output: ${PRODUCT_DIR}`);
