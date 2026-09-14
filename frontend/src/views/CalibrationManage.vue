<template>
  <div class="page">
    <div class="card toolbar">
      <h3>检定 / 校验管理</h3>
      <div class="search-row">
        <input v-model="filters.tag_no" placeholder="设备位号" class="w-160" />
        <button type="button" @click="load">查询</button>
      </div>
    </div>

    <p v-if="error" class="msg-error">{{ error }}</p>

    <!-- 到期提醒 -->
    <div class="card">
      <h3>近 30 天到期提醒</h3>
      <template v-if="alerts.calibrations.length || alerts.mandatory.length">
        <p class="sub-title">检定记录即将到期：</p>
        <table v-if="alerts.calibrations.length">
          <thead><tr><th>位号</th><th>设备</th><th>到期日</th><th>结果</th></tr></thead>
          <tbody>
            <tr v-for="a in alerts.calibrations" :key="a.id">
              <td>{{ a.tag_no }}</td><td>{{ a.equipment_name }}</td>
              <td class="warn-text">{{ a.due_date }}</td><td>{{ a.result || '-' }}</td>
            </tr>
          </tbody>
        </table>
        <p class="sub-title">设备强检有效期即将到期：</p>
        <table v-if="alerts.mandatory.length">
          <thead><tr><th>位号</th><th>设备</th><th>有效期至</th></tr></thead>
          <tbody>
            <tr v-for="m in alerts.mandatory" :key="m.tag_no">
              <td>{{ m.tag_no }}</td><td>{{ m.name }}</td>
              <td class="warn-text">{{ m.verify_valid_until }}</td>
            </tr>
          </tbody>
        </table>
      </template>
      <p v-else class="empty">近期（30 天）无到期检定，状态良好</p>
    </div>

    <!-- 列表 -->
    <div class="card">
      <h3>检定记录</h3>
      <table v-if="items.length">
        <thead>
          <tr>
            <th>位号</th><th>设备</th><th>检定编号</th><th>证书编号</th>
            <th>检定日期</th><th>到期日</th><th>结果</th><th>备注</th>
            <th v-if="auth.isAdmin">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in items" :key="r.id">
            <td>{{ r.tag_no }}</td><td>{{ r.equipment_name || '-' }}</td>
            <td>{{ r.calibration_no || '-' }}</td><td>{{ r.cert_no || '-' }}</td>
            <td>{{ r.done_date || '-' }}</td>
            <td :class="{ 'warn-text': isNear(r.due_date) }">{{ r.due_date }}</td>
            <td>{{ r.result || '-' }}</td>
            <td>{{ r.remark || '-' }}</td>
            <td v-if="auth.isAdmin" class="ops">
              <a href="javascript:;" @click="editRecord(r)">编辑</a>
              <a href="javascript:;" class="danger" @click="del(r)">删除</a>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty">暂无检定记录</p>
    </div>

    <!-- 新增/编辑弹窗（仅管理员） -->
    <div v-if="auth.isAdmin && showForm" class="lightbox" @click.self="showForm = false">
      <div class="modal">
        <h3>{{ form.id ? '编辑检定记录' : '新增检定记录' }}</h3>
        <form class="form-grid" @submit.prevent="save">
          <label>
            设备位号 <b class="req">*</b>
            <input v-model="form.tag_no" list="equipment-list" placeholder="已存在设备位号" required />
            <datalist id="equipment-list">
              <option v-for="e in equipOptions" :key="e.tag_no" :value="e.tag_no">{{ e.name }}</option>
            </datalist>
          </label>
          <label>检定编号<input v-model="form.calibration_no" /></label>
          <label>证书编号<input v-model="form.cert_no" /></label>
          <label>检定日期<input v-model="form.done_date" type="date" /></label>
          <label>到期日 <b class="req">*</b><input v-model="form.due_date" type="date" required /></label>
          <label>
            结果
            <select v-model="form.result">
              <option v-for="v in resultList" :key="v" :value="v">{{ v }}</option>
            </select>
          </label>
          <label class="full">备注<input v-model="form.remark" /></label>
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
  listCalibrations, createCalibration, updateCalibration, removeCalibration, systemAlerts,
} from '../api/system';
import { useAuthStore } from '../store/auth';

const auth = useAuthStore();
const filters = ref({ tag_no: '' });
const items = ref([]);
const alerts = ref({ calibrations: [], mandatory: [] });
const error = ref('');
const showForm = ref(false);
const equipOptions = ref([]);
const resultList = ['合格', '不合格', '待检定', '超期未检'];
const emptyForm = () => ({ id: null, tag_no: '', calibration_no: '', cert_no: '', done_date: '', due_date: '', result: '合格', remark: '' });
const form = ref(emptyForm());

function isNear(d) {
  if (!d) return false;
  const diff = (new Date(d) - new Date() || 0) / 86400000;
  return diff <= 30;
}

async function load() {
  error.value = '';
  try {
    const body = await listCalibrations({ tag_no: filters.value.tag_no, pageSize: 100 });
    items.value = body.data.items;
  } catch (e) {
    error.value = e.error?.message || '加载失败';
  }
  try {
    const b = await systemAlerts(30);
    alerts.value = b.data;
  } catch { /* ignore */ }
}

function editRecord(r) {
  form.value = {
    id: r.id,
    tag_no: r.tag_no,
    calibration_no: r.calibration_no || '',
    cert_no: r.cert_no || '',
    done_date: r.done_date || '',
    due_date: r.due_date || '',
    result: r.result || '合格',
    remark: r.remark || '',
  };
  showForm.value = true;
}

async function save() {
  const payload = { ...form.value };
  delete payload.id;
  try {
    if (form.value.id) {
      await updateCalibration(form.value.id, payload);
    } else {
      await createCalibration(payload);
    }
    showForm.value = false;
    form.value = emptyForm();
    await load();
  } catch (e) {
    alert(e.error?.message || '保存失败');
  }
}

async function del(r) {
  if (!confirm(`确认删除 ${r.tag_no} 的检定记录？`)) return;
  try {
    await removeCalibration(r.id);
    await load();
  } catch (e) {
    alert(e.error?.message || '删除失败');
  }
}

onMounted(async () => {
  await load();
  try {
    const body = await api.get('/api/equipment?page=1&pageSize=500');
    equipOptions.value = body.data.items.map((e) => ({ tag_no: e.tag_no, name: e.name }));
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
.w-160 { width: 160px; }
.card { margin-bottom: 12px; }
.card h3 { margin-bottom: 10px; }
.sub-title { font-size: 13px; color: var(--text-light); margin: 10px 0 4px; }
table { width: 100%; border-collapse: collapse; margin-top: 6px; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); font-size: 13px; }
th { background: #f9fafb; color: var(--text-light); white-space: nowrap; }
.warn-text { color: #b45309; font-weight: 600; }
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
  width: 640px;
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
</style>