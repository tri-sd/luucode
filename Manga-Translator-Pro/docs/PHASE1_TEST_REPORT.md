# Báo cáo Giai đoạn 1 — Manga Translator Pro 0.1.0

Ngày kiểm thử: **15/11/2026**. Dự án tại `/workspace/manga-translator-pro`.

## Đã triển khai

- WXT 0.21.5, TypeScript strict, Manifest V3 và dependency lockfile.
- Image Discovery dựa trên kích thước/tên, hỗ trợ ảnh tải trễ và DOM động.
- Region Tracking dùng box chuẩn hóa theo ảnh gốc; instance ID riêng cho từng DOM.
- Source generation và validation chống áp dụng kết quả cũ khi thay src/srcset.
- Text Overlay bằng một Shadow DOM root, không sửa/wrap ảnh website.
- Clipping theo viewport và container cuộn, object-fit/object-position, padding/border.
- Vùng chữ GIẢ LẬP, toolbar toggle, phím Alt+Shift+M và Tracking Lab đóng gói sẵn.
- Git nhánh main và cấu hình LF/fast-forward/prune; không đặt remote/danh tính tác giả.
- README, AGENTS, tài liệu kiến trúc, checklist thủ công và danh mục tệp.

Không có Gemini API, OCR thật, API key, backend, tự cuộn hoặc tính năng nâng cao.

## Kết quả lệnh cuối cùng

`npm run check` hoàn tất với exit code **0** sau các bước dưới đây:

| Lệnh | Kết quả |
| --- | --- |
| `npm run lint` | PASS, không có lỗi/cảnh báo ESLint |
| `npm run typecheck` | PASS, TypeScript strict và các kiểm tra bổ sung |
| `npm test` | **63/63 unit tests PASS**, 3 test files |
| `npm run build` | PASS, production MV3 trong `.output/chrome-mv3/` |
| `npm run test:integration` | **18 PASS, 3 SKIPPED**, 0 failed, 0 flaky |

Runtime: Node.js 24.22.1, npm 11.9.0. Trình duyệt chạy thực tế:
**Chromium 156.0.8078.79 trên Linux, headless**.

## Bằng chứng hình học

Các số sau là đo DOM geometry trong CSS pixel, không phải ước lượng qua screenshot.

| Trường hợp | Sai số lớn nhất được ghi nhận |
| --- | ---: |
| 100 vị trí cuộn tài liệu lên/xuống | 0,009375 px |
| 32 mẫu khi phát input wheel qua Chromium | 0,009375 px |
| Resize viewport 600/1400/810/1200 px | 0,010000 px |
| Layout shift 177,5 px phía trên ảnh | 0,009375 px |
| Device pixel ratio 1,25 / 1,5 / 2 qua browser context | 0,009375 px |
| 5 vị trí cuộn lồng nhau, có clipping | 0,006250 px |
| object-fit contain, padding/border, object-position | < 0,000001 px |
| object-fit cover, padding/border, object-position | 0,006250 px |
| Production Tracking Lab được phục vụ qua HTTP | 0,006250 px |

Sai số lớn nhất trong các metrics đã ghi: **xấp xỉ 0,01 CSS px**, dưới mục tiêu
2 CSS px trên các trường hợp đã đo. Đây là kết quả bộ mẫu tổng hợp, không phải
cam kết mọi website hoặc kết quả kiểm thử native zoom.

Các kiểm tra còn lại đã PASS:

- Start nhiều lần chỉ tạo một host và một layer cho mỗi ảnh.
- Image attributes, bounding rect và scroll dimensions không đổi khi bật overlay.
- Đổi nguồn trên cùng DOM làm tăng generation; kết quả cũ bị từ chối ngay cả khi
  currentSrc chưa cập nhật.
- Hai DOM dùng cùng URL có instance/layer độc lập.
- Native lazy loading, gán src trễ, chèn/xóa ảnh và srcset responsive.
- Translate/scale dương của ancestor; rotation được bỏ qua.
- Stop/restart dọn root; root bị xóa được phục hồi mà không nhân đôi.
- CSS website không xuyên vào region; pointer events xuyên overlay về đúng ảnh.
- Manifest MV3 có đúng activeTab + scripting, không có host_permissions cố định;
  các entrypoint được manifest tham chiếu đều có trong build.
- Production Tracking Lab chạy không có page errors; mọi request trong bài đó
  ở localhost, không có request tới Gemini hoặc dịch vụ bên ngoài.

Screenshot minh họa production bundle: `assets/tracking-lab.png`.

## Ba bài chưa chạy được

Chromium của môi trường có chính sách quản trị:
`/etc/chromium/policies/managed/extensions.json` chứa
`ExtensionInstallBlocklist: ["*"]`. Extension thử nghiệm không được nạp, service
worker không xuất hiện. Suite nhận diện điều kiện này và ghi SKIPPED với lý do;
không thay đổi hay bỏ qua chính sách quản trị.

1. Nạp production extension và mở Tracking Lab bằng chrome-extension origin.
2. Zoom trình duyệt thật 80/100/125/150% qua `chrome.tabs.setZoom`.
3. Phím tắt cấp activeTab, inject content script đã build, toggle và kiểm tra messaging.

Các bài này đã được viết trong `tests/integration/extension.spec.ts`, sẵn sàng chạy
lại trên trình duyệt được phép nạp unpacked extension. Chúng không được tính PASS.

**Chưa kiểm thử trực tiếp Google Chrome hoặc Cốc Cốc; chưa kiểm chứng website truyện
thực tế và chưa chạy soak test 30–60 phút.** Trang lab của bundle đã chạy qua HTTP
để kiểm tra mã production, nhưng điều đó không thay thế kiểm thử extension đã cài.

## Đối chiếu nghiệm thu

| Tiêu chí | Trạng thái có bằng chứng |
| --- | --- |
| Overlay bám khi cuộn | PASS trên fixture, cuộn tài liệu/wheel/container |
| Không trùng overlay | PASS trên fixture, kể cả start nhiều lần và cùng URL |
| Không gắn kết quả vào ảnh sai | PASS cho source generation, thay src/srcset và instance |
| Không đổi layout website | PASS cho attributes, bounding rect, scroll dimensions của fixture |
| <= 2 CSS px | PASS trên các phép đo được hỗ trợ đã chạy |
| Có bản build cho Load unpacked | Đã tạo gói MV3; luồng cài thực tế đang bị policy môi trường chặn |
| Zoom native và Cốc Cốc | CHƯA XÁC MINH |

## Tệp và hướng dẫn cài

Danh sách đầy đủ: `FILE_INVENTORY.md`.
Hướng dẫn Cốc Cốc, cách bật/tắt và dùng Tracking Lab: `../README.md`.
Checklist xác minh trình duyệt thực tế: `MANUAL_TEST_CHECKLIST.md`.

Gói giao:

- `manga-translator-pro-unpacked.zip`: giải nén, chọn thư mục chứa manifest.json
  bằng Load unpacked.
- `manga-translator-pro-source.zip`: source, cấu hình, unit/integration tests và docs.
- `integration-results.json`: kết quả Playwright kèm metrics và lý do skip.
- `final-check.log`: log chuỗi kiểm tra cuối cùng.

## Giới hạn hình học

Hỗ trợ ảnh img trong DOM thường với layout flow, overflow chữ nhật và transform
2D translate/scale dương. Canvas, iframe, website Shadow DOM, CSS background-image,
CSS zoom, rotate/skew/3D, clip-path/mask, fixed/sticky image ancestor và UI nổi che
ảnh chưa được nhận hỗ trợ. Discovery dùng heuristic, không phải detector ảnh truyện.
