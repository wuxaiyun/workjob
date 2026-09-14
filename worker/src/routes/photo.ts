import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { ERR, fail, ok, signAccess, verifyAccess } from '../utils';
import { authRequired, adminOnly } from '../middleware';

const MAX_PHOTO_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_ATT_SIZE = 30 * 1024 * 1024;   // 30MB
const ACCESS_TTL = 60 * 60;              // 1 小时

const pad = (n: number) => String(n).padStart(2, '0');

async function loadAllowedTypes(db: D1Database, dictType: string): Promise<Set<string>> {
  const { results } = await db.prepare(`SELECT dict_value FROM dict WHERE dict_type = ?`)
    .bind(dictType)
    .all<{ dict_value: string }>();
  return new Set(results.map((r) => r.dict_value));
}

export function photoRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // ============ 文件读取：仅凭签名，无需登录（供 <img>/<a> 直接使用） ============
  // 注意：必须直接注册在外层 app、且在挂载 secured（含 use('*') 中间件）之前，
  //       否则会被 authRequired 拦截。
  // GET /api/photo/:id/file?k=&exp=&t=1
  app.get('/photo/:id/file', async (c) => {
    const id = c.req.param('id');
    const exp = c.req.query('exp') || '';
    const k = c.req.query('k') || '';
    const thumb = c.req.query('t') === '1';
    const signId = thumb ? `t${id}` : id;
    if (!(await verifyAccess(c.env.JWT_SECRET, signId, exp, k))) {
      return fail(c, ERR.UNAUTHORIZED, '链接无效或已过期', 401);
    }
    const row = await c.env.DB.prepare(`SELECT id, object_key, thumbnail_key FROM photo WHERE id = ?`)
      .bind(Number(id))
      .first<{ id: number; object_key: string; thumbnail_key: string | null }>();
    if (!row) return fail(c, ERR.VALIDATION_ERROR, '照片不存在', 404);

    const key = thumb && row.thumbnail_key ? row.thumbnail_key : row.object_key;
    const obj = await c.env.PHOTOS.get(key);
    if (!obj) return fail(c, ERR.VALIDATION_ERROR, '文件不存在', 404);

    return new Response(obj.body ?? null, {
      headers: {
        'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  });

  // GET /api/attachment/:id/file?k=&exp=
  app.get('/attachment/:id/file', async (c) => {
    const id = c.req.param('id');
    const exp = c.req.query('exp') || '';
    const k = c.req.query('k') || '';
    if (!(await verifyAccess(c.env.JWT_SECRET, id, exp, k))) {
      return fail(c, ERR.UNAUTHORIZED, '链接无效或已过期', 401);
    }
    const row = await c.env.DB.prepare(`SELECT id, object_key, file_name FROM attachment WHERE id = ?`)
      .bind(Number(id))
      .first<{ id: number; object_key: string; file_name: string }>();
    if (!row) return fail(c, ERR.VALIDATION_ERROR, '附件不存在', 404);
    const obj = await c.env.PHOTOS.get(row.object_key);
    if (!obj) return fail(c, ERR.VALIDATION_ERROR, '文件不存在', 404);
    return new Response(obj.body, {
      headers: {
        'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${row.file_name.replace(/"/g, '')}"`,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  });

  // ============ 业务：逐路由挂鉴权（不用 use('*')，避免拦截文件签名路由） ============
  // POST /api/upload  multipart/form-data
  app.post('/upload', authRequired(), async (c) => {
    const user = c.get('user');
    const form = await c.req.formData().catch(() => null);
    if (!form) return fail(c, ERR.VALIDATION_ERROR, '不是 multipart 表单');

    const kind = form.get('kind') === 'attachment' ? 'attachment' : 'photo';
    const tagNo = String(form.get('tag_no') || '').trim();
    const repairNo = (String(form.get('repair_no') || '').trim()) || null;
    const type = String(form.get('type') || '').trim();
    const file = form.get('file');

    if (!tagNo) return fail(c, ERR.VALIDATION_ERROR, '位号不能为空');
    if (!file || typeof file === 'string' || file.size === 0) {
      return fail(c, ERR.VALIDATION_ERROR, '未收到文件');
    }
    const allowed = await loadAllowedTypes(c.env.DB, kind === 'photo' ? '照片类型' : '附件类型');
    if (!type) return fail(c, ERR.VALIDATION_ERROR, `${kind === 'photo' ? '照片' : '附件'}类型不能为空`);
    if (!allowed.has(type)) return fail(c, ERR.FILE_TYPE_NOT_ALLOWED, `不允许的类型「${type}」`);

    const maxSize = kind === 'photo' ? MAX_PHOTO_SIZE : MAX_ATT_SIZE;
    if (file.size > maxSize) {
      return fail(c, ERR.FILE_TOO_LARGE, `文件超过${maxSize / 1024 / 1024}MB限制`);
    }

    const equip = await c.env.DB.prepare(`SELECT tag_no FROM equipment WHERE tag_no = ? AND deleted_at IS NULL`)
      .bind(tagNo)
      .first();
    if (!equip) return fail(c, ERR.EQUIPMENT_NOT_FOUND, '设备不存在', 404);

    const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
    const now = new Date();
    const ym = `${now.getFullYear()}${pad(now.getMonth() + 1)}`;
    const uuid = crypto.randomUUID();
    const objectKey = `${kind === 'photo' ? 'photos' : 'attachments'}/${tagNo}/${ym}/${uuid}.${ext}`;
    const contentType = file.type || 'application/octet-stream';

    const put = await c.env.PHOTOS.put(objectKey, file.stream(), { httpMetadata: { contentType } });
    if (!put) return fail(c, ERR.R2_UPLOAD_FAILED, '上传 R2 失败');

    // 缩略图（前端压缩生成后一并上传）
    let thumbKey: string | null = null;
    const thumb = form.get('thumbnail');
    if (kind === 'photo' && thumb && typeof thumb !== 'string' && thumb.size > 0) {
      thumbKey = `${objectKey.substring(0, objectKey.lastIndexOf('.'))}_thumb.${ext}`;
      await c.env.PHOTOS.put(thumbKey, thumb.stream(), { httpMetadata: { contentType: thumb.type || contentType } });
    }

    const fileName = file.name || (kind === 'photo' ? 'photo.jpg' : 'file');
    if (kind === 'photo') {
      const r = await c.env.DB.prepare(
        `INSERT INTO photo (tag_no, repair_no, photo_type, file_name, object_key, thumbnail_key, description, photographer, photo_time, remark)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          tagNo, repairNo, type, fileName, objectKey, thumbKey,
          form.get('description') ? String(form.get('description')).trim() : null,
          form.get('photographer') ? String(form.get('photographer')).trim() : user.username,
          form.get('photo_time') ? String(form.get('photo_time')).trim() : null,
          form.get('remark') ? String(form.get('remark')).trim() : null
        )
        .run();
      const id = Number(r.meta.last_row_id);
      return ok(c, { id, kind, object_key: objectKey }, '上传成功');
    }

    const r = await c.env.DB.prepare(
      `INSERT INTO attachment (tag_no, repair_no, file_type, file_name, object_key, uploader, description, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        tagNo, repairNo, type, fileName, objectKey, user.username,
        form.get('description') ? String(form.get('description')).trim() : null,
        form.get('remark') ? String(form.get('remark')).trim() : null
      )
      .run();
    const id = Number(r.meta.last_row_id);
    return ok(c, { id, kind, object_key: objectKey }, '上传成功');
  });

  // GET /api/photo?tag_no=&repair_no=
  app.get('/photo', authRequired(), async (c) => {
    const tagNo = c.req.query('tag_no') || '';
    const repairNo = c.req.query('repair_no') || '';
    let where = '';
    const bind: unknown[] = [];
    if (repairNo) { where = 'WHERE repair_no = ?'; bind.push(repairNo); }
    else if (tagNo) { where = 'WHERE tag_no = ?'; bind.push(tagNo); }
    else return fail(c, ERR.VALIDATION_ERROR, '缺少 tag_no 或 repair_no');

    const { results } = await c.env.DB.prepare(`SELECT * FROM photo ${where} ORDER BY id DESC`)
      .bind(...bind)
      .all();

    const now = Math.floor(Date.now() / 1000);
    const withUrl = await Promise.all(results.map(async (p) => ({
      ...p,
      image_url: `/api/photo/${p.id}/file?exp=${now + ACCESS_TTL}&k=${await signAccess(c.env.JWT_SECRET, Number(p.id), now + ACCESS_TTL)}`,
      thumb_url: p.thumbnail_key
        ? `/api/photo/${p.id}/file?t=1&exp=${now + ACCESS_TTL}&k=${await signAccess(c.env.JWT_SECRET, `t${Number(p.id)}`, now + ACCESS_TTL)}`
        : null,
    })));
    return ok(c, withUrl);
  });

  // DELETE /api/photo/:id （仅管理员；清除 R2 对象 + 数据库记录）
  app.delete('/photo/:id', authRequired(), adminOnly(), async (c) => {
    const id = Number(c.req.param('id'));
    const row = await c.env.DB.prepare(`SELECT id, object_key, thumbnail_key FROM photo WHERE id = ?`)
      .bind(id)
      .first<{ id: number; object_key: string; thumbnail_key: string | null }>();
    if (!row) return fail(c, ERR.VALIDATION_ERROR, '照片不存在', 404);
    await c.env.DB.prepare(`DELETE FROM photo WHERE id = ?`).bind(id).run();
    await c.env.PHOTOS.delete(row.object_key).catch(() => null);
    if (row.thumbnail_key) await c.env.PHOTOS.delete(row.thumbnail_key).catch(() => null);
    return ok(c, { id }, '删除成功');
  });

  // GET /api/attachment?tag_no=&repair_no=
  app.get('/attachment', authRequired(), async (c) => {
    const tagNo = c.req.query('tag_no') || '';
    const repairNo = c.req.query('repair_no') || '';
    let where = '';
    const bind: unknown[] = [];
    if (repairNo) { where = 'WHERE repair_no = ?'; bind.push(repairNo); }
    else if (tagNo) { where = 'WHERE tag_no = ?'; bind.push(tagNo); }
    else return fail(c, ERR.VALIDATION_ERROR, '缺少 tag_no 或 repair_no');

    const { results } = await c.env.DB.prepare(`SELECT * FROM attachment ${where} ORDER BY id DESC`)
      .bind(...bind)
      .all();
    const now = Math.floor(Date.now() / 1000);
    const withUrl = await Promise.all(results.map(async (a) => ({
      ...a,
      download_url: `/api/attachment/${a.id}/file?exp=${now + ACCESS_TTL}&k=${await signAccess(c.env.JWT_SECRET, Number(a.id), now + ACCESS_TTL)}`,
    })));
    return ok(c, withUrl);
  });

  app.delete('/attachment/:id', authRequired(), adminOnly(), async (c) => {
    const id = Number(c.req.param('id'));
    const row = await c.env.DB.prepare(`SELECT id, object_key FROM attachment WHERE id = ?`)
      .bind(id)
      .first<{ id: number; object_key: string }>();
    if (!row) return fail(c, ERR.VALIDATION_ERROR, '附件不存在', 404);
    await c.env.DB.prepare(`DELETE FROM attachment WHERE id = ?`).bind(id).run();
    await c.env.PHOTOS.delete(row.object_key).catch(() => null);
    return ok(c, { id }, '删除成功');
  });

  return app;
}