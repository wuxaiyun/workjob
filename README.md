# 设备维修台账系统

基于 Cloudflare Workers（Hono）+ D1 + R2 的单页面设备台账系统：设备台账、维修工单、备件费用、检定提醒、照片/附件/文档管理、材料管理、导入导出、备份、字段自定义、权限（管理员/维修员）。

## 结构

- `frontend/` Vue 3 + Vite 前端
- `worker/` Hono Worker（API + 托管前端静态资源）
- `worker/migrations/` D1 数据库迁移（0001 起按顺序）
- `scripts/deploy.cjs` 一键部署脚本（构建 → 同步 → 部署 → 记录版本）
- `scripts/sync-static.cjs` 同步前端产物到 worker/public
- `docs/deploy-log.md` 部署版本记录（Version ID ↔ commit）

## 本地开发

```powershell
npm install
# Worker 侧会话密钥放在 worker/.dev.vars（不入库）：
#   JWT_SECRET=...
#   FILE_ACCESS_SECRET=...
npm run dev:web
npm run dev:worker
```

初版管理员账号在迁移种子数据中（部署后请立即在「修改密码」页更换）。

## 数据库迁移（远程）

```powershell
npx.cmd wrangler d1 migrations apply equipment-ledger-db --remote --cwd worker
```

## 部署（远程生产）

```powershell
npm.cmd run deploy
```

脚本会自动：构建前端 → 同步到 `worker/public` → `wrangler deploy` → 把 Version ID 与当前 commit 写入 `docs/deploy-log.md`，部署后记得提交该记录。

仅构建不发布：

```powershell
npm.cmd run build:deploy
```

## 回滚

```powershell
npx.cmd wrangler rollback --cwd worker        # 回退到上一个部署版本
```

## 备份与恢复

- 备份入口：管理员页面「备份管理」，导出 JSON 到 R2 `backups/`，可下载（链接 15 分钟有效）。
- 备份内容：全部业务表数据（不含 users 的密码哈希列）。
- 恢复流程（当前为手工操作，恢复前务必先做一次新备份或确认 D1 保留点）：
  1. 下载备份 JSON；
  2. 用 `wrangler d1 execute equipment-ledger-db --remote --file=restore.sql --cwd worker` 写入
     （可参考 `worker/src/routes/backup.ts` 的导出顺序重建各表数据；users 表恢复后需重新设置密码）；
  3. 照片/附件在 R2，按 `photo/attachment_object_key` 对应恢复，一般无需恢复 R2。
- 孤儿对象核查（R2 有对象但 DB 无行）：
  ```sql
  SELECT COUNT(*) FROM photo WHERE object_key IS NULL;
  ```
  （R2 列表无法用 SQL 直接比对，定期用 `wrangler` 或 CF 后台抽查即可。）

## 注意

- 生产密钥仅通过 `wrangler secret put JWT_SECRET / FILE_ACCESS_SECRET` 设置，不写入任何文件。
- `workers_dev = false`，仅自定义域名访问。
