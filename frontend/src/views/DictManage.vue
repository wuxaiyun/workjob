<template>
  <div class="page">
    <div class="card">
      <h3>基础选项设置</h3>
      <p class="hint">类别和部门来自基础选项表，可在此新增/改名/删除。已被设备引用的类别或部门不允许删除。</p>

      <div class="type-bar">
        <label>选择类型：</label>
        <select v-model="currentType" @change="load">
          <option v-for="t in dictTypes" :key="t" :value="t">{{ t }}</option>
        </select>
        <span class="note">共 {{ currentItems.length }} 项</span>
      </div>

      <p v-if="error" class="msg-error">{{ error }}</p>

      <table v-if="currentItems.length">
        <thead>
          <tr>
            <th>选项值</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in currentItems" :key="item.id">
            <td>
              <input :ref="'v_' + item.id" :value="item.value"
                     @change="onEdit(item, $event)" class="value-input" />
            </td>
            <td>
              <button v-if="dirtyIds.has(item.id)" class="secondary" @click="saveEdit(item)">保存</button>
              <a href="javascript:;" @click="removeItem(item)">删除</a>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else-if="currentItems.length === 0 && currentType" class="empty">该类型还没有选项</p>

      <div v-if="currentType" class="add-bar">
        <input v-model="newValue" placeholder="输入新字典值，回车或点击新增" @keyup.enter="addItem" />
        <button @click="addItem" :disabled="!currentType">新增</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { api } from '../api/client';

const allDicts = ref({}); // { type: [value] } 仅用于列出类型
const currentItems = ref([]); // [{id, value}] 当前选中类型的条目
const currentType = ref('部门');
const newValue = ref('');
const error = ref('');
const dirtyIds = ref(new Set());
const edited = ref({}); // id -> newValue

const dictTypes = computed(() => Object.keys(allDicts.value).sort());

async function load() {
  if (!currentType.value) return;
  try {
    const body = await api.get(`/api/dicts?type=${encodeURIComponent(currentType.value)}`);
    currentItems.value = body.data.items || [];
  } catch (e) {
    error.value = e.error?.message || '加载失败';
  }
}

function onEdit(item, e) {
  const v = e.target.value;
  if (v.trim() === item.value) return;
  edited.value[item.id] = v;
  dirtyIds.value.add(item.id);
  dirtyIds.value = new Set(dirtyIds.value);
}

async function saveEdit(item) {
  const v = (edited.value[item.id] || '').trim();
  if (!v) {
    error.value = '字典值不能为空';
    await load();
    return;
  }
  try {
    await api.put(`/api/dicts/${item.id}`, { dict_value: v });
    dirtyIds.value.delete(item.id);
    dirtyIds.value = new Set(dirtyIds.value);
    error.value = '';
    await load();
  } catch (e) {
    error.value = e.error?.message || '保存失败';
    await load();
  }
}

async function addItem() {
  const v = newValue.value.trim();
  if (!v) return;
  try {
    await api.post('/api/dicts', { dict_type: currentType.value, dict_value: v });
    newValue.value = '';
    error.value = '';
    await load();
  } catch (e) {
    error.value = e.error?.message || '新增失败';
  }
}

async function removeItem(item) {
  if (!confirm(`确认删除字典项「${item.value}」？`)) return;
  try {
    await api.del(`/api/dicts/${item.id}`);
    error.value = '';
    await load();
  } catch (e) {
    error.value = e.error?.message || '删除失败';
  }
}

onMounted(async () => {
  try {
    const body = await api.get('/api/dicts');
    allDicts.value = body.data;
    if (!dictTypes.value.includes(currentType.value)) currentType.value = dictTypes.value[0] || '';
  } catch (e) {
    error.value = e.error?.message || '加载失败';
  }
  await load();
});
</script>

<style scoped>
.hint {
  color: var(--text-light);
  font-size: 12px;
  margin-bottom: 12px;
}
.type-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.type-bar select {
  width: 200px;
}
.note {
  color: var(--text-light);
  font-size: 12px;
}
table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 12px;
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
.value-input {
  width: 260px;
}
td a {
  margin-left: 8px;
}
.empty {
  color: var(--text-light);
  padding: 16px;
}
.add-bar {
  display: flex;
  gap: 8px;
  max-width: 360px;
}
</style>