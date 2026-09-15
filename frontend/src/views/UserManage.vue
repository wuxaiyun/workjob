<template>
  <div class="page">
    <div class="card">
      <h3>用户管理</h3>
      <p class="hint">新增/启停账号、分配角色（管理员/维修人员）、重置密码。系统至少保留一个启用的管理员，且不能停用或降级自己。</p>

      <div class="add-bar">
        <input v-model="form.username" placeholder="用户名" class="w-120" />
        <input v-model="form.password" type="password" placeholder="密码（≥6位）" class="w-140" />
        <input v-model="form.realName" placeholder="姓名" class="w-120" />
        <select v-model="form.role" class="w-120">
          <option value="worker">维修人员</option>
          <option value="admin">管理员</option>
        </select>
        <button :disabled="busy" @click="addUser">新增用户</button>
      </div>
      <p v-if="error" class="msg-error">{{ error }}</p>

      <table v-if="users.length">
        <thead>
          <tr>
            <th>用户名</th>
            <th>姓名</th>
            <th>角色</th>
            <th>状态</th>
            <th>创建时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id">
            <td>{{ u.username }}</td>
            <td>
              <template v-if="editingId === u.id">
                <input v-model="editForm.realName" class="w-120" placeholder="姓名" />
              </template>
              <template v-else>{{ u.real_name || '-' }}</template>
            </td>
            <td>
              <template v-if="editingId === u.id">
                <select v-model="editForm.role" class="w-120" :disabled="isSelf(u.id)">
                  <option value="worker">维修人员</option>
                  <option value="admin">管理员</option>
                </select>
              </template>
              <template v-else>{{ u.role === 'admin' ? '管理员' : '维修人员' }}</template>
            </td>
            <td>
              <span class="badge" :class="u.status === 'active' ? 'ok' : 'muted'">{{ u.status === 'active' ? '启用' : '停用' }}</span>
            </td>
            <td>{{ u.created_at }}</td>
            <td class="ops">
              <template v-if="editingId === u.id">
                <a href="javascript:;" @click="saveEdit(u)">保存</a>
                <a href="javascript:;" @click="cancelEdit">取消</a>
              </template>
              <template v-else>
                <a href="javascript:;" @click="startEdit(u)">编辑</a>
                <a href="javascript:;" @click="resetPwd(u)">重置密码</a>
                <a v-if="u.status === 'active' && !isSelf(u.id)" href="javascript:;" @click="toggleStatus(u, 'disabled')">停用</a>
                <a v-else-if="u.status === 'disabled'" href="javascript:;" @click="toggleStatus(u, 'active')">启用</a>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty">暂无用户</p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { listUsers, createUser, updateUser, resetUserPassword } from '../api/users';
import { useAuthStore } from '../store/auth';

const auth = useAuthStore();
const users = ref([]);
const busy = ref(false);
const error = ref('');
const form = ref({ username: '', password: '', realName: '', role: 'worker' });
const editingId = ref(null);
const editForm = ref({ realName: '', role: 'worker' });

function isSelf(id) {
  return auth.user?.id === id;
}

async function load() {
  try {
    const body = await listUsers();
    users.value = body.data;
  } catch (e) {
    error.value = e.error?.message || '加载失败';
  }
}

async function addUser() {
  const username = form.value.username.trim();
  const password = form.value.password;
  if (!username || !password) {
    error.value = '用户名和密码必填';
    return;
  }
  if (password.length < 6) {
    error.value = '密码长度不能少于 6 位';
    return;
  }
  busy.value = true;
  error.value = '';
  try {
    await createUser({ username, password, role: form.value.role, real_name: form.value.realName.trim() || undefined });
    form.value = { username: '', password: '', realName: '', role: 'worker' };
    await load();
  } catch (e) {
    error.value = e.error?.message || '新增失败';
  } finally {
    busy.value = false;
  }
}

function startEdit(u) {
  editingId.value = u.id;
  editForm.value = { realName: u.real_name || '', role: u.role };
}

function cancelEdit() {
  editingId.value = null;
}

async function saveEdit(u) {
  try {
    await updateUser(u.id, { real_name: editForm.value.realName || undefined, role: editForm.value.role });
    editingId.value = null;
    error.value = '';
    await load();
  } catch (e) {
    error.value = e.error?.message || '保存失败';
  }
}

async function resetPwd(u) {
  const pw = prompt(`为「${u.username}」设置新密码（≥6位）：`);
  if (pw === null) return;
  if (pw.length < 6) {
    error.value = '密码长度不能少于 6 位';
    return;
  }
  try {
    await resetUserPassword(u.id, { password: pw });
    error.value = '';
    alert(`已重置「${u.username}」的密码`);
  } catch (e) {
    error.value = e.error?.message || '重置失败';
  }
}

async function toggleStatus(u, status) {
  if (!confirm(`确认${status === 'active' ? '启用' : '停用'}用户「${u.username}」？`)) return;
  try {
    await updateUser(u.id, { status });
    error.value = '';
    await load();
  } catch (e) {
    error.value = e.error?.message || '操作失败';
  }
}

onMounted(load);
</script>

<style scoped>
.hint {
  color: var(--text-light);
  font-size: 12px;
  margin-bottom: 12px;
}
.add-bar {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.w-120 { width: 120px; }
.w-140 { width: 140px; }
table {
  width: 100%;
  border-collapse: collapse;
}
th, td {
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}
th {
  background: #f9fafb;
  color: var(--text-light);
}
.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 12px;
}
.badge.ok { background: #dcfce7; color: #15803d; }
.badge.muted { background: #f3f4f6; color: #6b7280; }
.ops a { margin-right: 8px; }
.empty {
  color: var(--text-light);
  padding: 16px;
  text-align: center;
}
</style>