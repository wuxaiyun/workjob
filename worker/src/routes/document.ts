import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { ERR, fail, ok, nowString, signAccess, verifyAccess, FILE_ACCESS_TTL, escapeLike } from '../utils';
import { authRequired, adminOnly } from '../middleware';

const MAX_DOC_SIZE = 50 * 1024 * 1024; // 50MB
const pad = (n: number) => String(n).padStart(2, '0');

// 允许的常见文档类型（表格 / Word / PDF / 演示 / 文本 / 图片 / 压缩包）
const ALLOWED_EXTS = new Set([
  'xls', 'xlsx', 'xlsm', 'csv', 'et', 'wps',
  'doc', 'docx', 'pdf', 'ppt', 'pptx', 'txt', 'md', 'rtf',
  'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp',
  'zip', 'rar', '7z', 'tar', 'gz',
]);

type DocumentRow = {
  id: number;
  file_name: string;
};

export function documentRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // ============ 下载：仅凭签名，无需登录（供 <a href> 直接使用） ============
  // GET /api/document/:id/download?exp=&k=
  app.get('/document/:id/download', async (c) => {
    const id = c.req.param('id');
    const exp = c.req.query('exp') || '';
    const k = c.req.query('k') || '';
    if (!(await verifyAccess(c.env.FILE_ACCESS_SECRET, id, exp, k))) {
      return fail(c, ERR.UNAUTHORIZED, '链接无效或已过期', 401);
    }
    const row = await c.env.DB.prepare(`SELECT id, object_key, file_name, mime FROM document WHERE id = ?`)
      .bind(Number(id))
      .first<{ id: number; object_key: string; file_name: string; mime: string | null }>();
    if (!row) return fail(c, ERR.VALIDATION_ERROR, '文档不存在', 404);

    const obj = await c.env.PHOTOS.get(row.object_key);
    if (!obj) return fail(c, ERR.VALIDATION_ERROR, '文件不存在', 404);

    const asciiName = row.file_name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '') || 'document';
    return new Response(obj.body ?? null, {
      headers: {
        'Content-Type': row.mime || obj.httpMetadata?.contentType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
        'Cache-Control': 'private, max-age=900',
      },
    });
  });

  // ============ 业务：逐路由挂鉴权 ============
  // POST /api/document/upload  multipart/form-data: file, title?, category?, remark?
  app.post('/document/upload', authRequired(), async (c) => {
    const user = c.get('user');
    const form = await c.req.formData().catch(() => null);
    if (!form) return fail(c, ERR.VALIDATION_ERROR, '不是 multipart 表单');

    const file = form.get('file');
    if (!file || typeof file === 'string' || file.size === 0) {
      return fail(c, ERR.VALIDATION_ERROR, '未收到文件');
    }
    if (file.size > MAX_DOC_SIZE) {
      return fail(c, ERR.FILE_TOO_LARGE, `文件超过${MAX_DOC_SIZE / 1024 / 1024}MB限制`);
    }

    const fileName = file.name || 'document';
    const ext = (fileName.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (ext && !ALLOWED_EXTS.has(ext)) {
      return fail(c, ERR.FILE_TYPE_NOT_ALLOWED, `不支持的文件类型 .${ext}`);
    }

    const title = (String(form.get('title') || '').trim()) || fileName;
    const category = (String(form.get('category') || '').trim()) || null;
    const remark = (String(form.get('remark') || '').trim()) || null;

    const now = new Date();
    const ym = `${now.getFullYear()}${pad(now.getMonth() + 1)}`;
    const objectKey = `documents/${ym}/${crypto.randomUUID()}${ext ? '.' + ext : ''}`;
    const contentType = file.type || 'application/octet-stream';

    const put = await c.env.PHOTOS.put(objectKey, file.stream(), { httpMetadata: { contentType } });
    if (!put) return fail(c, ERR.R2_UPLOAD_FAILED, '上传 R2 失败');

    const r = await c.env.DB.prepare(
      `INSERT INTO document (title, file_name, ext, mime, size, category, object_key, remark, uploader, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(title, fileName, ext || null, contentType, file.size, category, objectKey, remark, user.username, nowString())
      .run();

    const id = Number(r.meta.last_row_id);
    await c.env.DB.prepare(
      `INSERT INTO operation_log (operator, action, target_table, target_key, new_value)
       VALUES (?, '上传', 'document', ?, ?)`
    )
      .bind(user.username, String(id), JSON.stringify({ title, file_name: fileName, size: file.size }))
      .run();

    return ok(c, { id, object_key: objectKey }, '上传成功');
  });

  // GET /api/document?q=&category=&page=&pageSize=
  app.get('/document', authRequired(), async (c) => {
    const q = (c.req.query('q') || '').trim();
    const category = (c.req.query('category') || '').trim();
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') || '50', 10) || 50));

    const where: string[] = [];
    const bind: unknown[] = [];
    if (q) {
      const like = `%${escapeLike(q)}%`;
      where.push(`(title LIKE ? ESCAPE '\\' OR file_name LIKE ? ESCAPE '\\')`);
      bind.push(like, like);
    }
    if (category) {
      where.push('category = ?');
      bind.push(category);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countRow = await c.env.DB.prepare(`SELECT COUNT(*) AS c FROM document ${whereSql}`)
      .bind(...bind)
      .first<{ c: number }>();

    const { results } = await c.env.DB.prepare(
      `SELECT * FROM document ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`
    )
      .bind(...bind, pageSize, (page - 1) * pageSize)
      .all<DocumentRow & Record<string, unknown>>();

    const now = Math.floor(Date.now() / 1000);
    const exp = now + FILE_ACCESS_TTL;
    const items = await Promise.all(
      results.map(async (d) => ({
        ...d,
        download_url: `/api/document/${d.id}/download?exp=${exp}&k=${await signAccess(c.env.FILE_ACCESS_SECRET, d.id, exp)}`,
      }))
    );

    return ok(c, { items, total: countRow?.c ?? 0, page, pageSize });
  });

  // GET /api/document/categories  已用分类（用于筛选下拉）
  app.get('/document/categories', authRequired(), async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT DISTINCT category FROM document WHERE category IS NOT NULL AND category != '' ORDER BY category`
    ).all<{ category: string }>();
    return ok(c, results.map((r) => r.category));
  });

  // DELETE /api/document/:id（仅管理员；删除 R2 对象 + 数据库记录）
  app.delete('/document/:id', authRequired(), adminOnly(), async (c) => {
    const user = c.get('user');
    const id = Number(c.req.param('id'));
    const row = await c.env.DB.prepare(`SELECT id, object_key, title FROM document WHERE id = ?`)
      .bind(id)
      .first<{ id: number; object_key: string; title: string }>();
    if (!row) return fail(c, ERR.VALIDATION_ERROR, '文档不存在', 404);

    await c.env.DB.prepare(`DELETE FROM document WHERE id = ?`).bind(id).run();
    await c.env.PHOTOS.delete(row.object_key).catch(() => null);
    await c.env.DB.prepare(
      `INSERT INTO operation_log (operator, action, target_table, target_key, old_value)
       VALUES (?, '删除', 'document', ?, ?)`
    )
      .bind(user.username, String(id), JSON.stringify({ title: row.title }))
      .run();

    return ok(c, { id }, '删除成功');
  });

  return app;
}
