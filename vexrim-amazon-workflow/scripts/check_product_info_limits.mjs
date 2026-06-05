import fs from "node:fs";
import path from "node:path";

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.error("Usage: node check_product_info_limits.mjs <root_dir1> ...");
  process.exit(1);
}

const LIMITS = {
  "hero.headline": 30,
  "hero.subheadline": 50,
  "features.title": 20,
  "features.description": 40,
  "vehicle_fitment.cell": 25,
  "specifications.label": 20,
  "specifications.value": 20,
  "detail_callouts": 15,
};

function checkProduct(dirPath) {
  const infoPath = path.join(dirPath, "processed", "info.json");
  if (!fs.existsSync(infoPath)) return null;

  const info = JSON.parse(fs.readFileSync(infoPath, "utf8"));
  const violations = [];

  const hl = info.hero?.headline;
  if (hl && hl.length > LIMITS["hero.headline"]) {
    violations.push(`hero.headline: ${hl.length}/${LIMITS["hero.headline"]} "${hl.slice(0, 40)}..."`);
  }

  const sub = info.hero?.subheadline;
  if (sub && sub.length > LIMITS["hero.subheadline"]) {
    violations.push(`hero.subheadline: ${sub.length}/${LIMITS["hero.subheadline"]} "${sub.slice(0, 50)}..."`);
  }

  if (info.features) {
    for (const [key, feat] of Object.entries(info.features)) {
      const t = feat?.title || "";
      const d = feat?.description || "";
      if (t.length > LIMITS["features.title"]) {
        violations.push(`features.${key}.title: ${t.length}/${LIMITS["features.title"]} "${t}"`);
      }
      if (d.length > LIMITS["features.description"]) {
        violations.push(`features.${key}.description: ${d.length}/${LIMITS["features.description"]} "${d.slice(0, 45)}..."`);
      }
    }
  }

  if (info.vehicle_fitment?.rows) {
    for (const row of info.vehicle_fitment.rows) {
      for (const cell of row) {
        if (cell && cell.length > LIMITS["vehicle_fitment.cell"]) {
          violations.push(`vehicle_fitment.cell: ${cell.length}/${LIMITS["vehicle_fitment.cell"]} "${cell.slice(0, 30)}..."`);
        }
      }
    }
  }

  if (info.specifications) {
    for (const spec of info.specifications) {
      const l = spec?.label || "";
      const v = spec?.value || "";
      if (l.length > LIMITS["specifications.label"]) {
        violations.push(`specifications.label: ${l.length}/${LIMITS["specifications.label"]} "${l}"`);
      }
      if (v.length > LIMITS["specifications.value"]) {
        violations.push(`specifications.value: ${v.length}/${LIMITS["specifications.value"]} "${v}"`);
      }
    }
  }

  if (info.detail_callouts) {
    for (const [key, val] of Object.entries(info.detail_callouts)) {
      if (val && val.length > LIMITS["detail_callouts"]) {
        violations.push(`detail_callouts.${key}: ${val.length}/${LIMITS["detail_callouts"]} "${val}"`);
      }
    }
  }

  return violations;
}

let totalProducts = 0;
let totalViolations = 0;

for (const root of roots) {
  if (!fs.existsSync(root)) continue;
  console.log(`\n=== ${root} ===`);

  for (const name of fs.readdirSync(root).sort()) {
    const dir = path.join(root, name);
    if (!fs.statSync(dir).isDirectory()) continue;

    const violations = checkProduct(dir);
    if (violations === null) continue;

    totalProducts++;
    if (violations.length > 0) {
      totalViolations += violations.length;
      console.log(`\n  ⚠️  ${name} (${violations.length} violations):`);
      for (const v of violations) {
        console.log(`      - ${v}`);
      }
    } else {
      console.log(`  ✅ ${name}`);
    }
  }
}

console.log(`\n=== Summary: ${totalProducts} products checked, ${totalViolations} violations found ===`);
