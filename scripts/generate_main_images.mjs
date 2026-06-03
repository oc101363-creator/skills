import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const envPath = path.resolve(__dirname, "../.env");
const API_KEY = fs.readFileSync(envPath, "utf8").match(/APIMART_API_KEY=(.+)/)?.[1]?.trim();
if (!API_KEY) { console.error("Missing API key in .env"); process.exit(1); }

const BASE_URL = "https://api.apimart.ai";
const headers = { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" };
const TEMPLATE_DIR = path.join(__dirname, "../templates");

const PRODUCT_DIR = process.argv[2];
if (!PRODUCT_DIR) {
  console.error("Usage: node generate_main_images.mjs <product_dir>");
  console.error("Example: node generate_main_images.mjs './products/11537N'");
  process.exit(1);
}

const PROCESSED_DIR = path.join(PRODUCT_DIR, "processed");
const OUTPUT_DIR = PRODUCT_DIR;

const INFO_PATH = path.join(PRODUCT_DIR, "info.json");
const info = fs.existsSync(INFO_PATH) ? JSON.parse(fs.readFileSync(INFO_PATH, "utf8")) : null;

function toDataUri(file) {
  const ext = path.extname(file).toLowerCase().replace(".", "");
  const mime = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
  const b64 = fs.readFileSync(file).toString("base64");
  return `data:${mime};base64,${b64}`;
}

async function submitTask(prompt, imageUrls) {
  const payload = { model: "gpt-image-2", prompt, n: 1, resolution: "2k", image_urls: imageUrls };
  const res = await fetch(`${BASE_URL}/v1/images/generations`, { method: "POST", headers, body: JSON.stringify(payload) });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  const json = JSON.parse(text);
  return json?.data?.[0]?.task_id;
}

async function pollTask(taskId) {
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
  if (!res.ok) throw new Error(`dl ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function generate01() {
  const src = path.join(PROCESSED_DIR, "1.jpg");
  const dest = path.join(OUTPUT_DIR, "01.jpg");
  if (!fs.existsSync(src)) { console.log("[01] Skip: no processed/1.jpg"); return; }
  fs.copyFileSync(src, dest);
  console.log("[01] Copied processed/1.jpg -> 01.jpg");
}

async function generate02(parsed) {
  const template = path.join(TEMPLATE_DIR, "02_产品介绍_模板_20260520073309.png");
  const photo1 = path.join(PROCESSED_DIR, "1.jpg");
  const photo3 = path.join(PROCESSED_DIR, "3.jpg");
  const dest = path.join(OUTPUT_DIR, "02.jpg");
  if (!fs.existsSync(template) || !fs.existsSync(photo1)) { console.log("[02] Skip: missing assets"); return; }

  const features = parsed.features || [];
  const f1 = features[0] || { title: "DURABLE CONSTRUCTION", description: "Built with premium materials for long-lasting reliability." };
  const f2 = features[1] || { title: "PRECISE FIT", description: "Engineered to match OEM specifications for easy installation." };
  const f3 = features[2] || { title: "POWERFUL PERFORMANCE", description: "Delivers consistent output under all driving conditions." };

  const prompt = `Take this VEXRIM product introduction template and fill ALL placeholder areas with the real product data below.

BRAND STYLE (preserve exactly):
- VEXRIM logo at top-left in Hermès orange (#F37021).
- Orange accent for highlights and decorative lines.
- Clean white background.
- Modern bold uppercase headlines.

ASSET MAPPING:
- Template: the first image after this prompt.
- Product Photo (main): the second image — place in the large right/top area.
- Scene Photo (angle): the third image — place in the smaller left area if available.

PRODUCT: ${parsed.title?.full || "Premium Starter Motor"}

FEATURES (use exactly these, first 3):
1. ${f1.title}: ${f1.description}
2. ${f2.title}: ${f2.description}
3. ${f3.title}: ${f3.description}

PLACEHOLDER FILLS:
- PRODUCT_PHOTO_ZONE → Use the main product photo (second image).
- SCENE_PHOTO_ZONE → Use the angle/scene photo (third image).
- FEATURE_1_TITLE/DESC → first feature above.
- FEATURE_2_TITLE/DESC → second feature above.
- FEATURE_3_TITLE/DESC → third feature above.

RULES:
- Keep the product photos IDENTICAL to the references — do NOT alter shape or angle.
- All text in ENGLISH.
- ZERO HALLUCINATION: only use provided feature text.

OUTPUT: Complete filled VEXRIM product introduction poster, 1:1 square, white/orange.`;

  const imageUrls = [toDataUri(template), toDataUri(photo1)];
  if (fs.existsSync(photo3)) imageUrls.push(toDataUri(photo3));

  console.log("[02] Submitting...");
  const taskId = await submitTask(prompt, imageUrls);
  const data = await pollTask(taskId);
  const url = data?.result?.images?.[0]?.url?.[0];
  if (!url) throw new Error("no url");
  await download(url, dest);
  console.log(`[02] Saved (${data.actual_time}s)`);
}

async function generate03(parsed) {
  const template = path.join(TEMPLATE_DIR, "03_兼容性信息_模板_20260520073309.png");
  const dest = path.join(OUTPUT_DIR, "03.jpg");
  if (!fs.existsSync(template)) { console.log("[03] Skip: missing template"); return; }

  const vehicles = parsed.compatibility?.vehicles || [];
  const fitmentLines = vehicles.slice(0, 6).map(v => {
    const year = v.year_start === v.year_end ? `${v.year_start}` : `${v.year_start}-${v.year_end}`;
    return `${year} ${v.make} ${v.model} ${v.engine || ""}`.trim();
  });
  const oeText = (parsed.oe_numbers || []).slice(0, 6).join(", ") || "OE numbers available per title.";

  const prompt = `Take this VEXRIM vehicle compatibility & OE number template and fill ALL placeholder areas.

BRAND STYLE:
- VEXRIM orange (#F37021) logo and accents.
- Clean white/light gray background.
- Bold uppercase section headers.

VEHICLE FITMENT:
${fitmentLines.length > 0 ? fitmentLines.join("\n") : "See product title for fitment details."}

OE PART NUMBERS (copy verbatim, max 6):
${oeText}

PLACEHOLDER FILLS:
- VEHICLE_SCENE_ZONE → Generate a subtle, professional automotive scene background (NO visible brand logos).
- FITMENT_ITEM_1~6 → vehicle year/model lines.
- OE_NUMBER_1~4 → OE replacement numbers.

ZERO HALLUCINATION:
- All vehicle years and part numbers MUST come from the data above ONLY.
- Copy part numbers VERBATIM.

OUTPUT: Complete VEXRIM compatibility poster, 1:1 square.`;

  console.log("[03] Submitting...");
  const taskId = await submitTask(prompt, [toDataUri(template)]);
  const data = await pollTask(taskId);
  const url = data?.result?.images?.[0]?.url?.[0];
  if (!url) throw new Error("no url");
  await download(url, dest);
  console.log(`[03] Saved (${data.actual_time}s)`);
}

async function generate04(parsed) {
  const template = path.join(TEMPLATE_DIR, "04_技术规格_模板_20260520071411.png");
  const photo1 = path.join(PROCESSED_DIR, "1.jpg");
  const dest = path.join(OUTPUT_DIR, "04.jpg");
  if (!fs.existsSync(template) || !fs.existsSync(photo1)) { console.log("[04] Skip: missing assets"); return; }

  const specs = parsed.specifications || [];
  const specsText = specs.length > 0
    ? specs.map(s => `${s.label}: ${s.value}`).join("\n")
    : "See product title for specifications.";

  const prompt = `Take this VEXRIM technical specifications template and fill ALL placeholder areas.

BRAND STYLE:
- Dark left panel with white text and orange accents.
- Clean right panel for product photo.
- VEXRIM orange (#F37021) highlights.

TECHNICAL SPECIFICATIONS:
${specsText}

ASSET MAPPING:
- Left panel (SPEC_TABLE_ZONE): fill with the specifications above in clean label-value format.
- Right panel (PRODUCT_PHOTO_ZONE): use the product photo reference image.

RULES:
- Product photo must remain IDENTICAL to the reference.
- All specs verbatim from the data above.
- Include: Voltage, Power, Teeth, Rotation, Compatible Years, OE Replacement if available.

OUTPUT: Complete VEXRIM technical specifications poster, 1:1 square.`;

  console.log("[04] Submitting...");
  const taskId = await submitTask(prompt, [toDataUri(template), toDataUri(photo1)]);
  const data = await pollTask(taskId);
  const url = data?.result?.images?.[0]?.url?.[0];
  if (!url) throw new Error("no url");
  await download(url, dest);
  console.log(`[04] Saved (${data.actual_time}s)`);
}

async function generate05() {
  const template = path.join(TEMPLATE_DIR, "05_细节特写_模板_20260520073309.png");
  const photos = [4, 5, 6, 7].map(i => path.join(PROCESSED_DIR, `${i}.jpg`)).filter(p => fs.existsSync(p));
  const dest = path.join(OUTPUT_DIR, "05.jpg");
  if (!fs.existsSync(template) || photos.length === 0) { console.log("[05] Skip: missing assets"); return; }

  const prompt = `Take this VEXRIM product details close-up template and fill the 4 photo slots with the provided close-up images.

BRAND STYLE:
- VEXRIM logo top-left, orange accent line.
- 2x2 grid of close-up photos.
- Clean white background.

ASSET MAPPING (each photo must go in a separate slot):
${photos.map((p, i) => `- Photo ${i + 1}: ${path.basename(p)} → DETAIL_PHOTO_${i + 1}`).join("\n")}

RULES:
- Each close-up photo must faithfully reproduce the reference — do NOT alter product shape, details, or proportions.
- Photos should fill their grid slots cleanly.
- No additional text or labels needed beyond what's in the template.

OUTPUT: Complete VEXRIM details poster with 4 close-ups in 2x2 grid, 1:1 square.`;

  const imageUrls = [toDataUri(template), ...photos.map(toDataUri)];

  console.log("[05] Submitting...");
  const taskId = await submitTask(prompt, imageUrls);
  const data = await pollTask(taskId);
  const url = data?.result?.images?.[0]?.url?.[0];
  if (!url) throw new Error("no url");
  await download(url, dest);
  console.log(`[05] Saved (${data.actual_time}s)`);
}

async function generate06(parsed) {
  const template = path.join(TEMPLATE_DIR, "06_对比图_模板_20260520073309.png");
  const photo1 = path.join(PROCESSED_DIR, "1.jpg");
  const dest = path.join(OUTPUT_DIR, "06.jpg");
  if (!fs.existsSync(template) || !fs.existsSync(photo1)) { console.log("[06] Skip: missing assets"); return; }

  const features = parsed.features || [];
  const advantages = features.slice(0, 4).map(f => f.title);
  while (advantages.length < 4) advantages.push("Premium Quality");

  const prompt = `Take this VEXRIM "Others vs VEXRIM" comparison template and fill ALL placeholder areas.

BRAND STYLE:
- VEXRIM orange logo, clean white background.
- Left side shows OLD/WORN product (darkened, aged appearance).
- Right side shows NEW premium VEXRIM product (bright, clean).
- Bottom bar with 4 brand promise badges.

ASSET MAPPING:
- VEXRIM_PRODUCT_PHOTO → use the provided new product photo on the RIGHT side.
- OTHERS_PRODUCT_PHOTO → generate an aged/worn version of the same product for the LEFT side.

VEXRIM ADVANTAGES (list on right):
1. ${advantages[0]}
2. ${advantages[1]}
3. ${advantages[2]}
4. ${advantages[3]}

RULES:
- Both left and right products must be the SAME starter motor model.
- Left side should look visibly aged/diminished; right side should look new and premium.
- Do NOT alter the fundamental product shape.

OUTPUT: Complete VEXRIM comparison poster, 1:1 square.`;

  console.log("[06] Submitting...");
  const taskId = await submitTask(prompt, [toDataUri(template), toDataUri(photo1)]);
  const data = await pollTask(taskId);
  const url = data?.result?.images?.[0]?.url?.[0];
  if (!url) throw new Error("no url");
  await download(url, dest);
  console.log(`[06] Saved (${data.actual_time}s)`);
}

async function generate07() {
  const template = path.join(TEMPLATE_DIR, "07_品牌服务_模板.png");
  const dest = path.join(OUTPUT_DIR, "07.jpg");
  if (!fs.existsSync(template)) {
    console.log("[07] Skip: no 07 brand service template found. Please add 07_品牌服务_模板.png to templates/");
    return;
  }
  fs.copyFileSync(template, dest);
  console.log("[07] Copied template -> 07.jpg");
}

(async () => {
  const startTime = Date.now();

  console.log(`Product: ${path.basename(PRODUCT_DIR)}`);
  console.log(`Processed dir: ${PROCESSED_DIR}`);
  console.log(`Info.json: ${info ? "found" : "NOT FOUND — skipping 02/03/04/06"}`);
  console.log("=".repeat(50));

  await generate01();
  if (info) {
    await generate02(info);
    await generate03(info);
    await generate04(info);
  } else {
    console.log("[02/03/04] Skipped (no info.json)");
  }
  await generate05();
  if (info) {
    await generate06(info);
  } else {
    console.log("[06] Skipped (no info.json)");
  }
  await generate07();

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log("=".repeat(50));
  console.log(`All done in ${elapsed}s. Output: ${OUTPUT_DIR}`);
})();
