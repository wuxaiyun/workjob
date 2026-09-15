import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { ERR, fail, ok, hashPassword, nowString } from '../utils';
import { authRequired, adminOnly } from '../middleware';

// 用户管理（仅管理员）：列表 / 新增 / 修改角色·姓名·状态 / 重置密码
export function userRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('/users', authRequired());
  app.use('/users/*', authRequired());

  // GET /api/users
  app.get('/users', adminOnly(), async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT id, username, role, real_name, status, created_at FROM users ORDER BY id`
    ).all();
    return ok(c, results);
  });

  // POST /api/users  body: { username, password, role, real_name? }
  app.post('/users', adminOnly(), async (c) => {
    const op = c.get('user');
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return fail(c, ERR.VALIDATION_ERROR, '请求体不是合法 JSON');
    }
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const role = String(body.role || '').trim();
    const realName = String(body.real_name || '').trim();
    if (!username || !password) return fail(c, ERR.VALIDATION_ERROR, '用户名和密码不能为空');
    if (password.length < 6) return fail(c, ERR.VALIDATION_ERROR, '密码长度不能少于 6 位');
    if (role !== 'admin' && role !== 'worker') return fail(c, ERR.VALIDATION_ERROR, '角色只能是 admin 或 worker');

    const dup = await c.env.DB.prepare(`SELECT id FROM users WHERE username = ?`).bind(username).first();
    if (dup) return fail(c, ERR.VALIDATION_ERROR, '用户名已存在');

    const hash = await hashPassword(password);
    const ins = await c.env.DB.prepare(
      `INSERT INTO users (username, password_hash, role, real_name, created_at) VALUES (?, ?, ?, ?, ?)`
    )
      .bind(username, hash, role, realName || null, nowString())
      .run();

    await c.env.DB.prepare(
      `INSERT INTO operation_log (operator, action, target_table, target_key, new_value)
       VALUES (?, '新增', 'users', ?, ?)`
    )
      .bind(op.username, username, JSON.stringify({ role, real_name: realName }))
      .run();

    return ok(c, { id: Number(ins.meta.last_row_id), username }, '用户创建成功');
  });

  // PUT /api/users/:id  body: { role?, real_name?, status? }  status: active|disabled
  app.put('/users/:id', adminOnly(), async (c) => {
    const op = c.get('user');
    const id = Number(c.req.param('id'));
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return fail(c, ERR.VALIDATION_ERROR, '请求体不是合法 JSON');
    }
    const target = await c.env.DB.prepare(`SELECT id, role, status FROM users WHERE id = ?`)
      .bind(id)
      .first<{ id: number; role: string; status: string }>();
    if (!target) return fail(c, 'USER_NOT_FOUND', '用户不存在', 404);

    const fields: string[] = [];
    const params: unknown[] = [];
    if (body.role !== undefined) {
      const role = String(body.role).trim();
      if (role !== 'admin' && role !== 'worker') return fail(c, ERR.VALIDATION_ERROR, '角色只能是 admin 或 worker');
      fields.push('role = ?');
      params.push(role);
    }
    if (body.real_name !== undefined) {
      fields.push('real_name = ?');
      params.push(String(body.real_name).trim() || null);
    }
    if (body.status !== undefined) {
      const status = String(body.status).trim();
      if (status !== 'active' && status !== 'disabled') return fail(c, ERR.VALIDATION_ERROR, '状态只能是 active 或 disabled');
      fields.push('status = ?');
      params.push(status);
    }

    const willBeWorker = body.role !== undefined && String(body.role).trim() !== 'admin';
    const willDisableSelf = body.status !== undefined && String(body.status).trim() !== 'active' && id === op.sub;
    if (id === op.sub && (willBeWorker || willDisableSelf)) {
      return fail(c, ERR.PERMISSION_DENIED, '不能修改自己的角色或停用自己的账号', 403);
    }
    if (target.role === 'admin' && willBeWorker) {
      const cnt = await c.env.DB.prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND status = 'active'`)
        .first<{ c: number }>();
      if (cnt && cnt.c <= 1) return fail(c, ERR.PERMISSION_DENIED, '系统至少保留一个管理员', 403);
    }

    if (!fields.length) return fail(c, ERR.VALIDATION_ERROR, '没有要修改的字段');
    params.push(id);
    const r = await c.env.DB.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`)
      .bind(...params)
      .run();
    if (!r.meta.changes) return fail(c, 'USER_NOT_FOUND', '用户不存在', 404);

    await c.env.DB.prepare(
      `INSERT INTO operation_log (operator, action, target_table, target_key, new_value)
       VALUES (?, '编辑', 'users', ?, ?)`
    )
      .bind(op.username, String(id), JSON.stringify(body))
      .run();

    return ok(c, { id }, '用户已更新');
  });

  // PUT /api/users/:id/password  body: { password }
  app.put('/users/:id/password', adminOnly(), async (c) => {
    const op = c.get('user');
    const id = Number(c.req.param('id'));
    let body: { password?: string };
    try {
      body = await c.req.json();
    } catch {
      return fail(c, ERR.VALIDATION_ERROR, '请求体不是合法 JSON');
    }
    const password = String(body.password || '');
    if (password.length < 6) return fail(c, ERR.VALIDATION_ERROR, '密码长度不能少于 6 位');

    const target = await c.env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(id).first();
    if (!target) return fail(c, 'USER_NOT_FOUND', '用户不存在', 404);

    const hash = await hashPassword(password);
    await c.env.DB.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`)
      .bind(hash, id)
      .run();

    await c.env.DB.prepare(
      `INSERT INTO operation_log (operator, action, target_table, target_key, new_value)
       VALUES (?, '重置密码', 'users', ?, '***')`
    )
      .bind(op.username, String(id))
      .run();

    return ok(c, { id }, '密码已重置');
  });

  return app;
}