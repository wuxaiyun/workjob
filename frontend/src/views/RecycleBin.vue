<template>
  <div class="page">
    <div class="card toolbar">
      <h3>回收站</h3>
      <div class="tabs">
        <button type="button" :class="{ active: target === 'equipment' }" class="secondary" @click="switchTarget('equipment')">停用 / 回收设备</button>
        <button type="button" :class="{ active: target === 'repair' }" class="secondary" @click="switchTarget('repair')">回收维修单</button>
      </div>
    </div>

    <p v-if="error" class="msg-error">{{ error }}</p>

    <div class="card">
      <template v-if="target === 'equipment'">
        <table v-if="items.length">
          <thead><tr><th>位号</th><th>名称</th><th>类别</th><th>状态</th><th>停用/删除时间</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="it in items" :key="it.id">
              <td>{{ it.tag_no }}</td><td>{{ it.name }}</td><td>{{ it.category }}</td>
              <td><span class="badge" :class="it.status === '在用' ? 'ok' : 'muted'">{{ it.status }}</span></td>
              <td>{{ it.deleted_at || it.updated_at || '-' }}</td>
              <td class="ops">
                <a href="javascript:;" @click="restore('equipment', it.id)">恢复为在用</a>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else class="empty">回收站暂无设备</p>
      </template>

      <template v-else>
        <table v-if="items.length">
          <thead><tr><th>维修单号</th><th>位号</th><th>故障现象</th><th>状态</th><th>删除时间</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="it in items" :key="it.id">
              <td>{{ it.repair_no }}</td><td>{{ it.tag_no }}</td><td>{{ it.fault_desc }}</td>
              <td><span class="badge">{{ it.status }}</span></td>
              <td>{{ it.deleted_at || '-' }}</td>
              <td class="ops">
                <a href="javascript:;" @click="restore('repair', it.id)">恢复</a>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else class="empty">回收站暂无维修单</p>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { listRecycle, restoreRecycle } from '../api/system';

const target = ref('equipment');
const items = ref([]);
const error = ref('');

async function load() {
  error.value = '';
  try {
    const body = await listRecycle(target.value);
    items.value = body.data.items;
  } catch (e) {
    error.value = e.error?.message || '加载失败';
  }
}

function switchTarget(t) {
  target.value = t;
  load();
}

async function restore(kind, id) {
  if (!confirm('确认恢复该记录？')) return;
  try {
    await restoreRecycle(kind, id);
    await load();
  } catch (e) {
    alert(e.error?.message || '恢复失败');
  }
}

onMounted(load);
</script>

<style scoped>
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.toolbar h3 { margin: 0; }
.tabs { display: flex; gap: 8px; }
.tabs .active { border-color: var(--primary); color: var(--primary); }
table { width: 100%; border-collapse: collapse; margin-top: 8px; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); font-size: 13px; }
th { background: #f9fafb; color: var(--text-light); white-space: nowrap; }
.ops a { margin-right: 8px; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 12px; }
.badge.ok { background: #dcfce7; color: #15803d; }
.badge.muted { background: #f3f4f6; color: #6b7280; }
.empty { color: var(--text-light); padding: 24px; text-align: center; }
</style>