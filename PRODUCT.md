# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Traders using IQ Option on Windows desktop who want a second-screen analysis surface and manually execute any decision themselves.

## Product Purpose

TraceCom Vision observes a user-selected IQ Option window through browser screen sharing, isolates the chart region locally, combines visual evidence with local quantitative features and asks Fable 5.1 for a BUY, SELL or WAIT signal with a fixed 60-second horizon.

## Positioning

The product analyzes what the user visibly sees instead of depending on IQ Option's private DOM, activeId, WebSocket protocol or proprietary canvas metadata.

## Operating Context

The user opens IQ Option and TraceCom Vision in separate windows or monitors, clicks Compartilhar gráfico, chooses the IQ Option tab/window/monitor in the browser permission dialog, selects the chart crop, and watches the signal surface while executing manually in IQ Option.

## Capabilities and Constraints

- Screen capture must start from a user gesture through `navigator.mediaDevices.getDisplayMedia()`.
- The first-run crop is selected by the user and stored relative to the shared video dimensions.
- Only the cropped chart image is sent to the backend; account and order UI must not be sent.
- Fable 5.1 is server-side only; its key never reaches the browser.
- The decision contract is BUY, SELL or WAIT for 60 seconds.
- No broker clicks, order submission, stake changes, balance control or automatic financial execution are allowed.
- Existing quantitative features, shadow trading, calibration, history, experiment runner and legacy extension remain available.

## Evidence on Hand

- Existing quantitative and shadow systems in `src/` and `tests/`.
- Existing IQ Option read-only MV3 bridge in `extension/`, retained as legacy support.
- Fable gateway configuration in the local ignored `.env`.
- Reference repositories are read-only research material under `research/repos/` when cloned.

## Product Principles

- Observe the user's chart, never private broker internals.
- Never invent missing market or visual evidence; return WAIT.
- Keep analysis, decision, result evaluation and risk state separate.
- Keep secrets server-side and keep all broker execution manual.
- Preserve causal timestamps and immutable experiment runs.

## Accessibility & Inclusion

The primary target is Windows desktop Chrome with one or two screens. The web surface must remain usable with keyboard focus, visible status labels, reduced-motion preferences and responsive single-window layouts.
