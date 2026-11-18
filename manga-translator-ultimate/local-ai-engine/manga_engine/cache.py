from contextlib import contextmanager
import json
from pathlib import Path
import sqlite3
import time


class Cache:
    def __init__(self, file: Path, budget: int):
        self.file = file
        self.budget = budget
        file.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS pages (
                    key TEXT PRIMARY KEY, original BLOB NOT NULL, output BLOB NOT NULL,
                    metadata TEXT NOT NULL, size INTEGER NOT NULL, at REAL NOT NULL,
                    translation_key TEXT
                );
                CREATE TABLE IF NOT EXISTS corrections (
                    key TEXT PRIMARY KEY, payload TEXT NOT NULL, at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            """)
            db.execute("BEGIN IMMEDIATE")
            columns = {row[1] for row in db.execute("PRAGMA table_info(pages)")}
            if "translation_key" not in columns:
                db.execute("ALTER TABLE pages ADD COLUMN translation_key TEXT")
            db.execute("CREATE INDEX IF NOT EXISTS pages_translation ON pages(translation_key, at)"
                       " WHERE translation_key IS NOT NULL")

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.file, timeout=8)
        try:
            with db:
                yield db
        finally:
            db.close()

    def exists(self, key):
        with self.connection() as db:
            return db.execute("UPDATE pages SET at=? WHERE key=?", (time.time(), key)).rowcount > 0

    def page(self, key, original=False):
        with self.connection() as db:
            column = "original" if original else "output"
            row = db.execute(f"SELECT {column}, metadata FROM pages WHERE key=?", (key,)).fetchone()
            if row:
                db.execute("UPDATE pages SET at=? WHERE key=?", (time.time(), key))
                return row[0], json.loads(row[1])
            return None

    def corrections(self, key):
        with self.connection() as db:
            row = db.execute("SELECT payload FROM corrections WHERE key=?", (key,)).fetchone()
            return json.loads(row[0]) if row else {}

    def translation(self, key):
        with self.connection() as db:
            row = db.execute("SELECT metadata FROM pages WHERE translation_key=? ORDER BY at DESC LIMIT 1",
                             (key,)).fetchone()
            if row:
                metadata = json.loads(row[0])
                return metadata["translation_base"], metadata["device"]
            return None

    def put(self, key, original, output, metadata, edits=None):
        encoded = json.dumps(metadata, ensure_ascii=False, separators=(",", ":"))
        size = len(original)+len(output)+len(encoded.encode())
        if size > self.budget:
            raise ValueError("Kết quả vượt giới hạn dung lượng cache.")
        at = time.time()
        with self.connection() as db:
            db.execute("""INSERT OR REPLACE INTO pages
                       (key, original, output, metadata, size, at, translation_key)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                       (key, original, output, encoded, size, at, metadata.get("translation_key")))
            if edits is not None:
                if edits:
                    db.execute("INSERT OR REPLACE INTO corrections VALUES (?,?,?)",
                               (key, json.dumps(edits, ensure_ascii=False), at))
                else:
                    db.execute("DELETE FROM corrections WHERE key=?", (key,))
            total = db.execute("SELECT COALESCE(SUM(size), 0) FROM pages").fetchone()[0]
            while total > self.budget:
                old, size = db.execute("SELECT key,size FROM pages WHERE key != ? ORDER BY at LIMIT 1",
                                       (key,)).fetchone()
                db.execute("DELETE FROM pages WHERE key=?", (old,))
                total -= size

    def clear(self):
        with self.connection() as db:
            db.execute("DELETE FROM pages")
        with self.connection() as db:
            db.execute("VACUUM")

    def glossary(self, value=None):
        with self.connection() as db:
            if value is not None:
                db.execute("INSERT OR REPLACE INTO config VALUES ('glossary', ?)",
                           (json.dumps(value, ensure_ascii=False),))
                return value
            row = db.execute("SELECT value FROM config WHERE key='glossary'").fetchone()
            return json.loads(row[0]) if row else {}
