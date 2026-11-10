package vn.edu.studentlookup;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.*;
import java.util.ArrayList;
import java.util.List;

public final class StudentRepository {
    private final Path database;

    public StudentRepository(Path database) {
        this.database = database.toAbsolutePath().normalize();
    }

    private Connection connect() throws SQLException {
        if (!Files.isRegularFile(database)) {
            throw new SQLException("Không tìm thấy database: " + database);
        }
        // Reject JDBC property separators in a filename to keep connection options fixed.
        if (database.toString().contains(";")) {
            throw new SQLException("Đường dẫn database không được chứa dấu chấm phẩy.");
        }
        return DriverManager.getConnection("jdbc:ucanaccess://" + database + ";memory=true;openExclusive=false");
    }

    public List<Student> search(String keyword, String className, String faculty) throws SQLException {
        List<Student> students = new ArrayList<>();
        // INSTR treats user input literally: %, _, quotes are not wildcards or SQL.
        String sql = "SELECT MaSV, HoTen, NgaySinh, GioiTinh, Lop, Khoa, Email, DienThoai FROM SinhVien "
            + "WHERE (? = '' OR INSTR(LCASE(MaSV), LCASE(?)) > 0 OR INSTR(LCASE(HoTen), LCASE(?)) > 0) "
            + "AND (? = '' OR Lop = ?) AND (? = '' OR Khoa = ?) ORDER BY MaSV";
        try (Connection c = connect(); PreparedStatement p = c.prepareStatement(sql)) {
            String term = keyword == null ? "" : keyword.trim();
            String cls = className == null ? "" : className;
            String fac = faculty == null ? "" : faculty;
            p.setString(1, term); p.setString(2, term); p.setString(3, term);
            p.setString(4, cls); p.setString(5, cls); p.setString(6, fac); p.setString(7, fac);
            try (ResultSet r = p.executeQuery()) {
                while (r.next()) {
                    Date birth = r.getDate("NgaySinh");
                    students.add(new Student(r.getString("MaSV"), r.getString("HoTen"),
                        birth == null ? null : birth.toLocalDate(), r.getString("GioiTinh"),
                        r.getString("Lop"), r.getString("Khoa"), r.getString("Email"), r.getString("DienThoai")));
                }
            }
        }
        return students;
    }

    public List<String> classes() throws SQLException { return distinct("Lop"); }
    public List<String> faculties() throws SQLException { return distinct("Khoa"); }

    private List<String> distinct(String column) throws SQLException {
        List<String> values = new ArrayList<>();
        try (Connection c = connect(); Statement s = c.createStatement();
             ResultSet r = s.executeQuery("SELECT DISTINCT [" + column + "] FROM SinhVien WHERE ["
                 + column + "] IS NOT NULL ORDER BY [" + column + "]")) {
            while (r.next()) if (!r.getString(1).isBlank()) values.add(r.getString(1));
        }
        return values;
    }
}
