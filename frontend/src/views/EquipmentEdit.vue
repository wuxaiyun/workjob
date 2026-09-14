<template>
  <div class="page">
    <div class="card">
      <h3>{{ isEdit ? `编辑设备 ${tagNo}` : (mode === 'quick' ? '快速新增设备' : '完整新增设备') }}</h3>

      <div v-if="isEdit && loading">加载中…</div>

      <form v-else class="form" @submit.prevent="submit">
        <p v-if="error" class="msg-error">{{ error }}</p>

        <!-- 快速模式：只填四项 -->
        <template v-if="mode === 'quick'">
          <label>位号 <span class="req">*</span></label>
          <input v-model="form.tag_no" :disabled="isEdit" placeholder="如 PUMP-001" />
          <label>设备名称 <span class="req">*</span></label>
          <input v-model="form.name" placeholder="如 循环水泵" />
          <label>设备类别 <span class="req">*</span></label>
          <input v-model="form.category" list="quick-cat" placeholder="选择或输入新类别" />
          <datalist id="quick-cat">
            <option v-for="v in dicts['设备类别'] || []" :key="v" :value="v">{{ v }}</option>
          </datalist>
          <label>所属项目 <span class="req">*</span></label>
          <input v-model="form.project" placeholder="如 二期项目" />
        </template>

        <!-- 完整模式 -->
        <template v-else>
          <div class="grid">
            <div v-for="f in commonFields" :key="f.key" class="field">
              <label>{{ f.label }} <span v-if="f.required" class="req">*</span></label>
              <input
                v-if="f.type === 'text' || f.type === 'number'"
                :type="f.type"
                v-model="form[f.key]"
                :disabled="f.key === 'tag_no' && isEdit"
              />
              <template v-else-if="f.type === 'select' && f.combobox">
                <input v-model="form[f.key]" :list="'dl-' + f.key" :placeholder="`选择或输入新${f.label}`" />
                <datalist :id="'dl-' + f.key">
                  <option v-for="v in selectOptions(f)" :key="v" :value="v">{{ v }}</option>
                </datalist>
              </template>
              <input v-else-if="f.type === 'date' && f.key !== 'status'" type="date" v-model="form[f.key]" />
              <select
                v-else-if="f.type === 'select'"
                v-model="form[f.key]"
                :required="!!f.required"
              >
                <option v-if="!f.required" value="">请选择</option>
                <option v-for="v in selectOptions(f)" :key="v" :value="v">{{ v }}</option>
              </select>
              <textarea v-else-if="f.type === 'textarea'" v-model="form[f.key]" rows="3" />
            </div>
          </div>
        </template>

        <!-- 分类专属字段 -->
        <template v-if="mode === 'full' && extraFields.length">
          <h4 class="extra-title">分类专属参数（{{ form.category }}）</h4>
          <div class="grid">
            <div v-for="f in extraFields" :key="f.field_key" class="field">
              <label>{{ f.field_label }} <span v-if="f.group_name" class="grp">[{{ f.group_name }}]</span>
                <span v-if="f.is_required === '1'" class="req">*</span>
              </label>
              <input v-model="extraData[f.field_key]" />
            </div>
          </div>
        </template>

        <div class="actions">
          <button type="submit" :disabled="saving">{{ saving ? '保存中…' : '保存' }}</button>
          <button type="button" class="secondary" @click="goBack">取消</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { api } from '../api/client';
import { getEquipment, createEquipment, updateEquipment, getCategoryFields } from '../api/equipment';
import { COMMON_FIELDS } from '../utils/fields';

const router = useRouter();
const route = useRoute();

const isEdit = computed(() => !!route.params.tagNo);
const tagNo = computed(() => route.params.tagNo || '');
const mode = computed(() => route.query.mode === 'quick' ? 'quick' : 'full');

const loading = ref(isEdit.value);
const saving = ref(false);
const error = ref('');
const dicts = ref({});
const fieldConfig = ref([]);

const form = ref({});
const extraData = ref({});
let version = 1;

const commonFields = computed(() => {
  if (mode.value === 'full') return COMMON_FIELDS;
  return COMMON_FIELDS.filter((f) => ['tag_no', 'name', 'category', 'project'].includes(f.key));
});

const extraFields = computed(() => {
  if (mode.value !== 'full') return [];
  return fieldConfig.value.filter((f) => f.is_visible_detail !== '0');
});

function selectOptions(f) {
  if (f.options) return f.options;
  return dicts.value[f.dict] || [];
}

async function loadCategoryFields(category) {
  if (!category) return;
  try {
    const body = await getCategoryFields(category);
    fieldConfig.value = body.data || [];
  } catch {
    fieldConfig.value = [];
  }
}

watch(
  () => form.value.category,
  (nv, ov) => {
    if (mode.value === 'full' && nv && nv !== ov) {
      extraData.value = {};
      loadCategoryFields(nv);
    }
  }
);

function initForm(data = {}) {
  const f = {};
  for (const item of COMMON_FIELDS) {
    f[item.key] = data[item.key] === undefined || data[item.key] === null ? '' : String(data[item.key]);
  }
  return f;
}

function goBack() {
  if (isEdit.value) router.push({ name: 'equipment-detail', params: { tagNo: tagNo.value } });
  else router.push({ name: 'equipment' });
}

async function submit() {
  error.value = '';
  if (!form.value.tag_no.trim()) { error.value = '位号不能为空'; return; }
  if (!form.value.name.trim()) { error.value = '设备名称不能为空'; return; }
  if (!form.value.category) { error.value = '请选择设备类别'; return; }
  if (mode.value === 'quick' && !form.value.project.trim()) { error.value = '快速新增需填写项目'; return; }

  saving.value = true;
  try {
    const payload = {
      ...form.value,
      mode: mode.value,
      extra_data: extraData.value,
    };
    if (isEdit.value) payload.version = version;
    if (isEdit.value) {
      await updateEquipment(tagNo.value, payload);
    } else {
      await createEquipment(payload);
    }
    router.push({ name: 'equipment-detail', params: { tagNo: form.value.tag_no } });
  } catch (e) {
    error.value = e.error?.message || '保存失败';
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  try {
    const body = await api.get('/api/dicts');
    dicts.value = body.data;
  } catch { /* 字典失败不阻塞 */ }

  if (isEdit.value) {
    try {
      const body = await getEquipment(tagNo.value);
      const data = body.data;
      form.value = initForm(data);
      version = data.version || 1;
      if (data.extra_data) extraData.value = { ...data.extra_data };
      if (data.field_config && data.field_config.length) {
        fieldConfig.value = data.field_config;
      } else if (data.category) {
        await loadCategoryFields(data.category);
      }
    } catch (e) {
      error.value = e.error?.message || '加载失败';
    } finally {
      loading.value = false;
    }
  } else {
    loading.value = false;
    const mode = route.query.mode;
    form.value = initForm();
    if (mode !== 'quick') {
      await loadCategoryFields(route.query.category || '');
    }
  }
});
</script>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 900px;
}
label {
  font-size: 13px;
  color: var(--text-light);
  margin-top: 4px;
}
.req { color: var(--danger); }
.grp { color: var(--text-light); font-weight: normal; }
.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0 16px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.extra-title {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px dashed var(--border);
  color: var(--primary);
}
.actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
</style>