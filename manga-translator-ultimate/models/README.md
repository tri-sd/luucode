# Trọng số local

Trình tải Windows tại `installer/Windows.ps1` kiểm tra SHA-256 trước khi dùng ba tệp Manga OCR. Trên Linux, có thể tải các tệp tương tự từ [bản ONNX ghim theo commit](https://huggingface.co/ogkalu/manga-ocr-onnx/tree/c68e56437a2e0b13a7b1f4efa0ffce76efd0478d) vào thư mục này.

| Tệp | SHA-256 |
|---|---|
| encoder_model_int8.onnx | `0eaf2b867292a44700ce38ef028b90639a2e36fc4c18c2bcdd1de7409488adb3` |
| decoder_model_int8.onnx | `3ff0d4c34c4a66613d98ff93e0b17f22a7b09dfbeec195c3e4d6f595af3a6b6c` |
| vocab.txt | `5cb5c5586d98a2f331d9f8828e4586479b0611bfba5d8c3b6dadffc84d6a36a3` |

Mô hình dịch được Ollama xác minh và lưu tại kho của Ollama. Dùng `ollama pull qwen3:4b-instruct-2507-q4_K_M` cho chất lượng mặc định hoặc `ollama pull qwen2.5:1.5b-instruct-q4_K_M` cho cấu hình nhẹ. Sau khi tải, engine chỉ sử dụng mô hình có dữ liệu local và từ chối tên hoặc metadata chỉ tới mô hình cloud.
