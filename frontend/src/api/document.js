import { api } from './client';

export function listDocuments(params = {}) {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') query.set(k, v);
  }
  return api.get(`/api/document?${query.toString()}`);
}

export function documentCategories() {
  return api.get('/api/document/categories');
}

export function uploadDocument({ file, title = '', category = '', remark = '' }) {
  const fd = new FormData();
  fd.append('file', file);
  if (title) fd.append('title', title);
  if (category) fd.append('category', category);
  if (remark) fd.append('remark', remark);
  return api.upload('/api/document/upload', fd);
}

export function removeDocument(id) {
  return api.del(`/api/document/${id}`);
}
