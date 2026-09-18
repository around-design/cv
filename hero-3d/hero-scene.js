import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { HERO_GEOM as G } from "./geometry.js";

const W = G.width;
const H = G.height;
const INK = 0x24221f;

// Tuned in hero-3d/index.html and frozen here: this is the scene the site shows.
// The panel writes straight into this object, so both stay in step.
export const params = {
    follow: 14,
    ease: 0.08,
    easeBack: 0.04,
    followOn: true,
    autoSpin: false,
    ballDepth: 0.8,
    ballTwist: 0.39,
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
    edges: false,
};

// SVG coordinates -> world. Orthographic front view, so z never shifts the projection.
function to3(x, y, z) {
    return new THREE.Vector3(x - W / 2, -(y - H / 2), z);
}

function starCenter() {
    const poly = G.starPolygon;
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

const STAR_CENTER = starCenter();

function starRays() {
    const poly = G.starPolygon;
    const [cx, cy] = STAR_CENTER;
    const n = poly.length;
    const d = poly.map(([x, y]) => Math.hypot(x - cx, y - cy));
    const tips = [];
    for (let i = 0; i < n; i++) {
        const prev = d[(i - 1 + n) % n];
        const next = d[(i + 1) % n];
        if (d[i] >= prev && d[i] >= next) tips.push({ x: poly[i][0], y: poly[i][1], r: d[i] });
    }
    return { tips };
}

const STAR_RAYS = starRays();

function sampleLinePath(d, spacing = 1.6) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    document.body.appendChild(svg);
    const len = path.getTotalLength();
    const n = Math.max(2, Math.ceil(len / spacing));
    const pts = [];
    for (let i = 0; i <= n; i++) {
        const p = path.getPointAtLength((len * i) / n);
        pts.push([p.x, p.y]);
    }
    svg.remove();
    return pts;
}

const line2d = sampleLinePath(G.linePath);

// Last sharp corner of the path: after it the curve just runs out toward the dart.
const RUNOUT_FROM = (() => {
    const n = line2d.length;
    const look = 8;
    for (let i = n - 1 - look; i > look; i--) {
        const a = line2d[i - look];
        const b = line2d[i];
        const c = line2d[i + look];
        const turn = Math.abs(
            Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0])
        );
        if (Math.min(turn, Math.PI * 2 - turn) > 0.6) return i;
    }
    return Math.round(n * 0.85);
})();

const RUNOUT_LEN = (() => {
    let sum = 0;
    for (let i = RUNOUT_FROM + 1; i < line2d.length; i++) {
        sum += Math.hypot(line2d[i][0] - line2d[i - 1][0], line2d[i][1] - line2d[i - 1][1]);
    }
    return sum;
})();

function smoothstep(a, b, x) {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
}

// Depth of the coiled part: the curve is wrapped onto a sphere around the star,
// so the spread in z matches the spread in the plane, and the tilt of each turn
// precesses so the coil reads as a ball being unwound.
function ballZ(stroke, scale, twist) {
    const [cx, cy] = STAR_CENTER;
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

function lineDepth(stroke, tailZ) {
    const n = stroke.length;
    // Last time the curve is still inside the coil; everything after is the zigzag run.
    let split = n - 1;
    for (let i = n - 1; i >= 0; i--) {
        if (stroke[i][0] < 640) {
            split = i;
            break;
        }
    }
    const ball = ballZ(stroke, params.ballDepth, params.ballTwist);
    const zig = extremaZ(stroke, params.zig);
    const fade = Math.round(n * 0.12);
    const zs = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const w = smoothstep(split - fade, split, i);
        zs[i] = ball[i] * (1 - w) + zig[i] * w;
    }
    // Run-out: the curve leaves the last zigzag flat and banks away from the
    // viewer, quadratically, so its slope at the very end is the one the dart flies.
    const span = n - 1 - RUNOUT_FROM;
    for (let i = RUNOUT_FROM; i < n; i++) {
        const t = (i - RUNOUT_FROM) / span;
        zs[i] += tailZ * t * t;
    }
    const soft = smoothSeries(zs, 6);
    soft[0] = 0;
    soft[n - 1] = tailZ;
    return soft;
}

function segmentDistance(p, a, b) {
    const ab = b.clone().sub(a);
    const len2 = ab.lengthSq();
    if (len2 < 1e-9) return p.distanceTo(a);
    let t = p.clone().sub(a).dot(ab) / len2;
    t = Math.min(1, Math.max(0, t));
    return p.distanceTo(a.clone().addScaledVector(ab, t));
}

// Segments shorter than the stroke width make the round joins scallop along the
// edge, so thin the polyline out while keeping it within eps of the curve.
function simplify(points, eps) {
    const n = points.length;
    if (n < 3) return points.slice();
    const keep = new Uint8Array(n);
    keep[0] = 1;
    keep[n - 1] = 1;
    const stack = [[0, n - 1]];
    while (stack.length) {
        const [a, b] = stack.pop();
        let worst = -1;
        let worstD = eps;
        for (let i = a + 1; i < b; i++) {
            const d = segmentDistance(points[i], points[a], points[b]);
            if (d > worstD) {
                worstD = d;
                worst = i;
            }
        }
        if (worst > 0) {
            keep[worst] = 1;
            stack.push([a, worst], [worst, b]);
        }
    }
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i]);
    return out;
}

const strokeMaterials = [];
// Size of the canvas the strokes are being measured against, in CSS pixels.
const viewport = { w: 1, h: 1 };

// Screen-facing stroke of constant world width: no Frenet frames, so sharp
// turns of the source Bezier stay round instead of pinching like a tube.
function makeStroke(points, width) {
    if (points.length < 2) return null;
    const arr = [];
    for (const p of points) arr.push(p.x, p.y, p.z);
    const geo = new LineGeometry();
    geo.setPositions(arr);
    const mat = new LineMaterial({
        color: INK,
        // Width is kept in screen pixels and refreshed per frame: strands that
        // dive steeply into depth would otherwise scallop along their edges.
        linewidth: width,
        worldUnits: false,
        dashed: false,
        alphaToCoverage: true,
        // The stroke is one flat ink colour, so it does not need to occlude
        // itself. Skipping depth writes keeps overlapping turns from cutting
        // notches into each other.
        depthWrite: false,
    });
    mat.resolution.set(viewport.w, viewport.h);
    strokeMaterials.push(mat);
    const line = new Line2(geo, mat);
    line.computeLineDistances();
    line.renderOrder = 1;
    return line;
}

function pushTri(positions, a, b, c) {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
}

// Thick ray from the core to an apex, built as a tapered prism so the ray has
// real volume from any angle.
function pushRay(positions, center, apex, thick) {
    const axis = apex.clone().sub(center);
    const len = axis.length();
    if (len < 1e-3) return;
    axis.divideScalar(len);
    const guide = Math.abs(axis.z) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    const p1 = new THREE.Vector3().crossVectors(axis, guide).normalize();
    const p2 = new THREE.Vector3().crossVectors(axis, p1).normalize();
    const sides = 6;
    const ring = [];
    for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        ring.push(
            center
                .clone()
                .addScaledVector(p1, Math.cos(a) * thick)
                .addScaledVector(p2, Math.sin(a) * thick)
                .addScaledVector(axis, thick * 0.35)
        );
    }
    for (let i = 0; i < sides; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % sides];
        pushTri(positions, apex, a, b);
        pushTri(positions, center, b, a);
    }
}

function starMesh(depthScale, thick) {
    const [cx, cy] = STAR_CENTER;
    const center = to3(cx, cy, 0);
    const { tips } = STAR_RAYS;
    const n = tips.length;
    const radii = tips.map((t) => Math.hypot(t.x - cx, t.y - cy));
    // Every ray reaches the same sphere, so the depth rays are no longer than
    // the drawn ones.
    const reach = (radii.reduce((a, b) => a + b, 0) / n) * depthScale;
    const apexes = [];

    // Rays of the drawing keep their drawn position; depth only tilts them out
    // of the plane, which leaves the front projection untouched.
    tips.forEach((t, k) => {
        const r = radii[k];
        const lift = Math.sqrt(Math.max(0, reach * reach - r * r));
        const sign = k === n - 1 && n % 2 === 1 ? -1 : k % 2 ? -1 : 1;
        apexes.push(to3(t.x, t.y, lift * sign));
    });
    apexes.push(to3(cx, cy, reach), to3(cx, cy, -reach));

    const positions = [];
    for (const apex of apexes) pushRay(positions, center, apex, thick);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshPhongMaterial({
        color: INK,
        shininess: 22,
        specular: 0x3a3a3a,
        side: THREE.DoubleSide,
        flatShading: true,
    });
    const rays = new THREE.Mesh(geo, mat);

    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(thick * 1.05, 1), mat);
    core.position.copy(center);

    const out = new THREE.Group();
    out.add(rays, core);
    if (params.edges) {
        out.add(
            new THREE.LineSegments(
                new THREE.EdgesGeometry(geo, 24),
                new THREE.LineBasicMaterial({ color: 0xff3b30 })
            )
        );
    }
    return out;
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

// The drawing shows the dart in three quarters; these are the points it pins down.
const PLANE_ANCHORS = {
    nose: [1575.47, 121.078],
    tipL: [1495.47, 158.856],
    tipR: [1555.41, 182.527],
    tailBottom: [1529.33, 182.527],
    rootL: [1520.82, 164.116],
    rootR: [1538.16, 171.982],
};

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

const BOUNDS = [
    [-Math.PI * 2, Math.PI * 2],
    [-Math.PI, Math.PI],
    [-Math.PI, Math.PI],
    [40, 220],
    [1400, 1650],
    [80, 240],
    [0.05, 0.35],
    [0.06, 0.45],
    [0.3, 0.95],
    [-0.1, 0.35],
];

// Pose and proportions are solved, not guessed: find the dart whose
// orthographic projection lands on the points of the drawing.
function fitPlane() {
    const keys = Object.keys(PLANE_ANCHORS);
    const clamp = (v, i) => Math.min(BOUNDS[i][1], Math.max(BOUNDS[i][0], v));
    const cost = (p) => {
        const model = planeModel(p[6], p[7], p[8], p[9]);
        let sum = 0;
        for (const k of keys) {
            const v = rotateModel(model[k], p[0], p[1], p[2]);
            const dx = p[4] + p[3] * v[0] - PLANE_ANCHORS[k][0];
            const dy = p[5] - p[3] * v[1] - PLANE_ANCHORS[k][1];
            sum += dx * dx + dy * dy;
        }
        return sum;
    };
    let best = null;
    for (let restart = 0; restart < 18; restart++) {
        let p = [
            Math.random() * Math.PI * 2,
            (Math.random() - 0.5) * Math.PI,
            (Math.random() - 0.5) * Math.PI,
            80 + Math.random() * 60,
            1535,
            160,
            0.16,
            0.2,
            0.55,
            0.08,
        ];
        const step = [0.4, 0.4, 0.4, 10, 8, 8, 0.05, 0.06, 0.08, 0.05];
        let c = cost(p);
        for (let it = 0; it < 1200; it++) {
            let moved = false;
            for (let k = 0; k < p.length; k++) {
                for (const sgn of [1, -1]) {
                    const q = p.slice();
                    q[k] = clamp(q[k] + sgn * step[k], k);
                    const cq = cost(q);
                    if (cq < c) {
                        p = q;
                        c = cq;
                        moved = true;
                        break;
                    }
                }
            }
            if (!moved) {
                for (let k = 0; k < p.length; k++) step[k] *= 0.65;
                if (step[0] < 1e-5) break;
            }
        }
        if (!best || c < best.cost) best = { p, cost: c };
    }
    return best;
}

// The sketch pins the dart down, so solve it once and reuse the result.
const PLANE_FIT = fitPlane();

// Which of the two depth-mirrored poses has the nose pointing away. Decided once
// from the fit, so nudging the view angle never flips the dart mid-slide.
const PLANE_FLIP = (() => {
    const [yaw, pitch, roll] = PLANE_FIT.p;
    const m = planeModel(PLANE_FIT.p[6], PLANE_FIT.p[7], PLANE_FIT.p[8], PLANE_FIT.p[9]);
    const nose = rotateModel(m.nose, yaw, pitch, roll);
    const tail = rotateModel(m.tailBottom, yaw, pitch, roll);
    return nose[2] > tail[2] ? -1 : 1;
})();

const LINE_END = line2d[line2d.length - 1];

// Where the line is heading as it ends, so the dart can be set a little ahead of it.
const LINE_DIR = (() => {
    const back = line2d[Math.max(0, line2d.length - 8)];
    const dx = LINE_END[0] - back[0];
    const dy = LINE_END[1] - back[1];
    const len = Math.hypot(dx, dy) || 1;
    return [dx / len, dy / len];
})();

// Proportions and view angle come from the sliders, starting at the fit. The line
// meets the dart at the mouth of the valley, between the wings, and the dart sits
// a step further along the flight path so the two do not touch.
function planeVerts() {
    const [yaw, pitch, roll, s] = PLANE_FIT.p;
    const rad = Math.PI / 180;
    const body = params.valleyW / 2;
    const model = planeModel(body, params.valleyH, body + params.wingW, PLANE_FIT.p[9]);
    const flat = {};
    for (const k in model) {
        const v = rotateModel(
            model[k],
            yaw + params.yaw * rad,
            pitch - params.pitch * rad,
            roll + params.roll * rad
        );
        flat[k] = { x: s * v[0], y: -s * v[1], z: s * v[2] * PLANE_FLIP };
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
    const tailZ = (-slope * RUNOUT_LEN) / 2;
    const px = LINE_END[0] + LINE_DIR[0] * params.gap;
    const py = LINE_END[1] + LINE_DIR[1] * params.gap;
    const pz = tailZ - slope * params.gap;
    const out = {};
    for (const k in flat) {
        out[k] = to3(
            px + (flat[k].x - hook.x) * params.size,
            py + (flat[k].y - hook.y) * params.size,
            pz + (flat[k].z - hook.z) * params.size
        );
    }
    out.hook = to3(px, py, pz);
    out.tailZ = tailZ;
    return out;
}

function planeMesh(v) {
    const faces = [
        // Two halves of the folded body, meeting along the crease as a valley.
        [v.nose, v.tailBottom, v.rootL],
        [v.nose, v.rootR, v.tailBottom],
        // Wings, folded outwards from the top of the valley.
        [v.nose, v.rootL, v.tipL],
        [v.nose, v.tipR, v.rootR],
    ];
    const positions = [];
    for (const [a, b, c] of faces) pushTri(positions, a, b, c);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
        // A steeply tilted face would otherwise swallow the half of a fold line
        // that leans over it, and that edge would read thinner than the rest.
        polygonOffset: true,
        polygonOffsetFactor: 4,
        polygonOffsetUnits: 4,
    });
    const out = new THREE.Group();
    out.add(new THREE.Mesh(geo, mat));

    const edges = [
        [v.nose, v.tipL],
        [v.nose, v.tipR],
        [v.tipL, v.rootL],
        [v.tipR, v.rootR],
        [v.nose, v.rootL],
        [v.nose, v.rootR],
        [v.nose, v.tailBottom],
        [v.rootL, v.tailBottom],
        [v.rootR, v.tailBottom],
    ];
    for (const [a, b] of edges) {
        const s = makeStroke([a.clone(), b.clone()], params.width);
        if (s) out.add(s);
    }
    return out;
}

// One page, one scene: the geometry above is shared module state, the bits below
// belong to the canvas it is drawn into.
export function mountHero({
    mount,
    orbit = false,
    overlaySrc = null,
    padX = 1.12,
    padY = 1.12,
    transparent = false,
} = {}) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0xffffff, transparent ? 0 : 1);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -6000, 6000);
    camera.position.set(0, 0, 800);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.6);
    keyLight.position.set(-120, 180, 260);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
    fillLight.position.set(200, -80, -140);
    scene.add(fillLight);

    const group = new THREE.Group();
    scene.add(group);

    let controls = null;
    let dragging = false;
    // Only the tuning panel drags the camera, so the site never downloads the controls.
    if (orbit) {
        import("three/addons/controls/OrbitControls.js").then(({ OrbitControls }) => {
            controls = new OrbitControls(camera, renderer.domElement);
            controls.enableZoom = true;
            controls.enablePan = false;
            controls.enableDamping = true;
            controls.dampingFactor = 0.12;
            controls.rotateSpeed = 0.55;
            controls.addEventListener("start", () => {
                dragging = true;
            });
            controls.addEventListener("end", () => {
                dragging = false;
            });
        });
    }

    let overlayMesh = null;

    function makeOverlay(src) {
        const img = new Image();
        img.src = src;
        img.onload = () => {
            const c = document.createElement("canvas");
            c.width = W;
            c.height = H;
            const ctx = c.getContext("2d");
            ctx.drawImage(img, 0, 0, W, H);
            const tex = new THREE.CanvasTexture(c);
            tex.colorSpace = THREE.SRGBColorSpace;
            const geo = new THREE.PlaneGeometry(W, H);
            const mat = new THREE.MeshBasicMaterial({
                map: tex,
                transparent: true,
                opacity: params.overlayOp,
                depthWrite: false,
            });
            overlayMesh = new THREE.Mesh(geo, mat);
            overlayMesh.position.z = 900;
            overlayMesh.visible = params.overlay;
            group.add(overlayMesh);
        };
    }

    function disposeTree(node) {
        node.traverse((o) => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) {
                const list = Array.isArray(o.material) ? o.material : [o.material];
                for (const m of list) m.dispose();
            }
        });
    }

    function rebuild() {
        for (const child of [...group.children]) {
            if (child === overlayMesh) continue;
            group.remove(child);
            disposeTree(child);
        }
        strokeMaterials.length = 0;
        if (overlayMesh) {
            overlayMesh.material.opacity = params.overlayOp;
            overlayMesh.visible = params.overlay;
        }

        const plane = planeVerts();
        group.add(planeMesh(plane));
        group.add(starMesh(params.starDepth, params.starThick));

        // The line starts inside the star core and ends banking into the dart's course.
        const zs = lineDepth(line2d, plane.tailZ);
        const pts = line2d.map(([x, y], i) => to3(x, y, zs[i]));
        const stroke = makeStroke(simplify(pts, 0.08), params.width);
        if (stroke) group.add(stroke);
        dirty = true;
    }

    function resize() {
        // The canvas sizes itself through CSS — on the site it is deliberately
        // larger than the drawing's box — so measure it, and leave its style alone.
        const w = renderer.domElement.clientWidth;
        const h = renderer.domElement.clientHeight;
        if (!w || !h) return;
        viewport.w = w;
        viewport.h = h;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(w, h, false);
        for (const m of strokeMaterials) m.resolution.set(w, h);
        const aspect = w / h;
        const contentW = W * padX;
        const contentH = H * padY;
        let halfW;
        let halfH;
        if (aspect > contentW / contentH) {
            halfH = contentH / 2;
            halfW = halfH * aspect;
        } else {
            halfW = contentW / 2;
            halfH = halfW / aspect;
        }
        camera.left = -halfW;
        camera.right = halfW;
        camera.top = halfH;
        camera.bottom = -halfH;
        camera.updateProjectionMatrix();
        dirty = true;
    }

    // Where the scene is asked to look, in -1..1 across the tracked area.
    const pointer = { x: 0, y: 0 };
    // Coming home after the cursor left is a slower move than following it.
    let homing = false;
    function setPointer(x, y) {
        pointer.x = Math.max(-1, Math.min(1, x));
        pointer.y = Math.max(-1, Math.min(1, y));
        homing = false;
    }

    // The scene lets go of the cursor and drifts back to the front view.
    function release() {
        setPointer(0, 0);
        homing = true;
    }

    // Current view in the same -1..1 units setPointer takes, so whoever drives the
    // scene can pick the tilt up where it stands instead of jumping to a new target.
    function tilt() {
        const max = THREE.MathUtils.degToRad(params.follow);
        if (!max) return { x: 0, y: 0 };
        return { x: group.rotation.y / max, y: group.rotation.x / max };
    }

    function syncStrokeWidth() {
        const span = (camera.right - camera.left) / camera.zoom;
        const pxPerUnit = span > 0 ? viewport.w / span : 1;
        for (const m of strokeMaterials) {
            m.resolution.set(viewport.w, viewport.h);
            m.linewidth = params.width * pxPerUnit;
        }
    }

    let frame = 0;
    let dirty = true;
    function tick() {
        frame = requestAnimationFrame(tick);
        const max = THREE.MathUtils.degToRad(params.follow);
        let moving = false;
        if (params.followOn && !dragging) {
            const tx = pointer.y * max;
            const ty = pointer.x * max;
            const k = homing ? params.easeBack : params.ease;
            moving =
                Math.abs(tx - group.rotation.x) > 1e-4 || Math.abs(ty - group.rotation.y) > 1e-4;
            group.rotation.x += (tx - group.rotation.x) * k;
            group.rotation.y += (ty - group.rotation.y) * k;
        }
        if (params.autoSpin && !dragging) {
            group.rotation.y += 0.008;
            moving = true;
        }
        if (controls) controls.update();
        // A hero that is standing still costs nothing: only draw when something moved.
        if (!moving && !dirty && !dragging && !orbit) return;
        dirty = false;
        syncStrokeWidth();
        renderer.render(scene, camera);
    }

    const onResize = () => resize();
    window.addEventListener("resize", onResize);
    // The canvas can also change size on its own, when the column it sits in does.
    const observer =
        typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => resize());
    if (observer) observer.observe(renderer.domElement);
    resize();
    rebuild();
    if (overlaySrc) makeOverlay(overlaySrc);
    tick();

    function dispose() {
        cancelAnimationFrame(frame);
        window.removeEventListener("resize", onResize);
        if (observer) observer.disconnect();
        if (controls) controls.dispose();
        disposeTree(group);
        renderer.dispose();
        renderer.domElement.remove();
    }

    function front() {
        group.rotation.set(0, 0, 0);
        setPointer(0, 0);
        if (controls) controls.reset();
        camera.position.set(0, 0, 800);
        camera.lookAt(0, 0, 0);
    }

    return {
        scene,
        group,
        camera,
        renderer,
        params,
        rebuild,
        resize,
        setPointer,
        release,
        tilt,
        front,
        dispose,
        planeVerts,
        planeFit: PLANE_FIT,
        line2d,
        get overlayMesh() {
            return overlayMesh;
        },
    };
}
