# Thành phần và giấy phép

Các thành phần dưới đây được kiểm tra về giấy phép, chạy offline và yêu cầu tài khoản. Runtime không cần tài khoản, thuê bao, API key hay thiết lập thanh toán. Trọng số và binary của các dự án độc lập được trình cài tải từ nguồn liên kết. Gói kèm Noto Sans, tệp OFL gốc, mã ứng dụng, bundle JavaScript và fixture tự tạo.

| Thành phần | Giấy phép | Cách lấy và sử dụng |
|---|---|---|
| Qwen3 4B Instruct 2507 | Apache-2.0 | Trọng số Q4_K_M qua [Ollama registry](https://ollama.com/library/qwen3:4b-instruct-2507-q4_K_M). [Model card chính thức](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507). |
| Qwen2.5 1.5B Instruct | Apache-2.0 | Trọng số Q4_K_M qua [Ollama registry](https://ollama.com/library/qwen2.5:1.5b-instruct-q4_K_M). [Model card chính thức](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct). |
| Qwen2.5 3B Instruct | Qwen Research License | Chỉ dùng để đánh giá khi làm dự án. Giấy phép giới hạn mục đích nghiên cứu hoặc đánh giá. Mô hình này không xuất hiện trong trình cài. [Điều khoản](https://huggingface.co/Qwen/Qwen2.5-3B-Instruct/blob/main/LICENSE). |
| Ollama | MIT | Chương trình tải và suy luận local. [Mã nguồn và license](https://github.com/ollama/ollama/blob/main/LICENSE). |
| Manga OCR và bản ONNX | Apache-2.0 | [Model gốc](https://huggingface.co/kha-white/manga-ocr-base). [Bản lượng tử tải thẳng, ghim commit](https://huggingface.co/ogkalu/manga-ocr-onnx/tree/c68e56437a2e0b13a7b1f4efa0ffce76efd0478d). |
| RapidOCR / PaddleOCR PP-OCRv4 | Apache-2.0 | ONNX detector nằm trong wheel RapidOCR. [RapidOCR](https://github.com/RapidAI/RapidOCR/blob/main/LICENSE) · [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR/blob/main/LICENSE). |
| Tesseract / tessdata | Apache-2.0 | Tesseract 5 và dữ liệu `eng`, bản Windows qua winget. [Tesseract](https://github.com/tesseract-ocr/tesseract) · [UB Mannheim](https://github.com/UB-Mannheim/tesseract/wiki) · [tessdata](https://github.com/tesseract-ocr/tessdata/blob/main/LICENSE). |
| ONNX Runtime, FastAPI, Pydantic, esbuild, pytesseract | MIT, riêng pytesseract Apache-2.0 | Wheels và gói phát triển công khai. [ONNX Runtime](https://github.com/microsoft/onnxruntime) · [FastAPI](https://github.com/fastapi/fastapi) · [Pydantic](https://github.com/pydantic/pydantic) · [esbuild](https://github.com/evanw/esbuild) · [pytesseract](https://github.com/madmaze/pytesseract). |
| OpenCV, TypeScript | Apache-2.0 | [OpenCV](https://github.com/opencv/opencv/blob/4.x/LICENSE) · [TypeScript](https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt). |
| NumPy, Uvicorn, Pillow, Python | BSD-3-Clause, BSD-3-Clause, HPND, PSF | [NumPy](https://github.com/numpy/numpy) · [Uvicorn](https://github.com/encode/uvicorn) · [Pillow](https://github.com/python-pillow/Pillow/blob/main/LICENSE) · [Python](https://www.python.org/psf/license/). |
| Noto Sans | SIL OFL 1.1 | Tệp regular và italic variable kèm `local-ai-engine/fonts/OFL.txt`. [Nguồn chính thức](https://github.com/google/fonts/tree/main/ofl/notosans). |
| Playwright và pytest | Apache-2.0 và MIT | Công cụ kiểm thử phát triển. [Playwright](https://github.com/microsoft/playwright-python) · [pytest](https://github.com/pytest-dev/pytest). |
