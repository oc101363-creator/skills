import fs from "node:fs";
import path from "node:path";

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.error("Usage: node generate_product_info.mjs <root_dir1> [root_dir2] ...");
  process.exit(1);
}

// ── Character limits ──
const LIMITS = {
  headline: 30,
  subheadline: 50,
  featureTitle: 20,
  featureDesc: 40,
  fitmentCell: 25,
  specLabel: 20,
  specValue: 20,
  callout: 15,
};

// ── Category mapping ──
const CATEGORY_NAMES = {
  starter_motor: "Starter Motor",
  alternator: "Alternator",
  wiper_motor: "Wiper Motor",
  ignition_coil: "Ignition Coil",
  oxygen_sensor: "Oxygen Sensor",
  brake_rotor: "Brake Rotor",
  other: "Automotive Part",
};

const CATEGORY_DISPLAY = {
  starter_motor: "Starter Motor",
  alternator: "Alternator",
  wiper_motor: "Wiper Motor",
  ignition_coil: "Ignition Coil",
  oxygen_sensor: "Oxygen Sensor",
  brake_rotor: "Brake Rotor",
  other: "Automotive Part",
};

// ── Detail callouts by category ──
const CALLOUTS_BY_CATEGORY = {
  starter_motor: ["SOLENOID", "DRIVE GEAR", "MOUNTING EAR"],
  alternator: ["VOLTAGE REGULATOR", "ROTOR", "STATOR"],
  wiper_motor: ["MOTOR BODY", "LINKAGE ARM", "CONNECTOR"],
  ignition_coil: ["SPARK TOWER", "PRIMARY COIL", "CONNECTOR"],
  oxygen_sensor: ["SENSOR BODY", "THREAD", "CONNECTOR"],
  brake_rotor: ["DISC SURFACE", "VANE DESIGN", "HUB BORE"],
  other: ["BODY", "CONNECTOR", "MOUNTING"],
};

// ── Text processing ──
function cleanTitle(title) {
  return title
    .replace(/^\d+[\-–—]\d+\s+/, "")
    .replace(/^[A-Z]+\d+[A-Z0-9\-]*\s+(?=(?:Starter|Alternator|Wiper|Motor|Oxygen|Brake|Ignition|Sensor|Coil|for|Compatible|Fit|Replacement))/i, "")
    .replace(/^\d+[A-Z]+\d*\s+(?=(?:Starter|Alternator|Wiper|Motor|Oxygen|Brake|Ignition|Sensor|Coil|for|Compatible|Fit|Replacement))/i, "")
    .replace(/\s*[-–—]\s*(?:Replaces?|Fits|Compatible|for)\s+.*$/i, "")
    .trim();
}

function toHeadline(title) {
  const cleaned = cleanTitle(title);
  const words = cleaned.split(/\s+/);
  let hl = words.slice(0, 5).join(" ").toUpperCase();
  if (hl.length > LIMITS.headline) {
    hl = words.slice(0, 3).join(" ").toUpperCase();
  }
  return hl.slice(0, LIMITS.headline);
}

function toSubheadline(title, features) {
  const cleaned = cleanTitle(title);
  const match = cleaned.match(/^(.*?)\s+(?:for|Compatible with|Fits)/i);
  if (match) {
    const sub = `Built for ${match[1]}. Reliable Performance.`;
    return sub.slice(0, LIMITS.subheadline);
  }
  const feat = features?.[0]?.description;
  if (feat) {
    const words = feat.split(/\s+/).slice(0, 8).join(" ");
    return words.slice(0, LIMITS.subheadline);
  }
  return "Direct OE Replacement. Premium Quality.";
}

function cleanFeatureTitle(title) {
  let t = title
    .replace(/^[^A-Za-z0-9]+/, "")
    .replace(/\s*[-–—:]\s*.*/, "")
    .trim()
    .toUpperCase();
  return t.slice(0, LIMITS.featureTitle);
}

function cleanFeatureDescription(desc) {
  if (!desc) return "";
  const sentences = desc.split(/[.!?]+/);
  let best = "";
  for (const s of sentences) {
    const trimmed = s.trim();
    if (trimmed.length > 5 && trimmed.length <= LIMITS.featureDesc) {
      best = trimmed;
      break;
    }
  }
  if (!best) {
    best = desc.replace(/\s+/g, " ").trim();
    const words = best.split(/\s+/);
    let result = "";
    for (const w of words) {
      if ((result + " " + w).trim().length > LIMITS.featureDesc) break;
      result = result ? result + " " + w : w;
    }
    best = result;
  }
  return best.slice(0, LIMITS.featureDesc);
}

function formatFitment(vehicles) {
  const rows = [];
  const seen = new Set();
  for (const v of vehicles || []) {
    const year = v.year_start === v.year_end
      ? `${v.year_start}`
      : `${v.year_start}-${v.year_end}`;
    const make = (v.make || "").trim();
    const model = (v.model || "").trim();
    const engine = (v.engine || "").trim();
    const key = `${year}|${make}|${model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push([
      year.slice(0, LIMITS.fitmentCell),
      make.slice(0, LIMITS.fitmentCell),
      model.slice(0, LIMITS.fitmentCell),
      engine.slice(0, LIMITS.fitmentCell),
    ]);
  }
  return rows;
}

function formatSpecs(specs) {
  const priority = ["Voltage", "Power", "Rotation", "Teeth", "Amperage", "Type", "Condition"];
  const seen = new Set();
  const result = [];
  for (const label of priority) {
    const found = specs?.find(s => s.label === label);
    if (found && !seen.has(label)) {
      seen.add(label);
      result.push({
        label: label.slice(0, LIMITS.specLabel),
        value: (found.value || "").slice(0, LIMITS.specValue),
      });
    }
  }
  for (const s of specs || []) {
    if (!seen.has(s.label)) {
      seen.add(s.label);
      result.push({
        label: (s.label || "").slice(0, LIMITS.specLabel),
        value: (s.value || "").slice(0, LIMITS.specValue),
      });
    }
  }
  return result.slice(0, 6);
}

function getCallouts(category) {
  const c = category || "other";
  const defaults = CALLOUTS_BY_CATEGORY[c] || CALLOUTS_BY_CATEGORY.other;
  return {
    left_top: defaults[0]?.slice(0, LIMITS.callout) || "DETAIL 1",
    left_middle: defaults[1]?.slice(0, LIMITS.callout) || "DETAIL 2",
    left_bottom: defaults[2]?.slice(0, LIMITS.callout) || "DETAIL 3",
  };
}

// ── Main conversion ──
function generate(dirPath) {
  const src = path.join(dirPath, "processed", "info.json");
  const dst = path.join(dirPath, "product_info.json");

  if (!fs.existsSync(src)) {
    console.log(`  SKIP: no processed/info.json in ${path.basename(dirPath)}`);
    return false;
  }

  const info = JSON.parse(fs.readFileSync(src, "utf8"));
  const cat = info.product_info?.category || "other";
  const title = info.title?.full || "";
  const rawFeatures = info.features || [];

  // Build features (exactly 4)
  const features = {};
  for (let i = 0; i < 4; i++) {
    const raw = rawFeatures[i];
    features[`feature_${i + 1}`] = {
      title: cleanFeatureTitle(raw?.title || `FEATURE ${i + 1}`),
      description: cleanFeatureDescription(raw?.description || ""),
    };
  }

  const product = {
    product_info: {
      name: CATEGORY_NAMES[cat] || CATEGORY_NAMES.other,
      category: CATEGORY_DISPLAY[cat] || CATEGORY_DISPLAY.other,
    },
    hero: {
      headline: toHeadline(title),
      subheadline: toSubheadline(title, rawFeatures),
    },
    features,
    vehicle_fitment: {
      rows: formatFitment(info.compatibility?.vehicles),
    },
    oe_part_numbers: (info.oe_numbers || []).slice(0, 8),
    specifications: formatSpecs(info.specifications),
    detail_callouts: getCallouts(cat),
  };

  fs.writeFileSync(dst, JSON.stringify(product, null, 2), "utf8");
  console.log(`  OK: ${path.basename(dirPath)}`);
  return true;
}

let count = 0;
for (const root of roots) {
  if (!fs.existsSync(root)) continue;
  console.log(`\n=== ${root} ===`);
  for (const name of fs.readdirSync(root).sort()) {
    const dir = path.join(root, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    if (generate(dir)) count++;
  }
}
console.log(`\nDone. Generated ${count} product_info.json files.`);
