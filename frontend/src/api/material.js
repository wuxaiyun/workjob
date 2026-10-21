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

// 材料图片：上传（原图 + 前端压缩缩略图），返回 image_url/thumb_url
export function uploadMaterialImage(id, file, thumbnail = null) {
  const fd = new FormData();
  fd.append('file', file);
  if (thumbnail) fd.append('thumbnail', thumbnail, `thumb_${Date.now()}.jpg`);
  return api.upload(`/api/material/${id}/image`, fd);
}

// 清除材料图片（R2 对象一并删除）
export function clearMaterialImage(id) {
  return api.del(`/api/material/${id}/image`);
}
