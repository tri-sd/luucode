# Manga Translator Pro

## Scope
- v0.5.0 reference-driven UX, polygon/confidence validation, manual region edits,
  explicit crop reprocessing and optional review pass are authorized. Keep evidence
  of observed reference behavior separate from marketing claims/unverified internals.
- Never call fast fill inpainting; no external OCR credentials/backends without
  explicit configuration. Do not copy reference code, logos or proprietary assets.
- Phase 2 is authorized: BYOK Gemini Vision OCR and Vietnamese translation, settings,
  current-image translation, structured JSON validation and error handling.
- Generic fixed/strip readers, lazy media, CSS backgrounds, canvas and explicit
  visible-region capture are authorized. No site/chapter URL hardcoding.
- Preserve normalized bindings and the Shadow DOM architecture. Tracking Lab
  stays an explicitly labeled mock demo; website translation uses real provider results.
- Version 0.4.0 chapter collection, explicit full-chapter translation, persistent
  IndexedDB registry/cache/queue and automatic restoration are authorized.
- Auto-detection on future visits requires explicit optional host permission; never
  capture or send to Gemini during collection. No advanced inpainting/backend.
- Screenshots require an explicit Translate action; crop in a trusted offscreen
  context before Gemini. Never expose keys or full screenshots to the website.
- API keys stay in trusted extension contexts; never send them to content scripts,
  page DOM, page storage, logs, URLs or public status responses.

## Architecture
- `src/chapter`: persistent chapter registry/cache/queue, collector and lifecycle;
  persistence/provider execution only in trusted extension contexts.
- `src/core`: pure geometry and validated domain types; no browser extension APIs.
- `src/discovery`: image eligibility and DOM lifecycle.
- `src/tracking`: instance identity, source revisions, clipping and frame scheduling.
- `src/overlay`: one isolated, noninteractive Shadow DOM root; no page layout edits.
- `src/translation`: schema, normalization, tiling, provider client and image pipeline.
- `src/extension`: trusted credential storage, sender validation and job orchestration.
- `src/entrypoints`: WXT entrypoints and extension lifecycle only.
- `tests/unit`: pure coordinate and eligibility tests.
- `tests/integration`: real browser geometry and packaged MV3 lifecycle checks.

## Invariants
- Regions use image-relative coordinates in [0, 1]. Never cache viewport coordinates.
- DOM instance identity and image source identity are separate.
- Reject stale region results after a source or document change.
- Never wrap, move or add attributes/styles to a website image.
- A region is keyed by image instance + source generation + region ID.
- Batch geometry reads before overlay writes. Destroy observers, listeners and animation frames on stop.
- Skip unsupported geometry rather than drawing an incorrect overlay.

## Validation
Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and
`npm run test:integration`. Integration tests require a Chromium installation;
set `CHROMIUM_PATH` when using a system browser. Record actual browser versions.
Do not report Chrome or Cốc Cốc validation based solely on Chromium automation.

## Git
Keep generated build output, caches, profiles and test artifacts out of Git.
Keep dependencies locked. Do not commit credentials or manufacture author identity.
