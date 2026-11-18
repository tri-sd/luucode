import math
import os
import re
import threading
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort
import pytesseract
import rapidocr_onnxruntime
from PIL import Image
from rapidocr_onnxruntime.ch_ppocr_det import TextDetector

from .contracts import Region

ROOT = Path(__file__).resolve().parents[2]
MODELS = ROOT / "models"
JP = re.compile(r"[\u3040-\u30ff\u3400-\u9fff]")
if os.environ.get("MANGA_TESSERACT"):
    pytesseract.pytesseract.tesseract_cmd = os.environ["MANGA_TESSERACT"]


def pixels(box, width, height):
    x, y, w, h = box
    a, b = round(x * width), round(y * height)
    return a, b, min(width, round((x+w)*width)), min(height, round((y+h)*height))


def normalize(rect, width, height):
    a, b, c, d = rect
    return a / width, b / height, (c-a) / width, (d-b) / height


def bounds(poly):
    lo = poly.min(axis=0)
    hi = poly.max(axis=0) + 1
    return (*lo.tolist(), *hi.tolist())


def tiles(im, edge, overlap=160):
    height, width = im.shape[:2]
    for y in range(0, height, edge-overlap):
        for x in range(0, width, edge-overlap):
            yield x, y, im[y:y+edge, x:x+edge]
            if x + edge >= width:
                break
        if y + edge >= height:
            break


def coverage(a, b):
    x, y, r, d = a
    xx, yy, rr, dd = b
    overlap = max(0, min(r, rr)-max(x, xx)) * max(0, min(d, dd)-max(y, yy))
    return overlap / max(1, min((r-x)*(d-y), (rr-xx)*(dd-yy)))


def bubble_for(gray, rect, component_cache):
    x, y, r, d = rect
    height, width = gray.shape
    rh, rw = d-y, r-x
    radius = min(208, max(32, int(max(rh, rw)*1.45)))
    a, b, c, e = max(0, x-radius), max(0, y-radius), min(width, r+radius), min(height, d+radius)
    roi = gray[b:e, a:c]
    # A seeded, bounded flat-color component gives a conservative bubble around
    # the dialogue. Components reaching the search boundary are open backgrounds.
    xs, ys = x-a, y-b
    seed_points = [(max(0, xs-3), ys+rh//2), (min(c-a-1, xs+rw+2), ys+rh//2),
                   (xs+rw//2, max(0, ys-3)), (xs+rw//2, min(e-b-1, ys+rh+2))]
    for sx, sy in seed_points:
        if not 0 <= sx < roi.shape[1] or not 0 <= sy < roi.shape[0]:
            continue
        ax, ay = a+sx, b+sy
        for box, mask in component_cache:
            l, t, rr, dd = box
            if l <= ax < rr and t <= ay < dd and mask[ay-t, ax-l]:
                if l <= x and t <= y and rr >= r and dd >= d:
                    return box
        mask = np.zeros((roi.shape[0]+2, roi.shape[1]+2), np.uint8)
        count, _, _, (l, t, w, h) = cv2.floodFill(
            roi, mask, (sx, sy), 0, loDiff=20, upDiff=20,
            flags=4 | cv2.FLOODFILL_FIXED_RANGE | cv2.FLOODFILL_MASK_ONLY | (255 << 8))
        if l == 0 or t == 0 or l+w == roi.shape[1] or t+h == roi.shape[0]:
            continue
        if not (rw <= w and rh <= h and l <= xs and t <= ys and l+w >= xs+rw and t+h >= ys+rh):
            continue
        if count < w*h*.40 or w*h > 20*rw*rh or w*h > 280_000:
            continue
        box = a+l, b+t, a+l+w, b+t+h
        component_cache.append((box, mask[t+1:t+h+1, l+1:l+w+1].copy()))
        return box
    return None


def ordered(groups, manga):
    # Cluster overlapping rows first, then sort each row in the reading direction.
    rows = []
    for group in sorted(groups, key=lambda item: item[0][1]):
        (x, y, r, d), _, _ = group
        height = d-y
        row = next((row for row in rows if
                    min(d, row[0][0][3])-max(y, row[0][0][1])
                    >= .36*min(height, row[0][0][3]-row[0][0][1])), None)
        if row is None:
            rows.append([group])
        else:
            row.append(group)
    return [item for row in rows for item in sorted(row, key=lambda item: item[0][0], reverse=manga)]


class Ocr:
    def __init__(self):
        self.detectors = {}
        self.japanese = None
        self.det_lock = threading.Lock()

    def detector(self, quality):
        edge = {"low": 736, "balanced": 1024, "quality": 1472}[quality]
        if edge not in self.detectors:
            # The ONNX graph is identical across quality modes.
            model = Path(rapidocr_onnxruntime.__file__).parent / "models/ch_PP-OCRv4_det_infer.onnx"
            if not self.detectors:
                det = TextDetector(dict(model_path=str(model), limit_side_len=edge, limit_type="min",
                                        mean=[.5]*3, std=[.5]*3, box_thresh=.48, unclip_ratio=1.4,
                                        intra_op_num_threads=3, inter_op_num_threads=1))
            else:
                det = next(iter(self.detectors.values()))
            self.detectors[edge] = det
        detector = self.detectors[edge]
        detector.limit_side_len = edge
        return detector, edge

    def detect(self, rgb, quality, check):
        candidates = []
        with self.det_lock:
            detector, edge = self.detector(quality)
            for x, y, tile in tiles(rgb, edge):
                check()
                boxes, _ = detector(cv2.cvtColor(tile, cv2.COLOR_RGB2BGR))
                for poly in boxes if boxes is not None else ():
                    candidates.append(np.rint(poly + [x, y]).astype(np.int32))
        result = []
        rects = []
        for poly in sorted(candidates, key=cv2.contourArea, reverse=True):
            rect = bounds(poly)
            if not any(coverage(rect, prev) > .72 for prev in rects):
                result.append(poly)
                rects.append(rect)
        return result

    def japanese_text(self, crop, check):
        if self.japanese is None:
            options = ort.SessionOptions()
            options.intra_op_num_threads = 3
            options.inter_op_num_threads = 1
            options.enable_cpu_mem_arena = False
            def load(name):
                path = MODELS / f"{name}_model_int8.onnx"
                if not path.is_file():
                    raise RuntimeError("Thiếu Manga OCR. Hãy chạy Setup để tải mô hình.")
                return ort.InferenceSession(str(path), options, providers=["CPUExecutionProvider"])
            self.japanese = load("encoder"), load("decoder"), (MODELS / "vocab.txt").read_text(encoding="utf-8").splitlines()
        enc, dec, vocab = self.japanese
        image = Image.fromarray(crop).convert("L").convert("RGB").resize((224, 224), Image.Resampling.BILINEAR)
        arr = (np.asarray(image, dtype=np.float32).transpose(2, 0, 1)[None] / 127.5) - 1
        hidden = enc.run(None, {"pixel_values": arr})[0]
        tokens = [2]
        probabilities = []
        for step in range(110):
            check()
            logits = dec.run(None, {"input_ids": np.asarray([tokens]), "encoder_hidden_states": hidden})[0][0, -1]
            token = int(logits.argmax())
            if token == 3:
                break
            if token == 2 and step == 0:
                tokens.append(token)
                continue
            if token < 5 or token >= len(vocab) or tokens[-8:] == [token]*8:
                return "", 0
            probabilities.append(float(1/np.exp(logits-logits[token]).sum()))
            tokens.append(token)
        else:
            return "", 0
        return "".join(vocab[i].removeprefix("##") for i in tokens[1:] if i >= 5), float(np.mean(probabilities)) if probabilities else 0

    @staticmethod
    def english_text(crop, quality):
        gray = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY)
        if min(gray.shape) < 90:
            gray = cv2.resize(gray, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
        gray = cv2.copyMakeBorder(gray, 8, 8, 8, 8, cv2.BORDER_REPLICATE)
        candidates = [gray]
        if quality == "quality":
            candidates.append(cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)[1])
        best = "", 0
        for image in candidates:
            data = pytesseract.image_to_data(image, lang="eng", config="--psm 6",
                                            output_type=pytesseract.Output.DICT, timeout=12)
            words = [(word.strip(), max(0, float(conf))) for word, conf in zip(data["text"], data["conf"])
                     if word.strip() and float(conf) >= 0]
            if words:
                score = sum(c*len(w) for w, c in words) / (100*sum(len(w) for w, _ in words))
                phrase = " ".join(w for w, _ in words)
                if score > best[1] and re.search(r"[a-zA-Z]", phrase):
                    best = phrase, score
                if score >= .84:
                    break
        return best

    def regions(self, rgb, settings, check):
        height, width = rgb.shape[:2]
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        polys = self.detect(rgb, settings.quality, check)
        groups = defaultdict(list)
        component_cache = []
        for poly in polys:
            box = bounds(poly)
            bubble = bubble_for(gray, box, component_cache)
            if bubble is not None:
                # The same component is normally found from several line crops.
                bubble = next((key for key in groups if key[0] and coverage(key[1], bubble) > .90), (True, bubble))[1]
            groups[(bubble is not None, bubble or box)].append(poly)
        grouped = [(bounds(np.concatenate(polys)), box if inside else None, polys)
                   for (inside, box), polys in groups.items()]
        manga = settings.language != "en"
        if len(grouped) > 180:
            raise ValueError("Ảnh có quá nhiều vùng chữ. Hãy cắt ảnh thành các đoạn ngắn hơn.")
        regions = []
        for index, (rect, bubble, polys) in enumerate(ordered(grouped, manga), 1):
            check()
            x, y, r, d = rect
            pad = max(3, min(12, round(min(r-x, d-y)*.12)))
            crop = rgb[max(0, y-pad):min(height, d+pad), max(0, x-pad):min(width, r+pad)]
            vertical = sum(np.ptp(p[:, 1]) >
                           1.4*np.ptp(p[:, 0]) for p in polys) > len(polys)/2
            region = Region(id=f"r{index}", box=normalize(rect, width, height),
                            polygons=[[(int(a)/width, int(b)/height) for a, b in p] for p in polys],
                            orientation="vertical" if vertical else "horizontal",
                            bubble=normalize(bubble, width, height) if bubble else None)
            if bubble is None and not settings.sfx:
                # Skip likely isolated stylized SFX while retaining horizontal narration.
                longest = max(polys, key=cv2.contourArea).astype(np.float32)
                p0, p1 = longest[:2]
                tilt = abs(math.degrees(math.atan2(float(p1[1]-p0[1]), float(p1[0]-p0[0]))))
                if 20 < tilt < 160 and min(r-x, d-y) > 18:
                    region.issue = "Đã bỏ qua chữ hiệu ứng nghiêng theo cài đặt."
                    regions.append(region)
                    continue
            text, score, language = "", 0, "en"
            try:
                if settings.language != "ja" and not (settings.language == "auto" and vertical):
                    text, score = self.english_text(crop, settings.quality)
                if settings.language == "ja" or (settings.language == "auto" and score < .72):
                    japanese, jp_score = self.japanese_text(crop, check)
                    if settings.language == "ja" or (JP.search(japanese) and jp_score >= .58):
                        text, score, language = japanese, jp_score, "ja"
            except (pytesseract.TesseractNotFoundError, pytesseract.TesseractError) as exc:
                raise RuntimeError("Tesseract tiếng Anh chưa sẵn sàng. Hãy chạy Setup.") from exc
            region.language = language
            region.source = text[:500]
            region.confidence = score
            minimum = .55 if language == "ja" else .50
            if score < minimum or not text or (language == "ja" and not JP.search(text)):
                region.issue = "OCR không đủ tin cậy. Vùng này được giữ nguyên."
            regions.append(region)
        if settings.quality == "low":
            self.japanese = None
        if settings.language == "auto" and regions and sum(r.language == "en" for r in regions) > len(regions)/2:
            boxes = [(pixels(r.box, width, height), None, r) for r in regions]
            regions = [r for _, _, r in ordered(boxes, False)]
        return regions
