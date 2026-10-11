import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { ERR, fail, ok, nowString } from '../utils';
import { authRequired, adminOnly } from '../middleware';

// 个人工具：与设备位号并列的固定使用对象
const PERSONAL_TOOL = '个人工具';

// usage_targets 允许为数组或 JSON 字符串，统一成字符串数组
function normalizeTargets(v: unknown): string[] {
  let arr: unknown[] = [];
  if (Array.isArray(v)) arr = v;
  else if (typeof v === 'string' && v.trim()) {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) arr = parsed;
      else arr = v.split(',');
    } catch {
      arr = v.split(',');
    }
  }
  return [...new Set(arr.map((x) => String(x).trim()).filter(Boolean))];
}

function normalizeStock(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  return n;
}

type MaterialRow = {
  id: number;
  name: string;
  model: string | null;
  usage_targets: string;
  stock: number;
  remark: string | null;
};

function toItem(row: MaterialRow) {
  return {
    ...row,
    usage_targets: normalizeTargets(row.usage_targets),
  };
}

export function materialRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('/material', authRequired());
  app.use('/material/*', authRequired());

  // GET /api/material/equipment-options  用于「使用设备」多选的设备清单（含个人工具）
  app.get('/material/equipment-options', async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT tag_no, name, category FROM equipment WHERE deleted_at IS NULL ORDER BY tag_no`
    ).all();
    return ok(c, { personal_tool: PERSONAL_TOOL, equipment: results });
  });

  // GET /api/material?q=&page=&pageSize=
  app.get('/material', async (c) => {
    const q = (c.req.query('q') || '').trim();
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') || '50', 10) || 50));

    const where: string[] = [];
    const bind: unknown[] = [];
    if (q) {
      where.push('(name LIKE ? OR model LIKE ?)');
      bind.push(`%${q}%`, `%${q}%`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countRow = await c.env.DB.prepare(`SELECT COUNT(*) AS c FROM material ${whereSql}`)
      .bind(...bind)
      .first<{ c: number }>();

    const { results } = await c.env.DB.prepare(
      `SELECT * FROM material ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`
    )
      .bind(...bind, pageSize, (page - 1) * pageSize)
      .all<MaterialRow>();

    return ok(c, {
      items: results.map(toItem),
      total: countRow?.c ?? 0,
      page,
      pageSize,
    });
  });

  // POST /api/material  body: { name, model?, usage_targets?, stock?, remark? }
  app.post('/material', async (c) => {
    const user = c.get('user');
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return fail(c, ERR.VALIDATION_ERROR, '请求体不是合法 JSON');
    }
    const name = String(body.name || '').trim();
    if (!name) return fail(c, ERR.VALIDATION_ERROR, '材料名称不能为空');
    const stock = normalizeStock(body.stock);
    if (stock === null) return fail(c, ERR.VALIDATION_ERROR, '库存必须是整数');
    const targets = normalizeTargets(body.usage_targets);

    const ins = await c.env.DB.prepare(
      `INSERT INTO material (name, model, usage_targets, stock, remark, created_at, updated_at, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        name,
        body.model ? String(body.model).trim() : null,
        JSON.stringify(targets),
        stock,
        body.remark ? String(body.remark).trim() : null,
        nowString(),
        nowString(),
        user.username,
        user.username
      )
      .run();

    const id = Number(ins.meta.last_row_id);
    await c.env.DB.prepare(
      `INSERT INTO operation_log (operator, action, target_table, target_key, new_value)
       VALUES (?, '新增', 'material', ?, ?)`
    )
      .bind(user.username, String(id), JSON.stringify({ name, stock, targets }))
      .run();

    return ok(c, { id }, '新增成功');
  });

  // PUT /api/material/:id
  app.put('/material/:id', async (c) => {
    const user = c.get('user');
    const id = Number(c.req.param('id'));
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return fail(c, ERR.VALIDATION_ERROR, '请求体不是合法 JSON');
    }
    const row = await c.env.DB.prepare(`SELECT id FROM material WHERE id = ?`).bind(id).first();
    if (!row) return fail(c, ERR.VALIDATION_ERROR, '材料不存在', 404);

    const name = String(body.name || '').trim();
    if (!name) return fail(c, ERR.VALIDATION_ERROR, '材料名称不能为空');
    const stock = normalizeStock(body.stock);
    if (stock === null) return fail(c, ERR.VALIDATION_ERROR, '库存必须是整数');
    const targets = normalizeTargets(body.usage_targets);

    await c.env.DB.prepare(
      `UPDATE material SET name = ?, model = ?, usage_targets = ?, stock = ?, remark = ?,
              updated_at = ?, updated_by = ? WHERE id = ?`
    )
      .bind(
        name,
        body.model ? String(body.model).trim() : null,
        JSON.stringify(targets),
        stock,
        body.remark ? String(body.remark).trim() : null,
        nowString(),
        user.username,
        id
      )
      .run();

    await c.env.DB.prepare(
      `INSERT INTO operation_log (operator, action, target_table, target_key, new_value)
       VALUES (?, '修改', 'material', ?, ?)`
    )
      .bind(user.username, String(id), JSON.stringify({ name, stock, targets }))
      .run();

    return ok(c, { id }, '修改成功');
  });

  // PATCH /api/material/:id/stock  body: { delta: 1 } 或 { stock: 20 }（手动加减/直接设定）
  app.patch('/material/:id/stock', async (c) => {
    const user = c.get('user');
    const id = Number(c.req.param('id'));
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return fail(c, ERR.VALIDATION_ERROR, '请求体不是合法 JSON');
    }
    const row = await c.env.DB.prepare(`SELECT id, name, stock FROM material WHERE id = ?`)
      .bind(id)
      .first<{ id: number; name: string; stock: number }>();
    if (!row) return fail(c, ERR.VALIDATION_ERROR, '材料不存在', 404);

    let next: number;
    if (body.delta !== undefined) {
      const delta = Number(body.delta);
      if (!Number.isInteger(delta)) return fail(c, ERR.VALIDATION_ERROR, 'delta 必须是整数');
      next = Number(row.stock) + delta;
    } else if (body.stock !== undefined) {
      const s = normalizeStock(body.stock);
      if (s === null) return fail(c, ERR.VALIDATION_ERROR, '库存必须是整数');
      next = s;
    } else {
      return fail(c, ERR.VALIDATION_ERROR, '缺少 delta 或 stock');
    }
    if (next < 0) return fail(c, ERR.VALIDATION_ERROR, '库存不能小于 0');

    await c.env.DB.prepare(
      `UPDATE material SET stock = ?, updated_at = ?, updated_by = ? WHERE id = ?`
    )
      .bind(next, nowString(), user.username, id)
      .run();

    await c.env.DB.prepare(
      `INSERT INTO operation_log (operator, action, target_table, target_key, field_name, old_value, new_value)
       VALUES (?, '库存变更', 'material', ?, 'stock', ?, ?)`
    )
      .bind(user.username, String(id), String(row.stock), String(next))
      .run();

    return ok(c, { id, stock: next }, '库存已更新');
  });

  // DELETE /api/material/:id（仅管理员）
  app.delete('/material/:id', adminOnly(), async (c) => {
    const user = c.get('user');
    const id = Number(c.req.param('id'));
    const row = await c.env.DB.prepare(`SELECT id, name FROM material WHERE id = ?`)
      .bind(id)
      .first<{ id: number; name: string }>();
    if (!row) return fail(c, ERR.VALIDATION_ERROR, '材料不存在', 404);

    await c.env.DB.prepare(`DELETE FROM material WHERE id = ?`).bind(id).run();
    await c.env.DB.prepare(
      `INSERT INTO operation_log (operator, action, target_table, target_key, old_value)
       VALUES (?, '删除', 'material', ?, ?)`
    )
      .bind(user.username, String(id), JSON.stringify({ name: row.name }))
      .run();

    return ok(c, { id }, '删除成功');
  });

  return app;
}
