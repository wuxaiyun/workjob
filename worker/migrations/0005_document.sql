-- 文档管理：上传/下载各类格式文件资料（表格、Word、PDF 等）
CREATE TABLE IF NOT EXISTS document (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,      -- 显示名称
  file_name  TEXT NOT NULL,      -- 原始文件名（下载时使用）
  ext        TEXT,               -- 扩展名（小写）
  mime       TEXT,               -- 内容类型
  size       INTEGER,            -- 字节大小
  category   TEXT,               -- 分类（可选，自由文本）
  object_key TEXT NOT NULL,      -- R2 对象键
  remark     TEXT,
  uploader   TEXT,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_document_title ON document(title);
CREATE INDEX IF NOT EXISTS idx_document_category ON document(category);
