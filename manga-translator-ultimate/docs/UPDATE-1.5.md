# Cập nhật 1.5

## Đọc chữ trong ô dính nhau

- Nền của nhiều ô thoại đôi khi dính thành một mảng sáng. Engine gom các dòng theo vị trí và khoảng cách, rồi tách mảng đó thành các vùng chèn riêng. Khi nét chữ còn nối giữa hai dòng đã dò được, engine vẫn đọc chúng trong cùng cụm.
- OCR dùng vị trí dòng và lượng chữ đã đọc để loại kết quả trông có vẻ tốt nhưng bỏ mất phần câu. Một số dạng chữ nghiêng được đọc lại bằng ảnh đã chỉnh nghiêng.
- Các mảnh như `QUESTION- / ING` và `INVESTI- / GATE` được nối trước khi dịch. Tên như `SULLIVAN- / SAMA` giữ dấu gạch nối thật. Từ nối đứng riêng và ý giúp đỡ cũng được kiểm tra khi nhận bản dịch.
- Dàn chữ đo khung nét của font tiếng Việt. Dấu thanh và phần chữ thừa ra khỏi độ rộng con trỏ được tính trước khi chọn cỡ chữ. Vùng tranh còn nét được chừa khỏi vị trí chèn.
- Thao tác **Thu thập ảnh chương** và **Dịch N ảnh đã thu thập** dùng như bản 1.4.

## Kiểm tra trên chương 466

Đã chạy OCR, dịch bằng Qwen3 local và kết xuất trên ảnh gốc của chương 466. Trang 7 hiện bản dịch ở cả 6 cụm thoại viền gai. Hai ô dính nhau ở trang 4 được chèn riêng và `QUESTION- / ING` được đọc thành `QUESTIONING`. Ô báo lỗi ở trang 1 hiện bản dịch sau khi OCR khôi phục `INVESTIGATE` và `RELATIONSHIP`.

Một cụm chữ viền trắng nằm trực tiếp trên nền tranh ở đầu trang 7 vẫn giữ nguyên. Phép thử ảnh và kiểm thử Chromium chạy trên Linux. Cốc Cốc, Windows và RTX 3050 chưa được dùng để kiểm thử bản này. Gói phát hành dùng ảnh mẫu tự tạo của dự án.

## Cập nhật

1. Chạy `Stop Engine.cmd`.
2. Trong repo `luucode` trên nhánh `manga-translator-ultimate`, chạy `git pull --ff-only`.
3. Chạy `Start Engine.cmd`, tải lại tiện ích và kiểm tra phiên bản **1.5.0**.
4. Tải lại tab Comix, chọn **Tiếng Anh**, thu thập và dịch chương hoặc dùng **Dịch lại ảnh** để thử đúng trang.

Mô hình và mã ghép nối hiện có dùng lại được. Cache ảnh có phiên bản mới vì hình học các vùng thoại thay đổi. Chỉnh sửa tay cũ nằm trong cơ sở dữ liệu cũ theo khóa ảnh và vùng.
