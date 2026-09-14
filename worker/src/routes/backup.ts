import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { ERR, fail, ok, signAccess, verifyAccess } from '../utils';
import { authRequired, adminOnly } from '../middleware';

const ACCESS_TTL = 60 * 60;

// 备份：导出全库业务数据 JSON 到 R2 + 日志（V2.0）
export function backupRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // 文件访问：仅凭签名，直接注册在外层（先于 secured 的 use('*')）
  app.get('/backup/:id/download', async (c) => {
    const id = c.req.param('id');
    const exp = c.req.query('exp') || '';
    const k = c.req.query('k') || '';
    if (!(await verifyAccess(c.env.JWT_SECRET, id, exp, k))) {
      return fail(c, ERR.UNAUTHORIZED, '链接无效或已过期', 401);
    }
    const row = await c.env.DB.prepare(`SELECT * FROM backup_log WHERE id = ?`)
      .bind(Number(id))
      .first<{ id: number; object_key: string; file_name: string }>();
    if (!row) return fail(c, ERR.VALIDATION_ERROR, '备份记录不存在', 404);
    const obj = await c.env.PHOTOS.get(row.object_key);
    if (!obj) return fail(c, ERR.VALIDATION_ERROR, '备份文件不存在', 404);
    return new Response(obj.body, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${row.file_name}"`,
      },
    });
  });

  // POST /api/backup 创建备份（仅管理员）
  app.post('/backup', authRequired(), adminOnly(), async (c) => {
    const user = c.get('user');
    const tables = [
      'users', 'equipment', 'repair', 'photo', 'attachment', 'dict',
      'field_config', 'part_replace', 'cost', 'calibration', 'operation_log',
    ];
    const dump: Record<string, unknown[]> = {};
    for (const t of tables) {
      const { results } = await c.env.DB.prepare(`SELECT * FROM ${t}`).all();
      dump[t] = results;
    }
    const ts = new Date();
    const stamp = `${ts.getFullYear()}${p2(ts.getMonth() + 1)}${p2(ts.getDate())}_${p2(ts.getHours())}${p2(ts.getMinutes())}${p2(ts.getSeconds())}`;
    const fileName = `equipment_backup_${stamp}.json`;
    const objectKey = `backups/${fileName}`;
    const payload = JSON.stringify({ exported_at: new Date().toISOString(), version: 3, data: dump });

    const put = await c.env.PHOTOS.put(objectKey, payload);
    if (!put) return fail(c, ERR.R2_UPLOAD_FAILED, '备份写入 R2 失败');

    const rowCounts = Object.fromEntries(Object.entries(dump).map(([k, v]) => [k, v.length]));
    await c.env.DB.prepare(
      `INSERT INTO backup_log (backup_type, file_name, object_key, row_counts, operator) VALUES ('json', ?, ?, ?, ?)`
    )
      .bind(fileName, objectKey, JSON.stringify(rowCounts), user.username)
      .run();

    return ok(c, { file_name: fileName, row_counts: rowCounts }, '备份完成');
  });

  // GET /api/backup 备份列表（管理员）
  app.get('/backup', authRequired(), adminOnly(), async (c) => {
    const { results } = await c.env.DB.prepare(`SELECT * FROM backup_log ORDER BY id DESC LIMIT 50`).all();
    const now = Math.floor(Date.now() / 1000);
    const items = await Promise.all(results.map(async (r) => ({
      ...r,
      download_url: `/api/backup/${r.id}/download?exp=${now + ACCESS_TTL}&k=${await signAccess(c.env.JWT_SECRET, Number(r.id), now + ACCESS_TTL)}`,
    })));
    return ok(c, items);
  });

  // GET /api/backup/latest （首页展示用）
  app.get('/backup/latest', authRequired(), async (c) => {
    const row = await c.env.DB.prepare(`SELECT id, file_name, row_counts, operator, created_at FROM backup_log ORDER BY id DESC LIMIT 1`).first();
    return ok(c, row || null);
  });

  return app;
}

const p2 = (n: number) => String(n).padStart(2, '0');