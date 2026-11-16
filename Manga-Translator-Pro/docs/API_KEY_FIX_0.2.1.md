# Sửa lỗi từ chối API key — 0.2.1

Bản 0.2.0 kiểm tra key bằng regex chỉ nhận chữ, số, gạch dưới và gạch nối. Dấu chấm
trong authorization key dạng AQ. bị loại ngay tại extension. Đây là lỗi tương
thích của extension; đổi sang một key AQ. khác không giải quyết lỗi bản 0.2.0.

Bản 0.2.1 nhận key như chuỗi opaque, giữ nguyên nội dung, cho phép dấu chấm và chỉ
kiểm tra kích thước/ký tự header an toàn. Vẫn từ chối key rỗng, chuỗi có whitespace
nội bộ, ký tự điều khiển hoặc dấu ngoặc bao ngoài. Key chỉ tới Google trong
x-goog-api-key, không ở URL, public status hay log.

## Cập nhật Cốc Cốc

1. Dùng build 0.2.1, thay build cũ hoặc tắt bản cũ rồi Load unpacked thư mục mới.
2. Trong coccoc://extensions/, xác nhận phiên bản 0.2.1 và bấm Reload nếu cần.
3. Đóng cửa sổ Tùy chọn cũ, mở lại, dán toàn bộ key đã copy từ Google AI Studio.
4. Bấm Tải danh sách model; chọn model rồi Lưu cấu hình.

Lưu cấu hình chỉ kiểm tra chuỗi và lưu key. Tải danh sách model mới thực hiện
request tới Google để kiểm tra quyền sử dụng thực tế.

## Nếu vẫn lỗi sau cập nhật

| Mã | Ý nghĩa và bước tiếp theo |
| --- | --- |
| KEY_FORMAT | Kiểm tra chuỗi được dán đầy đủ, không có dấu ngoặc/Bearer/xuống dòng |
| AUTH | Google không xác thực key; kiểm tra key còn hiệu lực và đúng project |
| PERMISSION | Key có thể đúng nhưng project/API/application restrictions không cho request này |
| API_DISABLED | Kiểm tra Generative Language API đã được bật cho project |
| KEY_BLOCKED | Google chặn key/project; kiểm tra thông báo trong AI Studio |
| QUOTA | Kiểm tra quota/billing hoặc đợi trước khi thử lại |

Không cần gửi key cho người hỗ trợ. Chỉ cung cấp thông báo/mã lỗi và nút đã bấm.
Không bỏ mọi giới hạn bảo vệ của key để thử; đối chiếu cấu hình với Gemini API.

Google mô tả loại authorization key và cách quản lý tại:
https://ai.google.dev/gemini-api/docs/api-key

Lưu ý kiểm chứng: unit/browser tests dùng key và response giả. Chưa xác minh key
của người dùng hoặc OCR Gemini thật trong môi trường phát triển.
