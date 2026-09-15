import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { ERR, fail, ok, isValidDateString, nowString } from '../utils';
import { authRequired, adminOnly } from '../middleware';

const IMPORT_FIELDS = [
  'name', 'category', 'project', 'project_no', 'department', 'location', 'model',
  'manufacturer', 'supplier', 'factory_date', 'factory_no', 'commission_date',
  'asset_no', 'original_value', 'net_value', 'is_mandatory', 'verify_valid_until',
  'status', 'remark',
] as const;

// 中文表头 → 设备主表字段（兼容直传中文表头的 CSV/Excel）
const BASE_LABEL_MAP: Record<string, string> = {
  位号: 'tag_no', 设备名称: 'name', 设备类别: 'category', 所属项目: 'project',
  项目编号: 'project_no', 所属部门: 'department', 安装位置: 'location',
  规格型号: 'model', 生产厂家: 'manufacturer', 供应商: 'supplier',
  出厂日期: 'factory_date', 出厂编号: 'factory_no', 投用日期: 'commission_date',
  资产编号: 'asset_no', 原值: 'original_value', 净值: 'net_value',
  是否强检: 'is_mandatory', 强检有效期: 'verify_valid_until', 状态: 'status', 备注: 'remark',
};

type ValidRow = { tag_no: string; data: Record<string, unknown>; extra: Record<string, unknown> };

// 分类专属字段（field_config）：中文标签 → 字段key，写入 equipment.extra_data(JSON)
function validateRow(
  raw: Record<string, unknown>,
  extraMap: Map<string, string>,
  extraKeys: Set<string>
): ValidRow | { tag_no: string; error: string } {
  const tagNo = String(raw.tag_no ?? (raw['位号'] as string | undefined) ?? '').trim();
  if (!tagNo) return { tag_no: tagNo, error: '位号为空' };
  const data: Record<string, unknown> = { tag_no: tagNo };
  const extra: Record<string, unknown> = {};
  for (const [k, rawV] of Object.entries(raw)) {
    if (rawV === undefined || rawV === null || (typeof rawV === 'string' && !rawV.trim())) continue;
    let col = String(k).trim();
    if (col === '位号') continue;
    const mapped = BASE_LABEL_MAP[col];
    if (mapped) col = mapped;
    if (col === 'tag_no') continue;
    const val: unknown = typeof rawV === 'string' ? rawV.trim() : rawV;
    if ((IMPORT_FIELDS as readonly string[]).includes(col)) {
      data[col] = val;
      continue;
    }
    const fk = extraMap.get(col) || (extraKeys.has(col) ? col : null);
    if (fk && fk !== 'tag_no') {
      extra[fk] = val;
      continue;
    }
  }
  if (!data.name) return { tag_no: tagNo, error: '设备名称为空' };
  if (!data.category) return { tag_no: tagNo, error: '设备类别为空' };
  for (const key of ['factory_date', 'commission_date', 'verify_valid_until'] as const) {
    if (data[key] && !isValidDateString(String(data[key]))) return { tag_no: tagNo, error: `${key} 日期不合法` };
  }
  for (const key of ['original_value', 'net_value'] as const) {
    if (data[key] !== undefined && Number.isNaN(Number(data[key]))) return { tag_no: tagNo, error: `${key} 不是数字` };
    if (data[key] !== undefined) data[key] = Number(data[key]);
  }
  return { tag_no: tagNo, data, extra };
}

export function importExportRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('/import/*', authRequired());
  app.use('/export/*', authRequired());

  // ============ 设备导入（预演/执行） ============
  // POST /api/import/equipment  body: { rows: [...], mode: 'insert'|'upsert', dry_run?: boolean }
  //   dry_run=true 只校验不落库，返回预计结果
  app.post('/import/equipment', adminOnly(), async (c) => {
    const user = c.get('user');
    let body: { rows?: unknown[]; mode?: string; dry_run?: boolean; file_name?: string };
    try {
      body = await c.req.json();
    } catch {
      return fail(c, ERR.VALIDATION_ERROR, '请求体不是合法 JSON');
    }
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) return fail(c, ERR.IMPORT_VALIDATION_FAILED, '没有数据行');
    if (rows.length > 5000) return fail(c, ERR.IMPORT_VALIDATION_FAILED, '单次最多导入 5000 行');
    const mode = body.mode === 'upsert' ? 'upsert' : 'insert';
    const dryRun = body.dry_run === true;

    // 校验 + 识别已存在
    // 分类专属字段映射：label → field_key（冗余列会静默忽略）
    const { results: cfgRows } = await c.env.DB.prepare(
      `SELECT DISTINCT field_label, field_key FROM field_config`
    ).all<{ field_label: string; field_key: string }>();
    const extraMap = new Map<string, string>();
    const extraKeys = new Set<string>();
    for (const f of cfgRows) {
      extraKeys.add(f.field_key);
      if (!extraMap.has(f.field_label)) extraMap.set(f.field_label, f.field_key);
    }

    const tagNos = new Set<string>();
    const validated: { tag_no: string; data: Record<string, unknown>; extra: Record<string, unknown>; exists: boolean; error?: string }[] = [];
    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i];
      if (!raw || typeof raw !== 'object') {
        validated.push({ tag_no: '', data: {}, extra: {}, exists: false, error: `第 ${i + 1} 行数据不是对象` });
        continue;
      }
      const r = validateRow(raw as Record<string, unknown>, extraMap, extraKeys);
      if ('error' in r) {
        validated.push({ tag_no: r.tag_no, data: {}, extra: {}, exists: false, error: `第 ${i + 1} 行 ${r.error}` });
        continue;
      }
      if (tagNos.has(r.tag_no)) {
        validated.push({ tag_no: r.tag_no, data: {}, extra: {}, exists: false, error: `第 ${i + 1} 行位号在文件内重复` });
        continue;
      }
      tagNos.add(r.tag_no);
      const existing = await c.env.DB.prepare(
        `SELECT id FROM equipment WHERE tag_no = ?`
      ).bind(r.tag_no).first();
      const exists = !!existing;
      if (mode === 'insert' && exists) {
        validated.push({ tag_no: r.tag_no, data: {}, extra: {}, exists: true, error: '位号已存在' });
        continue;
      }
      validated.push({ tag_no: r.tag_no, data: r.data, extra: r.extra, exists, error: undefined });
    }

    const okRows = validated.filter((v) => !v.error);
    const failRows = validated.filter((v) => v.error);
    const toCreate = okRows.filter((v) => !v.exists);
    const toUpdate = okRows.filter((v) => v.exists);

    let successCount = 0;
    if (!dryRun) {
      for (const v of okRows) {
        if (v.exists) {
          const sets = ['updated_at = ?', 'updated_by = ?', 'version = version + 1'];
          const params: unknown[] = [nowString(), user.username];
          for (const [key, val] of Object.entries(v.data)) {
            if (key === 'tag_no') continue;
            sets.push(`${key} = ?`);
            params.push(val === undefined ? null : val);
          }
          if (Object.keys(v.extra).length) {
            const ex = await c.env.DB.prepare(`SELECT extra_data FROM equipment WHERE tag_no = ?`).bind(v.tag_no).first<{ extra_data?: string | null }>();
            let merged: Record<string, unknown> = {};
            try { merged = ex?.extra_data ? JSON.parse(ex.extra_data as string) : {}; } catch { merged = {}; }
            Object.assign(merged, v.extra);
            sets.push('extra_data = ?');
            params.push(JSON.stringify(merged));
          }
          params.push(v.tag_no);
          if (sets.length > 3) {
            await c.env.DB.prepare(`UPDATE equipment SET ${sets.join(', ')} WHERE tag_no = ?`).bind(...params).run();
          }
        } else {
          const cols = Object.keys(v.data);
          const extraRaw = Object.keys(v.extra).length ? JSON.stringify(v.extra) : null;
          const allCols = cols.concat('extra_data');
          await c.env.DB.prepare(
            `INSERT INTO equipment (${allCols.join(', ')}, created_by, updated_by)
             VALUES (${cols.map(() => '?').concat('?').join(', ')}, ?, ?)`
          )
            .bind(...cols.map((x) => v.data[x] ?? null), extraRaw, user.username, user.username)
            .run();
        }
        successCount++;
      }
      const errorDetail = failRows.length ? JSON.stringify(failRows.map((f) => `${f.error}（位号: ${f.tag_no || '-'}）`)) : null;
      await c.env.DB.prepare(
        `INSERT INTO import_log (import_type, file_name, total_rows, success_rows, fail_rows, error_detail, operator)
         VALUES ('equipment', ?, ?, ?, ?, ?, ?)`
      )
        .bind(body.file_name || 'equipment.xlsx', rows.length, successCount, failRows.length, errorDetail, user.username)
        .run();
    }

    return ok(c, {
      dry_run: dryRun,
      mode,
      total: rows.length,
      pre_created: toCreate.length,
      pre_updated: toUpdate.length,
      success_count: successCount,
      fail_count: failRows.length,
      fails: dryRun ? failRows.map((f) => ({ row: 0, tag_no: f.tag_no, error: f.error })) : null,
    }, dryRun ? '预演完成' : '导入完成');
  });

  // GET /api/import/logs
  app.get('/import/logs', adminOnly(), async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM import_log ORDER BY id DESC LIMIT 50`
    ).all();
    return ok(c, results);
  });

  // ============ 设备导出（返回全量 JSON，前端生成 xlsx/csv） ============
  // GET /api/export/equipment?category=&project=&status=
  app.get('/export/equipment', async (c) => {
    const category = c.req.query('category') || '';
    const project = c.req.query('project') || '';
    const status = c.req.query('status') || '';
    const where: string[] = ['deleted_at IS NULL'];
    const bind: unknown[] = [];
    if (category) { where.push('category = ?'); bind.push(category); }
    if (project) { where.push('project = ?'); bind.push(project); }
    if (status) { where.push('status = ?'); bind.push(status); }
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM equipment ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY tag_no`
    )
      .bind(...bind)
      .all();
    const rows = results.map((r) => {
      let extraData: Record<string, unknown> = {};
      try {
        extraData = r.extra_data ? JSON.parse(r.extra_data as string) : {};
      } catch { /* ignore */ }
      return { ...r, extra_data: undefined, ...extraData };
    });
    return ok(c, rows);
  });

  return app;
}