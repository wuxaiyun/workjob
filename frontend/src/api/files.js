import { api } from './client';

export function listPhotos(params = {}) {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') query.set(k, v);
  }
  const qs = query.toString();
  return api.get(`/api/photo${qs ? `?${qs}` : ''}`);
}

export function removePhoto(id) {
  return api.del(`/api/photo/${id}`);
}

export function listAttachments(params = {}) {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') query.set(k, v);
  }
  const qs = query.toString();
  return api.get(`/api/attachment${qs ? `?${qs}` : ''}`);
}

export function removeAttachment(id) {
  return api.del(`/api/attachment/${id}`);
}

// 前端压缩照片：把大图等比缩到 max 宽高生成缩略图 Blob（JPEG）
export function makeThumbnail(file, max = 480, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      const scale = Math.min(max / width, max / height, 1);
      if (scale < 1) {
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((b) => (b ? resolve(b) : resolve(file)), 'image/jpeg', quality);
    };
    img.onerror = () => resolve(file);
    img.src = URL.createObjectURL(file);
  });
}

// 统一上传入口：kind=photo|attachment，file 原图，thumb 缩略图（照片可选）
export async function uploadFile({
  kind = 'photo',
  tagNo,
  repairNo = '',
  type,
  file,
  thumbnail = null,
  description = '',
  photographer = '',
  photoTime = '',
  remark = '',
}) {
  const fd = new FormData();
  fd.append('kind', kind);
  fd.append('tag_no', tagNo);
  if (repairNo) fd.append('repair_no', repairNo);
  fd.append('type', type);
  fd.append('file', file);
  if (thumbnail && kind === 'photo') fd.append('thumbnail', thumbnail, `thumb_${Date.now()}.jpg`);
  if (description) fd.append('description', description);
  if (photographer) fd.append('photographer', photographer);
  if (photoTime) fd.append('photo_time', photoTime);
  if (remark) fd.append('remark', remark);
  return api.upload('/api/upload', fd);
}