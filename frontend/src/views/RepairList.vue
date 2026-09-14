<template>
  <div class="page">
    <div class="card toolbar">
      <form class="search-row" @submit.prevent="search">
        <input v-model="q" placeholder="按设备位号 / 维修单号搜索" class="grow" />
        <select v-model="filters.status" class="w-120">
          <option value="">全部状态</option>
          <option v-for="v in statusList" :key="v" :value="v">{{ v }}</option>
        </select>
        <button type="submit">查询</button>
      </form>
      <div class="toolbar-right">
        <router-link :to="{ name: 'repair-new' }">
          <button>新增维修</button>
        </router-link>
      </div>
    </div>

    <div class="card table-card">
      <p v-if="error" class="msg-error">{{ error }}</p>
      <table v-if="items.length">
        <thead>
          <tr>
            <th>维修单号</th>
            <th>设备</th>
            <th>报修日期</th>
            <th>维修类别</th>
            <th>故障现象</th>
            <th>维修人员</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="it in items" :key="it.id">
            <td>
              <router-link :to="{ name: 'repair-detail', params: { id: it.id } }">{{ it.repair_no }}</router-link>
            </td>
            <td>
              <router-link :to="{ name: 'equipment-detail', params: { tagNo: it.tag_no } }">{{ it.equipment_name_snapshot }}</router-link>
            </td>
            <td>{{ it.report_date }}</td>
            <td>{{ it.repair_type }}</td>
            <td class="ellipsis" :title="it.fault_desc">{{ it.fault_desc }}</td>
            <td>{{ it.worker }}</td>
            <td><span class="badge" :class="statusClass(it.status)">{{ it.status }}</span></td>
            <td class="ops">
              <router-link :to="{ name: 'repair-detail', params: { id: it.id } }">详情</router-link>
              <router-link v-if="canEdit(it)" :to="{ name: 'repair-edit', params: { id: it.id } }">编辑</router-link>
              <a v-if="auth.isAdmin" href="javascript:;" class="danger" @click="del(it)">删除</a>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else-if="!loading && !error" class="empty">暂无维修记录，点击右上角「新增维修」开始</p>

      <div v-if="total > pageSize" class="pager">
        <button class="secondary" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
        <span>第 {{ page }} / {{ totalPages }} 页（共 {{ total }} 条）</span>
        <button class="secondary" :disabled="page >= totalPages" @click="goPage(page + 1)">下一页</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { listRepairs, removeRepair } from '../api/repair';
import { useAuthStore } from '../store/auth';

const auth = useAuthStore();
const q = ref('');
const filters = ref({ status: '' });
const items = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const loading = ref(false);
const error = ref('');
const statusList = ['待处理', '处理中', '待验收', '已完成', '已关闭'];

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
const TERMINAL = ['已完成', '已关闭'];

function statusClass(s) {
  return { 待处理: 'warn', 处理中: 'warn', 待验收: 'warn', 已完成: 'ok', 已关闭: 'muted' }[s] || '';
}

function canEdit(it) {
  if (auth.isAdmin) return true;
  return it.created_by === auth.user?.username && !TERMINAL.includes(it.status);
}

async function fetchList() {
  loading.value = true;
  error.value = '';
  try {
    const body = await listRepairs({ q: q.value, ...filters.value, page: page.value, pageSize });
    items.value = body.data.items;
    total.value = body.data.total;
  } catch (e) {
    error.value = e.error?.message || '查询失败';
  } finally {
    loading.value = false;
  }
}

function search() {
  page.value = 1;
  fetchList();
}

function goPage(p) {
  page.value = p;
  fetchList();
}

async function del(it) {
  if (!confirm(`确认删除维修单「${it.repair_no}」？可在回收站恢复。`)) return;
  try {
    await removeRepair(it.id);
    await fetchList();
  } catch (e) {
    alert(e.error?.message || '删除失败');
  }
}

onMounted(fetchList);
</script>

<style scoped>
.toolbar {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.search-row {
  display: flex;
  gap: 8px;
  flex: 1;
  min-width: 280px;
}
.search-row .grow { flex: 1; }
.toolbar-right { display: flex; gap: 8px; }
.w-120 { width: 120px; }
.table-card { padding: 8px 16px 16px; }
table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 8px;
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
  white-space: nowrap;
}
.ellipsis {
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ops a { margin-right: 8px; }
.ops a.danger { color: var(--danger); }
.badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 12px; }
.badge.ok { background: #dcfce7; color: #15803d; }
.badge.warn { background: #fef9c3; color: #a16207; }
.badge.muted { background: #f3f4f6; color: #6b7280; }
.empty { text-align: center; color: var(--text-light); padding: 24px; }
.pager { display: flex; align-items: center; justify-content: flex-end; gap: 12px; margin-top: 12px; }
</style>