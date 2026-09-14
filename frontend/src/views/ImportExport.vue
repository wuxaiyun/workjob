<template>
  <div class="page">
    <p v-if="error" class="msg-error">{{ error }}</p>

    <!-- 导入 -->
    <div class="card">
      <h3>设备批量导入</h3>
      <p class="hint">支持 .xlsx / .csv。表头请使用模板文件中的中文表头；列可缺省，行为：预演只校验不落库，正式导入会跳过不合格行。</p>
      <div class="import-bar">
        <input ref="fileInput" type="file" accept=".xlsx,.xls,.csv" @change="onFile" />
        <select v-model="mode">
          <option value="insert">仅新增（已存在则跳过）</option>
          <option value="upsert">新增或更新（按位号）</option>
        </select>
        <button class="secondary" :disabled="!rows.length || busy" @click="run(true)">预演校验</button>
        <button :disabled="!rows.length || busy" @click="run(false)">正式导入</button>
        <button type="button" class="secondary" @click="downloadTemplate">下载导入模板</button>
      </div>
      <p v-if="fileInfo" class="hint">已读取：{{ fileInfo }}，识别 {{ rows.length }} 行（不合规行列将被跳过）</p>

      <template v-if="result">
        <div class="result-box">
          <p>
            {{ result.data.dry_run ? '预演结果' : '导入结果' }}：共 {{ result.data.total }} 行，
            将新增 {{ result.data.pre_created }} 行，将更新 {{ result.data.pre_updated }} 行，
            已处理成功 {{ result.data.success_count }} 行，失败 {{ result.data.fail_count }} 行。
          </p>
          <ul v-if="result.data.fails && result.data.fails.length" class="fails">
            <li v-for="(f, i) in result.data.fails" :key="i">{{ f.error }}</li>
          </ul>
        </div>
      </template>
    </div>

    <!-- 导出 -->
    <div class="card">
      <h3>设备导出</h3>
      <div class="import-bar">
        <select v-model="exportFilter.category">
          <option value="">全部类别</option>
          <option v-for="v in categories" :key="v" :value="v">{{ v }}</option>
        </select>
        <select v-model="exportFilter.status">
          <option value="">全部状态</option>
          <option v-for="v in statuses" :key="v" :value="v">{{ v }}</option>
        </select>
        <button class="secondary" :disabled="busy2" @click="exportExcel">导出 Excel</button>
        <button class="secondary" :disabled="busy2" @click="exportCsv">导出 CSV</button>
      </div>
    </div>

    <!-- 导入日志 -->
    <div class="card">
      <h3>历史导入记录</h3>
      <table v-if="logs.length">
        <thead>
          <tr>
            <th>#</th><th>类型</th><th>文件名</th><th>总行</th><th>成功</th><th>失败</th><th>操作人</th><th>时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in logs" :key="l.id">
            <td>{{ l.id }}</td><td>{{ l.import_type === 'equipment' ? '设备' : l.import_type }}</td>
            <td>{{ l.file_name }}</td><td>{{ l.total_rows }}</td>
            <td class="ok-text">{{ l.success_rows }}</td>
            <td :class="{ 'warn-text': l.fail_rows > 0 }">{{ l.fail_rows }}</td>
            <td>{{ l.operator }}</td><td>{{ l.created_at }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty">暂无导入记录</p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import * as XLSX from 'xlsx';
import { api } from '../api/client';
import { importEquipment, listImportLogs, exportEquipment } from '../api/system';

const HEADER_MAP = {
  位号: 'tag_no', 设备名称: 'name', 设备类别: 'category', 所属项目: 'project',
  项目编号: 'project_no', 所属部门: 'department', 安装位置: 'location',
  规格型号: 'model', 生产厂家: 'manufacturer', 供应商: 'supplier',
  出厂日期: 'factory_date', 出厂编号: 'factory_no', 投用日期: 'commission_date',
  资产编号: 'asset_no', 原值: 'original_value', 净值: 'net_value',
  是否强检: 'is_mandatory', 强检有效期: 'verify_valid_until', 状态: 'status', 备注: 'remark',
};

const fileInput = ref(null);
const mode = ref('insert');
const rows = ref([]);
const fileInfo = ref('');
const busy = ref(false);
const result = ref(null);
const logs = ref([]);
const error = ref('');
const error2 = ref('');

const categories = ref([]);
const statuses = ['在用', '停用', '报废'];
const exportFilter = ref({ category: '', status: '' });
const busy2 = ref(false);

function onFile(e) {
  const f = e.target.files?.[0];
  result.value = null;
  rows.value = [];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const wb = XLSX.read(reader.result, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, { defval: '' });
      const mapped = raw.map((r) => {
        const out = {};
        for (const [cn, v] of Object.entries(r)) {
          const key = HEADER_MAP[cn.trim()] || cn.trim();
          out[key] = v;
        }
        return out;
      });
      rows.value = mapped;
      fileInfo.value = `${f.name}（${wb.SheetNames.length} 个工作表）`;
    } catch (e) {
      error.value = '文件解析失败：' + (e.message || e);
    }
  };
  reader.readAsArrayBuffer(f);
}

async function run(dryRun) {
  busy.value = true;
  error.value = '';
  try {
    const body = await importEquipment(rows.value, mode.value, dryRun, fileInfo.value || 'import.xlsx');
    result.value = body;
    if (!dryRun) {
      await loadLogs();
    }
  } catch (e) {
    error.value = e.error?.message || '导入失败';
  } finally {
    busy.value = false;
  }
}

function downloadTemplate() {
  const headers = Object.keys(HEADER_MAP);
  const sample = {
    位号: 'TMP-001', 设备名称: '模板示例泵', 设备类别: '泵/风机', 所属项目: '一期项目',
    项目编号: 'PX-2024-01', 所属部门: '设备一处', 安装位置: 'A区新建线',
    规格型号: 'ISY-100', 生产厂家: '示例厂家', 供应商: '示例供应商',
    出厂日期: '2023-05-01', 出厂编号: 'SN20230501', 投用日期: '2023-07-01',
    资产编号: 'ZC-2023-0001', 原值: 8000, 净值: 6500,
    是否强检: '是', 强检有效期: '2027-06-30', 状态: '在用', 备注: '',
  };
  const ws = XLSX.utils.json_to_sheet([sample], { header: headers });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '设备导入模板');
  XLSX.writeFile(wb, '设备导入模板.xlsx');
}

async function fetchRows() {
  try {
    const body = await exportEquipment(exportFilter.value);
    return body.data;
  } catch (e) {
    throw e;
  }
}

function downloadBlob(content, fileName, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportExcel() {
  busy2.value = true;
  error.value = '';
  try {
    const data = await fetchRows();
    if (!data.length) {
      alert('没有可导出的数据');
      return;
    }
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '设备台账');
    XLSX.writeFile(wb, `设备台账_${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch (e) {
    error.value = e.error?.message || '导出失败';
  } finally {
    busy2.value = false;
  }
}

async function exportCsv() {
  busy2.value = true;
  error.value = '';
  try {
    const data = await fetchRows();
    if (!data.length) {
      alert('没有可导出的数据');
      return;
    }
    const ws = XLSX.utils.json_to_sheet(data);
    const csv = XLSX.utils.sheet_to_csv(ws);
    downloadBlob('\ufeff' + csv, `设备台账_${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8');
  } catch (e) {
    error.value = e.error?.message || '导出失败';
  } finally {
    busy2.value = false;
  }
}

async function loadLogs() {
  try {
    const body = await listImportLogs();
    logs.value = body.data;
  } catch { /* ignore */ }
}

onMounted(async () => {
  loadLogs();
  try {
    const body = await api.get('/api/dicts?type=' + encodeURIComponent('设备类别'));
    if (body.data.items?.length) categories.value = body.data.items.map((x) => x.value);
  } catch { /* ignore */ }
});
</script>

<style scoped>
.card { margin-bottom: 12px; }
.card h3 { margin-bottom: 10px; }
.hint { font-size: 13px; color: var(--text-light); margin-bottom: 8px; }
.import-bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.import-bar input[type='file'] { width: 240px; }
.result-box {
  margin-top: 12px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #f9fafb;
}
.fails { margin: 8px 0 0 18px; color: var(--danger); font-size: 13px; }
table { width: 100%; border-collapse: collapse; margin-top: 8px; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); font-size: 13px; }
th { background: #f9fafb; color: var(--text-light); white-space: nowrap; }
.ok-text { color: #15803d; }
.warn-text { color: #b45309; font-weight: 600; }
.empty { color: var(--text-light); padding: 18px; text-align: center; }
</style>