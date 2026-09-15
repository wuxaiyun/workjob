import { Hono } from 'hono';
import type { AppEnv } from './types';
import { fail, ERR } from './utils';
import { authRoutes } from './routes/auth';
import { dictRoutes } from './routes/dict';
import { equipmentRoutes } from './routes/equipment';
import { repairRoutes } from './routes/repair';
import { photoRoutes } from './routes/photo';
import { partsCostsRoutes } from './routes/partsCosts';
import { calibrationRoutes } from './routes/calibration';
import { fieldConfigRoutes } from './routes/fieldConfig';
import { importExportRoutes } from './routes/importExport';
import { backupRoutes } from './routes/backup';
import { systemRoutes } from './routes/system';
import { userRoutes } from './routes/users';

const app = new Hono<AppEnv>();

app.route('/api', authRoutes());
app.route('/api', dictRoutes());
app.route('/api/equipment', equipmentRoutes());
app.route('/api/repair', repairRoutes());
app.route('/api', photoRoutes());
app.route('/api', partsCostsRoutes());
app.route('/api', calibrationRoutes());
app.route('/api', fieldConfigRoutes());
app.route('/api', importExportRoutes());
app.route('/api', backupRoutes());
app.route('/api', systemRoutes());
app.route('/api', userRoutes());

// API 404
app.notFound((c) => {
  if (c.req.path.startsWith('/api')) {
    return fail(c, 'NOT_FOUND', '接口不存在', 404);
  }
  return fail(c, 'NOT_FOUND', '请求不存在', 404);
});

// 未捕获异常统一返回 DATABASE_ERROR / 500
app.onError((err, c) => {
  console.error('Worker error:', err);
  return fail(c, ERR.DATABASE_ERROR, '服务器内部错误', 500);
});

export default app;