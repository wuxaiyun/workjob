# 全量导出 / 校验 / 恢复操作手册

> 一句话：`scripts/export-all.cjs` 导出，`scripts/verify-all.cjs` 校验，`scripts/restore-all.cjs` 恢复。
> 生产数据（D1 `equipment-ledger-db`、R2 `equipment-ledger-photos`）的任何写操作，除「本地隔离演练」外均需人工授权。

## 1. 导出（只读，随时可跑）

```
node scripts/export-all.cjs              # 导出到 local-export/export-<时间戳>/
node scripts/export-all.cjs --verify     # 导出后逐对象从 R2 重下载比对 SHA-256（较慢）
```

- D1：`wrangler d1 export --remote`（官方一致性快照，含 schema + 数据 + 索引）。
- R2：key 从 DB 引用收集（photo.object_key/thumbnail_key、attachment/document/backup_log.object_key），
  逐个 `wrangler r2 object get --remote` 下载。
- manifest.json：行数、R2 对象 SHA-256/大小、dump/JSON 指纹、引用缺失清单。
- 导出含 `users.password_hash`（已确认始终包含），产物在 `.gitignore` 内，勿外传。
- 已知限制：CLI 无 R2 list，未被 DB 引用的「孤儿对象」无法导出；R2 自定义元数据无法恢复（系统恢复时按类型推断 content-type，无实际影响）。
- 系统使用中导出 = 单时点快照，导出后新产生的数据不在其中（已确认接受）。

实测基线（2026-10-21）：15 业务表 235 行 + 101 个 R2 对象（127.7 MB），缺失 0。

## 2. 校验（只读）

```
node scripts/verify-all.cjs local-export/export-<时间戳>            # 静态：指纹+大小+SHA
node scripts/verify-all.cjs local-export/export-<时间戳> --redownload  # 逐对象从 R2 重下载比对
```

## 3. 恢复 / 演练

```
# 默认 dry-run，不写任何数据
node scripts/restore-all.cjs --from local-export/export-<时间戳>

# 本地隔离演练（写入 --persist-to 临时目录，不碰生产）
node scripts/restore-all.cjs --from <目录> --execute --local --persist-to C:\backup-drill

# 远程隔离库（必须先用 d1 create 新建空库；脚本拒绝指向生产库名）
node scripts/restore-all.cjs --from <目录> --execute --remote --db <新库名> --bucket <新桶名>
```

流程：源完整性预检 → （远程需目标库为空）→ `d1 execute --file` 重放 dump →
`sqlite_sequence` 对齐（条件插入 + UPDATE，防重复行）→ R2 `r2 object put --content-type` →
逐表行数校验。

安全约束：目标库非空即拒绝（`--force-unsafe` 可越权，不建议）；无 DROP/DELETE 业务数据；
R2 同名 key 直接覆盖（仅允许写入新建桶/本地演练目录）。

已实测（本地演练持久化目录）：dump 重放 + 序列恢复正常（AUTOINCREMENT 续增 50）+ 101 对象上传 + 行数全部一致 ✓。

### 生产切换（需人工授权）
1. `wrangler r2 bucket create <新桶>` → 跑恢复脚本；
2. 改 `worker/wrangler.toml`：`d1_databases.database_id`、`r2_buckets.bucket_name`；
3. `npm.cmd run deploy` → 冒烟（登录、设备列表、照片预览、导出 Excel）。
4. 旧库/旧桶保留观察 ≥7 天后再人工处置。

## 4. 现状备注

- 线上「数据备份」页（backup.ts）仅导出部分业务表且不含 password_hash，195 张表内外清单
  与本脚本为两套机制；后续补全 4 张表的改动已列入待办（第二阶段，部署需授权）。
- D1 有 time-travel（`wrangler d1 time-travel --fork`）可作误删时点兜底，演练方法同上。
