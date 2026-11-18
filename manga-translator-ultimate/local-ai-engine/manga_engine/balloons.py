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


def lettering_clusters(components, width, height):
    """Require several glyph-sized marks aligned as one or more text lines."""
    glyphs = [(x,y,w,h) for x,y,w,h,area in components
              if 8 <= area and 3 <= w <= width*.66 and 5 <= h <= height*.40
              and .09 <= w/h <= 5]
    if len(glyphs) < 4:
        return False
    for vertical in (False, True):
        rows = []
        for x,y,w,h in sorted(glyphs, key=lambda glyph: glyph[0 if vertical else 1]):
            start, extent = (x,w) if vertical else (y,h)
            match = next((row for row in rows
                          if abs(row[0]-start-extent/2) <= max(3,extent*.45)), None)
            if match is None:
                rows.append([start+extent/2, 1])
            else:
                match[1] += 1
        if any(row[1] >= 5 for row in rows) or sum(row[1] >= 3 for row in rows) >= 2:
            return True
    return False


def group_light_balloons(gray, boxes, *, separate_leaks=False):
    height, width = gray.shape
    # Manga lettering typically leaves most of each detected box as background.
    bright = (gray >= 218).astype(np.uint8)
    if separate_leaks:
        # Tear narrow bridges across gaps in a panel/balloon border.
        bright = cv2.morphologyEx(bright, cv2.MORPH_OPEN,
                                  cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(7,7)))
    _, labels, stats, _ = cv2.connectedComponentsWithStats(bright, connectivity=4)
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
    sizes = stats[:, 2:4]
    plausible = (sizes.min(axis=1) >= 21) & (stats[:,4] >= sizes.prod(axis=1)*.31)
    plausible[0] = False
    for label in by_label if separate_leaks else np.flatnonzero(plausible):
        if not plausible[label]:
            continue
        members = by_label.get(label, [])
        x,y,w,h,area = stats[label]
        edges = (x == 0, y == 0, x+w == width, y+h == height)
        if w*h > width*height*.64 or all(edges):
            continue
        # The image reader can cut one balloon through two edges of a strip.
        # A strip-filling bright margin should never become a dialogue region.
        spanning = (edges[0] and edges[2]) or (edges[1] and edges[3])
        if spanning and not (w < width*.64 or h < height*.64):
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
        if not holes.any() or holes.sum() > np.count_nonzero(inside)*.32:
            continue
        n, _, ink_stats, _ = cv2.connectedComponentsWithStats(holes.astype(np.uint8))
        glyph_height = max(8, int(np.median([boxes[i][3]-boxes[i][1] for i in members]))) if members else 8
        if n > 1 and ink_stats[1:,4].max() > max(glyph_height**2*2, area*.035):
            continue
        if not members and not lettering_clusters(ink_stats[1:], w, h):
            continue
        if spanning and not lettering_clusters(ink_stats[1:], w, h):
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
