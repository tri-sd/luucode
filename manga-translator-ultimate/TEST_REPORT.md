# Kiểm thử hồi quy — 18/11/2026



## Bản 1.3

**20 bài đạt** trên Linux với Chromium và Qwen3 local thật. Hai mẫu Anh/Nhật đều giữ 3/3 vùng thoại, cùng bản dịch đã lưu trong phép đo 1.2. Ca hồi quy mới mô phỏng một ô sáng lớn bị cắt ở ba mép ảnh. Bộ dò được cố ý chỉ trả ô bên cạnh. Luồng quét bổ sung đọc đủ cả bảy dòng trong ô lớn, xóa các nét gốc trong mẫu, giữ vùng tranh giữa hai ô và kết xuất đúng hai bản dịch. Một bài riêng kiểm tra bộ dịch từ chối việc đưa số 13 từ ô nguồn sang ô bên cạnh. Các bài cuộn, cache và chèn ảnh của Chromium đều đạt.

[Chi tiết cập nhật và phép đo](docs/UPDATE-1.3.md). Ảnh hồi quy được tạo theo hình dạng và chữ trong ảnh lỗi. Chưa chạy trên ảnh gốc của Comix trong Cốc Cốc và RTX 3050 của người dùng.

## Bản 1.2

**18 bài đạt** trên Linux với Qwen3 thật và Chrome for Testing. Hai fixture vẫn đọc, dịch và vẽ đủ 3/3 vùng Anh và 3/3 vùng Nhật. Mẫu hồi quy ô bị cắt sát cạnh có bốn dòng, trong đó detector cố ý chỉ tìm hai. Test xác nhận một kết quả dịch, đủ bốn dòng OCR, các nét gốc đều được xóa trong mẫu và vùng hình ngoài ô giữ nguyên. Kiểm tra mới từ chối bản dịch lời rủ bị đổi thành lệnh hoặc mất đích đến. Chromium tiếp tục vượt qua kiểm tra cuộn, cache, zoom và thay trang.

[Kết quả đo tốc độ so với 1.1](docs/UPDATE-1.2.md#đo-tốc-độ). Chưa chạy lại đúng trang Comix trên Cốc Cốc và RTX 3050 của người dùng.

## Bản 1.1

**16 bài đạt** trên Linux với mô hình Qwen3 thực và Chrome for Testing. Ba vùng tiếng Anh và ba vùng tiếng Nhật được đọc, dịch và kết xuất đầy đủ trên hai ảnh mẫu. Bài hồi quy mới mô phỏng bộ dò bỏ cả một dòng trong bong bóng, đo mặt nạ phủ hơn 95% nét đậm của dòng đã bỏ sót và xác nhận vùng hình ngoài bong bóng giữ nguyên. Bài kiểm thử Chromium cuộn ảnh đã dịch ra khỏi vùng tải trước và xác nhận URL blob của ảnh giữ nguyên khi quay lại. Bộ lọc mới thử lại khi câu tiếng Việt còn sao chép một cụm tiếng Anh từ nguồn.

Các ảnh bằng chứng trong `docs/evidence` được cập nhật từ lượt kiểm thử 1.1. Trang Comix và Cốc Cốc trên máy người dùng chưa được chạy lại bằng bản 1.1.

## Bản 1.0

**14 bài đạt** trong lượt cuối, tổng thời gian 92,87 giây. Môi trường Linux x64, CPU giới hạn 2 lõi theo cgroup, Ollama 0.6.8, Chrome for Testing 151 và Playwright 1.62. Hai bài tích hợp ảnh gọi mô hình thật. Các fixture hình ảnh được vẽ riêng cho dự án.

```text
extension: npm ci && npm run build
repo: python -m pytest -q -s tests
...........en 11.55s, 3 regions
.ja 15.22s, 3 regions
..
14 passed in 92.87s (0:01:32)
```

Đặt `MANGA_TEST_TOKEN_FILE` trỏ tới mã của một companion thử nghiệm đang chạy để bật kiểm thử thật và Chromium. Đặt `PLAYWRIGHT_BROWSERS_PATH` nếu trình duyệt nằm ở thư mục riêng. Có thể đặt `MANGA_EVIDENCE_DIR` để lưu ảnh kết quả.

| Kiểm tra | Kết quả và phạm vi |
|---|---|
| OCR tiếng Anh | PASS — Tesseract đọc đúng 3/3 vùng fixture. |
| OCR tiếng Nhật | PASS — Manga OCR ONNX đọc đúng 3/3 vùng fixture; gồm một dòng dọc. |
| Dịch tiếng Việt local | PASS — hai fixture dùng Qwen3 4B Instruct Q4_K_M trên CPU, ba bản dịch mỗi ảnh, đúng thứ tự. Test kiểm tra nghĩa cốt lõi và giữ sắc thái buổi sáng. |
| Region ID và glossary | PASS — đảo thứ tự JSON, ID thừa/trùng/thiếu, lọc văn bản còn tiếng nguồn, phát hiện sai sơ bộ và chỉ retry vùng thiếu. |
| Detector, mask, dàn chữ | PASS — detector thật; unit test vùng thoại nền màu, bảo toàn viền, tiếng Việt có dấu, đậm/nghiêng, cắt tile, giới hạn cỡ chữ. Ảnh tích hợp giữ kích thước đầu vào 720 × 960. |
| Scroll, zoom, responsive, DOM | PASS — 100 lần xuống và 100 lần lên, nhanh/chậm trong vùng cuộn lồng, thay chiều cao phía trên, geometry ≤2 CSS px, screenshot cùng vùng giống hệt sau quay về, zoom Chrome 80/100/125/150%, bốn viewport, density 2x, lazy load, thay node, chuyển chương SPA, đổi tab và reload. |
| CSP và canvas | PASS — fixture CSP hiển thị bản dịch; trình đọc canvas same-origin theo image anchor, `object-fit: contain`, `object-position: 28% 61%`, transform scale/translate và clipping cuộn. |
| Cache và chỉnh sửa | PASS — cache hit fingerprint, mở lại SQLite, dọn LRU, lưu và phục hồi vùng thoại, khôi phục bản dịch khi reload/chuyển DOM. |
| Tác vụ và kết nối | PASS — hủy trong scheduler, thử lại phần thiếu, trình duyệt phục hồi sau một lỗi loopback được chèn có kiểm soát. |
| Thiết bị | PASS trên CPU thật, PASS với lỗi GPU giả lập để kiểm tra đường fallback. NVIDIA CUDA thật và RTX 3050 **NOT VERIFIED**. |
| UI | PASS — nạp bản MV3 và mở trang cài đặt thật, xác nhận model/health và áp dụng tùy chọn tự dịch vào tab truyện. Các thao tác nội dung được gọi qua giao thức giống popup. |
| Zero cost | PASS — audit đích loopback, phân quyền worker, request trình duyệt trong fixture, kiểm tra xác thực và Origin. |
| Windows native, website ngoài fixture, VRAM dài hạn | **NOT VERIFIED** — phân tích cú pháp PowerShell và kiểm tra có wheel Windows x64 đã chạy, chưa chạy installer trên Windows hoặc đo rò bộ nhớ dài hạn. |

## Kết quả mô hình

- Qwen3 4B Instruct Q4_K_M mặc định có trọng số khoảng 2,50 GB và giấy phép Apache-2.0. Đo cả OCR, dịch, kết xuất và cache write phía companion mất **11,55 giây cho fixture Anh, 15,22 giây cho fixture Nhật** ở lượt cuối. Thời gian dựa trên CPU Linux và trạng thái mô hình đã nạp trong phần kiểm thử, không phải dự đoán trên RTX 3050 hoặc trên một chương truyện.
- Qwen2.5 1.5B Q4_K_M có trọng số khoảng 0,99 GB. Ở phép thử nhanh tiếng Anh với prompt trước khi chốt, mô hình trả hai vùng qua bộ lọc và bỏ sót bản dịch một vùng trong 12,96 giây, có một câu sai nghĩa. Có thể tải riêng để dùng ít bộ nhớ.
- Qwen2.5 3B Q4_K_M trả đủ ID ở phép thử nhanh tiếng Anh trong 16,19 giây. Thời gian gồm lúc tải mô hình và dùng prompt thử nghiệm. Giấy phép nghiên cứu giới hạn mục đích sử dụng nên chỉ dùng để đánh giá.
- Các phép thử 1.5B/3B là định hướng kỹ thuật, không phải benchmark đối chứng về chất lượng. Có thể chạy lại các mô hình Apache bằng `python tests/benchmark.py` khi `PYTHONPATH` hướng tới `local-ai-engine` và đã tải cả hai.

[Bản tiếng Anh đã dịch](docs/evidence/english-vi.png) · [Bản tiếng Nhật đã dịch](docs/evidence/japanese-vi.png) · [Ảnh Chromium gốc](docs/evidence/chromium-original.png) · [Ảnh Chromium dịch](docs/evidence/chromium-translated.png)
