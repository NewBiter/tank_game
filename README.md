# 坦克大战（网页版）

这是一个**零依赖**的 HTML5 Canvas 小游戏：玩家坦克对抗敌方AI，保护基地、消灭所有敌人即可获胜。

## 运行方式

### 方式1：直接打开

用浏览器打开 `index.html` 即可游玩（推荐 Chrome/Edge/Firefox）。

### 方式2：起一个本地静态服务器（更推荐）

在项目目录执行：

```bash
cd /home/vince/game
python3 -m http.server 8000
```

然后在浏览器访问：`http://localhost:8000`

## 让远方的朋友也能玩（发布到公网）

这是一个**纯静态站点**（只有 `index.html / main.js / style.css`），最适合用静态托管。

### 方案A：GitHub Pages（免费）

1. 把 `/home/vince/game` 里的文件上传到一个 GitHub 仓库（至少包含 `index.html / main.js / style.css`）。
2. 打开仓库 **Settings → Pages**：
   - **Source** 选择 `Deploy from a branch`
   - **Branch** 选择 `main`（或你的分支）和 `/ (root)`
3. 保存后等待 1-3 分钟，GitHub 会给你一个 `https://xxxx.github.io/xxxx/` 链接。
4. 把这个链接发给朋友即可直接玩。

### 方案B：Netlify（免费，最省事）

1. 打开 Netlify，新建站点
2. 直接把包含 `index.html` 的整个文件夹拖拽上传
3. 等待部署完成，复制它给的公网链接发给朋友

### 方案C：Cloudflare Pages（免费）

把仓库连到 Cloudflare Pages，构建命令留空（静态站不需要构建），输出目录选仓库根目录即可。

## 操作

- **移动**：WASD 或 方向键
- **开火**：空格 或 回车
- **暂停/继续**：P 或右上角“暂停/继续”按钮
- **移动端**：底部虚拟方向键 + 开火按钮

## 玩法

- **胜利**：敌人全部刷出并被消灭
- **失败**：生命耗尽或基地（红色块）被摧毁

## 自定义

你可以在 `main.js` 中修改：

- `LEVEL`：关卡地图（`#`砖墙、`S`钢墙、`~`水、`G`草、`B`基地、`.`空地）
- `state.waveLeft`：敌人总数
- `wantAliveCap`：同屏最大敌人数


