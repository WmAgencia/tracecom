# TraceCom Vision Web

## Product Boundary

The Vision Web flow is the primary product. The existing `extension/` directory is retained as the legacy read-only IQ Option integration and is not required by Vision Web.

## Runtime Flow

`getDisplayMedia` -> local video preview -> user crop -> local canvas resize/compression -> sanitized frame -> backend -> quantitative features + Fable 5.1 -> structured BUY/SELL/WAIT -> web UI -> optional shadow record.

The browser never receives `FABLE_API_KEY`. The backend owns the Fable provider call.

## Safety Boundary

Vision Web does not inspect IQ Option DOM, active IDs, internal WebSockets, proprietary canvas metadata, balances or order controls. It never clicks or submits anything to IQ Option. The user remains responsible for all manual execution.

## Legacy Extension

`extension/` is preserved and remains buildable for historical/read-only workflows. It is not part of the Vision Web critical path and must not be used as a dependency for screen sharing.
