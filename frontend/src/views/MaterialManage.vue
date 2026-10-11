<template>
  <div class="page">
    <div class="card toolbar">
      <h3>材料管理</h3>
      <div class="search-row">
        <input v-model="q" placeholder="材料名称 / 型号" class="w-200" @keyup.enter="load" />
        <button type="button" @click="load">查询</button>
        <button type="button" @click="openCreate">新增材料</button>
      </div>
    </div>

    <p v-if="error" class="msg-error">{{ error }}</p>

    <div class="card">
      <h3>材料清单（{{ total }}）</h3>
      <table v-if="items.length">
        <thead>
          <tr>
            <th>材料名称</th><th>型号</th><th>使用设备</th><th>库存</th><th>备注</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in items" :key="m.id">
            <td>{{ m.name }}</td>
            <td>{{ m.model || '-' }}</td>
            <td class="targets">
              <template v-if="m.usage_targets.length">
                <span v-for="t in m.usage_targets" :key="t" class="tag" :class="{ tool: t === personalTool }">{{ t }}</span>
              </template>
              <span v-else>-</span>
            </td>
            <td class="stock">
              <button type="button" class="mini" title="减 1" @click="adjust(m, -1)">−</button>
              <b>{{ m.stock }}</b>
              <button type="button" class="mini" title="加 1" @click="adjust(m, 1)">＋</button>
              <a href="javascript:;" class="setlink" @click="setStock(m)">改</a>
            </td>
            <td>{{ m.remark || '-' }}</td>
            <td class="ops">
              <a href="javascript:;" @click="openEdit(m)">编辑</a>
              <a v-if="auth.isAdmin" href="javascript:;" class="danger" @click="del(m)">删除</a>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty">暂无材料，点击右上角「新增材料」添加</p>
    </div>

    <!-- 新增/编辑弹窗 -->
    <div v-if="showForm" class="lightbox" @click.self="showForm = false">
      <div class="modal">
        <h3>{{ form.id ? '编辑材料' : '新增材料' }}</h3>
        <form class="form-grid" @submit.prevent="save">
          <label>材料名称 <b class="req">*</b><input v-model="form.name" required /></label>
          <label>型号<input v-model="form.model" /></label>
          <label>库存<input v-model.number="form.stock" type="number" step="1" /></label>
          <label class="full">备注<input v-model="form.remark" /></label>

          <div class="full targets-picker">
            <p class="picker-title">使用设备（可多选，含个人工具）</p>
            <input v-model="targetSearch" placeholder="搜索设备位号 / 名称" class="target-search" />
            <div class="chips">
              <label class="chip" :class="{ on: isTarget(personalTool) }">
                <input type="checkbox" :checked="isTarget(personalTool)" @change="toggleTarget(personalTool)" />
                <span>{{ personalTool }}</span>
              </label>
              <label v-for="e in filteredEquip" :key="e.tag_no" class="chip" :class="{ on: isTarget(e.tag_no) }">
                <input type="checkbox" :checked="isTarget(e.tag_no)" @change="toggleTarget(e.tag_no)" />
                <span>{{ e.tag_no }}<i v-if="e.name"> · {{ e.name }}</i></span>
              </label>
            </div>
            <p class="picked">已选 {{ form.usage_targets.length }} 项</p>
          </div>

          <div class="buttons full">
            <button type="submit" :disabled="saving">{{ saving ? '保存中…' : '保存' }}</button>
            <button type="button" class="secondary" @click="showForm = false">取消</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  listMaterials, materialEquipmentOptions, createMaterial, updateMaterial, adjustMaterialStock, removeMaterial,
} from '../api/material';
import { useAuthStore } from '../store/auth';

const router = useRouter();
const auth = useAuthStore();

const q = ref('');
const items = ref([]);
const total = ref(0);
const error = ref('');
const showForm = ref(false);
const saving = ref(false);
const personalTool = ref('个人工具');
const equipOptions = ref([]);
const targetSearch = ref('');

const emptyForm = () => ({ id: null, name: '', model: '', stock: 0, remark: '', usage_targets: [] });
const form = ref(emptyForm());

const filteredEquip = computed(() => {
  const kw = targetSearch.value.trim().toLowerCase();
  if (!kw) return equipOptions.value;
  return equipOptions.value.filter(
    (e) => e.tag_no.toLowerCase().includes(kw) || (e.name || '').toLowerCase().includes(kw)
  );
});

function isTarget(v) {
  return form.value.usage_targets.includes(v);
}
function toggleTarget(v) {
  const list = form.value.usage_targets;
  const i = list.indexOf(v);
  if (i >= 0) list.splice(i, 1);
  else list.push(v);
}

async function load() {
  error.value = '';
  try {
    const body = await listMaterials({ q: q.value.trim(), pageSize: 100 });
    items.value = body.data.items;
    total.value = body.data.total;
  } catch (e) {
    error.value = e.error?.message || '加载失败';
  }
}

function openCreate() {
  form.value = emptyForm();
  targetSearch.value = '';
  showForm.value = true;
}

function openEdit(m) {
  form.value = {
    id: m.id,
    name: m.name,
    model: m.model || '',
    stock: m.stock,
    remark: m.remark || '',
    usage_targets: [...m.usage_targets],
  };
  targetSearch.value = '';
  showForm.value = true;
}

async function save() {
  if (!form.value.name.trim()) {
    error.value = '材料名称不能为空';
    return;
  }
  saving.value = true;
  error.value = '';
  try {
    const payload = {
      name: form.value.name.trim(),
      model: form.value.model.trim(),
      stock: Number(form.value.stock) || 0,
      remark: form.value.remark.trim(),
      usage_targets: form.value.usage_targets,
    };
    if (form.value.id) await updateMaterial(form.value.id, payload);
    else await createMaterial(payload);
    showForm.value = false;
    await load();
    router.push({ name: 'home' });
  } catch (e) {
    error.value = e.error?.message || '保存失败';
  } finally {
    saving.value = false;
  }
}

async function adjust(m, delta) {
  try {
    const body = await adjustMaterialStock(m.id, { delta });
    m.stock = body.data.stock;
  } catch (e) {
    error.value = e.error?.message || '库存更新失败';
  }
}

async function setStock(m) {
  const v = prompt(`设置「${m.name}」库存为：`, String(m.stock));
  if (v === null) return;
  if (!/^-?\d+$/.test(v.trim())) {
    error.value = '请输入整数';
    return;
  }
  try {
    const body = await adjustMaterialStock(m.id, { stock: Number(v.trim()) });
    m.stock = body.data.stock;
    error.value = '';
  } catch (e) {
    error.value = e.error?.message || '库存更新失败';
  }
}

async function del(m) {
  if (!confirm(`确认删除材料「${m.name}」？`)) return;
  try {
    await removeMaterial(m.id);
    await load();
  } catch (e) {
    alert(e.error?.message || '删除失败');
  }
}

onMounted(async () => {
  await load();
  try {
    const body = await materialEquipmentOptions();
    personalTool.value = body.data.personal_tool || '个人工具';
    equipOptions.value = body.data.equipment || [];
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
.search-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.w-200 { width: 200px; }
.card { margin-bottom: 12px; }
.card h3 { margin-bottom: 10px; }
table { width: 100%; border-collapse: collapse; margin-top: 6px; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); font-size: 13px; }
th { background: #f9fafb; color: var(--text-light); white-space: nowrap; }
.targets { max-width: 320px; }
.tag {
  display: inline-block;
  background: #dbeafe;
  color: #1d4ed8;
  padding: 1px 8px;
  border-radius: 10px;
  margin: 2px 4px 2px 0;
  font-size: 12px;
}
.tag.tool { background: #fef3c7; color: #b45309; }
.stock { white-space: nowrap; }
.stock b { display: inline-block; min-width: 32px; text-align: center; }
.mini {
  padding: 1px 8px;
  border-radius: 6px;
  font-size: 14px;
  line-height: 1.4;
}
.setlink { margin-left: 6px; font-size: 12px; }
.ops a { margin-right: 8px; }
a.danger { color: var(--danger); }
.empty { color: var(--text-light); padding: 18px; text-align: center; }
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
  width: 680px;
  max-width: 92vw;
  max-height: 90vh;
  overflow: auto;
}
.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
  margin-top: 12px;
}
.form-grid label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--text-light); }
.req { color: var(--danger); }
.full { grid-column: 1 / -1; }
.buttons { display: flex; gap: 10px; }
.targets-picker { display: flex; flex-direction: column; gap: 8px; }
.picker-title { font-size: 13px; color: var(--text-light); margin: 0; }
.target-search { max-width: 320px; }
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 200px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 3px 10px;
  font-size: 12px;
  color: var(--text);
  cursor: pointer;
  background: #fff;
}
.chip.on { border-color: var(--primary); background: #eff6ff; color: #1d4ed8; }
.chip input { width: auto; }
.chip i { color: var(--text-light); font-style: normal; }
.picked { font-size: 12px; color: var(--text-light); margin: 0; }
</style>
