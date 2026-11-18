# Cập nhật 1.2

- Xác định phần lòng sáng của bong bóng trên toàn ảnh, kể cả trường hợp ô chạm cạnh ảnh. Các dòng cùng ô được đọc và dịch chung. Với ô sáng tiếng Anh đã xác định được biên, engine so vị trí từ OCR với dải nét chữ gốc để phát hiện dòng bị bỏ sót.
- Xóa nét bên trong biên đã xác nhận và tìm vị trí chữ Việt trong phần lòng ô có lề an toàn. Chỉ ghi kết quả nếu cả bước xóa và chèn cùng đạt. Vùng không chắc chắn có thể giữ nguyên để tránh chữ chồng lên nhau hoặc làm hỏng hình.
- Gửi chỉ dẫn dịch và nhận kết quả theo ID bằng JSON gọn hơn. OCR tiếng Anh có thể đọc hai ô độc lập đồng thời. Dịch vẫn dùng cùng mô hình, cùng chỉ dẫn ngữ cảnh và qua bộ kiểm tra ID, tiếng nguồn, thuật ngữ khi trả kết quả.
- Giữ cơ chế cuộn và phục hồi bản dịch của 1.1.

## Cập nhật trên Windows

Trong thư mục dự án, chạy `Stop Engine.cmd`. Trong repo `luucode`, ở nhánh `manga-translator-ultimate`, chạy `git pull --ff-only`. Chạy `Start Engine.cmd`, tải lại tiện ích từ trang quản lý của trình duyệt và xác nhận phiên bản **1.2.0**. Tải lại tab truyện trước khi bấm **Dịch lại ảnh**.

Có thể dùng lại mã ghép nối và mô hình đã tải. Bản 1.2 dùng khóa cache mới vì cách nhận diện ô thay đổi. Các chỉnh sửa tay của bản cũ vẫn ở cơ sở dữ liệu và không được tự ghép sang các vùng mới.

## Đo tốc độ

Đo một lượt trên mỗi bản bằng cùng Qwen3 4B chạy CPU Linux, cùng hai ảnh thử và xử lý lại toàn bộ ảnh, bao gồm OCR, dịch, xóa nét và chèn chữ. Mỗi bản giữ đủ ba vùng thoại cho mỗi ảnh.

| Ảnh thử | 1.1.0 | 1.2.0 | Thời gian giảm |
|---|---:|---:|---:|
| Tiếng Anh | 33,50 s | 28,99 s | 13% |
| Tiếng Nhật | 17,78 s | 10,71 s | 40% |
| Tổng hai ảnh | 51,28 s | 39,70 s | 23% |

Tốc độ xử lý tổng hợp tăng khoảng 29% trong lượt đo này. Mục tiêu tăng 50% chưa đạt trên tổng hai ảnh. Thời gian chạy local có dao động; chưa đo lại trên RTX 3050, Windows và chương Comix thực tế.
