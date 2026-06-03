import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ──
const ENV_PATH = "/Users/mingkaichen/项目/image2/.env";
if (!fs.existsSync(ENV_PATH)) {
  console.error(`.env not found at ${ENV_PATH}`);
  process.exit(1);
}
const envContent = fs.readFileSync(ENV_PATH, "utf8");
const API_KEY = envContent.match(/APIMART_API_KEY=(.+)/)?.[1]?.trim();
if (!API_KEY) { console.error("Missing API key"); process.exit(1); }

const BASE_URL = "https://api.apimart.ai";
const headers = { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" };

const PRODUCT_DIR = process.argv[2] ? path.resolve(process.argv[2]) : __dirname;
const PROCESSED_DIR = path.join(PRODUCT_DIR, "processed");
const OUT_DIR = path.join(PRODUCT_DIR, "A+");

const TEMPLATE_PC_DIR = path.join(process.env.HOME, ".claude/skills/vexrim-amazon-workflow/templates/A_Plus/PC");
const TEMPLATE_MOBILE_DIR = path.join(process.env.HOME, ".claude/skills/vexrim-amazon-workflow/templates/A_Plus/moblie");

const DRY_RUN = process.argv.includes("--dry-run");
const ONLY_ARG = process.argv.find(a => a.startsWith("--only="));
const ONLY_KEYS = ONLY_ARG ? ONLY_ARG.slice(7).split(",").map(s => s.trim()) : null;

// ── Utils ──
function toDataUri(file) {
  const ext = path.extname(file).toLowerCase().replace(".", "");
  const mime = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
  const b64 = fs.readFileSync(file).toString("base64");
  return `data:${mime};base64,${b64}`;
}

async function submitTask(prompt, imageUrls, size) {
  const payload = { model: "gpt-image-2", prompt, n: 1, size, resolution: "2k", image_urls: imageUrls };
  const res = await fetch(`${BASE_URL}/v1/images/generations`, { method: "POST", headers, body: JSON.stringify(payload) });
  const text = await res.text();
  if (!res.ok) throw new Error(`submit HTTP ${res.status}: ${text}`);
  const json = JSON.parse(text);
  const taskId = json?.data?.[0]?.task_id;
  if (!taskId) throw new Error(`no task_id: ${text}`);
  return taskId;
}

async function pollTask(taskId) {
  const start = Date.now();
  while (Date.now() - start < 1200000) {
    const res = await fetch(`${BASE_URL}/v1/tasks/${taskId}`, { headers });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = null; }
    const data = json?.data;
    const status = data?.status ?? "unknown";
    if (status === "completed") return data;
    if (status === "failed") throw new Error(`failed: ${JSON.stringify(data?.error || json)}`);
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error("timeout");
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download HTTP ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

function resizeForApi(imgPath, outPath) {
  try {
    execSync(`sips -Z 512 "${imgPath}" --out "${outPath}" > /dev/null 2>&1`);
    return outPath;
  } catch {
    return imgPath;
  }
}

// ── Load product info ──
const infoPath = path.join(PRODUCT_DIR, "processed/info.json");
if (!fs.existsSync(infoPath)) {
  console.error("processed/info.json not found");
  process.exit(1);
}
const info = JSON.parse(fs.readFileSync(infoPath, "utf8"));

// ── Pick photos ──
function pickPhotos() {
  const files = fs.readdirSync(PROCESSED_DIR)
    .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
    .sort();

  const heroFile = files.find(f => /^01\./i.test(f)) || files.find(f => /^1\./i.test(f)) || files[0];
  const hero = heroFile ? path.join(PROCESSED_DIR, heroFile) : null;

  // Match both "04.png" and "4.png" naming styles for detail photos
  const detailPatterns = [
    /^04\./i, /^4\./i,
    /^05\./i, /^5\./i,
    /^06\./i, /^6\./i,
    /^07\./i, /^7\./i
  ];
  const seen = new Set();
  const details = [];
  for (const pat of detailPatterns) {
    const f = files.find(f => pat.test(f) && !seen.has(f));
    if (f) {
      seen.add(f);
      details.push(path.join(PROCESSED_DIR, f));
    }
  }

  return { hero, details };
}

const photos = pickPhotos();
console.log(`Photos: hero=${photos.hero ? path.basename(photos.hero) : "NONE"}, details=${photos.details.map(p => path.basename(p)).join(",")}`);

// ── Resize all refs for API (with path-hash to avoid PC/mobile collision) ──
const TMP_DIR = path.join(PRODUCT_DIR, ".tmp_apigen");
fs.mkdirSync(TMP_DIR, { recursive: true });

function resized(file) {
  if (!file || !fs.existsSync(file)) return null;
  const hash = Buffer.from(file).toString("base64url").slice(-16);
  const out = path.join(TMP_DIR, `${hash}_${path.basename(file)}`);
  if (fs.existsSync(out)) return out;
  return resizeForApi(file, out);
}

const rHero = resized(photos.hero);
const rDetails = photos.details.map(resized);

// ── Infer vehicle type from fitment ──
function inferVehicleType(rows) {
  if (!rows || rows.length === 0) return "automotive";
  const make = (rows[0][1] || "").toLowerCase();
  const model = (rows[0][2] || "").toLowerCase();

  const motorcycleBrands = ["kawasaki", "yamaha", "suzuki", "ducati", "harley-davidson", "triumph"];
  if (motorcycleBrands.some(b => make.includes(b))) return "motorcycle";

  const truckModels = ["tundra", "silverado", "sierra", "f-150", "f150", "ram", "titan", "frontier"];
  if (truckModels.some(m => model.includes(m))) return "pickup truck";

  const suvModels = ["cr-v", "crv", "rav4", "highlander", "explorer", "escalade", "sequoia", "land cruiser", "lx570", "fx35", "fx45"];
  if (suvModels.some(m => model.includes(m))) return "SUV";

  const sedanModels = ["accord", "civic", "camry", "corolla", "350z", "altima"];
  if (sedanModels.some(m => model.includes(m))) return "sedan";

  return "automotive";
}

// ── Prompt builders (hard-coded field mapping) ──

function buildPrompt01(info, platform) {
  const category = info.product_info?.category || "Automotive Part";
  const headline = info.hero?.headline || category;
  const sub = info.hero?.subheadline || "";
  const vehicleType = inferVehicleType(info.vehicle_fitment?.rows);

  const featText = info.features
    ? Object.values(info.features).slice(0, 4).map((f, i) => `${i + 1}. ${f.title} — ${f.description}`).join("\n")
    : "";

  return `Design a premium automotive parts HERO poster for the VEXRIM brand.

BRAND IDENTITY:
- VEXRIM logo in Hermès orange (#F37021) at top-left corner, small and clean
- Accent color: #F37021 orange
- Dark background (#0a0a0a to #111111)
- Typography: Modern bold sans-serif, massive headline hierarchy
- Overall feel: Premium, confident, editorial

CRITICAL REQUIREMENTS:
1. LARGE PRODUCT PHOTO: The product (a ${category}) must be the dominant visual element — large, dramatic studio lighting, metallic sheen, crisp detail.

2. HEADLINE: "${headline}" in very large bold white text.

3. SUBHEADLINE: "${sub}" in smaller gray text beneath the headline.

4. FOUR FEATURE BLOCKS:
${featText}
Each block: small orange square icon + white bold title + smaller white description.
TEXT SIZE RULE: All text in the feature blocks must be clearly legible and AT LEAST 12px equivalent in the final image. Do NOT render the text smaller than 12px.

5. VEHICLE SCENE: A subtle, cinematic ${vehicleType} scene in the background — atmospheric but NOT overly dark or dim. The vehicle must be a COMPLETELY generic silhouette with NO brand logo, NO emblem, NO grille badge, NO hood ornament, NO identifying marks of any kind. The background should complement the product without overpowering it.

6. NO placeholder text. All text must be real content.

ASSETS:
- Reference Image 1 = Layout template (copy this exact layout: product placement, headline position, feature block arrangement, background style, logo placement). Only replace the product photo and text content.
- Photo A = EXACT product photo (this is the verbatim product image — use it EXACTLY as provided. Do NOT redraw, redesign, recolor, or reinterpret the product. Preserve every detail, shape, material finish, and proportion precisely.)

OUTPUT: ${platform === "pc" ? "1464x600 landscape" : "1024x768 portrait-landscape"} poster. Premium, cinematic, bold.`;
}

function buildPrompt02(info, platform) {
  const fitmentText = info.vehicle_fitment?.rows?.map(r =>
    `  ${r[0]} | ${r[1]} | ${r[2]}${r[3] ? " | " + r[3] : ""}`
  ).join("\n") || "";
  const oeText = info.oe_part_numbers?.join("  ") || "";
  const specsText = info.specifications?.map(s => `  ${s.label}: ${s.value}`).join("\n") || "";

  return `Design a premium automotive parts FITMENT & SPECS poster for the VEXRIM brand.

BRAND IDENTITY:
- NO logo on this image — text and graphics only.
- Accent color: #F37021 orange
- Dark background (#0a0a0a to #111111)
- Typography: Modern bold sans-serif

CRITICAL REQUIREMENTS:
1. STANDARDIZED LAYOUT: clean modular grid, CONSISTENT font sizes.
2. NO PRODUCT PHOTOS: text and graphics only.

SECTION A — VEHICLE FITMENT:
${fitmentText}

SECTION B — OE PART NUMBERS:
${oeText}

SECTION C — SPECIFICATIONS:
${specsText}

STYLE RULES:
- 3 font sizes max (header / data / label)
- Orange divider lines between sections
- Dark background, no gradients in data areas
- TEXT SIZE RULE: All text in the image must be clearly legible and AT LEAST 12px equivalent in the final image. Do NOT render any text smaller than 12px.

ASSETS:
- Reference Image 1 = Layout template (copy exact layout: section positions, divider style, font hierarchy, spacing). Only replace text content.

OUTPUT: ${platform === "pc" ? "1464x600 landscape" : "1024x768"} poster. Standardized, clean, data-driven.`;
}

function buildPrompt04(info, platform, panelCount = 3) {
  if (panelCount === 4) {
    return `Design a premium automotive parts DETAIL CLOSEUPS poster for the VEXRIM brand.

BRAND IDENTITY:
- NO logo on this image — product details only.
- Accent color: #F37021 orange
- Dark background (#0a0a0a to #111111)

CRITICAL REQUIREMENTS:
1. FOUR PANELS arranged horizontally with thin orange borders:
   - Panel 1 (far left): product detail photo only. NO text label above the photo.
   - Panel 2 (left-center): product detail photo only. NO text label above the photo.
   - Panel 3 (right-center): product detail photo only. NO text label above the photo.
   - Panel 4 (far right): product detail photo only. NO text label above the photo.

2. TOP TITLE: "DURABLE AND RELIABLE" — "DURABLE" in orange, "AND RELIABLE" in white
3. BOTTOM: faint "DETAILS" watermark

MOST IMPORTANT — USE THE EXACT PHOTOS PROVIDED:
- Photo A → Panel 1 (far left)
- Photo B → Panel 2 (left-center)
- Photo C → Panel 3 (right-center)
- Photo D → Panel 4 (far right)

ASSETS:
- Reference Image 1 = Layout template (copy exact layout: panel positions, border style, title placement). Only replace product photos inside panels.
- Photo A = EXACT panel 1 product photo (verbatim product image — use it EXACTLY as provided. Do NOT redraw, redesign, recolor, or reinterpret the product. Preserve every detail, shape, material finish, and proportion precisely.)
- Photo B = EXACT panel 2 product photo (verbatim product image — use it EXACTLY as provided. Do NOT redraw, redesign, recolor, or reinterpret the product. Preserve every detail, shape, material finish, and proportion precisely.)
- Photo C = EXACT panel 3 product photo (verbatim product image — use it EXACTLY as provided. Do NOT redraw, redesign, recolor, or reinterpret the product. Preserve every detail, shape, material finish, and proportion precisely.)
- Photo D = EXACT panel 4 product photo (verbatim product image — use it EXACTLY as provided. Do NOT redraw, redesign, recolor, or reinterpret the product. Preserve every detail, shape, material finish, and proportion precisely.)

TEXT SIZE RULE: All text in the image (top title, watermark) must be clearly legible and AT LEAST 12px equivalent in the final image. Do NOT render any text smaller than 12px.

OUTPUT: ${platform === "pc" ? "1464x600 landscape" : "1024x768"} poster. Product detail showcase, premium craftsmanship feel.`;
  }

  return `Design a premium automotive parts DETAIL CLOSEUPS poster for the VEXRIM brand.

BRAND IDENTITY:
- NO logo on this image — product details only.
- Accent color: #F37021 orange
- Dark background (#0a0a0a to #111111)

CRITICAL REQUIREMENTS:
1. THREE PANELS arranged horizontally with thin orange borders:
   - Left panel: product detail photo only. NO text label above the photo.
   - Center panel: product detail photo only. NO text label above the photo.
   - Right panel: product detail photo only (make this LARGER). NO text label above the photo.

2. TOP TITLE: "DURABLE AND RELIABLE" — "DURABLE" in orange, "AND RELIABLE" in white
3. BOTTOM: faint "DETAILS" watermark

MOST IMPORTANT — USE THE EXACT PHOTOS PROVIDED:
- Photo A → LEFT panel
- Photo B → CENTER panel
- Photo C → RIGHT panel

ASSETS:
- Reference Image 1 = Layout template (copy exact layout: panel positions, border style, title placement). Only replace product photos inside panels.
- Photo A = EXACT left panel product photo (verbatim product image — use it EXACTLY as provided. Do NOT redraw, redesign, recolor, or reinterpret the product. Preserve every detail, shape, material finish, and proportion precisely.)
- Photo B = EXACT center panel product photo (verbatim product image — use it EXACTLY as provided. Do NOT redraw, redesign, recolor, or reinterpret the product. Preserve every detail, shape, material finish, and proportion precisely.)
- Photo C = EXACT right panel product photo (verbatim product image — use it EXACTLY as provided. Do NOT redraw, redesign, recolor, or reinterpret the product. Preserve every detail, shape, material finish, and proportion precisely.)

TEXT SIZE RULE: All text in the image (top title, watermark) must be clearly legible and AT LEAST 12px equivalent in the final image. Do NOT render any text smaller than 12px.

OUTPUT: ${platform === "pc" ? "1464x600 landscape" : "1024x768"} poster. Product detail showcase, premium craftsmanship feel.`;
}

// ── Job definitions ──
function makeJobs(platform) {
  const templateDir = platform === "pc" ? TEMPLATE_PC_DIR : TEMPLATE_MOBILE_DIR;
  const platformDir = path.join(OUT_DIR, platform);
  fs.mkdirSync(platformDir, { recursive: true });

  const apiSize = platform === "pc" ? "auto" : "1024x768";
  const jobs = [];

  // 01 Hero
  const template01 = path.join(templateDir, "01.png");
  if (fs.existsSync(template01) && photos.hero) {
    jobs.push({
      key: "01_hero",
      dest: path.join(platformDir, "01.png"),
      apiSize,
      prompt: buildPrompt01(info, platform),
      refs: [resized(template01), rHero].filter(Boolean)
    });
  }

  // 02 Fitment & Specs
  const template02 = path.join(templateDir, "02.png");
  if (fs.existsSync(template02)) {
    jobs.push({
      key: "02_fitment_specs",
      dest: path.join(platformDir, "02.png"),
      apiSize,
      prompt: buildPrompt02(info, platform),
      refs: [resized(template02)].filter(Boolean)
    });
  }

  // 03 Why Choose Us (fixed copy) — only when 04 uses 4-panel
  const use4Panel = photos.details.length >= 4;
  const template03 = path.join(templateDir, "03.png");
  if (use4Panel && fs.existsSync(template03)) {
    const dest03 = path.join(platformDir, "03.png");
    if (!DRY_RUN) fs.copyFileSync(template03, dest03);
    console.log(`  [${platform}] 03_why_choose_us -> copied`);
  }

  // 04 Detail Closeups
  const template04Name = use4Panel ? "04_2.png" : (platform === "mobile" ? "04_.png" : "04.png");
  const template04 = path.join(templateDir, template04Name);
  const minDetails = use4Panel ? 4 : 3;
  if (fs.existsSync(template04) && photos.details.length >= minDetails) {
    jobs.push({
      key: use4Panel ? "04_detail_closeups_4panel" : "04_detail_closeups",
      dest: path.join(platformDir, "04.png"),
      apiSize,
      prompt: buildPrompt04(info, platform, use4Panel ? 4 : 3),
      refs: [resized(template04), ...rDetails.slice(0, use4Panel ? 4 : 3)].filter(Boolean)
    });
  }

  // 05 Brand Endframe (fixed copy)
  const template05 = path.join(templateDir, "05.png");
  if (fs.existsSync(template05)) {
    const dest05 = path.join(platformDir, "05.png");
    if (!DRY_RUN) fs.copyFileSync(template05, dest05);
    console.log(`  [${platform}] 05_brand_endframe -> copied`);
  }

  return jobs;
}

// ── Run ──
const pcJobs = makeJobs("pc");
const mobileJobs = makeJobs("mobile");
let allJobs = [
  ...pcJobs.map(j => ({ ...j, platform: "pc" })),
  ...mobileJobs.map(j => ({ ...j, platform: "mobile" }))
];

if (ONLY_KEYS) {
  allJobs = allJobs.filter(j => ONLY_KEYS.some(k => j.key.includes(k)));
  console.log(`\nFiltered to ${allJobs.length} jobs (only: ${ONLY_KEYS.join(", ")})`);
}

console.log(`\nTotal API jobs: ${allJobs.length} (${pcJobs.filter(j => allJobs.includes(j)).length} PC + ${mobileJobs.filter(j => allJobs.includes(j)).length} Mobile)`);

if (DRY_RUN) {
  for (const job of allJobs) {
    const promptPath = job.dest.replace(".png", "_prompt.txt");
    fs.writeFileSync(promptPath, job.prompt);
    console.log(`  [${job.platform}] ${job.key} prompt saved -> ${promptPath}`);
  }
  console.log("\nDry run complete.");
  process.exit(0);
}

(async () => {
  // Phase 1: Submit all
  const submitted = await Promise.all(allJobs.map(async job => {
    try {
      const imageUrls = job.refs.map(toDataUri);
      const taskId = await submitTask(job.prompt, imageUrls, job.apiSize);
      console.log(`  ✅ [${job.platform}] ${job.key} -> ${taskId}`);
      return { ...job, taskId, ok: true };
    } catch (e) {
      console.error(`  ❌ [${job.platform}] ${job.key} submit failed: ${e.message}`);
      return { ...job, ok: false };
    }
  }));

  const okJobs = submitted.filter(s => s.ok);
  if (okJobs.length === 0) { console.error("All submissions failed"); process.exit(1); }

  // Phase 2: Poll
  await new Promise(r => setTimeout(r, 15000));
  const results = await Promise.all(okJobs.map(async ({ key, taskId, platform }) => {
    try {
      const data = await pollTask(taskId);
      console.log(`  ✅ [${platform}] ${key} done | ${data.actual_time}s`);
      return { key, platform, data, ok: true };
    } catch (e) {
      console.error(`  ❌ [${platform}] ${key} failed: ${e.message}`);
      return { key, platform, ok: false };
    }
  }));

  // Phase 3: Download (no resize — API returns exact size)
  let okCount = 0;
  for (const r of results) {
    if (!r.ok) continue;
    const url = r.data?.result?.images?.[0]?.url?.[0];
    if (!url) { console.error(`  ❌ [${r.platform}] ${r.key}: no URL`); continue; }

    const dest = allJobs.find(j => j.key === r.key && j.platform === r.platform).dest;
    try {
      await download(url, dest);
      const stats = fs.statSync(dest);
      console.log(`  ✅ [${r.platform}] ${r.key} -> ${dest} (${(stats.size / 1024).toFixed(1)} KB)`);
      okCount++;
    } catch (e) {
      console.error(`  ❌ [${r.platform}] ${r.key} download failed: ${e.message}`);
    }
  }

  console.log(`\n=== Done: ${okCount}/${allJobs.length} images generated ===`);
})();
