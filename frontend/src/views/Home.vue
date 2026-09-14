<template>
  <div class="page home">
    <!-- 搜索 -->
    <div class="card hero">
      <h1>设备维修台账</h1>
      <form class="search-box" @submit.prevent="doSearch">
        <input v-model="q" placeholder="输入设备位号 / 名称 / 型号 搜索设备" class="grow" />
        <button type="submit">搜索</button>
      </form>
      <div v-if="searchItems.length" class="search-results">
        <div v-for="it in searchItems" :key="it.tag_no" class="sr-item" @click="goDetail(it.tag_no)">
          <span class="sr-tag">{{ it.tag_no }}</span>
          <span>{{ it.name }}</span>
          <span class="muted">{{ it.category }} / {{ it.project || '-' }}</span>
        </div>
        <p v-if="searchDone && !searchItems.length" class="muted">未找到匹配设备</p>
      </div>
    </div>

    <p v-if="error" class="msg-error">{{ error }}</p>

    <div class="grid">
      <!-- 统计 -->
      <div class="card">
        <h3>统计概览</h3>
        <div class="stats">
          <div class="stat"><b>{{ admin ? stats.counts?.equipment ?? '-' : equipTotal ?? '-' }}</b><span>设备总数</span></div>
          <div class="stat"><b>{{ admin ? stats.counts?.repair ?? '-' : repairTotal ?? '-' }}</b><span>维修记录</span></div>
          <div class="stat"><b>{{ admin ? stats.counts?.staffed ?? '-' : '-' }}</b><span>维修中</span></div>
          <div class="stat"><b>{{ admin ? stats.counts?.calibration ?? '-' : '-' }}</b><span>检定记录</span></div>
          <div class="stat"><b>{{ admin ? '￥' + (stats.finance?.cost_sum ?? 0) : '-' }}</b><span>累计费用</span></div>
          <div class="stat"><b>{{ admin ? stats.counts?.photo ?? '-' : '-' }}</b><span>照片</span></div>
        </div>
      </div>

      <!-- 到期提醒 -->
      <div class="card">
        <h3>到期提醒（30 天内）</h3>
        <router-link :to="{ name: 'calibration' }" class="alert-row">
          <span>检定到期</span>
          <b class="warn-text">{{ alertCount.calibrations }} 项</b>
        </router-link>
        <router-link :to="{ name: 'calibration' }" class="alert-row">
          <span>强检设备到期</span>
          <b class="warn-text">{{ alertCount.mandatory }} 项</b>
        </router-link>
        <p v-if="!alertCount.calibrations && !alertCount.mandatory" class="muted">近期无到期，状态良好</p>
      </div>

      <!-- 快捷入口 -->
      <div class="card">
        <h3>快捷入口</h3>
        <div class="quick">
          <router-link :to="{ name: 'repair-new' }"><button>新增维修</button></router-link>
          <router-link :to="{ name: 'equipment-new' }"><button class="secondary">新增设备</button></router-link>
          <router-link :to="{ name: 'photo' }"><button class="secondary">上传照片</button></router-link>
          <router-link :to="{ name: 'repair-list' }"><button class="secondary">维修台账</button></router-link>
          <router-link v-if="admin" :to="{ name: 'importexport' }"><button class="secondary">导入导出</button></router-link>
          <router-link v-if="admin" :to="{ name: 'backup' }"><button class="secondary">数据备份</button></router-link>
        </div>
        <div v-if="admin" class="activity">
          <p class="muted">最近导入：{{ stats.activity?.last_import ? `${stats.activity.last_import.file_name}（成功 ${stats.activity.last_import.success_rows}/${stats.activity.last_import.fail_rows}）` : '无' }}</p>
          <p class="muted">最近备份：{{ stats.activity?.last_backup ? stats.activity.last_backup.file_name : '无' }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { listEquipment } from '../api/equipment';
import { systemStats, systemAlerts } from '../api/system';
import { listRepairs } from '../api/repair';
import { useAuthStore } from '../store/auth';

const router = useRouter();
const auth = useAuthStore();
const admin = auth.isAdmin;

const q = ref('');
const searchItems = ref([]);
const searchDone = ref(false);
const error = ref('');
const stats = ref({ counts: {}, finance: {}, activity: {} });
const alerts = ref({ calibrations: [], mandatory: [] });
const equipTotal = ref(null);
const repairTotal = ref(null);
const alertCount = ref({ calibrations: 0, mandatory: 0 });

async function doSearch() {
  const keyword = q.value.trim();
  searchDone.value = true;
  searchItems.value = [];
  if (!keyword) return;
  try {
    const body = await listEquipment({ q: keyword, page: 1, pageSize: 20 });
    const exact = body.data.items.find((x) => x.tag_no === keyword);
    if (exact) {
      router.push({ name: 'equipment-detail', params: { tagNo: exact.tag_no } });
      return;
    }
    searchItems.value = body.data.items;
  } catch (e) {
    error.value = e.error?.message || '搜索失败';
  }
}

function goDetail(tagNo) {
  router.push({ name: 'equipment-detail', params: { tagNo } });
}

onMounted(async () => {
  if (admin) {
    try {
      const b = await systemStats();
      stats.value = b.data;
    } catch { /* ignore */ }
  } else {
    try {
      const b = await listRepairs({ pageSize: 1 });
      repairTotal.value = b.data.total;
    } catch { /* ignore */ }
  }
  try {
    const b = await listEquipment({ page: 1, pageSize: 1 });
    equipTotal.value = b.data.total;
  } catch { /* ignore */ }
  try {
    const b = await systemAlerts(30);
    alerts.value = b.data;
    alertCount.value = { calibrations: b.data.calibrations.length, mandatory: b.data.mandatory.length };
  } catch { /* ignore */ }
});
</script>

<style scoped>
.hero {
  text-align: center;
  margin-bottom: 16px;
}
.hero h1 { margin-bottom: 16px; }
.search-box { display: flex; gap: 8px; max-width: 640px; margin: 0 auto; }
.search-box .grow { flex: 1; }
.search-results {
  max-width: 640px;
  margin: 12px auto 0;
  text-align: left;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
.sr-item {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 10px 12px;
  cursor: pointer;
  border-bottom: 1px solid var(--border);
}
.sr-item:hover { background: #f9fafb; }
.sr-item:last-child { border-bottom: none; }
.sr-tag { font-weight: 700; color: var(--primary); }
.muted { color: var(--text-light); font-size: 13px; }
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 16px;
}
.card h3 { margin-bottom: 12px; }
.stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.stat { background: #f9fafb; border-radius: 8px; padding: 12px; text-align: center; }
.stat b { display: block; font-size: 22px; color: var(--primary); }
.stat span { font-size: 12px; color: var(--text-light); }
.alert-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
}
.alert-row:last-child { border-bottom: none; }
.warn-text { color: #b45309; }
.quick { display: flex; flex-wrap: wrap; gap: 8px; }
.activity { margin-top: 14px; font-size: 12px; }
.activity p { margin-bottom: 4px; }
</style>