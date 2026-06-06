/**
 * 达人物流单号自助查询系统 - 后端服务
 * 技术栈: Node.js + Express + JSON文件数据库
 * 无需MySQL/Redis等复杂数据库，开箱即用
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;

// 数据文件路径（JSON文件当数据库用）
const DATA_FILE = path.join(__dirname, 'data', 'logistics.json');

// ── 中间件 ──────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ── 数据库初始化（首次运行自动创建） ─────────────────────
function initDB() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({}, null, 2), 'utf8');
    console.log('[DB] 数据库初始化完成');
  }
}

// 读取数据库
function readDB() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    console.error('[DB] 读取失败，返回空数据库', e.message);
    return {};
  }
}

// 写入数据库（覆盖全部）
function writeDB(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ── 核心算法：解析粘贴数据，提取手机号与物流单号 ───────────
/**
 * 从一行粘贴内容里解析出 { phone, trackingNo }
 * 格式：[含手机号的地址字符串]\t[物流单号（可为空）]
 *
 * 列顺序：第一列 = 地址（必须含手机号），第二列 = 物流单号（可为空/不填）
 * 手机号正则：中国大陆 11位，1[3-9] 开头，前后必须是非数字
 */
function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // 按 TAB 分割（从飞书/Excel直接复制的格式）
  const parts = trimmed.split('\t');

  // 第一列：地址（必须存在）
  const addressRaw = parts[0].trim();
  if (!addressRaw) return null;

  // 第二列：物流单号（允许为空——表示只有地址、尚未发货）
  const trackingNo = parts.length >= 2 ? parts[1].trim() : '';

  // 正则提取手机号：11位，1[3-9]开头，前后为非数字边界
  const phoneRegex = /(?<![0-9])1[3-9]\d{9}(?![0-9])/g;
  const phones = addressRaw.match(phoneRegex);
  const phone = phones ? phones[0] : null;

  return {
    trackingNo: trackingNo,   // 可能为空字符串（未发货）
    phone: phone,
    rawAddress: addressRaw
  };
}

// ── API 路由 ─────────────────────────────────────────────

/**
 * POST /api/upload
 * B端：解析并上传批量数据
 * Body: { rawText: "粘贴的原始文本" }
 */
app.post('/api/upload', (req, res) => {
  const { rawText } = req.body;
  if (!rawText || !rawText.trim()) {
    return res.json({ success: false, message: '请粘贴数据后再上传' });
  }

  const lines = rawText.split('\n');
  const db = readDB();

  let successCount = 0;
  let skipCount = 0;
  const errors = [];

  lines.forEach((line, idx) => {
    const result = parseLine(line);
    if (!result) {
      if (line.trim()) skipCount++;
      return;
    }

    const { trackingNo, phone } = result;

    // 地址列必须能提取到手机号，否则跳过
    if (!phone) {
      errors.push(`第 ${idx + 1} 行：地址中未能提取手机号，已跳过（地址：${result.rawAddress.slice(0, 30)}...）`);
      skipCount++;
      return;
    }

    // 初始化该手机号的记录（如果不存在）
    if (!db[phone]) {
      db[phone] = [];
    }

    if (trackingNo) {
      // 有物流单号：追加（防重复）
      if (!db[phone].includes(trackingNo)) {
        db[phone].push(trackingNo);
      }
    }
    // 没有物流单号：手机号已存入（空数组），查询时会提示"仓库未发货"
    // 注意：如果该手机号已有单号，不会清空已有单号

    successCount++;
  });

  writeDB(db);

  return res.json({
    success: true,
    message: `✅ 成功导入 ${successCount} 条，跳过 ${skipCount} 条`,
    successCount,
    skipCount,
    errors: errors.slice(0, 10) // 最多返回10条错误详情
  });
});

/**
 * GET /api/query?phone=13812345678
 * C端：达人用手机号查询物流单号
 */
app.get('/api/query', (req, res) => {
  const { phone } = req.query;

  // 验证手机号格式
  if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
    return res.json({
      success: false,
      message: '请输入正确的11位手机号'
    });
  }

  const db = readDB();
  const trackingNos = db[phone];

  if (trackingNos === undefined) {
    // ❓ 手机号完全不在数据库中
    return res.json({
      success: true,
      found: false,
      hasRecord: false,
      phone,
      message: '未查询到您的信息，请确认手机号是否正确，或联系工作人员'
    });
  } else if (trackingNos.length > 0) {
    // ✅ 找到物流单号（可能有多个）
    return res.json({
      success: true,
      found: true,
      phone,
      trackingNos,
      message: `查询到 ${trackingNos.length} 个物流单号`
    });
  } else {
    // ⏳ 手机号存在，但没有物流单号（审核通过，仓库未发货）
    return res.json({
      success: true,
      found: false,
      hasRecord: true,
      phone,
      message: '您的带货审核已经通过，您的货物还在仓库没有发货，可以过一两天过来重新搜索'
    });
  }
});

/**
 * GET /api/list
 * B端：查看当前数据库所有记录（用于验证）
 */
app.get('/api/list', (req, res) => {
  const db = readDB();
  const total = Object.keys(db).length;
  return res.json({
    success: true,
    total,
    data: db
  });
});

/**
 * DELETE /api/clear
 * B端：清空所有数据（危险操作，需要密码确认）
 */
app.delete('/api/clear', (req, res) => {
  const { password } = req.body;
  // 简单密码保护，可在环境变量中自定义
  const ADMIN_PWD = process.env.ADMIN_PASSWORD || 'admin123';
  if (password !== ADMIN_PWD) {
    return res.json({ success: false, message: '密码错误' });
  }
  writeDB({});
  return res.json({ success: true, message: '数据库已清空' });
});

/**
 * GET /api/qrcode?url=xxx
 * 服务端生成二维码（PNG格式，微信可长按识别）
 */
app.get('/api/qrcode', async (req, res) => {
  const url = req.query.url || req.query.text || '';
  if (!url) {
    return res.status(400).json({ success: false, message: '缺少url参数' });
  }
  try {
    // 生成 PNG Data URL，然后提取 Buffer
    const dataUrl = await QRCode.toDataURL(url, {
      width: 400,
      margin: 2,
      color: { dark: '#1e1b4b', light: '#ffffff' },
      errorCorrectionLevel: 'H'
    });
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    const buffer = Buffer.from(base64, 'base64');
    res.set({
      'Content-Type': 'image/png',
      'Content-Length': buffer.length,
      'Cache-Control': 'public, max-age=86400'
    });
    res.send(buffer);
  } catch (e) {
    console.error('[QR] 生成失败', e.message);
    res.status(500).send('QR generation failed');
  }
});

// ── 页面路由 ──────────────────────────────────────────────
// C端查询页
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 微信专用二维码展示页（纯PNG二维码，可长按识别、保存、转发）
app.get('/qr', async (req, res) => {
  try {
    const queryUrl = req.protocol + '://' + req.get('host') + '/';
    const dataUrl = await QRCode.toDataURL(queryUrl, {
      width: 500,
      margin: 2,
      color: { dark: '#1e1b4b', light: '#ffffff' },
      errorCorrectionLevel: 'H'
    });
    res.send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>物流查询 - 扫码入口</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{
  background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);
  min-height:100vh;display:flex;align-items:center;justify-content:center;
  font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;
  padding:20px;
}
.card{
  background:#fff;border-radius:24px;padding:40px 28px;
  text-align:center;max-width:400px;width:100%;
  box-shadow:0 20px 60px rgba(0,0,0,0.2);
}
.logo{font-size:48px;margin-bottom:12px}
.title{font-size:22px;font-weight:700;color:#1a1a2e;margin-bottom:4px}
.sub{font-size:13px;color:#999;margin-bottom:24px}
.qr-wrap{
  background:#f0f4ff;border-radius:20px;padding:20px;
  display:inline-block;margin-bottom:16px;
}
.qr-wrap img{width:280px;height:280px;border-radius:12px}
.tip{
  font-size:12px;color:#999;margin-top:8px;line-height:1.8;
}
.tip b{color:#4338ca}
.btn{
  display:block;width:100%;padding:14px;margin-top:16px;
  background:linear-gradient(135deg,#4F46E5,#7C3AED);
  color:#fff;border:none;border-radius:12px;
  font-size:16px;font-weight:600;cursor:pointer;
  text-decoration:none;letter-spacing:1px;
}
.footer{margin-top:16px;font-size:12px;color:#bbb}
</style>
</head>
<body>
<div class="card">
  <div class="logo">📦</div>
  <div class="title">物流单号查询</div>
  <div class="sub">长按下方二维码 → 识别图中二维码</div>
  <div class="qr-wrap">
    <img src="${dataUrl}" alt="查询页二维码">
  </div>
  <div class="tip">
    <b>微信长按二维码</b>，选择「识别图中二维码」<br>
    即可进入查询页面，输入手机号查物流单号
  </div>
  <a href="/" class="btn" style="display:block;text-align:center">📱 直接打开查询页</a>
  <div class="footer">二维码永久有效，随时扫码可查最新数据</div>
</div>
</body>
</html>`);
  } catch (e) {
    res.status(500).send('QR generation failed');
  }
});

// B端管理页
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ── 启动 ─────────────────────────────────────────────────
initDB();
app.listen(PORT, () => {
  console.log(`\n🚀 服务已启动：http://localhost:${PORT}`);
  console.log(`📱 C端查询页：http://localhost:${PORT}/`);
  console.log(`🛠️  B端管理页：http://localhost:${PORT}/admin`);
  console.log(`\n提示：部署到 Cloud Studio 后，将域名替换 localhost:${PORT} 即可\n`);
});
