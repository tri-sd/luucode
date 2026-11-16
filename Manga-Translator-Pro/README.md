# Manga Translator Pro 0.5.0

Chrome Extension Manifest V3, WXT và TypeScript strict. Dịch manga/manhwa/webtoon
Anh, Nhật, Trung, Hàn sang tiếng Việt bằng Gemini key do người dùng nhập.

Bản 0.5.0 nâng cấp trên engine chương/tracking0.4: toolbar bộ đếm và **Dịch AI**,
thẻ tiến trình riêng, polygon/confidence, nền tối/sáng/thích nghi, sửa chữ/bbox/polygon,
đọc lại crop và chế độ rà soát chữ tùy chọn. Quy trình dịch chương: **thu thập metadata → xác nhận Dịch toàn bộ → hàng
đợi tối đa 2 request → hiển thị từng ảnh → khôi phục từ IndexedDB khi quay lại**.
Giữ dịch ảnh đang xem, Debug Image Detection, cấu hình key/model và Tracking Lab.

[Hướng dẫn tiếng Việt đầy đủ](docs/V050_USER_GUIDE.md) ·
[Báo cáo kiểm thử](docs/V050_TEST_REPORT.md) · [Giới hạn](docs/V050_LIMITATIONS.md) ·
[Kiến trúc](docs/ARCHITECTURE.md)

## Cài / cập nhật trên Cốc Cốc

Gói `manga-translator-pro-0.5.0-unpacked.zip` đã build, không cần Node.js.

1. Giải nén vào `D:\Manga-Translator-Pro\build-0.5.0` hoặc thư mục đang cài bản cũ.
2. Mở `coccoc://extensions/`, bật Developer mode, Load unpacked và chọn thư mục có
   **manifest.json**. Nếu cập nhật cùng thư mục thì bấm Reload; nếu cài mới, tắt bản cũ.
3. **F5 các tab truyện**. Kiểm tra version 0.5.0 và cấu hình key/model nếu cần.

Cập nhật đúng thư mục cũ giúp giữ extension ID và dữ liệu. Cài ở thư mục/ID khác
không tự mang theo key/cache. Bản 0.3.0 chưa có cache chương để chuyển đổi; queue
và cache chương được tạo từ0.4 và giữ nguyên trong0.5. Không Remove extension khi cập nhật. Không xóa cấu hình Gemini của bản cũ.
Chrome dùng `chrome://extensions/`; yêu cầu nền Chromium >=116.

## Dịch toàn bộ chương

1. Mở popup → **Bật nút nổi trên website này** và cấp quyền một lần. Muốn tự nhận
   diện trên mọi website, mở Tùy chọn → phần **Nút Dịch truyện trên website** →
   **Bật tự nhận diện trên website**. Quyền rộng này là lựa chọn của bạn.
2. Khi tìm thấy ảnh, nút nhỏ **🌐 Dịch truyện** xuất hiện. Kéo nút để di chuyển.
3. Bấm **Bắt đầu thu thập**. Tự cuộn từ đầu tới cuối, hoặc chuyển từng trang trong
   fixed reader. Extension giữ metadata ảnh đã thấy, không tải toàn chương vào RAM
   và **không gửi ảnh đến Gemini khi thu thập**.
4. Kiểm tra bộ đếm/danh sách rồi bấm **Kết thúc thu thập**. Tới cuối vùng cuộn chỉ
   là dấu hiệu; extension không tự khẳng định đã thu thập đủ chương.
5. Bấm **Dịch AI** trên thanh (tự kết thúc thu thập), hoặc **Dịch toàn bộ** trong bảng. Nếu chưa có quyền CDN, mở popup và bấm Dịch toàn bộ để cấp
   quyền tải các miền ảnh. Key chỉ dùng trong context tin cậy của extension.
6. Kết quả xuất hiện từng ảnh; tiến trình đếm riêng hoàn thành/đang xử lý/thất bại.
   Có thể đóng popup, cuộn, resize hoặc đổi tab.
7. Dùng **Tạm dừng**, **Tiếp tục**, **Thử lại ảnh lỗi**, **Ẩn/hiện bản dịch** và các
   chế độ nền tối/sáng/thích nghi/trong suốt. Có **Sửa chữ/vùng**, đọc lại crop và
   **Rà soát chữ** (thêm request, có thể tính phí). Tùy chọn chương có concurrency 1/2, số lần thử 1–3 và bảng tên/xưng hô.

Ảnh lỗi không ngừng các ảnh còn lại. 429/network/timeout có backoff hữu hạn;
thử lại có thể tạo request tính phí. Cache phân biệt nội dung, chapter, model,
ngôn ngữ, prompt/OCR version và glossary. Ảnh đã hoàn thành không tự gửi lại Gemini.
Reload/DOM tái tạo sẽ kiểm tra bytes ảnh khi truy cập được rồi khôi phục box chuẩn hóa.

## Dịch riêng ảnh đang xem

Popup vẫn có **Dịch ảnh đang xem**, **Cập nhật ảnh**, **Debug Image Detection**,
transcript/JSON tác vụ gần nhất và lựa chọn screenshot. Canvas/blob hoặc CDN chặn
nguồn có thể dùng **Dùng ảnh chụp vùng hiển thị** sau thao tác Dịch rõ ràng; chỉ phần
ảnh đang thấy được crop trong offscreen rồi gửi đến Gemini. Nút nổi được ẩn lúc chụp.

Key nhập ở **Cấu hình Gemini**, hỗ trợ key AQ./AIza; model lấy từ Google hoặc nhập
ID hỗ trợ ảnh/JSON. Mặc định chỉ giữ key theo phiên; checkbox nhớ key là tùy chọn.
Local/session storage đặt TRUSTED_CONTEXTS. Website không nhận key hoặc screenshot
toàn tab. JSON dùng schema và render textContent, không chạy HTML của provider.

## Build source

Node.js >=22.12, npm; mở Terminal đúng thư mục chứa package.json:

```powershell
cd D:\Manga-Translator-Pro
npm ci
npm run build
```

Load unpacked: `.output\chrome-mv3`. Đừng chọn cả source hoặc file ZIP.

```powershell
npm run lint
npm run typecheck
npm run test
npm run build
npx playwright install chromium
npm run test:integration
npm run benchmark
```

`npm run check` chạy chuỗi kiểm tra. Đặt `CHROMIUM_PATH` khi cần executable hệ thống.
Tests dùng key giả/Gemini mô phỏng, không dùng quota của người dùng.

## Kiểm thử tại máy bạn

Chạy `npm run fixtures` rồi mở trên Cốc Cốc:

- `/chapter-content.html?count=50&chapter=A`: 50 ảnh/lifecycle/thu thập thủ công.
- `/chapter-content.html?count=1&mode=fixed&chapter=A`: container cố định.
- `/comix-reader.html`: cấu trúc fixed Swiper/object-fit, scale 50%.
- `/readers.html?mode=long-strip`, `picture`, `background`, `canvas`, `tainted`.

Các URL trên dùng gốc `http://127.0.0.1:4173`. Bấm extension thật để kiểm tra với key
của bạn; fixture không tự gọi Gemini. Xem checklist trong V050_USER_GUIDE.md.
Tracking Lab trong Tùy chọn vẫn là bản demo chữ giả lập, không chứng minh OCR thật.

## Phạm vi và trạng thái nghiệm thu

Hỗ trợ img/picture/srcset/lazy, background một URL, fixed/long-strip, nested scroll,
object-fit/position đơn giản, translate/scale dương và matrix3d axis-aligned. Box
luôn theo ảnh gốc, không giữ tọa độ OCR trên màn hình. Không quét toàn DOM bằng timer
vô hạn; discovery dùng mutation/resize/load và các sự kiện layout, có refresh thủ công.

**Chưa xác nhận trên Cốc Cốc/Comix live trong cloud.** Chromium bị lỗi chứng chỉ khi
mở Comix và chính sách máy chặn cài extension. Report phân biệt rõ fixture, mock
Gemini, adapter restart và các bài native bị skip; không suy ra độ chính xác OCR từ
sai số tracking. Xem V050_LIMITATIONS.md trước khi dịch chương dài.

## Typesetting và bản sửa0.5

Phủ nền nhanh không phải inpainting; chưa có engine phục hồi nền. Editor lưu bản
sửa riêng với OCR gốc và có reset. Bbox/polygon theo ảnh gốc; crop chỉ preview cho
đến khi Lưu sửa. Editor hiện dành cho cache chương, chưa dùng single-image job.

[Feature Parity Matrix](docs/V050_FEATURE_PARITY.md) và [Benchmark](docs/V050_BENCHMARK.md)
ghi rõ bằng chứng và chỉ số chưa đo. Chưa chạy reference/Gemini thật hoặc xem được
video vượt32MiB; không tuyên bố parity100%. Cache0.4 giữ DB/profile cũ, không tự
gọi API nâng cấp kết quả đã dịch.
