import { createRouter, createWebHistory } from 'vue-router';
import { token, storedUser } from '../api/client';

const routes = [
  { path: '/login', name: 'login', component: () => import('../views/Login.vue'), meta: { public: true } },
  {
    path: '/',
    component: () => import('../views/Layout.vue'),
    children: [
      { path: '', name: 'home', component: () => import('../views/Home.vue') },
      { path: 'equipment', name: 'equipment', component: () => import('../views/EquipmentList.vue') },
      { path: 'equipment/new', name: 'equipment-new', component: () => import('../views/EquipmentEdit.vue') },
      { path: 'equipment/:tagNo', name: 'equipment-detail', component: () => import('../views/EquipmentDetail.vue') },
      { path: 'equipment/:tagNo/edit', name: 'equipment-edit', component: () => import('../views/EquipmentEdit.vue') },
      { path: 'repairs', name: 'repair-list', component: () => import('../views/RepairList.vue') },
      { path: 'repairs/new', name: 'repair-new', component: () => import('../views/RepairForm.vue') },
      { path: 'repairs/:id', name: 'repair-detail', component: () => import('../views/RepairDetail.vue') },
      { path: 'repairs/:id/edit', name: 'repair-edit', component: () => import('../views/RepairForm.vue') },
      { path: 'photos', name: 'photo', component: () => import('../views/PhotoManage.vue') },
      { path: 'attachments', name: 'attachment', component: () => import('../views/AttachmentManage.vue') },
      { path: 'calibration', name: 'calibration', component: () => import('../views/CalibrationManage.vue') },
      { path: 'import-export', name: 'importexport', component: () => import('../views/ImportExport.vue'), meta: { adminOnly: true } },
      { path: 'field-config', name: 'field-config', component: () => import('../views/FieldConfig.vue'), meta: { adminOnly: true } },
      { path: 'users', name: 'users', component: () => import('../views/UserManage.vue'), meta: { adminOnly: true } },
      { path: 'recycle', name: 'recycle', component: () => import('../views/RecycleBin.vue'), meta: { adminOnly: true } },
      { path: 'backup', name: 'backup', component: () => import('../views/BackupManage.vue'), meta: { adminOnly: true } },
      { path: 'dicts', name: 'dicts', component: () => import('../views/DictManage.vue'), meta: { adminOnly: true } },
      { path: 'change-password', name: 'change-password', component: () => import('../views/ChangePassword.vue') },
    ],
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to) => {
  if (!to.meta.public && !token.get()) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }
  if (to.name === 'login' && token.get()) {
    return { name: 'home' };
  }
  if (to.meta.adminOnly) {
    const user = storedUser.get();
    if (!user || user.role !== 'admin') {
      return { name: 'home' };
    }
  }
  return true;
});

export default router;