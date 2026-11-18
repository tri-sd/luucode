# Cập nhật 1.4

## Thu thập trước, dịch sau

1. Mở đầu chương và chọn **Thu thập ảnh chương**.
2. Cuộn qua chương để trình đọc tải ảnh. Popup đếm các ảnh đã ghi nhận. Những dải ảnh ngắn cùng khổ trang cũng được xét.
3. Ở cuối chương, bấm **Dịch N ảnh đã thu thập**. Hàng đợi xử lý theo thứ tự ghi nhận từng ảnh, kể cả ảnh đã ra khỏi vùng đọc. Có thể tạm dừng rồi tiếp tục.
4. Khi cuộn lại, tiện ích ghép bản dịch theo nguồn ảnh đã thu thập. Popup báo những ảnh chưa xử lý được.

Hàng đợi nằm trong tab của chương hiện tại. Tải lại tab hoặc đổi chương sẽ bắt đầu phiên thu thập mới. Với ảnh HTTP, tiện ích ghi nhớ URL rồi đọc khi đến lượt. Ảnh blob và canvas được chụp khi còn hiện diện, tối đa 96 MiB cho bản chụp mã hóa trong một phiên. Trang thu hồi URL, ảnh bị chặn quyền hoặc canvas vẽ lại trên đúng một nút có thể cần thử lại khi ảnh đang mở.

Nút **Dịch ngay khi đọc** và tùy chọn **Tự dịch khi cuộn** vẫn dùng được cho luồng cũ.

## Sửa bỏ sót chữ

Engine quét lại các dòng chưa gắn được với một ô thoại khi nền ô lọt sang nền khung qua khe nhỏ. OCR tiếng Anh nối lại từ bị ngắt cuối dòng (ví dụ `INVESTI-` / `GATE`) và giữ gạch nối của hậu tố tên như `-sama`. Việc chèn vẫn kiểm tra vùng an toàn và chỉ kết xuất khi toàn bộ thao tác thành công.

## Cập nhật trên Windows

Chạy `Stop Engine.cmd`. Trong repo `luucode`, ở nhánh `manga-translator-ultimate`, chạy `git pull --ff-only`. Chạy `Start Engine.cmd`, tải lại tiện ích và kiểm tra phiên bản **1.4.0**, rồi tải lại tab truyện. Mô hình và mã ghép nối hiện có dùng lại được.
