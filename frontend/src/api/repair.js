import { api } from './client';

export function listRepairs(params = {}) {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') query.set(k, v);
  }
  const qs = query.toString();
  return api.get(`/api/repair${qs ? `?${qs}` : ''}`);
}

export function getRepair(id) {
  return api.get(`/api/repair/${id}`);
}

export function createRepair(payload) {
  return api.post('/api/repair', payload);
}

export function updateRepair(id, payload) {
  return api.put(`/api/repair/${id}`, payload);
}

export function setRepairStatus(id, status) {
  return api.patch(`/api/repair/${id}/status`, { status });
}

export function removeRepair(id) {
  return api.del(`/api/repair/${id}`);
}

// 备件 / 费用
export function createPart(payload) {
  return api.post('/api/parts', payload);
}

export function removePart(id) {
  return api.del(`/api/parts/${id}`);
}

export function createCost(payload) {
  return api.post('/api/costs', payload);
}

export function removeCost(id) {
  return api.del(`/api/costs/${id}`);
}