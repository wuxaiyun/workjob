/* 独立校验：对任一个 export-all 产物目录做静态完整性检查
 * 用法：node scripts/verify-all.cjs local-export/export-YYYYMMDD-HHMMSS [--redownload]
 *   --redownload：逐对象重新从 R2 下载比对 SHA-256（较慢，约 20 秒/对象）
 */
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WORKER = path.join(ROOT, 'worker');
const WRANGLER_JS = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const R2_BUCKET = 'equipment-ledger-photos';

const dir = process.argv[2];
const redownload = process.argv.includes('--redownload');
if (!dir || !fs.existsSync(path.join(dir, 'manifest.json'))) {
  console.error('用法：node scripts/verify-all.cjs <export目录> [--redownload]');
  process.exit(2);
}
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const log = (m) => console.log('[verify] ' + m);
let errs = 0;

// 1. manifest 指纹
for (const [rel, want] of Object.entries(manifest.files_sha256 || {})) {
  const file = path.join(dir, rel);
  if (!fs.existsSync(file)) { log('缺失：' + rel); errs++; continue; }
  const got = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (got !== want) { log('SHA 不符：' + rel); errs++; }
}
log('dump/JSON 指纹核对完成（' + Object.keys(manifest.files_sha256 || {}).length + ' 个）');

// 2. R2 文件与 sha
for (const e of manifest.r2.objects) {
  const f = path.join(dir, 'files', e.key);
  if (!fs.existsSync(f)) { log('缺失对象文件：' + e.key); errs++; continue; }
  const st = fs.statSync(f);
  if (st.size !== e.size) { log('大小不符：' + e.key); errs++; continue; }
  if (crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') !== e.sha256) { log('SHA 不符：' + e.key); errs++; }
}
log('R2 对象文件核对完成（' + manifest.r2.objects.length + ' 个，缺失引用 ' + (manifest.r2.missing_referenced || []).length + ' 个）');

// 3. 可选：从 R2 重新下载比对
if (redownload) {
  for (const e of manifest.r2.objects) {
    const tmp = path.join(path.dirname(dir), '._verify_tmp');
    try {
      execFileSync(process.execPath, [WRANGLER_JS, 'r2', 'object', 'get', R2_BUCKET + '/' + e.key, '--remote', '--file', tmp, '--cwd', WORKER], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
      if (crypto.createHash('sha256').update(fs.readFileSync(tmp)).digest('hex') !== e.sha256) { log('R2 端 SHA 不符：' + e.key); errs++; }
    } catch (err) { log('R2 下载失败：' + e.key); errs++; } finally { try { fs.unlinkSync(tmp); } catch {} }
  }
  log('R2 端重下载比对完成');
}

console.log(errs === 0 ? '校验通过 ✓' : '校验失败：' + errs + ' 处异常 ✗');
process.exit(errs === 0 ? 0 : 1);
