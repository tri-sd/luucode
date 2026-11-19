import asyncio
import base64
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import subprocess

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from .cache import Cache
from .contracts import Edit, PageInput
from .engine import Engine
from .identity import EXTENSION_ORIGIN
from .jobs import Jobs
from .ocr import MODELS
from .translate import models

LIMIT = 30_000_000
PORT = 18787
STATE = Path(os.environ.get("MANGA_STATE_DIR", Path(os.environ.get("LOCALAPPDATA", Path.home() / ".local/share")) / "MangaTranslatorUltimate"))
STATE.mkdir(parents=True, exist_ok=True)
TOKEN_FILE = STATE / "pairing-token.txt"
if not TOKEN_FILE.exists():
    try:
        handle = os.open(TOKEN_FILE, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(handle, "w", encoding="ascii") as token_file:
            token_file.write(secrets.token_urlsafe(32))
    except FileExistsError:
        pass
TOKEN = TOKEN_FILE.read_text(encoding="ascii").strip()
if not re.fullmatch(r"[a-zA-Z0-9_-]{43}", TOKEN):
    raise RuntimeError("Invalid pairing token file")
cache = Cache(STATE / "pages.sqlite3", max(100, min(8192, int(os.environ.get("MANGA_CACHE_MB", "1536"))))*1024**2)
engine = Engine(cache)
jobs = Jobs()
admin = asyncio.Lock()
app = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)


@app.middleware("http")
async def security(request: Request, call_next):
    origin = request.headers.get("origin")
    if request.headers.get("host") != f"127.0.0.1:{PORT}" or (origin and origin != EXTENSION_ORIGIN):
        return JSONResponse({"detail": "Origin hoặc Host bị từ chối."}, 403)
    cors = {"Access-Control-Allow-Origin": EXTENSION_ORIGIN, "Vary": "Origin",
            "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Authorization, Content-Type",
            "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}
    if request.method == "OPTIONS" and origin == EXTENSION_ORIGIN:
        from starlette.responses import Response
        return Response(status_code=204, headers=cors)
    provided = request.headers.get("authorization", "")
    if not hmac.compare_digest(provided.encode(), f"Bearer {TOKEN}".encode()):
        return JSONResponse({"detail": "Mã ghép nối chưa đúng."}, 401, headers=cors)
    response = await call_next(request)
    response.headers.update(cors)
    return response


async def body(request):
    if not request.headers.get("content-type", "").split(";")[0] == "application/json":
        raise HTTPException(415, "Yêu cầu JSON.")
    parts = bytearray()
    async for chunk in request.stream():
        if len(parts)+len(chunk) > LIMIT:
            raise HTTPException(413, "Yêu cầu vượt 30 MB.")
        parts.extend(chunk)
    try:
        return json.loads(parts)
    except (ValueError, UnicodeError, RecursionError) as exc:
        raise HTTPException(400, "JSON không hợp lệ.") from exc


def gpu():
    try:
        output = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.used,memory.total",
                                 "--format=csv,noheader,nounits"], capture_output=True, check=True, timeout=2,
                                text=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout
        name, used, total = output.splitlines()[0].rsplit(",", 2)
        return {"name": name.strip(), "used": int(used), "total": int(total)}
    except (OSError, ValueError, IndexError, subprocess.SubprocessError):
        return None


@app.get("/health")
def health():
    try:
        available = [x["name"] for x in models()]
        ollama = True
    except (OSError, ValueError):
        available, ollama = [], False
    from .translate import local
    try:
        loaded = [{"name": x["name"], "vram": x.get("size_vram", 0)}
                  for x in local("/api/ps", timeout=2).get("models", [])]
    except (OSError, ValueError):
        loaded = []
    return {"engine": True, "ollama": ollama, "gpu": gpu(), "loaded": loaded, "models": available,
            "manga_ocr": all((MODELS / name).is_file() for name in
                             ("encoder_model_int8.onnx", "decoder_model_int8.onnx", "vocab.txt"))}


@app.post("/jobs", status_code=202)
async def start(request: Request):
    try:
        page = PageInput.model_validate(await body(request))
        async with admin:
            return {"id": jobs.submit(lambda check, progress: engine.process(page, check, progress))}
    except ValidationError as exc:
        raise HTTPException(422, "Ảnh hoặc cài đặt không hợp lệ.") from exc
    except ValueError as exc:
        raise HTTPException(429, str(exc)) from exc


@app.get("/jobs/{key}")
def status(key: str):
    job = jobs.status(key)
    if job is None:
        raise HTTPException(404, "Tác vụ không còn tồn tại. Thử dịch lại.")
    return job


@app.delete("/jobs/{key}")
def cancel(key: str):
    jobs.cancel(key)
    return {"ok": True}


def verify_key(key):
    if not re.fullmatch(r"[a-f0-9]{64}", key):
        raise HTTPException(404, "Không tìm thấy ảnh.")


@app.get("/result/{key}")
def result(key: str):
    verify_key(key)
    entry = cache.page(key)
    if entry is None:
        raise HTTPException(404, "Ảnh đã bị dọn khỏi cache.")
    data, meta = entry
    summary = {name: value for name, value in meta.items()
               if name not in ("base", "settings", "translation_base", "translation_key", "translation_original_texts")}
    return {**summary, "key": key, "image": base64.b64encode(data).decode("ascii") if data else None}


@app.get("/original/{key}")
def original(key: str):
    verify_key(key)
    entry = cache.page(key, original=True)
    if entry is None:
        raise HTTPException(404, "Ảnh đã bị dọn khỏi cache.")
    import io
    from PIL import Image
    data, _ = entry
    with Image.open(io.BytesIO(data)) as image:
        mime = Image.MIME.get(image.format, "application/octet-stream")
    return {"image": base64.b64encode(data).decode("ascii"), "mime": mime}


@app.post("/edit/{key}", status_code=202)
async def edit(key: str, request: Request):
    verify_key(key)
    payload = await body(request)
    try:
        if not isinstance(payload, dict):
            raise ValueError()
        reset = payload.get("reset", False) is True
        change = Edit.model_validate(payload["edit"]) if payload.get("edit") is not None else None
        async with admin:
            return {"id": jobs.submit(lambda check, progress: engine.edit(key, change, reset, check, progress))}
    except ValidationError as exc:
        raise HTTPException(422, "Chỉnh sửa không hợp lệ.") from exc
    except ValueError as exc:
        raise HTTPException(429, str(exc) or "Chỉnh sửa không hợp lệ.") from exc


@app.get("/glossary")
def glossary():
    return cache.glossary()


@app.post("/glossary")
async def put_glossary(request: Request):
    data = await body(request)
    if not isinstance(data, dict) or len(data) > 40 or not all(
        isinstance(k, str) and 1 <= len(k.strip()) <= 55 and isinstance(v, str) and 1 <= len(v.strip()) <= 70
        for k, v in data.items()
    ):
        raise HTTPException(422, "Từ điển phải là JSON với tối đa 40 cặp văn bản nguồn → tiếng Việt.")
    return await asyncio.to_thread(cache.glossary, {k.strip(): v.strip() for k, v in data.items()})


@app.delete("/cache")
async def clear_cache():
    async with admin:
        if jobs.busy():
            raise HTTPException(409, "Hãy tạm dừng các tab và đợi engine xử lý xong.")
        await asyncio.to_thread(cache.clear)
    return {"ok": True}
