#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const FEATURE_NAME = "Favored Enemy: Hunter's Mark (Class Feature)";
const moduleRoot = dirname(fileURLToPath(import.meta.url));
const packsDir = resolve(moduleRoot, "..", "packs");

async function loadPackLines(fileName) {
  const filePath = resolve(packsDir, fileName);
  const raw = await readFile(filePath, "utf8");
  return raw.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

function assert(condition, message) {
  if (!condition) {
    console.error(`\u274c ${message}`);
    process.exitCode = 1;
  }
}

(async () => {
  try {
    const featureDocs = await loadPackLines("features.db");
    const feature = featureDocs.find(doc => doc.name === FEATURE_NAME);
    assert(feature, `Missing required feature: "${FEATURE_NAME}"`);

    if (feature) {
      assert(feature.type === "feat", `Feature "${FEATURE_NAME}" should be of type "feat".`);
      assert(feature.flags?.["ranger-hunters-mark-rework"]?.feature === true,
        `Feature "${FEATURE_NAME}" should include module feature flag.`);
      const uses = feature.system?.uses;
      assert(uses && uses.per === "lr", `Feature "${FEATURE_NAME}" should refresh on long rest.`);
    }

    const macrosDocs = await loadPackLines("macros.db");
    assert(Array.isArray(macrosDocs), "Failed to read macros compendium (expected an array).");

    const effectsDocs = await loadPackLines("effects.db");
    assert(Array.isArray(effectsDocs), "Failed to read effects compendium (expected an array).");

    if (process.exitCode) {
      console.error("Pack validation completed with errors.");
    } else {
      console.log("\u2705 Pack validation passed.");
    }
  } catch (error) {
    console.error("\u274c Pack validation failed:", error.message);
    process.exit(1);
  }
})();
