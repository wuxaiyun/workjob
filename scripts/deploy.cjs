/* 一次性完成：前端构建 → 同步静态资源 → wrangler deploy → 记录部署版本
 * 用法：npm.cmd run deploy   （在仓库根目录执行）
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function run(cmd) {
  console.log('> ' + cmd);
  execSync(cmd, { stdio: 'inherit' });
}

run('npm run build -w frontend');
run('node scripts/sync-static.cjs');

console.log('> npx.cmd wrangler deploy --cwd worker');
const out = execSync('npx.cmd wrangler deploy --cwd worker', { encoding: 'utf8' });
process.stdout.write(out);

const m = out.match(/Current Version ID: ([\w-]+)/);
const versionId = m ? m[1] : 'unknown';
const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();

const logFile = path.join(__dirname, '..', 'docs', 'deploy-log.md');
fs.mkdirSync(path.dirname(logFile), { recursive: true });
if (!fs.existsSync(logFile)) {
  fs.writeFileSync(logFile, '# 部署记录\n\n| 时间 (UTC) | Version ID | Commit | 操作人 |\n|---|---|---|---|\n');
}
fs.appendFileSync(logFile, `| ${new Date().toISOString().replace('T', ' ').slice(0, 19)} | ${versionId} | ${commit} | manual |\n`);
console.log('deploy-log 已更新: version=' + versionId + ' commit=' + commit);
