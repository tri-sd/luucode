# Hướng dẫn sử dụng Manga Translator Pro 0.5.0

## Cài hoặc cập nhật trên Cốc Cốc

Gói `manga-translator-pro-0.5.0-unpacked.zip` đã build, không cần Node.js.

1. Đóng tác vụ dịch đang chạy. Giải nén gói mới vào một thư mục.
2. Nếu đang dùng 0.4.0, chép **nội dung** bản build mới đè vào đúng thư mục đang
   được Load unpacked. Giữ cùng đường dẫn/extension ID để giữ key và cache.
   Không bấm Remove bản cũ vì thao tác này có thể xóa dữ liệu extension.
3. Mở `coccoc://extensions/`, bật **Chế độ dành cho nhà phát triển** rồi bấm
   **Reload/Tải lại** Manga Translator Pro. Cài mới: bấm **Load unpacked/Tải tiện
   ích đã giải nén**, chọn thư mục có `manifest.json` của bản build.
4. Xác nhận version **0.5.0**, tắt những bản cài trùng và **F5 tab truyện**.
5. Mở **Cấu hình Gemini**, nhập key của bạn; chọn model có hỗ trợ ảnh và structured
   JSON. Mặc định key chỉ tồn tại trong phiên; nhớ key trên máy là lựa chọn riêng.

Chrome dùng `chrome://extensions/`. Cần nền Chromium từ116. Đường dẫn ví dụ trên
máy bạn là `D:\Manga-Translator-Pro`; môi trường cloud không tự ghi vào ổ D của bạn.

## Đọc và dịch cả chương

1. Mở trang manga. Trong popup bấm **Bật nút nổi trên website này** và cấp quyền
   website. Tùy chọn tự nhận diện trên mọi website cần quyền rộng riêng, không bắt buộc.
2. Trên thanh nhỏ góc phải trên, bấm **Thu thập** hoặc mở **Dịch truyện** → **Bắt
   đầu thu thập**. Extension nhắc cuộn tới cuối chương và hiển thị bộ đếm ảnh.
3. Tự cuộn từ đầu đến cuối để ảnh lazy load xuất hiện. Reader từng trang cần tự
   chuyển qua từng trang. Thu thập chỉ lưu metadata, **không gọi Gemini**.
4. Kiểm tra số ảnh rồi bấm **Dịch AI** ngay trên thanh. Nếu đang thu thập, nút này
   chốt danh sách và bắt đầu dịch trong cùng thao tác. Có thể dùng **Kết thúc thu
   thập** → **Dịch toàn bộ** trong bảng chi tiết.
5. Nếu báo thiếu quyền CDN, mở popup rồi bấm Dịch để cấp quyền cho miền chứa ảnh.
   Quyền phải được cấp từ thao tác người dùng; content script không tự mở hộp cấp quyền.
6. Bản dịch xuất hiện theo từng ảnh. Thẻ tiến trình góc phải dưới báo số ảnh hoàn
   thành/lỗi/chờ. Đóng thẻ bằng × chỉ thu gọn thông báo, không hủy dịch. Có thể đóng popup.
7. Dùng **Tạm dừng**, **Tiếp tục**, **Thử lại ảnh lỗi** hoặc **Hủy** khi cần. Kéo
   phần nhãn **Dịch truyện** để chuyển vị trí thanh điều khiển.

Extension chỉ dịch ảnh đã thu thập; không tự chứng minh đã đủ toàn bộ chương.
Quay lại ảnh đã dịch không gọi Gemini lại nếu bytes/profile còn phù hợp. DOM
mới hoặc reload cần tải/hash nguồn để xác minh cache trước khi vẽ; CDN không cho
xác minh thì không tự gắn bản dịch theo phỏng đoán.

## Chế độ nhận diện và cách trình bày

Trong bảng **Dịch truyện**:

- **Nền tối · chữ trắng**: mặc định cho chương mới, gần bố cục ảnh tham khảo.
- **Nền sáng nhanh**: phủ nền sáng trong vùng chữ.
- **Theo nền thoại**: lấy màu ước lượng từ mép vùng; nền phức tạp dùng màu dự phòng.
- **Giữ nền thoại gốc**: nền trong suốt, chữ gốc có thể còn thấy.
- **Ẩn/hiện bản dịch**: so sánh với ảnh gốc, không sửa dữ liệu ảnh website.
- **Phục hồi nền** bị vô hiệu hóa vì chưa có engine inpainting phù hợp.

Tùy chọn chương có concurrency1/2, tối đa1–3 lần thử, bảng tên/xưng hô và:

- **Tiêu chuẩn**: một lượt Gemini mỗi tile, trừ retry lỗi mạng/quota được cấu hình.
- **Rà soát chữ · thêm request**: thêm một lượt kiểm tra chữ bỏ sót mỗi tile, ghép
  vùng không trùng. Có thể tăng chi phí; không bảo đảm phát hiện mọi chữ nhỏ/SFX.

Gemini trả text gốc, tiếng Việt, bbox, polygon khi có, loại/hướng chữ và confidence
OCR/vị trí riêng. Đây là điểm do model tự báo, **chưa hiệu chuẩn**. Vị trí dưới0,5
được ẩn ngoài chế độ sửa; điểm chưa biết không được đổi thành điểm tin cậy giả.
Chữ Việt auto-fit/xuống dòng theo vùng. Vùng quá nhỏ hoặc dịch quá dài vẫn cần sửa.

## Sửa chữ, bbox và polygon

1. Đưa một ảnh **đã dịch trong chương** vào vùng xem. Mở bảng → **Sửa chữ/vùng**.
2. Chọn vùng từ danh sách, hoặc bấm một vùng overlay khi chế độ sửa đã mở.
3. Sửa tiếng Việt. X/Y/Rộng/Cao tính bằng phần trăm **ảnh gốc**, không phải màn hình.
   Đổi bbox sẽ kéo polygon cũ theo tỷ lệ nếu chưa sửa polygon riêng.
4. Phần **Polygon và thông tin OCR** cho nhập `[[x%,y%],…]` với3–16 điểm; polygon
   phải nằm trong bbox và không tự cắt. Để trống dùng bbox chữ nhật.
5. **Xem trước** chỉ áp dụng tạm. Đổi vùng giữ thay đổi hợp lệ trong bản nháp;
   dữ liệu sai sẽ giữ vùng hiện tại để sửa. **Lưu sửa** mới lưu cache của ảnh.
   Có thể thêm/ẩn vùng.
6. **Khôi phục bản AI** xóa toàn bộ bản sửa của ảnh đó, giữ OCR/bản dịch AI gốc.
   Đóng editor bỏ phần xem trước chưa lưu. Reload giữ phần đã lưu.

Editor hiện dành cho kết quả cache chương, chưa áp dụng cho tác vụ dịch một ảnh
độc lập. Nếu ảnh/chương đã đổi hoặc một tab khác đã lưu cùng ảnh, bản sửa cũ bị từ
chối; mở lại editor lấy phiên bản mới rồi sửa tiếp. Không tự ghi đè xung đột.

## Đọc lại vùng khó bằng crop

Trong editor, đặt bbox bao quanh vùng cần đọc rồi bấm **Đọc lại crop này bằng AI**.
Thao tác này tải/xác minh ảnh và gửi **crop PNG được phóng lớn có giới hạn**, không
gửi toàn tab. Chỉ hỗ trợ ảnh URL đã có cache chương. Cùng crop/profile/nội dung đã
xử lý được lấy từ cache, không gửi lại Gemini.

Kết quả là xem trước: vùng AI gốc nằm phần lớn trong crop được thay bằng vùng mới,
các vùng ngoài crop giữ nguyên. Kiểm tra rồi bấm **Lưu sửa**. Đọc lại có thể tính
phí API dù bạn chưa lưu bản sửa. Đóng editor/Escape hủy crop đang chạy; yêu cầu
đã tới provider vẫn có thể tính phí. Crop không phải công cụ phục hồi nền.

## Dịch một ảnh và xử lý sự cố

Popup vẫn có **Dịch ảnh đang xem**, **Cập nhật ảnh**, **Debug Image Detection**,
transcript/JSON và **Dùng ảnh chụp vùng hiển thị**. Canvas/blob hoặc URL không tải
được có thể dùng screenshot sau khi chủ động bấm Dịch. Chỉ phần ảnh đang thấy được
crop trong offscreen. Chưa hỗ trợ dịch cả chương canvas đã rời màn hình.

Nếu chỉ thấy ON: ON là badge, không chứng minh có bản dịch. F5 tab, cấp quyền
website, mở popup/cập nhật ảnh, xem Debug và bấm Thu thập/Dịch. Kiểm tra đúng bản
0.5.0 và không chạy trùng bản cũ.

Auth/403: kiểm tra key, project, hạn chế key và quyền Gemini API.429: chờ quota,
giảm concurrency hoặc thử lại sau. Timeout: tăng thời gian chờ trong cấu hình.
JSON/tọa độ sai không được vẽ một phần; thử model phù hợp hoặc crop nhỏ hơn.
Không gửi key trong ảnh chụp, log hoặc báo cáo lỗi.

## Build và kiểm thử trên máy bạn

Node.js>=22.12. Mở PowerShell đúng thư mục source chứa `package.json`:

```powershell
cd D:\Manga-Translator-Pro
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:integration
npm run benchmark
```

Build để Load unpacked nằm tại `.output\chrome-mv3`. Khi sửa source, chạy lại
`npm run build`, Reload extension rồi F5 tab. Không chọn thư mục source/file ZIP.

Chạy `npm run fixtures`, mở trên Cốc Cốc:

- `http://127.0.0.1:4173/comix-reader.html`: fixed Swiper, object-fit, scale50%.
- `http://127.0.0.1:4173/chapter-content.html?count=50&chapter=A`:50 ảnh.
- `http://127.0.0.1:4173/readers.html?mode=long-strip`: lazy/scroll.
- `http://127.0.0.1:4173/benchmark/index.html`:4 ảnh tổng hợp Anh/Nhật/Trung/Hàn.

Fixtures không tự gửi Gemini. Muốn kiểm tra provider thật, dùng extension thật
và key của bạn; bắt đầu với một ảnh/crop nhỏ để kiểm tra quota và chất lượng.

Trên Comix: mở đúng chapter, lần lượt đi qua các trang ở zoom reader50%, kiểm tra
bộ đếm rồi Dịch AI. Cuộn lên/xuống nhanh, đổi kích thước cửa sổ, thử browser zoom
80/100/125/150%; hai loại zoom là khác nhau. Kiểm tra vùng thoại ở đầu/giữa/cuối,
F5, quay lại chương, bật/tắt overlay, sửa rồi reload, đóng popup trong lúc dịch.
Ghi số ảnh, số request, vùng sai/thiếu và ảnh chụp có zoom; không tự đánh giá đạt
chỉ vì có chữ Việt. Xem báo cáo để biết phần nào chưa kiểm thử native trong cloud.
