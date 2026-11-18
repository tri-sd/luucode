# Cập nhật 1.7

- **Cân bằng** dùng các câu tiếng Việt gần nhất làm ngữ cảnh. Engine gửi nguyên văn các ô đang dịch và từ điển người dùng. Ô bị bộ kiểm tra từ chối có thể thử lại với cả câu gốc và câu dịch. **Chất lượng cao** dùng cả hai ngay từ lượt đầu.
- Khi Ollama trả sai hoặc thiếu một câu ngắn đã biết nghĩa như `BESIDES...` hay `LET'S GO HOME.`, engine có thể dùng cách dịch xác định được ngay. Quy tắc chỉ áp dụng với nguyên câu và ưu tiên từ điển người dùng.
- **Ít bộ nhớ** dùng chung phiên Ollama qua các nhóm trên cùng một ảnh và giải phóng mô hình khi hoàn tất ảnh. Mọi lần suy luận dùng mô hình local.

## Kết quả đo

| Ảnh gốc chương 466 | Bản 1.6 | Bản 1.7 | Ô từng bị sót đã hiện bản dịch |
| --- | ---: | ---: | ---: |
| Trang 1 | 46,97 giây | 43,80 giây | 1/1 |
| Trang 4 | 89,98 giây | 71,11 giây | 2/2 |
| Trang 7 | 110,37 giây | 75,52 giây | 6/6 |
| **Tổng** | **247,32 giây** | **190,43 giây** | **9/9** |

Đo từ bước đọc ảnh đến kết xuất PNG ở chế độ **Cân bằng**, CPU Linux và cùng mô hình Qwen3 4B đã nạp. Các trang sau nhận ngữ cảnh từ các trang đã dịch trước đó trong mẫu. Trang 7 được kiểm tra lại với ngữ cảnh đó sau khi điều chỉnh việc thử lại. Tổng thời gian giảm khoảng **23%** trên ba trang. Tốc độ trên RTX 3050 và Cốc Cốc trên Windows cần đo riêng.

Với **Ít bộ nhớ**, một ảnh mẫu tự tạo gồm 5 ô đo từ trạng thái chưa nạp mô hình mất **43,80 giây ở bản 1.7** và **112,78 giây ở bản 1.6**. Bản 1.7 nạp mô hình một lần, chèn 5/5 ô và giải phóng mô hình sau ảnh. Bản 1.6 nạp lại ở mỗi lượt gọi và chèn 4/5 ô. Mức chênh lệch phụ thuộc số nhóm và số câu cần thử lại.

## Cập nhật

1. Chạy `Stop Engine.cmd`.
2. Trong thư mục repo `luucode` trên nhánh `manga-translator-ultimate`, chạy `git pull --ff-only`.
3. Chạy `Start Engine.cmd`, tải lại tiện ích lên **1.7.0**, rồi tải lại tab truyện.
4. Chọn **Cân bằng** để dùng cấu hình đã đo. Khi muốn đo lại ảnh đã có bản dịch, dùng **Dịch lại ảnh** để chạy lại luồng xử lý.
