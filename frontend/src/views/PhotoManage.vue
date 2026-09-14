<template>
  <div class="page">
    <div class="card toolbar">
      <h3>设备照片</h3>
      <div class="search-row">
        <input v-model="tagNo" placeholder="设备位号（必填）" required class="w-160" />
        <input v-model="repairNo" placeholder="维修单号（可选）" class="w-180" />
        <button type="button" @click="load">加载</button>
        <button type="button" class="secondary" @click="clear">清空筛选</button>
      </div>
    </div>

    <p v-if="error" class="msg-error">{{ error }}</p>

    <div class="card">
      <h3>上传照片</h3>
      <form class="upload-form" @submit.prevent="upload">
        <label>
          照片类型 <b class="req">*</b>
          <select v-model="photoType" required>
            <option v-for="v in photoTypes" :key="v" :value="v">{{ v }}</option>
          </select>
        </label>
        <label>
          拍摄时间
          <input v-model="photoTime" type="date" />
        </label>
        <label>
          拍摄人
          <input v-model="photographer" />
        </label>
        <label class="full">
          说明
          <input v-model="description" placeholder="照片说明" />
        </label>
        <label class="full picker">
          选择图片
          <input ref="fileInput" type="file" accept="image/*" @change="onFile" />
          <span v-if="selected" class="file-hint">已选择：{{ selected.name }}（将自动压缩并生成缩略图）</span>
        </label>
        <div class="buttons full">
          <button type="submit" :disabled="uploading || !selected">上传</button>
          <button type="button" class="secondary" @click="resetPick">清除选择</button>
        </div>
      </form>
    </div>

    <div class="card">
      <h3>照片（{{ photos.length }}）</h3>
      <div v-if="photos.length" class="gallery">
        <div v-for="p in photos" :key="p.id" class="item">
          <img :src="p.thumb_url || p.image_url" :alt="p.photo_type" class="thumb" @click="preview = p.image_url" />
          <div class="meta">
            <span class="tag">{{ p.photo_type }}</span>
            <span v-if="p.photo_time">{{ p.photo_time }}</span>
          </div>
          <p v-if="p.description" class="desc">{{ p.description }}</p>
          <div class="ops">
            <a href="javascript:;" :download="p.file_name" :href="p.image_url">下载</a>
            <a v-if="auth.isAdmin" href="javascript:;" class="danger" @click="del(p)">删除</a>
          </div>
        </div>
      </div>
      <p v-else class="empty">暂无照片，请选择设备位号并上传</p>
    </div>

    <div v-if="preview" class="lightbox" @click="preview = null">
      <img :src="preview" />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api/client';
import { listPhotos, removePhoto, uploadFile, makeThumbnail } from '../api/files';
import { useAuthStore } from '../store/auth';

const route = useRoute();
const auth = useAuthStore();

const tagNo = ref(route.query.tag_no || '');
const repairNo = ref(route.query.repair_no || '');
const photos = ref([]);
const photoTypes = ref([]);
const photoType = ref('');
const photoTime = ref(new Date().toISOString().slice(0, 10));
const photographer = ref(auth.user?.real_name || auth.user?.username || '');
const description = ref('');
const selected = ref(null);
const thumbnail = ref(null);
const uploading = ref(false);
const error = ref('');
const preview = ref('');
const fileInput = ref(null);

async function loadTypes() {
  try {
    const body = await api.get('/api/dicts?type=' + encodeURIComponent('照片类型'));
    if (body.data.items?.length) {
      photoTypes.value = body.data.items.map((x) => x.value);
    } else {
      photoTypes.value = ['设备现场', '维修前', '维修后', '故障部位', '铭牌', '备件', '其他'];
    }
  } catch {
    photoTypes.value = ['设备现场', '维修前', '维修后', '故障部位', '铭牌', '备件', '其他'];
  }
}

async function load() {
  error.value = '';
  const tag = tagNo.value.trim();
  if (!tag && !repairNo.value.trim()) {
    photos.value = [];
    return;
  }
  try {
    const params = tag ? { tag_no: tag } : {};
    if (repairNo.value.trim()) params.repair_no = repairNo.value.trim();
    const body = await listPhotos(params);
    photos.value = body.data;
  } catch (e) {
    error.value = e.error?.message || '加载失败';
  }
}

function clear() {
  tagNo.value = '';
  repairNo.value = '';
  photos.value = [];
  resetPick();
}

async function onFile(e) {
  const f = e.target.files?.[0];
  selected.value = f || null;
  if (!f) return;
  try {
    thumbnail.value = await makeThumbnail(f, 480, 0.72);
  } catch {
    thumbnail.value = null;
  }
}

function resetPick() {
  selected.value = null;
  thumbnail.value = null;
  if (fileInput.value) fileInput.value.value = '';
}

async function upload() {
  const tag = tagNo.value.trim();
  if (!tag) {
    alert('请先填写设备位号');
    return;
  }
  uploading.value = true;
  error.value = '';
  try {
    await uploadFile({
      kind: 'photo',
      tagNo: tag,
      repairNo: repairNo.value.trim(),
      type: photoType.value,
      file: selected.value,
      thumbnail: thumbnail.value,
      description: description.value,
      photographer: photographer.value,
      photoTime: photoTime.value,
    });
    resetPick();
    await load();
  } catch (e) {
    error.value = e.error?.message || '上传失败';
  } finally {
    uploading.value = false;
  }
}

async function del(p) {
  if (!confirm('确认删除该照片（R2 中的原图与缩略图将一并清除）？')) return;
  try {
    await removePhoto(p.id);
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
.gallery { display: flex; flex-wrap: wrap; gap: 14px; }
.item {
  width: 190px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px;
}
.thumb {
  width: 100%;
  height: 130px;
  object-fit: cover;
  border-radius: 6px;
  cursor: pointer;
  background: #f3f4f6;
}
.meta { display: flex; align-items: center; gap: 8px; margin-top: 6px; font-size: 12px; color: var(--text-light); }
.tag { background: #dbeafe; color: #1d4ed8; padding: 1px 8px; border-radius: 10px; }
.desc { font-size: 12px; color: var(--text); margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ops { margin-top: 6px; font-size: 13px; }
.ops a { margin-right: 8px; }
a.danger { color: var(--danger); }
.empty { color: var(--text-light); padding: 24px; text-align: center; }
.lightbox {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  cursor: pointer;
}
.lightbox img { max-width: 92vw; max-height: 92vh; }
</style>