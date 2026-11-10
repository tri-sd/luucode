package vn.edu.studentlookup;

import java.time.LocalDate;

public record Student(String id, String name, LocalDate birthDate, String gender,
                      String className, String faculty, String email, String phone) {}
