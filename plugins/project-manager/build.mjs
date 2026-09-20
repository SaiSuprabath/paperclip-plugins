// Build script for the Paperclip plugin: worker (node ESM), manifest (node ESM), UI (browser ESM, single file).
import { build, context } from "esbuild";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { createPluginBundlerPresets } from "@paperclipai/plugin-sdk/bundlers";

const watch = process.argv.includes("--watch");
const presets = createPluginBundlerPresets({
  workerEntry: "src/worker.ts",
  manifestEntry: "src/manifest.ts",
  uiEntry: "src/ui/index.tsx",
  sourcemap: true,
  minify: false,
});

// Guard: the SQL migration must target the schema the host derives from the plugin id.
function assertMigrationNamespace() {
  const src = readFileSync("src/manifest.ts", "utf8");
  const id = src.match(/id:\s*"([^"]+)"/)?.[1];
  const slug = src.match(/namespaceSlug:\s*"([^"]+)"/)?.[1] ?? id;
  const hash = createHash("sha256").update(id).digest("hex").slice(0, 10);
  const cleaned = slug.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").replace(/_+/g, "_").slice(0, 36) || "plugin";
  const expected = `plugin_${cleaned}_${hash}`;
  if (existsSync("migrations")) {
    const sql = readFileSync("migrations/0001_init.sql", "utf8");
    if (!sql.includes(`${expected}.`)) {
      throw new Error(`migrations/0001_init.sql must reference schema "${expected}" (derived from plugin id "${id}")`);
    }
  }
  return expected;
}
const ns = assertMigrationNamespace();

const worker = { ...presets.esbuild.worker, define: { "process.env.PM_DB_NAMESPACE": JSON.stringify(ns) }, logLevel: "info" };
const manifest = { ...presets.esbuild.manifest, logLevel: "info" };
const ui = {
  ...presets.esbuild.ui,
  entryNames: "index",
  loader: { ".css": "text" },
  jsx: "automatic",
  splitting: false,
  logLevel: "info",
};

if (watch) {
  const ctxs = await Promise.all([context(worker), context(manifest), context(ui)]);
  await Promise.all(ctxs.map((c) => c.watch()));
  console.log("watching…");
} else {
  await Promise.all([build(worker), build(manifest), build(ui)]);
  console.log("built dist/worker.js, dist/manifest.js, dist/ui/index.js");
}
