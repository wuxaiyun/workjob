/* 全量导出：D1 数据库（官方一致性导出）+ R2 全部被引用对象 → local-export/ 下带 manifest 的时间戳目录
 *
 * 用法：
 *   node scripts/export-all.cjs                 # 导出到 local-export/export-<时间戳>
 *   node scripts/export-all.cjs --verify        # 导出后立即做完整性校验（重新下载比对 SHA-256）
 * 产物不含 R2 自定义元数据（CLI 无 list/元数据接口，导出由本工具从 DB 收集 key）。
 */
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WORKER = path.join(ROOT, 'worker');
const WRANGLER_JS = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const OUT_ROOT = path.join(ROOT, 'local-export');

const DB_NAME = 'equipment-ledger-db';
const R2_BUCKET = 'equipment-ledger-photos';
const KEY_SOURCES = ['photo', 'attachment', 'document', 'backup_log', 'material'];
const KEY_COLUMNS = ['object_key', 'thumbnail_key', 'photo_key', 'photo_thumb_key'];

function run(args) {
  return execFileSync(process.execPath, [WRANGLER_JS, ...args, '--cwd', WORKER], {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
}
function runD1Json(sql) {
  const out = run(['d1', 'execute', DB_NAME, '--remote', '--json', '--command', sql]);
  const clean = out.replace(/\x1b\[[0-9;]*m/g, '');
  const lines = clean.split(/\r?\n/);
  const at = lines.findIndex((l) => l.trimStart().startsWith('['));
  if (at < 0) throw new Error('d1 输出中未找到 JSON：\n' + clean.slice(0, 400));
  const rows = JSON.parse(lines.slice(at).join('\n'));
  return rows.flatMap((r) => r.results || []);
}
function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/* ---------- SQL dump 解析（用于生成 per-table JSON 与 key 收集） ---------- */
function tokenizeValues(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && (s[i] === ' ' || s[i] === '\t' || s[i] === '\n' || s[i] === '\r')) i++;
    if (i >= s.length) break;
    if (s[i] === ',') { i++; continue; }
    let val;
    if (s[i] === "'") {
      let str = '';
      i++;
      while (i < s.length) {
        if (s[i] === "'") {
          if (s[i + 1] === "'") { str += "'"; i += 2; continue; }
          i++; break;
        }
        str += s[i++];
      }
      val = str;
    } else if (/^x'/i.test(s.slice(i, i + 2))) {
      const end = s.indexOf("'", i + 2);
      val = Buffer.from(s.slice(i + 2, end), 'hex');
      i = end + 1;
    } else if (/^null/i.test(s.slice(i, i + 4))) {
      val = null; i += 4;
    } else {
      let j = i;
      while (j < s.length && s[j] !== ',') j++;
      val = Number(s.slice(i, j).trim());
      i = j;
    }
    out.push(val);
  }
  return out;
}
function parseDump(dumpFile) {
  const text = fs.readFileSync(dumpFile, 'utf8');
  const tables = {};          // name -> { columns: [...], rows: [...] }
  const creates = {};
  let hasSequence = false;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    const ci = t.match(/CREATE TABLE (?:IF NOT EXISTS )+"?(\w+)"?/);
    if (ci && ci[1] !== 'sqlite_sequence') creates[ci[1]] = t;
    if (t.startsWith('CREATE TABLE sqlite_sequence')) hasSequence = true;
    const m = t.match(/^INSERT INTO "([^"]+)" \(([^)]+)\) VALUES\((.*)\);$/);
    const name = m ? m[1] : ci && ci[1];
    if (!name) continue;
    if (!name || name === 'sqlite_sequence') { /* sqlite_sequence 若有 INSERT 行按普通表收集 */ }
    if (m && !tables[name]) tables[name] = { columns: [], rows: [], sql: creates[name] || null };
    if (ci && creates[name] && !tables[name]) tables[name] = { columns: [], rows: [], sql: creates[name] };
    if (m) {
      const columns = m[2].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
      tables[name].columns = columns;
      tables[name].sql = tables[name].sql || creates[name] || null;
      tables[name].rows.push(tokenizeValues(m[3]));
    }
  }
  return { tables, hasSequence, text };
}
function tableJson(tables, name) {
  const t = tables[name];
  if (!t) return [];
  return t.rows.map((vals) => {
    const o = {};
    t.columns.forEach((c, i) => { o[c] = vals[i] instanceof Buffer ? '0x' + vals[i].toString('hex') : vals[i]; });
    return o;
  });
}

/* ---------- content-type 猜测 ---------- */
function guessContentType(key) {
  const ext = path.extname(key).toLowerCase();
  const map = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf',
    '.txt': 'text/plain', '.csv': 'text/csv', '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.zip': 'application/zip', '.json': 'application/json',
  };
  return map[ext] || 'application/octet-stream';
}

async function main() {
  const doVerify = process.argv.includes('--verify');
  const stamp = new Date();
  const stampStr = stamp.getFullYear() + String(stamp.getMonth() + 1).padStart(2, '0') +
    String(stamp.getDate()).padStart(2, '0') + '-' + String(stamp.getHours()).padStart(2, '0') +
    String(stamp.getMinutes()).padStart(2, '0') + String(stamp.getSeconds()).padStart(2, '0');
  const staging = path.join(OUT_ROOT, '.staging-' + stampStr);
  const finalDir = path.join(OUT_ROOT, 'export-' + stampStr);
  fs.mkdirSync(staging, { recursive: true });
  fs.mkdirSync(path.join(staging, 'db'), { recursive: true });
  fs.mkdirSync(path.join(staging, 'data'), { recursive: true });
  fs.mkdirSync(path.join(staging, 'files'), { recursive: true });

  const log = (m) => console.log('[export] ' + m);

  // 1. D1 全量官方导出（含 schema + 数据，单时点一致性）
  const dbFile = path.join(staging, 'db', DB_NAME + '.sql');
  log('D1 全量导出（官方工具，一致性快照）...');
  run(['d1', 'export', DB_NAME, '--remote', '-y', '--output', dbFile]);
  const dbStat = fs.statSync(dbFile);
  if (dbStat.size < 500) throw new Error('D1 导出文件过小，疑似失败');

  // 2. 解析 dump → per-table JSON + 行数
  const { tables, hasSequence, text } = parseDump(dbFile);
  const dataFiles = {};
  for (const name of Object.keys(tables)) {
    fs.writeFileSync(path.join(staging, 'data', name + '.json'), JSON.stringify(tableJson(tables, name), null, 1));
    dataFiles[name] = tables[name].rows.length;
  }
  log('表行数：' + JSON.stringify(dataFiles));

  // 3. 从 DB 引用收集 R2 key
  const keySet = new Map(); // key -> content_type 猜测
  for (const t of KEY_SOURCES) {
    const rows = tableJson(tables, t);
    for (const row of rows) {
      for (const col of KEY_COLUMNS) {
        const k = row[col];
        if (k && !keySet.has(k)) keySet.set(k, guessContentType(k));
      }
    }
  }
  log('R2 引用 key 共 ' + keySet.size + ' 个，开始下载...');

  // 4. 逐 key 下载（r2 get 不返回元数据；content-type 仅记录猜测值供恢复参考）
  const r2Entries = [];
  const missing = [];
  for (const [key, ct] of keySet) {
    const dest = path.join(staging, 'files', key);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try {
      run(['r2', 'object', 'get', R2_BUCKET + '/' + key, '--remote', '--file', dest]);
      const buf = fs.readFileSync(dest);
      r2Entries.push({ key, size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), content_type: ct });
    } catch (e) {
      if (/does not exist/i.test(String(e.stderr || e.message))) {
        missing.push(key);
        log('缺失（DB 引用但 R2 无此对象）：' + key);
      } else throw e;
    }
  }
  log('R2 下载完成 ' + r2Entries.length + ' 个，缺失 ' + missing.length + ' 个');

  // 5. manifest
  const manifest = {
    version: 1,
    tool: 'scripts/export-all.cjs',
    created_at: stamp.toISOString(),
    database: { binding: DB_NAME, mode: 'wrangler d1 export --remote (schema+data 一致性快照)' },
    sqlite_sequence_reserved: hasSequence,
    password_hash_included: tables.users ? tables.users.columns.includes('password_hash') : false,
    row_counts: dataFiles,
    r2: { bucket: R2_BUCKET, objects: r2Entries, missing_referenced: missing },
  };
  fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // 6. dump 文件指纹（入 manifest，覆盖 check）
  manifest.files_sha256 = {};
  manifest.files_sha256['db/' + DB_NAME + '.sql'] = sha256(dbFile);
  for (const name of Object.keys(tables)) {
    manifest.files_sha256['data/' + name + '.json'] = sha256(path.join(staging, 'data', name + '.json'));
  }
  fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // 7. 原子切换到最终目录
  fs.renameSync(staging, finalDir);
  console.log('\n=== 导出完成 ===');
  console.log('目录：' + path.relative(ROOT, finalDir));
  console.log('表 ' + Object.keys(dataFiles).length + ' 张 / 行 ' + Object.values(dataFiles).reduce((a, b) => a + b, 0) + ' 条');
  console.log('R2 对象 ' + r2Entries.length + ' 个 / 缺失 ' + missing.length + ' 个');
  const totalBytes = r2Entries.reduce((a, b) => a + b.size, 0) + dbStat.size;
  console.log('总体积：' + (totalBytes / 1024 / 1024).toFixed(2) + ' MB');
  if (manifest.password_hash_included) console.log('注意：导出包含 users.password_hash，目录已在 .gitignore 排除，勿外传。');

  if (doVerify) {
    console.log('\n=== 完整性校验（重新从 R2 下载比对）===');
    let checked = 0, bad = 0;
    for (const e of r2Entries) {
      const tmp = path.join(OUT_ROOT, '._verify_tmp');
      try {
        run(['r2', 'object', 'get', R2_BUCKET + '/' + e.key, '--remote', '--file', tmp]);
        const buf = fs.readFileSync(tmp);
        const h = crypto.createHash('sha256').update(buf).digest('hex');
        if (h !== e.sha256) { console.log('  SHA 不符：' + e.key); bad++; }
      } catch (err) {
        console.log('  下载失败：' + e.key); bad++;
      } finally { try { fs.unlinkSync(tmp); } catch {} }
      checked++;
      if (checked % 20 === 0) log('已核对 ' + checked + '/' + r2Entries.length);
    }
    fs.writeFileSync(path.join(finalDir, 'verify-result.json'), JSON.stringify({ at: new Date().toISOString(), checked, mismatch: bad }, null, 2));
    console.log('校验结果：' + checked + ' 个对象，异常 ' + bad + ' 个' + (bad ? ' ✗' : ' ✓'));
  }
}

main().catch((e) => { console.error('[export] 失败：', e.message || e); process.exit(1); });
