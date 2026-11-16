# Phạm vi và giới hạn 0.5.0

1. **Chưa chứng minh parity chất lượng.** Đã xem ảnh người dùng và năm ảnh công
   khai Web Store, đọc listing; chưa chạy extension tham khảo. Video tải lên vượt
   giới hạn32MiB của công cụ nên chưa xem. Không biết detector/cache/inpainting nội bộ.
2. **Chưa nghiệm thu Cốc Cốc Windows/Comix live.** Chromium cloud gặp TLS
   `ERR_CERT_AUTHORITY_INVALID` ở Comix và có policy chặn cài extension. Không tắt
   TLS hoặc policy. Fixture/transport adapter không chứng minh native MV3,
   `captureVisibleTab`, `tabs.setZoom`, worker restart hoặc đóng popup cài thật.
3. **Chưa đo AI thật.** Tests provider dùng mock; không có key thật hay outputs
   reference trên cùng dataset. Schema/prompt có hỗ trợ dọc/nghiêng/nhỏ/narration/SFX
   nhưng không bảo đảm recall/độ chính xác. Confidence do Gemini tự báo, chưa hiệu
   chuẩn. Không có local detector/OCR bổ sung đã hoạt động; adapter hiện dùng Gemini.
4. **Không có inpainting.** Dark/light/adaptive là phủ nền nhanh; nền ước lượng
   có thể sai hoặc che artwork nếu bbox/polygon sai. Nền gốc trong suốt không xóa
   chữ gốc. Tùy chọn phục hồi nền thật bị vô hiệu hóa đến khi có engine phù hợp.
5. **Typesetting hữu hạn.** Auto-fit/clip giữ giới hạn hình học; vùng quá nhỏ hoặc
   text quá dài có thể font<8px/khó đọc hoặc bị clip. Có cờ diagnostic riêng và
   editor để sửa. Viền bubble chỉ được giữ khi vùng không phủ lên viền; chưa có
   detector bubble riêng bảo đảm điều đó trên mọi ảnh.
6. **Editor/crop có phạm vi.** Editor dùng cache chương đã xác minh URL, chưa dùng
   kết quả single-image job độc lập hoặc canvas live-only. Chỉnh bbox bằng phần
   trăm/polygon JSON, chưa có kéo resize bằng chuột. Đổi vùng giữ nháp hợp lệ nhưng
   phải Lưu sửa trước khi đóng. Crop có thể tính phí trước khi lưu; vẫn cần xác nhận.
7. **Thu thập cần người đọc.** Không tự cuộn/chuyển trang hoặc xác minh đủ chapter
   từ API riêng của website. Chỉ có metadata các ảnh đã thấy; fixed reader cần đi
   qua từng trang. Canvas/blob không URL chỉ dịch được phần đang xem qua capture.
8. **Cache giữ tính đúng nguồn.** Cùng DOM đã xác minh phục hồi nhanh khi cuộn;
   reload/DOM mới cần tải/hash bytes. CDN hết hạn/chặn cookies/Referer/redirect có
   thể làm không restore được, thay vì gắn cache sai. Một request đã tới provider
   nhưng executor mất trước checkpoint có thể bị tính lại khi Resume.
9. **Hình học chưa hỗ trợ:** rotate/skew/flip/perspective, transform trên html,
   clip-path/mask của website, object-position calc/edge-offset phức tạp, pinch zoom,
   iframe và Shadow DOM của website. Rotation của chữ trong ảnh chỉ là OCR metadata,
   không có nghĩa hỗ trợ ảnh DOM bị xoay. Unsupported geometry được ẩn/báo Debug.
10. **Tài nguyên và cache:** input12MiB,40M pixels, tối đa12 tiles, concurrency1/2.
    Heap mẫu không là peakRAM của extension/GPU/bitmap. IndexedDB tùy quota máy;
    chưa tự dọn LRU. Không có thời gian dịch Gemini thật/ETA hay benchmark billing.
11. **Tương thích:** giữ DB `manga-translator-pro-v040`, version1 và profilev1 của
    chương cũ khi cấu hình còn khớp. Không tự nâng OCR cache cũ bằng request trả phí.
    Cài extension ID khác không tự chuyển key/cache; không Remove khi cập nhật.

Xem [báo cáo kiểm thử](V050_TEST_REPORT.md), [feature matrix](V050_FEATURE_PARITY.md)
và [benchmark](V050_BENCHMARK.md) để phân biệt số đo thật với tính năng chưa đánh giá.
