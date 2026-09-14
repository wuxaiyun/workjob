import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { ERR, fail, ok, nowString } from '../utils';
import { authRequired, adminOnly } from '../middleware';

// 系统状态 / 到期提醒 / 回收站（V2.0）
export function systemRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('/system/*', authRequired());
  app.use('/recycle', authRequired());
  app.use('/recycle/*', authRequired());

  // GET /api/system/stats
  app.get('/system/stats', adminOnly(), async (c) => {
    const count = async (sql: string) => (await c.env.DB.prepare(sql).first<{ c: number }>())?.c ?? 0;
    const equipment = await count(`SELECT COUNT(*) AS c FROM equipment WHERE deleted_at IS NULL`);
    const repairing = await count(`SELECT COUNT(*) AS c FROM repair WHERE deleted_at IS NULL AND status IN ('待处理','处理中','待验收')`);
    const repair = await count(`SELECT COUNT(*) AS c FROM repair WHERE deleted_at IS NULL`);
    const photo = await count(`SELECT COUNT(*) AS c FROM photo`);
    const attachment = await count(`SELECT COUNT(*) AS c FROM attachment`);
    const part = await count(`SELECT COUNT(*) AS c FROM part_replace`);
    const calibration = await count(`SELECT COUNT(*) AS c FROM calibration`);
    const costSum = (await c.env.DB.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM cost`).first<{ s: number }>())?.s ?? 0;
    const lastImport = await c.env.DB.prepare(`SELECT file_name, created_at, success_rows, fail_rows FROM import_log ORDER BY id DESC LIMIT 1`).first();
    const lastBackup = await c.env.DB.prepare(`SELECT file_name, created_at, row_counts FROM backup_log ORDER BY id DESC LIMIT 1`).first();
    const recentImports = await count(`SELECT COUNT(*) AS c FROM import_log`);
    const opLogs = await count(`SELECT COUNT(*) AS c FROM operation_log`);

    return ok(c, {
      counts: { equipment, repair, staffed: repairing, photo, attachment, part, calibration, cost_records: await count(`SELECT COUNT(*) AS c FROM cost`) },
      finance: { cost_sum: costSum },
      activity: { last_import: lastImport, last_backup: lastBackup, imports: recentImports, operation_logs: opLogs },
    });
  });

  // GET /api/system/alerts?days=30  到期提醒（检定 + 强检），所有人可见
  app.get('/system/alerts', async (c) => {
    const days = Math.max(0, parseInt(c.req.query('days') || '30', 10) || 30);
    const today = nowString().slice(0, 10);
    const due = new Date();
    due.setDate(due.getDate() + days);
    const limitDate = `${due.getFullYear()}-${p2(due.getMonth() + 1)}-${p2(due.getDate())}`;

    const calibrations = await c.env.DB.prepare(
      `SELECT c.id, c.tag_no, e.name AS equipment_name, c.due_date, c.result
         FROM calibration c LEFT JOIN equipment e ON e.tag_no = c.tag_no
        WHERE c.due_date <= ? AND c.due_date >= ? ORDER BY c.due_date ASC`
    )
      .bind(limitDate, today)
      .all();

    const mandatory = await c.env.DB.prepare(
      `SELECT tag_no, name, verify_valid_until FROM equipment
        WHERE verify_valid_until IS NOT NULL AND verify_valid_until != ''
          AND verify_valid_until <= ? AND verify_valid_until >= ? AND deleted_at IS NULL
        ORDER BY verify_valid_until ASC`
    )
      .bind(limitDate, today)
      .all();

    return ok(c, { calibrations: calibrations.results, mandatory: mandatory.results, today, limit_date: limitDate });
  });

  // ============ 回收站 ============
  // GET /api/recycle?target=equipment|repair
  app.get('/recycle', adminOnly(), async (c) => {
    const target = c.req.query('target') || 'repair';
    if (target === 'equipment') {
      const { results } = await c.env.DB.prepare(
        `SELECT id, tag_no, name, category, status, deleted_at, deleted_by, updated_at FROM equipment
          WHERE status = '停用' OR deleted_at IS NOT NULL ORDER BY id DESC LIMIT 200`
      ).all();
      return ok(c, { target, items: results });
    }
    const { results } = await c.env.DB.prepare(
      `SELECT id, repair_no, tag_no, fault_desc, status, deleted_at, deleted_by FROM repair
        WHERE deleted_at IS NOT NULL ORDER BY id DESC LIMIT 200`
    ).all();
    return ok(c, { target, items: results });
  });

  // 列表页也暴露简易版（非管理员可看到自己的？回收站仅管理员。保持 adminOnly）
  // POST /api/recycle/:target/:id/restore
  app.post('/recycle/:target/:id/restore', adminOnly(), async (c) => {
    const target = c.req.param('target');
    const id = Number(c.req.param('id'));
    if (target === 'equipment') {
      const r = await c.env.DB.prepare(`UPDATE equipment SET status = '在用', deleted_at = NULL, deleted_by = NULL WHERE id = ?`)
        .bind(id)
        .run();
      if (!r.meta.changes) return fail(c, ERR.EQUIPMENT_NOT_FOUND, '设备不存在', 404);
    } else {
      const r = await c.env.DB.prepare(`UPDATE repair SET deleted_at = NULL, deleted_by = NULL WHERE id = ?`)
        .bind(id)
        .run();
      if (!r.meta.changes) return fail(c, ERR.REPAIR_NOT_FOUND, '维修记录不存在', 404);
    }
    return ok(c, { id }, '已恢复');
  });

  return app;
}

const p2 = (n: number) => String(n).padStart(2, '0');