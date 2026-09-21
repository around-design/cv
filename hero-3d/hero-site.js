// Puts the hero scene into the divider of the page, in place of the flat drawing.
// The cursor turns the scene the same way on every width; on a phone the handset
// can turn it too.
import { mountHero, params } from "./hero-scene.js?v=10";

const box = document.getElementById("hero-3d");
const divider = box && box.closest(".divider");
const wide = window.matchMedia("(min-width: 701px)");
const calm = window.matchMedia("(prefers-reduced-motion: reduce)");

// The drawing's own box is the size the flat SVG was; the live drawing around it
// is a touch larger on every side, so a tilt has room to lean out. The padding
// below matches that bleed, which keeps the drawing itself the same size as before.
const PAD_X = 1.08;
const PAD_Y = 1.16;

// Degrees of phone tilt that map onto the scene's full follow range. A rest pose
// is taken from the first reading, so holding the phone as you opened the page
// looks straight ahead.
const GYRO_SPAN = 24;

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
    unbindGyro();
    if (!hero) return;
    hero.dispose();
    hero = null;
    anchor = null;
    box.hidden = true;
    divider.classList.remove("hero-3d-on");
}

function syncLayout() {
    if (!hero) {
        start();
        return;
    }
    anchor = null;
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
    // A real phone already has the gyro: don't let a finger fight it. A mouse
    // over the narrow layout still turns the scene, so the mobile drawing can
    // be checked on a computer the same way as desktop.
    if (gyroOrigin && e.pointerType === "touch") return;
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
    if (hero && !gyroOrigin) hero.release();
}

let gyroOn = false;
let gyroOrigin = null;
let gyroArmed = false;
let gyroPermitted = false;

function screenAngle() {
    const o = screen.orientation;
    if (o && typeof o.angle === "number") return o.angle;
    return typeof window.orientation === "number" ? window.orientation : 0;
}

// beta is front-back, gamma left-right. Rotate that pair into screen space so a
// landscape hold still maps right-tilt to a yaw.
function projectTilt(beta, gamma) {
    const a = ((screenAngle() % 360) + 360) % 360;
    if (a === 90) return { x: beta, y: -gamma };
    if (a === 180) return { x: -gamma, y: -beta };
    if (a === 270) return { x: -beta, y: gamma };
    return { x: gamma, y: beta };
}

function onGyro(e) {
    if (!hero || wide.matches || !params.followOn) return;
    if (e.beta == null || e.gamma == null) return;
    // A mouse over the narrow layout is driving the scene (desktop testing);
    // don't let a leftover orientation reading yank it back.
    if (anchor) return;
    const mapped = projectTilt(e.beta, e.gamma);
    if (!gyroOrigin) gyroOrigin = mapped;
    hero.setPointer(
        (mapped.x - gyroOrigin.x) / GYRO_SPAN,
        -(mapped.y - gyroOrigin.y) / GYRO_SPAN
    );
}

function unbindGyro() {
    if (gyroOn) {
        window.removeEventListener("deviceorientation", onGyro);
        gyroOn = false;
    }
    gyroOrigin = null;
}

async function enableGyro() {
    if (gyroOn || wide.matches || calm.matches || !hero) return;
    try {
        if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
            if (!gyroPermitted) {
                const state = await DeviceOrientationEvent.requestPermission();
                if (state !== "granted") return;
                gyroPermitted = true;
            }
        }
    } catch {
        return;
    }
    if (gyroOn || wide.matches) return;
    window.addEventListener("deviceorientation", onGyro, { passive: true });
    gyroOn = true;
}

function onFirstGesture() {
    enableGyro();
}

function armGyro() {
    unbindGyro();
    if (wide.matches || calm.matches) return;
    const needsGesture =
        typeof DeviceOrientationEvent !== "undefined" &&
        typeof DeviceOrientationEvent.requestPermission === "function" &&
        !gyroPermitted;
    if (needsGesture) {
        if (!gyroArmed) {
            window.addEventListener("pointerdown", onFirstGesture, { passive: true });
            gyroArmed = true;
        }
        return;
    }
    enableGyro();
}

function bindInput() {
    if (wide.matches) unbindGyro();
    else armGyro();
}

function onOrient() {
    gyroOrigin = null;
}

if (box && divider) {
    params.followOn = !calm.matches;
    wide.addEventListener("change", syncLayout);
    calm.addEventListener("change", () => {
        params.followOn = !calm.matches;
        if (hero && calm.matches) hero.front();
        bindInput();
    });
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("blur", onLeave);
    window.addEventListener("orientationchange", onOrient);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") gyroOrigin = null;
        else if (hero && gyroOn) hero.release();
    });
    start();
}
