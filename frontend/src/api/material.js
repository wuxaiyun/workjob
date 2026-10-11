import { api } from './client';

export function listMaterials(params = {}) {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') query.set(k, v);
  }
  return api.get(`/api/material?${query.toString()}`);
}

export function materialEquipmentOptions() {
  return api.get('/api/material/equipment-options');
}

export function createMaterial(payload) {
  return api.post('/api/material', payload);
}

export function updateMaterial(id, payload) {
  return api.put(`/api/material/${id}`, payload);
}

export function adjustMaterialStock(id, payload) {
  return api.patch(`/api/material/${id}/stock`, payload);
}

export function removeMaterial(id) {
  return api.del(`/api/material/${id}`);
}
