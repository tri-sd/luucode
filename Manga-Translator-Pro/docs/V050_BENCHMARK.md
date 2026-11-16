# Benchmark có bằng chứng — v0.5.0

Bộ benchmark này tách **khả năng đo** khỏi **kết quả đã đo**. Có bộ mẫu và hàm CER
không đồng nghĩa đã đánh giá Gemini hoặc tiện ích tham khảo. Mặc định chạy CLI sẽ
xuất các chỉ số là `unmeasured`, không tự gán điểm hoàn hảo từ dữ liệu mẫu/mock.

## Bộ mẫu gốc

`tests/fixtures/multilingual/dataset.json` mô tả bốn ảnh SVG800×1200 do dự án tạo:

| ID | Ngôn ngữ | Nội dung kiểm tra |
| --- | --- | --- |
| en | Anh | Thoại, narration, chữ nhỏ ngoài bubble, sound effect nghiêng |
| ja | Nhật | Thoại `vertical-rl`, narration, chữ nhỏ và sound effect |
| zh | Trung giản thể | Thoại, narration, chữ nhỏ và sound effect |
| ko | Hàn | Thoại, narration, chữ nhỏ và sound effect |

Có16 vùng được chú thích bằng văn bản nguồn, bbox và polygon chuẩn hóa [0,1] theo
ảnh gốc. Artwork là các panel/hình học đơn giản, không lấy scan manga, logo hoặc
asset của reference. Đây là tập mẫu nhỏ tổng hợp để kiểm tra pipeline và đo lường,
**không đại diện cho độ khó hay độ chính xác trên manga thực tế**.

Chuỗi tiếng Việt trong dataset là ví dụ chưa được người đánh giá thẩm định. Chúng
được dùng để kiểm tra bố cục renderer, không phải đáp án đủ để chấm chất lượng
văn phong/xưng hô. Các polygon là envelope đã biết của fixture, không là output
detector hoặc xác suất đã hiệu chuẩn. Môi trường kiểm thử có các font Noto CJK;
Windows có thể dùng font fallback khác và cần kiểm tra riêng.

## Lệnh chạy

Tạo báo cáo chưa có dữ liệu chạy thật:

```powershell
npm run benchmark
```

Mặc định ghi `work/phase050/benchmark-report.json`. Có thể chọn đường dẫn:

```powershell
npm run benchmark -- --out work/phase050/benchmark-report.json
```

Đánh giá output đã ghi từ một lần chạy có nguồn gốc rõ ràng:

```powershell
npm run benchmark -- --observations work/my-observations.json --out work/my-report.json
```

So sánh trên cùng dataset chỉ khi có output quan sát hợp lệ của reference:

```powershell
npm run benchmark -- --observations work/my-observations.json --reference work/reference-observations.json --out work/comparison.json
```

File reference phải khai báo `provenance.kind: "reference-extension"`. Đây vẫn là
nguồn gốc do người vận hành khai báo; CLI không chứng nhận đã cài hoặc sử dụng
reference. Không xuất phần trăm “parity100%”. Nếu thiếu file reference, báo cáo ghi
`referenceComparison: unmeasured`.

## Định nghĩa chỉ số

| Chỉ số | Cách đo | Khi chưa có bằng chứng |
| --- | --- | --- |
| Image Discovery Recall | Số ID ảnh được phát hiện /4 ID fixture; loại trùng bằng ID | `unmeasured` nếu không có discovery log |
| Text Region Detection Recall | Ghép bbox một-một, IoU≥0,5; không để box trùng tăng recall; báo precision riêng | Chỉ chấm output live-provider/reference, không lấy annotation làm prediction |
| OCR Accuracy | CER = tổng Levenshtein errors / tổng ký tự nguồn; Unicode code points, NFC, trim khoảng trắng ngoài | Không có sourceText OCR thật thì `unmeasured` |
| Translation Quality | Điểm người đánh giá1–5 về đủ nghĩa, tự nhiên, thuật ngữ; ghi tên người đánh giá | Không suy ra từ chuỗi ví dụ, mock, BLEU hoặc sự giống hình ảnh |
| Region Position Error | Max sai số x/y/width/height trong **CSS pixel**, mẫu polygon có Hausdorff riêng | Layer mất được đếm riêng; không dùng sentinel “một triệu pixel” như số đo geometry |
| Text Overflow Rate | Số vùng text tràn / số vùng thực sự được đo; ghi font<8px riêng | Không có DOM samples thì `unmeasured` |
| Cache Hit Rate | Hits / lookups từ telemetry thực, không suy ra từ việc có cache | `unmeasured` nếu chưa log lookup |
| Duplicate API Request Count | Số initial request trùng content/profile/crop key; retry có chủ đích đếm riêng | Không dùng số vùng OCR làm số request |
| Memory Usage | Tách UTF-8 JSON bytes khỏi JS heap sample; không đồng nhất heap với RAM/bitmap/GPU | Peak process RAM luôn chưa đo nếu không có công cụ phù hợp |
| Time to Translate Chapter | FinishedAt−StartedAt của run thực; ghi rõ có provider thật hay mock | Thời gian renderer không được gọi là thời gian dịch chương |

CER giữ khoảng trắng/xuống dòng bên trong theo mặc định, không tự xóa khoảng trắng
để làm đẹp điểm. Hàm pure có lựa chọn bỏ whitespace nhưng CLI không bật lựa chọn
này. Vùng nguồn bị bỏ sót tính là deletion, text dự đoán dư tính là insertion;
CER có thể lớn hơn1. Không có ground truth thì trả `null`, không mặc định đạt100%.

## Định dạng observation

Ví dụ dưới đây chỉ là khung dữ liệu. Phải thay bằng output thực đã thu từ cùng
các ảnh, không chép annotation vào prediction rồi khai báo là kết quả AI.

```json
{
  "provenance": {
    "kind": "live-provider",
    "description": "Ghi rõ cách chạy, model, ngôn ngữ và thời điểm quan sát",
    "model": "gemini-model-id",
    "recordedAt": "YYYY-MM-DDTHH:mm:ssZ"
  },
  "images": [
    {
      "id": "en",
      "regions": [
        {
          "box": { "x": 0.1, "y": 0.2, "width": 0.3, "height": 0.1 },
          "sourceText": "Chuỗi OCR thực của vùng này",
          "translatedText": "Bản dịch thực của vùng này"
        }
      ]
    }
  ],
  "discovery": { "foundImageIds": ["en", "ja", "zh", "ko"] },
  "humanTranslationReviews": [
    { "reviewer": "Tên người đánh giá", "adequacy": 4, "fluency": 3, "terminology": 4 }
  ]
}
```

Ảnh không có chữ phát hiện phải có `regions: []`. Ảnh không có trong `images` là
chưa kiểm thử; báo cáo ghi số ảnh đã kiểm thử để tránh ngầm coi toàn dataset đạt.
Các loại provenance khác: `reference-extension`, `mock`, `renderer-fixture`,
`manual`. Chỉ hai loại đầu là live-provider/reference được tính detector/OCR hoặc
điểm người đánh giá; mock/renderer không được nâng thành bằng chứng AI thật.
Không đưa API key, cookie, screenshot riêng tư hoặc URL có query ký vào file.

Telemetry tùy chọn:

```json
{
  "renderer": {
    "samples": [
      {
        "imageId": "en", "regionId": "en-dialogue",
        "expected": { "x": 100, "y": 200, "width": 160, "height": 80 },
        "actual": { "x": 100.25, "y": 200, "width": 160, "height": 80 },
        "overflow": false, "readable": true
      }
    ]
  },
  "runtime": {
    "cache": { "hits": 8, "lookups": 10 },
    "apiRequests": [
      { "key": "chapter/contentHash/profile/full", "kind": "initial" },
      { "key": "chapter/contentHash/profile/full", "kind": "retry" }
    ],
    "memory": { "scope": "page JS heap sample, not process RAM", "jsHeapUsedBytes": 1200000 },
    "chapter": { "startedAtMs": 100, "finishedAtMs": 2100 }
  }
}
```

Các số trong ví dụ là minh họa định dạng, không là kết quả đã đo. Rectangle
`expected/actual` là tọa độ CSS sau khi render, không phải normalized box hoặc
bitmap pixel. Key request phải chứa scope crop nếu request chỉ xử lý crop.

## Kiểm tra trình duyệt và before/after

Chạy server `npm run fixtures`, mở `http://127.0.0.1:4173/benchmark/index.html`.
Trang chỉ tải asset cục bộ, không tự gọi Gemini. Browser regression riêng:

```powershell
npx playwright test tests/integration/multilingual-v050.spec.ts
```

Bài này dùng annotation đã biết để đặt các ví dụ tiếng Việt lên ảnh. Nó kiểm tra
Image Discovery, chiếu box/polygon, vị trí, font-fit và overflow trong Chromium;
**không chạy OCR hoặc chấm dịch**. Xuất before/after theo từng ngôn ngữ và
`multilingual-render-observations.json` ở thư mục kết quả Playwright, đồng thời ghi
`work/phase050/multilingual-render-observations.json`. Sau khi browser test đạt:

```powershell
npm run benchmark -- --observations work/phase050/multilingual-render-observations.json --out work/phase050/renderer-benchmark-report.json
```

Báo cáo renderer chỉ được đo những mục có bằng chứng renderer; detector/OCR/dịch
thật vẫn là `unmeasured`. Heap sample CDP chỉ của page JavaScript tại thời điểm
đo, không chứng minh peak memory hoặc lượng RAM toàn extension.

## Trạng thái nghiệm thu

Unit tests kiểm tra toán học bằng ví dụ biết trước, không là benchmark model.
Kết quả browser thực chạy được ghi riêng trong báo cáo kiểm thử chung của0.5.0.
Chưa có key thật hoặc output reference trên cùng bộ ảnh thì không công nhận tương
đương chất lượng. Video vượt giới hạn tải và chính sách chặn cài extension native
trong cloud cũng không được suy diễn thành bằng chứng reference đã vận hành.

## Lần chạy renderer đã ghi nhận

Đã chạy riêng `tests/integration/multilingual-v050.spec.ts` bằng Chromium headless
trong môi trường cloud: **1 browser test PASS**,16 vùng trên4ảnh. Bài này không
cài hoặc chạy extension reference, không gửi ảnh tới Gemini.

| Chỉ số trong lần chạy fixture | Kết quả |
| --- | --- |
| Image Discovery Recall |4/4 ảnh tổng hợp, không suy rộng sang website thật |
| Vùng overlay đo được |16/16; không có layer mất trong các mẫu đã đo |
| Region Position Error | Max≈2,84×10⁻¹⁴ CSS px, tức nhỏ hơn0,001 CSS px trong phép chiếu fixture này |
| Text Overflow Rate |0/16, theo kích thước text/khung thực trong browser |
| Font dưới8px |0/16; không thay thế đánh giá đọc bằng mắt trên Windows |
| Page JS heap sample |4.663.868bytes ở lần full suite cuối; không là peak/process RAM |
| JSON metadata của mẫu dùng trong test |8.246bytes, tách riêng khỏi heap |
| Detector/OCR/dịch thật, cache hit, duplicate requests, thời gian dịch chương | Chưa đo trong bài renderer này |

JSON và ảnh review được lưu tại [assets/v050-multilingual](assets/v050-multilingual).
Báo cáo JSON có provenance `renderer-fixture`; các trường AI vẫn `unmeasured`.
Các before/after chỉ minh họa đặt ví dụ tiếng Việt lên box đã biết:

| Ngôn ngữ | Trước | Sau annotation overlay |
| --- | --- | --- |
| Anh | [en-before.png](assets/v050-multilingual/en-before.png) | [en-after.png](assets/v050-multilingual/en-after.png) |
| Nhật | [ja-before.png](assets/v050-multilingual/ja-before.png) | [ja-after.png](assets/v050-multilingual/ja-after.png) |
| Trung | [zh-before.png](assets/v050-multilingual/zh-before.png) | [zh-after.png](assets/v050-multilingual/zh-after.png) |
| Hàn | [ko-before.png](assets/v050-multilingual/ko-before.png) | [ko-after.png](assets/v050-multilingual/ko-after.png) |

Đã kiểm tra cổng bằng chứng của CLI: input `mock` dù chép nguyên annotation và
điểm ví dụ5/5 vẫn không được tính là OCR/detection/translation quality thật.
13 unit tests của metric module PASS; chúng kiểm tra công thức, không chứng minh
chất lượng model. Kết quả của toàn bộ extension được báo cáo riêng bởi full suite.
