import base64
import hashlib
import io
import json

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import ValidationError

from .contracts import Edit, Region, Settings
from .ocr import Ocr
from .render import render
from .translate import installed, request_translation, translate

MAX_IMAGE = 22_020_096
MAX_RESULT = 40_000_000
ALGORITHM = "ppocr4:tesseract5:mangaocr-int8-v1:balloon-coverage-v13"


def read_image(raw):
    try:
        with Image.open(io.BytesIO(raw), formats=["JPEG", "PNG", "WEBP", "GIF", "BMP", "AVIF"]) as source:
            w, h = source.size
            if w*h > 25_000_000 or max(w, h) > 35_000 or min(w, h) < 8:
                raise ValueError("Ảnh ngoài giới hạn 25 megapixel hoặc 35.000 pixel mỗi cạnh.")
            if getattr(source, "is_animated", False):
                raise ValueError("Ảnh động được giữ nguyên.")
            image = ImageOps.exif_transpose(source)
            if "A" in image.getbands() or "transparency" in image.info:
                rgba = image.convert("RGBA")
                base = Image.new("RGBA", image.size, (255, 255, 255, 255))
                base.alpha_composite(rgba)
                rgb = np.asarray(base.convert("RGB"))
                return rgb, np.asarray(rgba.getchannel("A"))
            return np.asarray(image.convert("RGB")), None
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError) as exc:
        raise ValueError("Không đọc được ảnh hoặc định dạng chưa hỗ trợ.") from exc


def png(rgb, alpha):
    image = Image.fromarray(rgb)
    if alpha is not None:
        image.putalpha(Image.fromarray(alpha))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", compress_level=3)
    return buffer.getvalue()


class Engine:
    def __init__(self, cache):
        self.cache = cache
        self.ocr = Ocr()

    def process(self, page, check, progress):
        progress("Đọc ảnh và kiểm tra cache")
        try:
            raw = base64.b64decode(page.image, validate=True)
        except ValueError as exc:
            raise ValueError("Dữ liệu ảnh không hợp lệ.") from exc
        if not raw or len(raw) > MAX_IMAGE:
            raise ValueError("Ảnh vượt giới hạn 21 MiB hoặc không có dữ liệu.")
        digest = hashlib.sha256(raw).hexdigest()
        glossary = self.cache.glossary()
        model_digest = installed(page.settings.model)["digest"]
        identity = json.dumps([ALGORITHM, digest, model_digest, page.settings.model_dump(), glossary], sort_keys=True)
        key = hashlib.sha256(identity.encode()).hexdigest()
        if not page.force and self.cache.exists(key):
            return {"key": key, "cached": True}
        check()
        rgb, alpha = read_image(raw)
        height, width = rgb.shape[:2]
        progress("Phát hiện chữ và nhận dạng OCR")
        regions = self.ocr.regions(rgb, page.settings, check)
        progress("Dịch hội thoại bằng Ollama local")
        device = translate(regions, page.settings, page.context, glossary, check)
        base = [r.model_dump(mode="json") for r in regions]
        edits = self.cache.corrections(key)
        self.apply_edits(regions, edits)
        progress("Xóa nét gốc và dàn chữ tiếng Việt")
        budget = 4 if page.settings.quality == "quality" else 1

        def shorten(region):
            nonlocal budget
            if budget <= 0 or region.id in edits:
                return None
            budget -= 1
            try:
                translations, _ = request_translation([region], page.settings, page.context[-900:], glossary, device, True, check)
                return translations.get(region.id)
            except (OSError, RuntimeError, ValueError, ValidationError):
                return None

        result, count = render(rgb, regions, page.settings, check, shorten)
        data = png(result, alpha) if count else b""
        if len(data) > MAX_RESULT:
            raise ValueError("Ảnh PNG kết quả vượt 40 MB. Vui lòng chia ảnh trước khi dịch.")
        if count:
            # Save any successful shortening as part of the reset baseline.
            for snapshot, region in zip(base, regions):
                if region.id not in edits and region.text and not region.issue:
                    snapshot["text"] = region.text
        check()
        meta = {"regions": [r.model_dump(mode="json") for r in regions], "base": base,
                "settings": page.settings.model_dump(), "width": width, "height": height,
                "fingerprint": digest, "rendered": count, "model_digest": model_digest,
                "device": device, "edits": list(edits)}
        self.cache.put(key, raw, data, meta)
        return {"key": key, "cached": False}

    @staticmethod
    def apply_edits(regions, edits):
        for r in regions:
            if r.id not in edits:
                continue
            edit = Edit.model_validate(edits[r.id])
            r.text, r.placement, r.font, r.font_scale = edit.text, edit.placement, edit.font, edit.font_scale
            r.issue = "" if r.text.strip() else "Giữ nguyên theo chỉnh sửa."

    def edit(self, key, edit, reset, check, progress):
        progress("Cập nhật bản dịch trên ảnh gốc")
        entry = self.cache.page(key, original=True)
        if entry is None:
            raise ValueError("Ảnh đã bị dọn khỏi cache. Hãy dịch lại.")
        raw, meta = entry
        rgb, alpha = read_image(raw)
        regions = [Region.model_validate(r) for r in meta["base"]]
        edits = self.cache.corrections(key)
        if reset:
            if edit is None:
                edits.clear()
            else:
                edits.pop(edit.id, None)
        else:
            if edit is None or edit.id not in {r.id for r in regions}:
                raise ValueError("Region ID không tồn tại.")
            if edit.placement:
                x, y, w, h = edit.placement
                if w <= 0 or h <= 0 or x+w > 1.00000001 or y+h > 1.00000001:
                    raise ValueError("Vị trí phải nằm trong ảnh.")
            edits[edit.id] = edit.model_dump(mode="json")
        self.apply_edits(regions, edits)
        result, count = render(rgb, regions, Settings.model_validate(meta["settings"]), check)
        data = png(result, alpha) if count else b""
        if len(data) > MAX_RESULT:
            raise ValueError("Ảnh PNG kết quả vượt 40 MB.")
        check()
        meta.update(regions=[r.model_dump(mode="json") for r in regions], rendered=count, edits=list(edits))
        self.cache.put(key, raw, data, meta, edits)
        return {"key": key, "cached": False}
