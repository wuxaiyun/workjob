<template>
  <div class="page">
    <p v-if="error" class="msg-error">{{ error }}</p>

    <template v-if="d">
      <!-- 操作条 -->
      <div class="card toolbar">
        <div class="ops">
          <button class="secondary" @click="$router.back()">返回</button>
          <button class="secondary" @click="printWorkOrder">打印工单</button>
          <router-link v-if="canEdit" :to="{ name: 'repair-edit', params: { id: d.id } }">
            <button class="secondary">编辑</button>
          </router-link>
          <router-link :to="{ name: 'equipment-detail', params: { tagNo: d.tag_no } }">
            <button class="secondary">查看设备</button>
          </router-link>
        </div>
        <div class="status-bar">
          <span class="badge" :class="statusClass(d.status)">{{ d.status }}</span>
          <select v-if="canTransition" v-model="nextStatus" class="w-120">
            <option v-for="v in nextOptions" :key="v" :value="v">{{ v }}</option>
          </select>
          <button v-if="canTransition" @click="applyStatus">更新状态</button>
          <button v-if="auth.isAdmin && !d.deleted_at" class="danger" @click="del">删除工单</button>
        </div>
      </div>

      <!-- 基本信息 -->
      <div class="card info-card">
        <h3>{{ d.repair_no }}（{{ d.equipment_name_snapshot }}）</h3>
        <table class="kv">
          <tr>
            <th>设备位号</th><td>{{ d.tag_no }}</td>
            <th>所属项目（快照）</th><td>{{ d.project_snapshot || '-' }}</td>
            <th>所属部门（快照）</th><td>{{ d.department_snapshot || '-' }}</td>
          </tr>
          <tr>
            <th>故障现象</th><td colspan="5">{{ d.fault_desc }}</td>
          </tr>
          <tr>
            <th>故障原因</th><td colspan="5">{{ d.cause || '-' }}</td>
          </tr>
          <tr>
            <th>维修内容</th><td colspan="5">{{ d.repair_content }}</td>
          </tr>
          <tr>
            <th>处理措施</th><td colspan="5">{{ d.action || '-' }}</td>
          </tr>
          <tr>
            <th>维修类别</th><td>{{ d.repair_type }}</td>
            <th>报修日期</th><td>{{ d.report_date }}</td>
            <th>维修日期</th><td>{{ d.repair_date || '-' }}</td>
          </tr>
          <tr>
            <th>维修人员</th><td>{{ d.worker }}</td>
            <th>登记人</th><td>{{ d.created_by }}</td>
            <th>创建时间</th><td>{{ d.created_at }}</td>
          </tr>
          <tr>
            <th>费用合计</th><td>{{ auth.isAdmin ? '￥' + (d.cost_total ?? 0) : '（仅管理员可见）' }}</td>
            <th>备注</th><td colspan="3">{{ d.remark || '-' }}</td>
          </tr>
        </table>
      </div>

      <!-- 备件 -->
      <div class="card">
        <h3>备件更换记录</h3>
        <table v-if="d.parts.length">
          <thead>
            <tr>
              <th>备件名称</th><th>规格型号</th><th>数量</th><th>单位</th>
              <th>更换日期</th><th>金额</th><th v-if="auth.isAdmin">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in d.parts" :key="p.id">
              <td>{{ p.part_name }}</td><td>{{ p.part_model || '-' }}</td>
              <td>{{ p.part_qty }}</td><td>{{ p.part_unit }}</td>
              <td>{{ p.replace_date || '-' }}</td>
              <td>{{ p.cost != null ? '￥' + p.cost : '-' }}</td>
              <td v-if="auth.isAdmin"><a href="javascript:;" class="danger" @click="delPart(p)">删除</a></td>
            </tr>
          </tbody>
        </table>
        <p v-else class="empty">暂无备件记录</p>
        <form class="inline-form" @submit.prevent="addPart">
          <input v-model="part.part_name" placeholder="备件名称" required />
          <input v-model="part.part_model" placeholder="规格型号" />
          <input v-model.number="part.part_qty" type="number" min="1" placeholder="数量" required />
          <input v-model="part.part_unit" placeholder="单位" />
          <input v-model="part.replace_date" type="date" />
          <input v-model.number="part.cost" type="number" min="0" step="0.01" placeholder="金额" />
          <button type="submit" class="secondary">添加备件</button>
        </form>
      </div>

      <!-- 费用 -->
      <div class="card">
        <h3>维修费用</h3>
        <table v-if="d.costs.length">
          <thead>
            <tr>
              <th>费用类型</th><th>金额</th><th v-if="auth.isAdmin">工时</th>
              <th>费用日期</th><th v-if="auth.isAdmin">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="cd in d.costs" :key="cd.id">
              <td>{{ cd.cost_type }}</td>
              <td>{{ auth.isAdmin && cd.amount != null ? '￥' + cd.amount : '（仅管理员可见）' }}</td>
              <td v-if="auth.isAdmin">{{ cd.hours ?? '-' }}</td>
              <td>{{ cd.cost_date || '-' }}</td>
              <td v-if="auth.isAdmin"><a href="javascript:;" class="danger" @click="delCost(cd)">删除</a></td>
            </tr>
          </tbody>
        </table>
        <p v-else class="empty">暂无费用记录</p>
        <form class="inline-form" @submit.prevent="addCost">
          <input v-model="cost.cost_type" placeholder="费用类型" list="cost-types" required />
          <datalist id="cost-types">
            <option v-for="v in costTypes" :key="v" :value="v">{{ v }}</option>
          </datalist>
          <input v-model.number="cost.amount" type="number" min="0" step="0.01" placeholder="金额" />
          <input v-model.number="cost.hours" type="number" min="0" step="0.5" placeholder="工时" />
          <input v-model="cost.cost_date" type="date" />
          <button type="submit" class="secondary">登记费用</button>
        </form>
      </div>

      <!-- 照片 -->
      <div class="card">
        <h3>照片（{{ d.photos.length }}）</h3>
        <div v-if="d.photos.length" class="gallery">
          <img v-for="p in d.photos" :key="p.id" :src="p.thumb_url || p.image_url"
               :alt="p.photo_type" class="thumb" @click="preview = p.image_url" />
        </div>
        <p v-else class="empty">暂无照片</p>
        <router-link :to="{ name: 'photo', query: { tag_no: d.tag_no, repair_no: d.repair_no } }">
          <button class="secondary">上传 / 管理照片</button>
        </router-link>
      </div>

      <!-- 打印区域 -->
      <div class="print-area" id="print-area">
        <h2 class="center">设备维修工作单</h2>
        <p class="center">{{ d.repair_no }}</p>
        <table class="kv print-kv">
          <tr><th>设备名称</th><td>{{ d.equipment_name_snapshot }}</td><th>设备位号</th><td>{{ d.tag_no }}</td></tr>
          <tr><th>所属项目</th><td>{{ d.project_snapshot || '-' }}</td><th>所属部门</th><td>{{ d.department_snapshot || '-' }}</td></tr>
          <tr><th>维修类别</th><td>{{ d.repair_type }}</td><th>报修日期</th><td>{{ d.report_date }}</td></tr>
          <tr><th>维修人员</th><td>{{ d.worker }}</td><th>维修日期</th><td>{{ d.repair_date || '-' }}</td></tr>
          <tr><th>故障现象</th><td colspan="3">{{ d.fault_desc }}</td></tr>
          <tr><th>故障原因</th><td colspan="3">{{ d.cause || '-' }}</td></tr>
          <tr><th>维修内容</th><td colspan="3">{{ d.repair_content }}</td></tr>
          <tr><th>处理措施</th><td colspan="3">{{ d.action || '-' }}</td></tr>
          <tr><th>使用备件</th><td colspan="3">{{ partsText }}</td></tr>
          <tr><th>费用</th><td colspan="3">{{ d.cost_total ?? 0 > 0 ? '￥' + (d.cost_total ?? 0) : '-' }}</td></tr>
          <tr><th>备注</th><td colspan="3">{{ d.remark || '-' }}</td></tr>
        </table>
        <div class="signature">
          <p>维修人签字：__________</p>
          <p>验收人签字：__________</p>
          <p>日期：____年____月____日</p>
        </div>
      </div>
    </template>

    <!-- 图片预览 -->
    <div v-if="preview" class="lightbox" @click="preview = null">
      <img :src="preview" />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { getRepair, setRepairStatus, removeRepair, createPart, removePart, createCost, removeCost } from '../api/repair';
import { useAuthStore } from '../store/auth';

const route = useRoute();
const auth = useAuthStore();

const d = ref(null);
const error = ref('');
const preview = ref('');
const nextStatus = ref('');
const part = ref({ part_name: '', part_model: '', part_qty: 1, part_unit: '只', replace_date: '', cost: null });
const cost = ref({ cost_type: '维修费', amount: null, hours: null, cost_date: '' });
const costTypes = ['维修费', '材料费', '人工费', '外协费', '检修费', '其他'];

const canEdit = computed(() => {
  if (!d.value) return false;
  if (auth.isAdmin) return true;
  return d.value.created_by === auth.user?.username && !['已完成', '已关闭'].includes(d.value.status);
});

const FLOW = { 待处理: '处理中', 处理中: '待验收', 待验收: '已完成' };
const canTransition = computed(() => {
  if (!d.value) return false;
  if (auth.isAdmin) return !['已完成', '已关闭'].includes(d.value.status);
  return d.value.created_by === auth.user?.username && FLOW[d.value.status];
});
const nextOptions = computed(() => {
  if (!d.value) return [];
  if (auth.isAdmin) return ['待处理', '处理中', '待验收', '已完成', '已关闭'];
  return [FLOW[d.value.status]];
});
const partsText = computed(() => (d.value?.parts || [])
  .map((p) => `${p.part_name}×${p.part_qty}${p.part_unit}`).join('；') || '无');

function statusClass(s) {
  return { 待处理: 'warn', 处理中: 'warn', 待验收: 'warn', 已完成: 'ok', 已关闭: 'muted' }[s] || '';
}

async function load() {
  error.value = '';
  try {
    const body = await getRepair(route.params.id);
    d.value = body.data;
    nextStatus.value = body.data.status;
  } catch (e) {
    error.value = e.error?.message || '加载失败';
  }
}

async function applyStatus() {
  if (!d.value || nextStatus.value === d.value.status) return;
  if (!confirm(`确认将状态更新为「${nextStatus.value}」？`)) return;
  try {
    await setRepairStatus(d.value.id, nextStatus.value, d.value.version);
    await load();
  } catch (e) {
    alert(e.error?.message || '更新失败');
  }
}

async function del() {
  if (!confirm('确认删除该工单？可在回收站恢复。')) return;
  try {
    await removeRepair(d.value.id);
    window.history.back();
  } catch (e) {
    alert(e.error?.message || '删除失败');
  }
}

async function addPart() {
  try {
    await createPart({ repair_no: d.value.repair_no, tag_no: d.value.tag_no, ...part.value });
    part.value = { part_name: '', part_model: '', part_qty: 1, part_unit: '只', replace_date: '', cost: null };
    await load();
  } catch (e) {
    alert(e.error?.message || '添加失败');
  }
}

async function delPart(p) {
  if (!confirm(`确认删除备件「${p.part_name}」？`)) return;
  try {
    await removePart(p.id);
    await load();
  } catch (e) {
    alert(e.error?.message || '删除失败');
  }
}

async function addCost() {
  try {
    await createCost({ repair_no: d.value.repair_no, tag_no: d.value.tag_no, ...cost.value });
    cost.value = { cost_type: '维修费', amount: null, hours: null, cost_date: '' };
    await load();
  } catch (e) {
    alert(e.error?.message || '登记失败');
  }
}

async function delCost(cd) {
  if (!confirm('确认删除该费用记录？')) return;
  try {
    await removeCost(cd.id);
    await load();
  } catch (e) {
    alert(e.error?.message || '删除失败');
  }
}

function printWorkOrder() {
  document.body.classList.add('printing');
  window.print();
  setTimeout(() => document.body.classList.remove('printing'), 300);
}

onMounted(load);
</script>

<style scoped>
.toolbar {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
  align-items: center;
}
.ops { display: flex; gap: 8px; align-items: center; }
.status-bar { display: flex; gap: 8px; align-items: center; }
.w-120 { width: 120px; }
.info-card { margin-bottom: 12px; }
h3 { margin-bottom: 10px; }
table { width: 100%; border-collapse: collapse; }
th, td {
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}
table.kv th { width: 110px; background: #f9fafb; color: var(--text-light); white-space: nowrap; }
table.kv td { }
.empty { color: var(--text-light); padding: 12px 0; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 12px; }
.badge.ok { background: #dcfce7; color: #15803d; }
.badge.warn { background: #fef9c3; color: #a16207; }
.badge.muted { background: #f3f4f6; color: #6b7280; }
a.danger { color: var(--danger); }
.inline-form { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.inline-form input { width: 130px; }
.gallery { display: flex; flex-wrap: wrap; gap: 10px; }
.thumb {
  width: 120px;
  height: 90px;
  object-fit: cover;
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
}
.lightbox {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  cursor: pointer;
}
.lightbox img { max-width: 90vw; max-height: 90vh; }

.print-area {
  display: none;
}
.center { text-align: center; }
.signature { display: flex; justify-content: space-between; margin-top: 32px; }

@media print {
  body.printing * {
    visibility: hidden;
  }
  .print-area,
  .print-area * {
    visibility: visible;
  }
  .print-area {
    display: block;
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    padding: 20px;
  }
  .print-kv th { background: #f9fafb; }
  .lightbox { display: none !important; }
}
</style>