import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT = process.argv[2];
const CONCURRENCY = parseInt(process.argv[3], 10) || 5;

if (!ROOT) {
  console.error("Usage: node batch_a_plus.mjs <root_dir> [concurrency=5]");
  process.exit(1);
}

const dirs = fs.readdirSync(ROOT)
  .map(d => path.join(ROOT, d))
  .filter(d => {
    if (!fs.statSync(d).isDirectory()) return false;
    const hasProcessed = fs.existsSync(path.join(d, "processed"));
    const hasSpecs = fs.existsSync(path.join(d, "processed", "info.json"));
    return hasProcessed && hasSpecs;
  })
  .sort();

console.log(`Found ${dirs.length} products in ${ROOT}`);
console.log(`Concurrency: ${CONCURRENCY}\n`);

const SCRIPT = path.join(import.meta.dirname, "poster_a_plus_generator.mjs");

function runProduct(productDir) {
  return new Promise((resolve) => {
    const name = path.basename(productDir);
    console.log(`[START] ${name}`);
    const start = Date.now();

    const child = spawn("node", [SCRIPT, productDir], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });

    child.on("close", (code) => {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      if (code === 0) {
        console.log(`[DONE ] ${name} | ${elapsed}s`);
      } else {
        console.log(`[FAIL ] ${name} | ${elapsed}s | exit=${code}`);
        if (stderr) console.error(stderr.slice(0, 500));
      }
      resolve({ name, ok: code === 0, stdout, stderr });
    });
  });
}

async function runBatch(items, concurrency) {
  const results = [];
  const queue = [...items];
  const running = new Set();

  return new Promise((resolve) => {
    function startNext() {
      if (queue.length === 0 && running.size === 0) {
        resolve(results);
        return;
      }
      while (queue.length > 0 && running.size < concurrency) {
        const item = queue.shift();
        const p = runProduct(item).then((r) => {
          results.push(r);
          running.delete(p);
          startNext();
        });
        running.add(p);
      }
    }
    startNext();
  });
}

(async () => {
  const start = Date.now();
  const results = await runBatch(dirs, CONCURRENCY);
  const total = ((Date.now() - start) / 1000).toFixed(1);

  const okCount = results.filter((r) => r.ok).length;
  console.log(`\n=== Batch complete: ${okCount}/${results.length} products succeeded ===`);
  console.log(`Total time: ${total}s`);

  if (okCount < results.length) {
    console.log("\nFailed products:");
    results.filter((r) => !r.ok).forEach((r) => console.log(`  - ${r.name}`));
  }
})();
