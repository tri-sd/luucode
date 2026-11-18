# Rà soát mã

| Khu vực | Hiện thực và sửa lỗi |
|---|---|
| Region ID | Schema chỉ liệt kê ID của lô hiện tại. Runtime đối chiếu ID, phát hiện trùng/ngoài lô và thử lại riêng phần thiếu. Không chấp nhận văn bản rỗng, tiếng Nhật còn sót, tiếng Anh rõ ràng, lặp bất thường hoặc thiếu thuật ngữ glossary đã áp dụng. |
| OCR và hình học | Sửa việc decoder Manga OCR phát một dấu CLS bổ sung lúc bắt đầu. Polygons theo ảnh gốc, hợp nhất theo vùng bong bóng và loại trùng giữa tile. Tọa độ luôn tính theo ảnh. Kiểm tra aspect ratio trước khi áp dụng PNG. |
| Layout và DOM | Lưu thuộc tính gốc của ảnh và source trong picture. Chỉ phục hồi thuộc tính do extension đổi. Cập nhật khi ảnh, chương hoặc DOM đổi. Khi CSP từ chối blob URL, canvas theo ma trận ảnh và clipping của vùng cuộn. |
| Tác vụ chồng nhau | Mỗi tab xử lý một ảnh tại một điểm. Companion có một worker suy luận, tối đa ba tác vụ chờ/chạy, lease 35 giây với polling và deadline. Chuyển chương làm mất hiệu lực generation. Ollama streaming kiểm tra hủy giữa các đoạn. |
| Bộ nhớ | OCR CPU int8 và ONNX giới hạn thread. Dịch dùng GGUF lượng tử, một mô hình nạp đồng thời khi launcher quản lý Ollama. Cache giữ ảnh nén. Giữ ảnh thay trực tiếp ngoài vùng nhìn trong giới hạn kích thước giải mã 80 MiB. Giải phóng canvas ở xa và ảnh vượt ngân sách. Request/ảnh đầu ra và số pixel có giới hạn. |
| Xử lý lỗi | Không ghép kết quả vào DOM đã đổi. Lỗi kết nối tạm thời đưa ảnh về hàng chờ và có backoff. Vùng OCR thấp, nền khó xóa hoặc chữ tràn giữ nguyên. |
| An toàn | Worker MV3 làm trung gian xác thực. Mã ghép nối không gửi cho content script. API chỉ bind loopback và kiểm tra Origin, Host, kích thước, dạng request và nguồn dịch. Logs không ghi lời thoại. |
| Cache | Giao dịch SQLite ghi dữ liệu ảnh và sửa tay cùng lúc. Fingerprint gồm SHA-256 ảnh, digest mô hình, cấu hình, glossary và phiên bản thuật toán. Giữ sửa tay khi dọn ảnh. |
| Phụ thuộc | Mô hình 3B nghiên cứu được loại khỏi trình cài, dùng bản Apache 2.0. Noto Sans kèm OFL. Bản Windows dùng Python venv và winget thay cho gói nhị phân tự ghép. |

## Giới hạn kỹ thuật

- Tách vùng bằng detector phổ thông và phân đoạn nền gần đơn sắc. Trang có chữ hòa vào artwork, chữ hiệu ứng, furigana quá nhỏ, ảnh vẽ liền nhiều khung hoặc thứ tự đọc dị thường vẫn cần kiểm tra tay. SFX được suy đoán từ hình học.
- Kiểm tra ngữ nghĩa, giọng thoại và tên riêng là heuristic cộng glossary, không thể phát hiện mọi bản dịch sai. Nếu chương chưa có trang trước trong cache hoặc người dùng cuộn nhảy qua trang, ngữ cảnh liền trước có thể thiếu.
- Canvas fallback hỗ trợ biến đổi affine và vùng cuộn có biên thẳng. Perspective 3D, clipping CSS phức tạp, trình đọc canvas vẽ lại cùng kích thước mà không đổi URL, và trình đọc trong iframe cần adapter riêng.
- Tác vụ có thể dừng ở lần kiểm tra kế tiếp nếu lệnh Tesseract hoặc model đang xử lý một bước. Kiểm tra CUDA, dùng thực tế lâu dài và độ chính xác đại diện cho nhiều website cần dữ liệu ngoài fixture và phần cứng đích.
