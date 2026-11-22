import fs from "node:fs";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import ts from "typescript";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
process.chdir(root);
await build({
  root,
  configFile: false,
  plugins: [react()],
  build: {
    target: ["chrome70", "safari12", "firefox78"],
    cssTarget: ["chrome70", "safari12", "firefox78"],
    outDir: path.resolve(root, "../public"),
    emptyOutDir: true,
  },
});
for (let [input, output] of [
  ["lib/performance.ts", "performance.mjs"],
  ["lib/game.ts", "game.mjs"],
  ["lib/level.ts", "level.mjs"],
  ["lib/account.ts", "account.mjs"],
  ["app/api/account/route.ts", "account-api.mjs"],
  ["app/api/arena/route.ts", "arena-api.mjs"],
]) {
  let code = ts
    .transpileModule(fs.readFileSync(input, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    })
    .outputText.replace(
      /import \{ env \} from ['"]cloudflare:workers['"];?/g,
      "import {env} from './database.mjs';",
    )
    .replace("../../../lib/game", "./game.mjs")
    .replace("../../../lib/level", "./level.mjs")
    .replace("../../../lib/account", "./account.mjs")
    .replace("../../../lib/performance", "./performance.mjs");
  fs.writeFileSync(path.resolve(root, "..", output), code);
}
