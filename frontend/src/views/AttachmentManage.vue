<template>
  <div class="page">
    <div class="card toolbar">
      <h3>设备附件</h3>
      <div class="search-row">
        <input v-model="tagNo" placeholder="设备位号（必填）" class="w-160" />
        <input v-model="repairNo" placeholder="维修单号（可选）" class="w-180" />
        <button type="button" @click="load">加载</button>
        <button type="button" class="secondary" @click="clear">清空</button>
      </div>
    </div>

    <p v-if="error" class="msg-error">{{ error }}</p>

    <div class="card">
      <h3>上传附件（说明书 / 图纸 / 合格证等）</h3>
      <form class="upload-form" @submit.prevent="upload">
        <label>
          附件类型 <b class="req">*</b>
          <select v-model="fileType" required>
            <option v-for="v in attTypes" :key="v" :value="v">{{ v }}</option>
          </select>
        </label>
        <label class="full">
          说明
          <input v-model="description" placeholder="附件说明" />
        </label>
        <label class="full picker">
          选择文件
          <input ref="fileInput" type="file" @change="onFile" />
          <span v-if="selected" class="file-hint">已选择：{{ selected.name }}</span>
        </label>
        <div class="buttons full">
          <button type="submit" :disabled="uploading || !selected">上传</button>
        </div>
      </form>
    </div>

    <div class="card">
      <h3>附件列表（{{ attachments.length }}）</h3>
      <table v-if="attachments.length">
        <thead>
          <tr>
            <th>文件名</th><th>类型</th><th>说明</th><th>上传人</th><th>上传时间</th><th>大小</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in attachments" :key="a.id">
            <td>{{ a.file_name }}</td>
            <td>{{ a.file_type }}</td>
            <td>{{ a.description || '-' }}</td>
            <td>{{ a.uploader }}</td>
            <td>{{ a.created_at }}</td>
            <td>{{ humanSize(a.size) }}</td>
            <td class="ops">
              <a :href="a.download_url" download>下载</a>
              <a v-if="auth.isAdmin" href="javascript:;" class="danger" @click="del(a)">删除</a>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty">暂无附件</p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api/client';
import { listAttachments, removeAttachment, uploadFile } from '../api/files';
import { useAuthStore } from '../store/auth';

const auth = useAuthStore();
const tagNo = ref('');
const repairNo = ref('');
const attachments = ref([]);
const attTypes = ref([]);
const fileType = ref('');
const description = ref('');
const selected = ref(null);
const uploading = ref(false);
const error = ref('');
const fileInput = ref(null);

function humanSize(bytes) {
  if (bytes == null) return '-';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

async function loadTypes() {
  try {
    const body = await api.get('/api/dicts?type=' + encodeURIComponent('附件类型'));
    if (body.data.items?.length) {
      attTypes.value = body.data.items.map((x) => x.value);
    } else {
      attTypes.value = ['说明书', '图纸', 'P&ID', '合格证', '检定证书', '其他'];
    }
  } catch {
    attTypes.value = ['说明书', '图纸', 'P&ID', '合格证', '检定证书', '其他'];
  }
}

async function load() {
  error.value = '';
  const tag = tagNo.value.trim();
  if (!tag && !repairNo.value.trim()) {
    attachments.value = [];
    return;
  }
  try {
    const params = tag ? { tag_no: tag } : {};
    if (repairNo.value.trim()) params.repair_no = repairNo.value.trim();
    const body = await listAttachments(params);
    attachments.value = body.data;
  } catch (e) {
    error.value = e.error?.message || '加载失败';
  }
}

function clear() {
  tagNo.value = '';
  repairNo.value = '';
  attachments.value = [];
  selected.value = null;
  if (fileInput.value) fileInput.value.value = '';
}

function onFile(e) {
  selected.value = e.target.files?.[0] || null;
}

async function upload() {
  if (!tagNo.value.trim()) {
    alert('请先填写设备位号');
    return;
  }
  uploading.value = true;
  error.value = '';
  try {
    await uploadFile({
      kind: 'attachment',
      tagNo: tagNo.value.trim(),
      repairNo: repairNo.value.trim(),
      type: fileType.value,
      file: selected.value,
      description: description.value,
    });
    selected.value = null;
    if (fileInput.value) fileInput.value.value = '';
    description.value = '';
    await load();
  } catch (e) {
    error.value = e.error?.message || '上传失败';
  } finally {
    uploading.value = false;
  }
}

async function del(a) {
  if (!confirm(`确认删除附件「${a.file_name}」？`)) return;
  try {
    await removeAttachment(a.id);
    await load();
  } catch (e) {
    alert(e.error?.message || '删除失败');
  }
}

onMounted(() => {
  loadTypes();
  load();
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
.w-180 { width: 180px; }
.upload-form {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}
.upload-form label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--text-light); }
.req { color: var(--danger); }
.full { grid-column: 1 / -1; }
.buttons { display: flex; gap: 10px; }
.file-hint { color: var(--text); }
table { width: 100%; border-collapse: collapse; margin-top: 8px; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); font-size: 13px; }
th { background: #f9fafb; color: var(--text-light); white-space: nowrap; }
.ops a { margin-right: 8px; }
a.danger { color: var(--danger); }
.empty { color: var(--text-light); padding: 24px; text-align: center; }
</style>