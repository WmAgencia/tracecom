#!/usr/bin/env node
/**
 * SECRET SCAN (A01/A12) — falha se um segredo REAL aparecer em arquivo versionado.
 *
 * Cobre: URI Postgres com credenciais, JWT estilo Supabase, AWS access key,
 * bloco de chave privada e literal de service_role. Placeholders conhecidos e
 * fixtures deliberadas ficam documentados na allowlist abaixo (path + pattern + motivo);
 * linhas individuais podem ser liberadas com o comentario `secret-scan:allow`.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PATTERNS = [
  { id: "POSTGRES_URI_CREDENTIALS", regex: /postgres(?:ql)?:\/\/[^\s"'`<>]+:[^\s"'`<>@]+@/gi },
  { id: "SUPABASE_JWT", regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { id: "AWS_ACCESS_KEY", regex: /AKIA[0-9A-Z]{16}/g },
  { id: "PRIVATE_KEY_BLOCK", regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g },
  { id: "SERVICE_ROLE_LITERAL", regex: /service_role["'\s:=]{1,4}[A-Za-z0-9._-]{20,}/gi },
];

const ALLOWLIST = [
  { path: /^docs\//, id: "POSTGRES_URI_CREDENTIALS", reason: "documentacao usa <placeholder> explicito" },
  { path: /^research\//, id: "POSTGRES_URI_CREDENTIALS", reason: "relatorio historico com URI redigida/placeholder" },
  { path: /^relay\/knowledge\//, id: "POSTGRES_URI_CREDENTIALS", reason: "material de estudo, exemplos genericos" },
  { path: /\.(md|txt)$/, id: "POSTGRES_URI_CREDENTIALS", reason: "markdown com exemplo generico" },
  { path: /^tests\//, id: "SUPABASE_JWT", reason: "fixture de token falso para testes" },
  { path: /^tests\//, id: "SERVICE_ROLE_LITERAL", reason: "fixture de string para testes" },
  { path: /^scripts\/stage1-freeze-baseline\.mjs$/, id: "SUPABASE_JWT", reason: "baseline congelada de formato (nao e token valido)" },
  { path: /^research\/repos\//, id: "PRIVATE_KEY_BLOCK", reason: "documentacao de terceiros (exemplos de libs CCXT/Coinbase), nunca chaves do TraceCom" },
];

const SKIP_PREFIXES = ["node_modules/", "dist/", ".next/", ".retention-archive/", "relay/node_modules/"];
const MAX_BYTES = 2_000_000;

const files = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split(/\r?\n/).filter(Boolean).filter((file) => !SKIP_PREFIXES.some((prefix) => file.startsWith(prefix)));
const allowed = (path, id) => ALLOWLIST.some((entry) => entry.id === id && entry.path.test(path));
const findings = [];
for (const file of files) {
  let text = "";
  try { text = readFileSync(file, "utf8"); } catch { continue; }
  if (text.length > MAX_BYTES) continue;
  for (const { id, regex } of PATTERNS) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const line = text.slice(0, match.index).split(/\r?\n/).length;
      const lineText = text.split(/\r?\n/)[line - 1] ?? "";
      if (lineText.includes("secret-scan:allow")) continue;
      if (allowed(file, id)) continue;
      findings.push({ file, line, id, sample: match[0].slice(0, 80) });
    }
  }
}

if (findings.length > 0) {
  for (const finding of findings) console.log(`SECRET_FOUND ${finding.id} ${finding.file}:${finding.line} :: ${finding.sample}`);
  console.log(`SECRET_SCAN FAIL (${findings.length})`);
  process.exit(1);
}
console.log(`SECRET_SCAN OK (${files.length} arquivos versionados)`);
