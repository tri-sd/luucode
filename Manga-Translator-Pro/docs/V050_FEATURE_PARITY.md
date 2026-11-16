# Feature Parity Matrix — Manga Translator Pro 0.5.0

## Bằng chứng và cách diễn giải

Ngày 16/11/2026 (Asia/Saigon). Đã đọc HTML công khai trang Chrome Web Store:
https://chromewebstore.google.com/detail/pealmcmcnppiadnjdaigfjamagbojeko
Trang trả HTTP200 qua curl, title “Dịch Truyện”, phiên bản niêm yết1.1.3, cập nhật
12/11/2026. Web reader không mở được URL nên dùng HTML và ảnh giới thiệu công khai.
Đã xem năm ảnh quảng bá. Chỉ phân tích ảnh; không dùng lại logo, artwork, source,
credit backend hoặc tài nguyên của reference trong extension/fixture bàn giao.

Ảnh người dùng cung cấp cho thấy Comix, thanh “26 ảnh / Dịch ngay” góc phải trên,
thẻ tiến trình góc phải dưới (“21/26”), và lớp chữ trắng đậm trên nền tối bo góc.
Các ảnh quảng bá còn minh họa thoại nền sáng và quy trình dịch trực tiếp. Ảnh
quảng bá không chứng minh đó là kết quả detector/inpainting thật.

Video Screen Recording 2026-11-16 013742.mp4 vượt giới hạn tải32MiB của công cụ,
chưa xem được. Không ghi nhận timing/chuyển động từ video. Môi trường có chính
sách chặn cài extension native; chưa vận hành reference hoặc so chất lượng side-by-side.

| Chức năng | Hành vi/bằng chứng | v0.4.0 | Thiếu | Cách triển khai0.5 | Kiểm thử nghiệm thu |
| --- | --- | --- | --- | --- | --- |
| Nút bật dịch trên trang | Ảnh người dùng + ảnh Web Store có toolbar nhỏ | Pill + popover lớn | Counter/action không tách | Toolbar nhỏ bên phải, nhận diện MTP riêng; vẫn kéo được | Drag/click/trusted-event/viewport390px |
| Bộ đếm ảnh | “26 ảnh”, “141 ảnh” trong ảnh quảng bá | Có trong panel | Chưa luôn hiển thị gọn | Counter ngay trên toolbar | Collect50/lazy/fixed không tăng trùng |
| Dịch AI/toàn chương | Nút Dịch ngay; listing nêu dịch cả chương | Queue/cache đã có | Đóng panel vẫn cần action gọn | Dịch AI sau thu thập/xác nhận; dùng queue hiện có | Thu thập không Gemini, explicit click mới gửi |
| Tiến trình độc lập | Thẻ dưới phải, X/Y, progress line | Chủ yếu trong popover/pill | Thiếu progress toast | Card riêng, hoàn thành/lỗi/pause, không bịa ETA cố định | State transition/count/error/closeclient |
| Bật/tắt mode | Ảnh quảng bá minh họa popup công tắc | Có quyền site + show/hide | Chưa biết chính xác toggle reference | Giữ enable-site, show/hide, auto/manual explicit | Không gọi Gemini khi chỉ bật mode |
| Dark typesetting | Ảnh runtime cho thấy nền gần đen/chữ trắng | Mask trắng/viền xanh | Thiếu dark palette | Dark/light/original/adaptive, font Việt, bounds không đổi | Browser style/font overflow/compare |
| Nền thoại sáng | Ảnh quảng bá có thoại sáng | Có mask trắng | Chưa estimate nền | Sample nền crop trong trusted context; fast fill | Pure sampling/texture fallback; không gọi inpainting |
| Inpainting thật | Không quan sát engine hay kết quả gốc có ground truth | Không có | Chưa có engine phù hợp | Capability rõ “chưa có engine”; không gắn nhãn giả | Disabled capability/test không claim |
| Nhiều vùng/JA dọc/SFX | Listing CN/KR và marketing; độ chính xác chưa đo | Gemini bbox | Không polygon/kind/confidence | Vision adapter/schema có polygon/kind/direction và confidence tách biệt | Validator/tile/crop/cache roundtrip + fixture4ngôn ngữ |
| Text bị bỏ sót | Không có chứng cứ thuật toán reference | Không có audit pass | Thiếu explicit recheck | Review pass/crop retry có giới hạn và thông báo thêm request | Mock missing-region merge/dedup |
| Sửa chữ/chỉnh vùng | Người dùng yêu cầu; chưa quan sát reference UI | Không có | Thiếu editor/cache overrides | Edit text/bbox/polygon normalized; lưu override, reset raw | Edit→reload/twins/stale save/noAPI |
| Crop vùng khó | Người dùng yêu cầu; nội bộ reference chưa biết | Chỉ full image/screenshot | Thiếu scoped crop OCR | User-chosen crop upscale trong offscreen, map về ảnh nguồn | Chỉ crop PNG gửi; không đổi vùng ngoài crop |
| Zero drift | Ảnh tĩnh không chứng minh cuộn | Geometry/87browser tests | Cần mở rộng polygon/edit | Tái sử dụng normalized projection/rAF/binding guards | Browser measured≤2CSSpx scroll/resize/DPR/lazy/SPA |
| Cache khi quay lại ảnh | Reference chưa đo network/cache | IDB + byte verify trước restore | DOM tái tạo cần fetch xác minh | Cache đã verify trong document phục hồi nhanh; nguồn mới vẫn verify | Revisit không Gemini; chưa verify không vẽ phỏng đoán |
| Chất lượng tương đương | Chỉ marketing tự nhiên/nhanh | Mock Gemini tests | Thiếu key thật/reference outputs | Dataset annotated + metric runner; đánh dấu chưa đánh giá khi thiếu output thật | OCR/CER/detection/quality không lấy điểm từ mock |
| Credits/tài khoản reference | Listing có credit miễn phí/in-app purchases | BYOK | Không phải mục tiêu bắt chước backend | Giữ BYOK, không sao chép account/credit service | Key không vào DOM/IDB/URLs |

Bảng là kế hoạch triển khai từ chứng cứ, không là chứng nhận parity100%.
Kết quả cuối và các mục còn thiếu được ghi tại V050_TEST_REPORT.md.

## Trạng thái sau triển khai

| Hạng mục | Trạng thái0.5.0 | Bằng chứng/phạm vi |
| --- | --- | --- |
| Toolbar counter/Dịch AI + progress toast | Đã triển khai | `reference-ui.spec.ts`; đếm thật, không bịa ETA, trusted clicks |
| Flow thu thập → chốt → dịch chương | Đã triển khai trên engine0.4 | `chapter-content`, `chapter-pipeline`, atomic quick-translate |
| Giữ cache cũ/reload/không trùng | Đã kiểm thử fixture |50 cachev1 + IndexedDB reload + byte verification; không native MV3 |
| Polygon/confidence/kind/direction | Đã nối xuyên pipeline/cache/render | Validator/tile/capture/edit tests; chưa đo detector thật |
| Missing-text review/crop retry | Đã triển khai, explicit | Mock provider xác minh request/crop/merge/cache; có cancel và stale guard |
| Dark/light/adaptive/original | Đã triển khai | Renderer/browser font/overflow; phủ nền nhanh, không inpainting |
| Editor và lưu bản sửa | Đã triển khai | Text/bbox/polygon/thêm/ẩn/reset/reload/đổi vùng/late crop tests |
| Theo dõi vị trí | Đo trên browser fixtures | Source normalized, scroll/resize/DPR/lazy/recycled DOM; số đo tại report |
| OCR/dịch bằng Gemini thật | Chưa đánh giá | Không có key/output thật; schema/prompt không là bằng chứng chất lượng |
| So sánh chất lượng/tốc độ reference | Chưa đánh giá | Chưa cài reference, không có outputs chung; video chưa xem |
| Native Cốc Cốc/Comix | Chưa nghiệm thu | Policy/TLS cloud; có checklist để người dùng xác minh |
| High-quality background restoration | Chưa có engine | Tùy chọn disabled, không dùng tên inpainting cho lớp phủ màu |

Không khẳng định tương đương100%. Mẫu4ngôn ngữ tổng hợp chỉ chứng minh discovery/
rendering có GT; các số OCR/translation thật vẫn unmeasured.
