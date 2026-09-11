# Rejected with current provider: EXP-30S and EXP-45S

Yahoo Finance’s configured Forex adapter exposes closed 1-minute OHLC. It does
not expose a native 30-second or 45-second price/quote series in TraceCon.
Creating sub-minute prices from the minute’s OHLC would be interpolation and
would invent order and path information. Consequently these experiments are
marked `PROVIDER_LIMITATION`, not completed with artificial labels.

To revisit them, add a read-only provider with retained timestamped quotes,
ticks or native second bars and an auditable bid/ask execution model.
