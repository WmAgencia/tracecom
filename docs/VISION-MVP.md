# TraceCom Vision Web MVP

## Run

```powershell
npm run serve
```

Open `http://127.0.0.1:8788/` in Chrome.

## Live Flow

1. Open IQ Option in a separate tab, window or monitor.
2. Open TraceCom Vision Web.
3. Choose the asset and `OTC` or `NORMAL` domain.
4. Click `SHARE CHART` and select only the IQ Option tab/window.
5. Drag over the chart region. The crop is stored locally in the browser.
6. The browser keeps the video local. Every five seconds TraceCom crops and compresses one frame, retaining up to four temporal frames.
7. The backend sends only the temporal crops and a sanitized `MarketSnapshot` with screen-motion metrics to Fable 5.1.
8. The UI renders `BUY`, `SELL` or `WAIT` plus visual evidence, data quality, confluence and risk flags in PT-BR.

## Safety

- `getDisplayMedia()` is always user initiated.
- The backend rejects requests without a valid snapshot and treats missing images as non-actionable.
- Fable failures, stale frames and low evidence return `WAIT`.
- A response older than 20 seconds is discarded as expired.
- The app never reads IQ Option DOM, private WebSockets, active IDs or account controls.
- The app never clicks, submits orders, changes stake or controls balance.
- Vision-only OTC analysis does not invent an entry price, so it does not create a structured shadow trade until a reliable price source exists.

## Fable Configuration

The ignored `.env` contains the local Fable configuration. The browser never receives `FABLE_API_KEY`.

```env
FABLE_BASE_URL=https://api.nexxus-pro.site
FABLE_MODEL=claude-fable-5-1
FABLE_API_KEY=...
```

## Legacy Extension

The existing `extension/` directory is preserved and remains buildable. It is not required for this Vision Web flow.
