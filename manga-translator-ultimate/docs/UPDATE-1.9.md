# Cập nhật 1.9

Bản dịch được đọc lại cùng câu gốc và các lượt đáp gần đó. Lượt biên tập chỉnh các câu dịch sát chữ, cách nói dài dòng và từ đặt sai trong cảnh. Engine kiểm tra lại tên, từ điển, con số, câu hỏi, phủ định và mốc ngày có căn cứ trước khi nhận câu mới. Nếu câu mới khó chèn vừa ô, engine thử lại bản nháp trước khi gọi bước rút gọn.

- **Cân bằng** biên tập thêm các ô có dấu hiệu dịch sát chữ đã nhận diện.
- **Chất lượng cao** đọc lại lời thoại theo nhóm. Mỗi ảnh có tối đa hai lượt biên tập bổ sung bằng Qwen3 local.
- **Ít bộ nhớ** áp dụng các sửa đổi trực tiếp cho một số mẫu rõ nghĩa.

Với cảnh thiếu dấu hiệu người nói, cách xưng hô vẫn có thể cần sửa bằng **Sửa thoại**.

Trong mẫu chương 466, vế «Đã được Baal và tôi quyết định» được biên tập thành «Do Baal và tôi đưa ra» để nối với ô trước. Câu rủ «Chúng ta đi về nhà đi» thành «Về nhà thôi» trong kiểm thử Anh. Mẫu bạn thân dùng cùng cặp tớ–cậu thay cho cách xưng hô bị trộn trong một lượt.

Cả 9 ô từng bị sót ở chương 466 đều hiện bản dịch. Lượt đo ba trang ở chế độ **Cân bằng** trên CPU Linux mất 278,87 giây. Lượt đo trước của bản 1.8 trên cùng bộ ảnh mất 225,48 giây.

## Cập nhật

1. Chạy `Stop Engine.cmd`.
2. Trong repo `luucode` trên nhánh `manga-translator-ultimate`, chạy `git pull --ff-only`.
3. Chạy `Start Engine.cmd`, tải lại tiện ích lên **1.9.0** và tải lại tab truyện.
4. Bấm **Dịch lại ảnh** để áp dụng lượt biên tập cho ảnh đã dịch.
