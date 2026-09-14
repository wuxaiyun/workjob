-- V1.5 / V2.0 追加表 + 补充字典种子

-- 备件更换
CREATE TABLE part_replace (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repair_no TEXT,
  tag_no TEXT NOT NULL,
  part_name TEXT NOT NULL,
  part_model TEXT,
  part_qty REAL DEFAULT 1,
  part_unit TEXT,
  replace_date TEXT,
  cost REAL,
  remark TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT
);
CREATE INDEX idx_part_repair ON part_replace(repair_no);
CREATE INDEX idx_part_tag ON part_replace(tag_no);

-- 费用工时
CREATE TABLE cost (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repair_no TEXT,
  tag_no TEXT NOT NULL,
  cost_type TEXT NOT NULL,
  amount REAL NOT NULL,
  hours REAL,
  cost_date TEXT,
  remark TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT
);
CREATE INDEX idx_cost_repair ON cost(repair_no);
CREATE INDEX idx_cost_tag ON cost(tag_no);

-- 检定强检
CREATE TABLE calibration (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tag_no TEXT NOT NULL,
  calibration_no TEXT,
  cert_no TEXT,
  done_date TEXT,
  due_date TEXT NOT NULL,
  result TEXT,
  remark TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT,
  created_by TEXT
);
CREATE INDEX idx_calibration_tag ON calibration(tag_no);
CREATE INDEX idx_calibration_due ON calibration(due_date);

-- 导入日志
CREATE TABLE import_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_type TEXT NOT NULL,
  file_name TEXT,
  total_rows INTEGER DEFAULT 0,
  success_rows INTEGER DEFAULT 0,
  fail_rows INTEGER DEFAULT 0,
  error_detail TEXT,
  operator TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 备份日志
CREATE TABLE backup_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  backup_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  object_key TEXT NOT NULL,
  row_counts TEXT,
  operator TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ========== 补充字典 ==========
INSERT INTO dict (dict_type, dict_value, sort_order) VALUES
('费用类型','维修费',1),
('费用类型','工时费',2),
('费用类型','备件费',3),
('费用类型','材料费',4),
('费用类型','其他',99),
('备件单位','个',1),
('备件单位','台',2),
('备件单位','套',3),
('备件单位','只',4),
('备件单位','件',5),
('备件单位','米',6),
('检定结果','合格',1),
('检定结果','不合格',2),
('检定结果','待检定',3),
('导入模式','insert',1),
('导入模式','upsert',2),
('导入模式','update',3);