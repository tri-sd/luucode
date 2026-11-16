# Báo cáo Giai đoạn 2 — Manga Translator Pro 0.2.0

Ngày: **15/11/2026**. Mã nguồn tại `/workspace/manga-translator-pro` trên Linux cloud.

## Kết quả cuối cùng

`npm run check` hoàn tất với exit code **0**:

| Kiểm tra | Kết quả |
| --- | --- |
| ESLint | PASS, 0 lỗi/cảnh báo lint |
| TypeScript strict | PASS |
| Unit tests | **138 PASS**, 7 files |
| Build WXT MV3 | PASS, version 0.2.0, popup/options/offscreen/background/content |
| Browser integration | **34 PASS, 3 SKIPPED**, 0 failed/flaky; tổng 37 tests |

Runtime: Node.js 24.22.1, npm 11.9.0, WXT 0.21.5.
Browser đã chạy: **Chromium 156.0.8078.79 headless trên Linux**.

**Các bài Gemini dùng API mô phỏng. Chưa gọi Gemini bằng key thật, chưa đánh giá
chất lượng OCR/dịch thực tế và chưa chạy bản 0.2.0 trực tiếp trên Cốc Cốc.**
Người dùng đã xác nhận Tracking Lab Giai đoạn 1 chạy trên Cốc Cốc; đó không phải
bằng chứng cho toàn bộ luồng Gemini Giai đoạn 2.

## Đã triển khai

- API key do người dùng nhập; giữ trong session mặc định, nhớ local tùy chọn,
  xóa key, chọn model động từ Gemini hoặc nhập ID thủ công.
- Nguồn auto / Anh / Nhật / Trung / Hàn, đầu ra tiếng Việt.
- Gemini generateContent nhận ảnh PNG và JSON schema chứa nguyên văn, bản dịch,
  language và bbox ymin,xmin,ymax,xmax chuẩn hóa 0..1000.
- Kiểm tra JSON/kiểu/ID/giới hạn/box, chuẩn hóa về [0,1] trên ảnh gốc trước render.
- Nhiều vùng, chia ảnh dài với overlap, deduplicate OCR trùng.
- Chọn ảnh đang xem, xin quyền origin CDN qua thao tác người dùng, job progress,
  hủy, transcript đầy đủ và JSON đã chuẩn hóa trong popup.
- Xử lý auth, quota, network, model, timeout, safety, no text, JSON/coordinates
  không hợp lệ, ảnh quá lớn/không truy cập được và kết quả lỗi thời.
- Không inpainting nâng cao, không tự dịch chương và không retry tính phí tự động.

## Tracking được giữ nguyên

Hash SHA-256 trước/sau khớp cho:

- `src/core/geometry.ts`
- `src/tracking/dom-geometry.ts`
- `src/overlay/text-overlay.ts`

Hash baseline được lưu trong `TRACKING_BASELINE.sha256`. RegionTracker chỉ bổ sung
chế độ region rỗng, chọn ảnh nhìn thấy và document token; không đổi phép đo/vẽ.

Toàn bộ regression test Giai đoạn 1 vẫn PASS: 100 vị trí cuộn hai chiều, wheel,
resize, layout shift, lazy loading, srcset, DPI, nested scroll/clipping, object-fit,
source recycling, ảnh cùng URL, start/stop và Shadow DOM/CSS isolation.

Sai số lớn nhất trong metrics tracking: **khoảng 0,01 CSS px**. Luồng mock Gemini
đã đo sau cuộn có sai số vị trí **0 CSS px** ở fixture. Những số này đánh giá
tracking theo box đầu vào, **không phải sai số định vị OCR thực tế của Gemini**.

## Unit tests mới

- JSON schema, nhiều vùng, ngôn ngữ, clamp nhỏ ở cạnh; từ chối box ngược/ngoài ảnh,
  ID trùng, text rỗng, field lạ, JSON/code fence/truncation và quá nhiều vùng.
- Header key tới đúng Google endpoint; key không ở URL hoặc request body.
- HTTP 401/403/429/400/404/500/503, timeout, cancel, malformed response,
  MAX_TOKENS, safety và thought parts; không retry tự động.
- Tải/filter/paginate model, prompt nguồn Anh/Nhật/Trung/Hàn/auto.
- Tile coverage, map tọa độ về toàn ảnh, dedupe giữ đúng đối thoại lặp ở chỗ khác.
- Trusted storage trước đọc/lưu key, session default, chuyển local/session, clear,
  save đồng thời và public settings không chứa secret.
- Sender allowlist UI/background/offscreen; website/content không được gọi RPC
  cấu hình; selection phải có document token.
- Job transition không hồi sinh job đã hủy và giới hạn số job trong session.

## Browser integration mới

Các phần ảnh/canvas/PNG, fetch transport, validator và renderer chạy thật trong
Chromium; endpoint Gemini được Playwright route bằng phản hồi xác định trước.

- Decode ảnh nguồn → encode PNG → Gemini JSON mock → hai overlay tiếng Việt.
- Không có key trong request ảnh; key header chỉ đi tới endpoint Gemini giả lập.
- JSON sai, tọa độ ngược, safety, no text, auth/quota: không render vùng bịa/một phần.
- Timeout, cancel và đổi src khi request đang chờ: không áp dụng kết quả cũ.
- Ảnh dài hai tile: hai request, box ghép về toàn ảnh và ID duy nhất.
- Chọn ảnh thay đổi theo viewport; lỗi CDN dừng trước khi gọi Gemini.
- UI settings: password, load model, lưu rồi xóa giá trị input, clear key.
- Popup không tự gọi OCR; key/model chưa cấu hình thì nút Dịch bị khóa.
- Nguồn blob không hỗ trợ báo lỗi thay vì ném exception/khóa nút vĩnh viễn.
- Production Tracking Lab qua HTTP vẫn không có request bên ngoài.

Các test UI dùng runtime bridge mô phỏng; chúng không thay thế kiểm thử quyền
và storage isolation của extension đã cài trên trình duyệt người dùng.

## Ba bài bị chặn

Môi trường có `/etc/chromium/policies/managed/extensions.json` với
`ExtensionInstallBlocklist: ["*"]`. Extension thử nghiệm không được nạp; suite
ghi SKIPPED rõ lý do và không thay đổi/bỏ qua policy.

1. Cài production MV3 và mở Tracking Lab bằng extension origin.
2. Native browser zoom 80/100/125/150% qua chrome.tabs.setZoom.
3. Popup được cài thực tế và trạng thái chưa cấu hình key.

Cần chạy lại suite trên browser được phép cài unpacked, đồng thời chạy checklist
Cốc Cốc với key thật. Không có key thật nào được yêu cầu hoặc lưu trong quá trình
phát triển/kiểm thử này.

## Giới hạn còn lại

- Reader fixed/sticky, CSS zoom, canvas, iframe, shadow DOM website và biến đổi
  phức tạp vẫn ngoài phạm vi; không thêm adapter Comix trong lần tích hợp này.
- CDN cần cookie/Referer/redirect hoặc blob/data URL chưa có fallback chụp tab.
- 12 MiB input, 40 triệu pixel, tối đa 12 tile; toàn job tối đa 5 phút.
- Gemini bbox mang tính ước lượng. Chưa có bộ đánh giá OCR/dịch live bốn ngôn ngữ.
- Chưa có auto fit font/inpainting; bản dịch quá dài xem đầy đủ trong popup.
- Chưa chạy soak test 30–60 phút hoặc kiểm thử end-to-end MV3 bằng key thật.

## Bàn giao

- `README.md`: build, cài/cập nhật, nhập key/model và kiểm thử Cốc Cốc.
- `MANUAL_TEST_CHECKLIST.md`: checklist live cần hoàn thành trên máy người dùng.
- `ARCHITECTURE.md`: luồng dữ liệu, schema, tọa độ, key boundary và lifecycle.
- `FILE_INVENTORY.md`: danh mục đầy đủ.
- `assets/mock-gemini-translation.png`: ảnh chụp pipeline với **API mô phỏng**.
- Log và Playwright JSON/metrics được đóng gói riêng cùng release artifacts.

Báo cáo lịch sử Giai đoạn 1: `PHASE1_TEST_REPORT.md`.
