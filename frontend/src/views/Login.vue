<template>
  <div class="login-wrap">
    <form class="login-card" @submit.prevent="submit">
      <h1>工厂设备维修台账系统</h1>
      <p class="sub">Cloudflare Worker + D1 + R2 | V1.0</p>
      <label>用户名</label>
      <input v-model="username" placeholder="请输入用户名" autocomplete="username" />
      <label>密码</label>
      <input v-model="password" type="password" placeholder="请输入密码" autocomplete="current-password" />
      <button :disabled="loading">{{ loading ? '登录中…' : '登 录' }}</button>
      <p v-if="error" class="msg-error">{{ error }}</p>
    </form>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAuthStore } from '../store/auth';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const username = ref('');
const password = ref('');
const loading = ref(false);
const error = ref('');

async function submit() {
  if (!username.value || !password.value) {
    error.value = '请输入用户名和密码';
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    await auth.login(username.value, password.value);
    router.replace(route.query.redirect || '/');
  } catch (e) {
    error.value = e.error?.message || '登录失败';
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-wrap {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #1e3a8a, #2563eb);
  padding: 16px;
}
.login-card {
  width: 360px;
  max-width: 100%;
  background: #fff;
  border-radius: 12px;
  padding: 32px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
}
.login-card h1 {
  font-size: 20px;
  text-align: center;
  color: var(--primary);
}
.sub {
  text-align: center;
  color: var(--text-light);
  font-size: 12px;
  margin-bottom: 12px;
}
.login-card label {
  font-size: 13px;
  color: var(--text-light);
}
.login-card button {
  margin-top: 12px;
  padding: 12px;
  font-size: 15px;
}
</style>