import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { ERR, fail, ok, isValidDateString, nowString } from '../utils';
import { authRequired, adminOnly } from '../middleware';

// 检定：管理员可写，维修人员只读（权限矩阵 V2.0 细化）
export function calibrationRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('/calibration', authRequired());
  app.use('/calibration/*', authRequired());

  // GET /api/calibration?tag_no=&due_before=YYYY-MM-DD&page=
  app.get('/calibration', async (c) => {
    const tagNo = (c.req.query('tag_no') || '').trim();
    const dueBefore = (c.req.query('due_before') || '').trim();
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') || '20', 10) || 20));

    const where: string[] = [];
    const bind: unknown[] = [];
    if (tagNo) { where.push('tag_no = ?'); bind.push(tagNo); }
    if (dueBefore) { where.push('due_date <= ?'); bind.push(dueBefore); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countRow = await c.env.DB.prepare(`SELECT COUNT(*) AS c FROM calibration ${whereSql}`)
      .bind(...bind)
      .first<{ c: number }>();

    const { results } = await c.env.DB.prepare(
      `SELECT c.*, e.name AS equipment_name FROM calibration c
         LEFT JOIN equipment e ON e.tag_no = c.tag_no
         ${whereSql} ORDER BY c.due_date ASC, c.id DESC LIMIT ? OFFSET ?`
    )
      .bind(...bind, pageSize, (page - 1) * pageSize)
      .all();

    return ok(c, { items: results, total: countRow?.c ?? 0, page, pageSize });
  });

  // GET /api/calibration/expiring?days=30  到期提醒
  app.get('/calibration/expiring', async (c) => {
    const days = Math.max(0, parseInt(c.req.query('days') || '30', 10) || 30);
    const today = nowString().slice(0, 10);
    const limit = nowString().slice(0, 10);
    const due = new Date();
    due.setDate(due.getDate() + days);
    const limitDate = `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}`;

    const { results } = await c.env.DB.prepare(
      `SELECT c.*, e.name AS equipment_name, e.verify_valid_until
         FROM calibration c LEFT JOIN equipment e ON e.tag_no = c.tag_no
        WHERE c.due_date <= ? AND c.due_date >= ?
        ORDER BY c.due_date ASC`
    )
      .bind(limitDate, today)
      .all();
    return ok(c, results);
  });

  // GET /api/calibration/due-check 设备 verify_valid_until 到期提醒
  app.get('/calibration/due-check', async (c) => {
    const days = Math.max(0, parseInt(c.req.query('days') || '30', 10) || 30);
    const today = nowString().slice(0, 10);
    const due = new Date();
    due.setDate(due.getDate() + days);
    const limitDate = `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}`;
    const { results } = await c.env.DB.prepare(
      `SELECT tag_no, name, verify_valid_until FROM equipment
        WHERE verify_valid_until IS NOT NULL AND verify_valid_until != ''
          AND verify_valid_until <= ? AND verify_valid_until >= ? AND deleted_at IS NULL
        ORDER BY verify_valid_until ASC`
    )
      .bind(limitDate, today)
      .all();
    return ok(c, results);
  });

  // POST /api/calibration （仅管理员）
  app.post('/calibration', adminOnly(), async (c) => {
    const user = c.get('user');
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return fail(c, ERR.VALIDATION_ERROR, '请求体不是合法 JSON');
    }
    const tagNo = String(body.tag_no || '').trim();
    const dueDate = String(body.due_date || '').trim();
    if (!tagNo) return fail(c, ERR.VALIDATION_ERROR, '位号不能为空');
    if (!isValidDateString(dueDate)) return fail(c, ERR.INVALID_DATE, '到期日不合法');

    const equip = await c.env.DB.prepare(`SELECT id FROM equipment WHERE tag_no = ? AND deleted_at IS NULL`)
      .bind(tagNo)
      .first();
    if (!equip) return fail(c, ERR.EQUIPMENT_NOT_FOUND, '设备不存在', 404);

    await c.env.DB.prepare(
      `INSERT INTO calibration (tag_no, calibration_no, cert_no, done_date, due_date, result, remark, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        tagNo,
        body.calibration_no ? String(body.calibration_no).trim() : null,
        body.cert_no ? String(body.cert_no).trim() : null,
        body.done_date ? String(body.done_date).trim() : null,
        dueDate,
        body.result ? String(body.result).trim() : '待检定',
        body.remark ? String(body.remark).trim() : null,
        user.username
      )
      .run();
    return ok(c, {}, '检定记录创建成功');
  });

  // PUT /api/calibration/:id （仅管理员）
  app.put('/calibration/:id', adminOnly(), async (c) => {
    const id = Number(c.req.param('id'));
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return fail(c, ERR.VALIDATION_ERROR, '请求体不是合法 JSON');
    }
    if (body.due_date && !isValidDateString(String(body.due_date))) {
      return fail(c, ERR.INVALID_DATE, '到期日不合法');
    }
    const fields: string[] = [];
    const params: unknown[] = [];
    for (const key of ['calibration_no', 'cert_no', 'done_date', 'result', 'remark'] as const) {
      if (body[key] !== undefined) { fields.push(`${key} = ?`); params.push(String(body[key]).trim()); }
    }
    if (body.due_date !== undefined) { fields.push('due_date = ?'); params.push(String(body.due_date).trim()); }
    fields.push('updated_at = ?');
    params.push(nowString());
    if (!fields.length) return fail(c, ERR.VALIDATION_ERROR, '没有要修改的字段');
    params.push(id);
    const r = await c.env.DB.prepare(`UPDATE calibration SET ${fields.join(', ')} WHERE id = ?`)
      .bind(...params)
      .run();
    if (!r.meta.changes) return fail(c, ERR.VALIDATION_ERROR, '检定记录不存在');
    return ok(c, { id }, '修改成功');
  });

  // DELETE /api/calibration/:id （仅管理员）
  app.delete('/calibration/:id', adminOnly(), async (c) => {
    const id = Number(c.req.param('id'));
    const r = await c.env.DB.prepare(`DELETE FROM calibration WHERE id = ?`).bind(id).run();
    if (!r.meta.changes) return fail(c, ERR.VALIDATION_ERROR, '检定记录不存在');
    return ok(c, { id }, '删除成功');
  });

  return app;
}

const pad = (n: number) => String(n).padStart(2, '0');