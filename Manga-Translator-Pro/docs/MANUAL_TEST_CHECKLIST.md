# Checklist Cốc Cốc 0.4.0

Hướng dẫn: [V040_USER_GUIDE.md](V040_USER_GUIDE.md). Các ô dưới đây chưa được đánh
dấu đạt trong cloud; cần kiểm chứng trên máy Windows của người dùng.

- [ ] Cập nhật đúng extension ID/thư mục, Reload rồi F5 tab; thấy version 0.4.0.
- [ ] Cấp quyền website; lần truy cập sau tự hiện nút nổi khi tìm thấy ảnh.
- [ ] Thu thập 50 ảnh: cuộn đầu → cuối → đầu, số ảnh không trùng, không gọi Gemini.
- [ ] Fixed reader: chuyển qua các trang; vẫn giữ URL ảnh đã xem dù DOM bị hủy.
- [ ] Kết thúc thủ công, không tự tuyên bố đủ chương từ vị trí cuối vùng cuộn.
- [ ] Dịch toàn bộ bằng key/model thật; cấp đúng quyền CDN, kiểm tra concurrency 1/2.
- [ ] Từng ảnh hoàn thành hiển thị ngay; đối chiếu OCR, bản dịch và người nói.
- [ ] Cuộn hai chiều/nested scroll, resize, reader zoom 50/75/100%.
- [ ] Browser zoom 80/100/125/150%, Windows display scale và screenshot crop.
- [ ] Ẩn/hiện và hai chế độ nền, không đổi bố cục hoặc nhân đôi overlay.
- [ ] Đóng/mở popup: tiến trình vẫn lưu, số hoàn thành/thất bại đúng.
- [ ] Stop worker trong DevTools: offscreen đang sống không gửi lại ảnh đã hoàn thành.
- [ ] Đóng executor/browser: mở lại checkpoint, Resume thủ công; request dở có thể bị tính phí lại.
- [ ] Pause/Resume/Cancel/Retry failed; 5 ảnh lỗi không làm mất 30 ảnh thành công.
- [ ] Reload/quay lại chapter/DOM tạo lại: cache đúng ảnh và profile, không OCR lại.
- [ ] Đổi chương khi đang dịch: không đặt chữ A lên ảnh B; quay lại A còn cache.
- [ ] Đổi model/glossary/ngôn ngữ: bộ kết quả tách riêng; đổi lại dùng cache phù hợp.
- [ ] Xóa cache lúc đang dịch: late answer không hồi sinh dữ liệu đã xóa.
- [ ] Canvas/blob: dịch ảnh đang xem; screenshot ẩn UI và crop đúng; chapter báo LIVE_ONLY.
- [ ] Debug/key/quota/timeout/JSON invalid vẫn báo lỗi rõ; không gửi key trong log/screenshot.
