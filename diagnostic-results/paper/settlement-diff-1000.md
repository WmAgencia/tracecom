# Settlement diff — 1,000 decision replay

Replay of **paper-usdcad-1000-results.json** using the same decisions and no model calls.

- Policy: close-to-close on original Yahoo floating-point prices; no intraminute interpolation.
- Alignment: entry = decision + entryLead; settlement = entry + expiration.
- Valid exact: **1000/1000**
- Recorded: {"LOSS":977,"WIN":23}
- Corrected: {"LOSS":465,"WIN":452,"DRAW":83}
- Difference causes: {"MATCH":451,"DIRECTION_MISMATCH":466,"DRAW_HANDLING_MISMATCH":83}
- Agreement: **45.10%**

The prior labels are retained for comparison and are **INVALIDATED_BY_SETTLEMENT_AUDIT**; they must not enter training or calibration. This artifact is a consistency replay, not evidence of predictive edge.
