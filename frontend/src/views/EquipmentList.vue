<template>
  <div class="page">
    <div class="card toolbar">
      <form class="search-row" @submit.prevent="search">
        <input v-model="q" placeholder="位号 / 名称 / 型号 模糊搜索，位号精确匹配直接进入详情" class="grow" />
        <select v-model="filters.category" class="w-140">
          <option value="">全部类别</option>
          <option v-for="v in dicts['设备类别'] || []" :key="v" :value="v">{{ v }}</option>
        </select>
        <select v-model="filters.department" class="w-140">
          <option value="">全部部门</option>
          <option v-for="v in dicts['部门'] || []" :key="v" :value="v">{{ v }}</option>
        </select>
        <select v-model="filters.status" class="w-120">
          <option value="">全部状态</option>
          <option v-for="v in dicts['设备状态'] || []" :key="v" :value="v">{{ v }}</option>
        </select>
        <button type="submit">查询</button>
      </form>
      <div class="toolbar-right">
        <router-link :to="{ name: 'equipment-new' }">
          <button>完整新增</button>
        </router-link>
        <router-link :to="{ name: 'equipment-new', query: { mode: 'quick' } }">
          <button class="secondary">快速新增</button>
        </router-link>
      </div>
    </div>

    <div class="card table-card">
      <p v-if="error" class="msg-error">{{ error }}</p>
      <table v-if="items.length">
        <thead>
          <tr>
            <th v-for="f in listFields" :key="f.key">{{ f.label }}</th>
            <th>状态</th>
            <th>更新时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="it in items" :key="it.tag_no">
            <td v-for="f in listFields" :key="f.key">
              <router-link v-if="f.key === 'tag_no'" :to="{ name: 'equipment-detail', params: { tagNo: it.tag_no } }">
                {{ it[f.key] }}
              </router-link>
              <span v-else>{{ it[f.key] || '-' }}</span>
            </td>
            <td>
              <span class="badge" :class="statusClass(it.status)">{{ it.status }}</span>
            </td>
            <td>{{ it.updated_at || it.created_at }}</td>
            <td class="ops">
              <router-link :to="{ name: 'equipment-detail', params: { tagNo: it.tag_no } }">详情</router-link>
              <router-link :to="{ name: 'equipment-edit', params: { tagNo: it.tag_no } }">编辑</router-link>
              <a v-if="auth.isAdmin && it.status !== '停用'" href="javascript:;" @click="toggleStatus(it, '停用')">停用</a>
              <a v-if="auth.isAdmin && it.status === '停用'" href="javascript:;" @click="toggleStatus(it, '在用')">启用</a>
              <a v-if="auth.isAdmin" href="javascript:;" class="danger-link" @click="remove(it)">删除</a>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else-if="!loading && !error" class="empty">暂无设备数据</p>

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
import { useRouter } from 'vue-router';
import { api } from '../api/client';
import { listEquipment, setEquipmentStatus, removeEquipment } from '../api/equipment';
import { LIST_FIELDS } from '../utils/fields';
import { useAuthStore } from '../store/auth';

const router = useRouter();
const auth = useAuthStore();

const q = ref('');
const filters = ref({ category: '', department: '', status: '' });
const items = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const loading = ref(false);
const error = ref('');
const dicts = ref({});

const listFields = LIST_FIELDS;
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));

function statusClass(s) {
  if (!s) return '';
  return { 在用: 'ok', 停用: 'muted', 报废: 'danger' }[s] || '';
}

async function fetchList() {
  loading.value = true;
  error.value = '';
  try {
    const body = await listEquipment({ q: q.value, ...filters.value, page: page.value, pageSize });
    items.value = body.data.items;
    total.value = body.data.total;

    const exact = q.value.trim();
    if (exact && items.value.some((r) => r.tag_no === exact)) {
      router.push({ name: 'equipment-detail', params: { tagNo: exact } });
      return;
    }
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

async function toggleStatus(it, status) {
  if (!confirm(`确认将设备「${it.name}」${status === '停用' ? '停用' : '启用'}？`)) return;
  try {
    await setEquipmentStatus(it.tag_no, { status });
    await fetchList();
  } catch (e) {
    alert(e.error?.message || '操作失败');
  }
}

async function remove(it) {
  if (!confirm(`确认删除设备「${it.name}（${it.tag_no}）」？删除后移入回收站，可在回收站恢复。`)) return;
  try {
    await removeEquipment(it.tag_no);
    await fetchList();
  } catch (e) {
    alert(e.error?.message || '删除失败');
  }
}

onMounted(async () => {
  fetchList();
  try {
    const body = await api.get('/api/dicts');
    dicts.value = body.data;
  } catch {
    /* 字典加载失败不阻塞列表 */
  }
});
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
  min-width: 320px;
}
.search-row .grow {
  flex: 1;
}
.toolbar-right {
  display: flex;
  gap: 8px;
}
.w-140 { width: 140px; }
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
.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 12px;
}
.badge.ok { background: #dcfce7; color: #15803d; }
.badge.muted { background: #f3f4f6; color: #6b7280; }
.badge.danger { background: #fee2e2; color: #b91c1c; }
.ops a { margin-right: 8px; }
.ops .danger-link { color: var(--danger, #dc2626); }
.empty {
  text-align: center;
  color: var(--text-light);
  padding: 24px;
}
.pager {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 12px;
}
</style>