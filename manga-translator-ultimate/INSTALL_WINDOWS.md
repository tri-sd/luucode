# Cài trên Windows 11 x64

Yêu cầu Chrome hiện hành, Windows App Installer (`winget`) và quyền cài ứng dụng trên máy. Lần đầu cần mạng để cài phụ thuộc và tải khoảng 2,5 GB trọng số dịch cùng khoảng 117 MB trọng số OCR. Hãy giải nén **gói đầy đủ** vào một thư mục có quyền ghi, ví dụ `Documents\MangaTranslatorUltimate`.

1. Bấm đúp **Setup.cmd** và đợi thông báo **Pairing code copied**. Trình cài tự tìm hoặc cài Python 3.12, Tesseract và Ollama, tải trọng số, xác minh SHA-256 cho Manga OCR, khởi động engine và chép mã ghép nối vào clipboard. Windows có thể yêu cầu quyền cài đặt. Nguồn tải được ghi trong [LICENSES.md](LICENSES.md).
2. Trong Chrome, nhập `chrome://extensions`. Bật **Chế độ dành cho nhà phát triển** rồi chọn **Tải tiện ích đã giải nén**. Chọn thư mục **extension\dist** bên trong gói.
3. Ghim tiện ích vào thanh công cụ. Mở biểu tượng bánh răng trong popup, dán mã ghép nối và bấm **Lưu và kiểm tra kết nối**. Có thể chép lại mã bằng **Copy Pairing Code.cmd**.
4. Mở website truyện, bấm **Dịch chương này**. Chọn nguồn **Tiếng Anh** hoặc **Tiếng Nhật** nếu chương dùng một ngôn ngữ.
5. Sau khi khởi động lại Windows, bấm **Start Engine.cmd** trước khi dịch. **Stop Engine.cmd** dừng những tiến trình do gói này khởi động. Nếu máy đã chạy sẵn một Ollama ở cổng 11434, gói tái sử dụng dịch vụ đó và không dừng nó.

## Máy ít bộ nhớ hoặc CUDA chưa sẵn sàng

- Để **Tự động** dùng GPU nếu Ollama nhận diện được. Nếu có lỗi driver hoặc thiếu VRAM, đổi **Thiết bị** sang **Chỉ CPU**.
- Chọn **Ít bộ nhớ** để giảm cỡ lô, hạ độ phân giải detector và giải phóng mô hình sau lượt xử lý.
- Để giảm tải thêm, chạy **Download Small Model.cmd**, sau đó chọn `qwen2.5:1.5b-instruct-q4_K_M` trong Cài đặt. Mô hình này có chất lượng dịch thấp hơn trên ảnh kiểm thử.
- Khi rời mạng, cứ giữ Ollama và Local Engine đang chạy. Chrome chỉ dịch những ảnh trình duyệt còn đọc được trên trang, CDN đã tải, hoặc trình đọc HTTP cục bộ.

## Xử lý lỗi cài đặt

- Nếu thiếu **winget**, dùng App Installer trên Windows hoặc cài Python 3.12, Ollama và Tesseract từ các nguồn trong [LICENSES.md](LICENSES.md), rồi chạy lại **Setup.cmd**. Cần bộ dữ liệu Tesseract `eng`.
- Nếu Ollama đang chạy nhưng không dùng GPU, cập nhật trình điều khiển NVIDIA và kiểm tra `nvidia-smi`. Popup chỉ hiển thị GPU và bộ nhớ khi lệnh này trả về dữ liệu.
- Nếu cổng 18787 bận, đóng chương trình đang giữ cổng trước khi khởi động Local Engine. Mã ghép nối và nhật ký xem ở `%LOCALAPPDATA%\MangaTranslatorUltimate`.
- Nếu nghi mô hình OCR tải dở, chạy lại **Setup.cmd**. Trình tải đối chiếu hash và chỉ thay tệp sai hoặc thiếu.
- Các script dùng PowerShell có sẵn của Windows. Chrome nạp bản build đã đóng gói, không cần cài Node.js. Python runtime và Ollama được cài riêng trên máy.
