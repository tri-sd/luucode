# File mới và thay đổi0.5.0

## Runtime mới

| File | Vai trò |
| --- | --- |
| `src/core/region-metadata.ts` | Validate polygon/confidence, render key, polygon clip |
| `src/chapter/region-edits.ts` | Validate/merge bản sửa tách raw OCR, whitelist metadata |
| `src/chapter/region-reprocessor.ts` | Trusted crop OCR retry, byte/profile guard, crop cache |
| `src/ui/region-editor.ts` | Editor text/bbox/polygon/ẩn/thêm, preview/save/reset/crop |
| `src/translation/preprocessing.ts` | Crop/upscale bounded, ước lượng màu nền/variance |
| `src/translation/vision-adapter.ts` | Capability khai báo thật, merge missing-text audit |
| `src/benchmark/metrics.ts` | Recall/CER/geometry/overflow/cache/request/memory/time metrics |

## Runtime mở rộng

- `src/core/{types,regions}.ts`: normalized polygon và metadata contract.
- `src/translation/{types,schema,gemini-client,tiles,capture,image-pipeline}.ts`:
  schema detailedv2, prompt dọc/nghiêng/nhỏ/SFX, map toàn bộ metadata, optional audit/crop.
- `src/chapter/{types,identity,indexeddb-cache,chapter-service,chapter-executor,rpc,content-controller}.ts`:
  giữ cachev1, profilev2 có legacy resolution, optimistic edits, crop RPC và lifecycle.
- `src/tracking/{coordinate-mapper,dom-geometry,region-tracker}.ts`:
  inverse mapping, bỏ qua own overlay trong hit-test, edit selection, metadata equality.
- `src/overlay/text-overlay.ts`: dark/light/adaptive/original, polygon clip, confidence,
  font readability/overflow diagnostics; giữ source-normalized projection.
- `src/ui/{floating-translator,chapter-panel}.ts`: counter + Dịch AI, progress toast,
  modes/review/editor controls và trusted-event guards.
- `src/extension/chapter-background.ts`, `src/entrypoints/{tracking.content,offscreen/main,popup/main,options/index.html}`:
  trusted RPC, private crop execution/cancellation, public errors và UI integration.
- `package.json`, `package-lock.json`:0.5.0, thêm lệnh benchmark, không thêm dependency/quyền.

## Regression và tài liệu

- `tests/unit/{polygon,region-edits,region-edit-service,region-reprocessor,vision-v050,benchmark-metrics}.test.ts`.
- `tests/unit/{offscreen-crop-control,chapter-background-crop}.test.ts`: cancel
  crop đang chạy/đang chờ/preparation, sender/context guards và public error mapping.
- `tests/integration/{reference-ui,typesetting-v050,editor-v050,multilingual-v050}.spec.ts`.
- `tests/chapter-pipeline-harness.ts`, `tests/integration/chapter-storage.spec.ts`:
  crop transport test-only,50 legacy cache records, profilev2 expectations.
- `tests/fixtures/multilingual/`:4 SVG gốc và16 annotations EN/JA/ZH/KO; server route whitelist.
- `tests/benchmark-report.mjs`: CLI evidence-aware, không giả điểm từ mock.
- `AGENTS.md`, `README.md`, `docs/ARCHITECTURE.md`, `FILE_INVENTORY.md`.
- `docs/V050_{FEATURE_PARITY,USER_GUIDE,LIMITATIONS,TEST_REPORT,BENCHMARK,FILE_CHANGES}.md`,
  `docs/assets/v050-*`: báo cáo/số đo/ảnh fixture do dự án tự tạo.
- `docs/PHASE4_040_TEST_REPORT.md`: giữ báo cáo lịch sử trước nâng cấp.

Không đưa test harness, ảnh reference quảng bá hoặc thông tin key vào build runtime.
