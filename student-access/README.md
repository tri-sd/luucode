# Tra cứu sinh viên — Java Swing + Microsoft Access

Ứng dụng desktop Java, giao diện tiếng Việt, dùng **database Access thật** (`.accdb` / `.mdb`) qua JDBC UCanAccess. Mở dự án bằng Eclipse, không cần Microsoft Access, ODBC hay driver ACE để chạy ứng dụng.

## Chức năng

- Chọn file Access có sẵn; hiển thị sinh viên trong bảng, nhấn tiêu đề cột để sắp xếp.
- Tìm một phần mã sinh viên hoặc họ tên, không phân biệt hoa/thường. Tên tiếng Việt cần nhập đúng dấu.
- Kết hợp lọc lớp và khoa; nhấn **Tra cứu** hoặc Enter trong ô tìm kiếm.
- Nhấn **Xóa bộ lọc** để xem lại toàn bộ danh sách.
- Chọn dòng rồi nhấn **Xem chi tiết**, hoặc nhấp đúp để xem hồ sơ và sao chép thông tin.
- Tạo database `.accdb` mẫu gồm 5 sinh viên hư cấu. Không ghi đè file đã tồn tại.
- Truy vấn chạy nền để giao diện không bị treo; đầu vào được truyền bằng `PreparedStatement`.

## Mở và chạy trong Eclipse

1. Cài **JDK 17 trở lên** và **Eclipse IDE for Java Developers** có Maven Integration (m2e).
2. Clone repository hoặc tải ZIP từ GitHub rồi giải nén.
3. Eclipse → **File → Import → Maven → Existing Maven Projects**.
4. Chọn thư mục `student-access` chứa `pom.xml`, nhấn **Finish**, chờ Maven tải thư viện.
5. Kiểm tra **Window → Preferences → Java → Installed JREs** trỏ tới JDK 17+.
6. Mở `src/main/java/vn/edu/studentlookup/App.java` → **Run As → Java Application**.
7. Nhấn **Tạo database mẫu**, chọn nơi lưu `SinhVien.accdb`. Database tự mở sau khi tạo xong.
8. Thử tìm `SV001`, `Trần`, hoặc chọn lớp `CNTT01` rồi nhấn **Tra cứu**.

Nếu Eclipse báo thiếu thư viện: nhấp phải dự án → **Maven → Update Project**. Nếu tiếng Việt hiển thị sai: **Project → Properties → Resource → Text file encoding → UTF-8**. Không cần thêm các JAR thủ công vào Build Path.

## Build bằng Maven

Cần JDK 17+ và Maven 3.9+; chạy từ thư mục `student-access`:

```sh
mvn clean package
java -jar target/student-access-1.0.0.jar
```

JAR đóng gói kèm thư viện. Có thể tạo mẫu khi không có giao diện đồ họa:

```sh
java -jar target/student-access-1.0.0.jar --create-sample data/SinhVien.accdb
```

Tham số tạo mẫu chỉ tạo file, không tự mở giao diện. Chạy JAR bình thường và chọn **Mở database** để đọc file.

## Dùng database Access của bạn

Database phải có bảng `SinhVien` với các trường sau (tên không dấu, đúng chính tả):

| Trường | Kiểu trong Access | Ghi chú |
| --- | --- | --- |
| `MaSV` | Short Text (20) | Khóa chính, ví dụ SV001 |
| `HoTen` | Short Text (100) | Họ và tên |
| `NgaySinh` | Date/Time | Có thể để trống; dùng Date/Time thông thường |
| `GioiTinh` | Short Text (10) | Nam/Nữ hoặc giá trị khác |
| `Lop` | Short Text (30) | Ví dụ CNTT01 |
| `Khoa` | Short Text (100) | Ví dụ Công nghệ thông tin |
| `Email` | Short Text (100) | Có thể để trống |
| `DienThoai` | Short Text (20) | Dùng Text để giữ số 0 đầu |

Cách nhanh nhất: tạo mẫu từ ứng dụng, mở file đó trong Microsoft Access, thay các dòng mẫu bằng dữ liệu của bạn và giữ nguyên tên/kiểu cột. Đóng Access trước khi chuyển về ứng dụng, mở lại database hoặc nhấn **Tra cứu** để cập nhật.

Ứng dụng tra cứu chỉ thực hiện SELECT trên database đã chọn; không có chức năng sửa/xóa sinh viên. File Access cần nằm trong thư mục cho phép UCanAccess tạo file khóa. Tránh đường dẫn chứa dấu `;`. Database có mật khẩu/mã hóa hoặc cấu trúc khác chưa được hỗ trợ. Không đưa dữ liệu sinh viên thật lên repository; `/data/` đã được bỏ qua bởi Git.

## Cấu trúc mã nguồn

- `App.java`: giao diện Swing, bộ lọc, bảng kết quả, cửa sổ chi tiết và tác vụ nền.
- `Student.java`: mô hình sinh viên.
- `StudentRepository.java`: truy vấn JDBC có tham số và đóng tài nguyên tự động.
- `SampleDatabase.java`: tạo file Access 2010 `.accdb` bằng Jackcess.
- `StudentRepositoryTest.java`: kiểm thử tích hợp với file `.accdb` thật trong thư mục tạm.

## Kiểm thử

```sh
mvn test
```

Hoặc Eclipse → nhấp phải `StudentRepositoryTest.java` → **Run As → JUnit Test**.

Các bài kiểm thử bao gồm đọc tiếng Việt, ngày sinh và giá trị trống; tìm mã/tên; kết hợp bộ lọc; ký tự SQL và wildcard; bảo vệ file có sẵn; báo lỗi khi thiếu database hoặc sai bảng. GitHub Actions chạy kiểm thử và đóng gói trên Ubuntu và Windows bằng JDK 17.

