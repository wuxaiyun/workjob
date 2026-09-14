<template>
  <div class="page">
    <div v-if="loading">加载中…</div>
    <div v-else-if="error" class="card">
      <p class="msg-error">{{ error }}</p>
      <router-link :to="{ name: 'equipment' }">返回列表</router-link>
    </div>

    <template v-else-if="equip">
      <div class="head">
        <router-link :to="{ name: 'equipment' }">← 返回列表</router-link>
        <div class="head-ops">
          <span class="badge" :class="statusClass(equip.status)">{{ equip.status }}</span>
          <router-link :to="{ name: 'repair-list', query: { tag_no: equip.tag_no } }"><button class="secondary">维修记录</button></router-link>
          <router-link :to="{ name: 'photo', query: { tag_no: equip.tag_no } }"><button class="secondary">照片</button></router-link>
          <router-link :to="{ name: 'attachment', query: { tag_no: equip.tag_no } }"><button class="secondary">附件</button></router-link>
          <button class="secondary" @click="printLabel">打印标签</button>
          <button class="secondary" @click="goEdit">编辑</button>
          <button v-if="auth.isAdmin && equip.status !== '停用'" class="danger" @click="toggleStatus('停用')">停用</button>
          <button v-if="auth.isAdmin && equip.status === '停用'" class="secondary" @click="toggleStatus('在用')">启用</button>
        </div>
      </div>

      <!-- 基本信息 -->
      <div class="card block">
        <h3>基本信息</h3>
        <div class="grid">
          <div v-for="f in detailFields" :key="f.key" class="cell" :class="{ wide: f.key === 'remark' }">
            <div class="label">{{ f.label }}</div>
            <div class="value">{{ displayValue(equip[f.key]) }}</div>
          </div>
        </div>
      </div>

      <!-- 分类专属参数（extra_data 动态渲染） -->
      <div v-if="extraGroups.length" class="card block">
        <h3>分类专属参数（{{ equip.category }}）</h3>
        <div v-for="g in extraGroups" :key="g.name" class="group">
          <button class="group-head" @click="toggleGroup(g.name)">
            <span>{{ g.name }}</span>
            <span>{{ collapsed[g.name] ? '▸' : '▾' }}</span>
          </button>
          <div v-show="!collapsed[g.name]" class="grid content">
            <div v-for="f in g.fields" :key="f.field_key" class="cell">
              <div class="label">{{ f.field_label }}</div>
              <div class="value">{{ displayValue(extraData[f.field_key]) }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 现场照片 -->
      <div class="card block">
        <h3>现场照片（{{ equip.photos?.length || 0 }}）</h3>
        <div v-if="equip.photos?.length" class="gallery">
          <router-link v-for="p in equip.photos" :key="p.id" :to="{ name: 'photo', query: { tag_no: equip.tag_no } }">
            <img :src="p.thumb_url || p.image_url" class="thumb" :alt="p.photo_type" />
          </router-link>
        </div>
        <p v-else class="muted">暂无照片，点击右上角「照片」上传</p>
      </div>

      <!-- 维修历史 -->
      <div class="card block">
        <h3>维修历史（{{ equip.repairs?.length || 0 }}）</h3>
        <p v-if="!equip.repairs?.length" class="muted">暂无维修记录</p>
        <table v-else>
          <thead>
            <tr>
              <th>维修单号</th>
              <th>报修日期</th>
              <th>维修类别</th>
              <th>状态</th>
              <th>维修人员</th>
              <th>故障描述</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in equip.repairs" :key="r.id">
              <td>{{ r.repair_no }}</td>
              <td>{{ r.report_date }}</td>
              <td>{{ r.repair_type }}</td>
              <td><span class="badge" :class="'r-' + r.status">{{ r.status }}</span></td>
              <td>{{ r.worker || '-' }}</td>
              <td class="ellipsis">{{ r.fault_desc }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 打印标签 -->
      <div class="print-area" id="print-area">
        <div class="label">
          <img v-if="qrDataUrl" :src="qrDataUrl" class="qr" alt="qr" />
          <div class="label-info">
            <h3>{{ equip.name }}</h3>
            <table class="label-kv">
              <tr><td>位号</td><td class="bold">{{ equip.tag_no }}</td></tr>
              <tr><td>类别</td><td>{{ equip.category }}</td></tr>
              <tr><td>型号</td><td>{{ equip.model || '-' }}</td></tr>
              <tr><td>所属部门</td><td>{{ equip.department || '-' }}</td></tr>
              <tr><td>安装位置</td><td>{{ equip.location || '-' }}</td></tr>
              <tr><td>投用日期</td><td>{{ equip.commission_date || '-' }}</td></tr>
              <tr><td>状态</td><td>{{ equip.status }}</td></tr>
            </table>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { getEquipment, setEquipmentStatus } from '../api/equipment';
import { DETAIL_FIELDS } from '../utils/fields';
import { useAuthStore } from '../store/auth';

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();

const loading = ref(true);
const error = ref('');
const equip = ref(null);
const collapsed = ref({});
const qrDataUrl = ref('');

const detailFields = DETAIL_FIELDS;
const extraData = computed(() => equip.value?.extra_data || {});
const extraGroups = computed(() => {
  const cfg = equip.value?.field_config || [];
  const groups = {};
  for (const f of cfg) {
    if (f.is_visible_detail !== '1') continue;
    const name = f.group_name || '其他参数';
    (groups[name] ||= []).push(f);
  }
  return Object.entries(groups).map(([name, fields]) => ({ name, fields }));
});

function displayValue(v) {
  if (v === null || v === undefined || v === '') return '-';
  return v;
}
function statusClass(s) {
  return { 在用: 'ok', 停用: 'muted', 报废: 'danger' }[s] || '';
}
function toggleGroup(name) {
  collapsed.value[name] = !collapsed.value[name];
}
function goEdit() {
  router.push({ name: 'equipment-edit', params: { tagNo: route.params.tagNo } });
}
async function toggleStatus(status) {
  if (!confirm(`确认将设备「${equip.value.name}」${status === '停用' ? '停用' : '启用'}？`)) return;
  try {
    await setEquipmentStatus(route.params.tagNo, { status });
    await load();
  } catch (e) {
    alert(e.error?.message || '操作失败');
  }
}
async function load() {
  loading.value = true;
  error.value = '';
  try {
    const body = await getEquipment(route.params.tagNo);
    equip.value = body.data;
    genQr();
  } catch (e) {
    error.value = e.error?.message || '加载失败';
  } finally {
    loading.value = false;
  }
}

async function genQr() {
  try {
    const QR = (await import('qrcode')).default;
    qrDataUrl.value = await QR.toDataURL(route.params.tagNo, { width: 180, margin: 1 });
  } catch {
    qrDataUrl.value = '';
  }
}

function printLabel() {
  document.body.classList.add('printing');
  window.print();
  setTimeout(() => document.body.classList.remove('printing'), 300);
}

onMounted(load);
</script>

<style scoped>
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.head-ops {
  display: flex;
  align-items: center;
  gap: 8px;
}
.block {
  margin-bottom: 12px;
}
.block h3 {
  font-size: 15px;
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}
.grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
.cell.wide {
  grid-column: span 4;
}
.cell .label {
  color: var(--text-light);
  font-size: 12px;
  margin-bottom: 2px;
}
.cell .value {
  font-size: 14px;
}
.group {
  border: 1px solid var(--border);
  border-radius: 6px;
  margin-bottom: 8px;
  overflow: hidden;
}
.group-head {
  display: flex;
  justify-content: space-between;
  width: 100%;
  background: #f9fafb;
  color: var(--text);
  text-align: left;
  border-radius: 0;
  padding: 10px 12px;
  font-size: 13px;
  font-weight: bold;
}
.group .content {
  padding: 10px 12px;
}
.muted {
  color: var(--text-light);
}
table {
  width: 100%;
  border-collapse: collapse;
}
th, td {
  text-align: left;
  padding: 7px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}
th {
  background: #f9fafb;
  color: var(--text-light);
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
.badge.r-待处理 { background: #fef9c3; color: #854d0e; }
.badge.r-处理中 { background: #dbeafe; color: #1d4ed8; }
.badge.r-已完成 { background: #dcfce7; color: #15803d; }
.badge.r-待验收 { background: #f3e8ff; color: #7e22ce; }
.ellipsis {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gallery {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.thumb {
  width: 96px;
  height: 72px;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid var(--border);
}
.print-area {
  display: none;
}
.label {
  display: flex;
  gap: 16px;
  padding: 16px;
}
.label .qr {
  width: 140px;
  height: 140px;
}
.label h3 {
  margin-bottom: 8px;
}
.label-kv {
  border-collapse: collapse;
}
.label-kv td {
  border: none;
  padding: 2px 12px 2px 0;
  font-size: 13px;
}
.label-kv .bold {
  font-weight: 700;
}
</style>

<style>
@media print {
  body.printing .page > :not(.print-area) { display: none !important; }
  body.printing .print-area {
    display: block !important;
  }
  body.printing .print-area .label {
    border: 1px solid #111;
    border-radius: 4px;
  }
}
</style>