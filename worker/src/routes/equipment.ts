import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { ERR, fail, ok, isValidDateString, nowString } from '../utils';
import { authRequired, adminOnly } from '../middleware';

// 可编辑字段（tag_no 作为唯一业务索引，不允许通过修改接口变更）
const EDITABLE_FIELDS = [
  'name', 'category', 'project', 'project_no', 'department', 'location', 'model',
  'manufacturer', 'supplier', 'factory_date', 'factory_no', 'commission_date',
  'asset_no', 'original_value', 'net_value', 'is_mandatory', 'verify_valid_until',
  'status', 'remark',
] as const;

type EditableKey = (typeof EDITABLE_FIELDS)[number];

function pickEditable(body: Record<string, unknown>): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  for (const key of EDITABLE_FIELDS) {
    const v = body[key];
    if (v === undefined || v === null) continue;
    if (typeof v === 'string') {
      out[key] = v.trim();
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      out[key] = v;
    } else if (typeof v === 'boolean') {
      out[key] = v ? '1' : '0';
    }
  }
  return out;
}

function escapeLike(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export function equipmentRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', authRequired());

  // ============ 分类专属字段配置（extra_data 动态渲染用） ============
  // GET /api/equipment/category-fields?category=阀门
  app.get('/category-fields', async (c) => {
    const category = c.req.query('category') || '';
    if (!category) return fail(c, ERR.VALIDATION_ERROR, '缺少 category 参数');
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM field_config WHERE category = ? ORDER BY sort_order, id`
    )
      .bind(category)
      .all();
    return ok(c, results);
  });

  // ============ 列表/筛选查询 ============
  // GET /api/equipment?q=&category=&project=&department=&status=&page=&pageSize=
  app.get('/', async (c) => {
    const q = (c.req.query('q') || '').trim();
    const category = (c.req.query('category') || '').trim();
    const project = (c.req.query('project') || '').trim();
    const department = (c.req.query('department') || '').trim();
    const status = (c.req.query('status') || '').trim();
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') || '20', 10) || 20));

    const where: string[] = ['deleted_at IS NULL'];
    const bind: unknown[] = [];
    if (q) {
      const like = `%${escapeLike(q)}%`;
      where.push(`(tag_no LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR model LIKE ? ESCAPE '\\')`);
      bind.push(like, like, like);
    }
    for (const [key, val] of [
      ['category', category],
      ['project', project],
      ['department', department],
      ['status', status],
    ] as const) {
      if (val) {
        where.push(`${key} = ?`);
        bind.push(val);
      }
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countRow = await c.env.DB.prepare(`SELECT COUNT(*) AS c FROM equipment ${whereSql}`)
      .bind(...bind)
      .first<{ c: number }>();
    const total = countRow?.c ?? 0;

    const { results } = await c.env.DB.prepare(
      `SELECT id, tag_no, name, category, project, project_no, department, location,
              model, status, verify_valid_until, created_at, updated_at, version
         FROM equipment ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`
    )
      .bind(...bind, pageSize, (page - 1) * pageSize)
      .all();

    return ok(c, { items: results, total, page, pageSize });
  });

  // ============ 详情（含 extra_data 解析 + 关联照片/维修） ============
  // GET /api/equipment/:tag_no
  app.get('/:tag_no', async (c) => {
    const tagNo = c.req.param('tag_no');
    const row = await c.env.DB.prepare(
      `SELECT * FROM equipment WHERE tag_no = ? AND deleted_at IS NULL`
    )
      .bind(tagNo)
      .first();
    if (!row) return fail(c, ERR.EQUIPMENT_NOT_FOUND, '设备不存在', 404);

    let extraData: Record<string, unknown> | null = null;
    try {
      extraData = row.extra_data ? JSON.parse(row.extra_data as string) : null;
    } catch {
      extraData = null;
    }

    const fieldConfig = await c.env.DB.prepare(
      `SELECT * FROM field_config WHERE category = ? ORDER BY sort_order, id`
    )
      .bind(row.category as string)
      .all();

    const photos = await c.env.DB.prepare(
      `SELECT * FROM photo WHERE tag_no = ? ORDER BY id DESC`
    )
      .bind(tagNo)
      .all();

    const repairs = await c.env.DB.prepare(
      `SELECT * FROM repair WHERE tag_no = ? AND deleted_at IS NULL ORDER BY report_date DESC, id DESC`
    )
      .bind(tagNo)
      .all();

    return ok(c, {
      ...row,
      extra_data: extraData || {},
      field_config: fieldConfig.results,
      photos: photos.results,
      repairs: repairs.results,
    });
  });

  // ============ 新增（完整 / 快速两种模式） ============
  // POST /api/equipment  body: { mode?: 'quick'|'full', ...字段 }
  app.post('/', async (c) => {
    const user = c.get('user');
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return fail(c, ERR.VALIDATION_ERROR, '请求体不是合法 JSON');
    }
    const mode = body.mode === 'quick' ? 'quick' : 'full';
    const tagNo = String(body.tag_no || '').trim();
    const name = String(body.name || '').trim();
    const category = String(body.category || '').trim();
    const project = String(body.project || '').trim();

    if (!tagNo) return fail(c, ERR.VALIDATION_ERROR, '位号不能为空');
    if (!name) return fail(c, ERR.VALIDATION_ERROR, '设备名称不能为空');
    if (!category) return fail(c, ERR.VALIDATION_ERROR, '设备类别不能为空');
    if (mode === 'quick' && !project) {
      return fail(c, ERR.VALIDATION_ERROR, '快速新增需要填写项目');
    }

    for (const key of ['factory_date', 'commission_date', 'verify_valid_until'] as const) {
      const v = body[key];
      if (v && !isValidDateString(String(v))) {
        return fail(c, ERR.INVALID_DATE, `${key} 不是合法日期（YYYY-mm-dd）`);
      }
    }
    for (const key of ['original_value', 'net_value'] as const) {
      const v = body[key];
      if (v !== undefined && v !== null && v !== '' && Number.isNaN(Number(v))) {
        return fail(c, ERR.INVALID_NUMBER, `${key} 必须是数字`);
      }
    }

    const existing = await c.env.DB.prepare(`SELECT id FROM equipment WHERE tag_no = ?`)
      .bind(tagNo)
      .first();
    if (existing) return fail(c, ERR.TAG_ALREADY_EXISTS, '位号已存在');

    const editable = pickEditable({ ...body, name, category, project });
    for (const key of ['original_value', 'net_value'] as const) {
      if (editable[key] !== undefined && editable[key] !== '') {
        editable[key] = Number(editable[key]);
      }
    }
    if (editable.category === undefined) editable.category = category;

    const extraRaw = body.extra_data && typeof body.extra_data === 'object'
      ? JSON.stringify(body.extra_data)
      : null;

    await c.env.DB.prepare(
      `INSERT INTO equipment
        (tag_no, name, category, project, project_no, department, location, model,
         manufacturer, supplier, factory_date, factory_no, commission_date, asset_no,
         original_value, net_value, is_mandatory, verify_valid_until, status, remark,
         extra_data, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        tagNo,
        editable.name ?? name,
        editable.category ?? category,
        editable.project ?? null,
        editable.project_no ?? null,
        editable.department ?? null,
        editable.location ?? null,
        editable.model ?? null,
        editable.manufacturer ?? null,
        editable.supplier ?? null,
        editable.factory_date ?? null,
        editable.factory_no ?? null,
        editable.commission_date ?? null,
        editable.asset_no ?? null,
        editable.original_value ?? null,
        editable.net_value ?? null,
        editable.is_mandatory ?? null,
        editable.verify_valid_until ?? null,
        editable.status ?? '在用',
        editable.remark ?? null,
        extraRaw,
        user.username,
        user.username
      )
      .run();

    await c.env.DB.prepare(
      `INSERT INTO operation_log (operator, action, target_table, target_key, new_value)
       VALUES (?, ?, 'equipment', ?, ?)`
    )
      .bind(user.username, mode === 'quick' ? '快速新增' : '新增', tagNo, JSON.stringify({ name, category }))
      .run();

    return ok(c, { tag_no: tagNo }, '新增成功');
  });

  // ============ 修改（带 version 乐观锁校验） ============
  // PUT /api/equipment/:tag_no  body: { version, ...字段 }
  app.put('/:tag_no', async (c) => {
    const user = c.get('user');
    const tagNo = c.req.param('tag_no');
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return fail(c, ERR.VALIDATION_ERROR, '请求体不是合法 JSON');
    }

    const row = await c.env.DB.prepare(
      `SELECT id, version, tag_no FROM equipment WHERE tag_no = ? AND deleted_at IS NULL`
    )
      .bind(tagNo)
      .first<{ id: number; version: number; tag_no: string }>();
    if (!row) return fail(c, ERR.EQUIPMENT_NOT_FOUND, '设备不存在', 404);

    const clientVersion = Number(body.version);
    if (!Number.isInteger(clientVersion)) {
      return fail(c, ERR.VALIDATION_ERROR, '缺少版本号 version');
    }
    if (clientVersion !== row.version) {
      return fail(c, ERR.VERSION_CONFLICT, `版本冲突：当前数据版本为 v${row.version}，请刷新后重试`, 409);
    }

    for (const key of ['factory_date', 'commission_date', 'verify_valid_until'] as const) {
      const v = body[key];
      if (v && !isValidDateString(String(v))) {
        return fail(c, ERR.INVALID_DATE, `${key} 不是合法日期（YYYY-mm-dd）`);
      }
    }
    for (const key of ['original_value', 'net_value'] as const) {
      const v = body[key];
      if (v !== undefined && v !== null && v !== '' && Number.isNaN(Number(v))) {
        return fail(c, ERR.INVALID_NUMBER, `${key} 必须是数字`);
      }
    }

    const editable = pickEditable(body);
    for (const key of ['original_value', 'net_value'] as const) {
      if (editable[key] !== undefined && editable[key] !== '') {
        editable[key] = Number(editable[key]);
      }
    }
    const extraRaw = body.extra_data && typeof body.extra_data === 'object'
      ? JSON.stringify(body.extra_data)
      : null;
    if (extraRaw) editable.extra_data = extraRaw;

    const sets = EDITABLE_FIELDS.filter((k) => editable[k] !== undefined)
      .map((k) => `${k} = ?`);
    if (extraRaw !== null) sets.push('extra_data = ?');
    sets.push('updated_at = ?', 'updated_by = ?', 'version = version + 1');
    const params: unknown[] = [
      ...EDITABLE_FIELDS.filter((k) => editable[k] !== undefined).map((k) => editable[k]),
      ...(extraRaw !== null ? [extraRaw] : []),
      nowString(),
      user.username,
      tagNo,
      row.version,
    ];

    await c.env.DB.prepare(
      `UPDATE equipment SET ${sets.join(', ')} WHERE tag_no = ? AND version = ?`
    )
      .bind(...params)
      .run();

    await c.env.DB.prepare(
      `INSERT INTO operation_log (operator, action, target_table, target_key, new_value)
       VALUES (?, '修改', 'equipment', ?, ?)`
    )
      .bind(user.username, tagNo, JSON.stringify(editable))
      .run();

    return ok(c, { tag_no: tagNo }, '修改成功');
  });

  // ============ 停用/启用（仅管理员） ============
  // PATCH /api/equipment/:tag_no/status  body: { status }
  app.patch('/:tag_no/status', adminOnly(), async (c) => {
    const user = c.get('user');
    const tagNo = c.req.param('tag_no');
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return fail(c, ERR.VALIDATION_ERROR, '请求体不是合法 JSON');
    }
    const status = String(body.status || '').trim();
    if (!status) return fail(c, ERR.VALIDATION_ERROR, '缺少 status');

    const row = await c.env.DB.prepare(
      `SELECT id FROM equipment WHERE tag_no = ? AND deleted_at IS NULL`
    )
      .bind(tagNo)
      .first();
    if (!row) return fail(c, ERR.EQUIPMENT_NOT_FOUND, '设备不存在', 404);

    await c.env.DB.prepare(
      `UPDATE equipment SET status = ?, updated_at = ?, updated_by = ? WHERE tag_no = ?`
    )
      .bind(status, nowString(), user.username, tagNo)
      .run();

    await c.env.DB.prepare(
      `INSERT INTO operation_log (operator, action, target_table, target_key, old_value, new_value)
       VALUES (?, '状态变更', 'equipment', ?, 'status', ?)`
    )
      .bind(user.username, tagNo, status)
      .run();

    return ok(c, { tag_no: tagNo }, `已${status === '停用' ? '停用' : '更新状态'}`);
  });

  return app;
}