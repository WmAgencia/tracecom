document.getElementById("open").addEventListener("click", () => {
  chrome.sidePanel?.open?.({ windowId: chrome.windows?.WINDOW_ID_CURRENT ? chrome.windows.WINDOW_ID_CURRENT : undefined }).catch(() => {});
});
document.getElementById("opts").addEventListener("click", () => chrome.runtime.openOptionsPage());
