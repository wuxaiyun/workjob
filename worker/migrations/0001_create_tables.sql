-- V1.0 数据库建表（依据《工厂设备维修台账系统 AI开发总纲 v3.0》第五章）
-- 业务数据采用软删除；核心业务表预置 version 乐观锁字段；可枚举选项走 dict 字典表。

-- 用户
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','worker')),
  real_name TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 设备主档
CREATE TABLE equipment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tag_no TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  project TEXT,
  project_no TEXT,
  department TEXT,
  location TEXT,
  model TEXT,
  manufacturer TEXT,
  supplier TEXT,
  factory_date TEXT,
  factory_no TEXT,
  commission_date TEXT,
  asset_no TEXT,
  original_value REAL,
  net_value REAL,
  is_mandatory TEXT,
  verify_valid_until TEXT,
  status TEXT DEFAULT '在用',
  remark TEXT,
  extra_data TEXT,
  version INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT,
  created_by TEXT,
  updated_by TEXT,
  deleted_at TEXT,
  deleted_by TEXT
);
CREATE INDEX idx_equipment_category ON equipment(category);
CREATE INDEX idx_equipment_project ON equipment(project);
CREATE INDEX idx_equipment_status ON equipment(status);
CREATE INDEX idx_equipment_verify ON equipment(verify_valid_until);

-- 维修记录（含历史快照字段）
CREATE TABLE repair (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repair_no TEXT UNIQUE NOT NULL,
  tag_no TEXT NOT NULL,
  equipment_name_snapshot TEXT,
  project_snapshot TEXT,
  department_snapshot TEXT,
  location_snapshot TEXT,
  report_date TEXT NOT NULL,
  repair_date TEXT,
  repair_type TEXT NOT NULL,
  status TEXT NOT NULL,
  worker TEXT,
  fault_desc TEXT NOT NULL,
  cause TEXT,
  repair_content TEXT NOT NULL,
  action TEXT,
  remark TEXT,
  version INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT,
  created_by TEXT,
  deleted_at TEXT,
  deleted_by TEXT,
  FOREIGN KEY (tag_no) REFERENCES equipment(tag_no)
);
CREATE INDEX idx_repair_tag ON repair(tag_no);
CREATE INDEX idx_repair_date ON repair(repair_date);
CREATE INDEX idx_repair_status ON repair(status);

-- 统一照片表
CREATE TABLE photo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tag_no TEXT NOT NULL,
  repair_no TEXT,
  photo_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  object_key TEXT NOT NULL,
  thumbnail_key TEXT,
  description TEXT,
  photographer TEXT,
  photo_time TEXT,
  upload_date TEXT DEFAULT CURRENT_TIMESTAMP,
  remark TEXT
);
CREATE INDEX idx_photo_tag ON photo(tag_no);
CREATE INDEX idx_photo_repair ON photo(repair_no);

-- 统一附件表
CREATE TABLE attachment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tag_no TEXT NOT NULL,
  repair_no TEXT,
  file_type TEXT,
  file_name TEXT NOT NULL,
  object_key TEXT NOT NULL,
  upload_date TEXT DEFAULT CURRENT_TIMESTAMP,
  uploader TEXT,
  description TEXT,
  remark TEXT
);
CREATE INDEX idx_attachment_tag ON attachment(tag_no);

-- 字典
CREATE TABLE dict (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dict_type TEXT NOT NULL,
  dict_value TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  remark TEXT
);
CREATE INDEX idx_dict_type ON dict(dict_type);

-- 字段配置
CREATE TABLE field_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  field_key TEXT NOT NULL,
  field_label TEXT NOT NULL,
  group_name TEXT,
  sort_order INTEGER DEFAULT 0,
  is_required TEXT DEFAULT '0',
  is_visible_list TEXT DEFAULT '0',
  is_visible_detail TEXT DEFAULT '1',
  is_visible_export TEXT DEFAULT '1',
  default_value TEXT
);
CREATE INDEX idx_field_config_category ON field_config(category);

-- 操作日志
CREATE TABLE operation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operator TEXT,
  action TEXT,
  target_table TEXT,
  target_key TEXT,
  field_name TEXT,
  old_value TEXT,
  new_value TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_oplog_target ON operation_log(target_table, target_key);