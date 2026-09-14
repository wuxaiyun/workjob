import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './types';
import { fail, verifyToken } from './utils';

export function parseExpiresIn(s: string): number {
  const m = /^(\d+)([dhms])$/.exec((s || '7d').trim());
  if (!m) return 7 * 24 * 3600;
  const n = parseInt(m[1], 10);
  const unit = m[2];
  const map: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return n * map[unit];
}

export function authRequired(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = c.req.header('Authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const payload = await verifyToken(token, c.env.JWT_SECRET);
    if (!payload) {
      return fail(c, 'UNAUTHORIZED', '未登录或登录已过期', 401);
    }
    c.set('user', {
      sub: Number(payload.sub),
      username: String(payload.username),
      role: payload.role === 'admin' ? 'admin' : 'worker',
      real_name: payload.real_name ? String(payload.real_name) : null,
    });
    await next();
  };
}

export function adminOnly(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get('user');
    if (user.role !== 'admin') {
      return fail(c, 'PERMISSION_DENIED', '仅管理员可执行此操作', 403);
    }
    await next();
  };
}