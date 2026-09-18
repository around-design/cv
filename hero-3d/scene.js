// Tuning panel for the hero scene. The scene itself, and every value it is set
// to, live in hero-scene.js — this file only wires the sliders to them, so the
// panel and the site always show the same thing.
import { mountHero, params } from "./hero-scene.js";

const el = (id) => document.getElementById(id);
const view = el("view");

const hero = mountHero({ mount: view, orbit: true, overlaySrc: "source.svg" });

const SLIDERS = [
    "follow",
    "ease",
    "ballDepth",
    "ballTwist",
    "zig",
    "starDepth",
    "starThick",
    "size",
    "wingW",
    "valleyW",
    "valleyH",
    "gap",
    "yaw",
    "pitch",
    "roll",
    "width",
    "overlayOp",
];

// Changing these needs no new geometry.
const LIVE = new Set(["follow", "ease", "overlayOp"]);

for (const key of SLIDERS) {
    const input = el(key);
    const label = el(`v-${key}`);
    input.value = String(params[key]);
    const paint = () => {
        params[key] = Number(input.value);
        label.textContent = String(params[key]);
    };
    input.addEventListener("input", () => {
        paint();
        if (!LIVE.has(key)) hero.rebuild();
        else if (key === "overlayOp" && hero.overlayMesh) {
            hero.overlayMesh.material.opacity = params.overlayOp;
        }
    });
    paint();
}

for (const id of ["followOn", "autoSpin", "overlay", "edges"]) {
    const input = el(id);
    input.checked = params[id];
    input.addEventListener("change", () => {
        params[id] = input.checked;
        if (id === "overlay" || id === "edges") hero.rebuild();
    });
}

el("reset").addEventListener("click", () => hero.front());

view.addEventListener("pointermove", (e) => {
    const r = view.getBoundingClientRect();
    hero.setPointer(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1);
});
view.addEventListener("pointerleave", () => hero.setPointer(0, 0));

window.__hero = hero;
