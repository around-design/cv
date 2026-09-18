// Draws the hero shape as an SVG: the scene is line art with a handful of flat
// faces, so projecting it by hand every frame is cheaper than an engine, and the
// page gets the drawing in a couple of kilobytes instead of a megabyte.
import { params, buildShape, W, H } from "./hero-shape.js";

export { params };

const NS = "http://www.w3.org/2000/svg";
const INK = "#24221f";
const PAPER = "#ffffff";

function svgEl(name, attrs) {
    const node = document.createElementNS(NS, name);
    for (const key in attrs) node.setAttribute(key, attrs[key]);
    return node;
}

// A tenth of a scene unit is a twelfth of a pixel on screen: past that the digits
// only make the path string longer.
const round = (v) => Math.round(v * 10) / 10;

// One page, one scene: the shape is shared module state, the bits below belong to
// the element it is drawn into.
export function mountHero({ mount, orbit = false, overlaySrc = null, padX = 1.12, padY = 1.12 } = {}) {
    let shape = buildShape();

    // The viewBox holds the drawing plus the room a tilt needs, and the browser
    // fits it to however big the element happens to be — so there is no resizing
    // to do, and the stroke keeps its width relative to the drawing.
    // The page can ship the front view already drawn, so the first paint does not
    // wait for this module. If the element is empty, the same markup is built here.
    let svg = mount.querySelector("svg.hero-scene");
    const owned = !svg;
    if (!svg) {
        svg = svgEl("svg", {
            class: "hero-scene",
            xmlns: NS,
            preserveAspectRatio: "xMidYMid meet",
        });
    }
    let zoom = 1;
    function frame() {
        const w = (W * padX) / zoom;
        const h = (H * padY) / zoom;
        svg.setAttribute("viewBox", `${-w / 2} ${-h / 2} ${w} ${h}`);
    }
    frame();

    // Painter's order, back to front: the line, the star over the centre of its
    // coil, then the dart, whose white faces hide the run-out behind it.
    const stroke = {
        fill: "none",
        stroke: INK,
        "stroke-width": params.width,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
    };
    const linePath = svg.querySelector(".hero-line") || svgEl("path", { class: "hero-line", ...stroke });
    const starPath = svg.querySelector(".hero-star") || svgEl("path", { class: "hero-star", fill: INK, "fill-rule": "nonzero" });
    const starCore =
        svg.querySelector(".hero-core") || svgEl("circle", { class: "hero-core", fill: INK, r: shape.star.coreR });
    let facePaths = [...svg.querySelectorAll(".hero-face")];
    while (facePaths.length < shape.faces.length) {
        facePaths.push(svgEl("path", { class: "hero-face", ...stroke, fill: PAPER }));
    }
    facePaths = facePaths.slice(0, shape.faces.length);
    if (owned) {
        svg.append(linePath, starPath, starCore, ...facePaths);
        mount.append(svg);
    }

    // Panel only: the source drawing laid over the front view, to check the match.
    const overlay = overlaySrc
        ? svgEl("image", { href: overlaySrc, x: -W / 2, y: -H / 2, width: W, height: H })
        : null;
    if (overlay) svg.append(overlay);

    // How far the scene is turned: the tilt that follows the cursor, plus whatever
    // the panel has dragged it by.
    const rot = { x: 0, y: 0 };
    const spin = { x: 0, y: 0 };
    let dirty = true;

    function paint() {
        const ax = rot.x + spin.x;
        const ay = rot.y + spin.y;
        const ca = Math.cos(ax);
        const sa = Math.sin(ax);
        const cb = Math.cos(ay);
        const sb = Math.sin(ay);
        // Orthographic: turn the point, then keep two of its three numbers. Screen
        // y is negated because SVG counts downwards; the third row is the depth,
        // which only the faces need, to know which of them is in front.
        const xx = cb;
        const xz = sb;
        const yx = -sa * sb;
        const yy = -ca;
        const yz = sa * cb;
        const zx = -ca * sb;
        const zy = sa;
        const zz = ca * cb;

        const { xs, ys, zs, n } = shape.line;
        const d = new Array(n);
        for (let i = 0; i < n; i++) {
            const x = xs[i];
            const y = ys[i];
            const z = zs[i];
            d[i] =
                (i ? "L" : "M") +
                round(xx * x + xz * z) +
                " " +
                round(yx * x + yy * y + yz * z);
        }
        linePath.setAttribute("d", d.join(""));

        const tris = shape.star.tris;
        const blades = [];
        for (let i = 0; i < tris.length; i += 9) {
            const p = new Array(3);
            for (let v = 0; v < 3; v++) {
                const x = tris[i + v * 3];
                const y = tris[i + v * 3 + 1];
                const z = tris[i + v * 3 + 2];
                p[v] = [xx * x + xz * z, yx * x + yy * y + yz * z];
            }
            // One path, one fill: a back face wound the other way would punch a hole
            // in the spike in front of it. Skip those, and the rest is the silhouette.
            const area =
                (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[1][1] - p[0][1]) * (p[2][0] - p[0][0]);
            if (area <= 0) continue;
            blades.push(
                "M" +
                    round(p[0][0]) +
                    " " +
                    round(p[0][1]) +
                    "L" +
                    round(p[1][0]) +
                    " " +
                    round(p[1][1]) +
                    "L" +
                    round(p[2][0]) +
                    " " +
                    round(p[2][1]) +
                    "Z"
            );
        }
        starPath.setAttribute("d", blades.join(""));
        const core = shape.star.core;
        starCore.setAttribute("cx", round(xx * core[0] + xz * core[2]));
        starCore.setAttribute("cy", round(yx * core[0] + yy * core[1] + yz * core[2]));

        // Four faces, drawn from the furthest to the nearest, so the dart folds
        // the right way round however the scene is turned.
        const drawn = shape.faces.map((face) => {
            let depth = 0;
            let out = "";
            for (let v = 0; v < 3; v++) {
                const [x, y, z] = face[v];
                depth += zx * x + zy * y + zz * z;
                out +=
                    (v ? "L" : "M") +
                    round(xx * x + xz * z) +
                    " " +
                    round(yx * x + yy * y + yz * z);
            }
            return { depth, d: out + "Z" };
        });
        drawn.sort((a, b) => a.depth - b.depth);
        drawn.forEach((face, i) => facePaths[i].setAttribute("d", face.d));
    }

    function rebuild() {
        shape = buildShape();
        linePath.setAttribute("stroke-width", params.width);
        for (const face of facePaths) face.setAttribute("stroke-width", params.width);
        starCore.setAttribute("r", shape.star.coreR);
        updateOverlay();
        dirty = true;
    }

    function updateOverlay() {
        if (!overlay) return;
        overlay.setAttribute("opacity", params.overlay ? params.overlayOp : 0);
    }
    updateOverlay();

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
        const max = (params.follow * Math.PI) / 180;
        if (!max) return { x: 0, y: 0 };
        return { x: rot.y / max, y: rot.x / max };
    }

    let dragging = false;
    function onDown(e) {
        if (!orbit) return;
        dragging = true;
        svg.setPointerCapture(e.pointerId);
    }
    function onDrag(e) {
        if (!dragging) return;
        spin.y += e.movementX * 0.006;
        spin.x += e.movementY * 0.006;
        dirty = true;
    }
    function onUp() {
        dragging = false;
    }
    function onWheel(e) {
        if (!orbit) return;
        e.preventDefault();
        zoom = Math.min(6, Math.max(0.4, zoom * Math.exp(-e.deltaY * 0.0015)));
        frame();
    }
    if (orbit) {
        svg.addEventListener("pointerdown", onDown);
        svg.addEventListener("pointermove", onDrag);
        svg.addEventListener("pointerup", onUp);
        svg.addEventListener("wheel", onWheel, { passive: false });
    }

    let job = 0;
    function tick() {
        job = requestAnimationFrame(tick);
        const max = (params.follow * Math.PI) / 180;
        let moving = false;
        if (params.followOn && !dragging) {
            const tx = pointer.y * max;
            const ty = pointer.x * max;
            const k = homing ? params.easeBack : params.ease;
            moving = Math.abs(tx - rot.x) > 1e-4 || Math.abs(ty - rot.y) > 1e-4;
            rot.x += (tx - rot.x) * k;
            rot.y += (ty - rot.y) * k;
        }
        if (params.autoSpin && !dragging) {
            spin.y += 0.008;
            moving = true;
        }
        // A hero that is standing still costs nothing: only draw when something moved.
        if (!moving && !dirty) return;
        dirty = false;
        paint();
    }
    paint();
    tick();

    function front() {
        rot.x = 0;
        rot.y = 0;
        spin.x = 0;
        spin.y = 0;
        zoom = 1;
        frame();
        setPointer(0, 0);
        dirty = true;
    }

    function dispose() {
        cancelAnimationFrame(job);
        if (orbit) {
            svg.removeEventListener("pointerdown", onDown);
            svg.removeEventListener("pointermove", onDrag);
            svg.removeEventListener("pointerup", onUp);
            svg.removeEventListener("wheel", onWheel);
        }
        if (owned) svg.remove();
        else {
            rot.x = 0;
            rot.y = 0;
            spin.x = 0;
            spin.y = 0;
            zoom = 1;
            frame();
            setPointer(0, 0);
            paint();
        }
    }

    return {
        params,
        rebuild,
        updateOverlay,
        setPointer,
        release,
        tilt,
        front,
        dispose,
    };
}
