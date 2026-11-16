# Kiểm thử Image Discovery — Manga Translator Pro 0.3.0

Ngày chạy: 2026-11-15. Workspace: `/workspace/manga-translator-pro`.
Node 24.22.1, npm 11.9.0, WXT 0.21.5, TypeScript strict, Chromium
156.0.8078.79 headless trên Linux. Không phải Cốc Cốc/Windows.

## Kết quả thực chạy

| Kiểm tra | Kết quả |
| --- | --- |
| npm run lint | PASS, 0 warnings |
| npm run typecheck | PASS |
| npm test | 179 PASS, 9 files |
| npm run build | PASS, `.output/chrome-mv3/manifest.json`, version 0.3.0 |
| npm run test:integration | 57 PASS, 3 SKIP, 0 fail/flaky; 40,7 giây |
| Geometry metrics | 27 bài có số đo; sai số lớn nhất **0,25 CSS px** |
| SHA-256 Gemini/schema/settings/credentials/job store | 5/5 khớp baseline trước sửa |

Số đo chi tiết: [image-discovery-030-metrics.json](assets/image-discovery-030-metrics.json).
Ảnh minh chứng fixture: [comix-fixture-030.png](assets/comix-fixture-030.png).

Các kiểm tra Gemini dùng phản hồi mô phỏng có schema, không dùng key thật, không
đo độ chính xác OCR/dịch của model thật. Sai số geometry là sai số chiếu box đã
biết, không phải độ chính xác box do Gemini nhận diện.

## Nguyên nhân và chứng cứ

Mã cũ chỉ khám phá `document.images`. Bộ chọn ảnh lại gọi `measureImage()`, hàm
này trả null cho img hoặc **bất kỳ ancestor fixed/sticky**. Discovery tìm thấy
ảnh vẫn không đồng nghĩa currentImage chọn được ảnh. Transform `matrix3d` bị
loại toàn bộ, kể cả translate3d/scale không xoay.

HTML Comix đúng URL trả title “Marriage Toxin · Ch.186”; ảnh được JS render nên
HTML ban đầu không có img. CSS/JS công khai được kiểm tra cho thấy:

- `.rpage` có `position:fixed; overflow:hidden`.
- `.rpage-main` absolute; chế độ long-strip dùng overflow auto/visible.
- `.rpage-page__img` là thẻ img, width/height 100%, object-fit contain.
- Có Swiper zoom container/target và lazy rendering của từng page.

Chính sách fixed ancestor của mã cũ mâu thuẫn trực tiếp cấu trúc này. Đã tạo
regression fixed reader scale .5; chạy trên mã trước sửa: **FAIL**, currentImage
không có ảnh. Sau sửa, fixture generic và fixture cấu trúc Comix đều PASS. Không
có điều kiện URL/domain/class Comix trong code production.

## Phạm vi browser đã kiểm thử

- Single page trong fixed container, site scale 50%, translate3d; scroll tài liệu
  lên/xuống phía sau reader; chỉ một layer đúng ảnh.
- Long-strip, nested scroll, 100 vị trí scroll hai chiều, wheel khi đang chuyển
  động, layout shift, responsive resize, padding/border và nguồn ảnh đổi.
- Lazy native/delayed src, insert/remove, srcset và picture/source thay đổi.
- Ảnh trùng URL ở hai DOM instance vẫn giữ binding riêng.
- Slide inactive bị hidden hoặc che bởi slide active không được chọn nhầm.
- Object-fit contain/cover, object-position 25%/75%, positive transforms,
  independent scale, CSS zoom trên ancestor và html.
- Background single URL, contain/cover/position; probe kích thước bất đồng bộ.
- Canvas DOM và canvas tainted: discovery không cần đọc pixel.
- Chụp PNG thật bằng Playwright ở DPR 1/1,25/1,5/2; crop vùng ảnh đã bị clipping,
  decode/encode PNG, gọi adapter Gemini giả lập, map kết quả về toàn ảnh, overlay
  trong sai số <=2 CSS px. Kích thước gửi nhỏ hơn screenshot toàn viewport.
- Unit: tỷ lệ bitmap khác DPR, làm tròn crop vào trong, clipping, map box,
  hình học sai/ảnh quá lớn/pinch zoom, tab active thay đổi, capture failure và cleanup.
- Capture session: geometry đổi trong lúc chụp bị loại, canvas redraw/keydown
  vô hiệu hóa kết quả và khôi phục overlay.
- Pinch zoom bằng CDP được loại rõ ràng; phục hồi về 100% thì chọn/track lại.
- Popup Debug hiển thị counts/sizes/method/reason; ảnh blob buộc explicit capture,
  không xin quyền CDN; mở popup không tự dịch.
- Luồng tải ảnh → Gemini HTTP mô phỏng → parse schema → normalized regions → overlay
  chạy qua fixture có cấu trúc fixed Swiper/object-fit tương tự Comix.
- Hồi quy lỗi key/quota/permission/timeout/invalid JSON/cancel/stale source và
  long-image tiling; không tạo overlay giả khi provider/CDN lỗi.
- Production manifest MV3 minimal permissions, runtime entrypoint/assets tồn tại;
  Tracking Lab bundle production chạy qua HTTP, local assets, không root trùng.

## Chưa kiểm chứng trực tiếp

**Comix browser:** thử mở URL người dùng bằng Chromium Playwright, giữ nguyên TLS,
nhận `net::ERR_CERT_AUTHORITY_INVALID`. Curl tải public HTML/assets thành công,
nhưng điều đó không thay thế phiên reader live. Không bỏ kiểm tra chứng chỉ.

**Cài MV3/native API:** Chromium có chính sách quản lý
`ExtensionInstallBlocklist=["*"]`, nên 3 bài load unpacked/service worker,
`tabs.setZoom` thật và popup cài extension được SKIP. Không thay đổi chính sách.
`captureVisibleTab` thật chưa chạy trong cloud; đã kiểm thử orchestration bằng
mock tabs API và xử lý bitmap bằng screenshot thật của Playwright.

**Cốc Cốc Windows 11:** không có trong môi trường. Native browser zoom, Windows
DPI và capture API cần chạy theo [COMIX_VALIDATION.md](COMIX_VALIDATION.md).
Chưa gọi Gemini thật vì không có key của người dùng. Vì vậy chưa tuyên bố đã
nghiệm thu thành công Comix/Cốc Cốc; đây là bản sửa đã qua fixture và regression.

## Giới hạn cần giữ rõ

Không hỗ trợ rotation/skew/perspective/flip, transform trên html, clip-path/mask,
pinch zoom, iframe/website Shadow DOM, background nhiều lớp/image-set/repeating
small tiles hoặc object-position calc/edge offsets phức tạp. Debug ghi lý do.

Canvas tĩnh được hỗ trợ qua screenshot. Mẫu fingerprint readable canvas không
thể chứng minh mọi thay đổi pixel; canvas tainted chỉ có thể dùng input/DOM binding
để loại trang cũ. Không đảm bảo tainted canvas tự redraw/lật trang không có input.
Chụp chỉ dịch vùng đang thấy, không giả vờ đã OCR phần ảnh ngoài viewport.

## Tái chạy

```powershell
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:integration
```

Hoặc `npm run check`. Chọn `CHROMIUM_PATH` khi cần executable hệ thống. Fixture
server tự khởi động trong Playwright. Dùng `npm run fixtures` cho kiểm tra tay.
Báo cáo cũ được giữ ở PHASE1_TEST_REPORT.md, PHASE2_020_TEST_REPORT.md và
PHASE2_021_TEST_REPORT.md; không dùng phạm vi hỗ trợ cũ để mô tả 0.3.0.
