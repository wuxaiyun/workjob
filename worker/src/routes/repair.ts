import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { ERR, fail, ok, isValidDateString, nowString, nextRepairNo } from '../utils';
import { authRequired, adminOnly } from '../middleware';

// 维修状态字典值（用于权限判断：终端状态不可再被维修人员修改）
const TERMINAL_STATUS = new Set(['已完成', '已关闭']);

const EDITABLE = [
  'report_date', 'repair_date', 'repair_type', 'status', 'worker',
  'fault_desc', 'cause', 'repair_content', 'action', 'remark',
] as const;
type EditableKey = (typeof EDITABLE)[number];

function pick(body: Record<string, unknown>): Partial<Record<EditableKey, string>> {
  const out: Partial<Record<EditableKey, string>> = {};
  for (const key of EDITABLE) {
    const v = body[key];
    if (v === undefined || v === null) continue;
    out[key] = typeof v === 'string' ? v.trim() : String(v);
  }
  return out;
}

export function repairRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', authRequired());

  // ============ 列表查询 ============
  // GET /api/repair?tag_no=&status=&worker=&page=&pageSize=
  app.get('/', async (c) => {
    const tagNo = (c.req.query('tag_no') || '').trim();
    const status = (c.req.query('status') || '').trim();
    const repairNo = (c.req.query('repair_no') || '').trim();
    const q = (c.req.query('q') || '').trim();
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') || '20', 10) || 20));

    const where: string[] = ['deleted_at IS NULL'];
    const bind: unknown[] = [];
    if (tagNo) { where.push('tag_no = ?'); bind.push(tagNo); }
    if (status) { where.push('status = ?'); bind.push(status); }
    if (repairNo) { where.push('repair_no = ?'); bind.push(repairNo); }
    if (q) {
      where.push('(repair_no LIKE ? OR tag_no LIKE ? OR fault_desc LIKE ?)');
      bind.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countRow = await c.env.DB.prepare(`SELECT COUNT(*) AS c FROM repair ${whereSql}`)
      .bind(...bind)
      .first<{ c: number }>();

    const { results } = await c.env.DB.prepare(
      `SELECT id, repair_no, tag_no, equipment_name_snapshot, project_snapshot, department_snapshot,
              report_date, repair_date, repair_type, status, worker, fault_desc, cause,
              repair_content, remark, version, created_by, created_at, updated_at
         FROM repair ${whereSql} ORDER BY report_date DESC, id DESC LIMIT ? OFFSET ?`
    )
      .bind(...bind, pageSize, (page - 1) * pageSize)
      .all();

    return ok(c, { items: results, total: countRow?.c ?? 0, page, pageSize });
  });

  // ============ 详情（含快照、备件、费用、照片） ============
  app.get('/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const row = await c.env.DB.prepare(
      `SELECT * FROM repair WHERE id = ? AND deleted_at IS NULL`
    )
      .bind(id)
      .first();
    if (!row) return fail(c, ERR.REPAIR_NOT_FOUND, '维修记录不存在', 404);

    const parts = await c.env.DB.prepare(
      `SELECT * FROM part_replace WHERE repair_no = ? ORDER BY id`
    )
      .bind(row.repair_no as string)
      .all();
    const costs = await c.env.DB.prepare(
      `SELECT * FROM cost WHERE repair_no = ? ORDER BY id`
    )
      .bind(row.repair_no as string)
      .all();
    const photos = await c.env.DB.prepare(
      `SELECT * FROM photo WHERE repair_no = ? ORDER BY id`
    )
      .bind(row.repair_no as string)
      .all();

    // 维修人员看不到费用金额（权限矩阵细化）
    const viewer = c.get('user');
    let costData = costs.results;
    let costTotal: number | null = null;
    if (viewer.role !== 'admin') {
      costData = costs.results.map((x) => ({ ...x, amount: null }));
      costTotal = null;
    } else {
      costTotal = costs.results.reduce((s: number, x) => s + (Number(x.amount) || 0), 0);
    }

    return ok(c, {
      ...row,
      parts: parts.results,
      costs: costData,
      cost_total: costTotal,
      photos: photos.results,
    });
  });

  // ============ 新增维修记录（自动生成单号 + 历史快照） ============
  app.post('/', async (c) => {
    const user = c.get('user');
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return fail(c, ERR.VALIDATION_ERROR, '请求体不是合法 JSON');
    }

    const tagNo = String(body.tag_no || '').trim();
    const reportDate = String(body.report_date || '').trim();
    const repairType = String(body.repair_type || '').trim();
    const faultDesc = String(body.fault_desc || '').trim();
    const repairContent = String(body.repair_content || '').trim();
    if (!tagNo) return fail(c, ERR.VALIDATION_ERROR, '位号不能为空');
    if (!isValidDateString(reportDate)) return fail(c, ERR.INVALID_DATE, '报修日期不合法（YYYY-mm-dd）');
    if (!repairType) return fail(c, ERR.VALIDATION_ERROR, '维修类别不能为空');
    if (!faultDesc) return fail(c, ERR.VALIDATION_ERROR, '故障现象不能为空');
    if (!repairContent) return fail(c, ERR.VALIDATION_ERROR, '维修内容不能为空');

    const equip = await c.env.DB.prepare(
      `SELECT tag_no, name, project, department, location FROM equipment WHERE tag_no = ? AND deleted_at IS NULL`
    )
      .bind(tagNo)
      .first<{ tag_no: string; name: string; project: string | null; department: string | null; location: string | null }>();
    if (!equip) return fail(c, ERR.EQUIPMENT_NOT_FOUND, '设备不存在', 404);

    // 可选字段中带快照的（photo upload 阶段在 repair 创建前时无需，创建后再传）
    const repairNo = await nextRepairNo(c.env.DB);
    const status = String(body.status || '待处理').trim();
    const worker = String(body.worker || user.real_name || user.username).trim();

    const ins = await c.env.DB.prepare(
      `INSERT INTO repair
        (repair_no, tag_no, equipment_name_snapshot, project_snapshot, department_snapshot, location_snapshot,
         report_date, repair_date, repair_type, status, worker, fault_desc, cause,
         repair_content, action, remark, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        repairNo, tagNo, equip.name, equip.project ?? null, equip.department ?? null, equip.location ?? null,
        reportDate, body.repair_date ? String(body.repair_date).trim() : null, repairType, status, worker,
        faultDesc, body.cause ? String(body.cause).trim() : null,
        repairContent, body.action ? String(body.action).trim() : null,
        body.remark ? String(body.remark).trim() : null, user.username
      )
      .run();

    await c.env.DB.prepare(
      `INSERT INTO operation_log (operator, action, target_table, target_key, new_value)
       VALUES (?, '新增', 'repair', ?, ?)`
    )
      .bind(user.username, repairNo, JSON.stringify({ tag_no: tagNo, fault_desc: faultDesc }))
      .run();

    return ok(c, { repair_no: repairNo, id: Number(ins.meta.last_row_id) }, '维修记录创建成功');
  });

  // ============ 修改（version 乐观锁 + 角色权限） ============
  // 维修人员仅能改自己录入、且未关闭/未完成的工单；管理员任意
  app.put('/:id', async (c) => {
    const user = c.get('user');
    const id = Number(c.req.param('id'));
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return fail(c, ERR.VALIDATION_ERROR, '请求体不是合法 JSON');
    }

    const row = await c.env.DB.prepare(`SELECT * FROM repair WHERE id = ? AND deleted_at IS NULL`)
      .bind(id)
      .first<{ id: number; version: number; created_by: string; status: string; repair_no: string }>();
    if (!row) return fail(c, ERR.REPAIR_NOT_FOUND, '维修记录不存在', 404);

    const clientVersion = Number(body.version);
    if (!Number.isInteger(clientVersion)) return fail(c, ERR.VALIDATION_ERROR, '缺少版本号 version');
    if (clientVersion !== row.version) {
      return fail(c, ERR.VERSION_CONFLICT, `版本冲突：当前版本 v${row.version}，请刷新后重试`, 409);
    }

    if (user.role !== 'admin') {
      const own = row.created_by === user.username;
      const closed = TERMINAL_STATUS.has(row.status);
      if (!own || closed) {
        return fail(c, ERR.PERMISSION_DENIED, '只能修改本人录入且未完成/未关闭的工单', 403);
      }
    }

    const upd = pick(body);
    if (upd.report_date !== undefined && !isValidDateString(upd.report_date)) {
      return fail(c, ERR.INVALID_DATE, '报修日期不合法');
    }
    if (upd.repair_date !== undefined && upd.repair_date && !isValidDateString(upd.repair_date)) {
      return fail(c, ERR.INVALID_DATE, '维修日期不合法');
    }

    const sets = EDITABLE.filter((k) => upd[k] !== undefined).map((k) => `${k} = ?`);
    const params: unknown[] = EDITABLE.filter((k) => upd[k] !== undefined).map((k) => upd[k]);
    sets.push('updated_at = ?');
    params.push(nowString());
    params.push(id, row.version);

    await c.env.DB.prepare(`UPDATE repair SET ${sets.join(', ')} WHERE id = ? AND version = ?`)
      .bind(...params)
      .run();

    await c.env.DB.prepare(
      `INSERT INTO operation_log (operator, action, target_table, target_key, new_value)
       VALUES (?, '修改', 'repair', ?, ?)`
    )
      .bind(user.username, row.repair_no, JSON.stringify(upd))
      .run();

    return ok(c, { id, repair_no: row.repair_no }, '修改成功');
  });

  // ============ 状态流转 ============
  // PATCH /api/repair/:id/status body: { status }
  app.patch('/:id/status', async (c) => {
    const user = c.get('user');
    const id = Number(c.req.param('id'));
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return fail(c, ERR.VALIDATION_ERROR, '请求体不是合法 JSON');
    }
    const status = String(body.status || '').trim();
    if (!status) return fail(c, ERR.VALIDATION_ERROR, '缺少 status');

    const row = await c.env.DB.prepare(`SELECT * FROM repair WHERE id = ? AND deleted_at IS NULL`)
      .bind(id)
      .first<{ id: number; created_by: string; status: string; repair_no: string }>();
    if (!row) return fail(c, ERR.REPAIR_NOT_FOUND, '维修记录不存在', 404);

    if (user.role !== 'admin') {
      const own = row.created_by === user.username;
      if (!own) return fail(c, ERR.PERMISSION_DENIED, '只能操作本人录入的工单', 403);
      if (TERMINAL_STATUS.has(row.status)) return fail(c, ERR.PERMISSION_DENIED, '已完成/已关闭的工单不可再改状态', 403);
    }

    await c.env.DB.prepare(`UPDATE repair SET status = ?, updated_at = ? WHERE id = ?`)
      .bind(status, nowString(), id)
      .run();

    await c.env.DB.prepare(
      `INSERT INTO operation_log (operator, action, target_table, target_key, old_value, new_value)
       VALUES (?, '状态变更', 'repair', ?, ?, ?)`
    )
      .bind(user.username, row.repair_no, row.status, status)
      .run();

    return ok(c, { id, status }, '状态已更新');
  });

  // ============ 软删除（仅管理员） ============
  app.delete('/:id', adminOnly(), async (c) => {
    const user = c.get('user');
    const id = Number(c.req.param('id'));
    const row = await c.env.DB.prepare(`SELECT id, repair_no FROM repair WHERE id = ? AND deleted_at IS NULL`)
      .bind(id)
      .first<{ id: number; repair_no: string }>();
    if (!row) return fail(c, ERR.REPAIR_NOT_FOUND, '维修记录不存在', 404);

    await c.env.DB.prepare(`UPDATE repair SET deleted_at = ?, deleted_by = ? WHERE id = ?`)
      .bind(nowString(), user.username, id)
      .run();

    await c.env.DB.prepare(
      `INSERT INTO operation_log (operator, action, target_table, target_key)
       VALUES (?, '删除', 'repair', ?)`
    )
      .bind(user.username, row.repair_no)
      .run();

    return ok(c, { id }, '已删除（可在回收站恢复）');
  });

  return app;
}