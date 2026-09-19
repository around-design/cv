// Puts the hero scene into the divider of the page, in place of the flat drawing.
// Desktop and tablet only: below 700px the layout uses the narrow mobile picture,
// which this scene does not match yet.
import { mountHero, params } from "./hero-scene.js?v=3";

const box = document.getElementById("hero-3d");
const divider = box && box.closest(".divider");
const wide = window.matchMedia("(min-width: 701px)");
const calm = window.matchMedia("(prefers-reduced-motion: reduce)");

// The drawing's own box is the size the flat SVG was; the live drawing around it
// is a touch larger on every side, so a tilt has room to lean out. The padding
// below matches that bleed, which keeps the drawing itself the same size as before.
const PAD_X = 1.08;
const PAD_Y = 1.16;

let hero = null;

function start() {
    if (hero || !box || !divider) return;
    try {
        hero = mountHero({ mount: box, padX: PAD_X, padY: PAD_Y });
        // Swap only after the first frame is already in the DOM, so the flat
        // drawing is not replaced by an empty box.
        box.hidden = false;
        divider.classList.add("hero-3d-on");
    } catch (err) {
        hero = null;
    }
}

function stop() {
    if (!hero) return;
    hero.dispose();
    hero = null;
    anchor = null;
    box.hidden = true;
    divider.classList.remove("hero-3d-on");
}

// The scene turns only while the cursor is over the drawing itself, and it turns by
// how far the cursor has travelled, not by where it happens to be: entering at an
// edge starts the tilt at rest, and reversing the cursor reverses the tilt at once.
// A share of the drawing's width or height crossed turns the scene by that share of
// its range, so crossing the whole drawing does not quite reach the limit.
const GAIN = 0.45;
// Where the cursor would have to be for the scene to look straight ahead.
let anchor = null;

// Keep the anchor within reach of the limits, so a tilt pinned at its end still
// answers the first backward move instead of waiting out the overshoot.
function leash(p, a) {
    const span = 1 / GAIN;
    return Math.min(p + span, Math.max(p - span, a));
}

function onMove(e) {
    if (!hero) return;
    const r = box.getBoundingClientRect();
    // Hit-test the box ourselves: the drawing inside has pointer-events: none so
    // it never steals clicks from the header, and Safari would otherwise let the
    // cursor fall through the empty container without a pointermove on the box.
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
        if (anchor) onLeave();
        return;
    }
    const px = ((e.clientX - r.left) / r.width) * 2 - 1;
    const py = ((e.clientY - r.top) / r.height) * 2 - 1;
    if (!anchor) {
        // Pick the tilt up where it stands: entering leaves the scene as it was.
        const t = hero.tilt();
        anchor = { x: px - t.x / GAIN, y: py - t.y / GAIN };
    }
    anchor.x = leash(px, anchor.x);
    anchor.y = leash(py, anchor.y);
    hero.setPointer((px - anchor.x) * GAIN, (py - anchor.y) * GAIN);
}

function onLeave() {
    anchor = null;
    if (hero) hero.release();
}

function sync() {
    if (wide.matches) start();
    else stop();
}

if (box && divider) {
    params.followOn = !calm.matches;
    wide.addEventListener("change", sync);
    calm.addEventListener("change", () => {
        params.followOn = !calm.matches;
        if (hero && calm.matches) hero.front();
    });
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("blur", onLeave);
    sync();
}
