import cv2
import numpy as np


def outlined_ink(gray, support, *, dark_level=136):
    """Find letter strokes with a light border inside detector line shapes."""
    white = (gray >= 232).astype(np.uint8)
    dark = (gray < dark_level).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(dark)
    selected = np.zeros(n, np.uint8)
    height = support.shape[0]
    for i, (x, y, w, h, area) in enumerate(stats[1:], 1):
        if not (3 <= area <= 1250 and 2 <= h <= min(height, 48) and w <= 65):
            continue
        left, top = max(0, x-4), max(0, y-4)
        stop_x, stop_y = x+w+4, y+h+4
        sl = np.s_[top:stop_y, left:stop_x]
        stroke = (labels[sl] == i).astype(np.uint8)
        if np.count_nonzero(stroke & support[sl]) < .72*area:
            continue
        ring = (cv2.dilate(stroke, np.ones((7, 7), np.uint8)) != 0) & (stroke == 0)
        if ring.any() and np.mean(white[sl][ring]) >= .53:
            selected[i] = 1
    return selected[labels] & support


def reading_crop(ink):
    gray = np.where(ink, 0, 255).astype(np.uint8)
    return cv2.cvtColor(gray, cv2.COLOR_GRAY2RGB)


def line_support(shape, polygons, margin=0):
    support = np.zeros(shape, np.uint8)
    for polygon in polygons:
        cv2.fillPoly(support, [np.asarray(polygon, dtype=np.int32)], 1)
    if margin:
        size = 2*margin+1
        support = cv2.dilate(support, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (size, size)))
    return support
