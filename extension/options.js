/* TRACE/CON — options JS */

const $ = (id) => document.getElementById(id);

function load() {
  chrome.storage.local.get(
    ["tcBackend", "tcAuto", "tcSymbols", "tcTimeframe", "tcDirection", "tcHorizon"],
    (s) => {
      $("backend").value = s.tcBackend || "http://127.0.0.1:8788";
      $("auto").checked = !!s.tcAuto;
      $("symbols").value = (s.tcSymbols || ["BTCUSDT", "ETHUSDT", "SOLUSDT"]).join("\n");
      $("timeframe").value = s.tcTimeframe || "1h";
      $("direction").value = s.tcDirection || "up";
      $("horizon").value = s.tcHorizon || 12;
    },
  );
}

function save() {
  const opts = {
    tcBackend: $("backend").value.trim().replace(/\/$/, "") || "http://127.0.0.1:8788",
    tcAuto: $("auto").checked,
    tcSymbols: $("symbols").value
      .split(/\r?\n/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
    tcTimeframe: $("timeframe").value,
    tcDirection: $("direction").value,
    tcHorizon: Number($("horizon").value) || 12,
  };
  chrome.storage.local.set(opts, () => {
    chrome.runtime.sendMessage({ type: "tc.setOpts", payload: opts });
    const status = $("status");
    status.textContent = "salvo";
    status.className = "ok";
    setTimeout(() => { status.textContent = ""; status.className = ""; }, 2000);
  });
}

$("save").addEventListener("click", save);
load();