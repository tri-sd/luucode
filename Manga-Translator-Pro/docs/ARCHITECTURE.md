# Kiến trúc 0.5.0

## Phần bổ sung 0.5.0

Nâng cấp trên module chương/tracking0.4, giữ định danh, collector và queue.
`FloatingTranslatorController` có toolbar counter/Dịch AI và progress toast riêng.
`quick-translate` thực hiện flush → finish nếu collecting → translate trong cùng
lệnh; lỗi ở bước trước ngăn bước sau.

Pipeline: acquisition → decode/tile/upscale crop → Gemini Vision adapter (text
detection/OCR/translation trong một request có schema) → validation/layout → map
về nguồn → cache → renderer. Review là một lượt thêm/tile, mặc định không bật.
Adapter chưa có detector local hoặc inpainting; không giả lập các engine đó.

`RegionMetadata` giữ polygon/kind/direction/confidence OCR và vị trí riêng qua
schema, tile/capture, IPC, DB và overlay. Polygon3–16 điểm hữu hạn [0,1], trong
bbox, không tự cắt. Điểm chưa biết giữ null, không giả định đã hiệu chuẩn. Low
position confidence<0,5 chỉ hiện trong edit mode. Nền thích nghi dùng median màu
mép crop/variance; đó là fast fill, không xóa chữ bằng inpainting.

`RegionEditor` chỉ chứa dữ liệu public. `userEdits` riêng với raw OCR gồm override
text/bbox/polygon/ẩn và vùng thêm. Snapshot byte-verified; Save kiểm tra source,
profile/hash/chapter incarnation và optimistic revision trong lock. Cache whitelist
giữ metadata, queue checkpoint không xóa edits. Save/reset invalidate rồi restore
vào live bindings. Tọa độ UI làm tròn chỉ để hiển thị, không làm tròn geometry lưu.

`RegionReprocessor` ở offscreen kiểm tra model/language/hash/revision, gửi crop
PNG upscale có giới hạn; cache theo chapter/content/profile/pixel rectangle. Crop
không ghi đè raw page output; editor preview đến khi Save. Deadline180s, có cancel
và guard kết quả muộn. Không thêm manifest permissions.

DB giữ tên `manga-translator-pro-v040`, version1. Chương mới dùng profilev2 với
qualityMode; chương0.4 giữ profilev1 khi standard/model/language/glossary còn khớp.
Không tự gửi API để nâng cấp cache cũ. Benchmark tách live output/mock/renderer,
trả unmeasured khi thiếu dữ liệu provider/reference/người đánh giá.

## Quyết định về detector bổ sung

Chưa có output Gemini thật để kết luận chất lượng đủ hay không. Schema/prompt
không chứng minh detector tốt. Đánh giá bằng dataset có GT và ảnh thực được phép
sử dụng: ghép vùng IoU, CER theo ngôn ngữ, vị trí, thiếu chữ nhỏ/dọc/SFX và người
đánh giá dịch. Chỉ chọn adapter bổ sung sau khi ghi failure cases và baseline.

Contract adapter tiếp theo: input là raster/crop cùng transform nguồn, AbortSignal
và cấu hình trusted; output là vùng chuẩn hóa với polygon tùy chọn, sourceText,
kind/direction và hai confidence nullable. Không trả viewport coordinates. Kết quả
luôn đi qua validator/mapping hiện có; translation nhận sourceText và context, không
tự tạo vị trí khác. Capability khai báo detection/OCR/translation riêng, giữ version
trong profile/cache key để không trộn output engine.

Hai phương án không yêu cầu Python: detector ONNX/WASM trong worker/offscreen với
weights đóng gói được kiểm tra license/size/hiệu năng, hoặc OCR cloud do người dùng
cấu hình riêng. Nhánh detector cung cấp polygon → crop riêng cho recognizer/Gemini;
recognizer trả text không được sửa vị trí đã xác minh. Adapter cloud cần BYOK/quyền
host explicit; không tự gửi ảnh sang bên thứ ba khi Gemini confidence thấp. WASM
chưa có model/weights tích hợp, cloud OCR khác chưa có credentials/endpoint; cả hai
là thiết kế mở rộng, không được quảng cáo là tính năng đang hoạt động0.5.

## Tái sử dụng

Giữ WXT/MV3, CredentialStore, JobStore của dịch một ảnh, Gemini JSON schema, decoder,
tilers, validation, source-normalized RegionTracker và Shadow DOM renderer. Pipeline
raster dùng lại cho chương; GeminiClient chỉ thêm reference context và Retry-After,
không đổi endpoint/key header/schema. Không tạo backend/inpainting.

## Trách nhiệm các module

| Module | Trách nhiệm |
| --- | --- |
| ChapterSessionManager | Chapter URL/ID, incarnation, document IDs, trạng thái, options/profile |
| ImageRegistry | Metadata ảnh theo nội dung nguồn, thứ tự đọc, source URL mới, dedup |
| ChapterCollector | Metadata ảnh đã thấy/pending; không giữ DOM/bitmap hoặc gọi provider |
| ChapterContentController | SPA/lifecycle, thu thập, sync, lazy cache restoration theo live bindings |
| TranslationQueue | Checkpoint, concurrency, trạng thái ảnh, retry/backoff, ownership |
| ChapterExecutor | Trusted offscreen: tải/hash/decode/tile/Gemini, dedup theo hash |
| IndexedDBCache | Chapter manifest, image metadata và validated translation entries |
| ProgressStateManager | Số tổng/chờ/đang chạy/hoàn thành/lỗi/hủy và phần trăm từ dữ liệu thật |
| RegionTracker / coordinate mapper | DOM binding, source generations, normalized box → painted source |
| TextOverlay / FloatingTranslatorController | Lớp chữ và điều khiển tiếng Việt trong Shadow DOM |
| ChapterBackground / RPC | Kiểm tra sender/tab/document, quyền website/CDN, orchestration |

## Danh tính và cache

Chapter ID là SHA-256 URL canonical, giữ chapter path/query/hash route. Chỉ bỏ
tracking query và dấu vị trí đọc đã biết; page query chỉ bỏ khi URL nhận diện
chapter rõ ràng. URL không rõ nghĩa được giữ để tránh gộp sai chương.

Image ID gồm chapter + canonical source + natural dimensions, thêm sampled
fingerprint khi canvas đọc được. Chỉ bỏ thông số ký của AWS/Google/CloudFront đã
biết; không xóa token/id/page query tùy tiện. Source identity không phải DOM ID.
Hai phần tử cùng ảnh dùng chung registry/result, có binding/render layer riêng.

Khi tải, bytes Blob được SHA-256 trong trusted context. Cache key gồm chapter,
content hash và profile (model, ngôn ngữ, target vi, OCR/prompt version, glossary
version). Alias khác URL nhưng cùng bytes được dedup bằng shared content flight.
Không gộp cache xuyên chapter vì context lời thoại có thể khác.

IndexedDB extension-origin có `chapters`, `images`, `translations` và index chapterId.
Không lưu key hoặc bitmap/base64. Metadata/result không tự xóa khi DOM biến mất.
Web Locks theo chapter bảo vệ read-modify-write giữa worker/offscreen. Cache deletion
là transaction; incarnation ngẫu nhiên ngăn late result hồi sinh cache vừa xóa,
kể cả createdAt trùng nhau. queueOwner/profile/epoch bổ sung guard khi cancel/restart.

## Thu thập và khôi phục

Content được inject sau activeTab hoặc đăng ký động cho origin đã cấp optional
host permission. Auto-detection không tự xin quyền hoặc gọi Gemini. Nút chỉ xuất
hiện khi có candidate. Các action tốn API/xóa cache từ floating UI yêu cầu trusted
user events; JavaScript website không thể kích bằng button.click() tổng hợp.

Thu thập chỉ bắt đầu sau action collect. Observation gồm source/dimensions/method,
DOM binding/document token và semantic page ordinal khi có. First-seen là reading
order fallback, không phải identity. Registry lock kiểm tra lại incarnation/status,
không để observation muộn chèn DISCOVERED sau khi queue đã bắt đầu.

Restore gần viewport, batch12, sau candidate mới/nguồn đổi/progress đổi/scroll.
Background tải/hash tối đa2 nguồn để kiểm tra cached bytes cho binding mới, không
OCR lại. Nguồn không truy cập được không tự giả định là cache còn đúng. Hash đổi
thì image trở lại DISCOVERED, giữ entry cũ để người dùng chủ động dịch nguồn mới.
Thông số ký đổi cập nhật URL truy cập mà không làm mất danh tính canonical.

Result được apply vào đúng live binding. Chỉ cache bbox normalized [0,1]. Render
đo painted source theo object-fit/position/transform, clip theo viewport/scroll
ancestors và cập nhật bằng rAF. Layer fixed bám viewport; layer thường bám document.
Apply dữ liệu giống nhau là idempotent, không thay node/font-fit khi cuộn.

## Hàng đợi và MV3

Background giữ quyền/key và relay command; offscreen giữ executor độc lập popup.
Một executor sở hữu queue đang chạy; chỉ tối đa2 ảnh/request Gemini cùng lúc.
Single-image job và chapter queue không được chạy chồng. Đổi chapter sẽ pause và
chờ/đòi thử lại nếu chapter trước còn request đang chạy, giữ giới hạn toàn extension.

DISCOVERED → QUEUED → FETCHING → OCR_PROCESSING → TRANSLATING → RENDER_READY → COMPLETED.
OCR/translation dùng cùng request Gemini; stages phản ánh tải/nhận diện/xử lý kết
quả, không giả lập hai provider riêng. Ảnh không có chữ là completed với regions rỗng.

Mỗi ảnh lưu attempts, nextAttemptAt, error và result cache pointers. Retry chỉ cho
QUOTA/NETWORK/TIMEOUT, tối đa1–3 attempts, exponential backoff+jitter, Retry-After,
429 giảm concurrency và cooldown. Lỗi schema/auth/nguồn không retry vô hạn. Hết ảnh
chờ thì kết thúc với số thành công/thất bại riêng. Cache ghi lỗi thì dừng dispatch.

Pause ngừng request mới; request đang chạy được phép lưu kết quả. Cancel abort và
loại late answer. Đóng popup không ảnh hưởng queue. Worker restart dùng offscreen
đang sống; không recover lại request live. Nếu executor thực sự mất, recover chuyển
checkpoint dở sang chờ/paused; người dùng Resume với key hiện tại. Không khẳng định
request mạng có thể sống xuyên suspension hoặc provider không tính phí request mơ hồ.

Context gửi vào prompt gồm glossary và tối đa4 ảnh thành công đứng trước, được
bounded và đánh dấu reference data; chỉ nhận diện/định vị chữ của ảnh đang gửi.
Concurrency2 có nghĩa hai ảnh đầu có thể chưa có context của nhau. Không coi đây
là bảo đảm chất lượng OCR/xưng hô của model thật.

## Quyền và credentials

Không tăng quyền bắt buộc: activeTab/scripting/storage/offscreen; Google API host
bắt buộc, website/CDN host optional. Người dùng có thể cấp từng site hoặc tất cả.
Programmatic content registration được đồng bộ qua permission events; không thêm
content_scripts toàn mạng vào manifest. Top-frame sender, actual tab URL, document
nonce và source bindings được kiểm tra. Website không gọi RPC private/settings.

Key chỉ local/session TRUSTED_CONTEXTS và transport background→offscreen, không
IndexedDB/chapter/public status/DOM. Fetch CDN credentials omit, không redirect;
provider fixed HTTPS, key header, JSON schema, textContent. Screenshot vẫn chỉ sau
Translate action, ẩn cả overlay/nút nổi, crop trusted trước Gemini, không lưu lâu dài.
