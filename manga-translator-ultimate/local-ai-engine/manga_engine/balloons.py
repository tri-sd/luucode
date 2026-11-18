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


def _missing_line_bridge(ink, box, other, height):
    x,y,r,b = box
    left,top,right,bottom = other
    gap = ink[b:top, max(0,x,left):min(r,right)]
    if gap.size == 0:
        return False
    occupied = np.count_nonzero(gap,axis=1) >= 2
    rows = np.flatnonzero(occupied)
    return rows.size > 0 and np.max(np.diff(np.r_[-1, rows, len(occupied)])) <= 1.2*height


def text_blocks(boxes, ink=None):
    """Group printed fragments into lines and vertically aligned text blocks."""
    lines = []
    for index in sorted(range(len(boxes)), key=lambda i: (boxes[i][1], boxes[i][0])):
        x, y, r, b = boxes[index]
        for line in lines:
            left, top, right, bottom, members = line
            height = min(b-y, bottom-top)
            overlap_y = min(b, bottom)-max(y, top)
            gap_x = max(x-right, left-r, 0)
            if overlap_y >= .57*height and gap_x <= .45*height:
                line[:] = [min(x,left), min(y,top), max(r,right), max(b,bottom), [*members, index]]
                break
        else:
            lines.append([x, y, r, b, [index]])

    blocks = []
    for left, top, right, bottom, members in sorted(lines, key=lambda line: (line[1], line[0])):
        best, best_score = None, float("inf")
        for block in blocks:
            x, y, r, b, _ = block[-1]
            height = max(b-y, bottom-top)
            leading = top-b
            overlap_x = min(r,right)-max(x,left)
            if leading < -.28*height or overlap_x < .55*min(r-x,right-left):
                continue
            if leading > 1.2*height and (ink is None or not _missing_line_bridge(
                    ink,(x,y,r,b),(left,top,right,bottom),height)):
                continue
            offset = abs((left+right)-(x+r))/2
            score = max(0,leading) + .25*offset
            if score < best_score:
                best, best_score = block, score
        line = (left, top, right, bottom, members)
        if best is None:
            blocks.append([line])
        else:
            best.append(line)
    return [[member for *_, members in block for member in members] for block in blocks]


def split_connected_balloon(gray, bubble, outline, boxes):
    """Partition a connected light interior when the text forms separate blocks."""
    x, y, right, bottom = bubble
    shape = (bottom-y, right-x)
    local_boxes = [(a-x,t-y,r-x,b-y) for a,t,r,b in boxes]
    if len(text_blocks(local_boxes)) < 2:
        return []
    interior = raster(np.asarray(outline)-[x,y],shape)
    ink = (gray < 180) & (interior != 0)
    blocks = text_blocks(local_boxes,ink)
    if not 2 <= len(blocks) <= 12:
        return []
    # Assign white space to its nearest text block. The actual detected lines
    # are the seeds, so the partition never depends on OCR word spelling.
    distance = np.full(shape,np.inf,dtype=np.float32)
    owner = np.zeros(shape,dtype=np.uint8)
    for label, block in enumerate(blocks,1):
        seeds = np.ones(shape,dtype=np.uint8)
        for i in block:
            l,t,r,b = boxes[i]
            seeds[max(0,t-y):min(shape[0],b-y), max(0,l-x):min(shape[1],r-x)] = 0
        values = cv2.distanceTransform(seeds,cv2.DIST_L2,cv2.DIST_MASK_3)
        closer = values < distance
        distance[closer] = values[closer]
        owner[closer] = label

    result = []
    for label, block in enumerate(blocks,1):
        area = ((owner == label) & (interior != 0)).astype(np.uint8)
        contours, _ = cv2.findContours(area,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            return []
        contour = max(contours,key=cv2.contourArea)
        polygon = cv2.approxPolyDP(contour,.55,True).reshape(-1,2)
        if len(polygon) < 4:
            return []
        l,t,w,h = cv2.boundingRect(contour)
        if min(w,h) < 18:
            return []
        for i in block:
            a,c,r,b = boxes[i]
            center = (float((a+r)/2-x), float((c+b)/2-y))
            if cv2.pointPolygonTest(polygon,center,False) < 0:
                return []
        result.append(((x+l,y+t,x+l+w,y+t+h),polygon+[x,y],block))
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
