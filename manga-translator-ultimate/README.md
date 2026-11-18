# Manga Translator Ultimate — Free Local Edition

Chrome Manifest V3 và một chương trình chạy trên máy để dịch ảnh truyện tiếng Anh hoặc Nhật sang tiếng Việt. Kết quả là PNG cùng kích thước pixel với ảnh đầu vào. Chữ Việt được vẽ lên ảnh nên di chuyển cùng các nét vẽ khi cuộn, thay đổi kích thước hoặc zoom.

- [Cập nhật 1.2 và kết quả đo](docs/UPDATE-1.2.md)
- [Cập nhật từ 1.0 lên 1.1](docs/UPDATE-1.1.md)
- [Cài trên Windows 11](INSTALL_WINDOWS.md)
- [Mô hình và giấy phép](LICENSES.md)
- [Kiểm toán chi phí và dữ liệu](ZERO_COST_AUDIT.md)
- [Bằng chứng kiểm thử](TEST_REPORT.md)
- [Rà soát mã](CODE_REVIEW_REPORT.md)
- [Đóng gói và triển khai](DEPLOYMENT_REPORT.md)

## Đọc truyện

1. Chạy `Setup.cmd` lần đầu. Chrome cần nạp thủ công thư mục `extension/dist`. Dán mã ghép nối ở Cài đặt.
2. Mở chương truyện, ghim extension và bấm **Dịch chương này**. Chọn **Tiếng Nhật** hoặc **Tiếng Anh** nếu tự nhận diện không phù hợp.
3. Ở chế độ **Tự dịch khi cuộn**, ảnh trong và gần vùng đọc được ưu tiên. Tắt lựa chọn này để xử lý các ảnh đã tải trong chương hiện tại. Cấp quyền đọc trang nếu muốn tự tiếp tục sau khi tải lại trong cùng phiên Chrome.
4. Bật/tắt **Hiện bản dịch** để so sánh. Bấm **Sửa thoại** khi ảnh nằm giữa vùng đọc. Chọn vùng trên ảnh, sửa chữ, kéo khung hoặc điền tọa độ phần trăm rồi lưu. Chọn **Khôi phục vùng** để bỏ chỉnh sửa của vùng đang chọn.
5. Nếu một CDN bị chặn, **Cho phép CDN ảnh** xin quyền riêng cho các máy chủ ảnh phát hiện được. Ảnh yêu cầu cookie đặc biệt, nền CSS, iframe, canvas bị nhiễm nguồn chéo và trình đọc có biện pháp bảo vệ có thể cần một cách tải hợp lệ khác.

## Dữ liệu tại máy

Windows lưu cơ sở dữ liệu tại `%LOCALAPPDATA%\MangaTranslatorUltimate\pages.sqlite3`. Cache giữ ảnh gốc và ảnh kết xuất nén, tọa độ, OCR, bản dịch, phiên bản mô hình, hồ sơ và chỉnh sửa. Cache dùng LRU, mặc định 1.536 MiB dữ liệu ảnh, có thể đổi qua biến `MANGA_CACHE_MB` lúc khởi động. SQLite có thêm chi phí chỉ mục và nhật ký. Dọn cache ảnh giữ từ điển và chỉnh sửa. Bộ lọc kết quả không đọc được giữ vùng ảnh nguyên trạng và báo lý do.

Phát hiện chữ chạy PP-OCRv4 trên CPU. Tiếng Nhật dùng Manga OCR ONNX int8, tiếng Anh dùng Tesseract. Ollama chạy Qwen3 4B Instruct Q4_K_M, có chế độ ép CPU và thử lại CPU khi suy luận tự động báo lỗi. Từ điển và vài lượt thoại trước được dùng làm ngữ cảnh khi các trang trước đã xử lý. Không có tài khoản, khóa dịch vụ hoặc giới hạn số lần dịch.

## Phát triển

```text
cd extension
npm ci
npm run build
```

Cài Python 3.12, Tesseract 5 với dữ liệu tiếng Anh, và Ollama. Tạo venv, cài `local-ai-engine/requirements.txt` cùng `tests/requirements.txt`. Đặt các tệp Manga OCR theo `models/README.md`, chạy Ollama trên `127.0.0.1:11434` và kéo mô hình đã chọn. Điều hướng tới `local-ai-engine`, đặt `MANGA_STATE_DIR` tới một thư mục cục bộ thử nghiệm nếu cần, rồi chạy `python -m manga_engine`. Tại thư mục gốc, `python -m pytest -q tests` chạy các bài không cần mô hình. Cài trình duyệt kiểm thử với `python -m playwright install chromium --no-shell` hoặc đặt `CHROMIUM_BIN` tới Chrome for Testing. Đặt `MANGA_TEST_TOKEN_FILE` trỏ tới mã ghép nối của engine để bật cả test suy luận thật và Chromium. Xem báo cáo về lệnh chạy và nền tảng đã xác minh.
