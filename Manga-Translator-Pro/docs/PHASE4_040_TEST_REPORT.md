# Báo cáo kiểm thử Manga Translator Pro 0.4.0

Ngày 16/11/2026, múi giờ Asia/Saigon. Môi trường Linux cloud, Node 24.22.1,
npm 11.9.0, WXT 0.21.5, TypeScript strict, Chromium 156.0.8078.79 headless.
Không phải Cốc Cốc Windows.

## Kết quả cuối cùng

| Lệnh | Kết quả |
| --- | --- |
| npm run lint | PASS, 0 warning |
| npm run typecheck | PASS |
| npm run test | **255 PASS / 15 files** |
| npm run build | PASS, manifest 0.4.0 tại `.output/chrome-mv3` |
| npm run test:integration | **87 PASS, 3 SKIP, 0 fail, 0 flaky**; 79,50 giây |
| Tracking geometry | Sai số lớn nhất **0,25 CSS px** trong các fixture có oracle |

Số đo: [v040-metrics.json](assets/v040-metrics.json). Test harness không có trong
build runtime. API dùng key giả và phản hồi Gemini mô phỏng, không dùng quota thật.

## Benchmark đã đo

| Trường hợp | Kết quả |
| --- | --- |
| 50 ảnh: tải/hash/decode/PNG/queue/IDB + mock Gemini | 2.005 ms, 50 requests, tối đa 2 đồng thời |
| Reload sau 50 ảnh | Khôi phục overlay qua byte verification; vẫn 50 Gemini requests |
| Thu thập 100 metadata ảnh | 92,38ms |
| 100 ảnh pipeline + mock Gemini | 4.090 ms, 100 requests, tối đa 2 đồng thời |
| JSON manifest/metadata 100 ảnh | 79.666 bytes |
|35 ảnh, 5 lỗi |30 completed / 5 failed; thử lại chỉ 5 lỗi, tổng 40 requests |
|2 URL khác nhưng cùng bytes |2 records completed / chỉ 1 Gemini request |

Đây là benchmark fixture cục bộ với nguồn SVG 400×640 và mock HTTP chờ 8 ms, không
là tốc độ Gemini thật, native extension IPC, peak RAM, throughput website/CDN
hay quota thực tế.100 metadata chỉ có 2 ảnh DOM trong pipeline fixture; các bài
collector riêng dùng 50 ảnh DOM. Không lưu bitmap trong IndexedDB; raster release
sau từng ảnh, giới hạn 2 runner. Chưa khẳng định mức dùng RAM của manga ảnh cực lớn.

## Coverage theo yêu cầu

| Yêu cầu | Chứng cứ tự động |
| --- | --- |
| Thu thập 50 ảnh/chương | Registry unit + controller/browser + pipeline HTTPmock |
| Cuộn hết rồi ngược lên |50 ảnh, cuộn hai chiều, không thêm provider calls |
| Ảnh xuất hiện muộn | Observer/lazy +metadata còn sau xóa DOM |
| DOM hủy/tạo lại | Binding mới,cache restore đúng source, từ chối binding cũ |
| Resize/transform/layout shift | Existing geometry +tracking v2 và chapter browser |
| Browser zoom 80/100/125/150 | CSS zoom/DPR fixture PASS; native tabs.setZoom SKIP |
| Đổi chapter khi đang dịch | Epoch/profile/chapter guard và fixture SPA |
| Đóng popup | Queue không phụ thuộc UI; test đóng client adapter; popup cài thật chưa test |
| MV3 worker restart | Recreate service adapter giữ executor;checkpoint executor recreation; native restart chưa test |
| Gemini 429 | Retry-After, exponential backoff và cooldown; không dừng các ảnh khác |
|30 thành công, 5 lỗi | Unit scheduler +HTTP mock pipeline 35 ảnh |
| F5 sau dịch | IndexedDB reload và hash verification; không gọi Gemini lại |
| Hai DOM cùng URL | Một result, hai overlay instances độc lập |
| Fixed reader đổi trang | Giữ URL đã thấy, khôi phục 4 trang; fixture cấu trúc Comix |
| Long-strip | Reader/nested scroll/lazy và 50 ảnh |
| Không dịch trùng | ID/inflight/hash flight/COMPLETED cache; aliases có bytes giống nhau |
| Không overlay trùng | Một root,đúng binding, lặp apply cùng result không replace node |
| Chapter identity đúng | Canonical URL/SHA-256/query/hash route/incarnation tests |
| Cache đúng profile | Phân biệt model, language, prompt, OCR, glossary, hash và chapter |
| Xóa cache và late answer | Incarnation và image/cache guards, kể cả cùng createdAt |
| Cache write lỗi | Dừng dispatch/pause, không tiếp tục trả phí cho phần còn lại |
| Website giả click nút nổi | Synthetic click/change không collect/translate/clear; real click vẫn chạy |
| Key privacy | Credential/API key tests, DB allowlist và RPC không copy key |

Các vấn đề phát hiện và sửa trong vòng kiểm tra: stale collection chèn ảnh sau
queue start, cacheclear cùng clock tick, cache-key ownership xuyên chapter, hash đổi
nhưng ảnh cònCOMPLETED, late result saucancel/profilechange, UI synthetic events,
apply cache trùng làm remount lớp chữ, thu thập/restore tốn quét timer. Test resize
UI đợi event xử lý trước đo bounds; oracle tracking ghi số đo đã đạt điều kiện.

## Giới hạn môi trường

Thử mở đúng URL Comix bằng Chromium giữ nguyên TLS nhận:
`net::ERR_CERT_AUTHORITY_INVALID`. Không tắt kiểm tra chứng chỉ. Fixture dùng ảnh
truyện tổng hợp, không dùngchapterasset/tài khoản của người dùng.

Chromium của môi trường có `ExtensionInstallBlocklist=["*"]`. Ba bài native
MV3/load unpacked, tabs.setZoom và popupinstall bị SKIP. Không sửa chính sách hoặc
đổi browser để vượt chính sách. Vì vậy chưa kiểm chứng actual ChromeAPI trong
installed extension như captureVisibleTab, worker restart, popup close, programmatic
hostregistration. Test pipeline dùng cùng các module production với transport
adapter và IndexedDB thật trong browser, không đồng nhất với installed MV3.

Không có Cốc Cốc Windows, không có Gemini key thật. **Chưa tuyên bố nghiệm thu
thành công trên Comix/Cốc Cốc hoặc đo OCR/dịch thật.** Xem V040_USER_GUIDE.md để
kiểm chứng tại máy bạn và V040_LIMITATIONS.md cho phạm vi còn thiếu.

## Tái chạy

```powershell
npm ci
npm run lint
npm run typecheck
npm run test
npm run build
npx playwright install chromium
npm run test:integration
```

Hoặc `npm run check`. CHROMIUM_PATH chọn browser hệ thống khi cần. Fixtureserver
được Playwright quản lý; `npm run fixtures` phục vụ kiểm thử thủ công. Kết quả
cũ 0.3.0 lưu tại PHASE3_030_TEST_REPORT.md, không dùng thay báo cáo này.
