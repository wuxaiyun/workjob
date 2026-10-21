# 方案：全量导出现有已写入资料（含照片/附件/文档）

> 目标：把系统当前所有业务数据 + R2 文件对象完整导出到可离线保存、可恢复的形态。
> 本方案只述设计与现状，经确认后实施。编写时已核对后端代码与生产库计数。

## 一、应用实际状态（已核实，附证据）

### 1. 数据存储分布
| 存储 | 内容 |
|---|---|
| D1 数据库 `equipment-ledger-db`（① 表：users, equipment, repair, photo, attachment, dict, field_config, part_replace, cost, calibration, material, document, import_log, operation_log, backup_log） | 全部业务数据；文件本体不入库，只存对象 key |
| R2 桶 `equipment-ledger-photos` | 照片原图 + 缩略图（photo 表 object_key/thumbnail_key）、附件（attachment.object_key）、文档（document.object_key，如 documents/YYYYMM/uuid.ext）、备份 JSON（backup_log.object_key） |
| Workers 密钥/配置 | JWT_SECRET、FILE_ACCESS_SECRET（不可导出，恢复时无需） |

### 2. 现有导出能力（3 个，互不覆盖）
1. **设备导入导出页**（`worker/src/routes/importExport.ts` + `frontend/src/views/ImportExport.vue`）：仅设备表 xlsx/csv，不含照片与其它任何表。
2. **备份管理「立即备份」**（`worker/src/routes/backup.ts:37-40`）：全库 JSON 到 R2，可下载（链接 15 分钟有效）。**表清单缺失 4 张表**：`material`、`document`、`import_log`、`backup_log`；users 表刻意排除 `password_hash`（`backup.ts:44-46`）。
3. **单文件签名下载**：照片/附件/文档均可经 15 分钟签名链接逐个下载（`photo.ts`/`document.ts`），无批量方式。

### 3. 当前生产数据量（2026-10-21 实测）
users 3、设备 18、维修 5、照片 48（可能还各有缩略图）、材料 1、文档 3、字典 38、检定 0。
R2 估算 < 100MB，量级很小。

## 二、要处理的问题

1. **文件本体无导出通道**：照片/附件/文档在 R2，现有备份 JSON 只有 key，不含文件字节。
2. **备份 JSON 缺表**：material、document、import_log、backup_log 未在备份表清单（`backup.ts:38-39`），「全量备份」名不副实。
3. **15 分钟签名限制**：批量导出不能依赖逐文件签名链接的人工点击。
4. **Worker 运行限制**：免费版单请求 CPU ~30s、内存 128MB——一次性在线打包 zip 需流式实现，属中风险工程。
5. **密码哈希**：线上备份刻意去掉 password_hash（正确）；若做"可完全恢复"的导出则必须包含它，导出文件将成为高敏感物（拿到文件+离线爆破=拿到用户明文密码风险），需明确存放策略。
6. **残留账号** `tmp_export_probe`（disabled，id=3）会被一并导出，建议先删除（一条 D1 DELETE，待你批准）。
7. **恢复侧空白**：目前恢复靠手工 SQL（README 有说明），没有配套恢复工具。

## 三、实现方案（三选一或组合）

### 方案 1｜本地全量导出脚本（推荐立即实施，零线上风险）
新增 `scripts/export-all.cjs`（本地 Node 脚本，用管理员的 wrangler 权限，不触碰生产 Worker）：

**导出步骤**
1. 逐表 `npx.cmd wrangler d1 execute equipment-ledger-db --remote --json --command "SELECT * FROM <表>"`（15 张表全量，含 password_hash）→ 写入 `local-export/<时间戳>/data/<表>.json`。
2. 文件对象：从 DB 行收集所有 R2 key（photo.object_key + thumbnail_key、attachment.object_key、document.object_key），用 `wrangler r2 object get` 逐个下载到 `local-export/<时间戳>/r2/<原key路径>`。
3. 生成 `manifest.json`：每表行数、每文件 sha256、时间、导出者。
4. 产物写入 `.gitignore`（**绝不入库**，密码哈希在文件内）。

**恢复步骤（配套 `scripts/restore-all.cjs`，同一目录内执行）**
1. `wrangler d1 execute --file=restore.sql`（脚本把 data/*.json 合成 SQL）；
2. `wrangler r2 object put` 逐对象回传；
3. 照片/文档 URL 均经 DB 行签名生成，key 不变则在线数据立即恢复可见。

**验证**：导出→本地核对 manifest 与行数/文件数 → （可选）在空 D1/R2 副本上演练恢复。
**风险**：无线上改动；脚本权限=本地管理员 wrangler 权限；产物敏感（含哈希）须本地另存。
**范围外**：网络中途中断 → 重跑即可（写临时目录后原子重命名）。

### 方案 2｜补齐线上备份（小改，建议与方案 1 同步做）
`backup.ts` 表清单加 `material`、`document`（`import_log`/`backup_log` 为运维日志，也建议加）。一行改动，让「数据备份」按钮达到"全库 JSON"。仅数据表仍不含文件字节——作为方案 1 的低配替代/冗余。

### 方案 3｜线上「一键全量 zip」（二期可选，不建议先做）
备份页出包：流式 zip（store 模式，照片不压缩）边读 R2 边输出（TransformStream），文件数量 <100 个、CPU 预算可勉强满足，但：实现量最大、免费版 CPU 临界、失败无断点续传。待方案 1 跑顺、确有"手机上点一下就全量下载"的需求再立项。

## 四、推荐组合与实施顺序

1. 【先批】删除残留账号 `tmp_export_probe`（D1 一条 DELETE）。
2. 【方案 2】backup.ts 补 4 张表（1 行改动 + 部署验证 row_counts）。
3. 【方案 1】export-all.cjs + restore-all.cjs + `.gitignore` 增补 `local-export/`；先做一次基线导出存档。
4. 【二期评估】方案 3 线上 zip。

## 五、待你确认的问题

1. 方案 1 导出**包含 password_hash**（完整可恢复）——是否接受？若不接受则与方案 2 一致（无哈希，恢复后需重置密码）。文件默认存本机，如需"异地存储"建议先 zip+密码加密（方案给出命令但由你自行操作）。
2. 是否同时批准删除 `tmp_export_probe` 残留账号。
3. 方案 3 二期是否立项（当前数据量下收益低）。
