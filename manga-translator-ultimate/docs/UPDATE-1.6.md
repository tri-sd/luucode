# Cập nhật 1.6

- Ở chế độ **Cân bằng**, một hoặc hai ô cuối có thể dịch cùng nhóm trước nếu tổng số ký tự vẫn trong giới hạn. Ollama tiếp tục trả kết quả theo ID của từng ô, và các ô cần sửa được gửi lại riêng.
- Khi đổi kiểu hoặc cỡ chữ, engine có thể vẽ lại từ bản dịch đã lưu nếu ảnh, ngôn ngữ, mô hình, thiết bị, từ điển, ngữ cảnh và các tùy chọn nhận dạng khớp. Chỉ các lượt đã dịch đủ phần OCR đạt yêu cầu mới được lưu để dùng lại. **Dịch lại ảnh** vẫn chạy lại OCR và dịch từ đầu.
- Bản dịch tiếp tục chạy bằng Ollama local. Chế độ **Tự động (GPU nếu có)** để Ollama quyết định sử dụng GPU. Trên Windows có thể chạy `ollama ps` trong lúc dịch để xem cột `PROCESSOR`.

## Kết quả đo

Trên trang 7 chương 466, thời gian từ lúc đọc ảnh đến khi kết xuất giảm từ **80,25 xuống 72,65 giây**. Hai lượt đo dùng cùng ảnh, CPU Linux và Qwen3 đã nạp sẵn. Công đoạn dịch gọi Ollama hai lần ở bản 1.6 và ba lần ở bản 1.5. Mức giảm phụ thuộc vào số ô và số lượt phải thử lại. Đổi kiểu chữ trên ảnh mẫu tiếng Anh mất **0,61 giây** qua API. RTX 3050 và Cốc Cốc trên Windows cần được đo riêng.

## Cập nhật

1. Chạy `Stop Engine.cmd`.
2. Trong repo `luucode` trên nhánh `manga-translator-ultimate`, chạy `git pull --ff-only`.
3. Chạy `Start Engine.cmd` và tải lại tiện ích lên **1.6.0**, sau đó tải lại tab truyện.
