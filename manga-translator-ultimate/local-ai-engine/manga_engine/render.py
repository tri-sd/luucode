from functools import lru_cache
from pathlib import Path
import math

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .ocr import pixels

FONTS = Path(__file__).resolve().parents[1] / "fonts"


@lru_cache(maxsize=128)
def font(style, size):
    path = FONTS / ("NotoSans-Italic.ttf" if style == "italic" else "NotoSans.ttf")
    face = ImageFont.truetype(str(path), size)
    axes = face.get_variation_axes()
    values = [700 if axis["name"] == b"Weight" and style == "bold" else axis["default"] for axis in axes]
    face.set_variation_by_axes(values)
    return face


def erase_patch(rgb, region, aggressive):
    height, width = rgb.shape[:2]
    a, b, c, d = pixels(region.box, width, height)
    pad = min(16, max(6, round(min(c-a, d-b)*.2)))
    x, y, r, s = max(0, a-pad), max(0, b-pad), min(width, c+pad), min(height, d+pad)
    patch = rgb[y:s, x:r]
    if min(patch.shape[:2]) < 5:
        return None
    mask = np.zeros(patch.shape[:2], np.uint8)
    for polygon in region.polygons:
        points = np.array([(round(px*width)-x, round(py*height)-y) for px, py in polygon], np.int32)
        cv2.fillPoly(mask, [points], 255)
    if not mask.any():
        return None
    if region.bubble:
        # Allow anti-aliased strokes just outside the detector polygon while
        # refusing components that continue out of the permitted text area.
        mask = cv2.dilate(mask, np.ones((5, 5), np.uint8))
    around = (cv2.dilate(mask, np.ones((9, 9), np.uint8)) > 0) & (mask == 0)
    samples = patch[around]
    if len(samples) < 20:
        return None
    bg = np.median(samples, axis=0)
    dist = np.max(np.abs(patch.astype(np.int16)-bg), axis=2)
    surrounding = np.max(np.abs(samples-bg), axis=1)
    texture = float(np.quantile(surrounding, .76))
    if texture > (38 if aggressive else 27):
        return None
    ink = (dist > max(9, texture*1.65)).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(ink)
    keep = np.zeros(count, np.uint8)
    max_area = np.count_nonzero(mask)*.54
    for component in range(1, count):
        l, t, ww, hh, area = stats[component]
        if not (1 <= area <= max_area and (ww < c-a or hh < d-b)):
            continue
        if np.all(mask[t:t+hh, l:l+ww][labels[t:t+hh, l:l+ww] == component]):
            keep[component] = 255
    clean = keep[labels]
    if not clean.any() or np.count_nonzero(clean) > np.count_nonzero(mask)*.60:
        return None
    clean = cv2.dilate(clean, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
    # Constrain dilation to the actual detected outline.
    clean = cv2.bitwise_and(clean, mask)
    method = cv2.INPAINT_NS if aggressive else cv2.INPAINT_TELEA
    repaired = cv2.inpaint(patch, clean, 3, method)
    if np.median(np.max(np.abs(repaired[clean > 0].astype(np.float32)-bg), axis=1)) > 29:
        return None
    return (x, y, r, s), repaired, bg, clean


def layout(text, rect, style, scale, ellipse):
    x, y, r, b = rect
    width, height = r-x, b-y
    if min(width, height) < 12:
        return None
    words = text.split()
    if not words:
        return None
    min_size = max(10, round(11*min(scale, 1)))
    max_size = min(100, round(max(18, height*.70)*scale), height-2)
    for size in range(max_size, min_size-1, -1):
        face = font(style, size)
        asc, desc = face.getmetrics()
        line_height = max(size+2, round((asc+desc)*.9))
        for count in range(1, min(len(words), height//line_height)+1):
            top = y+(height-count*line_height)//2
            limits = []
            for i in range(count):
                rel = (abs(top+(i+.5)*line_height-(y+height/2)) + size*.40) / (height/2)
                limits.append(width * (math.sqrt(max(0, 1-rel*rel)) if ellipse else 1) - 4)
            lines = []
            start = 0
            for i, limit in enumerate(limits):
                end = start
                while end < len(words) - (count-i-1) and face.getlength(" ".join(words[start:end+1])) <= limit:
                    end += 1
                if end == start:
                    break
                lines.append(" ".join(words[start:end]))
                start = end
            if start == len(words):
                return face, [(round((x+r)/2), top+(i+.5)*line_height, line) for i, line in enumerate(lines)]
    return None


def render(rgb, regions, settings, check, shorten=None):
    result = rgb.copy()
    height, width = rgb.shape[:2]
    rendered = 0
    for region in regions:
        check()
        if not region.text or region.issue:
            continue
        repaired = erase_patch(rgb, region, settings.quality == "quality")
        if repaired is None:
            region.issue = "Nền phức tạp hoặc không tách được nét. Vùng này được giữ nguyên."
            continue
        source_rect, patch, bg, mask = repaired
        placement = region.placement or region.bubble or region.box
        x, y, r, b = pixels(placement, width, height)
        ellipse = region.placement is None and region.bubble is not None
        if ellipse:
            margin = max(3, round(min(r-x, b-y)*.075))
            rect = x+margin, y+margin, r-margin, b-margin
        elif region.placement is None:
            rect = max(0, x-3), max(0, y-3), min(width, r+3), min(height, b+3)
        else:
            rect = x, y, r, b
        style = region.font or settings.font
        scale = region.font_scale or settings.font_scale
        typeset = layout(region.text, rect, style, scale, ellipse)
        if typeset is None and shorten:
            short = shorten(region)
            if short and len(short) < len(region.text):
                typeset = layout(short, rect, style, scale, ellipse)
                if typeset:
                    region.text = short
        if typeset is None:
            region.issue = "Chữ Việt quá dài hoặc vùng quá nhỏ. Hãy sửa văn bản hoặc vị trí."
            continue
        a, t, c, d = source_rect
        rx, ry, rr, rb = rect
        left, top, right, bottom = min(a, rx), min(t, ry), max(c, rr), max(d, rb)
        working = result[top:bottom, left:right].copy()
        old = working[t-top:d-top, a-left:c-left]
        old[mask > 0] = patch[mask > 0]
        image = Image.fromarray(working)
        draw = ImageDraw.Draw(image)
        face, lines = typeset
        color = (21, 21, 25) if np.dot(bg, [.299, .587, .114]) > 115 else (250, 250, 250)
        for tx, ty, line in lines:
            box = draw.textbbox((tx, ty), line, font=face, anchor="mm")
            if box[0] < rx or box[1] < ry or box[2] > rr or box[3] > rb:
                region.issue = "Dấu hoặc chữ vượt lề. Hãy chỉnh vị trí."
                break
            draw.text((tx-left, ty-top), line, font=face, fill=color, anchor="mm")
        else:
            result[top:bottom, left:right] = np.asarray(image)
            rendered += 1
    return result, rendered
