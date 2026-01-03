// 坦克大战（网页版）- 零依赖纯Canvas实现
// 说明：使用固定“世界坐标”，渲染时按屏幕缩放并居中，避免不同分辨率导致物理不一致。

const $ = (sel) => document.querySelector(sel);
const canvas = /** @type {HTMLCanvasElement} */ ($("#game"));
const ctx = /** @type {CanvasRenderingContext2D|null} */ (canvas?.getContext("2d", { alpha: true }) ?? null);

// 仅用于视觉动画，不影响物理与玩法
let gfxTime = 0;

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
  btnStart: $("#btn-start"),
  btnPause: $("#btn-pause"),
  btnRestart: $("#btn-restart"),
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
    name: "第3关：夜战要塞（视野受限）",
    night: true,
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
      "..S..####......####..S....",
      "..S..#..#..S..#..#..S.....",
      ".....####..S..####........",
      "..~~~~......S......~~~~...",
      "..~~~~..####..####..~~~~..",
      "........#..#..#..#........",
      "..####..####..####..####..",
      "..#..#................#..#",
      "..####..S..S..S..S..####..",
      "..........................",
      "....G..G..G..G..G..G..G...",
      "..........................",
      "..####..####..####..####..",
      "..#..#..............#..#..",
      "..####..S..S..S..S..####..",
      "..............S...........",
      "..~~~~..####..####..~~~~..",
      "..~~~~..............~~~~..",
      "...........BB.............",
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
  lastTime: 0,
};

function splitTiles() {
  state.grass = state.tiles.filter(t => t.type === "grass");
  state.solids = state.tiles.filter(t => t.blocksTanks());
}
splitTiles();

let startAction = "newrun"; // "newrun" | "nextlevel"

function startNewRun() {
  state.scores = [0, 0];
  state.lives = [3, 3];
  loadLevel(0, { keepProgress: true });
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

  state.waveLeft = state.levelCfg.waveTotal;
  state.enemiesAlive = 0;
  state.enemySpawnTimer = 0.2;
  state.tiles = buildTiles(state.levelCfg.layout);
  splitTiles();

  state.bullets = [];
  state.enemies = [];
  state.powerUps = [];
  fx.particles = [];
  fx.rings = [];

  // 双人出生：左下 + 右下（每关都会重置位置；分数/生命按 keepProgress 保留）
  const y0 = WORLD_H - 2 * TILE - 14;
  const p1Spawn = findFreeTankPos(TILE * 2, y0, 28, 28, null);
  const p2Spawn = findFreeTankPos(WORLD_W - TILE * 3, y0, 28, 28, null);
  state.players = [
    new Tank({ x: p1Spawn.x, y: p1Spawn.y, dir: DIR.UP, isPlayer: true, playerId: 1 }),
    new Tank({ x: p2Spawn.x, y: p2Spawn.y, dir: DIR.UP, isPlayer: true, playerId: 2 }),
  ];
  // 生命为0的玩家该关不复活
  state.players[0].alive = (state.lives[0] > 0);
  state.players[1].alive = (state.lives[1] > 0);
  state.players[0].invuln = state.players[0].alive ? 1.4 : 0;
  state.players[1].invuln = state.players[1].alive ? 1.4 : 0;

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
  if (sub) sub.textContent = state.levelCfg.night
    ? "玩法创新：夜战视野受限 + 道具（护盾/连发/穿甲）"
    : "玩法创新：击败敌人掉落道具（护盾/连发/穿甲）";
  if (ui.btnStart) ui.btnStart.textContent = "开始本关";
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
  setText(ui.enemies, state.waveLeft + state.enemiesAlive);
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
  setText(ui.buffs, `${btxt(p1, "P1:")} | ${btxt(p2, "P2:")}`);
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
  if (btn) btn.textContent = "再来一局";
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
      const blockers = state.tiles.filter(t => t.blocksBullets() && t.type !== "grass");
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

  // 玩家（双人）
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
  if (p2 && p2.alive) {
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
          b.alive = false;
          damageBaseAt(t);
          spawnImpact(t.x + TILE / 2, t.y + TILE / 2, "enemy", 1.4);
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

  // 胜利条件：敌人全部刷完且全灭
  if (state.waveLeft <= 0 && state.enemiesAlive <= 0 && !state.over) {
    onLevelCleared();
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
  if (ui.btnStart) ui.btnStart.textContent = "进入下一关";
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

function drawGrass(vp, t) {
  const p = worldToScreen(vp, t.x, t.y);
  const w = t.w * vp.scale;
  const h = t.h * vp.scale;
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = "rgba(34,197,94,.35)";
  ctx.fillRect(p.x, p.y, w, h);
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = "rgba(34,197,94,.65)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    const xx = p.x + (i / 6) * w;
    ctx.beginPath();
    ctx.moveTo(xx, p.y + h);
    ctx.lineTo(xx + 4, p.y + h * 0.2);
    ctx.stroke();
  }
  ctx.restore();
}

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

function drawNightFog(vp) {
  if (!ctx) return;
  ctx.save();
  // 先盖一层黑雾
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "rgba(0,0,0,.58)";
  ctx.fillRect(vp.offsetX, vp.offsetY, WORLD_W * vp.scale, WORLD_H * vp.scale);

  // 再用 destination-out 挖出视野
  ctx.globalCompositeOperation = "destination-out";
  for (const pl of state.players) {
    if (!pl || !pl.alive) continue;
    const c = pl.center();
    const p = worldToScreen(vp, c.x, c.y);
    const r0 = 30 * vp.scale;
    const r1 = 180 * vp.scale;
    const g = ctx.createRadialGradient(p.x, p.y, r0, p.x, p.y, r1);
    g.addColorStop(0, "rgba(0,0,0,1)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

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

  // 子弹
  for (const b of state.bullets) if (b.alive) drawBullet(vp, b);

  // 道具
  for (const pu of state.powerUps) drawPowerUp(vp, pu);

  // 草地覆盖层（能遮挡坦克/子弹，增加层次）
  for (const g of state.grass) drawGrass(vp, g);

  // 爆炸/火花特效（放在最上层，避免被草盖住）
  drawFX(vp);

  // 第3关：夜战视野（玩法创新）
  if (state.levelCfg?.night) drawNightFog(vp);

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
  if (sub) sub.textContent = "玩法创新：道具（护盾/连发/穿甲）与第3关夜战视野｜P1: WASD+空格｜P2: 方向键+回车｜P暂停";
  if (ui.btnStart) ui.btnStart.textContent = "开始游戏";
  startAction = "newrun";
}

function startGame() {
  if (startAction === "newrun") {
    startNewRun();
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
  startGame();
});
ui.btnPause?.addEventListener("click", () => {
  togglePause();
});
ui.btnRestart?.addEventListener("click", () => {
  showMenu();
});

// 初始化
resizeCanvas();
showMenu();
updateHUD();
requestAnimationFrame(frame);


