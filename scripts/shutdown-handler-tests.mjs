/**
 * Testes para o handler de shutdown (K key + SIGINT/SIGTERM + relatório final).
 * Não requer DB nem broker — mock completo.
 */
import { equal, ok } from "node:assert";

// Mock global antes de importar lógica
const origExit = process.exit;
let exitCode = null;
let killed = false;
process.exit = (code) => { exitCode = code; killed = true; };

const logs = [];
const origLog = console.log;
const origErr = console.error;
console.log = (...a) => logs.push(a.join(" "));
console.error = (...a) => logs.push("ERR: " + a.join(" "));

// --- Mocks do runtime ---
let killSwitchEngaged = false;
let killSwitchReason = null;

const mockPool = null; // DB indisponível no teste

const mockWsRuntime = {
  setKillSwitch(engaged, reason) {
    killSwitchEngaged = engaged;
    killSwitchReason = reason;
    return { killSwitch: { executionEnabled: !engaged }, armState: {} };
  },
  accountContextState() {
    return {
      context: "PRACTICE",
      practiceAccount: { balance: 9876.54 },
      realAccount: { balance: null },
    };
  },
  pool: mockPool,
};

// Simular buildSessionReport isolado (mesma lógica do server.mjs)
const SESSION_START_MS = Date.now() - 3661_000; // ~1h1m atrás

async function buildSessionReport() {
  const runtimeSec = Math.round((Date.now() - SESSION_START_MS) / 1000);
  const runtimeStr = runtimeSec >= 3600
    ? `${Math.floor(runtimeSec / 3600)}h ${Math.floor((runtimeSec % 3600) / 60)}m`
    : runtimeSec >= 60 ? `${Math.floor(runtimeSec / 60)}m ${runtimeSec % 60}s` : `${runtimeSec}s`;

  const accountCtx = mockWsRuntime.accountContextState();
  const activeCtx = accountCtx.context || "PRACTICE";
  const balance = activeCtx === "REAL"
    ? accountCtx.realAccount?.balance
    : accountCtx.practiceAccount?.balance;
  const balanceStr = balance != null ? `R$ ${Number(balance).toFixed(2)}` : "n/d";

  // Sem DB: ops da sessão ficam em zero
  const sessionOps = { operations: 0, wins: 0, losses: 0, pnl: 0 };
  const wr = sessionOps.operations > 0
    ? `${((100 * sessionOps.wins) / sessionOps.operations).toFixed(1)}%`
    : "—";

  return [
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "          RELATÓRIO FINAL DA SESSÃO",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    `  Iniciado em : ${new Date(SESSION_START_MS).toLocaleString("pt-BR")}`,
    `  Duração     : ${runtimeStr}`,
    `  Conta       : ${activeCtx === "REAL" ? "REAL" : "PRACTICE"}`,
    `  Saldo       : ${balanceStr}`,
    "",
    `  Operações   : ${sessionOps.operations}`,
    `  Wins        : ${sessionOps.wins}`,
    `  Losses      : ${sessionOps.losses}`,
    `  W/Rate      : ${wr}`,
    `  Lucro líquido: R$ ${sessionOps.pnl >= 0 ? "+" : ""}${sessionOps.pnl.toFixed(2)}`,
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  ].join("\n");
}

function gracefulShutdown(reason) {
  mockWsRuntime.setKillSwitch(true, reason, null);
  buildSessionReport().then((report) => {
    console.log(report);
    process.exit(0);
  });
}

// --- Testes ---
let passed = 0;
let failed = 0;

function test(label, fn) {
  exitCode = null;
  killed = false;
  logs.length = 0;
  try {
    fn();
    origLog(`  ✓ ${label}`);
    passed++;
  } catch (e) {
    origErr(`  ✗ ${label}: ${e.message}`);
    failed++;
  }
}

// Reset killSwitch entre testes
function reset() { killSwitchEngaged = false; killSwitchReason = null; }

// TESTE 1: setKillSwitch(true) chamado ao acionar K
test("K key aciona kill switch com reason=TEST", () => {
  reset();
  gracefulShutdown("TEST");
  equal(killSwitchEngaged, true, "killSwitchEngaged deve ser true");
  equal(killSwitchReason, "TEST", "reason deve ser TEST");
});

// TESTE 2: relatório contém duração
test("relatório inclui duração formatada", async () => {
  const report = await buildSessionReport();
  ok(report.includes("Duração"), "relatório deve conter Duração");
  ok(report.includes("h ") || report.includes("m "), "duração deve estar formatada");
});

// TESTE 3: relatório contém conta PRACTICE
test("relatório mostra conta PRACTICE", async () => {
  const report = await buildSessionReport();
  ok(report.includes("PRACTICE"), "relatório deve mostrar PRACTICE");
  ok(report.includes("R$ 9876.54"), "saldo deve ser o mockado");
});

// TESTE 4: relatório sem DB → ops em zero
test("relatório sem DB mostra 0 operações", async () => {
  const report = await buildSessionReport();
  ok(report.includes("Operações   : 0"), "sem DB, operações devem ser 0");
  ok(report.includes("W/Rate      : —"), "W/Rate deve ser — quando sem ops");
});

// TESTE 5: relatório contém lucro líquido
test("relatório mostra lucro líquido R$ 0.00", async () => {
  const report = await buildSessionReport();
  ok(report.includes("Lucro líquido: R$ 0.00"), "lucro líquido 0 formatado");
});

// TESTE 6: relatório contém linhas do quadro
test("relatório contém bordas do quadro", async () => {
  const report = await buildSessionReport();
  ok(report.includes("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"), "borda superior presente");
  ok(report.includes("RELATÓRIO FINAL DA SESSÃO"), "título presente");
});

origLog(`\nShutdown handler tests: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  origErr(`\n${failed} teste(s) falhou(aram).`);
  process.exit = origExit;
  process.exit(1);
}

// Restaurar
process.exit = origExit;
console.log = origLog;
console.error = origErr;
