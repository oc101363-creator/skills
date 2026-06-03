import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MAPPING_SPEC_PATH = path.join(__dirname, "../references/A_Plus_template_mapping_spec.json");
const PRODUCT_DIR = process.argv[2];
const OUTPUT_DIR = process.argv[3] || PRODUCT_DIR;

if (!PRODUCT_DIR) {
  console.error("Usage: node generate_a_plus_specs.mjs <product_dir> [output_dir]");
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
  // 1. 常见零件号格式：428000-4790, 31100-R1A-A01
  let cleaned = title.replace(/^\d+[\-–—]\d+\s+/, "");
  // 2. 字母开头 SKU：ADR0368, TN-ST12
  if (cleaned === title) {
    cleaned = title.replace(/^[A-Z]+\d+[A-Z0-9\-]*\s+(?=Starter|Alternator|Wiper|Motor|for|Compatible|Fit)/i, "");
  }
  // 3. 数字开头 SKU：11537N, 428000
  if (cleaned === title) {
    cleaned = title.replace(/^\d+[A-Z]+\d*\s+(?=Starter|Alternator|Wiper|Motor|for|Compatible|Fit)/i, "");
  }
  return cleaned.trim();
}

function formatFitmentTable(vehicles, maxItems = 6) {
  const rows = (vehicles || []).slice(0, maxItems).map(v => {
    const year = v.year_start === v.year_end
      ? `${v.year_start}`
      : `${v.year_start}-${v.year_end}`;
    return {
      YEAR: year,
      MAKE: v.make || "",
      MODEL: v.model || "",
      NOTE: v.engine || ""
    };
  });
  return {
    headers: ["YEAR", "MAKE", "MODEL", "NOTE"],
    rows
  };
}

function formatVehiclePreview(vehicles, maxItems = 3) {
  return (vehicles || []).slice(0, maxItems).map(v => {
    const year = v.year_start === v.year_end
      ? `${v.year_start}`
      : `${v.year_start}-${v.year_end}`;
    return `${year} ${v.make} ${v.model}`.trim();
  });
}

function getDetailCallouts(category) {
  const defaults = mappingSpec.output_images["04"].info_json_mapping?.detail_callouts || {};
  return defaults[category] || defaults["default"] || ["DETAIL A", "DETAIL B", "DETAIL C"];
}

function resolvePhoto(filename) {
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
    type: cfg.template_type === "fixed_copy" ? "copy" : "api",
    name: cfg.name,
    name_en: cfg.name_en,
    output: path.join(OUTPUT_DIR, "A+", `${imgNum}.png`),
    template_file: cfg.template_file ? path.resolve(__dirname, cfg.template_file) : null,
    api_params: cfg.api_params,
    prompt_data: {},
    photo_refs: {},
    prompt_rules: cfg.prompt_rules || [],
    reference_order: cfg.reference_order || []
  };

  // Resolve factory photos
  for (const [refKey, filename] of Object.entries(cfg.factory_photo_mapping || {})) {
    entry.photo_refs[refKey] = resolvePhoto(filename);
  }

  // Resolve info.json data
  for (const [fieldKey, fieldCfg] of Object.entries(cfg.info_json_mapping || {})) {
    const src = fieldCfg.source;
    let value = null;

    if (src === "category") {
      value = info.product_info?.category || "starter_motor";
    } else {
      const parts = src.split(".");
      let cursor = info;
      for (const part of parts) {
        cursor = cursor?.[part];
        if (cursor === undefined) break;
      }
      value = cursor;
    }

    // Apply transforms
    if (fieldCfg.transform === "remove_sku_prefix" && typeof value === "string") {
      value = removeSkuPrefix(value);
    } else if (fieldCfg.transform === "first_feature_desc") {
      const feats = info.features || [];
      value = feats.length > 0 ? feats[0].description : fieldCfg.fallback || "";
    } else if (fieldCfg.transform === "format_fitment_table") {
      value = formatFitmentTable(value, fieldCfg.max_items);
    } else if (fieldCfg.transform === "format_year_make_model") {
      value = formatVehiclePreview(value, fieldCfg.max_items);
    } else if (fieldCfg.transform === "detail_labels_by_category") {
      value = getDetailCallouts(value);
    }

    // Apply max_items for arrays
    if (Array.isArray(value) && fieldCfg.max_items && fieldCfg.transform !== "format_fitment_table") {
      value = value.slice(0, fieldCfg.max_items);
    }

    entry.prompt_data[fieldKey] = value;
  }

  // Special handling for fixed_copy
  if (cfg.template_type === "fixed_copy") {
    entry.source = entry.template_file;
    entry.action = "copy_template_to_output";
  }

  specs.images[imgNum] = entry;
}

// ── Write output ──
const outPath = path.join(OUTPUT_DIR, "A_Plus_specs.json");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(specs, null, 2), "utf8");
console.log(`A_Plus_specs.json written to ${outPath}`);
console.log(`Images planned: ${Object.keys(specs.images).length}`);
for (const [k, v] of Object.entries(specs.images)) {
  const hasPhotos = Object.values(v.photo_refs).some(p => p !== null);
  const hasData = Object.keys(v.prompt_data).length > 0;
  console.log(`  [${k}] ${v.name} | type=${v.type} | photos=${hasPhotos ? "OK" : "MISSING"} | data=${hasData ? "OK" : "N/A"}`);
}
