# Cập nhật 1.1

- Với bong bóng có nền phẳng và viền đóng, engine tìm thêm nét chữ bị bộ dò bỏ sót, đọc chung cả lời thoại và mở rộng vùng xử lý nét gốc. Kiểm tra hình dạng và biên giúp bảo vệ phần hình bên ngoài. Nền phức tạp hoặc vùng chưa đủ tin cậy vẫn có thể cần sửa tay.
- Bản dịch dành thêm ngữ cảnh cho các câu tiếp nối qua nhiều bong bóng, dùng cách nói tiếng Việt theo giọng nhân vật và thử lại khi phát hiện cụm tiếng Anh bị chép nguyên trong câu.
- Ảnh đã dịch bằng cơ chế thay trực tiếp có thể giữ bản dịch khi đi ra xa vùng nhìn trong giới hạn bộ nhớ. Hiển thị lại ảnh có sẵn cũng có hàng xử lý riêng để không phải chờ trang kế tiếp dịch xong.

## Cập nhật nếu đã clone repo

1. Chạy `Stop Engine.cmd` trong thư mục Manga Translator.
2. Tại repo `luucode`, chuyển sang `manga-translator-ultimate` nếu cần rồi chạy `git pull --ff-only`.
3. Chạy `Start Engine.cmd`. Mã ghép nối và mô hình đã tải được dùng lại.
4. Tại trang quản lý tiện ích, bấm nút tải lại cạnh Manga Translator Ultimate. Kiểm tra phiên bản **1.1.0** rồi tải lại chương truyện.
5. Chọn nguồn theo chữ trên trang. Nếu trang đang hiển thị tiếng Anh, chọn **Tiếng Anh**. Thử **Dịch lại ảnh** trước trên trang từng sót chữ.

Phiên bản mới dùng khóa cache mới để tính lại các trang bằng OCR và thuật toán xóa chữ đã thay đổi. Các bản chỉnh tay tạo bằng phiên bản cũ vẫn nằm trong cơ sở dữ liệu nhưng không tự ghép sang vùng mới, vì vị trí và số lượng vùng có thể đã thay đổi.
