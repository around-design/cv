// Наклон и тень картинок проектов — те же настройки, что на стенде.
// Пока картинка проявляется, она прямая. Если курсор или палец уже были на ней,
// наклон начинается только со следующего движения.
// На телефоне палец поворачивает картинку, пока ближний угол не подойдёт
// к странице: 1,5° десктопа на маленькой карточке почти не видны.
// До этого предела страница не листается. Дальше палец двигает страницу
// как обычный свайп (вниз пальцем — к началу). Тот же жест Safari уже
// не забирает, поэтому листание здесь, один к одному с пальцем.

const PAD = 220;
const FINGER_SLOP = 8;
const FINGER_REACH = 64;
const FINGER_MAX = 16 * Math.PI / 180;
const narrowLayout = window.matchMedia("(max-width: 950px)");
const TILT = {
    lift: 24,
    perspective: 1410,
    cursorRange: 1.5,
    contact: 0.8,
    gain: 1.5,
    minFrac: 0.01,
    fastTau: 90,
    lights: [
        { x: 0, y: 0, blur: 12, opacity: 0.095 },
        { x: 18, y: 36, blur: 32, opacity: 0.095 },
        { x: 32, y: 64, blur: 43, opacity: 0.07 },
    ],
};

const VS_TRI = `#version 300 es
    void main() {
        vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
        gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
    }`;

const VS_QUAD = `#version 300 es
    layout(location=0) in vec2 aPos;
    layout(location=1) in vec3 aUw;
    uniform mat4 uOrtho;
    out vec3 vUw;
    void main() {
        vUw = aUw;
        gl_Position = uOrtho * vec4(aPos, 0.0, 1.0);
    }`;

const FS_MASK = `#version 300 es
    precision highp float;
    in vec3 vUw;
    uniform sampler2D uPhoto;
    uniform vec2 uCard;
    uniform float uRadius;
    out vec4 fragColor;
    float sdRound(vec2 p, vec2 b, float r) {
        vec2 q = abs(p) - b + r;
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
    }
    void main() {
        vec2 uv = vUw.xy / vUw.z;
        vec2 local = (uv - 0.5) * uCard;
        float d = sdRound(local, uCard * 0.5, uRadius);
        float aa = max(fwidth(d), 0.5);
        float a = (1.0 - smoothstep(-aa, aa, d)) * texture(uPhoto, uv).a;
        fragColor = vec4(a);
    }`;

const FS_CARD = `#version 300 es
    precision highp float;
    in vec3 vUw;
    uniform sampler2D uPhoto;
    uniform vec2 uCard;
    uniform float uRadius;
    out vec4 fragColor;
    float sdRound(vec2 p, vec2 b, float r) {
        vec2 q = abs(p) - b + r;
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
    }
    void main() {
        vec2 uv = vUw.xy / vUw.z;
        vec2 local = (uv - 0.5) * uCard;
        float d = sdRound(local, uCard * 0.5, uRadius);
        float aa = max(fwidth(d), 0.5);
        vec4 pic = texture(uPhoto, uv);
        float cover = (1.0 - smoothstep(-aa, aa, d));
        fragColor = vec4(pic.rgb * cover, pic.a * cover);
    }`;

const FS_DOWN = `#version 300 es
    precision highp float;
    uniform sampler2D uSrc;
    uniform vec2 uSrcSize;
    out vec4 fragColor;
    void main() {
        ivec2 srcSize = max(ivec2(uSrcSize + 0.5), ivec2(1));
        ivec2 s = ivec2(gl_FragCoord.xy) * 2;
        ivec2 s1 = min(s + 1, srcSize - 1);
        vec3 a = texelFetch(uSrc, clamp(s, ivec2(0), srcSize - 1), 0).rgb
            + texelFetch(uSrc, clamp(ivec2(s1.x, s.y), ivec2(0), srcSize - 1), 0).rgb
            + texelFetch(uSrc, clamp(ivec2(s.x, s1.y), ivec2(0), srcSize - 1), 0).rgb
            + texelFetch(uSrc, clamp(s1, ivec2(0), srcSize - 1), 0).rgb;
        fragColor = vec4(a * 0.25, 1.0);
    }`;

const FS_SCAN = `#version 300 es
    precision highp float;
    uniform sampler2D uSrc;
    uniform vec2 uStep;
    uniform float uOffset;
    out vec4 fragColor;
    void main() {
        ivec2 p = ivec2(gl_FragCoord.xy);
        vec3 v = texelFetch(uSrc, p, 0).rgb;
        ivec2 q = p - ivec2(uStep * uOffset + 0.5);
        if (q.x >= 0 && q.y >= 0) v += texelFetch(uSrc, q, 0).rgb;
        fragColor = vec4(v, 1.0);
    }`;

const FS_BOX = `#version 300 es
    precision highp float;
    uniform sampler2D uSat;
    uniform mat3 uH0;
    uniform mat3 uH1;
    uniform mat3 uH2;
    uniform vec4 uZ;
    uniform vec2 uHalf;
    uniform vec2 uFull;
    uniform vec2 uB0;
    uniform vec2 uB1;
    uniform vec2 uB2;
    uniform float uLift;
    uniform float uGain;
    uniform float uMinFrac;
    out vec4 fragColor;

    float zAt(mat3 H, vec2 frag) {
        vec3 q = H * vec3(frag, 1.0);
        vec2 uv = q.xy / max(abs(q.z), 1e-4) * sign(q.z == 0.0 ? 1.0 : q.z);
        float zb = mix(uZ.x, uZ.y, uv.x);
        float zt = mix(uZ.w, uZ.z, uv.x);
        return mix(zb, zt, uv.y);
    }

    float softenHigh(float x, float hi, float knee) {
        float t = clamp((x - (hi - knee)) / knee, 0.0, 1.0);
        float s = t * t * (3.0 - 2.0 * t);
        return mix(min(x, hi - knee), hi, s);
    }

    float softenLow(float x, float lo, float knee) {
        float t = clamp((lo + knee - x) / knee, 0.0, 1.0);
        float s = t * t * (3.0 - 2.0 * t);
        return mix(max(x, lo + knee), lo, s);
    }

    float heightScale(mat3 H, vec2 fullFrag) {
        float zRaw = max(zAt(H, fullFrag), 0.0);
        float s = zRaw / max(uLift, 1.0);
        float sLo = max(uMinFrac, 0.001);
        s = softenLow(s, sLo, max(sLo, 0.08));
        s = softenHigh(s, 2.5, 0.45);
        return s;
    }

    vec3 satAt(ivec2 c) {
        if (c.x < 0 || c.y < 0) return vec3(0.0);
        ivec2 lim = ivec2(uHalf) - 1;
        return texelFetch(uSat, clamp(c, ivec2(0), lim), 0).rgb;
    }

    vec3 prefix(vec2 p) {
        if (p.x <= 0.0 || p.y <= 0.0) return vec3(0.0);
        p = min(p, uHalf);
        vec2 f = fract(p);
        ivec2 i = ivec2(floor(p));
        vec3 s00 = satAt(i - ivec2(1, 1));
        vec3 s10 = satAt(ivec2(i.x, i.y - 1));
        vec3 s01 = satAt(ivec2(i.x - 1, i.y));
        vec3 s11 = satAt(i);
        return mix(mix(s00, s10, f.x), mix(s01, s11, f.x), f.y);
    }

    float boxed(int channel, vec2 p, float radius) {
        float r = max(radius, 0.5);
        vec2 a = p - vec2(r);
        vec2 b = p + vec2(r);
        vec3 sum = prefix(b) - prefix(vec2(a.x, b.y)) - prefix(vec2(b.x, a.y)) + prefix(a);
        float area = max((b.x - a.x) * (b.y - a.y), 1e-3);
        return clamp(sum[channel] / area, 0.0, 1.0);
    }

    void main() {
        vec2 p = gl_FragCoord.xy;
        vec2 fullFrag = p * (uFull / uHalf);
        mat3 H[3] = mat3[3](uH0, uH1, uH2);
        vec2 B[3] = vec2[3](uB0, uB1, uB2);
        vec3 outMask = vec3(0.0);
        for (int i = 0; i < 3; i++) {
            float sigmaFull = max(B[i].x * heightScale(H[i], fullFrag) * uGain, 0.0);
            outMask[i] = boxed(i, p, sigmaFull * 0.5);
        }
        fragColor = vec4(outMask, 1.0);
    }`;

const FS_COMP = `#version 300 es
    precision highp float;
    uniform sampler2D uTex0;
    uniform mat3 uH0;
    uniform mat3 uH1;
    uniform mat3 uH2;
    uniform vec4 uZ;
    uniform vec2 uL0;
    uniform vec2 uL1;
    uniform vec2 uL2;
    uniform vec2 uCanvas;
    uniform vec2 uShadow;
    uniform float uLift;
    uniform float uGain;
    uniform float uContact;
    uniform float uMinFrac;
    uniform vec3 uC0;
    uniform vec3 uC1;
    uniform vec3 uC2;
    out vec4 fragColor;

    float zAt(mat3 H, vec2 frag) {
        vec3 q = H * vec3(frag, 1.0);
        vec2 uv = q.xy / max(abs(q.z), 1e-4) * sign(q.z == 0.0 ? 1.0 : q.z);
        float zb = mix(uZ.x, uZ.y, uv.x);
        float zt = mix(uZ.w, uZ.z, uv.x);
        return mix(zb, zt, uv.y);
    }

    float softenHigh(float x, float hi, float knee) {
        float t = clamp((x - (hi - knee)) / knee, 0.0, 1.0);
        float s = t * t * (3.0 - 2.0 * t);
        return mix(min(x, hi - knee), hi, s);
    }

    float softenLow(float x, float lo, float knee) {
        float t = clamp((lo + knee - x) / knee, 0.0, 1.0);
        float s = t * t * (3.0 - 2.0 * t);
        return mix(max(x, lo + knee), lo, s);
    }

    float fadeAt(mat3 H, vec2 light, vec2 frag) {
        float zRaw = max(zAt(H, frag), 0.0);
        float s = zRaw / max(uLift, 1.0);
        float sLo = max(uMinFrac, 0.001);
        s = softenLow(s, sLo, max(sLo, 0.08));
        s = softenHigh(s, 2.5, 0.45);
        float z = s * uLift;
        float ratio = uLift / max(z, 0.05);
        float prox = softenHigh(ratio, 1.65, 0.35);
        prox = clamp(prox, 0.4, 1.65);
        return light.y * mix(1.0, prox, uContact);
    }

    void main() {
        vec2 frag = gl_FragCoord.xy / uCanvas * uShadow;
        vec3 mask = texture(uTex0, gl_FragCoord.xy / uCanvas).rgb;
        float a0 = mask.r * fadeAt(uH0, uL0, frag);
        float a1 = mask.g * fadeAt(uH1, uL1, frag);
        float a2 = mask.b * fadeAt(uH2, uL2, frag);
        float sum = a0 + a1 + a2;
        float a = min(sum, 1.0);
        vec3 premul = uC0 * a0 + uC1 * a1 + uC2 * a2;
        if (sum > 1.0) premul *= a / sum;
        float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
        float d = a > (1.0 / 255.0) ? clamp(a + (n - 0.5) / 255.0, 0.0, 1.0) : 0.0;
        if (a > 1e-4) premul *= d / a;
        else premul = vec3(0.0);
        fragColor = vec4(premul, d);
    }`;

function pose(lx, ly, ax, ay, lift) {
    const pre = (TILT.perspective - lift) / TILT.perspective;
    const cx = Math.cos(ax);
    const sx = Math.sin(ax);
    const y1 = ly * pre * cx;
    const z1 = ly * pre * sx;
    const cy = Math.cos(ay);
    const sy = Math.sin(ay);
    const xr = lx * pre;
    return { x: xr * cy + z1 * sy, y: y1, z: -xr * sy + z1 * cy + lift };
}

function projectPose(p, ox, oy) {
    const w = (TILT.perspective - p.z) / TILT.perspective;
    return { sx: ox + p.x / w, sy: oy + p.y / w, w, z: p.z };
}

function solve8(A, b) {
    const n = 8;
    const M = A.map((row, i) => row.concat(b[i]));
    for (let col = 0; col < n; col++) {
        let pivot = col;
        for (let r = col + 1; r < n; r++) {
            if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
        }
        if (Math.abs(M[pivot][col]) < 1e-10) return null;
        const tmp = M[col];
        M[col] = M[pivot];
        M[pivot] = tmp;
        const div = M[col][col];
        for (let c = col; c <= n; c++) M[col][c] /= div;
        for (let r = 0; r < n; r++) {
            if (r === col) continue;
            const f = M[r][col];
            for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
        }
    }
    return M.map((row) => row[n]);
}

function homography(src, dst) {
    const A = [];
    const b = [];
    for (let i = 0; i < 4; i++) {
        const x = src[i].sx;
        const y = src[i].sy;
        const X = dst[i][0];
        const Y = dst[i][1];
        A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]);
        b.push(X);
        A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]);
        b.push(Y);
    }
    const h = solve8(A, b);
    if (!h) return null;
    return new Float32Array([
        h[0], h[3], h[6],
        h[1], h[4], h[7],
        h[2], h[5], 1,
    ]);
}

function applyH(m, x, y) {
    const X = m[0] * x + m[3] * y + m[6];
    const Y = m[1] * x + m[4] * y + m[7];
    const W = m[2] * x + m[5] * y + m[8];
    return [X / W, Y / W];
}

function cardPoint(sx, sy, corners, cardW, cardH, radius) {
    const H = homography(corners, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    if (!H) return null;
    const [u, v] = applyH(H, sx, sy);
    const px = (u - 0.5) * cardW;
    const py = (v - 0.5) * cardH;
    const hw = cardW / 2;
    const hh = cardH / 2;
    const rr = Math.min(Math.max(radius, 0), hw, hh);
    const qx = Math.abs(px) - hw + rr;
    const qy = Math.abs(py) - hh + rr;
    const dist = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr;
    if (dist > 0.5) return null;
    return { nx: (u - 0.5) * 2, ny: (v - 0.5) * 2 };
}

function fitScale(ax, ay, hw, hh, lift) {
    const minZ = 1.5;
    const worst = (s) => {
        let m = Infinity;
        for (const [x, y] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]) {
            m = Math.min(m, pose(x, y, ax * s, ay * s, lift).z);
        }
        return m;
    };
    if (worst(1) >= minZ) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2;
        if (worst(mid) >= minZ) lo = mid;
        else hi = mid;
    }
    return lo;
}

function cornersAt(ax, ay, layout) {
    const hw = layout.cardW / 2;
    const hh = layout.cardH / 2;
    const locals = [
        { x: -hw, y: -hh, u: 0, v: 0 },
        { x: hw, y: -hh, u: 1, v: 0 },
        { x: hw, y: hh, u: 1, v: 1 },
        { x: -hw, y: hh, u: 0, v: 1 },
    ];
    return locals.map((local) => {
        const p = projectPose(pose(local.x, local.y, ax, ay, TILT.lift), layout.ox, layout.oy);
        return { sx: p.sx, sy: p.sy, w: p.w, z: p.z, u: local.u, v: local.v };
    });
}

function layoutOf(img) {
    const rect = img.getBoundingClientRect();
    const cardW = Math.max(0, Math.round(rect.width));
    const cardH = Math.max(0, Math.round(rect.height));
    const radius = Math.min(
        parseFloat(getComputedStyle(img).borderRadius) || 0,
        cardW / 2,
        cardH / 2
    );
    return {
        cardW,
        cardH,
        radius,
        shW: cardW + PAD * 2,
        shH: cardH + PAD * 2,
        ox: PAD + cardW / 2,
        oy: PAD + cardH / 2,
    };
}

function parseChannels(text, fallback) {
    const parts = String(text).split(",").map((n) => Number.parseFloat(n.trim()));
    if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return fallback;
    return parts.slice(0, 3).map((n) => n / 255);
}

function readColors(project) {
    const style = getComputedStyle(project);
    const shadow = parseChannels(style.getPropertyValue("--shadow"), [0, 0, 0]);
    let nearRaw = style.getPropertyValue("--shadow-near").trim();
    if (!nearRaw || nearRaw.includes("var(")) nearRaw = style.getPropertyValue("--shadow");
    const near = parseChannels(nearRaw, shadow);
    return [near, shadow, shadow].map((rgb) => new Float32Array(rgb));
}

function canTilt() {
    return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

// На узкой вёрстке те же три света, но вдвое ближе и вдвое резче:
// карточка меньше, и десктопный размах выглядит слишком большим.
function shadowLights() {
    if (!narrowLayout.matches) return TILT.lights;
    return TILT.lights.map((light) => ({
        x: light.x * 0.5,
        y: light.y * 0.5,
        blur: light.blur * 0.5,
        opacity: light.opacity,
    }));
}

function createEngine(canvas) {
    const gl = canvas.getContext("webgl2", {
        alpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
    });
    const engine = { ok: false, gl, draw() {} };
    if (!gl) return engine;

    const floatExt = gl.getExtension("EXT_color_buffer_float");

    function compile(type, src) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, src);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            throw new Error(gl.getShaderInfoLog(shader) || "shader");
        }
        return shader;
    }

    function link(vsSrc, fsSrc) {
        const program = gl.createProgram();
        gl.attachShader(program, compile(gl.VERTEX_SHADER, vsSrc));
        gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fsSrc));
        gl.bindAttribLocation(program, 0, "aPos");
        gl.bindAttribLocation(program, 1, "aUw");
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            throw new Error(gl.getProgramInfoLog(program) || "link");
        }
        return program;
    }

    let maskProg;
    let cardProg;
    let downProg;
    let scanProg;
    let boxProg;
    let compProg;
    const locs = {};
    try {
        maskProg = link(VS_QUAD, FS_MASK);
        cardProg = link(VS_QUAD, FS_CARD);
        downProg = link(VS_TRI, FS_DOWN);
        scanProg = link(VS_TRI, FS_SCAN);
        boxProg = link(VS_TRI, FS_BOX);
        compProg = link(VS_TRI, FS_COMP);
    } catch (error) {
        console.warn("Project tilt shader failed", error);
        return engine;
    }

    function loc(program, name) {
        return gl.getUniformLocation(program, name);
    }

    locs.maskOrtho = loc(maskProg, "uOrtho");
    locs.maskCard = loc(maskProg, "uCard");
    locs.maskRadius = loc(maskProg, "uRadius");
    locs.maskPhoto = loc(maskProg, "uPhoto");
    locs.cardOrtho = loc(cardProg, "uOrtho");
    locs.cardCard = loc(cardProg, "uCard");
    locs.cardRadius = loc(cardProg, "uRadius");
    locs.cardPhoto = loc(cardProg, "uPhoto");
    locs.downSrc = loc(downProg, "uSrc");
    locs.downSrcSize = loc(downProg, "uSrcSize");
    locs.scanSrc = loc(scanProg, "uSrc");
    locs.scanStep = loc(scanProg, "uStep");
    locs.scanOffset = loc(scanProg, "uOffset");
    locs.boxSat = loc(boxProg, "uSat");
    locs.boxH0 = loc(boxProg, "uH0");
    locs.boxH1 = loc(boxProg, "uH1");
    locs.boxH2 = loc(boxProg, "uH2");
    locs.boxZ = loc(boxProg, "uZ");
    locs.boxHalf = loc(boxProg, "uHalf");
    locs.boxFull = loc(boxProg, "uFull");
    locs.boxB0 = loc(boxProg, "uB0");
    locs.boxB1 = loc(boxProg, "uB1");
    locs.boxB2 = loc(boxProg, "uB2");
    locs.boxLift = loc(boxProg, "uLift");
    locs.boxGain = loc(boxProg, "uGain");
    locs.boxMinFrac = loc(boxProg, "uMinFrac");
    for (const name of ["uTex0", "uH0", "uH1", "uH2", "uZ", "uL0", "uL1", "uL2", "uCanvas", "uShadow", "uLift", "uGain", "uContact", "uMinFrac", "uC0", "uC1", "uC2"]) {
        locs[name] = loc(compProg, name);
    }

    const quadBuf = gl.createBuffer();
    const quadIdx = gl.createBuffer();
    const quadData = new Float32Array(4 * 5);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, quadIdx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);

    function bindQuad() {
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, quadIdx);
        gl.enableVertexAttribArray(0);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 20, 0);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 20, 8);
    }

    function writeQuad(corners) {
        let i = 0;
        for (const c of corners) {
            const inv = 1 / c.w;
            quadData[i++] = c.sx;
            quadData[i++] = c.sy;
            quadData[i++] = c.u * inv;
            quadData[i++] = c.v * inv;
            quadData[i++] = inv;
        }
        gl.bufferData(gl.ARRAY_BUFFER, quadData, gl.DYNAMIC_DRAW);
    }

    const photos = new WeakMap();

    function photoTexture(img) {
        let tex = photos.get(img);
        if (tex) return tex;
        tex = gl.createTexture();
        photos.set(img, tex);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        return tex;
    }

    function bindPhoto(unit, uniform, img) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, photoTexture(img));
        gl.uniform1i(uniform, unit);
    }

    const shadowFbo = gl.createFramebuffer();
    let maskTex = null;
    let blurTex = null;
    let halfTex = [null, null];
    let satTex = [null, null];
    let shadowW = 0;
    let shadowH = 0;
    let halfW = 1;
    let halfH = 1;
    let satFormat = null;

    function makeTarget(w, h, internal, filter) {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texStorage2D(gl.TEXTURE_2D, 1, internal, w, h);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return tex;
    }

    function targetOK(tex) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return ok;
    }

    function pickSatFormat() {
        const tryFmt = (internal) => {
            const probe = makeTarget(4, 4, internal, gl.NEAREST);
            const ok = targetOK(probe);
            gl.deleteTexture(probe);
            return ok;
        };
        if (floatExt && tryFmt(gl.RGBA32F)) return gl.RGBA32F;
        if (floatExt && tryFmt(gl.RGBA16F)) return gl.RGBA16F;
        return null;
    }

    satFormat = pickSatFormat();
    if (!satFormat) {
        console.warn("Project tilt needs a float buffer");
        return engine;
    }

    function allocShadows(w, h) {
        for (const tex of [maskTex, blurTex, halfTex[0], halfTex[1], satTex[0], satTex[1]]) {
            if (tex) gl.deleteTexture(tex);
        }
        shadowW = w;
        shadowH = h;
        halfW = Math.max(1, w >> 1);
        halfH = Math.max(1, h >> 1);
        maskTex = makeTarget(w, h, gl.RGBA8, gl.LINEAR);
        const blurInternal = gl.RGBA16F;
        blurTex = makeTarget(halfW, halfH, blurInternal, gl.LINEAR);
        halfTex = [0, 1].map(() => makeTarget(halfW, halfH, blurInternal, gl.NEAREST));
        satTex = [0, 1].map(() => makeTarget(halfW, halfH, satFormat, gl.NEAREST));
    }

    function ortho(w, h) {
        const left = 0;
        const right = w;
        const bottom = 0;
        const top = h;
        const near = -1;
        const far = 1;
        const lr = 1 / (left - right);
        const bt = 1 / (bottom - top);
        const nf = 1 / (near - far);
        return new Float32Array([
            -2 * lr, 0, 0, 0,
            0, -2 * bt, 0, 0,
            0, 0, 2 * nf, 0,
            (left + right) * lr, (top + bottom) * bt, (far + near) * nf, 1,
        ]);
    }

    function attachDraw(tex) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    }

    function prefixSum(src) {
        let read = src;
        const passes = [
            [1, 0, halfW],
            [0, 1, halfH],
        ];
        let which = 0;
        for (const [sx, sy, n] of passes) {
            for (let offset = 1; offset < n; offset <<= 1) {
                const write = satTex[which];
                which ^= 1;
                attachDraw(write);
                gl.viewport(0, 0, halfW, halfH);
                gl.useProgram(scanProg);
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, read);
                gl.uniform1i(locs.scanSrc, 0);
                gl.uniform2f(locs.scanStep, sx, sy);
                gl.uniform1f(locs.scanOffset, offset);
                gl.drawArrays(gl.TRIANGLES, 0, 3);
                read = write;
            }
        }
        return read;
    }

    function blurMasks(lightHs, zPack, lights) {
        attachDraw(halfTex[0]);
        gl.viewport(0, 0, halfW, halfH);
        gl.useProgram(downProg);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, maskTex);
        gl.uniform1i(locs.downSrc, 0);
        gl.uniform2f(locs.downSrcSize, shadowW, shadowH);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        let image = halfTex[0];
        const minFrac = Math.max(TILT.minFrac, 0.001);
        for (let pass = 0; pass < 3; pass++) {
            const sat = prefixSum(image);
            const dest = pass === 2 ? blurTex : halfTex[image === halfTex[0] ? 1 : 0];
            attachDraw(dest);
            gl.viewport(0, 0, halfW, halfH);
            gl.useProgram(boxProg);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, sat);
            gl.uniform1i(locs.boxSat, 0);
            gl.uniformMatrix3fv(locs.boxH0, false, lightHs[0]);
            gl.uniformMatrix3fv(locs.boxH1, false, lightHs[1]);
            gl.uniformMatrix3fv(locs.boxH2, false, lightHs[2]);
            gl.uniform4fv(locs.boxZ, zPack);
            gl.uniform2f(locs.boxHalf, halfW, halfH);
            gl.uniform2f(locs.boxFull, shadowW, shadowH);
            gl.uniform2f(locs.boxB0, lights[0].blur, lights[0].opacity);
            gl.uniform2f(locs.boxB1, lights[1].blur, lights[1].opacity);
            gl.uniform2f(locs.boxB2, lights[2].blur, lights[2].opacity);
            gl.uniform1f(locs.boxLift, TILT.lift);
            gl.uniform1f(locs.boxGain, TILT.gain);
            gl.uniform1f(locs.boxMinFrac, minFrac);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            image = dest;
        }
    }

    engine.draw = (card) => {
        const layout = card.layout;
        const img = card.img;
        if (!layout || layout.cardW < 2 || layout.cardH < 2) return false;
        if (!img.complete || !img.naturalWidth) return false;

        const lights = shadowLights();
        const drawPhoto = card.drawPhoto != null ? card.drawPhoto : canTilt();
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        const shW = Math.max(2, Math.round(layout.shW));
        const shH = Math.max(2, Math.round(layout.shH));
        const bw = Math.max(2, Math.round(shW * dpr));
        const bh = Math.max(2, Math.round(shH * dpr));
        canvas.style.left = `${-PAD}px`;
        canvas.style.top = `${-PAD}px`;
        canvas.style.width = `${shW}px`;
        canvas.style.height = `${shH}px`;
        if (canvas.width !== bw || canvas.height !== bh) {
            canvas.width = bw;
            canvas.height = bh;
        }
        if (shW !== shadowW || shH !== shadowH) allocShadows(shW, shH);

        const cardCorners = cornersAt(card.ax, card.ay, layout);
        const zPack = new Float32Array([
            cardCorners[0].z, cardCorners[1].z, cardCorners[2].z, cardCorners[3].z,
        ]);
        const minFrac = Math.max(TILT.minFrac, 0.001);
        const uvWant = [[0, 0], [1, 0], [1, 1], [0, 1]];
        const channelMask = [
            [true, false, false, false],
            [false, true, false, false],
            [false, false, true, false],
        ];
        const lightHs = [];

        gl.disable(gl.BLEND);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.SCISSOR_TEST);
        bindQuad();
        attachDraw(maskTex);
        gl.viewport(0, 0, shadowW, shadowH);
        gl.colorMask(true, true, true, true);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        lights.forEach((light, index) => {
            const shifted = cardCorners.map((corner) => {
                const shift = Math.max(corner.z / TILT.lift, minFrac);
                return {
                    sx: corner.sx + light.x * shift,
                    sy: corner.sy - light.y * shift,
                    w: corner.w,
                    u: corner.u,
                    v: corner.v,
                };
            });
            const H = homography(shifted, uvWant);
            if (!H) return;
            lightHs[index] = H;
            gl.colorMask(...channelMask[index]);
            gl.useProgram(maskProg);
            gl.uniformMatrix4fv(locs.maskOrtho, false, ortho(shadowW, shadowH));
            gl.uniform2f(locs.maskCard, layout.cardW, layout.cardH);
            gl.uniform1f(locs.maskRadius, layout.radius);
            bindPhoto(3, locs.maskPhoto, img);
            writeQuad(shifted);
            gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
        });
        gl.colorMask(true, true, true, true);
        if (!lightHs[0] || !lightHs[1] || !lightHs[2]) return false;
        blurMasks(lightHs, zPack, lights);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, bw, bh);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(compProg);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, blurTex);
        gl.uniform1i(locs.uTex0, 0);
        gl.uniformMatrix3fv(locs.uH0, false, lightHs[0]);
        gl.uniformMatrix3fv(locs.uH1, false, lightHs[1]);
        gl.uniformMatrix3fv(locs.uH2, false, lightHs[2]);
        gl.uniform4fv(locs.uZ, zPack);
        gl.uniform2f(locs.uL0, lights[0].blur, lights[0].opacity);
        gl.uniform2f(locs.uL1, lights[1].blur, lights[1].opacity);
        gl.uniform2f(locs.uL2, lights[2].blur, lights[2].opacity);
        gl.uniform2f(locs.uCanvas, bw, bh);
        gl.uniform2f(locs.uShadow, shadowW, shadowH);
        gl.uniform1f(locs.uLift, TILT.lift);
        gl.uniform1f(locs.uGain, TILT.gain);
        gl.uniform1f(locs.uContact, TILT.contact);
        gl.uniform1f(locs.uMinFrac, minFrac);
        gl.uniform3fv(locs.uC0, card.colors[0]);
        gl.uniform3fv(locs.uC1, card.colors[1]);
        gl.uniform3fv(locs.uC2, card.colors[2]);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        // Без точного указателя картинка остаётся самим <img>: холст рисует только тень.
        // Иначе фото проходит через текстуру с потолком 2 px на CSS-пиксель и на телефоне мылится.
        if (!drawPhoto) return true;

        const toBufX = bw / shW;
        const toBufY = bh / shH;
        const bufCorners = cardCorners.map((corner) => ({
            sx: corner.sx * toBufX,
            sy: corner.sy * toBufY,
            w: corner.w,
            u: corner.u,
            v: corner.v,
        }));
        gl.useProgram(cardProg);
        gl.uniformMatrix4fv(locs.cardOrtho, false, ortho(bw, bh));
        gl.uniform2f(locs.cardCard, layout.cardW, layout.cardH);
        gl.uniform1f(locs.cardRadius, layout.radius);
        bindPhoto(3, locs.cardPhoto, img);
        writeQuad(bufCorners);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
        return true;
    };

    engine.ok = true;
    return engine;
}

function createSlot() {
    const canvas = document.createElement("canvas");
    canvas.className = "img-tilt";
    canvas.setAttribute("aria-hidden", "true");
    const engine = createEngine(canvas);
    if (!engine.ok) return null;
    return { canvas, engine, card: null };
}

export function initProjectTilts() {
    const wraps = [...document.querySelectorAll(".img-hover-wrap")];
    if (!wraps.length) return;

    const slots = [];
    const first = createSlot();
    if (!first) return;
    slots.push(first);
    document.body.classList.add("has-project-tilt");

    const cards = [];
    let raf = 0;
    let last = 0;

    function slotFree(slot) {
        if (!slot.card) return true;
        if (slot.card.shown()) return false;
        return slot.card.opacity() <= 0.02;
    }

    function acquire(card) {
        let slot = slots.find((item) => item.card === card);
        if (!slot) slot = slots.find((item) => slotFree(item));
        if (!slot && slots.length < 3) {
            slot = createSlot();
            if (slot) slots.push(slot);
        }
        if (!slot) {
            slot = slots.slice().sort((a, b) => a.card.opacity() - b.card.opacity())[0];
            if (slot.card && slot.card !== card) slot.card.slot = null;
        }
        slot.card = card;
        card.slot = slot;
        if (slot.canvas.parentNode !== card.wrap) card.wrap.appendChild(slot.canvas);
        return slot;
    }

    function schedule() {
        if (raf) return;
        raf = requestAnimationFrame(tick);
    }

    let flingFrame = 0;

    function stopFling() {
        if (!flingFrame) return;
        cancelAnimationFrame(flingFrame);
        flingFrame = 0;
    }

    function flingScroll(vy) {
        stopFling();
        let v = vy * 16;
        let prev = performance.now();
        const coast = (now) => {
            const dt = Math.min(34, now - prev);
            prev = now;
            window.scrollBy(0, v * dt / 16);
            v *= Math.pow(0.94, dt / 16);
            if (Math.abs(v) > 0.35) flingFrame = requestAnimationFrame(coast);
            else flingFrame = 0;
        };
        flingFrame = requestAnimationFrame(coast);
    }

    function isFinger(event) {
        return event.pointerType === "touch" || event.pointerType === "pen";
    }

    function ownTouch(card) {
        const own = card.revealed && !canTilt() ? "none" : "";
        card.box.style.touchAction = own;
        card.img.style.touchAction = own;
    }

    function markPlane(card) {
        const turning = card.tiltLive || Math.hypot(card.ax, card.ay) > 0.001;
        card.wrap.classList.toggle("is-tilting", turning && !canTilt());
        card.drawPhoto = canTilt() || card.wrap.classList.contains("is-tilting");
    }

    function noteOpaque(card) {
        if (card.revealed || !card.shown()) return;
        if (card.opacity() < 0.999) return;
        card.revealed = true;
        card.anchor = card.pointer
            ? { x: card.pointer.localX, y: card.pointer.localY }
            : null;
        ownTouch(card);
    }

    function step(card, dt) {
        const layout = layoutOf(card.img);
        card.layout = layout;
        if (layout.cardW < 2 || layout.cardH < 2) return false;

        let tax = 0;
        let tay = 0;
        const hw = layout.cardW / 2;
        const hh = layout.cardH / 2;
        if (card.tiltLive && card.finger) {
            tax = -card.finger.ny * FINGER_MAX;
            tay = card.finger.nx * FINGER_MAX;
        } else if (card.tiltLive && card.pointer && canTilt()) {
            const maxTilt = TILT.cursorRange * Math.PI / 180;
            const shown = fitScale(card.rawAx, card.rawAy, hw, hh, TILT.lift);
            const corners = cornersAt(card.rawAx * shown, card.rawAy * shown, layout);
            const sx = PAD + card.pointer.localX;
            const sy = PAD + (layout.cardH - card.pointer.localY);
            const hit = cardPoint(sx, sy, corners, layout.cardW, layout.cardH, layout.radius);
            if (hit) {
                const nx = Math.max(-1, Math.min(1, hit.nx));
                const ny = Math.max(-1, Math.min(1, hit.ny));
                tax = -ny * maxTilt;
                tay = nx * maxTilt;
            }
        }

        if (!card.tiltLive) {
            card.rawAx = 0;
            card.rawAy = 0;
        } else {
            const tau = card.finger ? 45 : TILT.fastTau;
            const ease = 1 - Math.exp(-dt / tau);
            card.rawAx += (tax - card.rawAx) * ease;
            card.rawAy += (tay - card.rawAy) * ease;
            if (!card.finger && !card.pointer && Math.hypot(card.rawAx, card.rawAy) < 1e-3) {
                card.tiltLive = false;
                card.rawAx = 0;
                card.rawAy = 0;
            }
        }
        const fitted = fitScale(card.rawAx, card.rawAy, hw, hh, TILT.lift);
        card.ax = card.rawAx * fitted;
        card.ay = card.rawAy * fitted;
        return Math.hypot(tax - card.rawAx, tay - card.rawAy) > 1e-4;
    }

    function paint(card, dt) {
        if (!card.shown()) return false;
        noteOpaque(card);
        const animating = step(card, dt);
        const img = card.img;
        if (!img.complete || !img.naturalWidth) {
            img.addEventListener("load", () => {
                card.needsPaint = true;
                schedule();
            }, { once: true });
            return false;
        }
        const slot = acquire(card);
        if (!slot) return false;
        markPlane(card);
        slot.engine.draw(card);
        card.needsPaint = false;
        card.animating = animating;
        return animating;
    }

    function tick(now) {
        raf = 0;
        const dt = last ? Math.min(48, now - last) : 16;
        last = now;
        let again = false;
        for (const card of cards) {
            if (!card.shown()) continue;
            if (!card.needsPaint && !card.animating) continue;
            if (paint(card, dt)) again = true;
        }
        if (again) schedule();
    }

    function resetInteraction(card) {
        if (card.finger) return;
        card.tiltLive = false;
        card.revealed = false;
        card.anchor = null;
        card.pointer = null;
        card.rawAx = 0;
        card.rawAy = 0;
        card.ax = 0;
        card.ay = 0;
        card.needsPaint = false;
        card.animating = false;
        card.drawPhoto = canTilt();
        card.wrap.classList.remove("is-tilting");
        card.box.style.touchAction = "";
        card.img.style.touchAction = "";
    }

    function placePointer(card, event) {
        const rect = card.img.getBoundingClientRect();
        const localX = event.clientX - rect.left;
        const localY = event.clientY - rect.top;
        card.pointer = {
            localX,
            localY,
            sx: PAD + localX,
            sy: PAD + (rect.height - localY),
        };
    }

    function onImagePointer(card, event) {
        if (isFinger(event)) return;
        const wasRevealed = card.revealed;
        placePointer(card, event);
        noteOpaque(card);
        if (card.revealed && canTilt()) {
            let moved = false;
            if (!wasRevealed && card.anchor) moved = false;
            else if (!card.anchor) moved = true;
            else {
                moved = Math.hypot(
                    card.pointer.localX - card.anchor.x,
                    card.pointer.localY - card.anchor.y
                ) >= 1;
            }
            if (moved) card.tiltLive = true;
        }
        if (!card.tiltLive) return;
        card.needsPaint = true;
        schedule();
    }

    function onFingerDown(card, event) {
        if (!isFinger(event) || !card.revealed || !card.shown()) return;
        stopFling();
        card.suppressClick = false;
        card.finger = {
            id: event.pointerId,
            x0: event.clientX,
            y0: event.clientY,
            lastY: event.clientY,
            lastT: performance.now(),
            nx: 0,
            ny: 0,
            scrolled: 0,
            vy: 0,
        };
        try { card.box.setPointerCapture(event.pointerId); } catch (err) { /* синтетическое событие */ }
    }

    function onFingerMove(card, event) {
        const finger = card.finger;
        if (!finger || event.pointerId !== finger.id) return;
        const dx = event.clientX - finger.x0;
        const dy = event.clientY - finger.y0;
        const now = performance.now();
        const prevY = finger.lastY;
        finger.vy = (event.clientY - prevY) / Math.max(1, now - finger.lastT);
        finger.lastT = now;
        finger.lastY = event.clientY;
        if (Math.hypot(dx, dy) < FINGER_SLOP) return;
        event.preventDefault();
        card.suppressClick = true;
        if (!card.revealed || !card.shown()) {
            const delta = event.clientY - prevY;
            if (delta) window.scrollBy(0, -delta);
            return;
        }
        card.tiltLive = true;
        finger.nx = Math.max(-1, Math.min(1, dx / FINGER_REACH));
        finger.ny = Math.max(-1, Math.min(1, -dy / FINGER_REACH));
        const surplus = dy - Math.max(-FINGER_REACH, Math.min(FINGER_REACH, dy));
        const delta = surplus - finger.scrolled;
        finger.scrolled = surplus;
        if (delta) window.scrollBy(0, -delta);
        card.needsPaint = true;
        schedule();
    }

    function endFinger(card, event) {
        const finger = card.finger;
        if (!finger || (event && event.pointerId !== finger.id)) return;
        const flung = Math.abs(finger.scrolled) > 0 && Math.abs(finger.vy) > 0.3;
        const vy = finger.vy;
        card.finger = null;
        if (event && card.box.hasPointerCapture && card.box.hasPointerCapture(event.pointerId)) {
            card.box.releasePointerCapture(event.pointerId);
        }
        if (card.shown()) {
            card.needsPaint = true;
            schedule();
        } else {
            card.tiltLive = false;
            card.rawAx = 0;
            card.rawAy = 0;
            card.ax = 0;
            card.ay = 0;
            card.wrap.classList.remove("is-tilting");
        }
        ownTouch(card);
        if (flung) flingScroll(-vy);
    }

    for (const wrap of wraps) {
        const img = wrap.querySelector(".img-hover");
        const project = wrap.closest(".project");
        const box = wrap.closest(".project-image");
        if (!img || !project || !box) continue;

        const card = {
            project,
            wrap,
            img,
            box,
            colors: readColors(project),
            pointer: null,
            anchor: null,
            revealed: false,
            tiltLive: false,
            rawAx: 0,
            rawAy: 0,
            ax: 0,
            ay: 0,
            needsPaint: false,
            animating: false,
            slot: null,
            layout: null,
            shown() {
                return this.project.matches(":hover") || this.project.classList.contains("is-active");
            },
            opacity() {
                return parseFloat(getComputedStyle(this.wrap).opacity) || 0;
            },
        };
        cards.push(card);

        project.addEventListener("pointerenter", () => {
            card.needsPaint = true;
            paint(card, 16);
            if (card.animating) schedule();
        });
        project.addEventListener("pointerleave", () => {
            if (card.finger) return;
            if (card.shown()) {
                card.pointer = null;
                card.needsPaint = true;
                schedule();
                return;
            }
            resetInteraction(card);
        });
        box.addEventListener("pointerdown", (event) => onFingerDown(card, event));
        box.addEventListener("pointerenter", (event) => onImagePointer(card, event));
        box.addEventListener("pointermove", (event) => onImagePointer(card, event));
        box.addEventListener("pointermove", (event) => onFingerMove(card, event), { passive: false });
        box.addEventListener("pointerup", (event) => endFinger(card, event));
        box.addEventListener("pointercancel", (event) => endFinger(card, event));
        box.addEventListener("lostpointercapture", (event) => endFinger(card, event));
        box.addEventListener("pointerleave", () => {
            if (card.finger) return;
            card.pointer = null;
            if (!card.shown()) return;
            if (card.tiltLive) {
                card.needsPaint = true;
                schedule();
            }
        });
        const link = box.closest("a");
        if (link) {
            link.addEventListener("click", (event) => {
                if (!card.suppressClick) return;
                event.preventDefault();
                event.stopPropagation();
                card.suppressClick = false;
            });
        }
        wrap.addEventListener("transitionend", (event) => {
            if (event.propertyName !== "opacity" || !card.shown()) return;
            noteOpaque(card);
        });

        new MutationObserver(() => {
            if (card.shown()) {
                card.needsPaint = true;
                schedule();
            } else {
                resetInteraction(card);
            }
        }).observe(project, { attributes: true, attributeFilter: ["class"] });

        if (typeof ResizeObserver === "function") {
            new ResizeObserver(() => {
                if (!card.shown()) return;
                card.needsPaint = true;
                schedule();
            }).observe(img);
        }
    }

    for (const card of cards) {
        if (card.shown()) {
            card.needsPaint = true;
            schedule();
        }
    }
}
