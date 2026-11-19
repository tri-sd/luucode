import math
import os
import re
import threading
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort
import pytesseract
import rapidocr_onnxruntime
from PIL import Image
from rapidocr_onnxruntime.ch_ppocr_det import TextDetector

from .contracts import Region
from .balloons import group_light_balloons, light_ink, raster, split_connected_balloon, text_blocks
from .narration import line_support, outlined_ink, reading_crop

ROOT = Path(__file__).resolve().parents[2]
MODELS = ROOT / "models"
os.environ.setdefault("OMP_THREAD_LIMIT", "1")
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
    radius = min(384, max(120, int(max(rh, rw)*2.1)))
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
        if count < w*h*.40 or w*h > max(65_000, 48*rw*rh) or w*h > 420_000:
            continue
        box = a+l, b+t, a+l+w, b+t+h
        component_cache.append((box, mask[t+1:t+h+1, l+1:l+w+1].copy()))
        return box
    return None


def recover_balloon_ink(gray, bubble, component, polygons):
    """Recover missed glyphs inside an enclosed, flat speech bubble."""
    x, y, r, d = bubble
    patch = gray[y:d, x:r]
    bg = float(np.median(patch[component != 0]))
    outline, _ = cv2.findContours(component, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if len(outline) != 1:
        return polygons
    inside = np.zeros_like(patch)
    cv2.drawContours(inside, outline, -1, 255, cv2.FILLED)
    inside = cv2.erode(inside, np.ones((7, 7), np.uint8), borderType=cv2.BORDER_CONSTANT, borderValue=0)
    contrast = np.abs(patch.astype(np.float32)-bg)
    count, labels, stats, _ = cv2.connectedComponentsWithStats((contrast > 28).astype(np.uint8))
    typical = np.median([max(4, min(np.ptp(p[:,0]), np.ptp(p[:,1]))) for p in polygons])
    envelope = np.zeros_like(patch)
    for polygon in polygons:
        cv2.fillPoly(envelope, [polygon - [x,y]], 255)
    recovered = list(polygons)
    for i in range(1, count):
        a, b, w, h, area = stats[i]
        if not (4 <= area <= 5*typical**2 and max(w,h) <= 5*typical):
            continue
        if a < 2 or b < 2 or a+w+2 > r-x or b+h+2 > d-y:
            continue
        window = np.s_[b-2:b+h+2, a-2:a+w+2]
        glyph = labels[window] == i
        if not inside[window].all() or envelope[window][glyph].all():
            continue
        l, t, rr, dd = x+a-2, y+b-2, x+a+w+1, y+b+h+1
        recovered.append(np.array([(l,t),(rr,t),(rr,dd),(l,dd)], dtype=np.int32))
    return recovered


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


WRAP_DASH = re.compile(r"([A-Za-z]{2,})\s*[-‐‑‒–−\u00ad]$")
HONORIFICS = {"sama", "san", "chan", "kun", "dono", "senpai", "sensei"}
TRUE_HYPHEN_COMPOUNDS = {
    "co": {"founder","worker","pilot"},
    "ex": {"husband","wife","president","partner"},
    "self": {"control","defense","esteem","respect","contained","destruct"},
    "vice": {"president","captain","chair"},
    "well": {"known","being","done","written","established"},
}
DETACHED_SUFFIXES = {"ing", "tion", "tions", "sion", "sions", "ment", "ments", "lessly"}


def join_english_lines(lines):
    full = ""
    for raw in lines:
        line = " ".join(raw.split())
        if not line:
            continue
        wrapped = WRAP_DASH.search(full)
        next_word = re.match(r"[A-Za-z]{2,}",line)
        if wrapped and next_word:
            prefix = wrapped.group(1).lower()
            verbatim = re.search(r"[A-Za-z]-[A-Za-z]{2,}\s*[-‐‑‒–−]$",full)
            suffix = next_word.group().lower()
            keep_dash = suffix in HONORIFICS or suffix in TRUE_HYPHEN_COMPOUNDS.get(prefix, ()) or verbatim
            full = full[:wrapped.end(1)] + ("-" if keep_dash else "") + line
        elif (next_word and next_word.group().lower() in DETACHED_SUFFIXES
              and re.search(r"[A-Za-z]{4,}$",full)):
            full += line
        else:
            full = f"{full} {line}".strip()
    return full


# In thick italic capitals, I and TO can look like J/T and 10. Only flag
# the shapes when neighboring English words make the interpretation clear.
OCR_PRONOUN = re.compile(r"(?<!\w)[JT](?=['’](?:LL|VE|D|M)\b|\s+(?:AM|CAN'T|CANNOT)\b)", re.I)
OCR_INFINITIVE = re.compile(r"\b(powerless|able|unable) 10(?= [a-z]{3,}\b)", re.I)
OCR_CONJUNCTION = re.compile(r"\bAN[P?] (?=I[.?!,]?$)", re.I)
OCR_SUBJECT_ONE = re.compile(r"(\bBY [A-Z][A-Z'-]{1,}(?: [A-Z][A-Z'-]{1,}){0,2} AND )1(?=[.?!]?$)", re.I)


def suspicious_letters(text):
    return (len(OCR_PRONOUN.findall(text)) + 2*len(OCR_INFINITIVE.findall(text))
            + 2*len(OCR_CONJUNCTION.findall(text)))


def repair_letter_confusions(text):
    text = OCR_PRONOUN.sub("I", text)
    text = OCR_INFINITIVE.sub(r"\1 TO", text)
    text = OCR_CONJUNCTION.sub("AND ", text)
    return OCR_SUBJECT_ONE.sub(r"\1I",text)


def straighten_letters(image, slant):
    height, width = image.shape
    pad = round(slant*height/2)+4
    transform = np.float32([[1,slant,pad-slant*height/2],[0,1,0]])
    return cv2.warpAffine(image, transform, (width+2*pad,height), borderValue=255)


def english_line_bands(gray, scale, detected):
    counts = np.count_nonzero(gray[8:-8,8:-8] < min(180, np.median(gray)-30),axis=1)
    strong = np.pad((counts >= max(3,counts.max()*.21)).astype(np.uint8),(8,8))
    strong = cv2.morphologyEx(strong[:,None],cv2.MORPH_CLOSE,np.ones((5,1),np.uint8))[:,0] != 0
    starts = np.flatnonzero(strong & ~np.r_[False,strong[:-1]])
    ends = np.flatnonzero(strong & ~np.r_[strong[1:],False])+1
    observed = [(a,b) for a,b in zip(starts,ends) if b-a >= 3]
    trusted = []
    for a,b in sorted(detected):
        a,b = max(8,a*scale+8), min(len(gray)-8,b*scale+8)
        if b-a < 3:
            continue
        if trusted and min(trusted[-1][1],b)-a >= .5*min(b-a,trusted[-1][1]-trusted[-1][0]):
            trusted[-1] = (trusted[-1][0], max(trusted[-1][1],b))
        else:
            trusted.append((a,b))
    if not trusted:
        return observed
    typical = np.median([b-a for a,b in trusted])
    for a,b in observed:
        near = any(min(b,right+3)-max(a,left-3) > 0 for left,right in trusted)
        if not near and b-a >= .35*typical:
            trusted.append((a,b))
    return sorted(trusted)


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
    def english_text(crop, quality, verify_lines=False, detected_lines=()):
        gray = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY)
        scale = 2 if min(gray.shape) < 90 else 1
        if scale == 2:
            gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        gray = cv2.copyMakeBorder(gray, 8, 8, 8, 8, cv2.BORDER_REPLICATE)
        candidates = [(gray, 6)]
        if verify_lines or quality == "quality":
            binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)[1]
            candidates.append((binary, 6))
        if verify_lines:
            candidates.append((binary, 11))
            bands = english_line_bands(gray,scale,detected_lines)
        best, rank = ("", 0), -1
        best_letters = 0
        tried_slant = False
        for image, mode in candidates:
            data = pytesseract.image_to_data(image, lang="eng", config=f"--psm {mode}",
                                            output_type=pytesseract.Output.DICT, timeout=12)
            usable = [i for i,word in enumerate(data["text"]) if word.strip() and float(data["conf"][i]) >= 0]
            if not usable:
                continue
            if verify_lines and any(not any(re.search(r"[A-Za-z0-9]",data["text"][i]) and
                    a-max(3,(b-a)*.24) <= data["top"][i]+data["height"][i]/2 <= b+max(3,(b-a)*.24)
                    for i in usable) for a,b in bands):
                continue
            words = [(data["text"][i].strip(),float(data["conf"][i])) for i in usable]
            score = sum(c*len(w) for w,c in words) / (100*sum(len(w) for w,_ in words))
            lines = {}
            order = sorted(usable,key=lambda i:data["top"][i]) if verify_lines else usable
            for i in order:
                key = tuple(data[field][i] for field in ("block_num","par_num","line_num"))
                lines.setdefault(key, []).append(i)
            phrase = join_english_lines(" ".join(data["text"][i].strip()
                for i in sorted(line,key=lambda i:data["left"][i])) for line in lines.values())
            suspicious = suspicious_letters(phrase) if verify_lines else 0
            if suspicious and quality != "low" and not tried_slant:
                candidates.extend((straighten_letters(gray,slant),6) for slant in (.14,.22))
                tried_slant = True
            candidate_rank = score-.12*suspicious
            letters = sum(character.isalnum() for character in phrase)
            # Sparse OCR can give a high score to only half of a paragraph.
            # Do not let a cleaner-looking partial result replace a full read.
            if verify_lines and best_letters and letters < .85*best_letters:
                continue
            if candidate_rank > rank and re.search(r"[a-zA-Z]",phrase):
                best, rank = (phrase,score), candidate_rank
                best_letters = letters
            if score >= .84 and not suspicious:
                break
        if verify_lines and best[1] < .50 and 2 <= len(bands) <= 18:
            # Hand lettering can confuse whole-balloon line segmentation.
            # Recover line by line, but only accept the balloon when all read.
            recovered = []
            for index,(a,b) in enumerate(bands):
                top = (bands[index-1][1]+a)//2 if index else max(0,a-8)
                bottom = (bands[index+1][0]+b)//2 if index+1 < len(bands) else min(len(gray),b+8)
                data = pytesseract.image_to_data(gray[top:bottom],lang="eng",config="--psm 7",
                                                output_type=pytesseract.Output.DICT,timeout=6)
                words = [(word.strip(),float(conf)) for word,conf in zip(data["text"],data["conf"])
                         if word.strip() and float(conf) >= 0]
                if not words or not any(re.search(r"[A-Za-z0-9]",word) for word,_ in words):
                    break
                score = sum(conf*len(word) for word,conf in words)/(100*sum(len(word) for word,_ in words))
                if score < .47:
                    break
                recovered.append((" ".join(word for word,_ in words), score))
            if len(recovered) == len(bands):
                phrase = join_english_lines(word for word,_ in recovered)
                return repair_letter_confusions(phrase), float(np.mean([score for _,score in recovered]))
        return (repair_letter_confusions(best[0]),best[1]) if verify_lines else best

    def regions(self, rgb, settings, check):
        height, width = rgb.shape[:2]
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        polys = self.detect(rgb, settings.quality, check)
        grouped = []
        claimed = set()
        boxes = [bounds(p) for p in polys]

        def prepare_balloon(bubble, outline, members, separated=False):
            x, y, r, b = bubble
            patch = rgb[y:b,x:r]
            inside = raster(outline-[x,y], patch.shape[:2], 3)
            if members:
                detected_area = sum(cv2.contourArea(polys[i]) for i in members)
                if (r-x)*(b-y) > 7*max(1,detected_area):
                    patch_gray = gray[y:b,x:r]
                    midtone = (patch_gray > 135) & (patch_gray < 225)
                    # Texture inside a large, mostly bright component is evidence
                    # of artwork; the bounding box alone also includes valid art
                    # around narrow or clipped balloons.
                    interior = inside != 0
                    textured_interior = np.count_nonzero(midtone & interior) > .044*np.count_nonzero(interior)
                    at_corner = (x == 0 or r == width) and (y == 0 or b == height)
                    if np.mean(midtone) > .12 and (textured_interior or at_corner):
                        return None
            if separated:
                # A joined burst can enclose an artwork fragment between lobes.
                # Read the column supported by the text detector, including
                # space for a nearby wrapped line on each end.
                line_boxes = [boxes[i] for i in members]
                typical = max(8,round(np.median([end-top for _,top,_,end in line_boxes])))
                left = max(0,min(l for l,_,_,_ in line_boxes)-x-round(typical*.5))
                right = min(r-x,max(end for _,_,end,_ in line_boxes)-x+round(typical*.5))
                top = max(0,min(t for _,t,_,_ in line_boxes)-y-typical)
                bottom = min(b-y,max(end for _,_,_,end in line_boxes)-y+typical)
                focus = np.zeros_like(inside)
                focus[top:bottom,left:right] = inside[top:bottom,left:right]
                inside = focus
            evidence = light_ink(patch, inside)
            if evidence is None:
                return None
            background, ink = evidence
            yy, xx = np.where(ink)
            a, t, c, d = max(0,xx.min()-5), max(0,yy.min()-5), min(r-x,xx.max()+6), min(b-y,yy.max()+6)
            crop = np.where(inside[t:d,a:c,None] != 0, patch[t:d,a:c], background).astype(np.uint8)
            lines = [polys[i] for i in members]
            vertical = (sum(np.ptp(p[:,1]) > 1.4*np.ptp(p[:,0]) for p in lines) > len(lines)/2
                        if lines else settings.language == "ja" and (d-t) > 1.4*(c-a))
            return (x+a,y+t,x+c,y+d), bubble, (lines, vertical, outline, crop)

        def add_balloon(bubble, outline, members):
            # The light fill may join several distinct speech areas. Keep
            # horizontal lettering in its own block before doing OCR.
            if settings.language != "ja" and len(members) >= 2:
                boxes_in_balloon = [boxes[i] for i in members]
                if sum((b-y) > 1.4*(r-x) for x,y,r,b in boxes_in_balloon) <= len(members)/2:
                    x,y,r,b = bubble
                    parts = split_connected_balloon(gray[y:b,x:r], bubble, outline, boxes_in_balloon)
                    entries = [prepare_balloon(area, shape, [members[i] for i in indices], separated=True)
                               for area, shape, indices in parts]
                    if entries and all(entries):
                        grouped.extend(entries)
                        claimed.update(members)
                        return
            entry = prepare_balloon(bubble, outline, members)
            if entry is not None:
                grouped.append(entry)
                claimed.update(members)

        for bubble, outline, members in group_light_balloons(gray, boxes):
            add_balloon(bubble, outline, members)
        missing = [index for index in range(len(boxes)) if index not in claimed]
        if missing:
            for bubble, outline, members in group_light_balloons(
                    gray, [boxes[i] for i in missing], separate_leaks=True):
                if not any(coverage(bubble, found) > .65 for _,found,_ in grouped):
                    add_balloon(bubble, outline, [missing[i] for i in members])

        if settings.language != "ja":
            free = []
            for i, polygon in enumerate(polys):
                if i in claimed:
                    continue
                x, y, r, b = boxes[i]
                if r-x < (b-y)*1.12:
                    continue
                line = polygon[1]-polygon[0]
                if abs(line[1]) > .32*abs(line[0]):
                    continue
                free.append(i)
            for cluster in text_blocks([boxes[i] for i in free], leading_ratio=.75):
                members = [free[i] for i in cluster]
                lines = [polys[i] for i in members]
                x, y, r, b = bounds(np.concatenate(lines))
                x, y, r, b = max(0,x-4), max(0,y-4), min(width,r+4), min(height,b+4)
                patch = gray[y:b,x:r]
                support = line_support(patch.shape, [p-[x,y] for p in lines], 2)
                ink = outlined_ink(patch, support)
                if np.count_nonzero(ink) < max(14, .045*np.count_nonzero(support)):
                    continue
                grouped.append(((x,y,r,b), None, (lines, False, None, reading_crop(ink))))
                claimed.update(members)

        groups = defaultdict(list)
        component_cache = []
        for index, poly in enumerate(polys):
            if index in claimed:
                continue
            box = bounds(poly)
            bubble = bubble_for(gray, box, component_cache)
            if bubble is not None:
                # The same component is normally found from several line crops.
                bubble = next((key for key in groups if key[0] and coverage(key[1], bubble) > .90), (True, bubble))[1]
            groups[(bubble is not None, bubble or box)].append(poly)
        components = dict(component_cache)
        for (inside, box), lines in groups.items():
            vertical = sum(np.ptp(p[:,1]) > 1.4*np.ptp(p[:,0]) for p in lines) > len(lines)/2
            ink = recover_balloon_ink(gray, box, components[box], lines) if inside else lines
            grouped.append((bounds(np.concatenate(ink)), box if inside else None, (ink, vertical, None, None)))
        manga = settings.language != "en"
        if len(grouped) > 180:
            raise ValueError("Ảnh có quá nhiều vùng chữ. Hãy cắt ảnh thành các đoạn ngắn hơn.")
        regions = []
        to_read = []
        for index, (rect, bubble, (polys, vertical, outline, full_crop)) in enumerate(ordered(grouped, manga), 1):
            check()
            x, y, r, d = rect
            pad = max(3, min(12, round(min(r-x, d-y)*.12)))
            crop = full_crop if full_crop is not None else rgb[max(0, y-pad):min(height, d+pad), max(0, x-pad):min(width, r+pad)]
            region = Region(id=f"r{index}", box=normalize(rect, width, height),
                            polygons=[[(int(a)/width, int(b)/height) for a, b in p] for p in polys],
                            balloon_outline=[(int(a)/width,int(b)/height) for a,b in outline] if outline is not None else None,
                            orientation="vertical" if vertical else "horizontal",
                            narration=bubble is None and full_crop is not None,
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
            regions.append(region)
            detected_lines = [(int(p[:,1].min())-y, int(p[:,1].max())+1-y)
                              for p in polys if (outline is not None or region.narration) and not vertical]
            retry = (gray[y:d,x:r], [p-[x,y] for p in polys]) if region.narration else None
            to_read.append((region,crop,vertical,detected_lines,retry))

        def recognize(entry):
            region,crop,vertical,detected_lines,retry = entry
            text, score, language = "", 0, "en"
            try:
                if settings.language != "ja" and not (settings.language == "auto" and vertical):
                    text, score = self.english_text(crop, settings.quality,
                                                               region.balloon_outline is not None or region.narration, detected_lines)
                    if retry is not None and score < .59 and len(detected_lines) >= 2:
                        patch, lines = retry
                        support = line_support(patch.shape, lines, 2)
                        cleaned = reading_crop(outlined_ink(patch, support, dark_level=113))
                        candidate, confidence = self.english_text(cleaned, settings.quality, True, detected_lines)
                        if confidence > score and len(re.findall(r"[A-Za-z]{2,}", candidate)) >= 4:
                            text, score = candidate, confidence
                if settings.language == "ja" or (settings.language == "auto" and score < (.40 if region.narration else .72)):
                    japanese, jp_score = self.japanese_text(crop, check)
                    if settings.language == "ja" or (JP.search(japanese) and jp_score >= .58):
                        text, score, language = japanese, jp_score, "ja"
            except (pytesseract.TesseractNotFoundError, pytesseract.TesseractError) as exc:
                raise RuntimeError("Tesseract tiếng Anh chưa sẵn sàng. Hãy chạy Setup.") from exc
            if region.narration and language == "en":
                text = re.sub(r"^[^A-Za-z.]+", "", text)
                text = re.sub(r"\bYETHIS\b", "YET HIS", text, flags=re.I)
                text = re.sub(r"\bTHEREWERE\b", "THERE WERE", text, flags=re.I)
                text = re.sub(r"\bSOME[~=]+\s+THING\b", "SOMETHING", text, flags=re.I)
                text = re.sub(r"\bJUSTTONE\b", "JUST ONE", text, flags=re.I)
                text = re.sub(r"^ZT (?=ONLY\b)", "I ", text, flags=re.I)
                text = re.sub(r"^AT (?=COULD NOT\b)", "IT ", text, flags=re.I)
                text = re.sub(r"[-=>]+[.:]*$", "...", text)
                capital_words = re.findall(r"\b[A-Z]{2,}\b", text)
                if len(capital_words) >= 3:
                    text = re.sub(r"(?<=[.!?])\s+[A-Z][a-z]$", "", text)
                    if "(" in text and ")" not in text:
                        text = re.sub(r"\((?=[A-Z])", "", text)
            region.language = language
            region.source = text[:500]
            region.confidence = score
            minimum = .55 if language == "ja" else .50
            if region.narration:
                minimum = .40 if len(detected_lines) >= 3 and len(re.findall(r"[A-Za-z]{2,}", text)) >= 4 else .59
                if not settings.sfx and len(re.findall(r"[A-Za-z]{2,}", text)) < 2 and len(region.polygons) < 2:
                    region.issue = "Chữ đứng riêng không đủ dấu hiệu là lời dẫn."
            if not region.polygons:
                minimum = .80 if language == "ja" else .67
            if len(text) > 500:
                region.issue = "Nội dung vượt giới hạn một vùng, cần kiểm tra thủ công."
            elif score < minimum or not text or (language == "ja" and not JP.search(text)):
                region.issue = "OCR không đủ tin cậy. Vùng này được giữ nguyên."

        if settings.language == "en" and settings.quality != "low" and len(to_read) > 1:
            with ThreadPoolExecutor(max_workers=2) as workers:
                for _ in workers.map(recognize,to_read):
                    check()
        else:
            for entry in to_read:
                check()
                recognize(entry)
        if settings.quality == "low":
            self.japanese = None
        if settings.language == "auto" and regions and sum(r.language == "en" for r in regions) > len(regions)/2:
            boxes = [(pixels(r.box, width, height), None, r) for r in regions]
            regions = [r for _, _, r in ordered(boxes, False)]
        return regions
