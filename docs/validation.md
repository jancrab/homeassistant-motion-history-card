# Validation — v0.1.0

Validated on 2026-10-29.

- `npm run check`: 15 tests passed; production ES-module bundle built with locally bundled Lit.
- Tests cover configuration validation, minimal history entity mapping, initial state/boundaries, unknown/missing data, a DST time window, localization, reused hass updates, more-info targets, request failures/retry, stale snapshot bounds, response races, cancellation, polling serialization/interval, visibility handling, context cleanup/reconnect and native-editor bootstrap/config preservation.
- Browser preview: 480 px dark, 280 px light, 360 px dark. No row or label overflow at 280 and 360 px; all room labels and timelines remain aligned.
- Keyboard Enter on the kitchen and Space on the bathroom timeline dispatch the expected more-info entity. Empty history, unavailable sensors, connection errors, retry and recovery were exercised. German and English labels were checked.
- No browser warnings/errors observed during those checks. Screenshot: [dark 360 px preview](preview-dark.jpg).
- Reduced-motion and hidden-card animation handling are implemented in CSS; OS-level reduced-motion was not exercised in the browser. Visibility-aware polling is tested with mocks.

All automated tests and browser previews use simulated Home Assistant data/components. No connection to the user's Home Assistant was made. Actual recorder responses/permissions, native editor startup, installation and physical sensor behavior must still be verified on the target instance. CI validates packaging separately; see GitHub Actions.
