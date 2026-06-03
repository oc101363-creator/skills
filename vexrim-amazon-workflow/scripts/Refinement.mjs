import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const envPath = "/Users/mingkaichen/项目/image2/.env";
const API_KEY = fs.readFileSync(envPath, "utf8").match(/APIMART_API_KEY=(.+)/)?.[1]?.trim();
if (!API_KEY) { console.error("Missing API key in .env"); process.exit(1); }

const BASE_URL = "https://api.apimart.ai";
const headers = { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" };

const INPUT_DIR = process.argv[2];
if (!INPUT_DIR) {
  console.error("Usage: node Refinement.mjs <input_dir>");
  console.error("Example: node Refinement.mjs './products/11537N'");
  process.exit(1);
}

const OUT_DIR = path.join(INPUT_DIR, "processed");
fs.mkdirSync(OUT_DIR, { recursive: true });

const PROMPT = `Convert this factory starter motor photo into a professional Amazon/e-commerce white-background product image.

REQUIREMENTS:
1. Remove ALL background completely. Replace with pure white (#FFFFFF) only.
2. Retain the starter motor product EXACTLY as-is — same shape, same structure, same color, same details, same angle.
3. Relight the product with clean, professional studio lighting:
   - Eliminate harsh factory shadows and uneven ambient light.
   - Add soft, even top/side lighting to enhance the metallic silver casting and black motor body.
   - Add a subtle, soft bottom drop shadow for depth and realism.
4. Enhance overall image quality: increase clarity, crispness, and premium feel.
5. Product should occupy ~85–90% of the frame.
6. Output as a high-resolution square product photo, clean and ready for Amazon main image use.

ZERO HALLUCINATION: Only enhance lighting and background. The product itself must remain identical to the reference photo.`;

function toDataUri(file) {
  const ext = path.extname(file).toLowerCase().replace(".", "");
  const mime = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
  const b64 = fs.readFileSync(file).toString("base64");
  return `data:${mime};base64,${b64}`;
}

async function submit(imagePath) {
  const payload = { model: "gpt-image-2", prompt: PROMPT, n: 1, resolution: "2k", image_urls: [toDataUri(imagePath)] };
  const res = await fetch(`${BASE_URL}/v1/images/generations`, { method: "POST", headers, body: JSON.stringify(payload) });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  const json = JSON.parse(text);
  return json?.data?.[0]?.task_id;
}

async function poll(taskId) {
  const start = Date.now();
  while (Date.now() - start < 600000) {
    const res = await fetch(`${BASE_URL}/v1/tasks/${taskId}`, { headers });
    const data = JSON.parse(await res.text())?.data;
    if (data?.status === "completed") return data;
    if (data?.status === "failed") throw new Error(`failed: ${JSON.stringify(data?.error)}`);
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error("timeout");
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function processFile(fname) {
  const inPath = path.join(INPUT_DIR, fname);
  const outPath = path.join(OUT_DIR, fname);
  if (fs.existsSync(outPath)) {
    console.log(`[${fname}] Already processed, skipping.`);
    return;
  }
  console.log(`[${fname}] Submitting...`);
  const taskId = await submit(inPath);
  console.log(`[${fname}] Task: ${taskId}, polling...`);
  const data = await poll(taskId);
  const url = data?.result?.images?.[0]?.url?.[0];
  if (!url) throw new Error("no url");
  await download(url, outPath);
  console.log(`[${fname}] ✅ Saved (${data.actual_time}s)`);
}

(async () => {
  const files = fs.readdirSync(INPUT_DIR)
    .filter(f => /^\d+\.(jpg|jpeg|png)$/i.test(f))
    .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));

  if (files.length === 0) {
    console.error(`No numbered images (1.jpg ~ 7.jpg) found in ${INPUT_DIR}`);
    process.exit(1);
  }

  console.log(`Found ${files.length} images to polish.`);
  for (const f of files) {
    try { await processFile(f); }
    catch (e) { console.error(`[${f}] ❌ ${e.message}`); }
  }
  console.log(`\nDone. Output: ${OUT_DIR}`);
})();
