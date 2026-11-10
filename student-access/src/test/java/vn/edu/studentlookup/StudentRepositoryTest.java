package vn.edu.studentlookup;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.sql.*;
import static org.junit.jupiter.api.Assertions.*;

class StudentRepositoryTest {
    @TempDir Path directory;
    Path path;
    StudentRepository repository;

    @BeforeEach void setup() throws Exception {
        path = directory.resolve("Sinh viên.accdb");
        SampleDatabase.create(path);
        repository = new StudentRepository(path);
    }

    @Test void readsRealAccessAndPreservesVietnameseAndNulls() throws Exception {
        assertEquals(5, repository.search("", "", "").size());
        Student an = repository.search("sv001", "", "").get(0);
        assertEquals("Nguyễn Văn An", an.name());
        assertEquals("2004-03-15", an.birthDate().toString());
        assertEquals("0900000001", an.phone());
        assertNull(repository.search("SV005", "", "").get(0).birthDate());
        assertEquals("SV002", repository.search("  trần  ", "", "").get(0).id());
    }

    @Test void combinesFiltersAndListsOptions() throws Exception {
        assertEquals(2, repository.search("", "CNTT01", "Công nghệ thông tin").size());
        assertTrue(repository.search("SV001", "KT01", "").isEmpty());
        assertEquals(3, repository.classes().size());
        assertEquals(2, repository.faculties().size());
        assertTrue(repository.search("", "CNTT01", "Kinh tế").isEmpty());
    }

    @Test void treatsSqlAndWildcardsAsLiteralText() throws Exception {
        for (String term : new String[]{"' OR 1=1 --", "%", "_", "zzzz"})
            assertTrue(repository.search(term, "", "").isEmpty(), term);
    }

    @Test void neverOverwritesAnExistingFile() throws Exception {
        Path existing = directory.resolve("important.accdb");
        Files.writeString(existing, "keep me");
        assertThrows(FileAlreadyExistsException.class, () -> SampleDatabase.create(existing));
        assertEquals("keep me", Files.readString(existing));
    }

    @Test void missingAndWrongSchemaFailClearly() throws Exception {
        assertThrows(SQLException.class, () -> new StudentRepository(directory.resolve("missing.accdb")).search("", "", ""));
        assertFalse(Files.exists(directory.resolve("missing.accdb")));
        Path empty = directory.resolve("empty.accdb");
        try (var db = com.healthmarketscience.jackcess.DatabaseBuilder.create(
            com.healthmarketscience.jackcess.Database.FileFormat.V2010, empty.toFile())) {}
        assertThrows(SQLException.class, () -> new StudentRepository(empty).search("", "", ""));
    }
}
