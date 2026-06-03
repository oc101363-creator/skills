import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MAPPING_SPEC_PATH = path.join(__dirname, "../references/主图_template_mapping_spec.json");
const PRODUCT_DIR = process.argv[2];
const OUTPUT_DIR = process.argv[3] || PRODUCT_DIR;

if (!PRODUCT_DIR) {
  console.error("Usage: node generate_main_specs.mjs <product_dir> [output_dir]");
  process.exit(1);
}

// ── Load files ──
const mappingSpec = JSON.parse(fs.readFileSync(MAPPING_SPEC_PATH, "utf8"));
const infoPath = path.join(PRODUCT_DIR, "info.json");
if (!fs.existsSync(infoPath)) {
  console.error(`No info.json found in ${PRODUCT_DIR}`);
  process.exit(1);
}
const info = JSON.parse(fs.readFileSync(infoPath, "utf8"));

const processedDir = path.join(PRODUCT_DIR, "processed");

// ── Transform helpers ──
function removeSkuPrefix(title) {
  let cleaned = title.replace(/^\d+[\-–—]\d+\s+/, "");
  if (cleaned === title) {
    cleaned = title.replace(/^[A-Z]+\d+[A-Z0-9\-]*\s+(?=Starter|Alternator|Wiper|Motor|for|Compatible|Fit)/i, "");
  }
  if (cleaned === title) {
    cleaned = title.replace(/^\d+[A-Z]+\d*\s+(?=Starter|Alternator|Wiper|Motor|for|Compatible|Fit)/i, "");
  }
  return cleaned.trim();
}

function formatFitmentLine(v) {
  const year = v.year_start === v.year_end
    ? `${v.year_start}`
    : `${v.year_start}-${v.year_end}`;
  return `${year} ${v.make} ${v.model} ${v.engine || ""}`.trim();
}

function formatSpecTable(specs) {
  return specs.map(s => `${s.label}: ${s.value}`).join("\n");
}

function extractFeatures(bullets, max = 3) {
  const feats = info.features || [];
  const result = [];
  for (let i = 0; i < Math.min(max, feats.length); i++) {
    result.push({
      title: feats[i].title,
      description: feats[i].description
    });
  }
  // fallback
  const fallbacks = [
    { title: "DURABLE CONSTRUCTION", description: "Built with premium materials for long-lasting reliability." },
    { title: "PRECISE FIT", description: "Engineered to match OEM specifications for easy installation." },
    { title: "POWERFUL PERFORMANCE", description: "Delivers consistent output under all driving conditions." }
  ];
  while (result.length < max) {
    result.push({ ...fallbacks[result.length % fallbacks.length] });
  }
  return result;
}

function extractAdvantages(max = 4) {
  const feats = info.features || [];
  const titles = feats.slice(0, max).map(f => f.title);
  while (titles.length < max) titles.push("Premium Quality");
  return titles;
}

function resolvePhoto(refKey, mapping) {
  const filename = mapping[refKey];
  if (!filename) return null;
  const p = path.join(processedDir, filename);
  return fs.existsSync(p) ? p : null;
}

// ── Build specs per output image ──
const specs = {
  product_name: info.product_info?.sku || path.basename(PRODUCT_DIR),
  category: info.product_info?.category || "starter_motor",
  brand: "VEXRIM",
  generated_at: new Date().toISOString(),
  images: {}
};

for (const [imgNum, cfg] of Object.entries(mappingSpec.output_images)) {
  const entry = {
    type: cfg.template_type === "fixed_copy" ? "copy" : cfg.template_type === "white_bg" ? "copy" : "api",
    name: cfg.name,
    name_en: cfg.name_en,
    output: path.join(OUTPUT_DIR, "主图", `${imgNum}.jpg`),
    template_file: cfg.template_file || null,
    api_params: cfg.api_params,
    prompt_data: {},
    photo_refs: {},
    prompt_rules: cfg.prompt_rules || []
  };

  // Resolve factory photos
  for (const [refKey, filename] of Object.entries(cfg.factory_photo_mapping || {})) {
    const p = path.join(processedDir, filename);
    entry.photo_refs[refKey] = fs.existsSync(p) ? p : null;
  }

  // Resolve info.json data
  for (const [fieldKey, fieldCfg] of Object.entries(cfg.info_json_mapping || {})) {
    const src = fieldCfg.source;
    let value = null;

    // Navigate source path in info.json
    const parts = src.split(".");
    let cursor = info;
    for (const part of parts) {
      cursor = cursor?.[part];
      if (cursor === undefined) break;
    }
    value = cursor;

    // Apply transforms
    if (fieldCfg.transform === "remove_sku_prefix" && typeof value === "string") {
      value = removeSkuPrefix(value);
    } else if (fieldCfg.transform === "parse_fitment") {
      if (Array.isArray(value)) {
        value = value.slice(0, fieldCfg.max_items || 6).map(formatFitmentLine);
      } else {
        value = [];
      }
    } else if (fieldCfg.transform === "format_spec_table") {
      if (Array.isArray(value)) {
        value = formatSpecTable(value);
      } else {
        value = "";
      }
    }

    // Apply extract rules
    if (fieldCfg.extract === "first_3" && Array.isArray(value)) {
      value = value.slice(0, fieldCfg.max_items || 3).map(f => ({
        title: f.title || "",
        description: f.description || ""
      }));
    } else if (fieldCfg.extract === "titles" && Array.isArray(value)) {
      value = value.slice(0, fieldCfg.max_items || 4).map(f => f.title || "");
    }

    // Fallback for features if empty
    if (fieldKey === "features" && (!value || value.length === 0)) {
      value = [
        { title: "DURABLE CONSTRUCTION", description: "Built with premium materials for long-lasting reliability." },
        { title: "PRECISE FIT", description: "Engineered to match OEM specifications for easy installation." },
        { title: "POWERFUL PERFORMANCE", description: "Delivers consistent output under all driving conditions." }
      ];
    }

    // Fallback for advantages if empty
    if (fieldKey === "advantages" && (!value || value.length === 0)) {
      value = ["Premium Quality", "Durable Build", "Exact Fit", "Tested Performance"];
    }

    entry.prompt_data[fieldKey] = value;
  }

  // Special handling for white_bg
  if (cfg.template_type === "white_bg") {
    entry.source = entry.photo_refs.product_main;
    entry.action = "copy_processed_to_output";
  }

  // Special handling for fixed_copy
  if (cfg.template_type === "fixed_copy") {
    entry.source = path.join(__dirname, cfg.template_file);
    entry.action = "copy_template_to_output";
  }

  specs.images[imgNum] = entry;
}

// ── Write output ──
const outPath = path.join(OUTPUT_DIR, "主图_specs.json");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(specs, null, 2), "utf8");
console.log(`主图_specs.json written to ${outPath}`);
console.log(`Images planned: ${Object.keys(specs.images).length}`);
for (const [k, v] of Object.entries(specs.images)) {
  const hasPhotos = Object.values(v.photo_refs).some(p => p !== null);
  const hasData = Object.keys(v.prompt_data).length > 0;
  console.log(`  [${k}] ${v.name} | type=${v.type} | photos=${hasPhotos ? "OK" : "MISSING"} | data=${hasData ? "OK" : "N/A"}`);
}
