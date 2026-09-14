<template>
  <div class="page">
    <div class="card narrow">
      <h3>修改密码</h3>
      <form class="form" @submit.prevent="submit">
        <p v-if="error" class="msg-error">{{ error }}</p>
        <p v-if="success" class="msg-success">{{ success }}</p>

        <label>原密码 <span class="req">*</span></label>
        <input v-model="oldPassword" type="password" autocomplete="current-password" />
        <label>新密码 <span class="req">*</span></label>
        <input v-model="newPassword" type="password" autocomplete="new-password" placeholder="至少 6 位" />
        <label>确认新密码 <span class="req">*</span></label>
        <input v-model="confirmPassword" type="password" autocomplete="new-password" />

        <div class="actions">
          <button type="submit" :disabled="saving">{{ saving ? '提交中…' : '确认修改' }}</button>
          <button type="button" class="secondary" @click="$router.back()">取消</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../store/auth';

const auth = useAuthStore();
const router = useRouter();

const oldPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const saving = ref(false);
const error = ref('');
const success = ref('');

async function submit() {
  error.value = '';
  success.value = '';
  if (!oldPassword.value || !newPassword.value || !confirmPassword.value) {
    error.value = '请完整填写';
    return;
  }
  if (newPassword.value.length < 6) {
    error.value = '新密码长度不能少于 6 位';
    return;
  }
  if (newPassword.value !== confirmPassword.value) {
    error.value = '两次输入的新密码不一致';
    return;
  }

  saving.value = true;
  try {
    await auth.changePassword(oldPassword.value, newPassword.value);
    success.value = '密码已修改，请重新登录';
    auth.logout();
    setTimeout(() => router.replace({ name: 'login' }), 1200);
  } catch (e) {
    error.value = e.error?.message || '修改失败';
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.narrow {
  max-width: 420px;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
label {
  font-size: 13px;
  color: var(--text-light);
  margin-top: 4px;
}
.req {
  color: var(--danger);
}
.actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.msg-success {
  color: #15803d;
}
</style>
