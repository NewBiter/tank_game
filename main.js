// 坦克大战（网页版）- 零依赖纯Canvas实现
// 说明：使用固定“世界坐标”，渲染时按屏幕缩放并居中，避免不同分辨率导致物理不一致。

const $ = (sel) => document.querySelector(sel);
const canvas = /** @type {HTMLCanvasElement} */ ($("#game"));
const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d", { alpha: true }));

const ui = {
  overlay: $("#overlay"),
  btnStart: $("#btn-start"),
  btnPause: $("#btn-pause"),
  btnRestart: $("#btn-restart"),
  score: $("#score"),
  lives: $("#lives"),
  enemies: $("#enemies"),
};

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
const input = {
  up: false, down: false, left: false, right: false,
  fire: false,
  firePressed: false, // edge
  pausePressed: false,
};

// 让“最后按下的方向键”优先生效（更符合直觉）
let moveSeq = 0;
const moveOrder = { up: 0, right: 0, down: 0, left: 0 };
const moveKeyToDir = { up: 0, right: 1, down: 2, left: 3 };

function recomputeMoveDir() {
  let bestKey = null;
  let bestSeq = -1;
  for (const k of ["up", "right", "down", "left"]) {
    if (input[k] && moveOrder[k] > bestSeq) {
      bestSeq = moveOrder[k];
      bestKey = k;
    }
  }
  return bestKey ? moveKeyToDir[bestKey] : null;
}

const keyMap = new Map([
  ["KeyW", "up"], ["ArrowUp", "up"],
  ["KeyS", "down"], ["ArrowDown", "down"],
  ["KeyA", "left"], ["ArrowLeft", "left"],
  ["KeyD", "right"], ["ArrowRight", "right"],
  ["Space", "fire"], ["Enter", "fire"],
]);

function onKey(e, isDown) {
  const k = keyMap.get(e.code);
  if (k) {
    e.preventDefault();
    if (k === "fire") {
      if (isDown && !input.fire) input.firePressed = true;
      input.fire = isDown;
    } else {
      if (isDown && !input[k]) {
        moveSeq += 1;
        moveOrder[k] = moveSeq;
      }
      input[k] = isDown;
    }
  }
  if (e.code === "KeyP" && isDown) {
    e.preventDefault();
    input.pausePressed = true;
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
      if (down && !input.fire) input.firePressed = true;
      input.fire = down;
      return;
    }
    if (!(key in input)) return;
    if (down && !input[key]) {
      moveSeq += 1;
      moveOrder[key] = moveSeq;
    }
    input[key] = down;
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

function dirFromInput() {
  // 取“最后按下的方向”
  return recomputeMoveDir();
}

class Tank {
  constructor({ x, y, dir, isPlayer }) {
    this.x = x; this.y = y;
    this.w = 28; this.h = 28;
    this.dir = dir ?? DIR.UP;
    this.isPlayer = !!isPlayer;
    this.speed = this.isPlayer ? 120 : 88;
    this.cooldown = 0;
    this.alive = true;
    this.invuln = this.isPlayer ? 1.2 : 0;
    this.ai = this.isPlayer ? null : {
      turnTimer: rand(0.2, 1.2),
      shootTimer: rand(0.3, 1.6),
    };
  }
  rect() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }
  center() { return { x: this.x + this.w / 2, y: this.y + this.h / 2 }; }
}

class Bullet {
  constructor({ x, y, dir, owner }) {
    this.x = x; this.y = y;
    this.dir = dir;
    this.owner = owner; // "player" | "enemy"
    this.r = 4;
    this.speed = 260;
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
const LEVEL = [
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
];

function buildTiles() {
  /** @type {Tile[]} */
  const tiles = [];
  for (let y = 0; y < LEVEL.length; y++) {
    const row = LEVEL[y];
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
  score: 0,
  lives: 3,
  waveLeft: 10, // 总敌人数量
  enemiesAlive: 0,
  enemySpawnTimer: 0,
  tiles: buildTiles(),
  grass: [], // 覆盖层
  solids: [],
  player: null,
  enemies: /** @type {Tank[]} */ ([]),
  bullets: /** @type {Bullet[]} */ ([]),
  lastTime: 0,
};

function splitTiles() {
  state.grass = state.tiles.filter(t => t.type === "grass");
  state.solids = state.tiles.filter(t => t.blocksTanks());
}
splitTiles();

function resetGame() {
  state.running = true;
  state.paused = false;
  state.over = false;
  state.win = false;
  state.score = 0;
  state.lives = 3;
  state.waveLeft = 12;
  state.enemiesAlive = 0;
  state.enemySpawnTimer = 0.2;
  state.tiles = buildTiles();
  splitTiles();
  state.bullets = [];
  state.enemies = [];

  // 玩家出生点（底部中间偏左）
  state.player = new Tank({ x: WORLD_W / 2 - 14, y: WORLD_H - 2 * TILE - 14, dir: DIR.UP, isPlayer: true });
  // 防止出生直接压在基地上
  state.player.x = clamp(state.player.x, 8, WORLD_W - state.player.w - 8);
  state.player.y = clamp(state.player.y, 8, WORLD_H - state.player.h - 8);

  updateHUD();
}

function updateHUD() {
  ui.score.textContent = String(state.score);
  ui.lives.textContent = String(state.lives);
  ui.enemies.textContent = String(state.waveLeft + state.enemiesAlive);
  ui.btnPause.textContent = state.paused ? "继续" : "暂停";
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
  if (state.player && tank !== state.player && state.player.alive) {
    if (rectsOverlap(next, state.player.rect())) return false;
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
  state.bullets.push(new Bullet({
    x: ox,
    y: oy,
    dir: tank.dir,
    owner: tank.isPlayer ? "player" : "enemy",
  }));
  tank.cooldown = tank.isPlayer ? 0.24 : 0.55;
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
  ui.overlay.classList.remove("hidden");

  const panel = ui.overlay.querySelector(".panel");
  const h1 = panel.querySelector("h1");
  const sub = panel.querySelector(".sub");
  const btn = ui.btnStart;
  h1.textContent = win ? "胜利！" : "游戏结束";
  sub.textContent = win
    ? `恭喜通关！分数：${state.score}`
    : `基地被摧毁或生命耗尽。分数：${state.score}`;
  btn.textContent = "再来一局";
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
  if (state.player && state.player.alive && rectsOverlap(box, state.player.rect())) return false;
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
    e.speed = 86 + irand(-6, 8);
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

  // 简单追踪：若与玩家同轴且视线无阻，有更高概率转向并射击
  const p = state.player;
  if (p && p.alive) {
    const ec = e.center();
    const pc = p.center();
    const dx = pc.x - ec.x;
    const dy = pc.y - ec.y;
    const alignedX = Math.abs(dx) < 10;
    const alignedY = Math.abs(dy) < 10;
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
          e.ai.shootTimer = rand(0.4, 1.3);
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
    e.ai.shootTimer = rand(0.6, 1.8);
  }
}

// ===== 逻辑更新 =====
function update(dt) {
  if (input.pausePressed) {
    input.pausePressed = false;
    togglePause();
  }

  if (!state.running || state.paused || state.over) {
    // 清理一次性边沿输入
    input.firePressed = false;
    return;
  }

  // 敌人刷怪
  state.enemySpawnTimer -= dt;
  if (state.enemySpawnTimer <= 0) {
    const wantAliveCap = 4; // 同屏最大敌人数
    if (state.enemiesAlive < wantAliveCap && state.waveLeft > 0) spawnEnemy();
    state.enemySpawnTimer = rand(0.8, 1.3);
  }

  // 玩家
  const p = state.player;
  if (p && p.alive) {
    p.invuln = Math.max(0, p.invuln - dt);
    p.cooldown = Math.max(0, p.cooldown - dt);

    const wantDir = dirFromInput();
    if (wantDir !== null) p.dir = wantDir;
    const v = DIR_V[p.dir];
    const moving = input.up || input.down || input.left || input.right;
    if (moving) {
      tryMoveTank(p, v.x * p.speed * dt, v.y * p.speed * dt);
    }
    if (input.firePressed) {
      fireFromTank(p);
    }
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
        b.alive = false;
        if (t.type === "brick") {
          t.hp -= 1;
          if (t.hp <= 0) {
            state.tiles = state.tiles.filter(x => x !== t);
            splitTiles();
          }
        } else if (t.type === "base") {
          damageBaseAt(t);
        }
        break;
      }
    }
    if (!b.alive) continue;

    // 命中坦克
    if (b.owner === "enemy" && state.player && state.player.alive) {
      const pr = state.player.rect();
      if (rectsOverlap(br, pr) && state.player.invuln <= 0) {
        b.alive = false;
        killPlayer();
      }
    } else if (b.owner === "player") {
      for (const e of state.enemies) {
        if (!e.alive) continue;
        if (rectsOverlap(br, e.rect()) && e.invuln <= 0) {
          b.alive = false;
          killEnemy(e);
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
    gameOver(true);
  }

  updateHUD();

  // 清理一次性边沿输入
  input.firePressed = false;
}

function killEnemy(e) {
  e.alive = false;
  state.enemiesAlive = Math.max(0, state.enemiesAlive - 1);
  state.score += 100;
}

function killPlayer() {
  state.lives -= 1;
  if (state.lives <= 0) {
    state.player.alive = false;
    gameOver(false);
    return;
  }
  // 重生
  state.player.x = WORLD_W / 2 - 14;
  state.player.y = WORLD_H - 2 * TILE - 14;
  state.player.dir = DIR.UP;
  state.player.invuln = 1.4;
  state.player.cooldown = 0.2;
}

function togglePause() {
  if (!state.running || state.over) return;
  state.paused = !state.paused;
  updateHUD();
}

// ===== 渲染 =====
function drawBackground(vp) {
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
  const w = t.w * vp.scale;
  const h = t.h * vp.scale;

  const body = t.isPlayer ? "rgba(96,165,250,.95)" : "rgba(245,158,11,.95)";
  const edge = "rgba(0,0,0,.30)";
  const invulnGlow = t.invuln > 0 && t.isPlayer;

  ctx.save();
  if (invulnGlow) {
    ctx.shadowColor = "rgba(96,165,250,.9)";
    ctx.shadowBlur = 18;
  }

  // 车身
  ctx.fillStyle = body;
  ctx.fillRect(p.x, p.y, w, h);
  ctx.strokeStyle = edge;
  ctx.lineWidth = 1;
  ctx.strokeRect(p.x + 0.5, p.y + 0.5, w - 1, h - 1);

  // 履带
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = "rgba(0,0,0,.6)";
  ctx.fillRect(p.x + w * 0.08, p.y + h * 0.08, w * 0.14, h * 0.84);
  ctx.fillRect(p.x + w * 0.78, p.y + h * 0.08, w * 0.14, h * 0.84);
  ctx.restore();

  // 炮塔 + 炮管（按方向画）
  const cx = p.x + w / 2;
  const cy = p.y + h / 2;
  ctx.fillStyle = "rgba(0,0,0,.22)";
  ctx.beginPath();
  ctx.arc(cx, cy, Math.min(w, h) * 0.18, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(17,24,39,.75)";
  const tubeW = Math.min(w, h) * 0.16;
  const tubeL = Math.min(w, h) * 0.55;
  if (t.dir === DIR.UP) ctx.fillRect(cx - tubeW / 2, cy - tubeL, tubeW, tubeL);
  if (t.dir === DIR.DOWN) ctx.fillRect(cx - tubeW / 2, cy, tubeW, tubeL);
  if (t.dir === DIR.LEFT) ctx.fillRect(cx - tubeL, cy - tubeW / 2, tubeL, tubeW);
  if (t.dir === DIR.RIGHT) ctx.fillRect(cx, cy - tubeW / 2, tubeL, tubeW);

  ctx.restore();
}

function drawBullet(vp, b) {
  const p = worldToScreen(vp, b.x, b.y);
  ctx.save();
  ctx.fillStyle = b.owner === "player" ? "rgba(229,231,235,.95)" : "rgba(251,113,133,.95)";
  ctx.beginPath();
  ctx.arc(p.x, p.y, b.r * vp.scale, 0, Math.PI * 2);
  ctx.fill();
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
  const vp = computeViewport();
  drawBackground(vp);

  // 世界内容
  for (const t of state.tiles) {
    if (t.type === "grass") continue;
    drawTile(vp, t);
  }

  // 坦克
  if (state.player && state.player.alive) drawTank(vp, state.player);
  for (const e of state.enemies) if (e.alive) drawTank(vp, e);

  // 子弹
  for (const b of state.bullets) if (b.alive) drawBullet(vp, b);

  // 草地覆盖层（能遮挡坦克/子弹，增加层次）
  for (const g of state.grass) drawGrass(vp, g);

  drawOverlayHints(vp);
}

// ===== 主循环 =====
function frame(ts) {
  if (!state.lastTime) state.lastTime = ts;
  const dt = clamp((ts - state.lastTime) / 1000, 0, 1 / 20); // 限制最大步长
  state.lastTime = ts;
  update(dt);
  render();
  requestAnimationFrame(frame);
}

// ===== UI绑定 =====
function showMenu() {
  ui.overlay.classList.remove("hidden");
  const panel = ui.overlay.querySelector(".panel");
  panel.querySelector("h1").textContent = "坦克大战";
  panel.querySelector(".sub").textContent = "WASD/方向键移动，空格/回车开火，P暂停";
  ui.btnStart.textContent = "开始游戏";
}

function startGame() {
  resetGame();
  state.running = true;
  ui.overlay.classList.add("hidden");
  updateHUD();
}

ui.btnStart.addEventListener("click", () => {
  startGame();
});
ui.btnPause.addEventListener("click", () => {
  togglePause();
});
ui.btnRestart.addEventListener("click", () => {
  startGame();
});

// 初始化
resizeCanvas();
showMenu();
updateHUD();
requestAnimationFrame(frame);


