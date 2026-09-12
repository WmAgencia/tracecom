const $ = (id) => document.getElementById(id);
const set = (id, text, tone = "muted") => { const el = $(id); if (el) { el.textContent = text; el.dataset.tone = tone; } };
const ago = (timestamp) => timestamp ? `${Math.max(0, Math.round((Date.now() - timestamp) / 1000))}s atrás` : "sem eventos";
function renderDiagnostics(diag) {
  const backend = diag.backend || { online: false };
  set("backendStatus", backend.online ? "CONECTADO" : "OFFLINE", backend.online ? "good" : "bad");
  set("iqStatus", diag.pageDetected ? "DETECTADA" : "NÃO DETECTADA", diag.pageDetected ? "good" : "muted");
  const age = diag.lastIngestAt ? Date.now() - diag.lastIngestAt : Infinity;
  const feed = diag.networkStatus === "LOCAL_FALLBACK" ? "LOCAL SHADOW" : !diag.pageDetected ? "OFFLINE" : !diag.lastIngestAt ? "WAITING" : age <= 45000 && diag.lastIngestOk ? "HEALTHY" : "STALE";
  set("feedStatus", feed, feed === "HEALTHY" ? "good" : feed.includes("LOCAL") || feed === "WAITING" || feed === "STALE" ? "warn" : "bad");
  set("symbolStatus", diag.symbol || "—"); set("timeframeStatus", diag.timeframe || "—");
  const steps = [`PAGE DETECTED: ${diag.pageDetected ? "OK" : "aguardando"}`, `BRIDGE: ${diag.bridgeActive ? "CONNECTED" : "DISCONNECTED"}`, `ASSET: ${diag.symbol || "aguardando"}`, `FRAME: ${diag.lastFrameAt ? ago(diag.lastFrameAt) : "aguardando"}`, `REMOTE API: ${diag.networkStatus || "aguardando"}`, `LAST ERROR: ${diag.lastIngestError || "none"}`];
  $("diagnosticList").replaceChildren(...steps.map((step) => { const item = document.createElement("li"); item.textContent = step; return item; }));
}
function renderExperiment(state) {
  state = state || { status: "IDLE", phase: "A", phaseEvaluated: 0, phaseTarget: 100, observations: [], a80v1: [] };
  set("experimentStatus", state.status, state.status === "RUNNING" ? "good" : state.status === "PAUSED" ? "warn" : "muted");
  set("experimentProgress", `RUN ${state.phase} ${state.phaseEvaluated}/${state.phaseTarget}`);
  const done = (state.observations || []).filter((o) => ["WIN", "LOSS", "DRAW"].includes(o.outcome)); const wins = done.filter((o) => o.outcome === "WIN").length; const losses = done.filter((o) => o.outcome === "LOSS").length;
  set("experimentStats", `${wins} / ${losses} / ${done.length ? (wins / done.length * 100).toFixed(2) + "%" : "—"}`); set("experimentA80", String((state.phase === "A" ? state.a80v1 : state.phase === "B" ? state.a80v1 : state.finalSet || []).length)); set("experimentLast", done.at(-1)?.outcome || (state.active ? "ACTIVE" : "WAITING"));
}
async function message(type, payload) { return chrome.runtime.sendMessage({ type, payload }); }
async function refresh(test = false) { const [diagnostics, experiment] = await Promise.all([message(test ? "tc.testConnection" : "tc.diagnostics"), message("tc.experiment.status")]); renderDiagnostics(diagnostics?.data || {}); renderExperiment(experiment?.data); }
$("openIq").addEventListener("click", () => message("tc.openIq")); $("testConnection").addEventListener("click", () => refresh(true)); $("toggleDownbar").addEventListener("click", () => message("tc.toggleDownbar").then(() => refresh())); $("toggleDiagnostics").addEventListener("click", () => { $("diagnostics").hidden = !$("diagnostics").hidden; });
$("startExperiment").addEventListener("click", () => message("tc.experiment.start").then(() => refresh())); $("pauseExperiment").addEventListener("click", () => message("tc.experiment.pause").then(() => refresh())); $("resumeExperiment").addEventListener("click", () => message("tc.experiment.resume").then(() => refresh())); $("stopExperiment").addEventListener("click", () => message("tc.experiment.stop").then(() => refresh())); $("resetExperiment").addEventListener("click", () => { if (confirm("Apagar todo o experimento local?")) message("tc.experiment.reset").then(() => refresh()); });
const exportButton = document.createElement("button"); exportButton.type = "button"; exportButton.textContent = "Exportar relatório"; document.querySelector(".actions").append(exportButton);
exportButton.addEventListener("click", async () => { const experiment = (await message("tc.experiment.status"))?.data || null; const report = { report: "TRACE_1M_A80_FINAL_REPORT", generatedAt: Date.now(), experiment }; const download = (body, type, name) => { const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([body], { type })); link.download = name; link.click(); URL.revokeObjectURL(link.href); }; download(JSON.stringify(report, null, 2), "application/json", "trace1m-experiment-report.json"); const o = experiment?.observations || []; const wins = o.filter((x) => x.outcome === "WIN").length; const losses = o.filter((x) => x.outcome === "LOSS").length; download(`# TRACE_1M_A80_FINAL_REPORT\n\nStatus: ${experiment?.status || "IDLE"}\n\nRun: ${experiment?.phase || "A"} ${experiment?.phaseEvaluated || 0}/${experiment?.phaseTarget || 100}\n\nWins: ${wins}\nLosses: ${losses}\nWR: ${wins + losses ? (wins / (wins + losses) * 100).toFixed(2) : "—"}%\n`, "text/markdown", "trace1m-experiment-report.md"); });
refresh();
