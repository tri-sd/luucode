from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from threading import Event, Lock
import time
import uuid


class Cancelled(Exception):
    pass


@dataclass
class Job:
    since: float = field(default_factory=time.monotonic)
    seen: float = field(default_factory=time.monotonic)
    stop: Event = field(default_factory=Event)
    phase: str = "Đang chờ engine"
    state: str = "pending"
    result: dict | None = None
    error: str | None = None

    def check(self):
        now = time.monotonic()
        if self.stop.is_set() or now-self.seen > 35 or now-self.since > 360:
            raise Cancelled()


class Jobs:
    def __init__(self):
        self.items = {}
        self.lock = Lock()
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="manga-page")

    def submit(self, work):
        with self.lock:
            now = time.monotonic()
            self.items = {key: job for key, job in self.items.items()
                          if job.state in {"pending", "running"} or now-job.seen < 90}
            if sum(j.state in {"pending", "running"} for j in self.items.values()) >= 3:
                raise ValueError("Engine đang bận. Hãy đợi ảnh hiện tại xử lý xong.")
            key = uuid.uuid4().hex
            job = self.items[key] = Job()
            self.pool.submit(self.run, job, work)
            return key

    def run(self, job, work):
        def progress(value):
            with self.lock:
                job.phase = value
        try:
            with self.lock:
                job.state = "running"
            job.check()
            result = work(job.check, progress)
            with self.lock:
                job.state = "done"
                job.result = result
        except Cancelled:
            with self.lock:
                job.state = "cancelled"
                job.error = "Đã hủy hoặc quá thời hạn xử lý."
        except (ValueError, RuntimeError) as exc:
            with self.lock:
                job.state = "error"
                job.error = str(exc)
        except Exception:
            with self.lock:
                job.state = "error"
                job.error = "Engine gặp lỗi nội bộ khi xử lý ảnh. Hãy thử lại."

    def status(self, key):
        with self.lock:
            job = self.items.get(key)
            if not job:
                return None
            now = time.monotonic()
            if job.state in {"pending", "running"} and now-job.seen > 35:
                job.stop.set()
            job.seen = now
            return {field: getattr(job, field) for field in ("state", "phase", "result", "error")}

    def cancel(self, key):
        with self.lock:
            if key in self.items:
                self.items[key].stop.set()

    def busy(self):
        with self.lock:
            return any(j.state in {"pending", "running"} for j in self.items.values())
