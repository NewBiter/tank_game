// 坦克大战（网页版）- 零依赖纯Canvas实现
// 说明：使用固定“世界坐标”，渲染时按屏幕缩放并居中，避免不同分辨率导致物理不一致。

const $ = (sel) => document.querySelector(sel);
const canvas = /** @type {HTMLCanvasElement} */ ($("#game"));
const ctx = /** @type {CanvasRenderingContext2D|null} */ (canvas?.getContext("2d", { alpha: true }) ?? null);

// 仅用于视觉动画，不影响物理与玩法
let gfxTime = 0;

// Boss受伤喊话冷却（避免连发太吵）
let bossBabyCd = 0;

function bossSayBaby() {
  try {
    if (!("speechSynthesis" in window)) return;
    // 冷却：至少间隔 0.35s
    const now = performance.now() / 1000;
    if (now < bossBabyCd) return;
    bossBabyCd = now + 0.35;

    const u = new SpeechSynthesisUtterance("baby");
    u.lang = "en-US";
    u.rate = 1.05;
    u.pitch = 1.15;
    u.volume = 0.9;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch {
    // ignore
  }
}

// ===== 资源：Boss图片 =====
const bossImg = new Image();
bossImg.src = "./Untitled.jpeg";
let bossImgOk = false;
bossImg.onload = () => { bossImgOk = true; };
bossImg.onerror = () => { bossImgOk = false; };

// ===== 音频（BGM + 命中音效，零资源文件）=====
function createAudio() {
  /** @type {AudioContext|null} */
  let ac = null;
  let master = null;
  let comp = null;
  let musicBus = null;
  let sfxBus = null;
  let musicLP = null;
  let delay = null;
  let delayFb = null;
  let muted = false;
  let musicOn = false;
  let timer = null;
  let nextT = 0;
  let step = 0;

  const bpm = 108;
  const stepDur = (60 / bpm) / 4; // 16步/小节
  const lookAhead = 0.12;

  function ensure() {
    if (ac) return true;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return false;
    ac = new Ctx();

    master = ac.createGain();
    master.gain.value = 0.65;

    comp = ac.createDynamicsCompressor();
    comp.threshold.value = -22;
    comp.knee.value = 18;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.01;
    comp.release.value = 0.16;

    musicBus = ac.createGain();
    sfxBus = ac.createGain();
    musicBus.gain.value = 0.40;
    sfxBus.gain.value = 1.00;

    // 音乐：低通 + 轻延迟（让声音更柔和、空间感更自然）
    musicLP = ac.createBiquadFilter();
    musicLP.type = "lowpass";
    musicLP.frequency.value = 1200;
    musicLP.Q.value = 0.6;

    delay = ac.createDelay(0.35);
    delay.delayTime.value = 0.18;
    delayFb = ac.createGain();
    delayFb.gain.value = 0.25;

    musicBus.connect(musicLP);
    musicLP.connect(comp);
    // delay send
    musicLP.connect(delay);
    delay.connect(delayFb);
    delayFb.connect(delay);
    delay.connect(comp);

    sfxBus.connect(comp);
    comp.connect(master);
    master.connect(ac.destination);

    syncUI();
    return true;
  }

  function syncUI() {
    if (ui?.btnSound) ui.btnSound.textContent = muted ? "🔇" : "🔊";
    if (master && ac) master.gain.setValueAtTime(muted ? 0 : 0.65, ac.currentTime);
  }

  function unlock() {
    if (!ensure()) return;
    if (ac.state === "suspended") ac.resume();
    // 移动端解锁：无声振荡器
    const o = ac.createOscillator();
    const g = ac.createGain();
    g.gain.value = 0;
    o.connect(g).connect(sfxBus);
    o.start();
    o.stop(ac.currentTime + 0.01);
  }

  function hz(semiFromA4) {
    return 440 * Math.pow(2, semiFromA4 / 12);
  }

  function envGain(g, t0, a, d, s, r, peak) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * s), t0 + a + d);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d + r);
  }

  function osc({ freq, type, t0, dur, peak, dest, detune = 0 }) {
    if (!ac) return;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    o.detune.value = detune;
    envGain(g, t0, 0.005, Math.min(0.06, dur * 0.25), 0.55, Math.max(0.05, dur * 0.8), peak);
    o.connect(g).connect(dest);
    o.start(t0);
    o.stop(t0 + dur + 0.08);
  }

  function noiseBurst({ t0, dur, peak, hp, bp }) {
    if (!ac) return;
    const len = Math.floor(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    const src = ac.createBufferSource();
    src.buffer = buf;
    const g = ac.createGain();
    envGain(g, t0, 0.001, dur * 0.2, 0.25, dur * 0.9, peak);
    let node = src;
    if (hp) {
      const f = ac.createBiquadFilter();
      f.type = "highpass";
      f.frequency.value = hp;
      node.connect(f);
      node = f;
    }
    if (bp) {
      const f = ac.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = bp;
      f.Q.value = 1.2;
      node.connect(f);
      node = f;
    }
    node.connect(g).connect(sfxBus);
    src.start(t0);
  }

  function kick(t0) {
    if (!ac) return;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(120, t0);
    o.frequency.exponentialRampToValueAtTime(46, t0 + 0.09);
    envGain(g, t0, 0.001, 0.02, 0.2, 0.14, 0.55);
    o.connect(g).connect(musicBus);
    o.start(t0);
    o.stop(t0 + 0.2);
  }

  function hat(t0) {
    if (!ac) return;
    const len = Math.floor(ac.sampleRate * 0.03);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.5);
    const src = ac.createBufferSource();
    src.buffer = buf;
    const hp = ac.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7000;
    const g = ac.createGain();
    envGain(g, t0, 0.001, 0.01, 0.2, 0.05, 0.08);
    src.connect(hp).connect(g).connect(musicBus);
    src.start(t0);
  }

  function snare(t0) {
    noiseBurst({ t0, dur: 0.11, peak: 0.18, hp: 1200, bp: 2200 });
    osc({ freq: 180, type: "triangle", t0, dur: 0.10, peak: 0.10, dest: sfxBus });
  }

  // 和弦进行（A小调氛围）：Am - F - G - Em
  const prog = [
    { root: -12, triad: [0, 3, 7] },  // Am
    { root: -17, triad: [0, 4, 7] },  // F
    { root: -14, triad: [0, 4, 7] },  // G
    { root: -19, triad: [0, 3, 7] },  // Em
  ];

  function schedule() {
    if (!ac || !musicOn || muted || ac.state === "suspended") return;
    const now = ac.currentTime;
    if (nextT < now) nextT = now;
    while (nextT < now + lookAhead) {
      const bar = Math.floor(step / 16) % prog.length;
      const s = step % 16;
      const chord = prog[bar];

      // 鼓：kick on 0,8；snare on 4,12；hat every 2 steps
      if (s === 0 || s === 8) kick(nextT);
      if (s === 4 || s === 12) snare(nextT);
      if (s % 2 === 0) hat(nextT);

      // Pad（和弦垫底，每小节一次）
      if (s === 0) {
        for (const n of chord.triad) {
          osc({
            freq: hz(chord.root + n),
            type: "sawtooth",
            t0: nextT,
            dur: stepDur * 16 * 0.98,
            peak: 0.035,
            dest: musicBus,
            detune: (n === 0 ? -6 : 6),
          });
        }
      }

      // Arp（琶音：更柔和的triangle）
      const arpSeq = [0, 2, 1, 2, 0, 2, 1, 2];
      if (s % 2 === 0) {
        const idx = arpSeq[(s / 2) % arpSeq.length];
        const semi = chord.root + chord.triad[idx] + 12; // 上移一组
        osc({
          freq: hz(semi),
          type: "triangle",
          t0: nextT,
          dur: stepDur * 1.6,
          peak: 0.045,
          dest: musicBus,
        });
      }

      step += 1;
      nextT += stepDur;
    }
  }

  function startMusic() {
    if (!ensure() || !ac) return;
    if (musicOn) return;
    if (ac.state === "suspended") return;
    musicOn = true;
    step = 0;
    nextT = ac.currentTime;
    timer = setInterval(schedule, 30);
  }

  function stopMusic() {
    musicOn = false;
    if (timer) clearInterval(timer);
    timer = null;
  }

  function toggleMute() {
    muted = !muted;
    syncUI();
  }

  // 命中：更像“砰/金属火花”
  function hit(owner) {
    if (!ensure() || !ac || ac.state === "suspended" || muted) return;
    const t0 = ac.currentTime;
    const base = owner === "enemy" ? 260 : (owner === "p2" ? 340 : 300);
    // click + 带通噪声
    osc({ freq: base * 2.2, type: "square", t0, dur: 0.035, peak: 0.10, dest: sfxBus });
    noiseBurst({ t0: t0 + 0.005, dur: 0.06, peak: 0.16, hp: 1800, bp: 3200 });
  }

  // 爆炸：低频下落 + 低通噪声
  function boom(owner) {
    if (!ensure() || !ac || ac.state === "suspended" || muted) return;
    const t0 = ac.currentTime;
    const f0 = owner === "enemy" ? 95 : 120;
    // 低频下落
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(f0 * 2.2, t0);
    o.frequency.exponentialRampToValueAtTime(f0, t0 + 0.14);
    envGain(g, t0, 0.001, 0.03, 0.3, 0.22, 0.22);
    o.connect(g).connect(sfxBus);
    o.start(t0);
    o.stop(t0 + 0.35);
    // 低通噪声
    noiseBurst({ t0: t0 + 0.01, dur: 0.18, peak: 0.22, hp: 60, bp: 420 });
  }

  return { unlock, startMusic, stopMusic, toggleMute, hit, boom };
}

const audio = createAudio();

function setText(el, text) {
  if (!el) return;
  el.textContent = String(text);
}

function showFatalError(err) {
  try {
    const msg = (err && (err.stack || err.message)) ? String(err.stack || err.message) : String(err);
    // 尽量把错误展示到覆盖层，避免“异常结束像黑屏”
    if (ui?.overlay) {
      ui.overlay.classList.remove("hidden");
      const panel = ui.overlay.querySelector(".panel");
      if (panel) {
        const h1 = panel.querySelector("h1");
        const sub = panel.querySelector(".sub");
        if (h1) h1.textContent = "发生错误（已停止）";
        if (sub) sub.textContent = msg.slice(0, 260);
      }
    } else {
      // 兜底
      // eslint-disable-next-line no-alert
      alert(msg);
    }
  } catch {
    // ignore
  }
}

const ui = {
  overlay: $("#overlay"),
  app: $("#app"),
  levelPass: $("#level-pass"),
  adminPanel: $("#admin-panel"),
  btnRoleUser: $("#btn-role-user"),
  btnRoleAdmin: $("#btn-role-admin"),
  btnAdminLogin: $("#btn-admin-login"),
  levelSelect: $("#level-select"),
  invincible: $("#invincible"),
  btnStart: $("#btn-start"),
  btnMode1: $("#btn-mode-1"),
  btnMode2: $("#btn-mode-2"),
  btnPause: $("#btn-pause"),
  btnRestart: $("#btn-restart"),
  btnSound: $("#btn-sound"),
  // 兼容旧HUD（#score/#lives）与新HUD（#score1/#lives1/#score2/#lives2）
  score1: $("#score1") || $("#score"),
  lives1: $("#lives1") || $("#lives"),
  score2: $("#score2"),
  lives2: $("#lives2"),
  level: $("#level"),
  buffs: $("#buffs"),
  enemies: $("#enemies"),
};

window.addEventListener("error", (e) => {
  showFatalError(e?.error || e?.message || e);
});
window.addEventListener("unhandledrejection", (e) => {
  showFatalError(e?.reason || e);
});

// ===== 特效（爆炸/火花）=====
const fx = {
  particles: /** @type {Array<{x:number,y:number,vx:number,vy:number,life:number,max:number,r:number,color:string,glow:number}>} */ ([]),
  rings: /** @type {Array<{x:number,y:number,life:number,max:number,color:string,from:number,to:number}>} */ ([]),
};

function colorForOwner(owner) {
  if (owner === "p1") return "#a5d8ff";
  if (owner === "p2") return "#34d399";
  if (owner === "enemy") return "#fb7185";
  return "#e5e7eb";
}

function spawnImpact(x, y, owner, strength = 1) {
  audio.hit(owner);
  const c = colorForOwner(owner);
  const n = Math.floor(10 * strength);
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2);
    const sp = rand(40, 160) * strength;
    fx.particles.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: rand(0.10, 0.22) * strength,
      max: 0,
      r: rand(1.2, 2.6) * strength,
      color: c,
      glow: 0.55,
    });
  }
  fx.rings.push({
    x, y,
    life: 0.18 * strength,
    max: 0.18 * strength,
    color: c,
    from: 3 * strength,
    to: 16 * strength,
  });
}

function spawnExplosion(x, y, owner, strength = 1) {
  audio.boom(owner);
  const c = colorForOwner(owner);
  const n = Math.floor(26 * strength);
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2);
    const sp = rand(60, 240) * strength;
    fx.particles.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: rand(0.25, 0.55) * strength,
      max: 0,
      r: rand(1.8, 4.2) * strength,
      color: c,
      glow: 0.75,
    });
  }
  fx.rings.push({
    x, y,
    life: 0.42 * strength,
    max: 0.42 * strength,
    color: c,
    from: 6 * strength,
    to: 46 * strength,
  });
}

function updateFX(dt) {
  for (const p of fx.particles) {
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    // 空气阻尼
    p.vx *= Math.pow(0.02, dt);
    p.vy *= Math.pow(0.02, dt);
  }
  fx.particles = fx.particles.filter(p => p.life > 0);
  for (const r of fx.rings) r.life -= dt;
  fx.rings = fx.rings.filter(r => r.life > 0);
}

function drawFX(vp) {
  if (!ctx) return;
  if (fx.particles.length === 0 && fx.rings.length === 0) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  // 环
  for (const r of fx.rings) {
    const t = 1 - clamp(r.life / r.max, 0, 1);
    const rr = r.from + (r.to - r.from) * t;
    const alpha = (1 - t) * 0.55;
    const p = worldToScreen(vp, r.x, r.y);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = r.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, rr * vp.scale, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 粒子
  for (const p0 of fx.particles) {
    const t = clamp(p0.life / (p0.max || (p0.max = p0.life)), 0, 1);
    const alpha = t * 0.9;
    const p = worldToScreen(vp, p0.x, p0.y);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p0.color;
    // 小“火花点”
    ctx.beginPath();
    ctx.arc(p.x, p.y, p0.r * vp.scale, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

// ===== 世界与渲染 =====
const TILE = 32;
const WORLD_W = 26 * TILE;
const WORLD_H = 20 * TILE;

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function rand(a, b) { return a + Math.random() * (b - a); }
function irand(a, b) { return Math.floor(rand(a, b + 1)); }

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function lineIntersectsRect(x1, y1, x2, y2, r) {
  // 粗略：用AABB扩展来判断“是否可能”，再做采样步进（足够用于AI视线）
  const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
  const bb = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  if (!rectsOverlap(bb, r)) return false;
  const steps = Math.ceil(Math.max(bb.w, bb.h) / 8);
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return true;
  }
  return false;
}

function resizeCanvas() {
  if (!ctx) return;
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

window.addEventListener("resize", resizeCanvas, { passive: true });

function computeViewport() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const scale = Math.min(w / WORLD_W, h / WORLD_H);
  const viewW = WORLD_W * scale;
  const viewH = WORLD_H * scale;
  const offsetX = (w - viewW) / 2;
  const offsetY = (h - viewH) / 2;
  return { scale, offsetX, offsetY, w, h };
}

function worldToScreen(vp, x, y) {
  return { x: vp.offsetX + x * vp.scale, y: vp.offsetY + y * vp.scale };
}

// ===== 输入（键盘+触摸）=====
function createInput() {
  return {
    up: false, down: false, left: false, right: false,
    fire: false,
    firePressed: false, // edge
  };
}

function createMoveTracker() {
  return {
    seq: 0,
    order: { up: 0, right: 0, down: 0, left: 0 },
  };
}

function markDirDown(inputObj, tracker, key) {
  if (!(key in inputObj)) return;
  if (!inputObj[key]) {
    tracker.seq += 1;
    tracker.order[key] = tracker.seq;
  }
  inputObj[key] = true;
}

function markDirUp(inputObj, key) {
  if (!(key in inputObj)) return;
  inputObj[key] = false;
}

function recomputeMoveDir(inputObj, tracker) {
  const moveKeyToDir = { up: 0, right: 1, down: 2, left: 3 };
  let bestKey = null;
  let bestSeq = -1;
  for (const k of ["up", "right", "down", "left"]) {
    if (inputObj[k] && tracker.order[k] > bestSeq) {
      bestSeq = tracker.order[k];
      bestKey = k;
    }
  }
  return bestKey ? moveKeyToDir[bestKey] : null;
}

const inputP1 = createInput();
const inputP2 = createInput();
const moveP1 = createMoveTracker();
const moveP2 = createMoveTracker();
let pausePressed = false;

// P1: WASD + Space
const keyMapP1 = new Map([
  ["KeyW", "up"],
  ["KeyS", "down"],
  ["KeyA", "left"],
  ["KeyD", "right"],
]);
// P2: Arrow + Enter
const keyMapP2 = new Map([
  ["ArrowUp", "up"],
  ["ArrowDown", "down"],
  ["ArrowLeft", "left"],
  ["ArrowRight", "right"],
]);

function onKey(e, isDown) {
  // 当焦点在输入框/文本域/可编辑区域时，不要拦截按键（否则无法输入选关密码，如 vae）
  const ae = document.activeElement;
  const tag = ae && ae.tagName ? ae.tagName.toUpperCase() : "";
  const isTyping = !!ae && (tag === "INPUT" || tag === "TEXTAREA" || ae.isContentEditable);
  if (isTyping) {
    // 允许在密码框按 Enter 直接开始
    if (e.code === "Enter" && isDown && ae === ui.levelPass) {
      e.preventDefault();
      audio.unlock();
      audio.startMusic();
      startGame();
    }
    return;
  }

  if (e.code === "KeyP" && isDown) {
    e.preventDefault();
    pausePressed = true;
    return;
  }

  const k1 = keyMapP1.get(e.code);
  const k2 = keyMapP2.get(e.code);

  if (k1) {
    e.preventDefault();
    if (isDown) markDirDown(inputP1, moveP1, k1);
    else markDirUp(inputP1, k1);
    return;
  }
  if (k2) {
    e.preventDefault();
    if (isDown) markDirDown(inputP2, moveP2, k2);
    else markDirUp(inputP2, k2);
    return;
  }

  if (e.code === "Space") {
    e.preventDefault();
    if (isDown && !inputP1.fire) inputP1.firePressed = true;
    inputP1.fire = isDown;
    return;
  }
  if (e.code === "Enter") {
    e.preventDefault();
    if (isDown && !inputP2.fire) inputP2.firePressed = true;
    inputP2.fire = isDown;
    return;
  }
}

window.addEventListener("keydown", (e) => onKey(e, true));
window.addEventListener("keyup", (e) => onKey(e, false));

function setupTouchControls() {
  const root = $("#touch");
  if (!root) return;
  const press = (key, down) => {
    if (!key || key === "none") return;
    if (key === "fire") {
      if (down && !inputP1.fire) inputP1.firePressed = true;
      inputP1.fire = down;
      return;
    }
    if (!(key in inputP1)) return;
    if (down) markDirDown(inputP1, moveP1, key);
    else markDirUp(inputP1, key);
  };
  const bindBtn = (btn) => {
    const key = btn.dataset.touch;
    const down = (e) => { e.preventDefault(); press(key, true); };
    const up = (e) => { e.preventDefault(); press(key, false); };
    btn.addEventListener("pointerdown", down);
    btn.addEventListener("pointerup", up);
    btn.addEventListener("pointercancel", up);
    btn.addEventListener("pointerleave", up);
  };
  root.querySelectorAll("[data-touch]").forEach(bindBtn);
}

setupTouchControls();

// ===== 游戏对象 =====
const DIR = { UP: 0, RIGHT: 1, DOWN: 2, LEFT: 3 };
const DIR_V = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

function dirFromInput(inputObj, tracker) {
  return recomputeMoveDir(inputObj, tracker);
}

class Tank {
  constructor({ x, y, dir, isPlayer, playerId }) {
    this.x = x; this.y = y;
    this.w = 28; this.h = 28;
    this.dir = dir ?? DIR.UP;
    this.isPlayer = !!isPlayer;
    this.playerId = playerId ?? null; // 1 | 2 | null
    this.speed = this.isPlayer ? 120 : 88;
    this.cooldown = 0;
    this.alive = true;
    this.invuln = this.isPlayer ? 1.2 : 0;
    this.hp = this.isPlayer ? 1 : 1;
    this.maxHp = this.hp;
    // 玩家道具Buff（时间戳：state.time）
    this.buffs = this.isPlayer ? { shieldUntil: 0, rapidUntil: 0, pierceUntil: 0 } : null;
    this.ai = this.isPlayer ? null : {
      turnTimer: rand(0.2, 1.2),
      shootTimer: rand(0.3, 1.6),
    };
  }
  rect() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }
  center() { return { x: this.x + this.w / 2, y: this.y + this.h / 2 }; }
}

class Bullet {
  constructor({ x, y, dir, owner, speed, pierce }) {
    this.x = x; this.y = y;
    this.dir = dir;
    this.owner = owner; // "p1" | "p2" | "enemy"
    this.r = 4;
    this.speed = speed ?? 260;
    this.pierce = pierce ?? 0; // 穿甲次数（只对砖墙生效）
    this.alive = true;
  }
  rect() { return { x: this.x - this.r, y: this.y - this.r, w: this.r * 2, h: this.r * 2 }; }
}

class Tile {
  constructor({ x, y, type }) {
    this.x = x; this.y = y;
    this.w = TILE; this.h = TILE;
    this.type = type; // "brick" | "steel" | "water" | "grass" | "base"
    this.hp = type === "brick" ? 1 : (type === "base" ? 1 : 999);
  }
  rect() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }
  solid() { return this.type === "brick" || this.type === "steel" || this.type === "base"; }
  blocksBullets() { return this.type === "brick" || this.type === "steel" || this.type === "base"; }
  blocksTanks() { return this.solid() || this.type === "water"; }
}

// ===== 关卡 =====
// 字符含义：
// # 砖墙(可破坏)  S 钢墙(不可破坏)  ~ 水(不可穿越)  . 空地  G 草(不阻挡/覆盖层)  B 基地
const LEVELS = [
  {
    name: "第1关：平原防线",
    night: false,
    waveTotal: 12,
    aliveCap: 4,
    enemySpeedMul: 1.0,
    enemyBulletMul: 1.0,
    enemyShootMin: 0.60,
    enemyShootMax: 1.80,
    alignEps: 10,
    eliteChance: 0.00,
    dropChance: 0.22,
    layout: [
      "..........................",
      "..####....S....####....S..",
      "..#..#....S....#..#....S..",
      "..####....S....####....S..",
      "..........................",
      "..~~~~..............~~~~..",
      "..~~~~..####..####..~~~~..",
      "........#..#..#..#........",
      "..####..####..####..####..",
      "..#..#................#..#",
      "..####..S..S..S..S..####..",
      "..........................",
      "....G..G..G..G..G..G..G...",
      "..........................",
      "..####............####....",
      "..#..#....####....#..#....",
      "..####....#..#....####....",
      "..........####............",
      "...........BB.............",
      "..........................",
    ],
  },
  {
    name: "第2关：迷宫水道",
    night: false,
    waveTotal: 16,
    aliveCap: 5,
    enemySpeedMul: 1.08,
    enemyBulletMul: 1.05,
    enemyShootMin: 0.52,
    enemyShootMax: 1.55,
    alignEps: 9,
    eliteChance: 0.16,
    dropChance: 0.26,
    layout: [
      "....S......####......S....",
      "..####..S..#..#..S..####..",
      "..#..#..S..####..S..#..#..",
      "..####......S......####...",
      "..........~~~~~~..........",
      "..S..####..~~~~..####..S..",
      "..S..#..#........#..#..S..",
      "..S..####..####..####..S..",
      "......S....#..#....S......",
      "..####....##..##....####..",
      "..#..#....#....#....#..#..",
      "..####..S.######.S..####..",
      "..........G..G..........G.",
      "..S..####..####..####..S..",
      "..S..#..#........#..#..S..",
      "..S..####..~~~~..####..S..",
      "..........~~~~~~..........",
      "...####......S......####..",
      "...........BB.............",
      "..........................",
    ],
  },
  {
    name: "第3关：Boss要塞",
    night: false,
    fog: false,
    hasBoss: true,
    grassBlocksSight: true,
    waveTotal: 22,
    aliveCap: 6,
    enemySpeedMul: 1.15,
    enemyBulletMul: 1.12,
    enemyShootMin: 0.42,
    enemyShootMax: 1.25,
    alignEps: 8,
    eliteChance: 0.30,
    dropChance: 0.30,
    layout: [
      "..S..####..GG..####..S....",
      "..S..#..#..S..#..#..S.....",
      ".....####..S..####..GGGG..",
      "..~~~~......S......~~~~...",
      "..~~~~..####..####..~~~~..",
      "........#..#..#..#........",
      "..####..####..####..####..",
      "..#..#................#..#",
      "..####..S..S..S..S..####..",
      "....GGG........GGG........",
      "..GGGGGG..GGGG..GGGGGG....",
      "..........................",
      "..####..####..####..####..",
      "..#..#..GGGG..GGGG..#..#..",
      "..####..S..S..S..S..####..",
      "....GGGG......S......GG...",
      "..~~~~..####..####..~~~~..",
      "..~~~~..GGGG....GGGG~~~~..",
      "....GG.....BB.....GG......",
      "..........................",
    ],
  },
];

function buildTiles(layout) {
  /** @type {Tile[]} */
  const tiles = [];
  for (let y = 0; y < layout.length; y++) {
    const row = layout[y];
    for (let x = 0; x < row.length; x++) {
      const c = row[x];
      const wx = x * TILE;
      const wy = y * TILE;
      if (c === "#") tiles.push(new Tile({ x: wx, y: wy, type: "brick" }));
      else if (c === "S") tiles.push(new Tile({ x: wx, y: wy, type: "steel" }));
      else if (c === "~") tiles.push(new Tile({ x: wx, y: wy, type: "water" }));
      else if (c === "G") tiles.push(new Tile({ x: wx, y: wy, type: "grass" }));
      else if (c === "B") tiles.push(new Tile({ x: wx, y: wy, type: "base" }));
    }
  }
  return tiles;
}

// ===== 状态 =====
const state = {
  running: false,
  paused: false,
  over: false,
  win: false,
  time: 0, // 关卡内计时（秒，用于buff）
  levelIndex: 0,
  levelCfg: LEVELS[0],
  pendingNextLevel: false,
  mode: 2, // 1=单人(P1) 2=双人(P1+P2)
  admin: false,
  adminAuthed: false,
  invincible: false, // 玩家无敌（不掉命）
  scores: [0, 0], // [p1, p2]
  lives: [3, 3],  // [p1, p2]
  waveLeft: 10, // 总敌人数量
  enemiesAlive: 0,
  enemySpawnTimer: 0,
  tiles: buildTiles(LEVELS[0].layout),
  grass: [], // 覆盖层
  solids: [],
  players: /** @type {Tank[]} */ ([]),
  enemies: /** @type {Tank[]} */ ([]),
  bullets: /** @type {Bullet[]} */ ([]),
  powerUps: /** @type {Array<{x:number,y:number,type:"shield"|"rapid"|"pierce",life:number}>} */ ([]),
  boss: /** @type {null|{x:number,y:number,w:number,h:number,dir:number,speed:number,cooldown:number,invuln:number,alive:boolean,hp:number,maxHp:number,ai:{turn:number,shoot:number,burst:number,spawn:number,phase:number}}} */ (null),
  transition: /** @type {null|{kind:"nextlevel"|"menu",remaining:number,nextLevel?:number,baseTitle:string,baseSub:string}} */ (null),
  lastTime: 0,
};

function splitTiles() {
  state.grass = state.tiles.filter(t => t.type === "grass");
  state.solids = state.tiles.filter(t => t.blocksTanks());
}
splitTiles();

let startAction = "newrun"; // "newrun" | "nextlevel"

function parseLevelFromPassword(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return null;
  // 允许：1/2/3、level1/level2/level3、lvl1/lvl2/lvl3、boss(=3)
  if (s === "1" || s === "level1" || s === "lvl1") return 0;
  if (s === "2" || s === "level2" || s === "lvl2") return 1;
  if (s === "3" || s === "level3" || s === "lvl3" || s === "boss" || s === "vae") return 2;
  return null;
}

function isAdminAuthed() {
  return String(ui.levelPass?.value || "").trim().toLowerCase() === "vae";
}

function setRole(isAdmin) {
  state.admin = !!isAdmin;
  if (!state.admin) state.adminAuthed = false;
  if (ui.adminPanel) ui.adminPanel.classList.toggle("hidden", !state.admin);
  if (ui.btnRoleUser && ui.btnRoleAdmin) {
    ui.btnRoleUser.classList.toggle("btn-primary", !state.admin);
    ui.btnRoleUser.classList.toggle("btn-ghost", state.admin);
    ui.btnRoleAdmin.classList.toggle("btn-primary", state.admin);
    ui.btnRoleAdmin.classList.toggle("btn-ghost", !state.admin);
  }
  // 未认证前禁用选关/无敌；认证后启用
  const authed = state.admin && (state.adminAuthed || isAdminAuthed());
  if (ui.levelSelect) ui.levelSelect.disabled = !authed;
  if (ui.invincible) ui.invincible.disabled = !authed;
}

function startNewRun(startLevelIndex = 0) {
  state.scores = [0, 0];
  state.lives = [3, 3];
  loadLevel(startLevelIndex, { keepProgress: true });
}

function loadLevel(levelIndex, { keepProgress }) {
  state.levelIndex = clamp(levelIndex, 0, LEVELS.length - 1);
  state.levelCfg = LEVELS[state.levelIndex];
  state.time = 0;
  state.running = true;
  state.paused = false;
  state.over = false;
  state.win = false;
  state.pendingNextLevel = false;

  // 需求：每一关开始时，刷新玩家 3 条命（分数仍保留）
  state.lives = state.mode === 1 ? [3, 0] : [3, 3];

  state.waveLeft = state.levelCfg.waveTotal;
  state.enemiesAlive = 0;
  state.enemySpawnTimer = 0.2;
  state.tiles = buildTiles(state.levelCfg.layout);
  splitTiles();

  state.bullets = [];
  state.enemies = [];
  state.powerUps = [];
  state.boss = null;
  fx.particles = [];
  fx.rings = [];

  // 出生：单人仅P1，双人P1+P2（每关都会重置位置）
  const y0 = WORLD_H - 2 * TILE - 14;
  const p1Spawn = findFreeTankPos(TILE * 2, y0, 28, 28, null);
  state.players = [new Tank({ x: p1Spawn.x, y: p1Spawn.y, dir: DIR.UP, isPlayer: true, playerId: 1 })];
  if (state.mode === 2) {
    const p2Spawn = findFreeTankPos(WORLD_W - TILE * 3, y0, 28, 28, null);
    state.players.push(new Tank({ x: p2Spawn.x, y: p2Spawn.y, dir: DIR.UP, isPlayer: true, playerId: 2 }));
  }
  for (const pl of state.players) {
    pl.alive = true;
    pl.invuln = 1.4;
  }

  updateHUD();
  showLevelIntro();
}

function showLevelIntro() {
  // 关卡开始提示：短暂停留，点击继续
  if (!ui.overlay) return;
  ui.overlay.classList.remove("hidden");
  const panel = ui.overlay.querySelector(".panel");
  const h1 = panel?.querySelector("h1");
  const sub = panel?.querySelector(".sub");
  if (h1) h1.textContent = state.levelCfg.name;
  if (sub) sub.textContent = state.levelCfg.hasBoss
    ? "玩法创新：Boss战 + 草丛隐蔽 + 道具（护盾/连发/穿甲）"
    : "玩法创新：击败敌人掉落道具（护盾/连发/穿甲）";
  if (ui.btnStart) ui.btnStart.textContent = "开始本关";
  if (ui.btnStart) ui.btnStart.disabled = false;
  startAction = "nextlevel";
  // 暂停更新直到点击
  state.paused = true;
  state.pendingNextLevel = false;
  updateHUD();
}

function updateHUD() {
  setText(ui.score1, state.scores[0]);
  setText(ui.lives1, state.lives[0]);
  setText(ui.score2, state.scores[1]);
  setText(ui.lives2, state.lives[1]);
  setText(ui.level, `${state.levelIndex + 1}/${LEVELS.length}`);
  const bossAlive = !!(state.boss && state.boss.alive);
  setText(ui.enemies, state.waveLeft + state.enemiesAlive + (bossAlive ? 1 : 0));
  // Buff展示（简短）
  const p1 = state.players?.[0];
  const p2 = state.players?.[1];
  const btxt = (p, label) => {
    if (!p || !p.buffs) return `${label}-`;
    const bs = [];
    if (p.buffs.shieldUntil > state.time) bs.push("护盾");
    if (p.buffs.rapidUntil > state.time) bs.push("连发");
    if (p.buffs.pierceUntil > state.time) bs.push("穿甲");
    return `${label}${bs.length ? bs.join("/") : "-"}`;
  };
  setText(ui.buffs, state.mode === 1 ? btxt(p1, "P1:") : `${btxt(p1, "P1:")} | ${btxt(p2, "P2:")}`);
  setText(ui.btnPause, state.paused ? "继续" : "暂停");
}

// ===== 碰撞与移动 =====
function tryMoveTank(tank, dx, dy) {
  const next = { x: tank.x + dx, y: tank.y + dy, w: tank.w, h: tank.h };
  // 世界边界
  if (next.x < 0 || next.y < 0 || next.x + next.w > WORLD_W || next.y + next.h > WORLD_H) return false;
  // 与方块
  for (const tile of state.solids) {
    if (tile.type === "grass") continue;
    if (rectsOverlap(next, tile.rect())) return false;
  }
  // 与坦克（避免重叠）
  for (const p of state.players) {
    if (!p || !p.alive || p === tank) continue;
    if (rectsOverlap(next, p.rect())) return false;
  }
  for (const e of state.enemies) {
    if (!e.alive || e === tank) continue;
    if (rectsOverlap(next, e.rect())) return false;
  }
  if (state.boss && state.boss.alive && tank !== state.boss) {
    const br = { x: state.boss.x, y: state.boss.y, w: state.boss.w, h: state.boss.h };
    if (rectsOverlap(next, br)) return false;
  }
  tank.x = next.x; tank.y = next.y;
  return true;
}

function fireFromTank(tank) {
  if (!tank.alive) return;
  if (tank.cooldown > 0) return;

  const c = tank.center();
  const v = DIR_V[tank.dir];
  const ox = c.x + v.x * (tank.w / 2 + 6);
  const oy = c.y + v.y * (tank.h / 2 + 6);
  const owner = tank.isPlayer ? (tank.playerId === 2 ? "p2" : "p1") : "enemy";
  const bulletSpeed = 260 * (tank.isPlayer ? 1 : (state.levelCfg?.enemyBulletMul ?? 1));
  const pierce = (tank.isPlayer && tank.buffs && tank.buffs.pierceUntil > state.time) ? 1 : 0;
  state.bullets.push(new Bullet({
    x: ox,
    y: oy,
    dir: tank.dir,
    owner,
    speed: bulletSpeed,
    pierce,
  }));
  if (tank.isPlayer && tank.buffs && tank.buffs.rapidUntil > state.time) tank.cooldown = 0.12;
  else tank.cooldown = tank.isPlayer ? 0.24 : 0.55;
}

function damageBaseAt(tile) {
  tile.hp -= 1;
  if (tile.hp <= 0) {
    // 删除基地块
    state.tiles = state.tiles.filter(t => t !== tile);
    splitTiles();
    gameOver(false);
  }
}

function gameOver(win) {
  state.over = true;
  state.running = false;
  state.paused = false;
  state.win = !!win;
  if (ui.overlay) ui.overlay.classList.remove("hidden");

  const panel = ui.overlay?.querySelector(".panel");
  const h1 = panel?.querySelector("h1");
  const sub = panel?.querySelector(".sub");
  const btn = ui.btnStart;
  if (h1) h1.textContent = win ? "三关通关！" : "游戏结束";
  const total = state.scores[0] + state.scores[1];
  if (sub) {
    sub.textContent = win
      ? `恭喜通关！P1：${state.scores[0]} 分｜P2：${state.scores[1]} 分｜总分：${total}`
      : `基地被摧毁或全员阵亡。P1：${state.scores[0]} 分｜P2：${state.scores[1]} 分｜总分：${total}`;
  }

  // 需求：失败/结束后自动回到开始界面
  state.transition = {
    kind: "menu",
    remaining: 3,
    baseTitle: h1?.textContent || (win ? "三关通关！" : "游戏结束"),
    baseSub: sub?.textContent || "",
  };
  if (btn) {
    btn.textContent = "自动返回中…";
    btn.disabled = true;
  }
}

// ===== AI =====
function enemySpawnPoint() {
  // 顶部三个出生点
  const choices = [
    { x: TILE * 1, y: TILE * 1 },
    { x: WORLD_W / 2 - 14, y: TILE * 1 },
    { x: WORLD_W - TILE * 2, y: TILE * 1 },
  ];
  return choices[irand(0, choices.length - 1)];
}

function canSpawnAt(x, y) {
  const box = { x, y, w: 28, h: 28 };
  for (const tile of state.solids) if (rectsOverlap(box, tile.rect())) return false;
  for (const p of state.players) if (p && p.alive && rectsOverlap(box, p.rect())) return false;
  for (const e of state.enemies) if (e.alive && rectsOverlap(box, e.rect())) return false;
  if (state.boss && state.boss.alive) {
    const br = { x: state.boss.x, y: state.boss.y, w: state.boss.w, h: state.boss.h };
    if (rectsOverlap(box, br)) return false;
  }
  return true;
}

function spawnEnemy() {
  if (state.waveLeft <= 0) return false;
  for (let i = 0; i < 6; i++) {
    const p = enemySpawnPoint();
    const x = p.x + irand(-4, 4);
    const y = p.y + irand(-2, 2);
    if (!canSpawnAt(x, y)) continue;
    const e = new Tank({ x, y, dir: DIR.DOWN, isPlayer: false });
    e.invuln = 0.2;
    e.speed = (86 + irand(-6, 8)) * (state.levelCfg?.enemySpeedMul ?? 1);
    // 精英敌人：2点血，更频繁射击
    if (Math.random() < (state.levelCfg?.eliteChance ?? 0)) {
      e.hp = 2;
      e.maxHp = 2;
      e.speed *= 1.06;
      e.ai.shootTimer = rand(Math.max(0.22, (state.levelCfg?.enemyShootMin ?? 0.4) * 0.7), Math.max(0.75, (state.levelCfg?.enemyShootMax ?? 1.2) * 0.7));
    } else {
      e.hp = 1;
      e.maxHp = 1;
      e.ai.shootTimer = rand(state.levelCfg?.enemyShootMin ?? 0.6, state.levelCfg?.enemyShootMax ?? 1.8);
    }
    state.enemies.push(e);
    state.waveLeft -= 1;
    state.enemiesAlive += 1;
    updateHUD();
    return true;
  }
  return false;
}

function aiUpdateEnemy(e, dt) {
  if (!e.alive) return;
  e.ai.turnTimer -= dt;
  e.ai.shootTimer -= dt;

  // 简单追踪：锁定最近的存活玩家；若同轴且视线无阻，转向并射击
  const p = pickNearestAlivePlayer(e);
  if (p) {
    const ec = e.center();
    const pc = p.center();
    const dx = pc.x - ec.x;
    const dy = pc.y - ec.y;
    const eps = state.levelCfg?.alignEps ?? 10;
    const alignedX = Math.abs(dx) < eps;
    const alignedY = Math.abs(dy) < eps;
    if (alignedX || alignedY) {
      // 视线被阻挡？
      const blockers = state.tiles.filter(t => {
        if (t.type === "grass") return !!state.levelCfg?.grassBlocksSight; // Boss关：草丛可遮挡视线
        return t.blocksBullets();
      });
      let blocked = false;
      for (const t of blockers) {
        if (lineIntersectsRect(ec.x, ec.y, pc.x, pc.y, t.rect())) { blocked = true; break; }
      }
      if (!blocked) {
        if (alignedX) e.dir = dy > 0 ? DIR.DOWN : DIR.UP;
        if (alignedY) e.dir = dx > 0 ? DIR.RIGHT : DIR.LEFT;
        if (e.ai.shootTimer <= 0) {
          fireFromTank(e);
          e.ai.shootTimer = rand(state.levelCfg?.enemyShootMin ?? 0.4, state.levelCfg?.enemyShootMax ?? 1.3);
        }
      }
    }
  }

  // 走动：撞墙就换方向，或定时换方向
  if (e.ai.turnTimer <= 0) {
    e.dir = irand(0, 3);
    e.ai.turnTimer = rand(0.35, 1.25);
  }
  const v = DIR_V[e.dir];
  const moved = tryMoveTank(e, v.x * e.speed * dt, v.y * e.speed * dt);
  if (!moved) {
    e.dir = irand(0, 3);
    e.ai.turnTimer = rand(0.2, 0.7);
  }

  // 随机射击
  if (e.ai.shootTimer <= 0) {
    fireFromTank(e);
    e.ai.shootTimer = rand(state.levelCfg?.enemyShootMin ?? 0.6, state.levelCfg?.enemyShootMax ?? 1.8);
  }
}

function pickNearestAlivePlayer(e) {
  let best = null;
  let bestD2 = Infinity;
  const ec = e.center();
  for (const p of state.players) {
    if (!p || !p.alive) continue;
    const pc = p.center();
    const dx = pc.x - ec.x;
    const dy = pc.y - ec.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { bestD2 = d2; best = p; }
  }
  return best;
}

// ===== 逻辑更新 =====
function update(dt) {
  // 过渡倒计时：无论暂停/结束都要跑
  if (state.transition && ui.overlay) {
    state.transition.remaining -= dt;
    const panel = ui.overlay.querySelector(".panel");
    const h1 = panel?.querySelector("h1");
    const sub = panel?.querySelector(".sub");
    const sec = Math.max(0, Math.ceil(state.transition.remaining));
    if (h1) h1.textContent = state.transition.baseTitle;
    if (sub) {
      if (state.transition.kind === "nextlevel") sub.textContent = `${state.transition.baseSub}（${sec}s 后自动进入）`;
      if (state.transition.kind === "menu") sub.textContent = `${state.transition.baseSub}（${sec}s 后返回开始）`;
    }
    if (state.transition.remaining <= 0) {
      const kind = state.transition.kind;
      const next = state.transition.nextLevel;
      state.transition = null;
      if (kind === "nextlevel" && typeof next === "number") {
        loadLevel(next, { keepProgress: true });
        if (ui.overlay) ui.overlay.classList.add("hidden");
        if (ui.btnStart) ui.btnStart.disabled = false;
        state.paused = false;
        state.running = true;
      } else if (kind === "menu") {
        // 回到开始界面，并清空战斗状态
        state.running = false;
        state.paused = false;
        state.over = false;
        state.win = false;
        state.pendingNextLevel = false;
        state.enemies = [];
        state.bullets = [];
        state.powerUps = [];
        state.boss = null;
        fx.particles = [];
        fx.rings = [];
        if (ui.btnStart) ui.btnStart.disabled = false;
        showMenu();
      }
      updateHUD();
      // 避免同帧继续跑游戏逻辑
      inputP1.firePressed = false;
      inputP2.firePressed = false;
      return;
    }
  }

  if (pausePressed) {
    pausePressed = false;
    togglePause();
  }

  if (!state.running || state.paused || state.over) {
    // 清理一次性边沿输入
    inputP1.firePressed = false;
    inputP2.firePressed = false;
    return;
  }

  state.time += dt;

  // 敌人刷怪
  state.enemySpawnTimer -= dt;
  if (state.enemySpawnTimer <= 0) {
    const wantAliveCap = state.levelCfg?.aliveCap ?? 4; // 同屏最大敌人数（随关卡提升）
    if (state.enemiesAlive < wantAliveCap && state.waveLeft > 0) spawnEnemy();
    state.enemySpawnTimer = rand(0.8, 1.3);
  }

  // 玩家（按模式）
  const p1 = state.players[0];
  const p2 = state.players[1];
  if (p1 && p1.alive) {
    p1.invuln = Math.max(0, p1.invuln - dt);
    p1.cooldown = Math.max(0, p1.cooldown - dt);
    const wantDir = dirFromInput(inputP1, moveP1);
    if (wantDir !== null) p1.dir = wantDir;
    const v = DIR_V[p1.dir];
    const moving = inputP1.up || inputP1.down || inputP1.left || inputP1.right;
    if (moving) tryMoveTank(p1, v.x * p1.speed * dt, v.y * p1.speed * dt);
    if (inputP1.firePressed) fireFromTank(p1);
  }
  if (state.mode === 2 && p2 && p2.alive) {
    p2.invuln = Math.max(0, p2.invuln - dt);
    p2.cooldown = Math.max(0, p2.cooldown - dt);
    const wantDir = dirFromInput(inputP2, moveP2);
    if (wantDir !== null) p2.dir = wantDir;
    const v = DIR_V[p2.dir];
    const moving = inputP2.up || inputP2.down || inputP2.left || inputP2.right;
    if (moving) tryMoveTank(p2, v.x * p2.speed * dt, v.y * p2.speed * dt);
    if (inputP2.firePressed) fireFromTank(p2);
  }

  // 敌人
  for (const e of state.enemies) {
    if (!e.alive) continue;
    e.invuln = Math.max(0, e.invuln - dt);
    e.cooldown = Math.max(0, e.cooldown - dt);
    aiUpdateEnemy(e, dt);
  }

  // Boss
  if (state.boss && state.boss.alive) {
    updateBoss(dt);
  }

  // 子弹
  for (const b of state.bullets) {
    if (!b.alive) continue;
    const v = DIR_V[b.dir];
    b.x += v.x * b.speed * dt;
    b.y += v.y * b.speed * dt;

    // 边界
    if (b.x < 0 || b.y < 0 || b.x > WORLD_W || b.y > WORLD_H) {
      b.alive = false;
      continue;
    }

    const br = b.rect();

    // 命中墙/基地
    for (const t of state.tiles) {
      if (!t.blocksBullets()) continue;
      if (rectsOverlap(br, t.rect())) {
        // 命中火花（砖墙更强）
        spawnImpact(b.x, b.y, b.owner, t.type === "brick" ? 1.15 : 0.85);
        if (t.type === "brick") {
          t.hp -= 1;
          if (t.hp <= 0) {
            state.tiles = state.tiles.filter(x => x !== t);
            splitTiles();
            // 砖块碎裂小爆
            spawnImpact(t.x + TILE / 2, t.y + TILE / 2, b.owner, 1.2);
          }
          if (b.pierce > 0) {
            b.pierce -= 1;
          } else {
            b.alive = false;
          }
        } else if (t.type === "base") {
          // 玩家子弹不允许伤害己方基地：命中后直接消失（给轻微反馈），只有敌方子弹才会摧毁基地
          b.alive = false;
          if (b.owner === "enemy") {
            damageBaseAt(t);
            spawnImpact(t.x + TILE / 2, t.y + TILE / 2, "enemy", 1.4);
          } else {
            // 友军误伤屏蔽：提示性火花（不伤害基地）
            spawnImpact(t.x + TILE / 2, t.y + TILE / 2, b.owner, 0.7);
          }
        } else {
          // steel
          b.alive = false;
        }
        break;
      }
    }
    if (!b.alive) continue;

    // 命中坦克
    if (b.owner === "enemy") {
      for (let i = 0; i < state.players.length; i++) {
        const p = state.players[i];
        if (!p || !p.alive) continue;
        if (rectsOverlap(br, p.rect()) && p.invuln <= 0) {
          b.alive = false;
          if (state.invincible) {
            const cc = p.center();
            spawnImpact(cc.x, cc.y, "enemy", 0.9);
            break;
          }
          // 护盾：吸收一次伤害
          if (p.buffs && p.buffs.shieldUntil > state.time) {
            p.buffs.shieldUntil = 0;
            p.invuln = 0.6;
            const cc = p.center();
            spawnImpact(cc.x, cc.y, "enemy", 1.1);
          } else {
            killPlayer(i);
          }
          break;
        }
      }
    } else if (b.owner === "p1" || b.owner === "p2") {
      // 先打Boss
      if (state.boss && state.boss.alive) {
        const brBoss = { x: state.boss.x, y: state.boss.y, w: state.boss.w, h: state.boss.h };
        if (rectsOverlap(br, brBoss) && state.boss.invuln <= 0) {
          b.alive = false;
          state.boss.hp -= 1;
          state.boss.invuln = 0.08;
          bossSayBaby();
          const cc = { x: state.boss.x + state.boss.w / 2, y: state.boss.y + state.boss.h / 2 };
          spawnImpact(cc.x, cc.y, b.owner, 1.2);
          if (state.boss.hp <= 0) killBoss(b.owner);
        }
      }
      if (!b.alive) continue;
      for (const e of state.enemies) {
        if (!e.alive) continue;
        if (rectsOverlap(br, e.rect()) && e.invuln <= 0) {
          b.alive = false;
          e.hp -= 1;
          const cc = e.center();
          if (e.hp <= 0) killEnemy(e, b.owner);
          else {
            e.invuln = 0.25;
            spawnImpact(cc.x, cc.y, b.owner, 1.0);
          }
          break;
        }
      }
    }
  }

  // 清理
  state.bullets = state.bullets.filter(b => b.alive);
  state.enemies = state.enemies.filter(e => e.alive);

  // 胜利条件：敌人全部刷完且全灭；若本关有Boss，则需要击败Boss
  if (state.waveLeft <= 0 && state.enemiesAlive <= 0 && !state.over) {
    if (state.levelCfg?.hasBoss) {
      if (!state.boss) spawnBoss();
      else if (!state.boss.alive) onLevelCleared();
    } else {
      onLevelCleared();
    }
  }

  updateHUD();

  // 特效更新（在清理之后，避免引用已死亡对象）
  updateFX(dt);

  // 道具更新/拾取
  for (const pu of state.powerUps) pu.life -= dt;
  state.powerUps = state.powerUps.filter(pu => pu.life > 0);
  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i];
    if (!p || !p.alive || !p.buffs) continue;
    const pr = p.rect();
    for (const pu of state.powerUps) {
      const box = { x: pu.x - 9, y: pu.y - 9, w: 18, h: 18 };
      if (rectsOverlap(pr, box)) {
        applyPowerUp(p, pu.type);
        spawnImpact(pu.x, pu.y, i === 0 ? "p1" : "p2", 1.0);
        pu.life = 0;
      }
    }
  }
  state.powerUps = state.powerUps.filter(pu => pu.life > 0);

  // 清理一次性边沿输入
  inputP1.firePressed = false;
  inputP2.firePressed = false;
}

function updateBoss(dt) {
  const b = state.boss;
  if (!b || !b.alive) return;
  b.invuln = Math.max(0, b.invuln - dt);
  b.cooldown = Math.max(0, b.cooldown - dt);
  b.ai.turn -= dt;
  b.ai.shoot -= dt;
  b.ai.burst -= dt;
  b.ai.spawn -= dt;

  // 行为：随机巡航 + 贴近最近玩家轴向瞄准
  const target = pickNearestAlivePlayer({ center: () => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 }) });
  if (target) {
    const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    const pc = target.center();
    const dx = pc.x - bc.x;
    const dy = pc.y - bc.y;
    // 朝更大位移轴对齐
    if (Math.abs(dx) > Math.abs(dy)) b.dir = dx > 0 ? DIR.RIGHT : DIR.LEFT;
    else b.dir = dy > 0 ? DIR.DOWN : DIR.UP;
  }

  if (b.ai.turn <= 0) {
    // 偶尔换方向制造压迫
    b.dir = irand(0, 3);
    b.ai.turn = rand(0.6, 1.5);
  }

  // 移动：Boss 具有“穿墙”能力（不受砖/钢/水阻挡），仅受边界限制
  const v = DIR_V[b.dir];
  const moved = tryMoveBoss(b, v.x * b.speed * dt, v.y * b.speed * dt);
  if (!moved) {
    b.dir = irand(0, 3);
    b.ai.turn = rand(0.3, 0.9);
  }

  // 点射
  if (b.ai.shoot <= 0) {
    fireFromBoss(b, b.dir);
    b.ai.shoot = rand(0.32, 0.78);
  }

  // 弹幕：四向
  if (b.ai.burst <= 0) {
    fireFromBoss(b, DIR.UP);
    fireFromBoss(b, DIR.RIGHT);
    fireFromBoss(b, DIR.DOWN);
    fireFromBoss(b, DIR.LEFT);
    b.ai.burst = rand(1.1, 2.0);
  }

  // 召唤小怪
  if (b.ai.spawn <= 0 && (state.enemiesAlive < (state.levelCfg?.aliveCap ?? 6))) {
    // 直接刷一个普通敌人
    spawnEnemy();
    b.ai.spawn = rand(2.6, 4.8);
  }
}

function tryMoveBoss(boss, dx, dy) {
  const next = { x: boss.x + dx, y: boss.y + dy, w: boss.w, h: boss.h };
  // 世界边界
  if (next.x < 0 || next.y < 0 || next.x + next.w > WORLD_W || next.y + next.h > WORLD_H) return false;
  // 不与玩家重叠（但允许穿墙）
  for (const p of state.players) {
    if (!p || !p.alive) continue;
    if (rectsOverlap(next, p.rect())) return false;
  }
  boss.x = next.x;
  boss.y = next.y;
  return true;
}

function fireFromBoss(boss, dir) {
  if (!boss.alive) return;
  if (boss.cooldown > 0) return;
  const c = { x: boss.x + boss.w / 2, y: boss.y + boss.h / 2 };
  const v = DIR_V[dir];
  const ox = c.x + v.x * (boss.w / 2 + 8);
  const oy = c.y + v.y * (boss.h / 2 + 8);
  state.bullets.push(new Bullet({
    x: ox,
    y: oy,
    dir,
    owner: "enemy",
    speed: 300 * (state.levelCfg?.enemyBulletMul ?? 1),
    pierce: 0,
  }));
  boss.cooldown = 0.16;
}

function killEnemy(e, owner) {
  // 爆炸（世界坐标）
  const c = e.center();
  spawnExplosion(c.x, c.y, owner, 1.15);
  e.alive = false;
  state.enemiesAlive = Math.max(0, state.enemiesAlive - 1);
  if (owner === "p2") state.scores[1] += 100;
  else if (owner === "p1") state.scores[0] += 100;

  // 掉落道具（玩法创新）
  if (Math.random() < (state.levelCfg?.dropChance ?? 0.22)) {
    spawnPowerUp(c.x, c.y);
  }
}

function spawnBoss() {
  // Boss出现：放在上方中间偏上
  const w = 46, h = 46;
  const desiredX = WORLD_W / 2 - w / 2;
  const desiredY = TILE * 2;
  const pos = findFreeTankPos(desiredX, desiredY, w, h, null);
  state.boss = {
    x: pos.x, y: pos.y, w, h,
    dir: DIR.DOWN,
    speed: 70 * (state.levelCfg?.enemySpeedMul ?? 1),
    cooldown: 0,
    invuln: 0.8,
    alive: true,
    hp: 18,
    maxHp: 18,
    ai: { turn: rand(0.6, 1.4), shoot: rand(0.35, 0.9), burst: rand(1.2, 2.2), spawn: rand(2.4, 4.2), phase: 0 },
  };
  // 提示：Boss登场
  if (ui.overlay) {
    ui.overlay.classList.remove("hidden");
    const panel = ui.overlay.querySelector(".panel");
    const h1 = panel?.querySelector("h1");
    const sub = panel?.querySelector(".sub");
    if (h1) h1.textContent = "Boss登场！";
    if (sub) sub.textContent = "击败Boss即可通关（草丛可用于隐蔽）";
    if (ui.btnStart) ui.btnStart.textContent = "继续战斗";
    startAction = "nextlevel";
    state.paused = true;
  }
  updateHUD();
}

function killBoss(owner) {
  if (!state.boss) return;
  const cc = { x: state.boss.x + state.boss.w / 2, y: state.boss.y + state.boss.h / 2 };
  spawnExplosion(cc.x, cc.y, owner, 1.8);
  state.boss.alive = false;
  // 奖励分
  if (owner === "p2") state.scores[1] += 1200;
  else if (owner === "p1") state.scores[0] += 1200;
  updateHUD();
}

function killPlayer(playerIdx) {
  const pDead = state.players[playerIdx];
  if (pDead) {
    const c = pDead.center();
    spawnExplosion(c.x, c.y, "enemy", 1.0);
  }
  state.lives[playerIdx] -= 1;
  const p = state.players[playerIdx];
  if (!p) return;
  if (state.lives[playerIdx] <= 0) {
    p.alive = false;
    // 两人都死了才失败（基地被毁另算）
    if (!state.players.some(pp => pp && pp.alive)) gameOver(false);
    return;
  }
  // 重生（各自回到自己的出生侧）
  const y0 = WORLD_H - 2 * TILE - 14;
  const desiredX = playerIdx === 0 ? TILE * 2 : (WORLD_W - TILE * 3);
  const spawn = findFreeTankPos(desiredX, y0, p.w, p.h, p);
  p.x = spawn.x;
  p.y = spawn.y;
  p.dir = DIR.UP;
  p.invuln = 1.4;
  p.cooldown = 0.2;
}

function isRectFree(box) {
  // 世界边界
  if (box.x < 0 || box.y < 0 || box.x + box.w > WORLD_W || box.y + box.h > WORLD_H) return false;
  // 方块阻挡
  for (const tile of state.solids) {
    if (rectsOverlap(box, tile.rect())) return false;
  }
  // 敌人阻挡（避免出生压坦克）
  for (const e of state.enemies) {
    if (!e.alive) continue;
    if (rectsOverlap(box, e.rect())) return false;
  }
  // Boss阻挡
  if (state.boss && state.boss.alive) {
    const br = { x: state.boss.x, y: state.boss.y, w: state.boss.w, h: state.boss.h };
    if (rectsOverlap(box, br)) return false;
  }
  // 玩家阻挡（避免出生压坦克）
  for (const p of state.players) {
    if (!p || !p.alive) continue;
    if (rectsOverlap(box, p.rect())) return false;
  }
  return true;
}

function isRectFreeIgnoring(box, ignoreTank) {
  if (!ignoreTank) return isRectFree(box);
  // 复制 isRectFree 逻辑，但忽略指定玩家
  if (box.x < 0 || box.y < 0 || box.x + box.w > WORLD_W || box.y + box.h > WORLD_H) return false;
  for (const tile of state.solids) {
    if (rectsOverlap(box, tile.rect())) return false;
  }
  for (const e of state.enemies) {
    if (!e.alive) continue;
    if (rectsOverlap(box, e.rect())) return false;
  }
  if (state.boss && state.boss.alive && ignoreTank !== state.boss) {
    const br = { x: state.boss.x, y: state.boss.y, w: state.boss.w, h: state.boss.h };
    if (rectsOverlap(box, br)) return false;
  }
  for (const p of state.players) {
    if (!p || !p.alive || p === ignoreTank) continue;
    if (rectsOverlap(box, p.rect())) return false;
  }
  return true;
}

function findFreeTankPos(x, y, w, h, ignoreTank) {
  // 以(x,y)为中心，螺旋扩散寻找空位（步长=8像素，足够细）
  const start = {
    x: clamp(x, 0, WORLD_W - w),
    y: clamp(y, 0, WORLD_H - h),
    w, h,
  };
  if (isRectFreeIgnoring(start, ignoreTank)) return { x: start.x, y: start.y };

  const step = 8;
  const maxR = Math.ceil(Math.max(WORLD_W, WORLD_H) / step);
  for (let r = 1; r <= maxR; r++) {
    const d = r * step;
    // 扫描“方环”边界点，避免点太多
    const candidates = [
      { x: start.x + d, y: start.y },
      { x: start.x - d, y: start.y },
      { x: start.x, y: start.y + d },
      { x: start.x, y: start.y - d },
      { x: start.x + d, y: start.y + d },
      { x: start.x + d, y: start.y - d },
      { x: start.x - d, y: start.y + d },
      { x: start.x - d, y: start.y - d },
    ];
    for (const c of candidates) {
      const box = {
        x: clamp(c.x, 0, WORLD_W - w),
        y: clamp(c.y, 0, WORLD_H - h),
        w, h,
      };
      if (isRectFreeIgnoring(box, ignoreTank)) return { x: box.x, y: box.y };
    }
  }
  // 极端兜底：左下角
  return { x: 8, y: WORLD_H - h - 8 };
}

function togglePause() {
  if (!state.running || state.over) return;
  state.paused = !state.paused;
  updateHUD();
}

function applyPowerUp(player, type) {
  if (!player.buffs) return;
  const dur = 7.5;
  if (type === "shield") {
    player.buffs.shieldUntil = state.time + 10;
  } else if (type === "rapid") {
    player.buffs.rapidUntil = state.time + dur;
  } else if (type === "pierce") {
    player.buffs.pierceUntil = state.time + dur;
  }
}

function spawnPowerUp(x, y) {
  const r = Math.random();
  const type = r < 0.34 ? "shield" : (r < 0.67 ? "rapid" : "pierce");
  state.powerUps.push({ x, y, type, life: 10.0 });
}

function onLevelCleared() {
  // 进入下一关或通关
  if (state.levelIndex >= LEVELS.length - 1) {
    gameOver(true);
    return;
  }
  state.running = false;
  state.paused = true;
  state.pendingNextLevel = true;
  if (ui.overlay) ui.overlay.classList.remove("hidden");
  const panel = ui.overlay?.querySelector(".panel");
  const h1 = panel?.querySelector("h1");
  const sub = panel?.querySelector(".sub");
  if (h1) h1.textContent = "本关完成！";
  if (sub) sub.textContent = `即将进入：${LEVELS[state.levelIndex + 1].name}（难度提升 + 新机制）`;
  // 需求：通关后倒计时 3s 自动进入下一关
  state.transition = {
    kind: "nextlevel",
    remaining: 3,
    nextLevel: state.levelIndex + 1,
    baseTitle: "本关完成！",
    baseSub: sub?.textContent || `即将进入：${LEVELS[state.levelIndex + 1].name}`,
  };
  if (ui.btnStart) {
    ui.btnStart.textContent = "自动进入中…";
    ui.btnStart.disabled = true;
  }
  startAction = "nextlevel";
}

// ===== 渲染 =====
function drawBackground(vp) {
  if (!ctx) return;
  // 画布背景（屏幕坐标）
  ctx.clearRect(0, 0, vp.w, vp.h);
  // 信封边（留白区域）
  ctx.fillStyle = "rgba(0,0,0,.25)";
  ctx.fillRect(0, 0, vp.w, vp.h);
  // 世界区域底色
  ctx.fillStyle = "rgba(8,10,14,.85)";
  ctx.fillRect(vp.offsetX, vp.offsetY, WORLD_W * vp.scale, WORLD_H * vp.scale);

  // 网格（轻）
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = "rgba(255,255,255,.10)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= WORLD_W; x += TILE) {
    const p0 = worldToScreen(vp, x, 0);
    const p1 = worldToScreen(vp, x, WORLD_H);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }
  for (let y = 0; y <= WORLD_H; y += TILE) {
    const p0 = worldToScreen(vp, 0, y);
    const p1 = worldToScreen(vp, WORLD_W, y);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTile(vp, t) {
  const p = worldToScreen(vp, t.x, t.y);
  const w = t.w * vp.scale;
  const h = t.h * vp.scale;
  if (t.type === "brick") {
    ctx.fillStyle = "#b45309";
    ctx.fillRect(p.x, p.y, w, h);
    ctx.strokeStyle = "rgba(0,0,0,.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(p.x + 0.5, p.y + 0.5, w - 1, h - 1);
    // 砖纹
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = "rgba(255,255,255,.45)";
    ctx.beginPath();
    ctx.moveTo(p.x, p.y + h / 2);
    ctx.lineTo(p.x + w, p.y + h / 2);
    ctx.stroke();
    ctx.restore();
  } else if (t.type === "steel") {
    ctx.fillStyle = "#9ca3af";
    ctx.fillRect(p.x, p.y, w, h);
    ctx.strokeStyle = "rgba(0,0,0,.25)";
    ctx.strokeRect(p.x + 0.5, p.y + 0.5, w - 1, h - 1);
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "rgba(255,255,255,.35)";
    ctx.fillRect(p.x + w * 0.12, p.y + h * 0.12, w * 0.28, h * 0.28);
    ctx.restore();
  } else if (t.type === "water") {
    ctx.fillStyle = "rgba(59,130,246,.55)";
    ctx.fillRect(p.x, p.y, w, h);
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = "rgba(255,255,255,.35)";
    ctx.beginPath();
    ctx.moveTo(p.x, p.y + h * 0.35);
    ctx.lineTo(p.x + w, p.y + h * 0.35);
    ctx.stroke();
    ctx.restore();
  } else if (t.type === "base") {
    ctx.fillStyle = "rgba(251,113,133,.9)";
    ctx.fillRect(p.x, p.y, w, h);
    ctx.fillStyle = "rgba(0,0,0,.25)";
    ctx.fillRect(p.x + w * 0.2, p.y + h * 0.2, w * 0.6, h * 0.6);
  }
}

function drawGrass(vp, t, dense = false) {
  const p = worldToScreen(vp, t.x, t.y);
  const w = t.w * vp.scale;
  const h = t.h * vp.scale;
  ctx.save();
  ctx.globalAlpha = dense ? 0.78 : 0.55;
  ctx.fillStyle = dense ? "rgba(16,185,129,.52)" : "rgba(34,197,94,.35)";
  ctx.fillRect(p.x, p.y, w, h);
  // 线条干扰控制：隐蔽草丛减少笔触
  ctx.globalAlpha = dense ? 0.55 : 0.85;
  ctx.strokeStyle = dense ? "rgba(16,185,129,.55)" : "rgba(34,197,94,.65)";
  ctx.lineWidth = 1;
  const strokes = dense ? 3 : 6;
  for (let i = 0; i < strokes; i++) {
    const xx = p.x + (i / strokes) * w;
    ctx.beginPath();
    ctx.moveTo(xx, p.y + h);
    ctx.lineTo(xx + 4, p.y + h * 0.25);
    ctx.stroke();
  }
  ctx.restore();
}

// 备注：已取消“视野受限”机制，因此不再需要对己方坦克做“雾后重绘”。

function drawTank(vp, t) {
  const p = worldToScreen(vp, t.x, t.y);
  // 尽量像素对齐，减少缩放带来的“线条抖动”
  const x = Math.round(p.x);
  const y = Math.round(p.y);
  const w = Math.max(1, Math.round(t.w * vp.scale));
  const h = Math.max(1, Math.round(t.h * vp.scale));

  const isP1 = t.isPlayer && t.playerId !== 2;
  const isP2 = t.isPlayer && t.playerId === 2;
  const baseA = isP1 ? "#60a5fa" : (isP2 ? "#34d399" : "#f59e0b");
  const baseB = isP1 ? "#1d4ed8" : (isP2 ? "#047857" : "#b45309");
  const edge = "rgba(0,0,0,.28)";
  const invulnGlow = t.invuln > 0 && t.isPlayer;

  ctx.save();
  if (invulnGlow) {
    ctx.shadowColor = isP2 ? "rgba(52,211,153,.9)" : "rgba(96,165,250,.9)";
    ctx.shadowBlur = 18;
  }

  // 车身：装甲渐变 + 内框层次（尽量少用细线描边，避免干扰）
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, baseA);
  g.addColorStop(1, baseB);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);

  // 角落暗角（增加立体）
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = "rgba(0,0,0,.55)";
  ctx.fillRect(x, y, Math.round(w * 0.10), h);
  ctx.fillRect(x + Math.round(w * 0.90), y, Math.round(w * 0.10), h);
  ctx.restore();

  // 内框亮边
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = "rgba(255,255,255,.9)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + Math.round(w * 0.09), y + Math.round(h * 0.09), Math.round(w * 0.82), Math.round(h * 0.82));
  ctx.restore();

  // 外描边（轻）
  ctx.strokeStyle = edge;
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);

  // 履带
  ctx.save();
  ctx.globalAlpha = 0.32;
  ctx.fillStyle = "rgba(2,6,23,.9)";
  const trackW = Math.round(w * 0.16);
  ctx.fillRect(x + Math.round(w * 0.07), y + Math.round(h * 0.08), trackW, Math.round(h * 0.84));
  ctx.fillRect(x + w - Math.round(w * 0.07) - trackW, y + Math.round(h * 0.08), trackW, Math.round(h * 0.84));
  ctx.restore();

  // 能量高光（只给玩家）：裁剪在车身内，避免溢出“干扰线”
  if (t.isPlayer) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + Math.round(w * 0.04), y + Math.round(h * 0.04), Math.round(w * 0.92), Math.round(h * 0.92));
    ctx.clip();
    ctx.globalCompositeOperation = "lighter";
    const pulse = 0.5 + 0.5 * Math.sin(gfxTime * 3.0 + (isP2 ? 1.4 : 0));
    ctx.globalAlpha = 0.10 + pulse * 0.22;
    const shift = ((gfxTime * 140) % (w * 2));
    const x0 = x - w + shift;
    const x1 = x + w + shift;
    const sg = ctx.createLinearGradient(x0, y, x1, y + h);
    sg.addColorStop(0, "rgba(255,255,255,0)");
    sg.addColorStop(0.49, "rgba(255,255,255,.55)");
    sg.addColorStop(0.51, "rgba(255,255,255,.08)");
    sg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = sg;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  // 炮塔 + 炮管（按方向画）
  const cx = x + w / 2;
  const cy = y + h / 2;
  // 炮塔金属感（渐变）
  const turretR = Math.min(w, h) * 0.22;
  const tg = ctx.createRadialGradient(cx - turretR * 0.3, cy - turretR * 0.3, turretR * 0.10, cx, cy, turretR);
  tg.addColorStop(0, "rgba(255,255,255,.28)");
  tg.addColorStop(0.55, "rgba(17,24,39,.65)");
  tg.addColorStop(1, "rgba(0,0,0,.55)");
  ctx.fillStyle = tg;
  ctx.beginPath();
  ctx.arc(cx, cy, turretR, 0, Math.PI * 2);
  ctx.fill();

  // 徽标（P1星 / P2闪电）
  if (t.isPlayer) {
    ctx.save();
    ctx.globalAlpha = 0.88;
    ctx.fillStyle = "rgba(255,255,255,.88)";
    if (isP1) {
      const r1 = turretR * 0.55, r2 = turretR * 0.24;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const ang = -Math.PI / 2 + i * (Math.PI / 5);
        const rr = (i % 2 === 0) ? r1 : r2;
        const xx = cx + Math.cos(ang) * rr;
        const yy = cy + Math.sin(ang) * rr;
        if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
      }
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(cx - turretR * 0.18, cy - turretR * 0.55);
      ctx.lineTo(cx + turretR * 0.10, cy - turretR * 0.08);
      ctx.lineTo(cx - turretR * 0.04, cy - turretR * 0.08);
      ctx.lineTo(cx + turretR * 0.18, cy + turretR * 0.55);
      ctx.lineTo(cx - turretR * 0.10, cy + turretR * 0.10);
      ctx.lineTo(cx + turretR * 0.04, cy + turretR * 0.10);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // 炮管（渐变+轻描边，减少杂线）
  const tubeW = Math.min(w, h) * 0.15;
  const tubeL = Math.min(w, h) * 0.62;
  const barrel = (bx, by, bw, bh, horizontal) => {
    const bg = horizontal
      ? ctx.createLinearGradient(bx, by, bx, by + bh)
      : ctx.createLinearGradient(bx, by, bx + bw, by);
    bg.addColorStop(0, "rgba(255,255,255,.10)");
    bg.addColorStop(0.5, "rgba(17,24,39,.80)");
    bg.addColorStop(1, "rgba(0,0,0,.55)");
    ctx.fillStyle = bg;
    ctx.fillRect(bx, by, bw, bh);
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = "rgba(255,255,255,.9)";
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(bx), Math.round(by), Math.round(bw), Math.round(bh));
    ctx.restore();
  };
  if (t.dir === DIR.UP) barrel(cx - tubeW / 2, cy - tubeL, tubeW, tubeL, false);
  if (t.dir === DIR.DOWN) barrel(cx - tubeW / 2, cy, tubeW, tubeL, false);
  if (t.dir === DIR.LEFT) barrel(cx - tubeL, cy - tubeW / 2, tubeL, tubeW, true);
  if (t.dir === DIR.RIGHT) barrel(cx, cy - tubeW / 2, tubeL, tubeW, true);

  ctx.restore();
}

function drawBullet(vp, b) {
  const p = worldToScreen(vp, b.x, b.y);
  const c = colorForOwner(b.owner);
  const r = Math.max(1, b.r * vp.scale);
  const v = DIR_V[b.dir];

  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  // 拖尾（方向反向）
  const tail = 16 * vp.scale;
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = c;
  ctx.lineWidth = Math.max(2, r * 1.1);
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x - v.x * tail, p.y - v.y * tail);
  ctx.stroke();

  // 核心弹体（径向渐变发光）
  const g = ctx.createRadialGradient(p.x - r * 0.25, p.y - r * 0.25, r * 0.2, p.x, p.y, r * 2.2);
  g.addColorStop(0, "rgba(255,255,255,.95)");
  g.addColorStop(0.35, `${c}CC`);
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r * 2.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 0.95;
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawBoss(vp, boss) {
  if (!ctx || !boss || !boss.alive) return;
  const p = worldToScreen(vp, boss.x, boss.y);
  const x = Math.round(p.x);
  const y = Math.round(p.y);
  const w = Math.round(boss.w * vp.scale);
  const h = Math.round(boss.h * vp.scale);

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  // Boss本体：优先使用图片；失败则回退到渐变外观
  if (bossImgOk && bossImg.naturalWidth > 0 && bossImg.naturalHeight > 0) {
    // 轻微发光
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = "rgba(251,113,133,.9)";
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    ctx.restore();

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    // 保持图片比例，中心裁剪到正方形区域，再拉伸到Boss框
    const sw = bossImg.naturalWidth;
    const sh = bossImg.naturalHeight;
    const s = Math.min(sw, sh);
    const sx = Math.floor((sw - s) / 2);
    const sy = Math.floor((sh - s) / 2);
    ctx.drawImage(bossImg, sx, sy, s, s, x, y, w, h);
    ctx.restore();

    // 轻描边
    ctx.strokeStyle = "rgba(0,0,0,.38)";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
  } else {
    // 回退：紫红渐变
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, "#fb7185");
    g.addColorStop(1, "#7c3aed");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "rgba(0,0,0,.7)";
    ctx.fillRect(x, y, Math.round(w * 0.12), h);
    ctx.fillRect(x + Math.round(w * 0.88), y, Math.round(w * 0.12), h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(0,0,0,.35)";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    // 眼睛
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "rgba(255,255,255,.95)";
    ctx.beginPath();
    ctx.arc(x + w * 0.32, y + h * 0.38, Math.max(2, 3 * vp.scale), 0, Math.PI * 2);
    ctx.arc(x + w * 0.68, y + h * 0.38, Math.max(2, 3 * vp.scale), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 血条（屏幕坐标）
  const hp = clamp(boss.hp / boss.maxHp, 0, 1);
  const barW = w;
  const barH = Math.max(6, Math.round(6 * vp.scale));
  ctx.fillStyle = "rgba(0,0,0,.55)";
  ctx.fillRect(x, y - barH - 6, barW, barH);
  ctx.fillStyle = "rgba(251,113,133,.95)";
  ctx.fillRect(x, y - barH - 6, Math.round(barW * hp), barH);
  ctx.restore();
}

function drawPowerUp(vp, pu) {
  if (!ctx) return;
  const p = worldToScreen(vp, pu.x, pu.y);
  const c = pu.type === "shield" ? "#93c5fd" : (pu.type === "rapid" ? "#fbbf24" : "#a78bfa");
  const t = clamp(pu.life / 10, 0, 1);
  const rr = (8 + (1 - t) * 2) * vp.scale;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.9;
  // 外发光
  const g = ctx.createRadialGradient(p.x, p.y, rr * 0.2, p.x, p.y, rr * 2.2);
  g.addColorStop(0, "rgba(255,255,255,.9)");
  g.addColorStop(0.35, `${c}CC`);
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(p.x, p.y, rr * 2.2, 0, Math.PI * 2);
  ctx.fill();
  // 核心
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
  ctx.fill();
  // 图标
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = "rgba(0,0,0,.35)";
  ctx.font = `800 ${Math.max(10, 12 * vp.scale)}px ui-sans-serif,system-ui`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(pu.type === "shield" ? "盾" : (pu.type === "rapid" ? "连" : "穿"), p.x, p.y + 0.5);
  ctx.restore();
}

// 备注：已取消第3关“黑雾视野受限”。

function drawOverlayHints(vp) {
  if (!state.running && !state.over) return;
  if (!state.paused) return;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,.35)";
  ctx.fillRect(vp.offsetX, vp.offsetY, WORLD_W * vp.scale, WORLD_H * vp.scale);
  ctx.fillStyle = "rgba(255,255,255,.92)";
  ctx.font = "700 22px ui-sans-serif,system-ui";
  ctx.textAlign = "center";
  ctx.fillText("已暂停（P 或 右上角按钮继续）", vp.w / 2, vp.h / 2);
  ctx.restore();
}

function render() {
  if (!ctx) return;
  const vp = computeViewport();
  drawBackground(vp);

  // 世界内容
  for (const t of state.tiles) {
    if (t.type === "grass") continue;
    drawTile(vp, t);
  }

  // 坦克
  for (const p of state.players) if (p && p.alive) drawTank(vp, p);
  for (const e of state.enemies) if (e.alive) drawTank(vp, e);
  if (state.boss && state.boss.alive) drawBoss(vp, state.boss);

  // 子弹
  for (const b of state.bullets) if (b.alive) drawBullet(vp, b);

  // 道具
  for (const pu of state.powerUps) drawPowerUp(vp, pu);

  // 草地覆盖层（能遮挡坦克/子弹，增加层次；Boss关仍可用来隐蔽）
  for (const g of state.grass) drawGrass(vp, g);
  // 爆炸/火花特效（放在最上层，避免被草盖住）
  drawFX(vp);

  drawOverlayHints(vp);
}

// ===== 主循环 =====
function frame(ts) {
  if (!state.lastTime) state.lastTime = ts;
  const dt = clamp((ts - state.lastTime) / 1000, 0, 1 / 20); // 限制最大步长
  state.lastTime = ts;
  gfxTime = ts / 1000;
  update(dt);
  render();
  requestAnimationFrame(frame);
}

// ===== UI绑定 =====
function showMenu() {
  if (ui.overlay) ui.overlay.classList.remove("hidden");
  const panel = ui.overlay?.querySelector(".panel");
  const h1 = panel?.querySelector("h1");
  const sub = panel?.querySelector(".sub");
  if (h1) h1.textContent = "坦克大战（三关制）";
  if (sub) sub.textContent = state.mode === 1
    ? "单人模式：P1(WASD+空格)｜玩法：三关制+道具+Boss战｜P暂停"
    : "双人模式：P1(WASD+空格) + P2(方向键+回车)｜玩法：三关制+道具+Boss战｜P暂停";
  if (ui.btnStart) ui.btnStart.textContent = "开始游戏";
  if (ui.btnStart) ui.btnStart.disabled = false;
  startAction = "newrun";
  if (ui.levelPass) ui.levelPass.value = "";
  if (ui.levelSelect) ui.levelSelect.value = "1";
  if (ui.invincible) {
    ui.invincible.checked = false;
    ui.invincible.disabled = true;
  }
  state.invincible = false;
  state.adminAuthed = false;
  setRole(false);

  // HUD显示切换
  if (ui.app) ui.app.classList.toggle("single", state.mode === 1);
  // 模式按钮样式
  if (ui.btnMode1 && ui.btnMode2) {
    ui.btnMode1.classList.toggle("btn-primary", state.mode === 1);
    ui.btnMode1.classList.toggle("btn-ghost", state.mode !== 1);
    ui.btnMode2.classList.toggle("btn-primary", state.mode === 2);
    ui.btnMode2.classList.toggle("btn-ghost", state.mode !== 2);
  }
}

function startGame() {
  if (startAction === "newrun") {
    // 普通：只能从第1关开局
    // 管理员：输入 vae 后可选任意关
    let startLevel = 0;
    const authed = state.admin && (state.adminAuthed || isAdminAuthed());
    if (authed) {
      const lv = Number(ui.levelSelect?.value || "1");
      startLevel = clamp(lv - 1, 0, LEVELS.length - 1);
    }
    state.invincible = !!ui.invincible?.checked && authed;
    startNewRun(startLevel);
    if (ui.overlay) ui.overlay.classList.add("hidden");
    state.paused = false;
  } else {
    // 继续当前关卡（从intro进入），或进入下一关（从通关提示进入）
    if (ui.overlay) ui.overlay.classList.add("hidden");
    if (!state.over && state.pendingNextLevel && state.levelIndex < LEVELS.length - 1) {
      // 进入下一关
      loadLevel(state.levelIndex + 1, { keepProgress: true });
      if (ui.overlay) ui.overlay.classList.add("hidden");
      state.paused = false;
    } else {
      state.running = true;
      state.paused = false;
    }
  }
  updateHUD();
}

ui.btnStart?.addEventListener("click", () => {
  audio.unlock();
  audio.startMusic();
  startGame();
});
ui.btnPause?.addEventListener("click", () => {
  togglePause();
});
ui.btnRestart?.addEventListener("click", () => {
  showMenu();
});
ui.btnSound?.addEventListener("click", () => {
  audio.unlock();
  audio.toggleMute();
});

ui.btnRoleUser?.addEventListener("click", () => {
  setRole(false);
});
ui.btnRoleAdmin?.addEventListener("click", () => {
  setRole(true);
});
ui.btnAdminLogin?.addEventListener("click", () => {
  setRole(true);
  // 登录：密码正确则保持认证状态
  state.adminAuthed = isAdminAuthed();
  setRole(true);
});

// 输入密码时即时解锁（可选，但更顺手）
ui.levelPass?.addEventListener("input", () => {
  if (!state.admin) return;
  state.adminAuthed = isAdminAuthed();
  setRole(true);
});

ui.btnMode1?.addEventListener("click", () => {
  state.mode = 1;
  // 单人模式下清空P2分数显示（避免误解）
  state.scores[1] = 0;
  showMenu();
  updateHUD();
});
ui.btnMode2?.addEventListener("click", () => {
  state.mode = 2;
  showMenu();
  updateHUD();
});

// 初始化
resizeCanvas();
showMenu();
updateHUD();
requestAnimationFrame(frame);


