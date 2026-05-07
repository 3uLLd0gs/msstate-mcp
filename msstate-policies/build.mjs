import { build } from "esbuild";
import { chmodSync } from "node:fs";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  outfile: "dist/index.js",
  banner: {
    js: [
      "#!/usr/bin/env node",
      "import { createRequire as _msuCR } from 'module';",
      "const require = _msuCR(import.meta.url);",
      "import { fileURLToPath as _msuFU } from 'url';",
      "import { dirname as _msuDN } from 'path';",
      "const __filename = _msuFU(import.meta.url);",
      "const __dirname = _msuDN(__filename);",
    ].join("\n"),
  },
  logLevel: "info",
});

chmodSync("dist/index.js", 0o755);
