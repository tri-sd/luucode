# Kiểm toán chi phí và dữ liệu

Pipeline đo được chạy bằng mô hình Ollama local, detector PP-OCRv4 local, Tesseract/Manga OCR local và OpenCV/Pillow local. Người dùng không nhập API key, phương thức thanh toán hoặc tài khoản dịch vụ. Mã ghép nối ngẫu nhiên dùng để xác thực hai tiến trình trên cùng máy.

| Hạng mục | Đường đi dữ liệu |
|---|---|
| OCR, mask, khử chữ, kết xuất | Hàm Python và Tesseract subprocess. Tệp ảnh không được chuyển ra ngoài. |
| Dịch và kiểm tra mô hình | `manga_engine/translate.py` chỉ gửi tới `127.0.0.1:11434`. HTTP client bỏ proxy môi trường và từ chối redirect. Chọn từ model local đã cài, kiểm tra digest, kích thước và metadata cloud. |
| Companion | `127.0.0.1:18787`, xác thực mã ghép nối, kiểm tra Host và Origin, giới hạn nội dung request. Không có endpoint tải URL, endpoint proxy hay lệnh shell tùy ý. |
| Chrome | Tải ảnh từ trang đang mở qua quyền của trang. Worker chỉ truy cập CDN đã được cấp quyền riêng, bỏ thông tin đăng nhập, từ chối redirect, kiểm tra MIME và dung lượng. Ảnh, bản dịch và thông tin tài khoản dịch vụ không đi vào telemetry. |
| Setup | Internet dùng để cài ứng dụng, wheel và tải model. Lệnh `ollama pull` nằm trong trình cài hoặc tùy chọn tải model, nằm ngoài runtime dịch. |
| Chi phí | Phí API 0₫. Không có bộ đếm lượt, SDK thanh toán, credit, trial, subscription hoặc fallback cloud. |

Bài `tests/test_cost.py` kiểm tra đích đến trong mã backend, các quyền MV3, chuyển hướng và nhóm dependency. Test API thật kiểm tra từ chối Origin của website, từ chối thiếu mã ghép nối, và xác nhận mô hình local. Bản kiểm thử trình duyệt ghi nhận URL request từ fixture, extension hoặc localhost.

**Phạm vi.** Điều khoản và hành vi của trình duyệt, website đang đọc, hệ điều hành hoặc Ollama do người dùng cài sẵn thuộc các ứng dụng đó. Khi tự khởi động Ollama, trình cài đặt `OLLAMA_NO_CLOUD=1`. Khi tái sử dụng Ollama có sẵn, companion vẫn giới hạn ở các mô hình có trọng số local.
