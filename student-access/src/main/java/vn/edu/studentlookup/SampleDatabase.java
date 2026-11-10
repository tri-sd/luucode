package vn.edu.studentlookup;

import com.healthmarketscience.jackcess.*;
import java.io.IOException;
import java.nio.file.*;
import java.sql.*;

public final class SampleDatabase {
    private SampleDatabase() {}

    public static void create(Path path) throws IOException, SQLException {
        Path target = path.toAbsolutePath().normalize();
        // Atomic reservation: never overwrite a user's database.
        Files.createDirectories(target.getParent());
        Files.createFile(target);
        boolean complete = false;
        try {
            try (Database db = DatabaseBuilder.create(Database.FileFormat.V2010, target.toFile())) {
                Table table = new TableBuilder("SinhVien")
                    .addColumn(new ColumnBuilder("MaSV", DataType.TEXT).setLengthInUnits(20))
                    .addColumn(new ColumnBuilder("HoTen", DataType.TEXT).setLengthInUnits(100))
                    .addColumn(new ColumnBuilder("NgaySinh", DataType.SHORT_DATE_TIME))
                    .addColumn(new ColumnBuilder("GioiTinh", DataType.TEXT).setLengthInUnits(10))
                    .addColumn(new ColumnBuilder("Lop", DataType.TEXT).setLengthInUnits(30))
                    .addColumn(new ColumnBuilder("Khoa", DataType.TEXT).setLengthInUnits(100))
                    .addColumn(new ColumnBuilder("Email", DataType.TEXT).setLengthInUnits(100))
                    .addColumn(new ColumnBuilder("DienThoai", DataType.TEXT).setLengthInUnits(20))
                    .setPrimaryKey("MaSV").toTable(db);
                table.addRow("SV001", "Nguyễn Văn An", Date.valueOf("2004-03-15"), "Nam", "CNTT01", "Công nghệ thông tin", "an@example.com", "0900000001");
                table.addRow("SV002", "Trần Thị Bình", Date.valueOf("2004-08-20"), "Nữ", "CNTT01", "Công nghệ thông tin", "binh@example.com", "0900000002");
                table.addRow("SV003", "Lê Minh Châu", Date.valueOf("2003-12-01"), "Nữ", "KT01", "Kinh tế", "chau@example.com", "0900000003");
                table.addRow("SV004", "Phạm Quốc Dũng", Date.valueOf("2004-05-09"), "Nam", "CNTT02", "Công nghệ thông tin", "dung@example.com", "0900000004");
                table.addRow("SV005", "Hoàng Hà", null, null, "KT01", "Kinh tế", null, null);
            }
            complete = true;
        } finally {
            if (!complete) Files.deleteIfExists(target);
        }
    }
}
