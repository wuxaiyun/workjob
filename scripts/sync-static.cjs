// 将前端构建产物复制到 worker/public，实现 Workers 一体化部署
// Windows 下 wrangler dev 会持有 assets 目录句柄，rmSync 可能 EPERM，需容错清理
const fs = require('fs');
const path = require('path');

const from = path.resolve(__dirname, '../frontend/dist');
const to = path.resolve(__dirname, '../worker/public');

function sleep(ms) {
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, ms);
}

function clearDir(dir) {
  for (let i = 0; i < 6; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      sleep(150 * (i + 1));
    }
  }
  // 整体删除仍失败（目录句柄被占用）：逐个删除内部文件，容忍目录锁定
  console.warn('[warn] worker/public 目录被占用，改为逐文件清理');
  const removeRecursive = (p) => {
    for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
      const fp = path.join(p, entry.name);
      try {
        if (entry.isDirectory()) {
          removeRecursive(fp);
          try { fs.rmdirSync(fp); } catch { /* 仍占用则跳过 */ }
        } else {
          try { fs.unlinkSync(fp); } catch { /* 占用则跳过 */ }
        }
      } catch { /* ignore */ }
    }
  };
  if (!fs.existsSync(dir)) return;
  try { removeRecursive(dir); } catch { /* ignore */ }
}

clearDir(to);
fs.mkdirSync(to, { recursive: true });
fs.cpSync(from, to, { recursive: true });
console.log('静态资源已同步到 worker/public');