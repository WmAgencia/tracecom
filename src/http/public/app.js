/* TRACECON landing — cliente vanilla. Sem segredos; só UI. */

const $ = (id) => document.getElementById(id);

async function api(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function loadExtensionInfo() {
  const els = document.querySelectorAll("#extInfo");
  if (!els.length) return;
  try {
    const info = await api("/extension/info");
    const text = info.available && info.sizeBytes
      ? `${(info.sizeBytes / 1024).toFixed(1)} KB · pronta para baixar`
      : "disponível — clique para baixar";
    els.forEach((el) => { el.textContent = text; });
  } catch {
    els.forEach((el) => { el.textContent = "disponível — clique para baixar"; });
  }
}

loadExtensionInfo();