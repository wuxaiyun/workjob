import { api } from './client';

export function listUsers() {
  return api.get('/api/users');
}

export function createUser(payload) {
  return api.post('/api/users', payload);
}

export function updateUser(id, payload) {
  return api.put(`/api/users/${id}`, payload);
}

export function resetUserPassword(id, payload) {
  return api.put(`/api/users/${id}/password`, payload);
}