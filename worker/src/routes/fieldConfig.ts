import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { ERR, fail, ok } from '../utils';
import { authRequired, adminOnly } from '../middleware';

// 字段配置（V2.0 完整维护界面；管理员可写）
export function fieldConfigRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('/field-config', authRequired());
  app.use('/field-config/*', authRequired());

  // GET /api/field-config?category=阀门
  app.get('/field-config', async (c) => {
    const category = c.req.query('category') || '';
    const { results } = category
      ? await c.env.DB.prepare(`SELECT * FROM field_config WHERE category = ? ORDER BY sort_order, id`)
          .bind(category)
          .all()
      : await c.env.DB.prepare(`SELECT * FROM field_config ORDER BY category, sort_order, id`).all();
    return ok(c, results);
  });

  // POST /api/field-config  body: { category, field_key, field_label, group_name?, sort_order?, is_required?, ... }
  app.post('/field-config', adminOnly(), async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return fail(c, ERR.VALIDATION_ERROR, '请求体不是合法 JSON');
    }
    const category = String(body.category || '').trim();
    const fieldKey = String(body.field_key || '').trim();
    const fieldLabel = String(body.field_label || '').trim();
    if (!category || !fieldKey || !fieldLabel) {
      return fail(c, ERR.VALIDATION_ERROR, '类别、字段key、显示名称不能为空');
    }
    const dup = await c.env.DB.prepare(
      `SELECT id FROM field_config WHERE category = ? AND field_key = ?`
    )
      .bind(category, fieldKey)
      .first();
    if (dup) return fail(c, ERR.VALIDATION_ERROR, `「${category}」下已存在字段「${fieldKey}」`);

    await c.env.DB.prepare(
      `INSERT INTO field_config (category, field_key, field_label, group_name, sort_order, is_required, is_visible_list, is_visible_detail, is_visible_export, default_value)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        category, fieldKey, fieldLabel,
        body.group_name ? String(body.group_name).trim() : null,
        body.sort_order !== undefined ? Number(body.sort_order) : 0,
        body.is_required ? String(body.is_required).trim() : '0',
        body.is_visible_list ? String(body.is_visible_list).trim() : '0',
        body.is_visible_detail !== undefined ? String(body.is_visible_detail).trim() : '1',
        body.is_visible_export !== undefined ? String(body.is_visible_export).trim() : '1',
        body.default_value ? String(body.default_value).trim() : null
      )
      .run();
    return ok(c, {}, '字段配置创建成功');
  });

  // PUT /api/field-config/:id
  app.put('/field-config/:id', adminOnly(), async (c) => {
    const id = Number(c.req.param('id'));
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return fail(c, ERR.VALIDATION_ERROR, '请求体不是合法 JSON');
    }
    const fields: string[] = [];
    const params: unknown[] = [];
    for (const key of ['field_key', 'field_label', 'group_name', 'is_required', 'is_visible_list', 'is_visible_detail', 'is_visible_export', 'default_value'] as const) {
      if (body[key] !== undefined) { fields.push(`${key} = ?`); params.push(String(body[key])); }
    }
    if (body.sort_order !== undefined) { fields.push('sort_order = ?'); params.push(Number(body.sort_order)); }
    if (!fields.length) return fail(c, ERR.VALIDATION_ERROR, '没有要修改的字段');
    params.push(id);
    const r = await c.env.DB.prepare(`UPDATE field_config SET ${fields.join(', ')} WHERE id = ?`)
      .bind(...params)
      .run();
    if (!r.meta.changes) return fail(c, ERR.VALIDATION_ERROR, '配置不存在');
    return ok(c, { id }, '修改成功');
  });

  // DELETE /api/field-config/:id
  app.delete('/field-config/:id', adminOnly(), async (c) => {
    const id = Number(c.req.param('id'));
    const r = await c.env.DB.prepare(`DELETE FROM field_config WHERE id = ?`).bind(id).run();
    if (!r.meta.changes) return fail(c, ERR.VALIDATION_ERROR, '配置不存在');
    return ok(c, { id }, '删除成功');
  });

  return app;
}