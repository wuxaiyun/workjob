// 设备通用字段定义（分类专属字段来自 field_config，动态渲染）
export const COMMON_FIELDS = [
  { key: 'tag_no', label: '位号', type: 'text', required: true },
  { key: 'name', label: '设备名称', type: 'text', required: true },
  { key: 'category', label: '设备类别', type: 'select', dict: '设备类别', required: true, combobox: true },
  { key: 'project', label: '所属项目', type: 'text' },
  { key: 'project_no', label: '项目编号', type: 'text' },
  { key: 'department', label: '所属部门', type: 'select', dict: '部门', combobox: true },
  { key: 'location', label: '安装位置', type: 'text' },
  { key: 'model', label: '型号', type: 'text' },
  { key: 'manufacturer', label: '制造商', type: 'text' },
  { key: 'supplier', label: '供应商', type: 'text' },
  { key: 'factory_date', label: '出厂日期', type: 'date' },
  { key: 'factory_no', label: '出厂编号', type: 'text' },
  { key: 'commission_date', label: '投产日期', type: 'date' },
  { key: 'asset_no', label: '资产编号', type: 'text' },
  { key: 'original_value', label: '原值', type: 'number' },
  { key: 'net_value', label: '净值', type: 'number' },
  { key: 'is_mandatory', label: '是否强检', type: 'select', options: ['是', '否'] },
  { key: 'verify_valid_until', label: '检定到期日', type: 'date' },
  { key: 'status', label: '状态', type: 'select', dict: '设备状态' },
  { key: 'remark', label: '备注', type: 'textarea' },
];

// 列表中展示的通用字段（位号/名称/类别/项目/部门/位置外，另加）
export const LIST_FIELDS = [
  { key: 'tag_no', label: '位号' },
  { key: 'name', label: '设备名称' },
  { key: 'category', label: '类别' },
  { key: 'project', label: '项目' },
  { key: 'department', label: '部门' },
  { key: 'location', label: '位置' },
  { key: 'model', label: '型号' },
];

// 详情页基本信息卡片展示的字段（排除太长的）
export const DETAIL_FIELDS = COMMON_FIELDS.filter((f) =>
  ['tag_no', 'name', 'category', 'project', 'project_no', 'department', 'location', 'model',
   'manufacturer', 'supplier', 'factory_date', 'factory_no', 'commission_date', 'asset_no',
   'original_value', 'net_value', 'is_mandatory', 'verify_valid_until', 'status'].includes(f.key)
);

export function fieldMeta(key) {
  return COMMON_FIELDS.find((f) => f.key === key);
}