#!/usr/bin/env node
// WBS 2.2 §5 — computed-style fidelity check between packages/ui/src/gallery.tsx
// and the delivered /design prototype. Screenshot diff is NOT the mechanism
// here: getComputedStyle comparison catches "the right visual result via the
// wrong CSS" (a hardcoded px that happens to render like var(--tap-min)
// today) which a pixel diff cannot. See docs/ui/design_system_port_design.md §5.
//
// Zero tolerance: any property mismatch fails that row. Exit non-zero if any
// MATCH row fails. NO_REFERENCE rows are reported, never silently skipped.

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const UI_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(UI_ROOT, "..", "..");
const DESIGN_ROOT = resolve(REPO_ROOT, "design");

const COMPARED_PROPS = [
  "fontFamily",
  "fontSize",
  "lineHeight",
  "color",
  "backgroundColor",
  "minHeight",
];

async function bundleGallery() {
  const result = await build({
    entryPoints: [join(UI_ROOT, "src", "gallery-entry.tsx")],
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    loader: { ".tsx": "tsx", ".ts": "ts" },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  return result.outputFiles[0].text;
}

function galleryHtml(bundleJs) {
  const tokensCss = readFileSync(join(UI_ROOT, "src", "tokens.css"), "utf8");
  const componentsCss = readFileSync(join(UI_ROOT, "src", "components.css"), "utf8");
  return `<!doctype html><html><head><meta charset="utf-8">
<style>${tokensCss}</style>
<style>${componentsCss}</style>
</head><body><div id="root"></div>
<script>${bundleJs}</script>
</body></html>`;
}

async function serveHtml(html) {
  const server = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}/`, close: () => server.close() };
}

async function runActions(page, actions = []) {
  for (const action of actions) {
    if (action.type === "press") {
      await page.keyboard.press(action.key);
    } else if (action.type === "click") {
      await page.locator(action.selector).first().click();
    }
    await page.waitForTimeout(30);
  }
}

async function extractStyle(page, selector) {
  const locator = page.locator(selector).first();
  const count = await locator.count();
  if (count === 0) return null;
  return locator.evaluate((el, props) => {
    const cs = getComputedStyle(el);
    const out = {};
    for (const p of props) out[p] = cs[p];
    return out;
  }, COMPARED_PROPS);
}

async function loadManifest() {
  // gallery.tsx is TSX — Node has no loader for it. Transpile (not bundle,
  // it has no non-relative imports besides React/react-dom which this
  // process never executes) to plain ESM and import the result directly.
  const built = await build({
    entryPoints: [join(UI_ROOT, "src", "gallery.tsx")],
    bundle: true,
    write: false,
    format: "esm",
    jsx: "automatic",
    platform: "node",
    loader: { ".tsx": "tsx" },
  });
  const { writeFileSync, unlinkSync } = await import("node:fs");
  const tmpPath = join(UI_ROOT, "src", "__gallery_manifest_tmp.mjs");
  writeFileSync(tmpPath, built.outputFiles[0].text, "utf8");
  try {
    const mod = await import(pathToFileURL(tmpPath).href);
    return mod.FIDELITY_MANIFEST;
  } finally {
    unlinkSync(tmpPath);
  }
}

async function main() {
  const manifest = await loadManifest();

  const galleryBundle = await bundleGallery();
  const html = galleryHtml(galleryBundle);
  const { url, close } = await serveHtml(html);

  const browser = await chromium.launch();
  const galleryPage = await browser.newPage();
  await galleryPage.goto(url);

  const rows = [];

  for (const entry of manifest) {
    if (entry.status === "NO_REFERENCE") {
      rows.push({ ...entry, result: "NO_REFERENCE" });
      continue;
    }

    const galleryStyle = await extractStyle(galleryPage, entry.gallerySelector);

    const prototypeFile = join(DESIGN_ROOT, entry.prototypeFile);
    const protoPage = await browser.newPage();
    await protoPage.goto(pathToFileURL(prototypeFile).href);
    await runActions(protoPage, entry.prototypeActions);
    const prototypeStyle = await extractStyle(protoPage, entry.prototypeSelector);
    await protoPage.close();

    if (!galleryStyle || !prototypeStyle) {
      rows.push({
        ...entry,
        result: "FAIL",
        detail: `element not found (gallery=${!!galleryStyle}, prototype=${!!prototypeStyle})`,
      });
      continue;
    }

    const mismatches = COMPARED_PROPS.filter((p) => galleryStyle[p] !== prototypeStyle[p]).map(
      (p) => `${p}: gallery=${galleryStyle[p]} prototype=${prototypeStyle[p]}`,
    );

    rows.push({
      ...entry,
      result: mismatches.length === 0 ? "PASS" : "FAIL",
      detail: mismatches.join("; "),
    });
  }

  await browser.close();
  close();

  console.log("\nWBS 2.2 fidelity report\n" + "=".repeat(60));
  let anyFail = false;
  for (const row of rows) {
    console.log(`[${row.result}] ${row.component} — ${row.state}`);
    if (row.result === "FAIL") {
      anyFail = true;
      console.log(`         ${row.detail || row.reason || ""}`);
    }
    if (row.result === "NO_REFERENCE") {
      console.log(`         ${row.reason}`);
    }
  }
  console.log("=".repeat(60));
  const passCount = rows.filter((r) => r.result === "PASS").length;
  const failCount = rows.filter((r) => r.result === "FAIL").length;
  const noRefCount = rows.filter((r) => r.result === "NO_REFERENCE").length;
  console.log(`${passCount} PASS, ${failCount} FAIL, ${noRefCount} NO_REFERENCE (of ${rows.length})`);

  process.exit(anyFail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
