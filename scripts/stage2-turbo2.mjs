import fs from "node:fs";
const RT = "D:/tracecom/repo/relay/iq-multi-runtime.mjs";
let src = fs.readFileSync(RT, "utf8");
const eol = src.includes("\r\n") ? "\r\n" : "\n";
const from = "Math.ceil((this.client?.serverNow?.() ?? now) / 60_000) * 60_000".replace(/\n/g, eol);
const to = "nextOperationalExpiryAt(this.client?.serverNow?.() ?? now)".replace(/\n/g, eol);
const count = src.split(from).length - 1;
if (!count) { console.log("NAO_ENCONTRADO"); process.exit(1); }
src = src.split(from).join(to);
fs.writeFileSync(RT, src);
console.log("SUBSTITUIDOS=" + count);
