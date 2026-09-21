// Shape of the hero: the drawing of geometry.js lifted into three dimensions.
// Plain numbers, no renderer — hero-scene.js projects these points into an SVG.
import { HERO_GEOM as G, HERO_GEOM_MOBILE } from "./geometry.js";

const GEOMS = { desktop: G, mobile: HERO_GEOM_MOBILE };

let variant = "desktop";
export let W = G.width;
export let H = G.height;

// Tuned in hero-3d/index.html and frozen here: this is the scene the site shows.
// The panel writes straight into this object, so both stay in step.
export const params = {
    follow: 14,
    ease: 0.08,
    easeBack: 0.04,
    followOn: true,
    autoSpin: false,
    ballDepth: 0.8,
    ballTwist: 0.13,
    zig: 0,
    starDepth: 1,
    starThick: 8,
    size: 1.05,
    wingW: 0.3,
    valleyW: 0.11,
    valleyH: 0.25,
    gap: 14,
    yaw: 0,
    pitch: -10,
    roll: -1,
    width: 3,
    overlay: false,
    overlayOp: 0.45,
};

// Drawing coordinates -> scene: x right, y up, z toward the viewer. The front view
// is orthographic, so z never shifts anything until the scene turns.
function to3(x, y, z) {
    return [x - W / 2, -(y - H / 2), z];
}

function starCenterOf(poly) {
    let sx = 0;
    let sy = 0;
    for (const [x, y] of poly) {
        sx += x;
        sy += y;
    }
    let cx = sx / poly.length;
    let cy = sy / poly.length;
    const d = poly.map(([x, y]) => Math.hypot(x - cx, y - cy));
    const mid = (Math.min(...d) + Math.max(...d)) / 2;
    const valleys = poly.filter((_, i) => d[i] < mid);
    if (valleys.length >= 3) {
        let ax = 0;
        let ay = 0;
        for (const [x, y] of valleys) {
            ax += x;
            ay += y;
        }
        cx = ax / valleys.length;
        cy = ay / valleys.length;
    }
    return [cx, cy];
}

function starTipsOf(poly, center) {
    const [cx, cy] = center;
    const n = poly.length;
    const d = poly.map(([x, y]) => Math.hypot(x - cx, y - cy));
    const tips = [];
    for (let i = 0; i < n; i++) {
        const prev = d[(i - 1 + n) % n];
        const next = d[(i + 1) % n];
        if (d[i] >= prev && d[i] >= next) tips.push({ x: poly[i][0], y: poly[i][1], r: d[i] });
    }
    return tips;
}

function parseCubics(d) {
    const toks = d.match(/[A-Za-z]|[-+]?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/gi);
    const cubics = [];
    let k = 0;
    let cmd = "L";
    let x = 0;
    let y = 0;
    const num = () => Number(toks[k++]);
    while (k < toks.length) {
        const t = toks[k];
        if (t >= "A") {
            cmd = t;
            k += 1;
            continue;
        }
        if (cmd === "M") {
            x = num();
            y = num();
            cmd = "L";
        } else if (cmd === "C") {
            const x1 = num();
            const y1 = num();
            const x2 = num();
            const y2 = num();
            const x3 = num();
            const y3 = num();
            cubics.push([x, y, x1, y1, x2, y2, x3, y3]);
            x = x3;
            y = y3;
        } else {
            throw new Error(cmd);
        }
    }
    return cubics;
}

function cubicPoint(c, t) {
    const u = 1 - t;
    const uu = u * u;
    const tt = t * t;
    return [
        uu * u * c[0] + 3 * uu * t * c[2] + 3 * u * tt * c[4] + tt * t * c[6],
        uu * u * c[1] + 3 * uu * t * c[3] + 3 * u * tt * c[5] + tt * t * c[7],
    ];
}

function cubicLength(c, steps = 24) {
    let len = 0;
    let prev = cubicPoint(c, 0);
    for (let i = 1; i <= steps; i++) {
        const p = cubicPoint(c, i / steps);
        len += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
        prev = p;
    }
    return len;
}

function cubicPointAtLength(c, dist, total, steps = 24) {
    if (dist <= 0) return cubicPoint(c, 0);
    if (dist >= total) return cubicPoint(c, 1);
    let acc = 0;
    let prev = cubicPoint(c, 0);
    for (let i = 1; i <= steps; i++) {
        const p = cubicPoint(c, i / steps);
        const seg = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
        if (acc + seg >= dist) {
            const u = seg <= 0 ? 0 : (dist - acc) / seg;
            return [prev[0] + (p[0] - prev[0]) * u, prev[1] + (p[1] - prev[1]) * u];
        }
        acc += seg;
        prev = p;
    }
    return cubicPoint(c, 1);
}

// Even steps along the path, without touching the document: inserting a live SVG
// and asking getTotalLength forces a layout, and Safari stutters on first paint.
function sampleLinePath(cubics, spacing = 3.2) {
    const lens = cubics.map((c) => cubicLength(c));
    let total = 0;
    for (const len of lens) total += len;
    const n = Math.max(2, Math.ceil(total / spacing));
    const pts = [];
    let acc = 0;
    let ci = 0;
    for (let i = 0; i <= n; i++) {
        const target = (total * i) / n;
        while (ci < lens.length - 1 && acc + lens[ci] < target) {
            acc += lens[ci];
            ci += 1;
        }
        pts.push(cubicPointAtLength(cubics[ci], target - acc, lens[ci]));
    }
    return pts;
}

const prepared = Object.create(null);

function starLayout(geom) {
    const starCenter = starCenterOf(geom.starPolygon);
    const starTips = starTipsOf(geom.starPolygon, starCenter);
    const starR = starTips.reduce((a, t) => a + t.r, 0) / starTips.length;
    return { starCenter, starTips, starR };
}

function runoutFrom(stroke, look) {
    const n = stroke.length;
    for (let i = n - 1 - look; i > look; i--) {
        const a = stroke[i - look];
        const b = stroke[i];
        const c = stroke[i + look];
        const turn = Math.abs(
            Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0])
        );
        if (Math.min(turn, Math.PI * 2 - turn) > 0.6) return i;
    }
    return Math.round(n * 0.85);
}

function prepare(name) {
    if (prepared[name]) return prepared[name];
    const geom = GEOMS[name];
    const spacing = Math.max(0.8, geom.width / 490);
    const cubics = parseCubics(geom.linePath);
    const stroke = sampleLinePath(cubics, spacing);
    const look = Math.max(4, Math.round(8 * (3.2 / spacing)));
    const from = runoutFrom(stroke, look);
    let runLen = 0;
    for (let i = from + 1; i < stroke.length; i++) {
        runLen += Math.hypot(stroke[i][0] - stroke[i - 1][0], stroke[i][1] - stroke[i - 1][1]);
    }
    const end = stroke[stroke.length - 1];
    const back = stroke[Math.max(0, stroke.length - look)];
    const dx = end[0] - back[0];
    const dy = end[1] - back[1];
    const len = Math.hypot(dx, dy) || 1;
    const star = starLayout(geom);
    prepared[name] = {
        geom,
        cubics,
        stroke,
        runoutFrom: from,
        runoutLen: runLen,
        end,
        dir: [dx / len, dy / len],
        ...star,
        step: Math.max(6, Math.round(6 * (3.2 / spacing))),
    };
    return prepared[name];
}

export function lineWidth() {
    const geom = GEOMS[variant];
    return params.width * ((geom.strokeWidth || 3) / 3);
}

export function setVariant(name) {
    const next = name === "mobile" ? "mobile" : "desktop";
    const changed = next !== variant;
    variant = next;
    const geom = GEOMS[variant];
    W = geom.width;
    H = geom.height;
    return changed;
}

function smoothstep(a, b, x) {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
}

// Depth of the coiled part: the curve is wrapped onto a sphere around the star,
// so the spread in z matches the spread in the plane, and the tilt of each turn
// precesses so the coil reads as a ball being unwound.
function ballZ(stroke, scale, twist, center) {
    const [cx, cy] = center;
    const n = stroke.length;
    const zs = new Float32Array(n);
    if (scale === 0) return zs;
    let acc = 0;
    let prev = Math.atan2(stroke[0][1] - cy, stroke[0][0] - cx);
    for (let i = 0; i < n; i++) {
        const dx = stroke[i][0] - cx;
        const dy = stroke[i][1] - cy;
        const r = Math.hypot(dx, dy);
        const th = Math.atan2(dy, dx);
        let step = th - prev;
        while (step > Math.PI) step -= Math.PI * 2;
        while (step < -Math.PI) step += Math.PI * 2;
        acc += step;
        prev = th;
        zs[i] = r * scale * Math.sin(acc * (1 + twist));
    }
    return zs;
}

function extremaZ(stroke, amp) {
    const n = stroke.length;
    const zs = new Float32Array(n);
    if (n < 8 || amp === 0) return zs;
    const win = 10;
    const raw = [];
    for (let i = 0; i < n; i++) {
        const y = stroke[i][1];
        let hi = true;
        let lo = true;
        for (let k = 1; k <= win; k++) {
            const a = stroke[Math.max(0, i - k)][1];
            const b = stroke[Math.min(n - 1, i + k)][1];
            if (y < a || y < b) hi = false;
            if (y > a || y > b) lo = false;
        }
        if (hi || lo) raw.push({ i, sign: hi ? 1 : -1, y });
    }
    const filtered = [];
    for (const e of raw) {
        const prev = filtered[filtered.length - 1];
        if (prev && e.i - prev.i < 14) {
            if ((e.sign === 1 && e.y < prev.y) || (e.sign === -1 && e.y > prev.y)) {
                filtered[filtered.length - 1] = e;
            }
            continue;
        }
        filtered.push(e);
    }
    if (filtered.length < 2) return zs;
    for (let i = 0; i < n; i++) {
        let a = filtered[0];
        let b = filtered[filtered.length - 1];
        for (let k = 0; k < filtered.length - 1; k++) {
            if (i >= filtered[k].i && i <= filtered[k + 1].i) {
                a = filtered[k];
                b = filtered[k + 1];
                break;
            }
        }
        const t = b.i === a.i ? 0 : (i - a.i) / (b.i - a.i);
        const s = t * t * (3 - 2 * t);
        zs[i] = a.sign * amp + (b.sign * amp - a.sign * amp) * s;
    }
    return zs;
}

function smoothSeries(zs, passes) {
    const n = zs.length;
    const out = Float32Array.from(zs);
    const tmp = new Float32Array(n);
    for (let p = 0; p < passes; p++) {
        tmp.set(out);
        for (let i = 1; i < n - 1; i++) {
            out[i] = (tmp[i - 1] + tmp[i] * 2 + tmp[i + 1]) * 0.25;
        }
    }
    return out;
}

function lineDepth(layout, tailZ) {
    const stroke = layout.stroke;
    const n = stroke.length;
    // Last time the curve is still inside the coil; everything after is the zigzag run.
    const coilX = layout.geom.coilX;
    let split = n - 1;
    for (let i = n - 1; i >= 0; i--) {
        if (stroke[i][0] < coilX) {
            split = i;
            break;
        }
    }
    const ball = ballZ(stroke, params.ballDepth, params.ballTwist, layout.starCenter);
    const zig = extremaZ(stroke, params.zig);
    const fade = Math.round(n * 0.12);
    const zs = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const w = smoothstep(split - fade, split, i);
        zs[i] = ball[i] * (1 - w) + zig[i] * w;
    }
    // Run-out: the curve leaves the last zigzag flat and banks away from the
    // viewer, quadratically, so its slope at the very end is the one the dart flies.
    const runFrom = layout.runoutFrom;
    const span = n - 1 - runFrom;
    for (let i = runFrom; i < n; i++) {
        const t = (i - runFrom) / span;
        zs[i] += tailZ * t * t;
    }
    const soft = smoothSeries(zs, 6);
    soft[0] = 0;
    soft[n - 1] = tailZ;
    return soft;
}

function sub(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a, b) {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ];
}

function unit(v) {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
}

function pushTri(out, a, b, c) {
    out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
}

// Thick ray from the core to an apex, built as a tapered prism so the ray has
// real volume from any angle.
function pushRay(out, center, apex, thick) {
    const along = sub(apex, center);
    const len = Math.hypot(along[0], along[1], along[2]);
    if (len < 1e-3) return;
    const axis = [along[0] / len, along[1] / len, along[2] / len];
    const guide = Math.abs(axis[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
    const p1 = unit(cross(axis, guide));
    const p2 = unit(cross(axis, p1));
    const sides = 6;
    const lift = thick * 0.35;
    const ring = [];
    for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        const co = Math.cos(a) * thick;
        const si = Math.sin(a) * thick;
        ring.push([
            center[0] + p1[0] * co + p2[0] * si + axis[0] * lift,
            center[1] + p1[1] * co + p2[1] * si + axis[1] * lift,
            center[2] + p1[2] * co + p2[2] * si + axis[2] * lift,
        ]);
    }
    for (let i = 0; i < sides; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % sides];
        pushTri(out, apex, a, b);
        pushTri(out, center, b, a);
    }
}

// Spiked ball: the drawn tips keep their place, depth only tilts their rays out of
// the plane, so the front view still matches the drawing. All of it reads as one
// black silhouette, so the triangles need neither sorting nor shading.
function starShape(layout, depthScale, thick) {
    const [cx, cy] = layout.starCenter;
    const tips = layout.starTips;
    const center = to3(cx, cy, 0);
    const n = tips.length;
    const radii = tips.map((t) => Math.hypot(t.x - cx, t.y - cy));
    // Every ray reaches the same sphere, so the depth rays are no longer than
    // the drawn ones.
    const reach = (radii.reduce((a, b) => a + b, 0) / n) * depthScale;
    const apexes = tips.map((t, k) => {
        const lift = Math.sqrt(Math.max(0, reach * reach - radii[k] * radii[k]));
        const sign = k === n - 1 && n % 2 === 1 ? -1 : k % 2 ? -1 : 1;
        return to3(t.x, t.y, lift * sign);
    });
    apexes.push(to3(cx, cy, reach), to3(cx, cy, -reach));

    const tris = [];
    for (const apex of apexes) pushRay(tris, center, apex, thick);
    return { tris: Float32Array.from(tris), core: center, coreR: thick * 1.05 };
}

// Paper dart in its own space: x right, y up, z toward the nose. A sheet folded
// down the middle: the crease runs nose to tail along the bottom, the two body
// halves rise from it as a valley, and the wings fold outwards from the top of
// that valley.
function planeModel(body, valley, span, rise) {
    return {
        nose: [0, 0, 0.5],
        tailBottom: [0, 0, -0.5],
        rootL: [-body, valley, -0.5],
        rootR: [body, valley, -0.5],
        tipL: [-span, valley + rise, -0.5],
        tipR: [span, valley + rise, -0.5],
    };
}

function rotateModel(p, yaw, pitch, roll) {
    const [x, y, z] = p;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const x1 = x * cy + z * sy;
    const z1 = -x * sy + z * cy;
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const y2 = y * cp - z1 * sp;
    const z2 = y * sp + z1 * cp;
    const cr = Math.cos(roll);
    const sr = Math.sin(roll);
    return [x1 * cr - y2 * sr, x1 * sr + y2 * cr, z2];
}

// The drawing shows the dart in three quarters, and its pose was solved once
// against the six points it pins down: yaw, tail-down, roll, scale, wing rise.
// Frozen here, so no page has to run the search, and every page shows one dart.
const FIT = { yaw: 0.578885, pitch: -0.835355, roll: 0.071154, scale: 93.46092, rise: -0.037446 };

// Which of the two depth-mirrored poses has the nose pointing away from the viewer.
const FLIP = -1;

// Proportions and view angle come from the sliders, starting at the fit. The line
// meets the dart at the mouth of the valley, between the wings, and the dart sits
// a step further along the flight path so the two do not touch.
function planeVerts(layout) {
    const rad = Math.PI / 180;
    const body = params.valleyW / 2;
    const model = planeModel(body, params.valleyH, body + params.wingW, FIT.rise);
    const s = FIT.scale;
    const flat = {};
    for (const k in model) {
        const v = rotateModel(
            model[k],
            FIT.yaw + params.yaw * rad,
            FIT.pitch - params.pitch * rad,
            FIT.roll + params.roll * rad
        );
        flat[k] = { x: s * v[0], y: -s * v[1], z: s * v[2] * FLIP };
    }
    const hook = {
        x: (flat.rootL.x + flat.rootR.x) / 2,
        y: (flat.rootL.y + flat.rootR.y) / 2,
        z: (flat.rootL.z + flat.rootR.z) / 2,
    };
    // How steeply the dart flies away from the viewer. The line's run-out banks at
    // the same slope, and the dart is set further along that same path.
    const slope =
        (hook.z - flat.nose.z) / (Math.hypot(flat.nose.x - hook.x, flat.nose.y - hook.y) || 1);
    const tailZ = (-slope * layout.runoutLen) / 2;
    // Same dart as on desktop, scaled to the drawing so the front view matches.
    const desk = GEOMS.desktop.plane;
    const here = layout.geom.plane;
    const deskSpan = Math.hypot(desk.leftWing[0] - desk.nose[0], desk.leftWing[1] - desk.nose[1]);
    const hereSpan = Math.hypot(here.leftWing[0] - here.nose[0], here.leftWing[1] - here.nose[1]);
    const size = params.size * (hereSpan / deskSpan);
    let px = layout.end[0] + layout.dir[0] * params.gap * (hereSpan / deskSpan);
    let py = layout.end[1] + layout.dir[1] * params.gap * (hereSpan / deskSpan);
    let along = params.gap * (hereSpan / deskSpan);
    if (variant === "mobile") {
        px = (here.leftFold[0] + here.rightFold[0]) / 2;
        py = (here.leftFold[1] + here.rightFold[1]) / 2;
        along = Math.hypot(px - layout.end[0], py - layout.end[1]);
    }
    const pz = tailZ - slope * along;
    const out = { tailZ };
    for (const k in flat) {
        out[k] = to3(
            px + (flat[k].x - hook.x) * size,
            py + (flat[k].y - hook.y) * size,
            pz + (flat[k].z - hook.z) * size
        );
    }
    return out;
}

function zAt(zs, i) {
    const n = zs.length;
    if (i <= 0) return zs[0];
    if (i >= n - 1) return zs[n - 1];
    const j = Math.floor(i);
    const t = i - j;
    return zs[j] * (1 - t) + zs[j + 1] * t;
}

// Walk the sampled stroke forward until it sits on (x, y).
function advanceTo(pts, i, x, y, step = 6) {
    let best = i;
    let bestD = (pts[i][0] - x) ** 2 + (pts[i][1] - y) ** 2;
    for (let k = i + 1; k < pts.length; k++) {
        const d = (pts[k][0] - x) ** 2 + (pts[k][1] - y) ** 2;
        if (d <= bestD) {
            bestD = d;
            best = k;
        } else if (k - best > step) break;
    }
    return best;
}

// Control z that makes the cubic pass through the sampled depth at t = 0, 1/3, 2/3, 1.
function cubicControlZ(z0, z13, z23, z1) {
    const A = (27 * z13 - 8 * z0 - z1) / 6;
    const B = (27 * z23 - z0 - 8 * z1) / 6;
    return [(2 * A - B) / 3, (2 * B - A) / 3];
}

function lineShape(layout, zs) {
    const { cubics: src, stroke } = layout;
    const start2 = src[0];
    const start = to3(start2[0], start2[1], zs[0]);
    const cubics = new Float32Array(src.length * 9);
    let i0 = 0;
    let w = 0;
    for (const c of src) {
        const a = advanceTo(stroke, i0, c[0], c[1], layout.step);
        const b = advanceTo(stroke, a, c[6], c[7], layout.step);
        i0 = b;
        const z0 = zs[a];
        const z3 = zs[b];
        const span = b - a;
        const [z1, z2] = cubicControlZ(z0, zAt(zs, a + span / 3), zAt(zs, a + (2 * span) / 3), z3);
        const p1 = to3(c[2], c[3], z1);
        const p2 = to3(c[4], c[5], z2);
        const p3 = to3(c[6], c[7], z3);
        cubics[w] = p1[0];
        cubics[w + 1] = p1[1];
        cubics[w + 2] = p1[2];
        cubics[w + 3] = p2[0];
        cubics[w + 4] = p2[1];
        cubics[w + 5] = p2[2];
        cubics[w + 6] = p3[0];
        cubics[w + 7] = p3[1];
        cubics[w + 8] = p3[2];
        w += 9;
    }
    return { start, cubics, n: src.length };
}

// Everything the renderer needs, in scene coordinates: one cubic stroke, one black
// silhouette, four white faces. Rebuilt whenever a slider moves.
export function buildShape() {
    const layout = prepare(variant);
    const v = planeVerts(layout);
    const zs = lineDepth(layout, v.tailZ);
    const line = lineShape(layout, zs);
    // Each face is drawn as a stroked triangle, and the three sides of these four
    // happen to be exactly the nine folds of the dart — so the creases come for
    // free, and a nearer face hides the ones behind it.
    const faces = [
        // Two halves of the folded body, meeting along the crease as a valley.
        [v.nose, v.tailBottom, v.rootL],
        [v.nose, v.rootR, v.tailBottom],
        // Wings, folded outwards from the top of the valley.
        [v.nose, v.rootL, v.tipL],
        [v.nose, v.tipR, v.rootR],
    ];
    const deskR = starLayout(GEOMS.desktop).starR;
    const thick = params.starThick * (layout.starR / deskR);
    return { line, star: starShape(layout, params.starDepth, thick), faces };
}
