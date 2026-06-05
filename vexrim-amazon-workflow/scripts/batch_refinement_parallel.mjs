import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, "Refinement.mjs");
const CONCURRENCY = 5;

const ROOT = process.argv[2] || ".";

if (!fs.existsSync(ROOT)) {
  console.error(`Root directory not found: ${ROOT}`);
  process.exit(1);
}

const products = [];
for (const name of fs.readdirSync(ROOT)) {
  const dir = path.join(ROOT, name);
  if (!fs.statSync(dir).isDirectory()) continue;
  const materialDir = path.join(dir, "图片素材");
  const imgDir = fs.existsSync(materialDir) ? materialDir : dir;
  const hasImages = fs.readdirSync(imgDir).some(f => /^\d+\.(jpg|jpeg|png)$/i.test(f));
  if (hasImages) {
    products.push(imgDir);
  } else {
    console.log(`[SKIP] ${name} (no numbered images)`);
  }
}

console.log(`Total products to refine: ${products.length}`);
console.log("=".repeat(50));

async function runBatch(batch) {
  const jobs = batch.map(dir => {
    const name = path.basename(dir);
    return new Promise((resolve) => {
      console.log(`[${name}] Starting refinement...`);
      const start = Date.now();
      const child = spawn("node", [SCRIPT, dir], { stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      child.stderr.on("data", d => { stderr += d.toString(); });
      child.on("close", (code) => {
        const elapsed = Math.round((Date.now() - start) / 1000);
        if (code === 0) {
          console.log(`[${name}] Done in ${elapsed}s`);
        } else {
          console.error(`[${name}] Failed (exit ${code})`);
          if (stderr) console.error(stderr.slice(0, 500));
        }
        resolve({ name, dir, code, elapsed });
      });
    });
  });
  return Promise.all(jobs);
}

(async () => {
  const startAll = Date.now();
  for (let i = 0; i < products.length; i += CONCURRENCY) {
    const batch = products.slice(i, i + CONCURRENCY);
    console.log(`\n[Batch ${Math.floor(i / CONCURRENCY) + 1}/${Math.ceil(products.length / CONCURRENCY)}] ${batch.map(p => path.basename(p)).join(", ")}`);
    await runBatch(batch);
  }
  const total = Math.round((Date.now() - startAll) / 1000);
  console.log("\n" + "=".repeat(50));
  console.log(`All batches complete. Total: ${total}s (~${Math.round(total / 60)}min)`);
})();
