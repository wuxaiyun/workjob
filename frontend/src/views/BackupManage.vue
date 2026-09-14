<template>
  <div class="page">
    <div class="card toolbar">
      <h3>数据备份</h3>
      <div class="toolbar-right">
        <button :disabled="busy" @click="create">立即备份</button>
      </div>
    </div>

    <p v-if="error" class="msg-error">{{ error }}</p>

    <div class="card">
      <h3>备份记录（最新 50 条）</h3>
      <table v-if="items.length">
        <thead>
          <tr>
            <th>#</th><th>文件名</th><th>行数统计</th><th>操作人</th><th>创建时间</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="b in items" :key="b.id">
            <td>{{ b.id }}</td>
            <td>{{ b.file_name }}</td>
            <td>{{ b.row_counts }}</td>
            <td>{{ b.operator }}</td>
            <td>{{ b.created_at }}</td>
            <td>
              <a :href="b.download_url" download>下载</a>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty">暂无备份，点击「立即备份」创建全库 JSON 备份（存入 R2）</p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { listBackups, createBackup } from '../api/system';

const items = ref([]);
const busy = ref(false);
const error = ref('');

async function load() {
  error.value = '';
  try {
    const body = await listBackups();
    items.value = body.data;
  } catch (e) {
    error.value = e.error?.message || '加载失败';
  }
}

async function create() {
  busy.value = true;
  error.value = '';
  try {
    const body = await createBackup();
    alert(`备份完成：${body.data.file_name}`);
    await load();
  } catch (e) {
    error.value = e.error?.message || '备份失败';
  } finally {
    busy.value = false;
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
.toolbar-right { display: flex; gap: 8px; }
.card h3 { margin-bottom: 10px; }
table { width: 100%; border-collapse: collapse; margin-top: 8px; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); font-size: 13px; }
th { background: #f9fafb; color: var(--text-light); white-space: nowrap; }
tbody td:nth-child(3) { font-family: ui-monospace, Consolas, monospace; font-size: 12px; }
.empty { color: var(--text-light); padding: 24px; text-align: center; }
</style>