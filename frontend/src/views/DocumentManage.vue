<template>
  <div class="page">
    <div class="card toolbar">
      <h3>文档管理</h3>
      <div class="search-row">
        <input v-model="q" placeholder="名称 / 文件名" class="w-200" @keyup.enter="load" />
        <select v-model="category" @change="load">
          <option value="">全部分类</option>
          <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
        </select>
        <button type="button" @click="load">查询</button>
      </div>
    </div>

    <p v-if="error" class="msg-error">{{ error }}</p>
    <p v-if="notice" class="msg-ok">{{ notice }}</p>

    <div class="card">
      <h3>上传文档（表格 / Word / PDF 等）</h3>
      <form class="upload-form" @submit.prevent="upload">
        <label>
          分类（可选）
          <input v-model="newCategory" list="doc-categories" placeholder="如：规章制度、操作规程" />
          <datalist id="doc-categories">
            <option v-for="c in categories" :key="c" :value="c" />
          </datalist>
        </label>
        <label class="full">
          备注（可选）
          <input v-model="newRemark" placeholder="文档说明" />
        </label>
        <label class="full picker">
          选择文件（可多选）
          <input ref="fileInput" type="file" multiple @change="onFile" />
          <span v-if="selected.length" class="file-hint">已选择 {{ selected.length }} 个文件</span>
        </label>
        <ul v-if="selected.length" class="picked-list full">
          <li v-for="f in selected" :key="f.name">
            <span>{{ f.name }}</span>
            <span class="muted">{{ humanSize(f.size) }}</span>
          </li>
        </ul>
        <div class="buttons full">
          <button type="submit" :disabled="uploading || !selected.length">{{ uploading ? '上传中…' : '上传' }}</button>
        </div>
      </form>
    </div>

    <div class="card">
      <h3>文档列表（{{ total }}）</h3>
      <div class="table-wrap">
        <table v-if="items.length">
          <thead>
            <tr>
              <th>名称</th><th>类型</th><th>大小</th><th>分类</th><th>上传人</th><th>上传时间</th><th>备注</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in items" :key="d.id">
              <td class="name-cell">{{ d.title }}</td>
              <td><span class="ext">{{ (d.ext || '-').toUpperCase() }}</span></td>
              <td>{{ humanSize(d.size) }}</td>
              <td>{{ d.category || '-' }}</td>
              <td>{{ d.uploader || '-' }}</td>
              <td>{{ d.created_at }}</td>
              <td>{{ d.remark || '-' }}</td>
              <td class="ops">
                <a :href="d.download_url" download>下载</a>
                <a v-if="auth.isAdmin" href="javascript:;" class="danger" @click="del(d)">删除</a>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else class="empty">暂无文档，选择文件后点击「上传」</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { listDocuments, documentCategories, uploadDocument, removeDocument } from '../api/document';
import { useAuthStore } from '../store/auth';

const auth = useAuthStore();
const q = ref('');
const category = ref('');
const items = ref([]);
const categories = ref([]);
const total = ref(0);
const error = ref('');
const notice = ref('');
const selected = ref([]);
const newCategory = ref('');
const newRemark = ref('');
const uploading = ref(false);
const fileInput = ref(null);

function humanSize(bytes) {
  if (bytes == null) return '-';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function onFile(e) {
  selected.value = Array.from(e.target.files || []);
}

async function load() {
  error.value = '';
  try {
    const body = await listDocuments({ q: q.value.trim(), category: category.value, pageSize: 100 });
    items.value = body.data.items;
    total.value = body.data.total;
  } catch (e) {
    error.value = e.error?.message || '加载失败';
  }
}

async function loadCategories() {
  try {
    const body = await documentCategories();
    categories.value = body.data || [];
  } catch { /* ignore */ }
}

async function upload() {
  if (!selected.value.length) return;
  uploading.value = true;
  error.value = '';
  notice.value = '';
  const files = [...selected.value];
  let done = 0;
  const failed = [];
  for (const file of files) {
    try {
      await uploadDocument({
        file,
        category: newCategory.value.trim(),
        remark: newRemark.value.trim(),
      });
      done += 1;
    } catch (e) {
      failed.push(`${file.name}：${e.error?.message || '上传失败'}`);
    }
  }
  uploading.value = false;
  selected.value = [];
  if (fileInput.value) fileInput.value.value = '';
  if (failed.length) {
    error.value = `成功 ${done} 个，失败 ${failed.length} 个 —— ${failed.join('；')}`;
  } else {
    notice.value = `已上传 ${done} 个文档`;
  }
  await load();
  await loadCategories();
}

async function del(d) {
  if (!confirm(`确认删除文档「${d.title}」？`)) return;
  try {
    await removeDocument(d.id);
    await load();
    await loadCategories();
  } catch (e) {
    alert(e.error?.message || '删除失败');
  }
}

onMounted(async () => {
  await load();
  await loadCategories();
});
</script>

<style scoped>
.msg-ok {
  color: #15803d;
  font-size: 13px;
  margin-top: 8px;
}
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
.upload-form {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}
.upload-form label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--text-light); }
.full { grid-column: 1 / -1; }
.buttons { display: flex; gap: 10px; }
.file-hint { color: var(--text); font-size: 12px; }
.picked-list {
  list-style: none;
  margin: 0;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  max-height: 160px;
  overflow: auto;
  font-size: 13px;
}
.picked-list li { display: flex; justify-content: space-between; gap: 12px; padding: 3px 0; }
.muted { color: var(--text-light); }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; margin-top: 6px; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); font-size: 13px; }
th { background: #f9fafb; color: var(--text-light); white-space: nowrap; }
.name-cell { min-width: 160px; word-break: break-all; }
.ext {
  display: inline-block;
  background: #eef2ff;
  color: #4338ca;
  border-radius: 6px;
  padding: 1px 8px;
  font-size: 12px;
}
.ops a { margin-right: 8px; }
a.danger { color: var(--danger); }
.empty { color: var(--text-light); padding: 24px; text-align: center; }
@media (max-width: 768px) {
  .w-200 { width: 100%; }
}
</style>
