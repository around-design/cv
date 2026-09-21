// Puts the hero scene into the divider of the page, in place of the flat drawing.
// On a wide screen the cursor turns the scene. On a phone the page scroll tips
// it, and a horizontal finger on the drawing yaws it the same way as hover.
import { mountHero, params } from "./hero-scene.js?v=11";

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

function variant() {
    return wide.matches ? "desktop" : "mobile";
}

function start() {
    if (hero || !box || !divider) return;
    try {
        hero = mountHero({ mount: box, padX: PAD_X, padY: PAD_Y, variant: variant() });
        box.hidden = false;
        divider.classList.add("hero-3d-on");
        bindInput();
    } catch (err) {
        hero = null;
    }
}

function stop() {
    unbindMobile();
    if (!hero) return;
    hero.dispose();
    hero = null;
    anchor = null;
    yaw = 0;
    pitch = 0;
    box.hidden = true;
    divider.classList.remove("hero-3d-on");
}

function syncLayout() {
    if (!hero) {
        start();
        return;
    }
    anchor = null;
    drag = null;
    yaw = 0;
    pitch = 0;
    hero.setVariant(variant());
    hero.front();
    bindInput();
}

// The scene turns only while the cursor is over the drawing itself, and it turns by
// how far the cursor has travelled, not by where it happens to be: entering at an
// edge starts the tilt at rest, and reversing the cursor reverses the tilt at once.
// A share of the drawing's width or height crossed turns the scene by that share of
// its range, so crossing the whole drawing does not quite reach the limit.
const GAIN = 0.45;
// Scroll maps onto the same range as a typical hover, not the full follow stop.
const SCROLL_GAIN = 0.65;
const LOCK = 10;
// Where the cursor would have to be for the scene to look straight ahead.
let anchor = null;
let yaw = 0;
let pitch = 0;
let returning = false;
let drag = null;
let mobileOn = false;

function clamp(v, a, b) {
    return Math.min(b, Math.max(a, v));
}

// Keep the anchor within reach of the limits, so a tilt pinned at its end still
// answers the first backward move instead of waiting out the overshoot.
function leash(p, a) {
    const span = 1 / GAIN;
    return Math.min(p + span, Math.max(p - span, a));
}

function boxRect() {
    return box.getBoundingClientRect();
}

function overBox(e, r) {
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
}

function pxOf(e, r) {
    return ((e.clientX - r.left) / r.width) * 2 - 1;
}

function pyOf(e, r) {
    return ((e.clientY - r.top) / r.height) * 2 - 1;
}

function apply(home) {
    if (!hero) return;
    if (home === true) returning = true;
    else if (home === false) returning = false;
    hero.setPointer(yaw, pitch, returning);
}

function updatePitch() {
    if (wide.matches) {
        pitch = 0;
        return;
    }
    const span = Math.max(box.offsetHeight, 1);
    const y = window.scrollY || document.documentElement.scrollTop || 0;
    // Negative: the top edge recedes, the bottom comes forward, as you scroll.
    pitch = -clamp(y / span, 0, 1) * SCROLL_GAIN;
}

function onScroll() {
    if (!hero || wide.matches || !params.followOn) return;
    updatePitch();
    apply();
}

function driveHover(e) {
    const r = boxRect();
    if (!overBox(e, r)) {
        if (anchor) onLeave();
        return;
    }
    const px = pxOf(e, r);
    const py = pyOf(e, r);
    if (!anchor) {
        const t = hero.tilt();
        anchor = { x: px - t.x / GAIN, y: py - t.y / GAIN };
    }
    anchor.x = leash(px, anchor.x);
    anchor.y = leash(py, anchor.y);
    yaw = (px - anchor.x) * GAIN;
    pitch = (py - anchor.y) * GAIN;
    apply(false);
}

function driveMouseYaw(e) {
    const r = boxRect();
    if (!overBox(e, r)) {
        if (anchor) {
            anchor = null;
            yaw = 0;
            apply(true);
        }
        return;
    }
    const px = pxOf(e, r);
    if (!anchor) {
        const t = hero.tilt();
        anchor = { x: px - t.x / GAIN };
    }
    anchor.x = leash(px, anchor.x);
    yaw = (px - anchor.x) * GAIN;
    apply(false);
}

function onMove(e) {
    if (!hero || !params.followOn) return;
    if (wide.matches) {
        driveHover(e);
        return;
    }
    if (e.pointerType === "touch" || e.pointerType === "pen") {
        onDragMove(e);
        return;
    }
    driveMouseYaw(e);
}

function onLeave() {
    anchor = null;
    yaw = 0;
    if (wide.matches) pitch = 0;
    else updatePitch();
    apply(true);
}

function onDown(e) {
    if (!hero || wide.matches || !params.followOn) return;
    if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
    const r = boxRect();
    if (!overBox(e, r)) return;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, axis: null, anchorX: null };
}

function onDragMove(e) {
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    if (!drag.axis) {
        if (dx * dx + dy * dy < LOCK * LOCK) return;
        drag.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
        if (drag.axis === "x") {
            const r = boxRect();
            const px = pxOf(e, r);
            const t = hero.tilt();
            drag.anchorX = px - t.x / GAIN;
        }
    }
    if (drag.axis !== "x") return;
    const r = boxRect();
    const px = pxOf(e, r);
    drag.anchorX = leash(px, drag.anchorX);
    yaw = (px - drag.anchorX) * GAIN;
    apply(false);
}

function onUp(e) {
    if (!drag || drag.id !== e.pointerId) return;
    const yawing = drag.axis === "x";
    drag = null;
    if (yawing) {
        yaw = 0;
        updatePitch();
        apply(true);
    }
}

function onTouchMove(e) {
    if (!drag || drag.axis !== "x") return;
    e.preventDefault();
}

function unbindMobile() {
    if (!mobileOn) return;
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("pointerdown", onDown);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    box.removeEventListener("touchmove", onTouchMove, { capture: true });
    mobileOn = false;
    drag = null;
}

function bindMobile() {
    if (mobileOn) return;
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("pointercancel", onUp, { passive: true });
    box.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });
    mobileOn = true;
    updatePitch();
    apply();
}

function bindInput() {
    if (wide.matches) {
        unbindMobile();
        yaw = 0;
        pitch = 0;
        if (hero) hero.setPointer(0, 0, true);
        return;
    }
    bindMobile();
}

if (box && divider) {
    params.followOn = !calm.matches;
    wide.addEventListener("change", syncLayout);
    calm.addEventListener("change", () => {
        params.followOn = !calm.matches;
        if (hero && calm.matches) hero.front();
        yaw = 0;
        pitch = 0;
        anchor = null;
        bindInput();
    });
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("blur", onLeave);
    start();
}
