-- 材料管理：材料台账（名称 / 型号 / 使用设备 / 库存）
CREATE TABLE IF NOT EXISTS material (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  model         TEXT,
  usage_targets TEXT NOT NULL DEFAULT '[]',  -- JSON 数组：设备位号 或 "个人工具"
  stock         INTEGER NOT NULL DEFAULT 0,  -- 库存（手动加减）
  remark        TEXT,
  created_at    TEXT,
  updated_at    TEXT,
  created_by    TEXT,
  updated_by    TEXT
);

CREATE INDEX IF NOT EXISTS idx_material_name ON material(name);
