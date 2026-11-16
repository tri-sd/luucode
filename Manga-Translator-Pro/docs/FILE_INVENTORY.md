# File thay đổi/bổ sung cho Image Discovery 0.3.0 (lịch sử)

Bản hiện tại: xem [V050_FILE_CHANGES.md](V050_FILE_CHANGES.md).

## Production

- `src/core/types.ts`: candidate HTMLElement, detection method, node ID/report types.
- `src/core/geometry.ts`: chấp nhận axis-aligned matrix3d translate/positive scale.
- `src/core/regions.ts`: so binding theo RegionBinding, giữ nguyên logic identity.
- `src/discovery/eligibility.ts`: lý do loại; không loại theo role/container.
- `src/discovery/image-source.ts`: picture request identity, background URL parser,
  kiểm tra nguồn hiện tại, nguồn debug bỏ query/credentials.
- `src/discovery/image-discovery.ts`: img/picture/canvas/background discovery,
  background dimension probe, lazy/mutation/resize/periodic CSS refresh, diagnostics.
- `src/tracking/dom-geometry.ts`: fixed/sticky, clipping, object/background fit,
  transforms/zoom, hit test và lý do từ chối hình học.
- `src/tracking/region-tracker.ts`: dùng candidate mở rộng; giữ normalized regions
  và source generations; thêm current selection/debug/capture measurement.
- `src/tracking/capture-session.ts` (mới): overlay hide/restore, ticket và stale check,
  canvas fingerprint/input invalidation sau explicit capture.
- `src/overlay/text-overlay.ts`: viewport layers cho fixed reader, CSS-unit probe.
- `src/translation/capture.ts` (mới): capture geometry validation, bitmap crop plan,
  normalized crop-to-source mapping và snapshot comparison.
- `src/translation/image-pipeline.ts`: dùng chung raster pipeline; thêm offscreen
  crop PNG trước Gemini, không thay đổi Gemini client/schema/tiling contract.
- `src/translation/types.ts`, `errors.ts`: selection/capture transport và lỗi rõ hơn.
- `src/extension/capture-service.ts` (mới): captureVisibleTab sau explicit Translate,
  xác nhận active tab, private screenshot transport, cleanup khi lỗi.
- `src/extension/security.ts`: validate detection method/capture ticket.
- `src/entrypoints/background.ts`: nhánh capture và Debug RPC; giữ job store.
- `src/entrypoints/tracking.content.ts`: nhận debug/capture lifecycle, guard khi apply.
- `src/entrypoints/offscreen/main.ts`: nhận private capture và crop trong offscreen.
- `src/entrypoints/popup/{main.ts,index.html,style.css}`: capture option và Debug UI.
- `package.json`, `package-lock.json`: version 0.3.0, không thêm dependency/quyền mới.

## Regression và tài liệu

- `tests/fixtures/readers.html`, `comix-reader.html` (mới), `server.mjs`.
- `tests/integration/readers.spec.ts` (mới): 22 browser cases.
- `tests/unit/capture.test.ts` (mới): crop/orchestration regression.
- `tests/unit/{geometry,discovery}.test.ts`: transform/container eligibility regression.
- `tests/browser-harness.ts`: test-only capture adapter, không đóng vào extension.
- `tests/integration/settings-ui.spec.ts`: capture/Debug UI regression.
- `AGENTS.md`, `README.md`, `docs/ARCHITECTURE.md`, `TRACKING_ARCHITECTURE.md`.
- `docs/COMIX_VALIDATION.md`, `TEST_REPORT.md`, `MANUAL_TEST_CHECKLIST.md`.
- `docs/AI_STORAGE_BASELINE.sha256`, `assets/image-discovery-030-metrics.json`,
  `assets/comix-fixture-030.png`; báo cáo 0.2.1 lưu ở PHASE2_021_TEST_REPORT.md.

Gemini client, schema, API key validation/settings, credential store và public job
store giữ nguyên byte; baseline xác minh bằng `sha256sum -c docs/AI_STORAGE_BASELINE.sha256`.
