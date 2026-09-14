import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { ERR, fail, ok } from '../utils';
import { authRequired, adminOnly } from '../middleware';

// 设备类别被哪些表引用（改名需级联，删除需阻止）
const CATEGORY_REF_TABLES = ['equipment', 'field_config'];
const DEPARTMENT_REF_TABLES = ['equipment'];

function refTables(dictType: string): string[] | null {
  if (dictType === '设备类别') return CATEGORY_REF_TABLES;
  if (dictType === '部门') return DEPARTMENT_REF_TABLES;
  return null;
}

// 级联更新引用表中的旧值（历史快照类字段禁止级联：repair 表不改）
async function cascadeRename(db: D1Database, dictType: string, oldValue: string, newValue: string): Promise<void> {
  if (dictType === '设备类别') {
    await db.prepare(`UPDATE equipment SET category = ? WHERE category = ?`).bind(newValue, oldValue).run();
    await db.prepare(`UPDATE field_config SET category = ? WHERE category = ?`).bind(newValue, oldValue).run();
  } else if (dictType === '部门') {
    await db.prepare(`UPDATE equipment SET department = ? WHERE department = ?`).bind(newValue, oldValue).run();
  }
}

export function dictRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('/dicts', authRequired());
  app.use('/dicts/*', authRequired());

  // GET /api/dicts?type=设备类别 （不带 type 返回全部分组）
  app.get('/dicts', async (c) => {
    const type = c.req.query('type') || '';
    if (type) {
      const { results } = await c.env.DB.prepare(
        `SELECT id, dict_type, dict_value FROM dict WHERE dict_type = ? ORDER BY sort_order, id`
      )
        .bind(type)
        .all<{ id: number; dict_type: string; dict_value: string }>();
      return ok(c, { type, items: results.map((r) => ({ id: r.id, value: r.dict_value })) });
    }
    const { results } = await c.env.DB.prepare(
      `SELECT id, dict_type, dict_value FROM dict ORDER BY dict_type, sort_order, id`
    ).all<{ id: number; dict_type: string; dict_value: string }>();
    const grouped: Record<string, string[]> = {};
    for (const r of results) {
      (grouped[r.dict_type] ||= []).push(r.dict_value);
    }
    return ok(c, grouped);
  });

  // POST /api/dicts 新增字典项 body: { dict_type, dict_value, remark? }（仅管理员）
  app.post('/dicts', adminOnly(), async (c) => {
    const user = c.get('user');
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return fail(c, ERR.VALIDATION_ERROR, '请求体不是合法 JSON');
    }
    const dictType = String(body.dict_type || '').trim();
    const dictValue = String(body.dict_value || '').trim();
    if (!dictType || !dictValue) {
      return fail(c, ERR.VALIDATION_ERROR, '字典类型和字典值不能为空');
    }
    const dup = await c.env.DB.prepare(
      `SELECT id FROM dict WHERE dict_type = ? AND dict_value = ?`
    )
      .bind(dictType, dictValue)
      .first();
    if (dup) return fail(c, ERR.VALIDATION_ERROR, `「${dictValue}」已存在`);

    const maxSort = await c.env.DB.prepare(
      `SELECT MAX(sort_order) AS m FROM dict WHERE dict_type = ?`
    )
      .bind(dictType)
      .first<{ m: number | null }>();

    const ins = await c.env.DB.prepare(
      `INSERT INTO dict (dict_type, dict_value, sort_order, remark) VALUES (?, ?, ?, ?)`
    )
      .bind(dictType, dictValue, (maxSort?.m ?? 0) + 1, body.remark ? String(body.remark) : null)
      .run();

    await c.env.DB.prepare(
      `INSERT INTO operation_log (operator, action, target_table, target_key, new_value)
       VALUES (?, '新增', 'dict', ?, ?)`
    )
      .bind(user.username, `${dictType}:${dictValue}`, dictValue)
      .run();

    return ok(c, { id: Number(ins.meta.last_row_id) }, '新增成功');
  });

  // PUT /api/dicts/:id 修改字典值 body: { dict_value }（仅管理员，引用处级联更新）
  app.put('/dicts/:id', adminOnly(), async (c) => {
    const user = c.get('user');
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return fail(c, ERR.VALIDATION_ERROR, '参数错误');

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return fail(c, ERR.VALIDATION_ERROR, '请求体不是合法 JSON');
    }
    const newValue = String(body.dict_value || '').trim();
    if (!newValue) return fail(c, ERR.VALIDATION_ERROR, '字典值不能为空');

    const row = await c.env.DB.prepare(`SELECT id, dict_type, dict_value FROM dict WHERE id = ?`)
      .bind(id)
      .first<{ id: number; dict_type: string; dict_value: string }>();
    if (!row) return fail(c, ERR.VALIDATION_ERROR, '字典项不存在');

    if (row.dict_value === newValue) return ok(c, { id }, '无变更');

    const dup = await c.env.DB.prepare(
      `SELECT id FROM dict WHERE dict_type = ? AND dict_value = ? AND id != ?`
    )
      .bind(row.dict_type, newValue, id)
      .first();
    if (dup) return fail(c, ERR.VALIDATION_ERROR, `「${newValue}」已存在`);

    await c.env.DB.prepare(`UPDATE dict SET dict_value = ? WHERE id = ?`)
      .bind(newValue, id)
      .run();
    await cascadeRename(c.env.DB, row.dict_type, row.dict_value, newValue);

    await c.env.DB.prepare(
      `INSERT INTO operation_log (operator, action, target_table, target_key, old_value, new_value)
       VALUES (?, '修改', 'dict', ?, ?, ?)`
    )
      .bind(user.username, `${row.dict_type}:${newValue}`, row.dict_value, newValue)
      .run();

    return ok(c, { id }, '修改成功');
  });

  // DELETE /api/dicts/:id 删除字典项（仅管理员；被引用则拒绝）
  app.delete('/dicts/:id', adminOnly(), async (c) => {
    const user = c.get('user');
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return fail(c, ERR.VALIDATION_ERROR, '参数错误');

    const row = await c.env.DB.prepare(`SELECT id, dict_type, dict_value FROM dict WHERE id = ?`)
      .bind(id)
      .first<{ id: number; dict_type: string; dict_value: string }>();
    if (!row) return fail(c, ERR.VALIDATION_ERROR, '字典项不存在');

    const tables = refTables(row.dict_type);
    if (tables) {
      for (const table of tables) {
        if (table === 'field_config') {
          const used = await c.env.DB.prepare(
            `SELECT id FROM field_config WHERE category = ? LIMIT 1`
          )
            .bind(row.dict_value)
            .first();
          if (used) return fail(c, ERR.DICT_VALUE_IN_USE, `「${row.dict_value}」已被设备引用，无法删除`);
        } else {
          const col = row.dict_type === '部门' ? 'department' : 'category';
          const used = await c.env.DB.prepare(
            `SELECT id FROM equipment WHERE ${col} = ? LIMIT 1`
          )
            .bind(row.dict_value)
            .first();
          if (used) return fail(c, ERR.DICT_VALUE_IN_USE, `「${row.dict_value}」已被设备引用，无法删除`);
        }
      }
    }

    await c.env.DB.prepare(`DELETE FROM dict WHERE id = ?`).bind(id).run();

    await c.env.DB.prepare(
      `INSERT INTO operation_log (operator, action, target_table, target_key, old_value)
       VALUES (?, '删除', 'dict', ?, ?)`
    )
      .bind(user.username, `${row.dict_type}:${row.dict_value}`, row.dict_value)
      .run();

    return ok(c, { id }, '删除成功');
  });

  return app;
}