# Hold'em Club — 部署到 Render（免费）

任何人打开链接就能玩，无需装 App。

## 一次性部署步骤

### 1. 推到 GitHub
```
cd D:\youxi
git init
git add .
git commit -m "holdem club"
# 在 GitHub 新建一个空仓库 holdem-club，然后：
git remote add origin https://github.com/<你的账号>/holdem-club.git
git push -u origin main
```

注意在 `.gitignore` 里排除 `node_modules` 和 `dist`（Docker build 会重新构建）。

### 2. Render 一键部署
1. 打开 https://render.com ，用 GitHub 登录（免费）
2. 点 **New → Web Service**
3. 选中刚 push 的 `holdem-club` 仓库
4. Render 自动检测到 `render.yaml` 或 `Dockerfile`，点 **Deploy**
5. 等 3-5 分钟 build 完，给你一个永久域名：
   `https://holdem-club-xxxx.onrender.com`

### 3. 把链接发给任何人
手机浏览器直接打开 → 点「快速开局」→ 5 秒自动进牌桌。

## 免费档限制
- 每天会休眠，首次冷启动 30-50 秒
- 一个房间最多 6 人，多人同时在线要开多个房间
- 不持久化（重启后筹码归零），但 bot 对局不影响

## 本地开发回顾
```powershell
cd holdem-engine; npm install; npm run build; npm test
cd holdem-server; npm install; npm run build; node dist/index.js
# 另开终端：
cd holdem-web; npm install; npm run dev
```
