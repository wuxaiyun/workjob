import { api } from './client';

// 检定
export function listCalibrations(params = {}) {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') query.set(k, v);
  }
  return api.get(`/api/calibration?${query.toString()}`);
}

export function createCalibration(payload) {
  return api.post('/api/calibration', payload);
}

export function updateCalibration(id, payload) {
  return api.put(`/api/calibration/${id}`, payload);
}

export function removeCalibration(id) {
  return api.del(`/api/calibration/${id}`);
}

export function expiringCalibrations(days = 30) {
  return api.get(`/api/calibration/expiring?days=${days}`);
}

// 字段配置
export function listFieldConfig(category = '') {
  const qs = category ? `?category=${encodeURIComponent(category)}` : '';
  return api.get(`/api/field-config${qs}`);
}

export function createFieldConfig(payload) {
  return api.post('/api/field-config', payload);
}

export function updateFieldConfig(id, payload) {
  return api.put(`/api/field-config/${id}`, payload);
}

export function removeFieldConfig(id) {
  return api.del(`/api/field-config/${id}`);
}

// 导入 / 导出
export function importEquipment(rows, mode, dryRun, fileName) {
  return api.post('/api/import/equipment', { rows, mode, dry_run: dryRun, file_name: fileName });
}

export function listImportLogs() {
  return api.get('/api/import/logs');
}

export function exportEquipment(params = {}) {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') query.set(k, v);
  }
  return api.get(`/api/export/equipment?${query.toString()}`);
}

// 备份
export function createBackup() {
  return api.post('/api/backup');
}

export function listBackups() {
  return api.get('/api/backup');
}

export function latestBackup() {
  return api.get('/api/backup/latest');
}

// 系统状态 / 到期提醒 / 回收站
export function systemStats() {
  return api.get('/api/system/stats');
}

export function systemAlerts(days = 30) {
  return api.get(`/api/system/alerts?days=${days}`);
}

export function listRecycle(target) {
  return api.get(`/api/recycle?target=${target}`);
}

export function restoreRecycle(target, id) {
  return api.post(`/api/recycle/${target}/${id}/restore`);
}

// 字典
export function listDicts(type = '') {
  const qs = type ? `?type=${encodeURIComponent(type)}` : '';
  return api.get(`/api/dicts${qs}`);
}

export function createDict(payload) {
  return api.post('/api/dicts', payload);
}

export function updateDict(id, payload) {
  return api.put(`/api/dicts/${id}`, payload);
}

export function removeDict(id) {
  return api.del(`/api/dicts/${id}`);
}