<template>
  <div class="page">
    <div class="card">
      <h3>{{ isEdit ? `编辑维修单 ${form.repair_no}` : '新增维修单' }}</h3>
      <p v-if="error" class="msg-error">{{ error }}</p>

      <form class="form-grid" @submit.prevent="submit">
        <label>
          设备位号 <b class="req">*</b>
          <input v-if="!isEdit" v-model="form.tag_no" list="equipment-list" placeholder="选择或输入已存在设备位号" required />
          <span v-else class="static-text">{{ form.tag_no }}（{{ form.equipment_name_snapshot }}）</span>
          <datalist id="equipment-list">
            <option v-for="e in equipOptions" :key="e.tag_no" :value="e.tag_no">{{ e.name }}</option>
          </datalist>
        </label>
        <label>
          报修日期 <b class="req">*</b>
          <input v-model="form.report_date" type="date" required />
        </label>
        <label>
          维修类别 <b class="req">*</b>
          <select v-model="form.repair_type" required>
            <option v-for="v in typeList" :key="v" :value="v">{{ v }}</option>
          </select>
        </label>
        <label>
          状态
          <select v-model="form.status">
            <option v-for="v in statusList" :key="v" :value="v">{{ v }}</option>
          </select>
        </label>
        <label>
          维修人员
          <input v-model="form.worker" placeholder="默认当前用户" />
        </label>
        <label>
          维修日期
          <input v-model="form.repair_date" type="date" />
        </label>
        <label class="full">
          故障现象 <b class="req">*</b>
          <textarea v-model="form.fault_desc" rows="2" required></textarea>
        </label>
        <label class="full">
          故障原因
          <textarea v-model="form.cause" rows="2"></textarea>
        </label>
        <label class="full">
          维修内容 <b class="req">*</b>
          <textarea v-model="form.repair_content" rows="2" required></textarea>
        </label>
        <label class="full">
          处理措施
          <textarea v-model="form.action" rows="2"></textarea>
        </label>
        <label class="full">
          备注
          <textarea v-model="form.remark" rows="2"></textarea>
        </label>

        <div class="buttons full">
          <button type="submit" :disabled="submitting">{{ isEdit ? '保存修改' : '创建维修单' }}</button>
          <button type="button" class="secondary" @click="$router.back()">返回</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api/client';
import { createRepair, getRepair, updateRepair } from '../api/repair';
import { useAuthStore } from '../store/auth';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const isEdit = !!route.params.id;
const submitting = ref(false);
const error = ref('');
const equipOptions = ref([]);
const typeList = ref([]);
const statusList = ['待处理', '处理中', '待验收', '已完成', '已关闭'];

const form = ref({
  tag_no: '',
  report_date: new Date().toISOString().slice(0, 10),
  repair_type: '',
  status: '待处理',
  worker: auth.user?.real_name || auth.user?.username || '',
  repair_date: '',
  fault_desc: '',
  cause: '',
  repair_content: '',
  action: '',
  remark: '',
});

onMounted(async () => {
  try {
    const body = await api.get('/api/dicts');
    typeList.value = body.data['维修类型'] || [];
  } catch {
    typeList.value = ['故障维修', '定期检修', '预防性维护', '应急抢修'];
  }
  try {
    const body = await api.get('/api/dicts?type=' + encodeURIComponent('维修类型'));
    if (body.data.items?.length) typeList.value = body.data.items.map((x) => x.value);
  } catch { /* ignore */ }
  try {
    const body = await api.get('/api/equipment?page=1&pageSize=500');
    equipOptions.value = body.data.items.map((e) => ({ tag_no: e.tag_no, name: e.name }));
  } catch { /* ignore */ }

  if (isEdit) {
    try {
      const body = await getRepair(route.params.id);
      Object.assign(form.value, {
        tag_no: body.data.tag_no,
        report_date: body.data.report_date,
        repair_type: body.data.repair_type,
        status: body.data.status,
        worker: body.data.worker,
        repair_date: body.data.repair_date || '',
        fault_desc: body.data.fault_desc,
        cause: body.data.cause || '',
        repair_content: body.data.repair_content,
        action: body.data.action || '',
        remark: body.data.remark || '',
        repair_no: body.data.repair_no,
        equipment_name_snapshot: body.data.equipment_name_snapshot,
      });
      form.value._version = body.data.version;
    } catch (e) {
      error.value = e.error?.message || '加载失败';
    }
  }
});

async function submit() {
  submitting.value = true;
  error.value = '';
  const payload = { ...form.value };
  delete payload._version;
  delete payload.repair_no;
  delete payload.equipment_name_snapshot;
  try {
    if (isEdit) {
      await updateRepair(route.params.id, { ...payload, version: form.value._version });
    } else {
      await createRepair(payload);
    }
    router.push({ name: 'repair-list' });
  } catch (e) {
    error.value = e.error?.message || '保存失败';
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
h3 { margin-bottom: 16px; }
.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}
label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--text-light); }
label .req { color: var(--danger); }
label input, label select, label textarea { color: var(--text); }
label textarea { resize: vertical; }
.full { grid-column: 1 / -1; }
.static-text { color: var(--text); font-size: 14px; padding: 8px 0; }
.buttons { display: flex; gap: 10px; margin-top: 8px; }
</style>