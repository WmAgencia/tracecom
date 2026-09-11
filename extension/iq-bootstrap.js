/* Early main-world bridge installation; it observes no outbound/auth frames. */
(() => {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("iq-page-bridge.js");
  script.async = false;
  (document.documentElement || document.head).appendChild(script);
  script.remove();
})();
