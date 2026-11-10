package vn.edu.studentlookup;

import javax.swing.*;
import javax.swing.table.DefaultTableModel;
import java.awt.*;
import java.awt.event.*;
import java.nio.file.*;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.function.Consumer;

public final class App extends JFrame {
    private final JTextField keyword = new JTextField(22);
    private final JComboBox<String> classes = new JComboBox<>();
    private final JComboBox<String> faculties = new JComboBox<>();
    private final JLabel status = new JLabel("Chọn database Access hoặc tạo dữ liệu mẫu để bắt đầu.");
    private final JLabel fileLabel = new JLabel("Chưa chọn database");
    private final DefaultTableModel model = new DefaultTableModel(
        new String[]{"Mã SV", "Họ tên", "Ngày sinh", "Giới tính", "Lớp", "Khoa"}, 0) {
        @Override public boolean isCellEditable(int row, int column) { return false; }
    };
    private final JTable table = new JTable(model);
    private final JButton open = new JButton("Mở database");
    private final JButton sample = new JButton("Tạo database mẫu");
    private final JButton search = new JButton("Tra cứu");
    private final JButton reset = new JButton("Xóa bộ lọc");
    private final JButton detail = new JButton("Xem chi tiết");
    private StudentRepository repository;
    private List<Student> rows = List.of();
    private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("dd/MM/yyyy");

    public App() {
        super("Tra cứu thông tin sinh viên • Java & Access");
        setDefaultCloseOperation(EXIT_ON_CLOSE);
        setSize(1080, 650); setMinimumSize(new Dimension(820, 480));
        setLocationRelativeTo(null);
        JPanel root = new JPanel(new BorderLayout(12, 16));
        root.setBorder(BorderFactory.createEmptyBorder(20, 20, 20, 20));
        setContentPane(root);
        JPanel top = new JPanel(); top.setLayout(new BoxLayout(top, BoxLayout.Y_AXIS));
        JLabel title = new JLabel("TRA CỨU SINH VIÊN");
        title.setFont(title.getFont().deriveFont(Font.BOLD, 25f));
        JPanel heading = new JPanel(new FlowLayout(FlowLayout.LEFT, 0, 0)); heading.add(title); top.add(heading);
        JPanel files = new JPanel(new FlowLayout(FlowLayout.LEFT));
        files.add(open); files.add(sample); files.add(fileLabel); top.add(files);
        JPanel filters = new JPanel(new FlowLayout(FlowLayout.LEFT));
        filters.add(new JLabel("Mã SV / Họ tên:")); filters.add(keyword);
        classes.addItem("Tất cả lớp"); faculties.addItem("Tất cả khoa");
        filters.add(classes); filters.add(faculties); filters.add(search); filters.add(reset); top.add(filters);
        root.add(top, BorderLayout.NORTH);
        table.setRowHeight(30); table.setAutoCreateRowSorter(true);
        table.setSelectionMode(ListSelectionModel.SINGLE_SELECTION);
        table.getTableHeader().setReorderingAllowed(false);
        root.add(new JScrollPane(table), BorderLayout.CENTER);
        JPanel bottom = new JPanel(new BorderLayout()); bottom.add(status); bottom.add(detail, BorderLayout.EAST);
        root.add(bottom, BorderLayout.SOUTH);
        open.addActionListener(e -> chooseDatabase());
        sample.addActionListener(e -> createSample());
        search.addActionListener(e -> search()); keyword.addActionListener(e -> search());
        reset.addActionListener(e -> { keyword.setText(""); classes.setSelectedIndex(0); faculties.setSelectedIndex(0); search(); });
        detail.addActionListener(e -> showDetail());
        table.addMouseListener(new MouseAdapter() {
            @Override public void mouseClicked(MouseEvent e) { if (e.getClickCount() == 2) showDetail(); }
        });
        setBusy(false);
    }

    private void chooseDatabase() {
        JFileChooser chooser = chooser();
        if (chooser.showOpenDialog(this) == JFileChooser.APPROVE_OPTION) load(chooser.getSelectedFile().toPath());
    }

    private JFileChooser chooser() {
        JFileChooser chooser = new JFileChooser();
        chooser.setFileFilter(new javax.swing.filechooser.FileNameExtensionFilter("Microsoft Access (*.accdb, *.mdb)", "accdb", "mdb"));
        return chooser;
    }

    private void createSample() {
        JFileChooser chooser = chooser(); chooser.setSelectedFile(new java.io.File("SinhVien.accdb"));
        if (chooser.showSaveDialog(this) != JFileChooser.APPROVE_OPTION) return;
        Path path = chooser.getSelectedFile().toPath();
        if (!path.toString().toLowerCase(java.util.Locale.ROOT).endsWith(".accdb")) path = Path.of(path + ".accdb");
        final Path target = path;
        run("Đang tạo database mẫu…", () -> { SampleDatabase.create(target); return target; }, this::load);
    }

    private record Loaded(StudentRepository repository, List<String> classes, List<String> faculties, List<Student> students) {}

    private void load(Path path) {
        run("Đang mở database…", () -> {
            StudentRepository next = new StudentRepository(path);
            return new Loaded(next, next.classes(), next.faculties(), next.search("", "", ""));
        }, loaded -> {
            repository = loaded.repository(); keyword.setText("");
            classes.removeAllItems(); classes.addItem("Tất cả lớp"); loaded.classes().forEach(classes::addItem);
            faculties.removeAllItems(); faculties.addItem("Tất cả khoa"); loaded.faculties().forEach(faculties::addItem);
            fileLabel.setText(path.getFileName().toString()); fileLabel.setToolTipText(path.toAbsolutePath().toString());
            display(loaded.students()); setBusy(false);
        });
    }

    private void search() {
        if (repository == null || !search.isEnabled()) return;
        String term = keyword.getText();
        String cls = classes.getSelectedIndex() == 0 ? "" : (String) classes.getSelectedItem();
        String fac = faculties.getSelectedIndex() == 0 ? "" : (String) faculties.getSelectedItem();
        run("Đang tra cứu…", () -> repository.search(term, cls, fac), this::display);
    }

    private void display(List<Student> students) {
        rows = students; model.setRowCount(0);
        for (Student s : rows) model.addRow(new Object[]{s.id(), s.name(), birth(s), s.gender(), s.className(), s.faculty()});
        status.setText(rows.isEmpty() ? "Không tìm thấy sinh viên phù hợp." : "Tìm thấy " + rows.size() + " sinh viên.");
    }

    private void showDetail() {
        int selected = table.getSelectedRow();
        if (selected < 0) { JOptionPane.showMessageDialog(this, "Hãy chọn một sinh viên trong bảng."); return; }
        Student s = rows.get(table.convertRowIndexToModel(selected));
        JPanel fields = new JPanel(new GridLayout(0, 2, 16, 10));
        String[] labels = {"Mã sinh viên", "Họ tên", "Ngày sinh", "Giới tính", "Lớp", "Khoa", "Email", "Điện thoại"};
        String[] values = {s.id(), s.name(), birth(s), s.gender(), s.className(), s.faculty(), s.email(), s.phone()};
        for (int i = 0; i < labels.length; i++) {
            fields.add(new JLabel(labels[i] + ":"));
            JTextField value = new JTextField(values[i] == null ? "" : values[i]); value.setEditable(false); fields.add(value);
        }
        JOptionPane.showMessageDialog(this, fields, "Thông tin sinh viên", JOptionPane.PLAIN_MESSAGE);
    }

    private static String birth(Student s) { return s.birthDate() == null ? "" : DATE.format(s.birthDate()); }

    private void setBusy(boolean busy) {
        open.setEnabled(!busy); sample.setEnabled(!busy);
        boolean ready = !busy && repository != null;
        search.setEnabled(ready); reset.setEnabled(ready); detail.setEnabled(ready);
        keyword.setEnabled(ready); classes.setEnabled(ready); faculties.setEnabled(ready);
    }

    private <T> void run(String message, Callable<T> task, Consumer<T> success) {
        setBusy(true); status.setText(message);
        new SwingWorker<T, Void>() {
            @Override protected T doInBackground() throws Exception { return task.call(); }
            @Override protected void done() {
                setBusy(false);
                try { success.accept(get()); }
                catch (Exception ex) {
                    Throwable cause = ex.getCause() == null ? ex : ex.getCause();
                    status.setText("Thao tác thất bại. Kiểm tra database và thử lại.");
                    JOptionPane.showMessageDialog(App.this,
                        "Không thể đọc/tạo database.\n" + cause.getMessage()
                        + "\nDatabase cần có bảng SinhVien đúng cấu trúc trong README.", "Lỗi database", JOptionPane.ERROR_MESSAGE);
                }
            }
        }.execute();
    }

    public static void main(String[] args) throws Exception {
        if (args.length == 2 && args[0].equals("--create-sample")) {
            SampleDatabase.create(Path.of(args[1])); System.out.println("Đã tạo: " + Path.of(args[1]).toAbsolutePath()); return;
        }
        UIManager.setLookAndFeel(UIManager.getSystemLookAndFeelClassName());
        SwingUtilities.invokeLater(() -> new App().setVisible(true));
    }
}
