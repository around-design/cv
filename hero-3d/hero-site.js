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
    // A tap on a phone would pin this hover-anchor, and onGyro then refuses
    // to turn the scene. Mouse still drives the narrow layout on a computer.
    if (!wide.matches && e.pointerType !== "mouse") return;
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
let gyroAsking = false;

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
    if (!gyroOrigin) gyroOrigin = { x: mapped.x, y: mapped.y, type: e.type };
    else if (gyroOrigin.type !== e.type) return;
    hero.setPointer(
        (mapped.x - gyroOrigin.x) / GYRO_SPAN,
        -(mapped.y - gyroOrigin.y) / GYRO_SPAN
    );
}

function dropGestureHooks() {
    document.removeEventListener("click", onFirstGesture, true);
    gyroArmed = false;
}

function listenGyro() {
    if (gyroOn || wide.matches || !hero) return;
    window.addEventListener("deviceorientation", onGyro, { passive: true });
    window.addEventListener("deviceorientationabsolute", onGyro, { passive: true });
    gyroOn = true;
}

function unbindGyro() {
    window.removeEventListener("deviceorientation", onGyro);
    window.removeEventListener("deviceorientationabsolute", onGyro);
    dropGestureHooks();
    gyroOn = false;
    gyroOrigin = null;
    if (hero) hero.release();
}

function onFirstGesture() {
    if (wide.matches || gyroAsking) return;
    // Subscribe in the same turn as the tap: iOS is picky about both the
    // permission call and the listener happening inside the user gesture.
    listenGyro();
    const oriReq =
        typeof DeviceOrientationEvent !== "undefined" && DeviceOrientationEvent.requestPermission;
    const motReq = typeof DeviceMotionEvent !== "undefined" && DeviceMotionEvent.requestPermission;
    if (typeof oriReq === "function" && !gyroPermitted) {
        gyroAsking = true;
        if (typeof motReq === "function") {
            try {
                motReq.call(DeviceMotionEvent);
            } catch {
                /* motion permission is optional */
            }
        }
        try {
            Promise.resolve(oriReq.call(DeviceOrientationEvent))
                .then((state) => {
                    gyroAsking = false;
                    if (state !== "granted") {
                        window.removeEventListener("deviceorientation", onGyro);
                        window.removeEventListener("deviceorientationabsolute", onGyro);
                        gyroOn = false;
                        return;
                    }
                    gyroPermitted = true;
                    dropGestureHooks();
                })
                .catch(() => {
                    gyroAsking = false;
                    window.removeEventListener("deviceorientation", onGyro);
                    window.removeEventListener("deviceorientationabsolute", onGyro);
                    gyroOn = false;
                });
        } catch {
            gyroAsking = false;
            window.removeEventListener("deviceorientation", onGyro);
            window.removeEventListener("deviceorientationabsolute", onGyro);
            gyroOn = false;
        }
        return;
    }
    dropGestureHooks();
}

function armGyro() {
    if (wide.matches) return;
    const needsGesture =
        typeof DeviceOrientationEvent !== "undefined" &&
        typeof DeviceOrientationEvent.requestPermission === "function" &&
        !gyroPermitted;
    if (needsGesture) {
        if (!gyroArmed) {
            document.addEventListener("click", onFirstGesture, true);
            gyroArmed = true;
        }
        return;
    }
    listenGyro();
}

function bindInput() {
    if (wide.matches) unbindGyro();
    else armGyro();
}

function onOrient() {
    gyroOrigin = null;
}

function syncFollowFlag() {
    // Hover/tilt only moves when the person does; keep phone tilt even if
    // Reduce Motion is on, otherwise the mobile scene is a still.
    params.followOn = !calm.matches || !wide.matches;
}

if (box && divider) {
    syncFollowFlag();
    wide.addEventListener("change", syncLayout);
    calm.addEventListener("change", () => {
        syncFollowFlag();
        if (hero && calm.matches && wide.matches) hero.front();
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
