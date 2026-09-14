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

function validateRow(raw: Record<string, unknown>, index: number): { tag_no: string; data: Record<string, unknown> } | { tag_no: string; error: string } {
  const tagNo = String(raw.tag_no || '').trim();
  if (!tagNo) return { tag_no: tagNo, error: '位号为空' };
  const data: Record<string, unknown> = { tag_no: tagNo };
  for (const key of IMPORT_FIELDS) {
    const v = raw[key];
    if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) continue;
    data[key] = typeof v === 'string' ? v.trim() : v;
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
  return { tag_no: tagNo, data };
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
    const tagNos = new Set<string>();
    const validated: { tag_no: string; data: Record<string, unknown>; exists: boolean; error?: string }[] = [];
    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i];
      if (!raw || typeof raw !== 'object') {
        validated.push({ tag_no: '', data: {}, exists: false, error: `第 ${i + 1} 行数据不是对象` });
        continue;
      }
      const r = validateRow(raw as Record<string, unknown>, i);
      if ('error' in r) {
        validated.push({ tag_no: r.tag_no, data: {}, exists: false, error: `第 ${i + 1} 行 ${r.error}` });
        continue;
      }
      if (tagNos.has(r.tag_no)) {
        validated.push({ tag_no: r.tag_no, data: {}, exists: false, error: `第 ${i + 1} 行位号在文件内重复` });
        continue;
      }
      tagNos.add(r.tag_no);
      const existing = await c.env.DB.prepare(
        `SELECT id FROM equipment WHERE tag_no = ?`
      ).bind(r.tag_no).first();
      const exists = !!existing;
      if (mode === 'insert' && exists) {
        validated.push({ tag_no: r.tag_no, data: {}, exists: true, error: '位号已存在' });
        continue;
      }
      validated.push({ tag_no: r.tag_no, data: r.data, exists, error: undefined });
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
          params.push(v.tag_no);
          if (sets.length > 3) {
            await c.env.DB.prepare(`UPDATE equipment SET ${sets.join(', ')} WHERE tag_no = ?`).bind(...params).run();
          }
        } else {
          const cols = Object.keys(v.data);
          const placeholders = cols.map(() => '?').join(', ');
          await c.env.DB.prepare(
            `INSERT INTO equipment (${cols.map((x) => x).join(', ')}, created_by, updated_by)
             VALUES (${placeholders}, ?, ?)`
          )
            .bind(...cols.map((x) => v.data[x] ?? null), user.username, user.username)
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