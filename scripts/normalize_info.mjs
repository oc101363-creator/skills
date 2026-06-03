import fs from "node:fs";
import path from "node:path";

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.error("Usage: node normalize_info.mjs <root_dir1> [root_dir2] ...");
  console.error("Example: node normalize_info.mjs './products'");
  process.exit(1);
}

const FALLBACK_FEATURES = [
  { title: "DURABLE CONSTRUCTION", description: "Built with premium materials for long-lasting reliability.", icon: "shield" },
  { title: "PRECISE FIT", description: "Engineered to match OEM specifications for easy installation.", icon: "gear" },
  { title: "POWERFUL PERFORMANCE", description: "Delivers consistent output under all driving conditions.", icon: "bolt" },
  { title: "QUALITY ASSURED", description: "Rigorously tested for reliability and peace of mind.", icon: "check" },
  { title: "HIGH TEMPERATURE RESISTANCE", description: "Performs reliably in extreme operating conditions.", icon: "thermometer" },
  { title: "EASY INSTALLATION", description: "Direct replacement design for hassle-free setup.", icon: "wrench" },
];

function detectCategory(title) {
  const t = title.toLowerCase();
  if (t.includes("starter")) return "starter_motor";
  if (t.includes("alternator")) return "alternator";
  if (t.includes("wiper")) return "wiper_motor";
  if (t.includes("ignition")) return "ignition_coil";
  if (t.includes("oxygen") || t.includes("o2")) return "oxygen_sensor";
  if (t.includes("brake")) return "brake_rotor";
  return "other";
}

function extractVehicles(title) {
  const vehicles = [];
  const rangeRe = /\b(19\d{2}|20\d{2})\s*[-\u2013\u2014]\s*(19\d{2}|20\d{2})\b/g;
  const singleRe = /(?:for|compatible with|fit)\s+([A-Za-z]+)\s+([A-Za-z0-9\-/\s]+?)(?:\s+(\d+\.\d+L))?/gi;

  let m;
  const years = [];
  while ((m = rangeRe.exec(title)) !== null) {
    const s = parseInt(m[1]), e = parseInt(m[2]);
    if (e >= s && e - s <= 30) {
      years.push({ start: s, end: e });
    }
  }

  const makeModelRe = /(?:for|with|Fit)\s+([A-Za-z]+)\s+([A-Za-z0-9\-]+)(?:\s+(\d+\.\d+L|\d\.\d+\s*L))?/gi;
  while ((m = makeModelRe.exec(title)) !== null) {
    const make = m[1];
    const model = m[2].trim();
    const engine = m[3] ? m[3].trim() : "";
    const y = years.length > 0 ? years[0] : { start: 0, end: 0 };
    vehicles.push({ year_start: y.start, year_end: y.end, make, model, engine });
  }

  const seen = new Set();
  return vehicles.filter(v => {
    const key = `${v.year_start}-${v.year_end}-${v.make}-${v.model}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractOeNumbers(title) {
  const numbers = [];
  const replaceRe = /Replaces?\s*#?\s*([A-Z0-9\-#,\s]+)/gi;
  let m;
  while ((m = replaceRe.exec(title)) !== null) {
    const parts = m[1].split(/[,\s]+/).filter(s =>
      s.length >= 5 &&
      /\d/.test(s) &&
      !/^\d{4}[-\u2013\u2014]\d{4}$/.test(s) &&
      !/^(Honda|Acura|Ford|Toyota|Nissan|Infiniti|Chevy|Chevrolet|Dodge|Jeep|Mercedes|BMW|Bobcat|Audi|Volvo|GMC|Subaru|Mazda|Hyundai|Kia|Lexus|Cadillac|Pontiac|Buick|Chrysler|Volkswagen|Accord|Civic|Crosstour|RLX|Camry|Corolla|CRV|CR-V|HRV|HR-V|Pilot|Odyssey|Tundra| Tacoma|F150|F-150|Silverado|Sierra|Ram|Wrangler|Cherokee|Grand Cherokee|Compass|Renegade|Patriot|Outback|Legacy|Forester|Impreza|Crosstrek|Ascent|BRZ|CX5|CX-5|CX9|CX-9|Mazda3|Mazda6|MX5|Sonata|Elantra|Tucson|Santa Fe|Kona|Sorento|Sportage|Telluride|Sedona|Optima|ES|IS|GS|LS|RX|NX|GX|LX|CT|RC|LC|UX|Escalade|CTS|ATS|XTS|CT6|XT4|XT5|XT6|SRX|STS|Equinox|Traverse|Blazer|Trax|Tahoe|Suburban|Colorado|Express|Malibu|Impala|Cruze|Sonic|Spark|Volt|Bolt|Camaro|Corvette|Mustang|Explorer|Expedition|Edge|Escape|Fusion|Focus|Fiesta|Taurus|Ranger|Bronco|Transit|EcoSport|MaXda|Charger|Challenger|Durango|Journey|Grand Caravan|Avenger|Dart|300|300C|Pacifica|Voyager|Compass|Wrangler|Gladiator|Renegade|Cherokee|Grand Cherokee|Wagoneer|Grand Wagoneer|Defender|Discovery|Range Rover|Range Rover Sport|Range Rover Velar|Range Rover Evoque|X1|X2|X3|X4|X5|X6|X7|X8|Z4|M2|M3|M4|M5|M6|M8|i3|i4|i7|i8|ix|iX1|iX3|iX5|iX7|iX|2 Series|3 Series|4 Series|5 Series|6 Series|7 Series|8 Series|A3|A4|A5|A6|A7|A8|Q3|Q5|Q7|Q8|e-tron|RS3|RS4|RS5|RS6|RS7|RS Q8|S3|S4|S5|S6|S7|S8|SQ5|SQ7|SQ8|TT|TTS|R8|C-Class|E-Class|S-Class|A-Class|B-Class|CLA|CLS|GLA|GLB|GLC|GLE|GLS|G-Class|EQA|EQB|EQC|EQE|EQS|SL|SLC|GT|AMG GT|Sprinter|Metris|Viano|Vito|Citan|Titan|Frontier|Pathfinder|Armada|Murano|Rogue|Rogue Sport|Kicks|Juke|Versa|Sentra|Altima|Maxima|Leaf|Ariya|GT-R|Z|370Z|350Z|Q50|Q60|QX50|QX55|QX60|QX80|Q70|QX30|FX35|FX37|FX50|G35|G37|M35|M37|M45|M56|EX35|EX37|JX35|FX|QX|G|M|EX|JX)$/i.test(s)
    );
    numbers.push(...parts);
  }
  const codeRe = /\b([A-Z0-9\-]{6,})\b/g;
  while ((m = codeRe.exec(title)) !== null) {
    const code = m[1];
    const hasDigit = /\d/.test(code);
    const hasLetter = /[A-Z]/i.test(code);
    const isYear = /^\d{4}([-\s]\d{4})?$/.test(code);
    const isBrand = /^(Honda|Acura|Ford|Toyota|Nissan|Infiniti|Chevy|Chevrolet|Dodge|Jeep|Mercedes|BMW|Bobcat|Audi|Volvo|GMC|Subaru|Mazda|Hyundai|Kia|Lexus|Cadillac|Pontiac|Buick|Chrysler|Volkswagen)$/i.test(code);
    if (!numbers.includes(code) && hasDigit && !isYear && !isBrand) {
      numbers.push(code);
    }
  }
  return numbers.slice(0, 8);
}

function extractSpecs(text) {
  const specs = [];
  if (!text) return specs;
  const t = text;

  const voltage = t.match(/\b(\d+)\s*(?:V|Volts|VDC)\b/i);
  const powerKw = t.match(/\b(\d+(?:\.\d+)?)\s*(?:kW|KW)\b/);
  const powerHp = t.match(/\b(\d+(?:\.\d+)?)\s*HP\b/i);
  const teeth = t.match(/\b(\d+)\s*teeth?\b/i);
  const rotation = t.match(/\b(CW|clockwise|CCW|counter[-\s]?clockwise)\b/i);
  const amp = t.match(/\b(\d+)\s*A\b/);
  const type = t.match(/\b(PLGR|PMGR|OSGR|DD|Gear Reduction)\b/i);

  if (voltage) specs.push({ label: "Voltage", value: `${voltage[1]}V` });
  if (powerKw && powerHp) specs.push({ label: "Power", value: `${powerKw[1]}kW / ${powerHp[1]}HP` });
  else if (powerKw) specs.push({ label: "Power", value: `${powerKw[1]}kW` });
  else if (powerHp) specs.push({ label: "Power", value: `${powerHp[1]}HP` });
  if (rotation) specs.push({ label: "Rotation", value: /CW/i.test(rotation[1]) ? "Clockwise (CW)" : rotation[1] });
  if (teeth) specs.push({ label: "Teeth", value: teeth[1] });
  if (amp && !voltage) specs.push({ label: "Amperage", value: `${amp[1]}A` });
  if (type) specs.push({ label: "Type", value: type[1].toUpperCase() });

  return specs;
}

function bulletsToFeatures(bullets) {
  const features = [];
  for (const b of bullets) {
    const text = typeof b === "string" ? b : b.text || "";
    if (!text) continue;
    const parts = text.split(/[:：]/);
    let title, desc;
    if (parts.length >= 2) {
      title = parts[0].trim();
      desc = parts[1].trim();
    } else {
      const words = text.split(/\s+/);
      title = words.slice(0, Math.min(4, words.length)).join(" ").toUpperCase();
      desc = text;
    }
    const tlow = title.toLowerCase();
    let icon = "check";
    if (tlow.includes("durable") || tlow.includes("construction")) icon = "shield";
    else if (tlow.includes("fit") || tlow.includes("install")) icon = "gear";
    else if (tlow.includes("power") || tlow.includes("performance")) icon = "bolt";
    else if (tlow.includes("temperature") || tlow.includes("heat")) icon = "thermometer";
    else if (tlow.includes("install") || tlow.includes("replacement")) icon = "wrench";
    else if (tlow.includes("link") || tlow.includes("connect")) icon = "link";
    else if (tlow.includes("noise") || tlow.includes("quiet")) icon = "volume-x";
    else if (tlow.includes("fuel") || tlow.includes("efficiency")) icon = "gauge";

    features.push({ title: title.slice(0, 40), description: desc.slice(0, 200), icon });
  }
  let idx = 0;
  while (features.length < 4 && idx < FALLBACK_FEATURES.length) {
    const fb = FALLBACK_FEATURES[idx];
    if (!features.some(f => f.title.toLowerCase() === fb.title.toLowerCase())) {
      features.push({ ...fb });
    }
    idx++;
  }
  return features.slice(0, 6);
}

function normalize(dirPath) {
  const infoPath = path.join(dirPath, "info.json");
  if (!fs.existsSync(infoPath)) {
    console.log(`  SKIP: no info.json`);
    return false;
  }

  const raw = JSON.parse(fs.readFileSync(infoPath, "utf8"));
  const title = typeof raw.title === "string" ? raw.title : (raw.title?.full || "");
  const bullets = Array.isArray(raw.bullet_points) ? raw.bullet_points : [];
  const tech = raw.tech_specs || {};

  fs.writeFileSync(path.join(dirPath, "info_raw.json"), JSON.stringify(raw, null, 2), "utf8");

  const category = detectCategory(title);
  const sku = raw.tech_specs?.["Part Number"] || raw.tech_specs?.["Item model number"] || path.basename(dirPath).replace(/[^A-Z0-9\-]/gi, "").slice(0, 20);

  const vehicles = extractVehicles(title);
  const oeNumbers = extractOeNumbers(title);
  const allText = [title, raw.description || "", ...bullets].join(" ");
  const specs = extractSpecs(allText);

  if (tech["OEM Part Number"]) {
    const oemParts = tech["OEM Part Number"].split(/[,\s]+/).filter(s => s.length >= 5);
    for (const p of oemParts) {
      if (!oeNumbers.includes(p)) oeNumbers.push(p);
    }
  }
  if (tech["Voltage"]) specs.push({ label: "Voltage", value: tech["Voltage"] });
  if (tech["Rotation"]) specs.push({ label: "Rotation", value: tech["Rotation"] });
  if (tech["Teeth"]) specs.push({ label: "Teeth", value: tech["Teeth"] });
  if (tech["Power"]) specs.push({ label: "Power", value: tech["Power"] });
  if (tech["Manufacturer Part Number"]) specs.push({ label: "OE Replacement", value: tech["Manufacturer Part Number"] });

  const specMap = new Map();
  for (const s of specs) specMap.set(s.label, s);
  const uniqueSpecs = Array.from(specMap.values());

  const validYears = vehicles.filter(v => v.year_start > 1900 && v.year_start <= 2030);
  if (validYears.length > 0 && !uniqueSpecs.some(s => s.label === "Compatible Years")) {
    const ys = validYears.map(v => v.year_start === v.year_end ? `${v.year_start}` : `${v.year_start}-${v.year_end}`);
    uniqueSpecs.push({ label: "Compatible Years", value: [...new Set(ys)].join(", ") });
  }

  const features = bulletsToFeatures(bullets);

  const normalized = {
    product_info: {
      name: category === "starter_motor" ? "Starter Motor" : category === "alternator" ? "Alternator" : "Automotive Part",
      sku: sku,
      category: category,
      brand: "VEXRIM"
    },
    title: {
      full: title,
      product_type: category === "starter_motor" ? "Starter Motor" : category === "alternator" ? "Alternator" : "Automotive Part",
      keywords: [...new Set([...title.match(/\b[A-Z][a-z]+\b/g) || []])].filter(w => w.length > 3).slice(0, 5)
    },
    compatibility: {
      vehicles: vehicles,
      notes: vehicles.length > 0 ? `Engineered for ${vehicles[0].make} ${vehicles[0].model}` : "See product title for fitment details."
    },
    oe_numbers: oeNumbers.slice(0, 8),
    specifications: uniqueSpecs,
    features: features,
    warranty: "1 year", // VEXRIM 统一保修期，忽略原始信息中的任何值
    bottom_banner: { tagline: "QUALITY YOU CAN COUNT ON" }
  };

  fs.writeFileSync(infoPath, JSON.stringify(normalized, null, 2), "utf8");
  return true;
}

(async () => {
  let count = 0;
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    console.log(`\n=== ${root} ===`);
    for (const name of fs.readdirSync(root).sort()) {
      const dir = path.join(root, name);
      if (!fs.statSync(dir).isDirectory()) continue;
      const ok = normalize(dir);
      if (ok) {
        count++;
        console.log(`  OK ${name}`);
      }
    }
  }
  console.log(`\nDone. Normalized ${count} products.`);
})();
