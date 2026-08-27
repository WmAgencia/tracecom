async function load() {
  const { apiBase, token } = await chrome.storage.local.get(["apiBase", "token"]);
  document.getElementById("apiBase").value = apiBase || "http://127.0.0.1:8788";
  document.getElementById("token").value = token || "";
}

document.getElementById("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const apiBase = document.getElementById("apiBase").value.trim() || "http://127.0.0.1:8788";
  const token = document.getElementById("token").value.trim();
  await chrome.storage.local.set({ apiBase, token });
  document.getElementById("status").textContent = "Salvo ✓";
  setTimeout(() => { document.getElementById("status").textContent = ""; }, 1500);
});

load();
