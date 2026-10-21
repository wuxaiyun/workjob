-- 材料图片：新增/编辑材料时上传照片（R2 对象 key 引用，与 photo 表同类机制）
ALTER TABLE material ADD COLUMN photo_key TEXT;
ALTER TABLE material ADD COLUMN photo_thumb_key TEXT;
