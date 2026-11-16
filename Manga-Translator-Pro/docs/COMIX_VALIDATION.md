# Kiểm chứng Comix trên Cốc Cốc Windows 11 — 0.3.0

Tài liệu lịch sử cho dịch một ảnh. Bản hiện tại0.5 có dịch chương/editor/crop:
xem [V050_USER_GUIDE.md](V050_USER_GUIDE.md) và [báo cáo0.5](V050_TEST_REPORT.md).

Đây là phần nghiệm thu cần chạy trên máy người dùng. Cloud không có Cốc Cốc;
Chromium mở Comix bị `ERR_CERT_AUTHORITY_INVALID`. Không dùng kết quả fixture
để kết luận Comix thật đã chạy thành công.

## Cài bản mới

1. Giải nén `manga-translator-pro-0.3.0-unpacked.zip` vào
   `D:\Manga-Translator-Pro\build-0.3.0` (hoặc thư mục riêng).
2. Mở `coccoc://extensions/`, bật Developer mode, tắt bản cũ để tránh chạy đôi.
3. Load unpacked → chọn đúng thư mục có **manifest.json**; kiểm tra version **0.3.0**.
   Nếu ghi đè cùng thư mục đã cài thì bấm Reload.
4. F5 trang truyện. Content script cũ vẫn còn trên tab nếu chỉ Reload extension.
5. Mở cấu hình, nhập/lưu lại key nếu dùng chế độ chỉ nhớ theo phiên. Không chụp
   màn hình hoặc gửi API key khi báo lỗi.

Nếu build từ source, mở Terminal ở thư mục có package.json:

```powershell
npm ci
npm run build
```

Load unpacked: `D:\Manga-Translator-Pro\.output\chrome-mv3` nếu package.json ở
`D:\Manga-Translator-Pro`. Gói build sẵn không cần Node.js/npm.

## Nhận diện trên Comix, chưa gọi Gemini

Mở https://comix.to/title/qvw1-marriage-toxin/11720523-chapter-186 và chuyển sang
đọc từng trang, đặt zoom của **reader** 50% như ảnh báo lỗi. Đợi ảnh tải hết.

Bấm biểu tượng extension → **Cập nhật ảnh** → mở **Debug Image Detection**.

Cần thấy: DOM img > 0; ít nhất một ảnh hợp lệ và đang thấy; ảnh Page n có method
`img` hoặc `picture`, kích thước nguồn > 0, lý do “Đang hiển thị; có thể dịch”.
Popup hiển thị kích thước và phương pháp, nút Dịch bật khi đã có key/model.
Một số ảnh preload/inactive bị loại là bình thường; Debug ghi rõ lý do.
Mở Debug/Refresh không chụp màn hình hoặc gọi Gemini.

## Dịch và tracking thật

1. Để chế độ ảnh gốc, bấm **Dịch ảnh đang xem**; cấp quyền đúng miền CDN nếu hỏi.
2. Kiểm tra transcript gốc/tiếng Việt và overlay đúng trang đang xem.
3. Nếu CDN báo IMAGE_ACCESS, chọn **Dùng ảnh chụp vùng hiển thị**, bấm Dịch lại.
   Không cuộn/zoom/chuyển tab cho tới khi bắt đầu tiến trình Gemini. Chỉ vùng ảnh
   đang thấy được dịch trong chế độ này; vùng ngoài màn hình không được chụp.
4. Sau khi có kết quả, cuộn lên/xuống và trong reader, đổi zoom reader
   50→75→100→50%, resize cửa sổ; thử riêng browser zoom Ctrl+-/Ctrl+0/Ctrl++.
5. Chuyển trang/chapter: bản dịch cũ không được gắn sang ảnh mới. Bấm Cập nhật ảnh
   để chọn lại; không tự dịch toàn chương. Dịch lại không nhân đôi overlay.
6. Chuyển sang long-strip, kéo đến ảnh tải chậm, lặp lại bước nhận diện/dịch/cuộn.

Đánh giá tracking bằng việc box bám cùng vị trí nguồn khi ảnh di chuyển. Nếu cần
đo ngưỡng 2 CSS px, dùng fixture có box nguồn biết trước. Box Gemini có thể OCR
sai vị trí dù phép chiếu chính xác; cần phân biệt hai phép đo.

## Fixture tại máy người dùng

Từ source chạy `npm run fixtures`, giữ Terminal mở. Mở các URL trên Cốc Cốc rồi
bấm popup thật của extension (server không tự gọi Gemini):

- `http://127.0.0.1:4173/comix-reader.html`: fixed Swiper/img/object-fit, zoom 50%.
- `http://127.0.0.1:4173/readers.html?mode=fixed`: scroll tài liệu sau fixed reader.
- `http://127.0.0.1:4173/readers.html?mode=long-strip`: ảnh lazy theo dải dài.
- `http://127.0.0.1:4173/readers.html?mode=picture`: picture/source/srcset.
- `http://127.0.0.1:4173/readers.html?mode=background`: CSS background một ảnh.
- `http://127.0.0.1:4173/readers.html?mode=canvas`: canvas tĩnh, tự chọn ảnh chụp.
- `http://127.0.0.1:4173/readers.html?mode=tainted`: canvas vẽ ảnh từ hostname khác,
  không đọc pixel được; kiểm chứng đường captureVisibleTab thật.

Dùng Windows display scale 100/125/150/200% và browser zoom 80/100/125/150% riêng
biệt; xác nhận screenshot crop không chứa phần ngoài ảnh và không lệch overlay.
Thử chuyển tab/scroll/resize ngay khi bấm Dịch: kết quả chụp không nhất quán phải
bị từ chối bằng STALE_IMAGE. Capture API có giới hạn tốc độ; không bấm liên tục.

## Khi chưa đạt

Gửi version extension/browser, mode reader, zoom reader, browser zoom, Windows
display scale, screenshot popup Debug (không có key), counts, method, kích thước,
lý do ảnh bị loại và mã lỗi. Có thể chép các dòng Debug vào issue. Không cần gửi
key, cookie, URL ảnh có query ký hoặc dữ liệu chụp toàn tab.

CAPTURE_FAILED: giữ tab truyện active, mở lại popup và chờ vài giây trước khi thử.
Rotation/skew/perspective, pinch zoom, clip-path/mask, background nhiều lớp, iframe
và Shadow DOM của website chưa hỗ trợ. Canvas bị taint tự redraw không có input
chưa được bảo đảm; không bật tự lật trang trong lúc dịch.
