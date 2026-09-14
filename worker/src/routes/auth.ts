import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { ERR, fail, ok, hashPassword, signToken, verifyPassword } from '../utils';
import { authRequired, parseExpiresIn } from '../middleware';

export function authRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // POST /api/login
  app.post('/login', async (c) => {
    let body: { username?: string; password?: string };
    try {
      body = await c.req.json();
    } catch {
      return fail(c, ERR.VALIDATION_ERROR, '请求体不是合法 JSON');
    }
    const username = (body.username || '').trim();
    const password = body.password || '';
    if (!username || !password) {
      return fail(c, ERR.VALIDATION_ERROR, '用户名和密码不能为空');
    }

    const user = await c.env.DB.prepare(
      `SELECT id, username, password_hash, role, real_name, status FROM users WHERE username = ?`
    )
      .bind(username)
      .first<{ id: number; username: string; password_hash: string; role: string; real_name: string | null; status: string }>();

    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return fail(c, ERR.UNAUTHORIZED, '用户名或密码错误', 401);
    }
    if (user.status !== 'active') {
      return fail(c, ERR.PERMISSION_DENIED, '账号已被停用', 403);
    }

    const token = await signToken(
      { sub: user.id, username: user.username, role: user.role, real_name: user.real_name },
      c.env.JWT_SECRET,
      parseExpiresIn(c.env.JWT_EXPIRES_IN)
    );

    return ok(c, {
      token,
      user: { id: user.id, username: user.username, role: user.role, real_name: user.real_name },
    }, '登录成功');
  });

  // GET /api/me
  app.get('/me', authRequired(), async (c) => {
    const u = c.get('user');
    return ok(c, { id: u.sub, username: u.username, role: u.role, real_name: u.real_name });
  });

  // PUT /api/me/password  body: { old_password, new_password }
  app.put('/me/password', authRequired(), async (c) => {
    const u = c.get('user');
    let body: { old_password?: string; new_password?: string };
    try {
      body = await c.req.json();
    } catch {
      return fail(c, ERR.VALIDATION_ERROR, '请求体不是合法 JSON');
    }
    const oldPassword = body.old_password || '';
    const newPassword = body.new_password || '';
    if (!oldPassword || !newPassword) {
      return fail(c, ERR.VALIDATION_ERROR, '原密码和新密码不能为空');
    }
    if (newPassword.length < 6) {
      return fail(c, ERR.VALIDATION_ERROR, '新密码长度不能少于 6 位');
    }
    if (newPassword === oldPassword) {
      return fail(c, ERR.VALIDATION_ERROR, '新密码不能与原密码相同');
    }

    const user = await c.env.DB.prepare(`SELECT password_hash FROM users WHERE id = ?`)
      .bind(u.sub)
      .first<{ password_hash: string }>();
    if (!user || !(await verifyPassword(oldPassword, user.password_hash))) {
      return fail(c, ERR.UNAUTHORIZED, '原密码不正确', 401);
    }

    const newHash = await hashPassword(newPassword);
    await c.env.DB.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`)
      .bind(newHash, u.sub)
      .run();

    return ok(c, null, '密码已修改，请重新登录');
  });

  return app;
}