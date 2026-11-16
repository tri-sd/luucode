# Region Tracking — thiết kế Giai đoạn 1 (lịch sử)

Phạm vi hiện tại 0.3.0 đã mở rộng fixed/zoom/canvas; xem ARCHITECTURE.md.

## Dòng dữ liệu

User action/keyboard command → MV3 background → inject content script once →
ImageDiscovery snapshot → RegionTracker reconciliation → normalized mock regions →
DOM geometry read → clipped Shadow DOM write.

Background không giữ state tracking bắt buộc. State thuộc content script của từng
tài liệu; service worker ngủ/thức không làm mất overlay. Không có request mạng
hoặc quyền host cố định ở production. Không dùng offscreen khi chưa có tác vụ ảnh.

## Identity và kết quả lỗi thời

`instanceId` thuộc phần tử DOM (WeakMap); `sourceKey` gồm nguồn được chọn, nguồn
khai báo, kích thước tự nhiên và load epoch. `generation` tăng khi binding đổi.
RegionResult chỉ được áp dụng khi cả ba trường khớp và nguồn hiện tại vẫn hợp lệ.
Đổi src có thể chưa cập nhật currentSrc ngay; vì vậy kiểm tra cả thuộc tính nguồn
và trạng thái complete để không nhận kết quả cũ trong thời gian ảnh mới đang tải.

## Tọa độ

1. Xác định content box từ border box, padding, border và scale của ảnh.
2. Tính painted source rectangle theo object-fit/object-position.
3. Chiếu box chuẩn hóa lên painted rectangle.
4. Cắt theo content box, viewport và các ancestor có overflow.
5. Đổi viewport coordinates sang hệ tọa độ của host bằng cách trừ host rect.

Host tuyệt đối gắn vào documentElement, không tham gia normal flow. Layer outer
chỉ bao vùng clip; surface bên trong vẫn mang kích thước painted image đầy đủ.
Nhờ vậy vùng chuẩn hóa không bị co giãn lại khi chỉ một phần ảnh còn nhìn thấy.
Kích thước vùng clip nằm trong ảnh sẵn có, tránh làm tăng scroll dimensions.

## Theo dõi layout

MutationObserver gom discovery vào một frame; ResizeObserver quan sát cả ảnh chưa
đủ điều kiện. Load/error được bắt ở document để xử lý lazy loading. IntersectionObserver
giới hạn đo hình học ở ảnh gần viewport; không dùng nó làm nguồn tọa độ chính xác.

Vòng requestAnimationFrame khi đang bật đo lại ảnh gần viewport, chia sẻ cache
computed style và ancestor rect trong frame. Điều này bắt được vị trí bị đẩy bởi
nội dung phía trên dù kích thước ảnh không đổi. Các geometry read hoàn tất trước
khi ghi style. Giá trị style không đổi không bị ghi lại.

Tab ẩn dừng vòng frame; khi hiện lại sẽ đo ngay. Stop tháo các observer/listener,
hủy frame, xóa tracked map và remove root. Root bị website xóa được gắn lại.

## Giới hạn có chủ ý

Chưa có detector/OCR/AI, inpainting, cache bản dịch hay tự cuộn. Vùng giả lập cố định
chỉ chứng minh tracking. Những phép biến đổi không thể suy ra từ bounding box 2D
được bỏ qua. Nội dung fixed/sticky, clip-path, mask, CSS zoom và reader có lớp nổi
che ảnh cần kiểm chứng/adapter trước khi nhận hỗ trợ.
