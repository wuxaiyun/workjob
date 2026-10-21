import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { ERR, fail, ok, nowString, escapeLike, signAccess, verifyAccess } from '../utils';
import { authRequired, adminOnly } from '../middleware';

// 个人工具：与设备位号并列的固定使用对象
const PERSONAL_TOOL = '个人工具';

// 材料图片限制：仅图片类型，10MB（与照片一致），缩略图可选
const MAX_MAT_IMAGE_SIZE = 10 * 1024 * 1024;
const IMAGE_TTL = 15 * 60;
const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif)$/i;

const pad = (n: number) => String(n).padStart(2, '0');

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

function toItem(row: MaterialRow & { photo_key?: string | null; photo_thumb_key?: string | null }, urls?: { image_url: string | null; thumb_url: string | null }) {
  return {
    id: row.id,
    name: row.name,
    model: row.model,
    usage_targets: normalizeTargets(row.usage_targets),
    stock: row.stock,
    remark: row.remark,
    ...urls,
  };
}

export function materialRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // ============ 图片读取：仅凭签名，无需登录（供 <img> 直接使用）============
  // 必须注册在 authRequired 挂载之前（与 photo.ts 文件路由同理）
  // GET /api/material/:id/image?k=&exp=&t=1
  app.get('/material/:id/image', async (c) => {
    const id = c.req.param('id');
    const exp = c.req.query('exp') || '';
    const k = c.req.query('k') || '';
    const thumb = c.req.query('t') === '1';
    const signId = thumb ? `t${id}` : id;
    if (!(await verifyAccess(c.env.FILE_ACCESS_SECRET, signId, exp, k))) {
      return fail(c, ERR.UNAUTHORIZED, '链接无效或已过期', 401);
    }
    const row = await c.env.DB.prepare(`SELECT id, photo_key, photo_thumb_key FROM material WHERE id = ?`)
      .bind(Number(id))
      .first<{ id: number; photo_key: string | null; photo_thumb_key: string | null }>();
    if (!row || !row.photo_key) return fail(c, ERR.VALIDATION_ERROR, '图片不存在', 404);

    const key = thumb && row.photo_thumb_key ? row.photo_thumb_key : row.photo_key;
    const obj = await c.env.PHOTOS.get(key);
    if (!obj) return fail(c, ERR.VALIDATION_ERROR, '文件不存在', 404);

    return new Response(obj.body ?? null, {
      headers: {
        'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
        'Cache-Control': 'private, max-age=900',
      },
    });
  });

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
      const like = `%${escapeLike(q)}%`;
      where.push(`(name LIKE ? ESCAPE '\\' OR model LIKE ? ESCAPE '\\')`);
      bind.push(like, like);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countRow = await c.env.DB.prepare(`SELECT COUNT(*) AS c FROM material ${whereSql}`)
      .bind(...bind)
      .first<{ c: number }>();

    const { results } = await c.env.DB.prepare(
      `SELECT * FROM material ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`
    )
      .bind(...bind, pageSize, (page - 1) * pageSize)
      .all<MaterialRow & { photo_key: string | null; photo_thumb_key: string | null }>();

    const now = Math.floor(Date.now() / 1000);
    const exp = now + IMAGE_TTL;
    const items = await Promise.all(
      results.map(async (row) => ({
        ...toItem(row, {
          image_url: row.photo_key
            ? `/api/material/${row.id}/image?exp=${exp}&k=${await signAccess(c.env.FILE_ACCESS_SECRET, row.id, exp)}`
            : null,
          thumb_url: row.photo_thumb_key
            ? `/api/material/${row.id}/image?t=1&exp=${exp}&k=${await signAccess(c.env.FILE_ACCESS_SECRET, `t${row.id}`, exp)}`
            : null,
        }),
      }))
    );

    return ok(c, {
      items,
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

    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE material SET name = ?, model = ?, usage_targets = ?, stock = ?, remark = ?,
                updated_at = ?, updated_by = ? WHERE id = ?`
      ).bind(
        name,
        body.model ? String(body.model).trim() : null,
        JSON.stringify(targets),
        stock,
        body.remark ? String(body.remark).trim() : null,
        nowString(),
        user.username,
        id
      ),
      c.env.DB.prepare(
        `INSERT INTO operation_log (operator, action, target_table, target_key, new_value)
         VALUES (?, '修改', 'material', ?, ?)`
      ).bind(user.username, String(id), JSON.stringify({ name, stock, targets })),
    ]);

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

    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE material SET stock = ?, updated_at = ?, updated_by = ? WHERE id = ?`
      ).bind(next, nowString(), user.username, id),
      c.env.DB.prepare(
        `INSERT INTO operation_log (operator, action, target_table, target_key, field_name, old_value, new_value)
         VALUES (?, '库存变更', 'material', ?, 'stock', ?, ?)`
      ).bind(user.username, String(id), String(row.stock), String(next)),
    ]);

    return ok(c, { id, stock: next }, '库存已更新');
  });

  // POST /api/material/:id/image  multipart：file（原图）+ 可选 thumbnail（前端压缩）
  app.post('/material/:id/image', authRequired(), async (c) => {
    const user = c.get('user');
    const id = Number(c.req.param('id'));
    const row = await c.env.DB.prepare(`SELECT id, photo_key, photo_thumb_key FROM material WHERE id = ?`)
      .bind(id)
      .first<{ id: number; photo_key: string | null; photo_thumb_key: string | null }>();
    if (!row) return fail(c, ERR.VALIDATION_ERROR, '材料不存在', 404);

    const form = await c.req.formData().catch(() => null);
    if (!form) return fail(c, ERR.VALIDATION_ERROR, '不是 multipart 表单');
    const file = form.get('file');
    if (!file || typeof file === 'string' || file.size === 0) {
      return fail(c, ERR.VALIDATION_ERROR, '未收到文件');
    }
    if (file.size > MAX_MAT_IMAGE_SIZE) {
      return fail(c, ERR.FILE_TOO_LARGE, `图片超过${MAX_MAT_IMAGE_SIZE / 1024 / 1024}MB限制`);
    }
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!IMAGE_EXT_RE.test('.' + ext)) {
      return fail(c, ERR.FILE_TYPE_NOT_ALLOWED, '仅支持 jpg / png / webp / gif 图片');
    }

    const now = new Date();
    const ym = `${now.getFullYear()}${pad(now.getMonth() + 1)}`;
    const base = `materials/${ym}/${crypto.randomUUID()}`;
    const objectKey = `${base}.${ext}`;

    const put = await c.env.PHOTOS.put(objectKey, file.stream(), { httpMetadata: { contentType: file.type || 'application/octet-stream' } });
    if (!put) return fail(c, ERR.R2_UPLOAD_FAILED, '上传 R2 失败');

    let thumbKey: string | null = null;
    const thumb = form.get('thumbnail');
    if (thumb && typeof thumb !== 'string' && thumb.size > 0) {
      thumbKey = `${base}_thumb.${ext}`;
      await c.env.PHOTOS.put(thumbKey, thumb.stream(), { httpMetadata: { contentType: thumb.type || 'image/jpeg' } });
    }

    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE material SET photo_key = ?, photo_thumb_key = ?, updated_at = ?, updated_by = ? WHERE id = ?`)
        .bind(objectKey, thumbKey, nowString(), user.username, id),
      c.env.DB.prepare(
        `INSERT INTO operation_log (operator, action, target_table, target_key, new_value)
         VALUES (?, '上传图片', 'material', ?, ?)`
      ).bind(user.username, String(id), objectKey),
    ]);

    // 替换旧图：清理被替换的 R2 对象（尽力而为）
    if (row.photo_key) await c.env.PHOTOS.delete(row.photo_key).catch(() => null);
    if (row.photo_thumb_key) await c.env.PHOTOS.delete(row.photo_thumb_key).catch(() => null);

    const exp = Math.floor(now.getTime() / 1000) + IMAGE_TTL;
    return ok(c, {
      id,
      photo_key: objectKey,
      thumb_key: thumbKey,
      image_url: `/api/material/${id}/image?exp=${exp}&k=${await signAccess(c.env.FILE_ACCESS_SECRET, id, exp)}`,
      thumb_url: thumbKey
        ? `/api/material/${id}/image?t=1&exp=${exp}&k=${await signAccess(c.env.FILE_ACCESS_SECRET, `t${id}`, exp)}`
        : null,
    }, '上传成功');
  });

  // DELETE /api/material/:id/image  清除材料图片（R2 对象一并清理）
  app.delete('/material/:id/image', authRequired(), async (c) => {
    const user = c.get('user');
    const id = Number(c.req.param('id'));
    const row = await c.env.DB.prepare(`SELECT id, photo_key, photo_thumb_key FROM material WHERE id = ?`)
      .bind(id)
      .first<{ id: number; photo_key: string | null; photo_thumb_key: string | null }>();
    if (!row || !row.photo_key) return fail(c, ERR.VALIDATION_ERROR, '图片不存在', 404);

    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE material SET photo_key = NULL, photo_thumb_key = NULL, updated_at = ?, updated_by = ? WHERE id = ?`)
        .bind(nowString(), user.username, id),
      c.env.DB.prepare(
        `INSERT INTO operation_log (operator, action, target_table, target_key, old_value)
         VALUES (?, '清除图片', 'material', ?, ?)`
      ).bind(user.username, String(id), row.photo_key),
    ]);
    await c.env.PHOTOS.delete(row.photo_key).catch(() => null);
    if (row.photo_thumb_key) await c.env.PHOTOS.delete(row.photo_thumb_key).catch(() => null);

    return ok(c, { id }, '已清除');
  });

  // DELETE /api/material/:id（仅管理员）
  app.delete('/material/:id', adminOnly(), async (c) => {
    const user = c.get('user');
    const id = Number(c.req.param('id'));
    const row = await c.env.DB.prepare(`SELECT id, name, photo_key, photo_thumb_key FROM material WHERE id = ?`)
      .bind(id)
      .first<{ id: number; name: string; photo_key: string | null; photo_thumb_key: string | null }>();
    if (!row) return fail(c, ERR.VALIDATION_ERROR, '材料不存在', 404);

    await c.env.DB.batch([
      c.env.DB.prepare(`DELETE FROM material WHERE id = ?`).bind(id),
      c.env.DB.prepare(
        `INSERT INTO operation_log (operator, action, target_table, target_key, old_value)
         VALUES (?, '删除', 'material', ?, ?)`
      ).bind(user.username, String(id), JSON.stringify({ name: row.name })),
    ]);
    if (row.photo_key) await c.env.PHOTOS.delete(row.photo_key).catch(() => null);
    if (row.photo_thumb_key) await c.env.PHOTOS.delete(row.photo_thumb_key).catch(() => null);

    return ok(c, { id }, '删除成功');
  });

  return app;
}
