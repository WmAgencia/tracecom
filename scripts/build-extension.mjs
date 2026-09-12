import { access, cp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "extension");
const destination = path.join(root, "dist-extension");
const artifactDir = path.join(root, "dist");
const manifestPath = path.join(source, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const zipPath = path.join(artifactDir, `tracecon-extension-v${manifest.version}.zip`);

if (manifest.manifest_version !== 3) throw new Error("A extensão deve usar Manifest V3.");
if (!manifest.background?.service_worker || !manifest.action?.default_popup) throw new Error("Manifest sem service worker ou popup.");
for (const file of [manifest.background.service_worker, manifest.action.default_popup, "local-engine.js", "content.js", "iq-page-bridge.js", "iq-bootstrap.js", "downbar.css", "popup.js", "popup.css"]) {
  await access(path.join(source, file));
}
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true, filter: (from) => !from.includes(".DS_Store") });
for (const file of ["background.js", "local-engine.js", "content.js", "iq-page-bridge.js", "iq-bootstrap.js", "popup.js", "options.js"]) {
  const result = spawnSync(process.execPath, ["--check", path.join(destination, file)], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Sintaxe inválida em ${file}: ${result.stderr}`);
}
const copied = await stat(path.join(destination, "manifest.json"));
if (!copied.isFile()) throw new Error("Build da extensão incompleto.");
await mkdir(artifactDir, { recursive: true });
await rm(zipPath, { force: true });
const zip = process.platform === "win32"
  ? spawnSync("powershell.exe", [
    "-NoProfile",
    "-Command",
    `Compress-Archive -Path '${destination.replaceAll("'", "''")}\\*' -DestinationPath '${zipPath.replaceAll("'", "''")}' -Force`,
  ], { encoding: "utf8" })
  : spawnSync("zip", ["-rq", zipPath, "."], { cwd: destination, encoding: "utf8" });
if (zip.status !== 0) throw new Error(`Falha ao empacotar extensão: ${zip.stderr || zip.stdout}`);
const artifact = await stat(zipPath);
if (!artifact.isFile() || artifact.size < 1000) throw new Error("ZIP da extensão inválido.");
console.log(`TraceCon extension ready: ${destination} (${zipPath})`);
