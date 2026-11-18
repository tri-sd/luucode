"""Find flat, light balloon interiors, including those clipped at an image edge."""
import cv2
import numpy as np


def raster(outline, shape, margin=0):
    mask = np.zeros(shape, np.uint8)
    cv2.fillPoly(mask, [np.asarray(outline, dtype=np.int32)], 255)
    if margin:
        mask = cv2.erode(mask, np.ones((2*margin+1, 2*margin+1), np.uint8),
                         borderType=cv2.BORDER_CONSTANT, borderValue=0)
    return mask


def group_light_balloons(gray, boxes):
    height, width = gray.shape
    # Manga lettering typically leaves most of each detected box as background.
    _, labels, stats, _ = cv2.connectedComponentsWithStats((gray >= 218).astype(np.uint8), connectivity=4)
    by_label = {}
    for index, (x, y, r, b) in enumerate(boxes):
        a, c = max(0,x-3), max(0,y-3)
        sample = labels[c:min(height,b+3), a:min(width,r+3)]
        ids, counts = np.unique(sample[sample != 0], return_counts=True)
        if ids.size:
            strongest = counts.argmax()
            if counts[strongest] >= sample.size*.27:
                by_label.setdefault(ids[strongest], []).append(index)
    result = []
    for label, members in by_label.items():
        x,y,w,h,area = stats[label]
        if not (min(w,h) >= 21 and area >= w*h*.31 and w*h <= width*height*.54):
            continue
        edges = (x == 0, y == 0, x+w == width, y+h == height)
        if sum(edges) > 2 or (edges[0] and edges[2]) or (edges[1] and edges[3]):
            continue
        region = (labels[y:y+h,x:x+w] == label).astype(np.uint8)
        contours, _ = cv2.findContours(region, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if len(contours) != 1:
            continue
        outline = cv2.approxPolyDP(contours[0], .65, True).reshape(-1,2)
        if len(outline) < 4:
            continue
        # A broad, ink-filled hole is likely artwork. Defer to the conservative path.
        inside = raster(outline,(h,w),3)
        patch = gray[y:y+h,x:x+w]
        holes = (inside != 0) & (patch < 195)
        n, _, ink_stats, _ = cv2.connectedComponentsWithStats(holes.astype(np.uint8))
        if not holes.any() or holes.sum() > np.count_nonzero(inside)*.32:
            continue
        box_height = max(8, int(np.median([boxes[i][3]-boxes[i][1] for i in members])))
        if n > 1 and (ink_stats[1:,4].max() > max(box_height**2*2, area*.035)):
            continue
        # Ensure each associated box actually points into the component's contour.
        if not all(x <= (boxes[i][0]+boxes[i][2])//2 < x+w and
                   y <= (boxes[i][1]+boxes[i][3])//2 < y+h and
                   inside[(boxes[i][1]+boxes[i][3])//2-y,(boxes[i][0]+boxes[i][2])//2-x]
                   for i in members):
            continue
        result.append(((x,y,x+w,y+h), outline + [x,y], members))
    return result


def light_ink(patch, inside):
    values = patch[inside != 0]
    if not values.size:
        return None
    background = np.quantile(values,.80,axis=0)
    if np.min(background) < 210:
        return None
    ink = (np.max(background-patch, axis=2) > 16) & (inside != 0)
    if not ink.any() or np.count_nonzero(ink) > .34*len(values):
        return None
    return background, ink
