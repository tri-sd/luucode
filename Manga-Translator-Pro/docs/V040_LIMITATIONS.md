# Giới hạn chưa giải quyết — 0.4.0

1. **Chưa nghiệm thu Cốc Cốc Windows/Comix live.** Cloud Chromium gặp lỗi TLS khi
   mở Comix và chính sách chặn load extension. Các tests fixture/adapter không thay
   thế kiểm tra `chrome.tabs.setZoom`, `captureVisibleTab`, đóng popup thật hoặc
   restart MV3 worker cài thực tế. Các bài native bị skip có ghi rõ trong report.
2. **Không tự chứng minh đủ chương.** Thu thập giữ ảnh đã phát hiện; cuối vùng cuộn
   chỉ là dấu hiệu. Fixed reader cần người dùng chuyển qua các trang. Chưa xác minh
   số ảnh từ API nội bộ từng website, không tự chuyển trang/auto-scroll.
3. **Canvas/blob không có URL tải lại:** giữ metadata và báo LIVE_ONLY riêng từng
   ảnh. Chưa dịch toàn chương canvas đã rời màn hình; dùng Dịch ảnh đang xem/capture.
   Canvas tainted không thể có fingerprint bytes đáng tin; ảnh redraw tự động không
   có input không được cam kết theo dõi. Sample32 không phải hash toàn canvas.
4. **CDN truy cập đặc biệt:** không dùng cookie/Referer giả/redirect tự động. Nguồn
   hết hạn có thể cần xem lại ảnh để cập nhật URL. Cache restore byte-verified có
   thể tải lại bytes từ CDN nhưng không gọi Gemini; nguồn không kiểm tra được không
   render cache theo phỏng đoán. CDN đổi hostname chỉ dedup sau tải/hash bytes.
5. **Hình học:** chưa hỗ trợ rotate/skew/flip/perspective, transform trên html,
   clip-path/mask, object-position calc/edge-offset phức tạp, pinch zoom, iframe
   hoặc Shadow DOM của website. Geometry không hỗ trợ tạm ẩn/có Debug reason.
6. **Định danh URL:** query/chapter route không rõ nghĩa được giữ nguyên để tránh
   gộp sai. Reader dùng `?page=` làm vị trí chỉ được gom khi có chapter ID rõ ràng.
   Site đổi cấu trúc URL/canonical khác không tự suy đoán cùng một chapter.
7. **Request mơ hồ sau executor mất:** completed/cache được bảo toàn; request dở
   không được coi vẫn chạy. Resume có thể gửi lại request provider đã nhận nhưng
   chưa kịp lưu đáp án; không hứa exactly-once billing. Retry hữu hạn có thể tính phí.
8. **OCR/dịch:** test dùng Gemini mô phỏng; chưa đo OCR/chữ dọc/xưng hô bằng key thật.
   Context/glossary giúp nhất quán nhưng không bảo đảm model không nhầm người nói.
   Không inpainting nâng cao. Text auto-fit bị giới hạn tài nguyên/độ đọc được;
   vùng quá nhỏ hoặc bản dịch quá dài có thể phải dùng font rất nhỏ hoặc clip.
9. **Hiệu năng:** benchmark là metadata/decoder/PNG/IDB/queue với mock HTTP; không
   phải tốc độ Gemini thật, quota/billing hay đo peak RAM. Giới hạn input12MiB,
   40M pixels,12tiles và concurrency1/2; ảnh cực lớn cần chọn1 hoặc chia nguồn.
10. **Quyền và cập nhật:** nút nổi tương lai cần optional website access. Cài ở ID
    extension khác không tự chuyển cache/key. 0.3.0 chưa có chapter cache để migrate.
    Quota IndexedDB phụ thuộc máy; xóa cache chương khi cần, không tự xóa dữ liệu
    đã dịch. Một số CSSOM-only changes cần Cập nhật ảnh vì không quét timer vô hạn.
