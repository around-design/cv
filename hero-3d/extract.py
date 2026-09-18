#!/usr/bin/env python3
"""Recover strokes by pairing chains at junctions (good continuation)."""
from pathlib import Path
import json
import math
from collections import defaultdict
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from scipy.interpolate import splprep, splev
from skimage.morphology import skeletonize
from skimage.measure import find_contours

SRC = Path("/Users/kuschilop/.cursor/projects/Users-kuschilop-Dropbox-around-design-www-cv-around-design/assets/design-line_src-1ceba81f-b403-4b4a-b805-e4c4ddc30ffa.png")
OUT = Path("/Users/kuschilop/Dropbox/around.design/www/cv.around.design/hero-3d")
OUT.mkdir(exist_ok=True)
EIGHT = np.ones((3, 3), dtype=int)

im = Image.open(SRC).convert("RGBA")
arr = np.array(im)
h, w = arr.shape[:2]
ink = np.maximum(arr[..., :3].astype(np.float32).max(axis=2), arr[..., 3].astype(np.float32))
mask = ink > 20

# ----- star -----
eroded = ndimage.binary_erosion(mask, iterations=2)
lab, nlab = ndimage.label(eroded)
star_i = max(range(1, nlab + 1), key=lambda i: int((lab == i).sum()) if 80 < (lab == i).sum() < 800 else -1)
star_seed = lab == star_i
star_mask = ndimage.binary_dilation(star_seed, iterations=5) & mask
lab2, _ = ndimage.label(star_mask)
star_mask = lab2 == lab2[star_seed][0]
cy, cx = (float(v) for v in ndimage.center_of_mass(star_mask))
cont = max(find_contours(star_mask.astype(float), 0.5), key=len)
star_c = np.stack([cont[:, 1], cont[:, 0]], 1)
aa = np.arctan2(star_c[:, 1] - cy, star_c[:, 0] - cx)
rr = np.hypot(star_c[:, 0] - cx, star_c[:, 1] - cy)
ordr = np.argsort(aa)
aa, rr = aa[ordr], rr[ordr]
grid = np.linspace(-np.pi, np.pi, 360, endpoint=False)
rg = np.interp(grid, np.concatenate([aa - 2 * np.pi, aa, aa + 2 * np.pi]), np.concatenate([rr, rr, rr]))
peaks = [i for i in range(360) if rg[i] >= rg[i - 1] and rg[i] >= rg[(i + 1) % 360] and rg[i] > rg.mean()]
peaks_n = []
for i in peaks:
    if peaks_n and min(abs(i - peaks_n[-1]), 360 - abs(i - peaks_n[-1])) < 12:
        if rg[i] > rg[peaks_n[-1]]:
            peaks_n[-1] = i
        continue
    peaks_n.append(i)
if len(peaks_n) >= 2 and min(abs(peaks_n[0] - peaks_n[-1]), 360 - abs(peaks_n[0] - peaks_n[-1])) < 12:
    peaks_n.pop() if rg[peaks_n[0]] >= rg[peaks_n[-1]] else peaks_n.pop(0)
star_poly = []
for k, i in enumerate(peaks_n):
    j = peaks_n[(k + 1) % len(peaks_n)]
    sl = list(range(i, 360)) + list(range(0, j)) if j <= i else list(range(i, j))
    v = min(sl, key=lambda t: rg[t])
    th = grid[i]
    star_poly.append([cx + rg[i] * math.cos(th), cy + rg[i] * math.sin(th)])
    th = grid[v]
    star_poly.append([cx + rg[v] * math.cos(th), cy + rg[v] * math.sin(th)])
star_poly = np.array(star_poly)

# ----- skeleton of the line (no star, no plane) -----
line_mask = mask.copy()
line_mask[ndimage.binary_dilation(star_mask, iterations=5)] = False
line_mask[:, 960:] = False
skel = skeletonize(line_mask)
sset = set(zip(*np.where(skel)))

def nbrs(p):
    y, x = p
    return [(y + dy, x + dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1)
            if not (dy == dx == 0) and (y + dy, x + dx) in sset]

deg = {p: len(nbrs(p)) for p in sset}

# prune short spurs
changed = True
while changed:
    changed = False
    for e in [p for p, d in deg.items() if d == 1]:
        path = [e]
        prv, cur = None, e
        while True:
            nxts = [q for q in nbrs(cur) if q != prv]
            if len(nxts) != 1:
                break
            prv, cur = cur, nxts[0]
            path.append(cur)
            if deg.get(cur, 0) != 2:
                break
        if 1 < len(path) <= 12 and deg.get(path[-1], 0) >= 3:
            for p in path[:-1]:
                sset.discard(p)
            changed = True
    if changed:
        deg = {p: len(nbrs(p)) for p in sset}

# nodes: endpoints + junctions
nodes = [p for p, d in deg.items() if d != 2]
node_set = set(nodes)
print("nodes", len(nodes), "ends", sum(1 for p in nodes if deg[p] == 1), "junc", sum(1 for p in nodes if deg[p] >= 3))

def walk_chain(start, nxt):
    chain = [start, nxt]
    prv, cur = start, nxt
    while cur not in node_set:
        cand = [q for q in nbrs(cur) if q != prv]
        if not cand:
            break
        prv, cur = cur, cand[0]
        chain.append(cur)
    return chain

# undirected edges: list of pixel chains (yx)
edges = []  # {id, a, b, chain}
seen = set()

def ek(a, b):
    return (a, b) if a < b else (b, a)

eid = 0
incident = defaultdict(list)  # node -> list of edge ids
for n in nodes:
    for q in nbrs(n):
        if ek(n, q) in seen:
            continue
        chain = walk_chain(n, q)
        a, b = chain[0], chain[-1]
        # mark all consecutive pairs
        for u, v in zip(chain, chain[1:]):
            seen.add(ek(u, v))
        if b not in node_set and b != a:
            # unterminated — treat last as node
            node_set.add(b)
            nodes.append(b)
            deg[b] = deg.get(b, 1)
        edges.append({"id": eid, "a": a, "b": b, "chain": chain})
        incident[a].append(eid)
        if b != a:
            incident[b].append(eid)
        eid += 1

print("chains", len(edges))

def heading_out(node, edge):
    ch = edge["chain"]
    if ch[0] == node:
        seq = ch
    else:
        seq = list(reversed(ch))
    k = min(6, len(seq) - 1)
    y0, x0 = seq[0]
    y1, x1 = seq[k]
    return math.atan2(y1 - y0, x1 - x0)

def angdiff(a, b):
    d = abs(a - b) % (2 * math.pi)
    return min(d, 2 * math.pi - d)

# pair incident edges at each junction: prefer going straight (turn ~ pi)
pair = {}  # (node, eid) -> other eid
for n in nodes:
    ids = incident[n]
    if len(ids) < 2:
        continue
    heads = {eid: heading_out(n, edges[eid]) for eid in ids}
    unused = set(ids)
    while len(unused) >= 2:
        best = None
        for i in unused:
            for j in unused:
                if j <= i:
                    continue
                # arriving along i (opposite of heading_out i) leaving along j
                turn = angdiff(heads[i] + math.pi, heads[j])
                # want turn ~ 0 if we reverse i... 
                # heading_in = heads[i] + pi; turn from in to out j is angdiff(heading_in, heads[j])
                # going straight => heading_in ~= heads[j] => turn ~ 0. WAIT
                # heading_out is away from node. Arrival along edge i means we travel toward node,
                # so arrival heading = heading_out(i) + pi? 
                # When walking along i toward n, we move opposite to heading_out(n, i).
                # Arrival heading at n = heading_out(n, i) + pi.
                # Leave along j with heading_out(n, j).
                # Straight: leave heading ~= arrival heading => heads[j] ~= heads[i]+pi
                # so angdiff(heads[j], heads[i]+pi) ~= 0.
                straightness = angdiff(heads[j], heads[i] + math.pi)  # 0 = straight
                if best is None or straightness < best[0]:
                    best = (straightness, i, j)
        if best is None:
            break
        _, i, j = best
        unused.remove(i)
        unused.remove(j)
        pair[(n, i)] = j
        pair[(n, j)] = i

# stitch into polylines
used_e = set()
strokes = []

def other_end(edge, node):
    return edge["b"] if edge["a"] == node else edge["a"]

def chain_from(node, edge):
    ch = edge["chain"]
    if ch[0] == node:
        return list(ch)
    return list(reversed(ch))

for e0 in edges:
    if e0["id"] in used_e:
        continue
    # start at an unpaired end if possible
    start_n = None
    start_e = e0["id"]
    for n in (e0["a"], e0["b"]):
        if (n, e0["id"]) not in pair:
            start_n = n
            break
    if start_n is None:
        start_n = e0["a"]
    n = start_n
    eid_cur = start_e
    pts = []
    guard = 0
    while eid_cur not in used_e and guard < 400:
        guard += 1
        used_e.add(eid_cur)
        ed = edges[eid_cur]
        ch = chain_from(n, ed)
        if not pts:
            pts.extend(ch)
        else:
            pts.extend(ch[1:])
        n2 = other_end(ed, n)
        nxt = pair.get((n2, eid_cur))
        if nxt is None:
            break
        n = n2
        eid_cur = nxt
    strokes.append(pts)

print("strokes", len(strokes), "lens", sorted((len(s) for s in strokes), reverse=True)[:12])

def resample(points, spacing=1.4):
    pts = np.asarray(points, float)
    if len(pts) < 2:
        return pts
    d = np.sqrt(((np.diff(pts, axis=0)) ** 2).sum(1))
    s = np.concatenate([[0], np.cumsum(d)])
    if s[-1] < spacing:
        return pts
    ns = np.linspace(0, s[-1], max(2, int(s[-1] / spacing)))
    return np.stack([np.interp(ns, s, pts[:, 0]), np.interp(ns, s, pts[:, 1])], 1)

def smooth(points, n=None, s=0.7):
    # points are y,x
    xy = np.array([(p[1], p[0]) for p in points], float)
    pts = resample(xy, 1.3)
    keep = [0]
    for i in range(1, len(pts)):
        if np.hypot(*(pts[i] - pts[keep[-1]])) > 0.35:
            keep.append(i)
    pts = pts[keep]
    if len(pts) < 8:
        return pts
    n = n or min(900, max(80, len(pts)))
    tck, u = splprep([pts[:, 0], pts[:, 1]], s=s * math.sqrt(len(pts)), k=3)
    x, y = splev(np.linspace(0, 1, n), tck)
    return np.stack([x, y], 1)

smoothed = []
for s in strokes:
    if len(s) < 20:
        continue
    sm = smooth(s)
    smoothed.append(sm)
    print(f"  stroke n={len(sm)} x={sm[:,0].min():.0f}-{sm[:,0].max():.0f} y={sm[:,1].min():.0f}-{sm[:,1].max():.0f} closed={np.hypot(*(sm[0]-sm[-1]))<12}")

ov = Image.fromarray(np.where(mask[..., None], np.array([40, 40, 40], np.uint8), 0).astype(np.uint8))
dr = ImageDraw.Draw(ov)
cols = [(255, 90, 90), (80, 200, 255), (255, 220, 80), (120, 255, 140), (255, 130, 220), (140, 160, 255), (255, 180, 120)]
for i, sm in enumerate(smoothed):
    col = cols[i % len(cols)]
    pts = [(float(x), float(y)) for x, y in sm]
    dr.line(pts, fill=col, width=2)
    dr.ellipse([pts[0][0] - 3, pts[0][1] - 3, pts[0][0] + 3, pts[0][1] + 3], fill=(255, 255, 255))
    dr.ellipse([pts[-1][0] - 3, pts[-1][1] - 3, pts[-1][0] + 3, pts[-1][1] + 3], fill=col)
sp = [(float(x), float(y)) for x, y in star_poly] + [(float(star_poly[0, 0]), float(star_poly[0, 1]))]
dr.line(sp, fill=(255, 240, 140), width=2)
ov.save(OUT / "debug-trace.png")

plane = {
    "nose": [1022.0, 76.5],
    "leftWing": [969.5, 103.0],
    "rightWing": [1010.0, 118.5],
    "tail": [992.0, 119.5],
    "leftFold": [987.5, 104.0],
    "rightFold": [1009.5, 115.0],
}

geom = {
    "width": w,
    "height": h,
    "starCenter": [cx, cy],
    "starPolygon": np.round(star_poly, 2).tolist(),
    "strokes": [np.round(s, 2).tolist() for s in smoothed],
    "plane": plane,
}
(OUT / "geometry.json").write_text(json.dumps(geom))
(OUT / "geometry.js").write_text("export const HERO_GEOM = " + json.dumps(geom) + ";\n")
print("saved", len(smoothed), "strokes")
