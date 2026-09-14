import { defineStore } from 'pinia';
import { api } from '../api/client';
import { token, storedUser } from '../api/client';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: storedUser.get(),
    token: token.get(),
  }),
  getters: {
    isLoggedIn: (state) => !!state.token,
    isAdmin: (state) => state.user?.role === 'admin',
  },
  actions: {
    async login(username, password) {
      const body = await api.post('/api/login', { username, password });
      this.user = body.data.user;
      this.token = body.data.token;
      token.set(this.token);
      storedUser.set(this.user);
      return body;
    },
    async fetchMe() {
      const body = await api.get('/api/me');
      this.user = body.data;
      storedUser.set(this.user);
      return body.data;
    },
    async changePassword(oldPassword, newPassword) {
      return api.put('/api/me/password', { old_password: oldPassword, new_password: newPassword });
    },
    logout() {
      this.user = null;
      this.token = '';
      token.clear();
      storedUser.clear();
    },
  },
});