# 达人物流单号自助查询系统

## 极简部署教程（3步，10分钟搞定）

### 第1步：注册 GitHub 并上传代码

1. 打开 https://github.com 注册账号（用邮箱即可）
2. 登录后点击右上角 **+ → New repository**
3. 仓库名填 `logistics-app`，选 **Public**，点 **Create repository**
4. 点击 **uploading an existing file**，把本文件夹内以下文件/文件夹**全部拖拽上传**：
   - `server.js`
   - `package.json`
   - `package-lock.json`
   - `.gitignore`
   - `public/` 文件夹
   - `data/` 文件夹
5. 点 **Commit changes** 提交

### 第2步：Railway 部署

1. 打开 https://railway.app 用 GitHub 账号登录
2. 点击 **New Project → Deploy from GitHub repo**
3. 授权后选择 `logistics-app` 仓库
4. Railway 自动检测 Node.js 项目并开始部署（约1-2分钟）
5. 部署完成后点击 **Settings → Networking → Generate Domain**

### 第3步：获取公网地址 + 二维码

1. 复制生成的域名（如 `https://logistics-app.railway.app`）
2. 打开 `https://你的域名/admin` → 进入B端管理后台
3. 页面底部**自动生成了永久二维码**，点击下载即可发给达人

---

## 三个页面

| 页面 | 路径 | 用途 |
|------|------|------|
| C端查询页 | `/` | 达人输入手机号查物流 |
| B端管理后台 | `/admin` | 粘贴数据、上传、查看、导出二维码 |
| 微信QR页 | `/qr` | 纯大图二维码，微信长按识别 |

## 数据说明

数据存储在 `data/logistics.json`，JSON 格式，自动创建。
Railway 免费版每月 500 小时运行时间，足够日常使用。

## 二维码永久有效

Railway 域名固定不变，今天生成的二维码明天、后天都能用。
B端管理后台录入新数据后，达人用同一个二维码扫码即可查到最新结果。
