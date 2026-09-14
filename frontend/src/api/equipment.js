import { api } from './client';

export function listEquipment(params = {}) {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') query.set(k, v);
  }
  const qs = query.toString();
  return api.get(`/api/equipment${qs ? `?${qs}` : ''}`);
}

export function getEquipment(tagNo) {
  return api.get(`/api/equipment/${encodeURIComponent(tagNo)}`);
}

export function createEquipment(payload) {
  return api.post('/api/equipment', payload);
}

export function updateEquipment(tagNo, payload) {
  return api.put(`/api/equipment/${encodeURIComponent(tagNo)}`, payload);
}

export function setEquipmentStatus(tagNo, payload) {
  return api.patch(`/api/equipment/${encodeURIComponent(tagNo)}/status`, payload);
}

export function getCategoryFields(category) {
  return api.get(`/api/equipment/category-fields?category=${encodeURIComponent(category)}`);
}