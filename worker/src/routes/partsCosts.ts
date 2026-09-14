import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { ERR, fail, ok, isValidDateString } from '../utils';
import { authRequired, adminOnly } from '../middleware';

export function partsCostsRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('/parts', authRequired());
  app.use('/parts/*', authRequired());
  app.use('/costs', authRequired());
  app.use('/costs/*', authRequired());

  // ============ 备件更换 ============
  // GET /api/parts?repair_no=&tag_no=
  app.get('/parts', async (c) => {
    const repairNo = c.req.query('repair_no') || '';
    const tagNo = c.req.query('tag_no') || '';
    let where = '';
    const bind: unknown[] = [];
    if (repairNo) { where = 'WHERE repair_no = ?'; bind.push(repairNo); }
    else if (tagNo) { where = 'WHERE tag_no = ?'; bind.push(tagNo); }
    const { results } = await c.env.DB.prepare(`SELECT * FROM part_replace ${where} ORDER BY id DESC`)
      .bind(...bind)
      .all();
    return ok(c, results);
  });

  // POST /api/parts
  app.post('/parts', async (c) => {
    const user = c.get('user');
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return fail(c, ERR.VALIDATION_ERROR, '请求体不是合法 JSON');
    }
    const repairNo = String(body.repair_no || '').trim();
    const tagNo = String(body.tag_no || '').trim();
    const partName = String(body.part_name || '').trim();
    if (!partName) return fail(c, ERR.VALIDATION_ERROR, '备件名称不能为空');
    if (!repairNo && !tagNo) return fail(c, ERR.VALIDATION_ERROR, '必须关联维修单或设备');

    let replaceDate: string | null = null;
    if (body.replace_date) {
      if (!isValidDateString(String(body.replace_date))) return fail(c, ERR.INVALID_DATE, '更换日期不合法');
      replaceDate = String(body.replace_date);
    }
    const qty = body.part_qty === undefined || body.part_qty === '' ? 1 : Number(body.part_qty);
    const cost = body.cost === undefined || body.cost === '' ? null : Number(body.cost);
    if (Number.isNaN(qty)) return fail(c, ERR.INVALID_NUMBER, '数量必须是数字');
    if (cost !== null && Number.isNaN(cost)) return fail(c, ERR.INVALID_NUMBER, '费用必须是数字');

    await c.env.DB.prepare(
      `INSERT INTO part_replace (repair_no, tag_no, part_name, part_model, part_qty, part_unit, replace_date, cost, remark, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        repairNo || null, tagNo, partName,
        body.part_model ? String(body.part_model).trim() : null, qty,
        body.part_unit ? String(body.part_unit).trim() : null, replaceDate, cost,
        body.remark ? String(body.remark).trim() : null, user.username
      )
      .run();
    return ok(c, {}, '备件登记成功');
  });

  // PUT /api/parts/:id
  app.put('/parts/:id', adminOnly(), async (c) => {
    const id = Number(c.req.param('id'));
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return fail(c, ERR.VALIDATION_ERROR, '请求体不是合法 JSON');
    }
    const fields: string[] = [];
    const params: unknown[] = [];
    for (const key of ['part_name', 'part_model', 'part_unit', 'remark', 'replace_date'] as const) {
      if (body[key] !== undefined) {
        fields.push(`${key} = ?`);
        params.push(String(body[key]).trim());
      }
    }
    if (body.part_qty !== undefined) {
      const q = Number(body.part_qty);
      if (Number.isNaN(q)) return fail(c, ERR.INVALID_NUMBER, '数量必须是数字');
      fields.push('part_qty = ?'); params.push(q);
    }
    if (body.cost !== undefined) {
      const co = Number(body.cost);
      if (Number.isNaN(co)) return fail(c, ERR.INVALID_NUMBER, '费用必须是数字');
      fields.push('cost = ?'); params.push(co);
    }
    if (!fields.length) return fail(c, ERR.VALIDATION_ERROR, '没有要修改的字段');
    params.push(id);
    const r = await c.env.DB.prepare(`UPDATE part_replace SET ${fields.join(', ')} WHERE id = ?`)
      .bind(...params)
      .run();
    if (!r.meta.changes) return fail(c, ERR.VALIDATION_ERROR, '备件记录不存在');
    return ok(c, { id }, '修改成功');
  });

  // DELETE /api/parts/:id
  app.delete('/parts/:id', adminOnly(), async (c) => {
    const id = Number(c.req.param('id'));
    const r = await c.env.DB.prepare(`DELETE FROM part_replace WHERE id = ?`).bind(id).run();
    if (!r.meta.changes) return fail(c, ERR.VALIDATION_ERROR, '备件记录不存在');
    return ok(c, { id }, '删除成功');
  });

  // ============ 费用工时 ============
  // GET /api/costs?repair_no=&tag_no=  （维修人员隐藏金额）
  app.get('/costs', async (c) => {
    const viewer = c.get('user');
    const repairNo = c.req.query('repair_no') || '';
    const tagNo = c.req.query('tag_no') || '';
    let where = '';
    const bind: unknown[] = [];
    if (repairNo) { where = 'WHERE repair_no = ?'; bind.push(repairNo); }
    else if (tagNo) { where = 'WHERE tag_no = ?'; bind.push(tagNo); }
    const { results } = await c.env.DB.prepare(`SELECT * FROM cost ${where} ORDER BY id DESC`)
      .bind(...bind)
      .all();
    const masked = viewer.role !== 'admin' ? results.map((x) => ({ ...x, amount: null })) : results;
    const total = viewer.role === 'admin' ? results.reduce((s: number, x) => s + (Number(x.amount) || 0), 0) : null;
    return ok(c, { items: masked, total });
  });

  // POST /api/costs  （维修人员可登记，金额需正常提交）
  app.post('/costs', async (c) => {
    const user = c.get('user');
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return fail(c, ERR.VALIDATION_ERROR, '请求体不是合法 JSON');
    }
    const costType = String(body.cost_type || '').trim();
    const amount = Number(body.amount);
    if (!costType) return fail(c, ERR.VALIDATION_ERROR, '费用类型不能为空');
    if (Number.isNaN(amount) || amount < 0) return fail(c, ERR.INVALID_NUMBER, '金额不合法');
    const repairNo = String(body.repair_no || '').trim();
    const tagNo = String(body.tag_no || '').trim();
    if (!repairNo && !tagNo) return fail(c, ERR.VALIDATION_ERROR, '必须关联维修单或设备');
    const hours = body.hours === undefined || body.hours === '' ? null : Number(body.hours);
    if (hours !== null && Number.isNaN(hours)) return fail(c, ERR.INVALID_NUMBER, '工时必须是数字');

    await c.env.DB.prepare(
      `INSERT INTO cost (repair_no, tag_no, cost_type, amount, hours, cost_date, remark, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        repairNo || null, tagNo, costType, amount, hours,
        body.cost_date ? String(body.cost_date).trim() : null,
        body.remark ? String(body.remark).trim() : null, user.username
      )
      .run();
    return ok(c, {}, '费用登记成功');
  });

  // PUT /api/costs/:id  （仅管理员）
  app.put('/costs/:id', adminOnly(), async (c) => {
    const id = Number(c.req.param('id'));
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return fail(c, ERR.VALIDATION_ERROR, '请求体不是合法 JSON');
    }
    const fields: string[] = [];
    const params: unknown[] = [];
    for (const key of ['cost_type', 'cost_date', 'remark'] as const) {
      if (body[key] !== undefined) { fields.push(`${key} = ?`); params.push(String(body[key]).trim()); }
    }
    if (body.amount !== undefined) {
      const a = Number(body.amount);
      if (Number.isNaN(a)) return fail(c, ERR.INVALID_NUMBER, '金额不合法');
      fields.push('amount = ?'); params.push(a);
    }
    if (body.hours !== undefined) {
      const h = Number(body.hours);
      if (Number.isNaN(h)) return fail(c, ERR.INVALID_NUMBER, '工时不合法');
      fields.push('hours = ?'); params.push(h);
    }
    if (!fields.length) return fail(c, ERR.VALIDATION_ERROR, '没有要修改的字段');
    params.push(id);
    const r = await c.env.DB.prepare(`UPDATE cost SET ${fields.join(', ')} WHERE id = ?`)
      .bind(...params)
      .run();
    if (!r.meta.changes) return fail(c, ERR.VALIDATION_ERROR, '费用记录不存在');
    return ok(c, { id }, '修改成功');
  });

  // DELETE /api/costs/:id  （仅管理员）
  app.delete('/costs/:id', adminOnly(), async (c) => {
    const id = Number(c.req.param('id'));
    const r = await c.env.DB.prepare(`DELETE FROM cost WHERE id = ?`).bind(id).run();
    if (!r.meta.changes) return fail(c, ERR.VALIDATION_ERROR, '费用记录不存在');
    return ok(c, { id }, '删除成功');
  });

  return app;
}