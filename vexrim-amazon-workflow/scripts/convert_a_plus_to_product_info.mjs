import fs from "node:fs";
import path from "node:path";

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.error("Usage: node convert_a_plus_to_product_info.mjs <root_dir1> ...");
  process.exit(1);
}

function convert(dirPath) {
  const src = path.join(dirPath, "a_plus_specs.json");
  const dst = path.join(dirPath, "product_info.json");

  if (!fs.existsSync(src)) {
    console.log(`  SKIP: no a_plus_specs.json in ${path.basename(dirPath)}`);
    return false;
  }

  const old = JSON.parse(fs.readFileSync(src, "utf8"));

  // Build clean product_info.json — NO truncation, preserve full text
  const product = {
    product_info: {
      name: old.product_info?.name || "",
      category: old.product_info?.category || "",
    },
    hero: {
      headline: old.hero?.headline || "",
      subheadline: old.hero?.subheadline || "",
    },
    features: {},
    vehicle_fitment: {
      rows: old.vehicle_fitment?.rows || [],
    },
    oe_part_numbers: old.oe_part_numbers || [],
    specifications: old.specifications || [],
    detail_callouts: {
      left_top: old.detail_callouts?.left_top || "",
      left_middle: old.detail_callouts?.left_middle || "",
      left_bottom: old.detail_callouts?.left_bottom || "",
    },
  };

  // Copy features (strip icons, keep title + description only)
  if (old.features) {
    for (const [key, val] of Object.entries(old.features)) {
      if (val && val.title) {
        product.features[key] = {
          title: val.title,
          description: val.description || "",
        };
      }
    }
  }

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
    if (convert(dir)) count++;
  }
}
console.log(`\nDone. Converted ${count} products.`);
