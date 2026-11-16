# Báo cáo kiểm thử Manga Translator Pro 0.5.0

Ngày16/11/2026, Asia/Saigon. Linux cloud, Node24.22.1, npm11.9.0, WXT0.21.5,
TypeScript strict, Chromium156.0.8078.79 headless. Không phải Cốc Cốc Windows.

## Kết quả cuối

| Lệnh/kiểm tra | Kết quả |
| --- | --- |
| `npm run lint` | PASS,0 warning |
| `npm run typecheck` | PASS |
| `npm test` | **343 PASS /23 files** |
| `npm run build` | PASS, ManifestV3 version0.5.0 tại `.output/chrome-mv3` |
| `npm run test:integration` | **103 PASS,3 SKIP,0 fail,0 flaky** /106 cases;112,34giây |
| `npm run benchmark` | PASS; mặc định thiếu observations thì unmeasured |
| CLI với renderer observations | PASS; chỉ chấm các mục có bằng chứng rendering |
| Geometry trong browser fixtures | Max **0,25 CSS pixel**, dưới mục tiêu2CSSpx |

[Số đo chi tiết](assets/v050-metrics.json), [benchmark JSON](assets/v050-multilingual/renderer-report.json).
Logs lần chạy cuối có trong gói report. Test harness không nằm trong build runtime.
Không có Gemini key thật; provider tests dùng HTTP mock/transport adapter.

## Những gì đã kiểm thử

| Hạng mục | Chứng cứ/kết quả |
| --- | --- |
| Flow cả chương | Thu thập không gọi provider; atomic Dịch AI chốt rồi dịch; queue cũ/checkpoints vẫn hoạt động |
| Toolbar gọn/progress riêng | Trusted click, counter, drag, đóng toast không hủy, lỗi/hoàn thành và viewport390px |
| Polygon/metadata | Schema nullable, confidence riêng, invalid/crossing/out-of-bbox bị từ chối; tile/capture/cache/edit roundtrip |
| Nền và font | Dark/light/adaptive/original, màu fallback, polygon clipping, auto-fit và cờ font<8px riêng |
| Low location confidence | Ẩn ngoài edit; không dùng OCR confidence cao để hợp thức hóa vị trí thấp |
| Sửa chữ/bbox/polygon | Lưu→reload→reset, raw OCR không bị đổi, synthetic event không gọi API |
| Bản nháp editor | Đổi vùng giữ form hợp lệ; ẩn vùng thêm→preview→save không lỗi |
| Crop thật trong browser | Nguồn400×640, chỉ gửi crop PNG408×213;1 request thêm; giữ vùng ngoài crop |
| Cache crop | Cùng rectangle pixel dù số thực khác nhau không tạo request trùng; Save giữ chính xác polygon/bbox nguồn |
| Rà soát chữ | Explicit review tạo2 request/ảnh một tile, thêm vùng SFX thiếu, dedup vùng cũ |
| Hủy/timeout crop | Controller/UI giữ phản hồi, Close/Escape không chờ provider; active/queued/preparation cancel và TIMEOUT được unit-test |
| Kết quả muộn | Đóng editor/đổi nguồn/chương/xóa cache không áp dụng crop/override sai; revision conflict bị từ chối |
| Tương thích0.4 |50 legacy entries trong IndexedDB, reload/quick translate giữ profilev1,0 Gemini request; DB tên/version không đổi |
| Tracking | Cuộn100 vị trí, wheel đang di chuyển, nested scroll, layout shift, resize, CSS zoom, DPR1,25/1,5/2 |
| Reader | Fixed50%, long-strip/lazy, Swiper-style Comix fixture, picture/srcset/background/canvas/tainted |
| Không trùng/sai ảnh | Idempotent apply, alias content-flight, hai DOM cùng ảnh, recycled source và SPA guards |
| Không sửa layout | Oracle DOM bounds/attributes, một Shadow DOM root, pointer-none ngoài edit |
| Key privacy | Trusted storage, sender/context guards, DB whitelist, không copy key trong snapshot/public errors |

7 bài editor browser PASS.21 unit tests về crop control/background PASS nằm trong
343 bài tổng;4 bài RegionReprocessor kiểm tra profile/crop cache/late deletion.
Lỗi phát hiện khi phát triển đã được sửa trước lần chạy cuối: UI làm tròn tọa độ
làm polygon lệch bbox, cache crop tách do số thực, model/source đổi nhưng ghi nhầm
profile, cancel bị kẹt sau request crop, public error bị đổi thành INTERNAL, mất
nháp khi đổi vùng và không lưu được sau khi ẩn vùng thêm.

## Số đo hiệu năng và benchmark

| Trường hợp | Kết quả đo thực trong fixture |
| --- | --- |
|50 ảnh pipeline tải/hash/decode/PNG/IDB + mock HTTP |2.402,65ms;50 initial requests; tối đa2 đồng thời |
| Reload sau50 ảnh | Cache restore qua xác minh bytes; không gửi lại50 request Gemini |
|100 metadata ảnh |132,44ms để thu thập; chỉ2 DOM ảnh trong fixture pipeline này |
|100 ảnh pipeline + mock HTTP |5.910,23ms;100 requests; quan sát tối đa1 đồng thời trong lần này |
| JSON metadata100 ảnh |79.691bytes; không phải RAM |
| Hai URL cùng bytes | Chỉ1 Gemini request ban đầu |
|35 ảnh có5 lỗi |30 completed/5 failed; Retry chỉ gửi lại5 ảnh lỗi |
|4 ảnh EN/JA/ZH/KO tổng hợp | Discovery4/4;16 annotated regions; box error<0,001CSSpx |
| Overflow của16 vùng mẫu |0/16; font<8px0/16 |
| JS heap mẫu multilingual |4.663.868bytes; JSON metadata8.246bytes, hai đại lượng khác nhau |

Các số thời gian chỉ là fixture cục bộ với mock HTTP, không là tốc độ Gemini,
native IPC, quota/billing, CDN thực hoặc peakRAM. Heap CDP là sample của page,
không gồm decoded images/GPU/offscreen/process RAM. Bài100 ảnh không chứng minh
100 DOM ảnh đồng thời; các bài collector/scroll riêng dùng50 DOM ảnh.

Text Region Detection Recall, OCR/CER, Translation Quality và thời gian dịch
Gemini thật vẫn **unmeasured**. Cache hit rate tổng quát và reference throughput
chưa có telemetry đầu vào cho benchmark CLI; các regression chứng minh một số
đường restore không gọi lại provider, không tự biến thành tỷ lệ hit toàn sản phẩm.
Mock annotations không được chấm như detector/OCR thật, kể cả khi có điểm giả5/5.

## Ảnh review

- [Toolbar và thẻ tiến trình](assets/v050-reference-like-controls.png): UI thật trên fixture.
- [Editor ở viewport390px](assets/v050-editor-after.png): sau lưu/reload/reset.
- [Anh trước](assets/v050-multilingual/en-before.png) / [sau annotation overlay](assets/v050-multilingual/en-after.png).
- [Nhật trước](assets/v050-multilingual/ja-before.png) / [sau annotation overlay](assets/v050-multilingual/ja-after.png).
- [Trung trước](assets/v050-multilingual/zh-before.png) / [sau annotation overlay](assets/v050-multilingual/zh-after.png).
- [Hàn trước](assets/v050-multilingual/ko-before.png) / [sau annotation overlay](assets/v050-multilingual/ko-after.png).

Before/after dùng artwork gốc của dự án và ví dụ tiếng Việt/GT có sẵn. Không phải
kết quả OCR/dịch thật hoặc ảnh/reference artwork được sao chép.

## Những phần chưa nghiệm thu

Chromium cloud có `ExtensionInstallBlocklist=["*"]`.3 bài native bị SKIP gồm
Load unpacked/MV3, `tabs.setZoom`80/100/125/150% và popup cài thật. Không thay đổi
chính sách máy để chạy. Production bundle có chạy qua HTTP/browser và adapter dùng
cùng module production/IndexedDB thật, nhưng không thay thế installed extension.
`captureVisibleTab`, worker restart native, host registration và đóng popup thật
vẫn cần Cốc Cốc/Chrome trên máy người dùng.

Lần thử Comix trong cùng quá trình phát triển gặp `ERR_CERT_AUTHORITY_INVALID`.
Giữ TLS validation; dùng fixture fixed Swiper ở zoom reader50%. Vì vậy chưa tuyên
bố sửa thành công/đạt tracking trên **Comix live/Cốc Cốc Windows**. Browser zoom API
thật bị skip; kết quả CSS zoom/DPR không được gọi là kết quả `tabs.setZoom`.

Đã đọc listing công khai và xem năm ảnh Web Store cùng ảnh người dùng. Chưa cài
extension tham khảo. Video tải lên vượt giới hạn32MiB nên chưa xem; không có dữ
liệu so sánh timing/chất lượng trên cùng ảnh. Không khẳng định parity100%.

Chưa có inpainting hoặc detector/OCR local/cloud bổ sung đã tích hợp. Schema có
polygon/hướng chữ/confidence và review pass không chứng minh model nhận diện mọi
chữ dọc/nghiêng/nhỏ. Mục tiêu2CSSpx ở đây là **sai số chiếu vùng có tọa độ đúng**,
không là cam kết Gemini đặt bbox đúng2px so với chữ thật.

## Tái chạy và kiểm tra tại máy bạn

```powershell
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:integration
npm run benchmark
```

`npm run check` chạy5 bước chính. Xem [hướng dẫn Cốc Cốc](V050_USER_GUIDE.md) cho
cập nhật giữ cache, cấp quyền, dịch/crop và kiểm chứng Comix; [giới hạn](V050_LIMITATIONS.md)
cho hình học/typesetting chưa hỗ trợ. Báo cáo0.4 lưu tại PHASE4_040_TEST_REPORT.md.
