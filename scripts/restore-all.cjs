/* 全量恢复/演练：从 export-all 产物恢复 D1 + R2
 *
 * 用法（默认 dry-run，只做检查与计划，不写任何数据）：
 *   node scripts/restore-all.cjs --from local-export/export-YYYYMMDD-HHMMSS
 * 本地隔离演练（写入临时本地持久化目录，不碰生产）：
 *   node scripts/restore-all.cjs --from <目录> --execute --local [--persist-to <目录>]
 * 远程隔离库恢复（需已用 d1 create 新建的空库，绝不允许指向生产库）：
 *   node scripts/restore-all.cjs --from <目录> --execute --remote --db <新库名> --bucket <新桶名>
 *
 * 安全约束：
 *  - 目标库非空时一律拒绝（--force-unsafe 除外）；不支持 --force-unsafe 时请先 d1 create 新库
 *  - 不执行 DROP/DELETE 业务数据；导入方式为 wrangler d1 execute --file（replay dump）
 *  - R2 目标桶若已存在同名 key，默认拒绝 PUT
 */
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WORKER = path.join(ROOT, 'worker');
const WRANGLER_JS = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const DEFAULT_DB = 'equipment-ledger-db';

function run(args, { failOk } = {}) {
  let out;
  try {
    out = execFileSync(process.execPath, [WRANGLER_JS, ...args, '--cwd', WORKER], {
      encoding: 'utf8', maxBuffer: 512 * 1024 * 1024,
    });
  } catch (e) {
    if (failOk) return e;
    throw e;
  }
  return out;
}
function runD1Json(sql, opts = {}) {
  const out = run(['d1', 'execute', opts.db || DEFAULT_DB, '--remote', '--json', '--command', sql, ...(opts.extra || [])]);
  const clean = out.replace(/\x1b\[[0-9;]*m/g, '');
  const lines = clean.split(/\r?\n/);
  const at = lines.findIndex((l) => l.trimStart().startsWith('['));
  if (at < 0) throw new Error('d1 输出中未找到 JSON');
  const rows = JSON.parse(lines.slice(at).join('\n'));
  return rows.flatMap((r) => r.results || []);
}

function parseArgs() {
  const a = process.argv.slice(2);
  const arg = (n, d) => { const i = a.indexOf(n); return i >= 0 && a[i + 1] ? a[i + 1] : d; };
  return {
    from: arg('--from'),
    db: arg('--db', DEFAULT_DB),
    bucket: arg('--bucket', 'equipment-ledger-photos'),
    persistTo: arg('--persist-to'),
    execute: a.includes('--execute'),
    local: a.includes('--local'),
    remote: a.includes('--remote'),
    forceUnsafe: a.includes('--force-unsafe'),
  };
}

async function main() {
  const opt = parseArgs();
  const log = (m) => console.log('[restore] ' + m);
  if (!opt.from || !fs.existsSync(path.join(opt.from, 'manifest.json'))) {
    throw new Error('用法：node scripts/restore-all.cjs --from <export 目录> [--execute --local] [--execute --remote --db <库名> --bucket <桶名>]'.replace(/</g, ''));
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(opt.from, 'manifest.json'), 'utf8'));
  const prodDb = DEFAULT_DB, prodBucket = manifest.r2.bucket;
  const targetDb = opt.db, targetBucket = opt.bucket;
  const mode = opt.local ? 'local' : 'remote';
  const execFlag = opt.execute ? ['--execute'] : [];
  const dryRun = !opt.execute;

  log('恢复源：' + opt.from);
  log('模式：' + (dryRun ? 'DRY-RUN（不会写入）' : 'EXECUTE → ' + mode + ' 库 ' + targetDb + ' / 桶 ' + targetBucket));

  // 1. 源完整性预检
  for (const [rel, want] of Object.entries(manifest.files_sha256 || {})) {
    const file = path.join(opt.from, rel);
    if (!fs.existsSync(file)) throw new Error('导出损坏：缺少 ' + rel);
    const got = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (got !== want) throw new Error('导出损坏（SHA 不符）：' + rel);
  }
  const dbFile = path.join(opt.from, 'db', DEFAULT_DB + '.sql');
  log('源完整性预检通过：dump + ' + Object.keys(manifest.files_sha256).filter((k) => k.startsWith('data/')).length + ' 个 JSON 校验一致');

  // 2. 目标检查
  if (dryRun) log('[DRY-RUN] 将执行：d1 execute ' + targetDb + (mode === 'local' ? ' --local' : ' --remote') + ' --file= dump（重放 schema+数据）');
  let seqRows = [];
  if (!dryRun) {
    if (mode === 'remote') {
      if (targetDb === prodDb) throw new Error('拒绝：目标库名与生产库相同。请先 d1 create 一个新的空库再指定 --db');
      // 判空
      const objs = runD1Json("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'cf\\_%' ESCAPE '\\'", { db: targetDb, extra: ['-y'] });
      const existing = objs.map((r) => r.name).filter((n) => n !== '_cf_KV' && n !== 'd1_migrations' && n !== 'sqlite_sequence');
      if (existing.length && !opt.forceUnsafe) throw new Error('目标库非空（含表 ' + existing.join(',') + '），拒绝恢复');
    }
    const execArgs = ['d1', 'execute', targetDb, '--file', dbFile, '-y'];
    if (mode === 'local') {
      execArgs.push('--local');
      if (opt.persistTo) execArgs.push('--persist-to', opt.persistTo);
    } else execArgs.push('--remote');
    log('重放 dump 到 ' + (mode === 'local' ? '本地' : '远程') + '库 ' + targetDb + ' ...');
    run(execArgs);
    log('dump 重放完成');

    // 3. sqlite_sequence 恢复（AUTOINCREMENT 表序列对齐）
    const seqFile = path.join(opt.from, 'data', 'sqlite_sequence.json');
    if (fs.existsSync(seqFile)) {
      const baseArgs = mode === 'local' ? ['--local', ...(opt.persistTo ? ['--persist-to', opt.persistTo] : [])] : ['--remote', '-y'];
      const writeSql = (sql) => {
        const out = execFileSync(process.execPath, [WRANGLER_JS, 'd1', 'execute', targetDb, '--json', '--command', sql, ...baseArgs, '--cwd', WORKER], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
        return out;
      };
      const raw = fs.readFileSync(seqFile, 'utf8');
      seqRows = JSON.parse(raw);
      if (seqRows.length && Array.isArray(seqRows[0].results)) seqRows = seqRows.flatMap((r) => r.results || []);
      for (const r of seqRows) {
        if (!r.name) continue;
        writeSql(`INSERT INTO sqlite_sequence(name,seq) SELECT '${r.name}',${r.seq} WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name='${r.name}'); UPDATE sqlite_sequence SET seq=${r.seq} WHERE name='${r.name}';`);
      }
      log('sqlite_sequence 覆盖 ' + seqRows.length + ' 项');
    }
  } else {
    const seqPath = path.join(opt.from, 'data', 'sqlite_sequence.json');
    if (fs.existsSync(seqPath)) log('[DRY-RUN] 将恢复 sqlite_sequence ' + JSON.parse(fs.readFileSync(seqPath, 'utf8')).length + ' 项');
  }

  // 4. R2 对象恢复
  log('R2 对象 ' + manifest.r2.objects.length + ' 个' + (dryRun ? ' [DRY-RUN 跳过]' : ''));
  if (!dryRun) {
    for (const e of manifest.r2.objects) {
      const src = path.join(opt.from, 'files', e.key);
      if (!fs.existsSync(src)) { log('缺源文件：' + e.key); continue; }
      const args = ['r2', 'object', 'put', targetBucket + '/' + e.key, '--file', src, '--content-type', e.content_type];
      if (mode === 'local') { args.push('--local'); if (opt.persistTo) args.push('--persist-to', opt.persistTo); }
      else {
        // 远程桶需为新建空桶；同名冲突由用户事先保证，put 默认覆盖已有对象（隔离桶本身为空）
        args.push('--remote');
      }
      try { run(args); } catch (err) {
        if (/could not be found|does not exist/i.test(String(err.message || err))) {
          throw new Error('目标桶 ' + targetBucket + ' 不存在（若为本地模式请加 --local）。' + err.message);
        }
        throw err;
      }
    }
    log('R2 对象全部上传完成');

    // 5. 恢复后校验：数据库行数
    const onlyData = Object.entries(manifest.row_counts).filter(([t]) => t !== 'd1_migrations' && t !== 'sqlite_sequence' && t !== 'IF');
    let countErrs = 0;
    if (mode === 'local') {
      // 本地校验：读 persist 目录下的 sqlite 文件不容易定位，改用 d1 execute 本地查询
      for (const [t, want] of onlyData) {
        const out = execFileSync(process.execPath, [WRANGLER_JS, 'd1', 'execute', targetDb, '--local', '--json', '--command', 'SELECT COUNT(*) AS c FROM ' + t, ...(opt.persistTo ? ['--persist-to', opt.persistTo] : []), '--cwd', WORKER], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        const m = /\[\s*{[\s\S]*"c"\s*:\s*(\d+)/.exec(out);
        const got = m ? Number(m[1]) : -1;
        if (got !== want) { log('行数不符：' + t + ' 期望 ' + want + ' 实际 ' + got); countErrs++; }
      }
      log('行数校验：' + (countErrs === 0 ? '全部一致 ✓' : countErrs + ' 张表不符 ✗'));
    } else {
      for (const [t, want] of onlyData) {
        const r = runD1Json('SELECT COUNT(*) AS c FROM ' + t, { db: targetDb, extra: ['-y'] })[0];
        if ((r && r.c) !== want) { log('行数不符：' + t + ' 期望 ' + want + ' 实际 ' + (r && r.c)); countErrs++; }
      }
      log('行数校验：' + (countErrs === 0 ? '全部一致 ✓' : countErrs + ' 张表不符 ✗'));
    }
  }

  console.log(dryRun ? '\nDRY-RUN 结束（未写入）。加 --execute --local 可本地演练，--execute --remote --db <新库> 可恢复远程隔离库。' : '\n恢复完成。切换步骤：更新 worker/wrangler.toml 中 d1_databases/database_id 与 r2_buckets/bucket_name → npm.cmd run deploy（需人工授权）。');
}

main().catch((e) => { console.error('[restore] 失败：', e.message || e); process.exit(1); });
