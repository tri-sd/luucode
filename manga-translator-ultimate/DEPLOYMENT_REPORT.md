# Triển khai và đóng gói

| Gói | Nội dung |
|---|---|
| `manga-translator-ultimate-windows.zip` | Mã nguồn TypeScript/Python, thư mục Chrome unpacked `extension/dist`, companion, script Windows, tệp font, fixture, kiểm thử và tài liệu. |
| `manga-translator-ultimate-extension.zip` | Bản build Chrome MV3. Giải nén để nạp vào Chrome. Chức năng dịch cần companion trong gói Windows. |
| `SHA256SUMS.txt` | SHA-256 của hai ZIP. |

Đã dựng bản production với `npm ci` và `npm run build`. Sử dụng `python installer/package.py <thư-mục-đầu-ra>` để tạo hai ZIP. Script rà CRC sau khi ghi. Trình cài tải trọng số và phụ thuộc khi chạy lần đầu, vì vậy gói nhỏ và không chứa model, node_modules, venv, dữ liệu cache hay mã ghép nối.

Đã khởi động companion qua điểm vào `python -m manga_engine` trên Linux, làm việc với Ollama local, tải bản MV3 trên Chrome for Testing và chạy luồng kiểm thử đã ghi trong [TEST_REPORT.md](TEST_REPORT.md). Đã xác nhận các wheel Python 3.12 dành cho Windows x64 tải về được bằng `pip download --platform win_amd64 --python-version 312 --implementation cp --abi cp312 --only-binary=:all:`. Đã parse `installer/Windows.ps1` bằng Microsoft PowerShell trên Linux.

**Windows 11 và RTX 3050 — NOT VERIFIED.** Máy kiểm thử chạy Linux và CPU, không có Windows hoặc GPU NVIDIA đích. Các bước winget, mở Chrome trên Windows và CUDA cần được xác minh trên máy đích. Hướng dẫn người dùng trong [INSTALL_WINDOWS.md](INSTALL_WINDOWS.md).
