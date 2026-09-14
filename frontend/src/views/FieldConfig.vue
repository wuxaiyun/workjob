<template>
  <div class="page">
    <div class="card toolbar">
      <h3>字段配置</h3>
      <div class="search-row">
        <select v-model="category" @change="load" class="w-180">
          <option value="">全部类别</option>
          <option v-for="v in categories" :key="v" :value="v">{{ v }}</option>
        </select>
        <button type="button" class="secondary" @click="openAdd">+ 新增字段</button>
      </div>
    </div>

    <p v-if="error" class="msg-error">{{ error }}</p>

    <div class="card">
      <table v-if="items.length">
        <thead>
          <tr>
            <th>类别</th><th>字段key</th><th>显示名</th><th>分组</th><th>排序</th>
            <th>必填</th><th>列表</th><th>详情</th><th>导出</th><th>默认值</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in items" :key="f.id">
            <td>{{ f.category }}</td>
            <td><code>{{ f.field_key }}</code></td>
            <td>{{ f.field_label }}</td>
            <td>{{ f.group_name || '-' }}</td>
            <td>{{ f.sort_order }}</td>
            <td>{{ yn(f.is_required) }}</td>
            <td>{{ yn(f.is_visible_list) }}</td>
            <td>{{ yn(f.is_visible_detail) }}</td>
            <td>{{ yn(f.is_visible_export) }}</td>
            <td>{{ f.default_value || '-' }}</td>
            <td class="ops">
              <a href="javascript:;" @click="openEdit(f)">编辑</a>
              <a href="javascript:;" class="danger" @click="del(f)">删除</a>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty">暂无可配置字段（可选择类别查看，或新增字段）</p>
    </div>

    <div v-if="showForm" class="lightbox" @click.self="showForm = false">
      <div class="modal">
        <h3>{{ form.id ? '编辑字段配置' : '新增字段配置' }}</h3>
        <form class="form-grid" @submit.prevent="save">
          <label>
            设备类别 <b class="req">*</b>
            <select v-model="form.category" required :disabled="!!form.id">
              <option v-for="v in categories" :key="v" :value="v">{{ v }}</option>
            </select>
          </label>
          <label>
            字段 key <b class="req">*</b>
            <input v-model="form.field_key" placeholder="如 heat_area" required :disabled="!!form.id" />
          </label>
          <label>
            显示名称 <b class="req">*</b>
            <input v-model="form.field_label" placeholder="如 换热面积" required />
          </label>
          <label>所属分组<input v-model="form.group_name" placeholder="如 基本参数 / 性能" /></label>
          <label>排序<input v-model.number="form.sort_order" type="number" /></label>
          <label>默认值<input v-model="form.default_value" /></label>
          <label class="checkbox">
            <input v-model="isRequired" type="checkbox" /> 必填字段
          </label>
          <label class="checkbox">
            <input v-model="isList" type="checkbox" /> 列表中显示
          </label>
          <label class="checkbox">
            <input v-model="isDetail" type="checkbox" /> 详情中显示
          </label>
          <label class="checkbox">
            <input v-model="isExport" type="checkbox" /> 导出包含
          </label>
          <div class="buttons full">
            <button type="submit">保存</button>
            <button type="button" class="secondary" @click="showForm = false">取消</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api/client';
import {
  listFieldConfig, createFieldConfig, updateFieldConfig, removeFieldConfig,
} from '../api/system';

const category = ref('');
const categories = ref([]);
const items = ref([]);
const error = ref('');
const showForm = ref(false);
const isRequired = ref(false);
const isList = ref(false);
const isDetail = ref(true);
const isExport = ref(true);
const emptyForm = () => ({ id: null, category: '', field_key: '', field_label: '', group_name: '', sort_order: 0, default_value: '' });
const form = ref(emptyForm());

function yn(v) {
  return v === '1' || v === 1 || v === true ? '是' : '否';
}

async function load() {
  error.value = '';
  try {
    const body = await listFieldConfig(category.value);
    items.value = body.data;
  } catch (e) {
    error.value = e.error?.message || '加载失败';
  }
}

function openAdd() {
  form.value = { ...emptyForm(), category: category.value };
  isRequired.value = false;
  isList.value = false;
  isDetail.value = true;
  isExport.value = true;
  showForm.value = true;
}

function openEdit(f) {
  form.value = { ...f };
  isRequired.value = yn(f.is_required) === '是';
  isList.value = yn(f.is_visible_list) === '是';
  isDetail.value = yn(f.is_visible_detail) === '是';
  isExport.value = yn(f.is_visible_export) === '是';
  showForm.value = true;
}

async function save() {
  const payload = {
    category: form.value.category,
    field_key: form.value.field_key,
    field_label: form.value.field_label,
    group_name: form.value.group_name || null,
    sort_order: form.value.sort_order ?? 0,
    default_value: form.value.default_value || null,
    is_required: isRequired.value ? '1' : '0',
    is_visible_list: isList.value ? '1' : '0',
    is_visible_detail: isDetail.value ? '1' : '0',
    is_visible_export: isExport.value ? '1' : '0',
  };
  try {
    if (form.value.id) {
      await updateFieldConfig(form.value.id, payload);
    } else {
      await createFieldConfig(payload);
    }
    showForm.value = false;
    await load();
  } catch (e) {
    alert(e.error?.message || '保存失败');
  }
}

async function del(f) {
  if (!confirm(`确认删除字段「${f.field_label}」？删除后编辑设备时不显示该字段。`)) return;
  try {
    await removeFieldConfig(f.id);
    await load();
  } catch (e) {
    alert(e.error?.message || '删除失败');
  }
}

onMounted(async () => {
  await load();
  try {
    const body = await api.get('/api/dicts?type=' + encodeURIComponent('设备类别'));
    if (body.data.items?.length) categories.value = body.data.items.map((x) => x.value);
  } catch { /* ignore */ }
});
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
.search-row { display: flex; gap: 8px; align-items: center; }
.w-180 { width: 180px; }
table { width: 100%; border-collapse: collapse; margin-top: 8px; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); font-size: 13px; }
th { background: #f9fafb; color: var(--text-light); white-space: nowrap; }
code { background: #f3f4f6; padding: 1px 6px; border-radius: 4px; font-size: 12px; }
.ops a { margin-right: 8px; }
a.danger { color: var(--danger); }
.empty { color: var(--text-light); padding: 24px; text-align: center; }
.lightbox {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.modal {
  background: #fff;
  border-radius: 10px;
  padding: 20px;
  width: 560px;
  max-width: 92vw;
  max-height: 90vh;
  overflow: auto;
}
.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
  margin-top: 12px;
}
.form-grid label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--text-light); }
.req { color: var(--danger); }
.checkbox { flex-direction: row !important; align-items: center; gap: 8px !important; }
.checkbox input { width: auto; }
.full { grid-column: 1 / -1; }
.buttons { display: flex; gap: 10px; }
</style>