<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand">设备台账</div>
      <nav>
        <template v-for="m in menus" :key="m.to">
          <router-link v-if="!m.disabled && !(m.adminOnly && !auth.isAdmin)" :to="{ name: m.to }" class="nav-item">{{ m.label }}</router-link>
          <span v-else-if="m.disabled" class="nav-item nav-disabled">{{ m.label }}（开发中）</span>
        </template>
      </nav>
    </aside>
    <div class="main">
      <header class="topbar">
        <div class="head-links">
          <span v-if="auth.isAdmin" class="head-tag admin">管理员</span>
          <span v-else class="head-tag">维修人员</span>
        </div>
        <div class="user-box">
          <span>{{ auth.user?.real_name || auth.user?.username }}</span>
          <router-link :to="{ name: 'change-password' }"><button class="secondary">修改密码</button></router-link>
          <button class="secondary" @click="logout">退出</button>
        </div>
      </header>
      <main class="content">
        <router-view />
      </main>
    </div>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router';
import { useAuthStore } from '../store/auth';

const auth = useAuthStore();
const router = useRouter();

const menus = [
  { label: '首页', to: 'home', disabled: false },
  { label: '设备管理', to: 'equipment', disabled: false },
  { label: '维修管理', to: 'repair-list', disabled: false },
  { label: '设备照片', to: 'photo', disabled: false },
  { label: '设备附件', to: 'attachment', disabled: false },
  { label: '检定管理', to: 'calibration', disabled: false },
  { label: '导入导出', to: 'importexport', adminOnly: true },
  { label: '设备参数设置', to: 'field-config', adminOnly: true },
  { label: '基础选项设置', to: 'dicts', adminOnly: true },
  { label: '回收站', to: 'recycle', adminOnly: true },
  { label: '数据备份', to: 'backup', adminOnly: true },
];

function logout() {
  auth.logout();
  router.replace('/login');
}
</script>

<style scoped>
.layout {
  display: flex;
  min-height: 100vh;
}
.sidebar {
  width: 200px;
  background: #111827;
  color: #fff;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
}
.brand {
  padding: 18px 16px;
  font-size: 18px;
  font-weight: bold;
  border-bottom: 1px solid #1f2937;
  color: #60a5fa;
}
nav {
  padding: 12px 0;
  display: flex;
  flex-direction: column;
}
.nav-item {
  color: #d1d5db;
  padding: 12px 16px;
  font-size: 14px;
  border-left: 3px solid transparent;
}
.nav-item:hover {
  background: #1f2937;
  color: #fff;
}
.nav-disabled {
  color: #6b7280;
  cursor: not-allowed;
  background: transparent;
}
.nav-item.router-link-exact-active,
a.nav-item.router-link-active {
  background: #2563eb;
  color: #fff;
  border-left-color: #93c5fd;
}
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.topbar {
  height: 52px;
  background: #fff;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
}
.user-box {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text);
}
.head-links { display: flex; gap: 8px; align-items: center; }
.head-tag {
  font-size: 12px;
  color: #374151;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 10px;
  padding: 2px 10px;
}
.content {
  flex: 1;
  padding: 16px;
  overflow: auto;
}
</style>