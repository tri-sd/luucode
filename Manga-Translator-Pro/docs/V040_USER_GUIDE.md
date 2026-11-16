# Manga Translator Pro 0.4.0 — hướng dẫn sử dụng

Bản này thêm thu thập ảnh theo chương, hàng đợi dịch và khôi phục bản dịch đã lưu.
Dịch riêng ảnh đang xem, Debug Image Detection, cấu hình Gemini và Tracking Lab
vẫn được giữ lại. Kết quả kiểm thử và giới hạn môi trường nằm trong TEST_REPORT.md;
hướng dẫn này không thay thế việc nghiệm thu trên Cốc Cốc tại máy bạn.

## 1. Cập nhật từ 0.3.0 trên Cốc Cốc

Giữ một bản sao thư mục 0.3.0 nếu muốn quay lại. Để dùng tiếp cấu hình của extension
hiện tại, cập nhật các file build tại **đúng thư mục đã Load unpacked trước đó**, mở
`coccoc://extensions/` rồi bấm **Reload/Tải lại**. Sau đó **F5 tab truyện** để thay
content script cũ và kiểm tra extension hiển thị version 0.4.0.

Nếu cài build vào một thư mục mới:

1. Giải nén ZIP build vào `D:\Manga-Translator-Pro\build-0.4.0`.
2. Trong `coccoc://extensions/`, bật **Developer mode/Chế độ nhà phát triển**.
3. Tắt bản cũ để tránh chạy hai extension cùng lúc.
4. Chọn **Load unpacked/Tải tiện ích đã giải nén**, chọn thư mục có trực tiếp
   `manifest.json`.
5. Mở cấu hình và nhập lại key/model nếu extension được nhận thành một bản cài mới.
   Dữ liệu trong bản cài cũ không tự chuyển sang một extension ID mới.

Gói build sẵn không cần Node.js. Giữ nguyên thư mục cài đặt để cập nhật bằng Reload;
không gỡ extension nếu muốn giữ cấu hình và cache của bản cài đó.

## 2. Cấu hình Gemini

Bấm biểu tượng extension → **Cấu hình Gemini**:

1. Nhập đầy đủ Gemini API key, không kèm dấu ngoặc hoặc tiền tố Bearer.
2. **Tải danh sách model**, chọn model có thể xử lý ảnh và JSON, hoặc nhập model ID.
3. Chọn ngôn ngữ nguồn tự động, Anh, Nhật, Trung hoặc Hàn. Đích là tiếng Việt.
4. Đặt timeout rồi **Lưu cấu hình**.

Cách lưu key giữ như 0.3.0: mặc định theo phiên trình duyệt; tùy chọn **Nhớ key** lưu
trên máy. Đóng hoàn toàn trình duyệt có thể cần nhập lại key để chạy tiếp tác vụ.
Website không nhận API key. Không gửi key trong ảnh chụp hoặc báo lỗi.

## 3. Bật nút nổi tự động

Mở website truyện, bấm biểu tượng extension rồi chọn
**Bật nút nổi trên website này**. Chấp thuận quyền truy cập website khi trình duyệt
hỏi. Extension có thể tự phát hiện ảnh và hiện nút **🌐 Dịch truyện** trong những
lần truy cập sau trên website đã được cấp quyền.

Nếu muốn bật cho các website khác, mở Tùy chọn của extension rồi chọn
**Bật tự nhận diện trên website**. Nút này xin quyền HTTP/HTTPS rộng hơn; bạn có
thể chọn chỉ cấp từng website qua popup. Quyền có thể chỉnh lại trong phần quản lý
extension của trình duyệt.

Nút nổi chỉ hiện khi phát hiện phần tử ảnh phù hợp. Đợi ảnh tải, F5 trang nếu vừa
cấp quyền, hoặc dùng popup → **Cập nhật ảnh/Debug Image Detection** khi chưa thấy nút.
Kéo nút nổi sang vị trí thuận tiện; bấm **Thu gọn ×** để đóng bảng và tiếp tục đọc.

Quyền website giúp extension tự hiện trên trang. Khi bắt đầu dịch, popup có thể
xin thêm quyền tải ảnh từ miền CDN chứa ảnh truyện. Nếu bảng nổi báo thiếu quyền,
hãy mở popup, bấm **Dịch toàn bộ** và chấp thuận miền ảnh được hỏi.

## 4. Thu thập toàn bộ chương

Bắt đầu ở đầu chương để giữ thứ tự đọc mong muốn.

1. Bấm **🌐 Dịch truyện** hoặc **Bắt đầu thu thập** trong popup.
2. Bảng chuyển sang **📖 Đang thu thập ảnh** và yêu cầu cuộn đến cuối chương.
3. Tự cuộn lần lượt qua các ảnh. Đợi ảnh lazy loading hiện rõ; bộ đếm tăng khi nhận
   diện thêm ảnh. Có thể cuộn lại nhiều lần mà không tạo thêm mục cho cùng ảnh.
4. Với reader từng trang/fixed reader, chuyển lần lượt qua các trang theo thứ tự
   đọc. Extension giữ metadata của ảnh đã xem ngay cả khi DOM bị thay thế.
5. Khi đã đi qua các trang cần dịch, bấm **Kết thúc thu thập**.

Giai đoạn này không gọi Gemini và không chụp hàng loạt màn hình. Extension không
cần giữ toàn bộ bitmap của chương trong RAM. Website vẫn tự tải ảnh theo cách của
nó; bạn cần đợi loader của website tải ảnh thành công.

Thông báo “đã tới cuối vùng cuộn” chỉ là gợi ý. Một website có thể còn ảnh ẩn,
loader lỗi hoặc trang chưa chuyển tới; extension không tự xác nhận đã đủ chương.
Bạn luôn có thể kết thúc thủ công, kiểm tra **Danh sách ảnh**, hoặc chọn
**Tiếp tục thu thập** rồi đi qua những ảnh còn thiếu.

## 5. Bắt đầu dịch

Sau khi kết thúc thu thập, bảng hiển thị:

> Đã phát hiện X ảnh. Bắt đầu dịch toàn bộ chương?

Kiểm tra danh sách, rồi bấm **Dịch toàn bộ**. Từ thao tác này, ảnh được đưa vào
hàng đợi và gửi đến Gemini theo giới hạn bạn chọn; mặc định tối đa hai ảnh xử lý
cùng lúc. Ảnh dài có thể cần nhiều request cho các phần ảnh.

Bảng hiển thị số ảnh hoàn thành, đang xử lý và thất bại cùng thanh tiến độ thực.
Mở **Danh sách ảnh** để xem trạng thái từng ảnh và lỗi riêng. Một ảnh lỗi không
làm mất các kết quả đã hoàn thành của ảnh khác. Số “đã xử lý” có thể bao gồm ảnh
thất bại; hãy kiểm tra riêng số **Hoàn thành** và **Thất bại**.

Bản dịch xuất hiện ngay khi từng ảnh hoàn thành. Có thể thu gọn bảng hoặc đóng
popup trong khi dịch; popup không giữ request mạng. Bản dịch chỉ được gắn vào ảnh
hiện tại có danh tính và hình học phù hợp.

## 6. Tạm dừng, tiếp tục và thử lại

- **Tạm dừng**: ngừng lấy thêm ảnh mới từ hàng đợi. Request đã chạy có thể hoàn
  thành và lưu kết quả, nên số hoàn thành vẫn có thể tăng sau khi bấm.
- **Tiếp tục**: tiếp tục công việc chưa xong; nhập lại key trước nếu phiên key đã hết.
- **Thử lại ảnh lỗi**: đưa các ảnh thất bại trở lại hàng đợi. Ảnh đã hoàn thành với
  cùng cấu hình và cache hợp lệ được tái sử dụng.
- **Hủy**: dừng công việc chưa xong. Các kết quả đã lưu của chương được giữ lại.
  Có thể bắt đầu dịch lại khi muốn; không dùng Xóa cache chỉ để dừng tác vụ.

Lỗi tạm thời như 429/quota, mạng hoặc timeout có số lần thử lại giới hạn và khoảng
chờ tăng dần. Trong **Tùy chọn dịch chương**, chọn tối đa 1, 2 hoặc 3 lần xử lý mỗi
ảnh. **Không tự thử lại** tương ứng một lần xử lý. Thử lại tự động hoặc thủ công
có thể phát sinh thêm request và phí/quota Gemini; timeout không chứng minh rằng
provider chưa xử lý request trước đó. Khi quota hạn chế, giảm xuống một ảnh mỗi lần.

Nếu tiến trình trình duyệt hoặc offscreen bị mất, checkpoint cho biết ảnh nào đã
xong và ảnh nào bị gián đoạn. Kiểm tra trạng thái, cấu hình key và tiếp tục từ giao
diện. Extension không cam kết tiếp tục nguyên request mạng đã bị ngắt sau khi
trình duyệt đóng hoặc context xử lý bị hủy.

## 7. Đọc bản dịch và chỉnh hiển thị

Sau khi có kết quả, cuộn lên/xuống, resize cửa sổ và quay lại ảnh cũ để đọc.
Kết quả lưu theo ảnh nguồn; overlay được đo lại theo cách ảnh đang hiển thị.
Hai DOM instances của cùng ảnh có lớp chữ riêng và dùng chung kết quả hợp lệ.

- **Ẩn bản dịch/Hiện bản dịch** thay đổi hiển thị mà giữ kết quả đã lưu.
- **Che chữ gốc** dùng lớp nền trong vùng chữ.
- **Giữ nền thoại gốc** bỏ lớp nền che, có thể vẫn thấy chữ gốc bên dưới.
- Chữ tiếng Việt tự xuống dòng và giảm cỡ để nằm trong vùng cho phép. Toàn văn
  của một ảnh dịch riêng vẫn có trong phần kết quả popup.

Extension không sửa bitmap ảnh của website. Khi chưa đo được vị trí chính xác,
overlay sẽ được tạm ẩn. Chuyển sang chương khác không được dùng các region của
chương trước cho ảnh mới.

Zoom reader, zoom trình duyệt và Windows display scale là các điều chỉnh riêng.
Hãy kiểm chứng trên Cốc Cốc bằng hướng dẫn kiểm thử của bản phát hành; không suy
ra độ chính xác OCR từ việc box tracking bám đúng ảnh. Pinch zoom và hình học nằm
ngoài phạm vi hỗ trợ có thể bị từ chối kèm lý do trong Debug.

## 8. Tên nhân vật, cách xưng hô và cache

Mở **Tùy chọn dịch chương** để đặt số ảnh đồng thời, giới hạn thử lại và bảng tên/
xưng hô. Ví dụ:

> Giữ tên Hikaru. Toxin dịch là Độc. Với hai nhân vật chính, ưu tiên anh/em khi
> ngữ cảnh cho phép; không gộp lời thoại của hai người.

Bấm **Lưu tùy chọn chương** trước khi dịch. Gemini được cung cấp bảng tên và phần
ngữ cảnh đã dịch trước đó có giới hạn; bạn vẫn cần đối chiếu xưng hô trong lời
thoại khó hoặc ảnh được xử lý song song.

Cache phân biệt nội dung ảnh, model, ngôn ngữ nguồn/đích và phiên bản prompt/OCR/
bảng tên. Khi đổi các đầu vào này, kết quả cũ có thể không được áp dụng cho cấu
hình hiện tại. Sau khi chương đã xong, dùng **Dịch với cấu hình hiện tại** để xử
lý theo cấu hình đang chọn; cache hợp lệ cùng cấu hình vẫn được tận dụng.

Khi reload, quay lại chương hoặc DOM bị tạo lại, extension tìm cache và xác minh
nguồn ảnh trước khi phục hồi. Bước này có thể tải lại ảnh để kiểm tra hash nhưng
không gọi Gemini. Cần giữ quyền miền ảnh và nguồn còn truy cập được. Cache có thể
chưa hiện nếu CDN không cho tải lại, nguồn ảnh đổi nội dung hoặc cấu hình không khớp.

**Xóa cache chương** xóa dữ liệu lưu cho chương hiện tại theo thao tác của bạn.
Muốn giữ bản dịch, hãy dùng Ẩn bản dịch thay cho nút này. Cache thuộc bản cài và
profile trình duyệt; gỡ extension/xóa dữ liệu profile có thể làm mất dữ liệu.

## 9. Canvas, ảnh nội bộ và CDN cần đăng nhập

Dịch toàn chương cần truy cập lại nguồn của từng ảnh đã thu thập. Canvas hoặc
blob nội bộ có thể chỉ tồn tại trong trang đang xem; extension giữ metadata nhưng
không tự chụp và lưu bitmap của từng trang trong giai đoạn thu thập.

Các ảnh không truy cập lại được được đánh dấu riêng và có thể báo lỗi trong hàng
đợi. Dùng phần **Dịch riêng ảnh đang xem** → **Dùng ảnh chụp vùng hiển thị** cho
trang hiện tại, bấm Dịch rồi giữ tab đứng yên trong lúc chụp. Chỉ phần ảnh đang
thấy được gửi; không thể dùng ảnh chụp hiện tại để dịch các trang canvas trước đó.

Ảnh CDN yêu cầu cookie/Referer riêng hoặc redirect có thể không tải được bằng
đường tải nguồn của extension. Không tự động gửi cookie hay key cho CDN. Dùng
chế độ dịch riêng bằng screenshot khi phù hợp; không coi ảnh lỗi là đã dịch xong.

## 10. Build source trên Windows

Cần Node.js >=22.12 và npm. Giải nén source sao cho thư mục
`D:\Manga-Translator-Pro` chứa trực tiếp `package.json`, `src`, `tests`.
Nếu ZIP có thư mục bao ngoài, mở đúng cấp có package.json.

```powershell
cd D:\Manga-Translator-Pro
npm ci
npm run build
```

Sau build, Load unpacked thư mục:

```text
D:\Manga-Translator-Pro\.output\chrome-mv3
```

Không chọn cả thư mục source hoặc file ZIP trong hộp thoại Load unpacked. Bản build
sẵn có manifest.json riêng; thư mục `.output\chrome-mv3` là kết quả khi tự build source.

Các script kiểm tra hiện có:

```powershell
npm run lint
npm run typecheck
npm run test
npm run build
npx playwright install chromium
npm run test:integration
```

Hoặc `npm run check` để chạy chuỗi kiểm tra. Test tự động dùng Gemini mô phỏng.
Đặt `CHROMIUM_PATH` nếu cần chọn executable phù hợp trên máy kiểm thử.

## 11. Kiểm tra thủ công trước khi dùng chương dài

Từ source chạy `npm run fixtures`, giữ Terminal mở. Mở
`http://127.0.0.1:4173/tracking.html` trong Cốc Cốc và dùng extension đã cài:

1. Bật quyền website, bắt đầu thu thập, cuộn qua các ảnh tải được rồi kết thúc.
2. Kiểm tra danh sách và bấm Dịch toàn bộ với key/model của bạn. Thao tác này gọi
   Gemini thật và dùng quota; trang fixture không tự gọi API.
3. Sau khi có kết quả, cuộn ngược, resize, ẩn/hiện bản dịch và thử hai chế độ nền.
4. F5 trang, kiểm tra các bản dịch phù hợp được khôi phục từ cache mà không OCR lại.
5. Chuyển sang URL/chương khác để kiểm tra dữ liệu cũ không gắn nhầm ảnh.
6. Thử reader fixed/long-strip bằng các fixture trong COMIX_VALIDATION.md.

Tracking Lab trong Tùy chọn có **Bật vùng chữ giả lập** để kiểm tra hình học độc
lập; vùng giả lập không chứng minh rằng Gemini thật đã dịch đúng. Với Comix thật,
đọc cả báo cáo giới hạn môi trường và tự kiểm chứng trên Cốc Cốc Windows của bạn.

## 12. Khi gặp lỗi

Ghi lại version extension/browser, URL chương, chế độ reader, model, số ảnh phát
hiện/hoàn thành/thất bại và thông điệp lỗi. Mở Debug để xem kích thước, phương pháp
và lý do bỏ qua ảnh. Không gửi API key, cookie hoặc URL ảnh có query ký khi báo lỗi.

Nếu chưa thấy nút nổi: kiểm tra quyền website, đợi ảnh tải, F5, rồi thử popup.
Nếu không phục hồi cache: kiểm tra cấu hình và quyền miền CDN, đợi bước xác minh
ảnh, mở danh sách để xem trạng thái. Nếu chưa thu thập đủ: chọn Tiếp tục thu thập,
đi qua ảnh còn thiếu và kết thúc lại. Không xác nhận đã đủ chương chỉ từ bộ đếm.
