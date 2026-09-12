/* TRACE/CON — options JS */

const $ = (id) => document.getElementById(id);

function load() {
  chrome.storage.local.get(
    ["tcBackend", "tcApiToken", "tcAuto", "tcShadowEnabled", "tcSymbols", "tcDirection", "tcRemoteApiEnabled"],
    (s) => {
      $("backend").value = s.tcBackend || "";
      $("remoteApiEnabled").checked = s.tcRemoteApiEnabled === true;
      $("apiToken").value = s.tcApiToken || "";
      $("auto").checked = !!s.tcAuto;
      $("shadow").checked = s.tcShadowEnabled !== false;
      $("symbols").value = (s.tcSymbols || ["EURUSD", "GBPUSD", "USDJPY"]).join("\n");
      $("direction").value = s.tcDirection || "up";
    },
  );
}

function save() {
  const opts = {
    tcBackend: $("backend").value.trim().replace(/\/$/, ""),
    tcRemoteApiEnabled: $("remoteApiEnabled").checked,
    tcApiToken: $("apiToken").value.trim(),
    tcAuto: $("auto").checked,
    tcShadowEnabled: $("shadow").checked,
    tcSymbols: $("symbols").value
      .split(/\r?\n/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
    tcDirection: $("direction").value,
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
