import fs from "node:fs";
import path from "node:path";

/**
 * info.json -> a_plus_specs.json
 * Extracts poster-ready data from scraped Amazon product info.
 */

function cleanBrand(str) {
  if (!str) return "VEXRIM";
  return str.replace(/^Brand:\s*/, "").trim() || "VEXRIM";
}

function extractHeadline(title) {
  // Remove leading part numbers like "428000-4790 23300-AA59A "
  let cleaned = title.replace(/^[\dA-Z-]+(?:\s+[\dA-Z-]+)*\s+/, "").trim();

  // Try to find product type (Starter Motor, Alternator, etc.)
  const typeMatch = cleaned.match(/\b(Starter Motor|Alternator|Ignition Sensor|Horn Assembly|Bearing Kit|Ignition Coil|License Plate Bracket|Antenna Base|CV Joint|Oil Filter Cap|Liftgate Strut|Trailer Harness|Coil Kit|Radio Antenna Base|Oxygen Sensor|Shift Interlock Solenoid|Headlight Repair Kit|Battery Current Sensor|Tailgate Strut|Strut|Sensor|Coil|Kit|Assembly|Base|Bracket|Cap)\b/i);
  if (typeMatch) {
    const endIdx = cleaned.toLowerCase().indexOf(typeMatch[1].toLowerCase()) + typeMatch[1].length;
    let headline = cleaned.slice(0, endIdx).trim();
    if (headline.length < 60) return headline.toUpperCase();
  }

  // Fallback: first segment before delimiter
  const m = cleaned.match(/^([^,]+?)(?:\s*[–—-]\s*|\s+Compatible|\s+Fits|\s+Replace|\s+for\s+)/i);
  let headline = m ? m[1].trim() : cleaned.split(",")[0].trim();
  headline = headline.replace(/\b\w/g, c => c.toUpperCase());
  if (headline.length > 60) headline = headline.slice(0, 60).replace(/\s+\S*$/, "");
  return headline;
}

function extractSubheadline(title, bullets) {
  // Look for "direct replacement" / "OE" / "built to last" sentiment
  const sub = bullets.find(b => /direct[- ]?fit|OE|factory|built to last|premium|high[- ]?quality/i.test(b));
  if (sub) return sub.replace(/^[^：:]+[：:]\s*/, "").trim().slice(0, 80);
  return "Direct OE Replacement — Built to Last";
}

function parseBulletFeatures(bullets) {
  const features = [];
  const keywords = [
    { re: /compatib|fit|vehicle|application/i, title: "WIDE COMPATIBILITY", icon: "gear" },
    { re: /spec|voltage|amperage|power|rotation|teeth|12V|KW/i, title: "OE STANDARD FIT", icon: "check" },
    { re: /durab|construct|material|aluminum|copper|heat|resist/i, title: "QUALITY CONSTRUCTION", icon: "shield" },
    { re: /protect|safet|overload|overheat|quiet/i, title: "PRACTICAL PROTECTION", icon: "bolt" },
    { re: /install|direct[- ]?fit|easy/i, title: "EASY INSTALLATION", icon: "wrench" },
    { re: /after[- ]?sale|support|warrant|contact/i, title: "12-MONTH SUPPORT", icon: "headset" },
  ];

  for (const bullet of bullets) {
    const text = bullet.replace(/^[^：:]+[：:]\s*/, "").trim();
    for (const kw of keywords) {
      if (kw.re.test(bullet) && !features.find(f => f.title === kw.title)) {
        features.push({ icon: kw.icon, title: kw.title, description: text.slice(0, 90) });
        break;
      }
    }
  }

  // Pad to 4 if possible
  const defaults = [
    { icon: "shield", title: "QUALITY CONSTRUCTION", description: "Premium materials for long-lasting performance." },
    { icon: "check", title: "OE STANDARD FIT", description: "Built to factory standards for seamless installation." },
    { icon: "gear", title: "WIDE COMPATIBILITY", description: "Cross-reference with multiple part numbers." },
    { icon: "bolt", title: "PRACTICAL PROTECTION", description: "Overload and overheat safety features." },
  ];
  while (features.length < 4) {
    const d = defaults[features.length];
    if (!features.find(f => f.title === d.title)) features.push(d);
    else break;
  }
  return features.slice(0, 4);
}

function parseVehicleFitment(title, bullets, techSpecs) {
  const rows = [];
  const seen = new Set();
  const knownMakes = new Set([
    "acura", "audi", "bmw", "buick", "cadillac", "chevrolet", "chevy", "chrysler",
    "dodge", "fiat", "ford", "gmc", "honda", "hyundai", "infiniti", "jeep", "kia",
    "land", "lexus", "lincoln", "mazda", "mercedes", "mercury", "mini", "mitsubishi",
    "nissan", "pontiac", "porsche", "ram", "rover", "saturn", "scion", "subaru",
    "suzuki", "tesla", "toyota", "volkswagen", "vw", "volvo"
  ]);

  // Helper: add row if valid
  const addRow = (year, make, model, note = "") => {
    if (!year || !make) return;
    const key = `${year}|${make}|${model}|${note}`;
    if (!seen.has(key) && !/^\d+$/.test(model)) {
      seen.add(key);
      rows.push([year, make, model, note]);
    }
  };

  // Helper: parse year range string like "2017-2022" or "2017-2018-2019-2020"
  const parseYearRange = (str) => {
    const nums = str.match(/\d{4}/g);
    if (!nums || nums.length === 0) return null;
    if (nums.length === 1) return nums[0];
    return `${nums[0]}-${nums[nums.length - 1]}`;
  };

  // Strategy 1: parse bullet points for "Fits/Make/Model/YEAR" patterns
  for (const bullet of bullets) {
    // Pattern: "Fits/Make/Model (YEAR-YEAR, YEAR-YEAR)"
    // First try explicit make-model-year blocks
    const blockRe = /(?:fits?|compatible(?:\s+with)?|for)\s+([^。.\n]+)/gi;
    let bm;
    while ((bm = blockRe.exec(bullet)) !== null) {
      const block = bm[1];
      // Within this block, find all year ranges and associated make-model
      const yearRanges = block.match(/\d{4}(?:[-–—]\d{4})?/g) || [];

      // Try to find make-model before each year
      // Look for "Make Model ... YEAR" patterns
      const makeModelYearRe = /([A-Za-z]+)\s+([A-Za-z0-9\-/\s]+?)\s*(?:\()?\s*(\d{4}(?:[-–—]\d{4})?)\s*(?:\))?/gi;
      let mm;
      while ((mm = makeModelYearRe.exec(block)) !== null) {
        const [, w1, modelRaw, yearStr] = mm;
        const year = parseYearRange(yearStr);
        if (!year) continue;

        let make, model;
        if (knownMakes.has(w1.toLowerCase())) {
          make = w1.charAt(0).toUpperCase() + w1.slice(1).toLowerCase();
          model = modelRaw.trim();
        } else {
          continue; // can't determine make
        }

        // Clean model
        model = model
          .replace(/\b(H4|H6|V6|V8|L4|2\.5L|3\.0L|4\.8L|5\.3L|6\.0L|diesel|gas|automatic|manual|transmission|naturally\s+aspirated|turbocharged|CVT)\b.*$/gi, "")
          .replace(/[,;].*$/, "")
          .trim();
        if (!model || model.length > 40) model = "Compatible Models";

        addRow(year, make, model);
      }

      // Special handling for lists like "Ram 1500 (2009-2010, 2014-2021), Ram 2500/3500 (2010, 2014-2018)"
      const ramRe = /(Ram)\s+(1500|2500|3500|4500|5500)(?:\s+Classic)?\s*\(([^)]+)\)/gi;
      let ramM;
      while ((ramM = ramRe.exec(block)) !== null) {
        const [, make, model, yearsStr] = ramM;
        const years = yearsStr.split(/[,，、]/).map(s => s.trim()).filter(Boolean);
        for (const y of years) {
          const yr = parseYearRange(y);
          if (yr) addRow(yr, "Ram", model);
        }
      }

      // Toyota Highlander 2020-2024 pattern
      const toyotaRe = /(Toyota)\s+([A-Za-z]+)\s*(?:\()?\s*(\d{4}(?:[-–—]\d{4})?)\s*(?:\))?/gi;
      let toyM;
      while ((toyM = toyotaRe.exec(block)) !== null) {
        const [, make, model, yearStr] = toyM;
        const year = parseYearRange(yearStr);
        if (year) addRow(year, "Toyota", model);
      }

      // Tesla Model 3 2017-2022 pattern
      const teslaRe = /(Tesla)\s+([A-Za-z]+\s*\d?)\s*(?:\()?\s*(\d{4}(?:[-–—]\d{4})?)\s*(?:\))?/gi;
      let tesM;
      while ((tesM = teslaRe.exec(block)) !== null) {
        const [, make, model, yearStr] = tesM;
        const year = parseYearRange(yearStr);
        if (year) addRow(year, "Tesla", model.trim());
      }
    }
  }

  // Strategy 1b: Engine-only fitment (e.g. "PACCAR MX13 Engine", "Cummins ISX Engine")
  const engineRe = /(?:for|fits?)\s+([A-Za-z]+)\s+(MX\d+|ISX?\d*|CAT\s*\d+|Cummins\s*[A-Z0-9]+)\s*(?:engine|engines)/gi;
  const allText = [title, ...bullets].join(" ");
  let em;
  while ((em = engineRe.exec(allText)) !== null) {
    const [, make, engine] = em;
    addRow("Various", make, "Engine Specific", engine);
  }

  // Strategy 1c: Make-list fitment (e.g. "Fits Pontiac, Buick, Cadillac, Oldsmobile" without model/year)
  // Only trigger if no year-based rows found yet
  if (rows.length === 0) {
    const makeListRe = /(?:fits?|compatible(?:\s+with)?)\s+([A-Za-z]+(?:[,，、\s]+(?:and\s+)?[A-Za-z]+)+)/gi;
    let mlM;
    while ((mlM = makeListRe.exec(allText)) !== null) {
      const raw = mlM[1];
      const makes = raw.split(/[,，、\s]+/).filter(w => w.length > 2 && knownMakes.has(w.toLowerCase()));
      for (const m of makes) {
        addRow("Various", m.charAt(0).toUpperCase() + m.slice(1).toLowerCase(), "Compatible Models", "");
      }
    }
  }

  // Strategy 2: parse title for explicit fitment patterns
  const titlePatterns = [
    // "Compatible with Make Model YEAR-YEAR"
    /compatible\s+(?:with\s+)?([A-Za-z]+)\s+([A-Za-z0-9\-/\s]+?)\s+(\d{4}(?:[-–—]\d{4})?)/gi,
    // "for Make Model YEAR-YEAR"
    /\bfor\s+([A-Za-z]+)\s+([A-Za-z0-9\-/\s]+?)\s+(\d{4}(?:[-–—]\d{4})?)/gi,
    // "Fits Make Model YEAR-YEAR"
    /\bfits?\s+(?:for\s+)?([A-Za-z]+)\s+([A-Za-z0-9\-/\s]+?)\s+(\d{4}(?:[-–—]\d{4})?)/gi,
  ];

  for (const re of titlePatterns) {
    let m;
    while ((m = re.exec(title)) !== null) {
      const [, make, modelRaw, yearStr] = m;
      const year = parseYearRange(yearStr);
      if (!year) continue;
      const makeClean = make.charAt(0).toUpperCase() + make.slice(1).toLowerCase();
      let model = modelRaw.trim().replace(/[,;].*$/, "");
      if (!model || model.length > 40) model = "Compatible Models";
      addRow(year, makeClean, model);
    }
  }

  // Strategy 3: extract from description for specific patterns like "2017-2022 Tesla Model 3"
  const reverseRe = /(\d{4}(?:[-–—]\d{4})?)\s+([A-Za-z]+)\s+([A-Za-z0-9\-/\s]+)/gi;
  let rm;
  while ((rm = reverseRe.exec(allText)) !== null) {
    const [, yearStr, w1, model] = rm;
    if (knownMakes.has(w1.toLowerCase())) {
      const year = parseYearRange(yearStr);
      if (year) addRow(year, w1.charAt(0).toUpperCase() + w1.slice(1).toLowerCase(), model.trim().replace(/[,;].*$/, ""));
    }
  }

  // Deduplicate: drop single-year rows already covered by a year-range row
  const rangeRows = rows.filter(r => r[0].includes("-"));
  const deduped = rows.filter(r => {
    if (!r[0].includes("-")) {
      const year = parseInt(r[0]);
      const covered = rangeRows.some(rr =>
        rr[1] === r[1] && rr[2] === r[2] &&
        year >= parseInt(rr[0].split("-")[0]) &&
        year <= parseInt(rr[0].split("-")[1])
      );
      if (covered) return false;
    }
    return true;
  });

  return deduped.slice(0, 8);
}

function parseOEPartNumbers(title, bullets, techSpecs) {
  const nums = new Set();
  const text = [title, ...bullets].join("\n");

  // Common OE patterns
  const patterns = [
    /\b(\d{3,}[-]\d{3,}[A-Z]?)\b/g,                             // 428000-4790, 23300-AA59A
    /\b([A-Z]{2,}\d{3,}[A-Z]?\d?)\b/g,                          // ADR0325, SHI0182
    /\b(\d{5,})\b/g,                                            // 12968577011
    /\b(\d{3}[A-Z]\d{4,})\b/g,                                  // S13407
    /\b(\d{4}[-]\d{4})\b/g,                                     // 7127-SE
    /\b(\d{6,}[A-Z]\d{3,})\b/g,                                 // 689100E070
    /\b(\d{3,}[-]\d{2,}[-][A-Z0-9]+)\b/g,                       // 1486943-00-A, 1109660-00-B
    /\b(\d{3}[A-Z]\d{2}[A-Z]\d)\b/g,                            // 226A01HC0A
    /\b(\d{4}[A-Z]\d{2}[A-Z])\b/g,                              // 226933RC0A
    /\b([A-Z]\d{3}[A-Z]\d{2}[A-Z]\d?)\b/g,                     // S13407 variants
  ];

  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      const n = m[1].trim();
      // Filter out years and year ranges
      if (/^\d{4}$/.test(n) && parseInt(n) >= 1980 && parseInt(n) <= 2030) continue;
      if (/^\d{4}-\d{4}$/.test(n) && parseInt(n.split("-")[0]) >= 1980 && parseInt(n.split("-")[1]) <= 2030) continue;
      // Filter out isolated numbers that look like counts
      if (/^\d{1,2}$/.test(n)) continue;
      if (n.length < 4) continue;
      // Filter common false positives
      if (/^(play|before|after|model|year|part|number|oem|oe|fits|compatible|references?|original|replacement|right|left|side|sides|and|with|for|the)$/i.test(n)) continue;
      nums.add(n);
    }
  }

  // Also catch "Replaces 12345, 67890" lists
  const replaceRe = /(?:\b(?:replace part number|replaces?|OE|cross[- ]?reference|OE numbers?)\b)[：:]?\s*([^。\n]+)/gi;
  let rm;
  while ((rm = replaceRe.exec(text)) !== null) {
    const parts = rm[1]
      .replace(/[:：]/g, "") // strip colons
      .split(/[,，、|/&]/)
      .map(s => s.trim().split(/\s+/)[0])
      .filter(s => s.length >= 4 && !/^\d{4}$/.test(s) && !/^(play|before|after|model|year|part|number|oem|oe|fits|compatible|references?|original|replacement|right|left|side|sides|and|with|for|the)$/i.test(s));
    parts.forEach(p => nums.add(p));
  }

  // Also catch "Left Side 689100E070, Right Side 689200E050"
  const sideRe = /(?:left|right)\s+(?:side\s+)?[:：]?\s*([A-Z0-9-]+)/gi;
  let sm;
  while ((sm = sideRe.exec(text)) !== null) {
    const n = sm[1].trim();
    if (n.length >= 4 && !/^\d{4}$/.test(n)) nums.add(n);
  }

  // Also look in tech_specs for Manufacturer Part Number
  if (techSpecs) {
    const mfrNum = techSpecs["Manufacturer Part Number"] || techSpecs["Item model number"] || techSpecs["Model Number"] || techSpecs["Mfr Part Number"];
    if (mfrNum) {
      const parts = String(mfrNum).split(/[,\s|/&]+/).map(s => s.trim()).filter(s => s.length >= 4);
      parts.forEach(p => nums.add(p));
    }
  }

  let arr = Array.from(nums);

  // Remove pure-digit entries that are prefixes/substrings of longer hyphenated forms
  const hyphenated = arr.filter(n => /[-]/.test(n));
  arr = arr.filter(n => {
    if (/^\d+$/.test(n)) {
      return !hyphenated.some(h => h.startsWith(n + "-"));
    }
    return true;
  });

  // Aggressive false-positive filter
  arr = arr.filter(n => {
    // Remove pure letters that aren't known OE patterns (e.g. "Right", "sides", "original")
    if (/^[A-Za-z]+$/.test(n) && !/^[A-Z]{2,}\d/.test(n)) return false;
    // Remove entries where every segment is a 4-digit year (e.g. "2017-2018-2019")
    const segments = n.split(/[-]/);
    if (segments.length >= 2 && segments.every(s => /^\d{4}$/.test(s) && parseInt(s) >= 1980 && parseInt(s) <= 2030)) return false;
    // Remove standalone model numbers
    if (/^(3|s|x)$/i.test(n)) return false;
    return true;
  });

  return arr.slice(0, 10);
}

function parseSpecifications(bullets, techSpecs) {
  const specs = [];
  const text = bullets.join(" ");

  const extractors = [
    { label: "Voltage", re: /(\d{2,3})\s*V(?:olts?)?\b(?!\w)/i },
    { label: "Amperage", re: /(\d{2,4})\s*(?:Amps?|Amperage)\b(?!\w)/i },
    { label: "Power", re: /(\d+\.?\d*)\s*KW\b(?!\w)/i },
    { label: "Teeth", re: /(?:number of\s+)?teeth\s*[-–—:]\s*(\d+)|(\d+)\s*teeth?\b/i },
    { label: "Rotation", re: /\b(CW|Clockwise|CCW|Counter[- ]?clockwise)\b/i },
    { label: "Weight", re: /(\d+\.?\d*)\s*(pounds?|lbs?|kg)\b/i },
  ];

  for (const ex of extractors) {
    const m = text.match(ex.re);
    if (m) {
      let val = m[1] ?? m[2] ?? m[0];
      if (ex.label === "Rotation") val = val.toUpperCase().replace(/CLOCKWISE/i, "Clockwise").replace(/COUNTER[- ]?CLOCKWISE/i, "Counterclockwise");
      if (ex.label === "Rotation" && val === "CW") val = "Clockwise";
      if (ex.label === "Rotation" && val === "CCW") val = "Counterclockwise";
      if (ex.label === "Weight") val = `${m[1]} ${m[2]}`;
      specs.push({ label: ex.label, value: val });
    }
  }

  // Fallback: if no voltage found but "12V" in text
  if (!specs.find(s => s.label === "Voltage") && /\b12\s*V\b/i.test(text)) {
    specs.push({ label: "Voltage", value: "12V" });
  }

  // Pull from tech_specs for non-electrical products
  if (techSpecs) {
    const mappings = [
      { key: "Item Weight", label: "Weight" },
      { key: "Package Dimensions", label: "Dimensions" },
      { key: "Manufacturer Part Number", label: "Part Number" },
      { key: "Item model number", label: "Part Number" },
      { key: "Model Number", label: "Part Number" },
      { key: "Mfr Part Number", label: "Part Number" },
      { key: "UPC", label: "UPC" },
      { key: "Exterior", label: "Finish" },
      { key: "Built-In Media", label: "Contents" },
      { key: "Warranty Description", label: "Warranty" },
    ];
    for (const { key, label } of mappings) {
      if (techSpecs[key] && !specs.find(s => s.label === label)) {
        specs.push({ label, value: String(techSpecs[key]).trim() });
      }
    }
  }

  return specs.slice(0, 6);
}

function parseDetailCallouts(bullets, category) {
  // Extract material/construction keywords for detail labels
  const text = bullets.join(" ").toLowerCase();
  const callouts = [];

  // Category-aware keyword maps
  const starterMap = [
    { keys: ["aluminum", "housing", "cast"], label: "ALUMINUM HOUSING" },
    { keys: ["copper", "winding"], label: "COPPER WINDINGS" },
    { keys: ["bearing", "ball bearing"], label: "PREMIUM BEARING" },
    { keys: ["gear", "pinion", "teeth"], label: "DRIVE GEAR" },
    { keys: ["solenoid", "switch"], label: "SOLENOID SWITCH" },
    { keys: ["brush", "carbon"], label: "CARBON BRUSH" },
    { keys: ["magnet", "field"], label: "FIELD MAGNET" },
    { keys: ["armature", "rotor"], label: "ARMATURE ASSEMBLY" },
  ];

  const alternatorMap = [
    { keys: ["aluminum", "housing", "cast"], label: "ALUMINUM HOUSING" },
    { keys: ["copper", "winding"], label: "COPPER WINDINGS" },
    { keys: ["voltage", "regulator", "rectifier"], label: "VOLTAGE REGULATOR" },
    { keys: ["pulley", "groove"], label: "PULLEY ASSEMBLY" },
    { keys: ["bearing", "ball bearing"], label: "PREMIUM BEARING" },
    { keys: ["brush", "carbon"], label: "CARBON BRUSH" },
    { keys: ["stator", "coil"], label: "STATOR COIL" },
    { keys: ["rotor", "field"], label: "ROTOR ASSEMBLY" },
  ];

  const genericMap = [
    { keys: ["aluminum", "housing", "cast"], label: "ALUMINUM HOUSING" },
    { keys: ["copper", "winding"], label: "COPPER WINDINGS" },
    { keys: ["voltage", "regulator", "rectifier"], label: "VOLTAGE REGULATOR" },
    { keys: ["pulley", "groove"], label: "PULLEY ASSEMBLY" },
    { keys: ["bearing", "ball bearing"], label: "PREMIUM BEARING" },
    { keys: ["gear", "pinion", "teeth"], label: "DRIVE GEAR" },
    { keys: ["solenoid", "switch"], label: "SOLENOID SWITCH" },
    { keys: ["brush", "carbon"], label: "CARBON BRUSH" },
    { keys: ["sensor", "probe"], label: "PRECISION SENSOR" },
    { keys: ["coil", "ignition"], label: "IGNITION COIL" },
    { keys: ["filter", "screen"], label: "FILTER SCREEN" },
    { keys: ["strut", "shock"], label: "GAS STRUT" },
    { keys: ["horn", "tone"], label: "DUAL TONE HORN" },
    { keys: ["antenna", "base"], label: "ANTENNA BASE" },
    { keys: ["connector", "plug"], label: "OE CONNECTOR" },
  ];

  const map = category === "Starter Motor" ? starterMap : category === "Alternator" ? alternatorMap : genericMap;

  for (const item of map) {
    if (item.keys.some(k => text.includes(k)) && !callouts.includes(item.label)) {
      callouts.push(item.label);
    }
  }

  // Category-specific generic fallbacks
  const starterFallbacks = ["SOLENOID SWITCH", "DRIVE GEAR", "OE QUALITY FIT"];
  const alternatorFallbacks = ["VOLTAGE REGULATOR", "COPPER WINDINGS", "OE QUALITY FIT"];
  const genericFallbacks = ["PRECISION MACHINED", "DURABLE HOUSING", "OE QUALITY FIT"];
  const fallbacks = category === "Starter Motor" ? starterFallbacks : category === "Alternator" ? alternatorFallbacks : genericFallbacks;

  let fbIdx = 0;
  while (callouts.length < 3 && fbIdx < fallbacks.length) {
    const g = fallbacks[fbIdx++];
    if (!callouts.includes(g)) callouts.push(g);
  }

  return callouts.slice(0, 3);
}

function buildSpec(infoPath) {
  const info = JSON.parse(fs.readFileSync(infoPath, "utf8"));
  const title = info.title || "";
  const bullets = Array.isArray(info.bullet_points) ? info.bullet_points : [];
  const brand = cleanBrand(info.brand || "VEXRIM");
  const asin = info.asin || "";
  const techSpecs = info.tech_specs || {};

  const category = inferCategory(title);

  const featuresArr = parseBulletFeatures(bullets);
  const features = {};
  featuresArr.forEach((f, i) => {
    features[`feature_${i + 1}`] = f;
  });

  const fitmentRows = parseVehicleFitment(title, bullets, techSpecs);
  const oeNumbers = parseOEPartNumbers(title, bullets, techSpecs);
  const specs = parseSpecifications(bullets, techSpecs);
  const callouts = parseDetailCallouts(bullets, category);

  // Subheadline from bullet 2 or generic
  const sub = extractSubheadline(title, bullets);

  const spec = {
    product_info: {
      name: title.split(",")[0].trim().slice(0, 80),
      model: oeNumbers[0] || "",
      category,
      notes: bullets[0]?.replace(/^[^：:]+[：:]\s*/, "").trim().slice(0, 100) || ""
    },
    hero: {
      headline: extractHeadline(title),
      subheadline: sub,
      body_copy: bullets.slice(0, 3).map(b => b.replace(/^[^：:]+[：:]\s*/, "").trim().slice(0, 100))
    },
    features,
    vehicle_fitment: {
      column_headers: ["YEAR", "MAKE", "MODEL", "NOTE"],
      rows: fitmentRows.length > 0 ? fitmentRows : [["Various", "See Details", "Compatible Models", ""]]
    },
    oe_part_numbers: oeNumbers.length > 0 ? oeNumbers : ["N/A"],
    specifications: specs.length > 0 ? specs : [{ label: "Part Number", value: oeNumbers[0] || "N/A" }],
    detail_callouts: {
      left_top: callouts[0],
      left_middle: callouts[1],
      left_bottom: callouts[2]
    },
    detail_closeups: {
      closeup_1: { image_source: "img_detail_1.jpg", label: callouts[0] },
      closeup_2: { image_source: "img_detail_2.jpg", label: callouts[1] },
      closeup_3: { image_source: "img_detail_3.jpg", label: callouts[2] }
    },
    attention: {
      title: "Attention",
      lines: [
        "Please confirm your vehicle model, year, and OE part number match before ordering.",
        "Professional installation is recommended for optimal performance and safety.",
        "Disconnect the vehicle battery negative terminal before installation."
      ]
    },
    bottom_banner: {
      tagline: "QUALITY YOU CAN COUNT ON"
    }
  };

  return spec;
}

function inferCategory(title) {
  const t = title.toLowerCase();
  if (t.includes("alternator")) return "Alternator";
  if (t.includes("starter")) return "Starter Motor";
  if (t.includes("ignition sensor")) return "Ignition Sensor";
  if (t.includes("ignition coil")) return "Ignition Coil";
  if (t.includes("sensor")) return "Sensor";
  if (t.includes("horn")) return "Horn";
  if (t.includes("bearing")) return "Bearing";
  if (t.includes("cv joint")) return "CV Joint";
  if (t.includes("license plate")) return "License Plate Bracket";
  if (t.includes("antenna")) return "Antenna Base";
  if (t.includes("filter")) return "Filter";
  if (t.includes("strut")) return "Liftgate Strut";
  if (t.includes("trailer")) return "Trailer Adapter";
  if (t.includes("coil")) return "Ignition Coil";
  if (t.includes("oxygen")) return "Oxygen Sensor";
  if (t.includes("solenoid")) return "Solenoid";
  if (t.includes("bulb")) return "Bulb Repair Kit";
  if (t.includes("battery")) return "Battery Sensor";
  return "Automotive Part";
}

export { buildSpec, inferCategory };

// CLI usage
import { fileURLToPath } from "node:url";
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const infoPath = process.argv[2];
  if (!infoPath) {
    console.error("Usage: node info_to_spec.mjs <path/to/info.json> [output/path]");
    process.exit(1);
  }

  const outPath = process.argv[3] || infoPath.replace(/info\.json$/, "a_plus_specs.json");
  const spec = buildSpec(infoPath);
  fs.writeFileSync(outPath, JSON.stringify(spec, null, 2));
  console.log(`Spec written to ${outPath}`);
  console.log(`  Headline: ${spec.hero.headline}`);
  console.log(`  Fitment rows: ${spec.vehicle_fitment.rows.length}`);
  console.log(`  OE numbers: ${spec.oe_part_numbers.join(", ")}`);
  console.log(`  Specs: ${spec.specifications.map(s => `${s.label}=${s.value}`).join(", ")}`);
  console.log(`  Callouts: ${Object.values(spec.detail_callouts).join(" | ")}`);
}
