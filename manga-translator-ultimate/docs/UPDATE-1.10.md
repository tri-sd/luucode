# Cập nhật 1.10

Engine đọc lời dẫn và lời thoại tiếng Anh in ngang trực tiếp trên nền tranh, gồm kiểu chữ đen có viền sáng. Nó gom các dòng cùng cột để nhận nghĩa trọn cụm, xử lý chữ bị ngắt dòng rồi gửi dịch. Tính năng hoạt động khi tắt **Thử dịch cả chữ hiệu ứng (SFX)**.

Bản dịch nằm trên nền sáng giới hạn trong vùng chữ nguồn. Phần nền bên dưới vùng chèn được che để tránh sót chữ Anh lẫn vào bản dịch. Bên ngoài vùng chèn, ảnh giữ nguyên. Vùng có ít nét chữ đọc được hoặc OCR thiếu tin cậy vẫn có thể giữ nguyên chữ gốc. Đường quét mới được đối chiếu với lời dẫn ngang tiếng Anh.

Ảnh trong báo lỗi ở chương 147 của Frieren kết xuất 14 cụm chữ ngoài bong bóng khi tắt SFX. Kiểm tra OCR trên các trang chương 466 của Iruma nhận đủ 9 ô từng bị sót.

## Cập nhật

1. Chạy `Stop Engine.cmd`.
2. Trong thư mục repo `luucode` trên nhánh `manga-translator-ultimate`, chạy `git pull --ff-only`.
3. Chạy `Start Engine.cmd`, tải lại tiện ích lên **1.10.0** và tải lại tab truyện.
4. Chọn **Tiếng Anh** rồi bấm **Dịch lại ảnh** ở trang có lời dẫn ngoài bong bóng.
