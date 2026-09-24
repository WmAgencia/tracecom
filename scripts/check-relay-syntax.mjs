import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const root = fileURLToPath(new URL("../relay/", import.meta.url));
let checked = 0;
function checkDirectory(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const file = join(directory, entry.name);
    if (entry.isDirectory()) checkDirectory(file);
    else if (entry.isFile() && entry.name.endsWith(".mjs")) {
      execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
      checked += 1;
    }
  }
}
checkDirectory(root);
console.log(`Relay syntax OK: ${checked} modules`);
