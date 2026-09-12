# TraceCon Browser Extension

Version 0.4.9 adds a privacy-preserving protocol trace: redacted inbound/outbound market subscriptions, catalog metadata and binary-frame diagnostics. It still requires a dual confirmation gate (current-instrument evidence plus active-ID registry) before a shadow signal. **TRACE_1M**: analysis and expiry are fixed to one minute, the
downbar shows a calibrated signal state, and BUY/SELL remains conditional on
the backend production gate. The extension is analysis + shadow validation;
manual execution remains with the user.

The TraceCon extension is a Manifest V3, local-development extension. It adds a compact downbar to supported market pages and a popup with local backend and IQ Option feed diagnostics.

## IQ Option safety boundary

The IQ bridge is read-only. It observes allowlisted market projections from incoming frames and outgoing market subscriptions, plus bounded market-related fetch responses. It never forwards raw payloads, credentials, cookies, local/session storage, account data, or authentication fields. It never clicks or submits BUY/SELL orders.

## Build and install

From the repository root, run `npm run build:extension`. This produces
`dist/tracecon-extension-v0.4.9.zip` and the unpacked `dist-extension` folder.

When the local backend is offline, IQ Option frames remain in the browser and
the service worker runs a conservative local shadow analysis. The downbar shows
`LOCAL SHADOW` and the popup exposes the classified network error; no order
action is available in either mode. Local history records `WIN`, `LOSS`,
`DRAW` or `UNKNOWN` after the 60-second observation window.
Extract the ZIP, then load that extracted folder using Chrome or Edge's **Load
unpacked** command. For a non-technical walkthrough, see
`../INSTALL-EXTENSION.md` or run `../INSTALL-TRACECON-EXTENSION.bat`.

## Permissions

- `storage`: local extension preferences and non-sensitive transport diagnostics.
- `alarms`: optional periodic signal refresh.
- `tabs`: opens IQ Option from the popup and updates the downbar preference in supported tabs.
- Host access is limited to the local TraceCon backend and the explicitly listed supported market sites.

The extension does not request `scripting`, `webNavigation`, or `<all_urls>`.
