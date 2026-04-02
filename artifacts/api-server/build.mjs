import * as esbuild from "esbuild";
import { readFileSync, cpSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf8"));

const workspacePackages = new Set(
  Object.keys(pkg.dependencies ?? {}).filter((d) => d.startsWith("@workspace/"))
);

const externalPackages = Object.keys(pkg.dependencies ?? {}).filter(
  (d) => !workspacePackages.has(d)
);

await esbuild.build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/index.cjs",
  external: externalPackages,
  sourcemap: false,
  minify: false,
  define: {
    "import.meta.url": "__importMetaUrl",
  },
  banner: {
    js: `const __importMetaUrl = require("url").pathToFileURL(__filename).href;`,
  },
});

mkdirSync(path.join(__dirname, "fonts"), { recursive: true });
mkdirSync(path.join(__dirname, "assets"), { recursive: true });
cpSync(path.join(__dirname, "src/fonts"), path.join(__dirname, "fonts"), { recursive: true });
cpSync(path.join(__dirname, "src/assets"), path.join(__dirname, "assets"), { recursive: true });

console.log("Build complete → dist/index.cjs");
