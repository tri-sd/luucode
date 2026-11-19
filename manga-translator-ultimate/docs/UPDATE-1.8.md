# Cập nhật 1.8

Ollama đọc các lượt đối đáp để chọn giọng và cách xưng hô theo vai vế, độ thân quen và thái độ. Khi cảnh thiếu dấu hiệu rõ về quan hệ, mô hình ưu tiên cách nói trung tính hoặc lược đại từ nếu câu vẫn tự nhiên. Nếu phải rút ngắn câu để vừa ô, mô hình nhận cả câu tiếng Việt đã dịch để giữ cách xưng hô.

Mỗi nhóm dịch có thể đọc trước tối đa hai ô của nhóm tiếp theo trong cùng ảnh. Các ô đọc trước giúp hiểu lời đáp và vẫn có lượt dịch riêng theo thứ tự. Việc dịch tiếp tục dùng Qwen3 local. Với cảnh có nhiều người nói mà OCR chỉ đọc được chữ, cách xưng hô vẫn có thể cần chỉnh tay.

Trong các cảnh kiểm tra, bạn thân nói «Tớ không muốn cậu lo», người em gọi «Chị ơi» và học trò đáp «Cảm ơn thầy. Em sẽ nộp vào buổi sáng.»

Ba trang đối chiếu chương 466 vẫn hiện đủ 9/9 ô từng bị sót. Lượt đo trên CPU Linux mất tổng cộng 225,48 giây. Lượt đo bản 1.7 trước đó trên cùng bộ ảnh mất 190,43 giây.

## Cập nhật

1. Chạy `Stop Engine.cmd`.
2. Trong repo `luucode` trên nhánh `manga-translator-ultimate`, chạy `git pull --ff-only`.
3. Chạy `Start Engine.cmd`, tải lại tiện ích lên **1.8.0** và tải lại tab truyện.
4. Dùng **Dịch lại ảnh** trên ảnh đã có bản dịch để áp dụng cách xưng hô mới.
