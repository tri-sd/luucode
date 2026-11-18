# Cập nhật 1.3

- Quét thêm các lòng ô sáng có cụm nét giống chữ dù bộ dò ban đầu không phát hiện dòng nào ở đó. Ô kéo dài qua mép ảnh vẫn được xét khi vùng sáng tách được khỏi phần còn lại của trang.
- Khi OCR toàn ô tiếng Anh không đọc đủ các dải nét, thử đọc từng dòng. Chỉ kết xuất khi nhận dạng đủ tin cậy. Vùng tranh hoặc chữ chưa đọc rõ vẫn có thể cần kiểm tra thủ công.
- Kiểm tra số liệu xuất hiện ở sai ô để giảm lỗi đưa nội dung qua ô bên cạnh.
- Tìm cỡ chữ theo tìm kiếm nhị phân trong vùng chèn hình chữ nhật và vẫn kiểm tra lề trước khi vẽ. Cơ chế cuộn và mô hình dịch giữ cấu hình 1.2.

## Cập nhật trên Windows

1. Chạy `Stop Engine.cmd`.
2. Trong repo `luucode`, ở nhánh `manga-translator-ultimate`, chạy `git pull --ff-only`.
3. Chạy `Start Engine.cmd` và tải lại tiện ích tới phiên bản **1.3.0**.
4. Tải lại tab truyện, chọn **Tiếng Anh** nếu câu gốc đang là tiếng Anh và bấm **Dịch lại ảnh**.

Mô hình và mã ghép nối hiện tại dùng lại được. Cache ảnh có phiên bản mới vì số lượng và vị trí các vùng có thể thay đổi. Chỉnh sửa tay cũ vẫn nằm trong cơ sở dữ liệu và cần nhập lại nếu muốn áp dụng cho các vùng mới.

## Kết quả đo trên CPU Linux

| Hạng mục | 1.2.0 | 1.3.0 |
|---|---:|---:|
| Dàn chữ 30 lần cho cùng một ô dài, cùng cỡ chữ 28 px | 39,881 s | 3,024 s |
| Toàn quy trình trên ảnh mẫu Anh, không lấy kết quả ảnh từ cache | 10,41 s | 10,89 s |
| Toàn quy trình trên ảnh mẫu Nhật, không lấy kết quả ảnh từ cache | 9,09 s | 10,47 s |

Bước dàn chữ giảm khoảng 92% thời gian trong phép đo riêng. Toàn quy trình không đạt mục tiêu tăng tốc 25% trong lượt đối chiếu này. Mỗi ảnh vẫn có đủ ba vùng, cùng nội dung dịch trên hai phiên bản. Các phép đo toàn quy trình được chạy nối tiếp trên cùng model Qwen3 và có dao động giữa các lượt. Chưa có phép đo trên RTX 3050.
