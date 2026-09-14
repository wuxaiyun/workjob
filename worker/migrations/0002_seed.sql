-- V1.0 初始化数据：字典表 + 字段配置 + 管理员账号（admin / admin123，部署后请立即修改）

-- ========== 字典 ==========
INSERT INTO dict (dict_type, dict_value, sort_order, remark) VALUES
('设备类别','阀门',1,''),
('设备类别','仪表',2,''),
('设备类别','电机',3,''),
('设备类别','泵/风机',4,''),
('设备类别','锅炉/压力容器',5,''),
('设备类别','其他',99,''),
('维修类别','故障维修',1,''),
('维修类别','预防性维护',2,''),
('维修类别','定期检修',3,''),
('维修类别','紧急抢修',4,''),
('维修类别','其他',99,''),
('维修状态','待处理',1,''),
('维修状态','处理中',2,''),
('维修状态','待验收',3,''),
('维修状态','已完成',4,''),
('维修状态','已关闭',5,''),
('维修状态','取消',6,''),
('设备状态','在用',1,''),
('设备状态','停用',2,''),
('设备状态','报废',3,''),
('照片类型','设备现场',1,''),
('照片类型','维修前',2,''),
('照片类型','维修后',3,''),
('照片类型','故障部位',4,''),
('照片类型','铭牌',5,''),
('照片类型','备件',6,''),
('照片类型','其他',99,''),
('附件类型','说明书',1,''),
('附件类型','图纸',2,''),
('附件类型','P&ID',3,''),
('附件类型','合格证',4,''),
('附件类型','检定证书',5,''),
('附件类型','其他',99,''),
('部门','一期项目',1,''),
('部门','二期项目',2,''),
('部门','三期项目',3,''),
('部门','公用工程部',4,''),
('部门','设备部',5,'');

-- ========== 字段配置（分类专属 extra_data 字段） ==========
-- 阀门类
INSERT INTO field_config (category, field_key, field_label, group_name, sort_order, is_required) VALUES
('阀门','caliber','口径','基本参数',10,'0'),
('阀门','range','量程','基本参数',20,'0'),
('阀门','body_material','阀体材质','材质',30,'0'),
('阀门','core_material','阀芯材质','材质',40,'0'),
('阀门','seat_material','阀座材质','材质',50,'0'),
('阀门','packing','填料','基本参数',60,'0'),
('阀门','leakage_class','泄漏等级','基本参数',70,'0'),
('阀门','flow_char','流量特性','基本参数',80,'0'),
('阀门','connection_type','连接形式','安装',90,'0'),
('阀门','pressure_class','压力等级','基本参数',100,'0'),
('阀门','flange_std','法兰标准','安装',110,'0'),
('阀门','flange_size','法兰尺寸','安装',120,'0'),
('阀门','actuator_model','执行机构型号','基本参数',130,'0');

-- 仪表类
INSERT INTO field_config (category, field_key, field_label, group_name, sort_order, is_required) VALUES
('仪表','range','量程','基本参数',10,'0'),
('仪表','accuracy','准确度','基本参数',20,'0'),
('仪表','min_display','分度值','基本参数',30,'0'),
('仪表','protection_level','防护等级','环境',40,'0'),
('仪表','explosion_proof','防爆等级','环境',50,'0'),
('仪表','elec_interface','电气接口尺寸','安装',60,'0');

-- 电机类
INSERT INTO field_config (category, field_key, field_label, group_name, sort_order, is_required) VALUES
('电机','power','功率','基本参数',10,'0'),
('电机','protection_level','防护等级','环境',20,'0'),
('电机','explosion_proof','防爆等级','环境',30,'0'),
('电机','bearing','轴承','关键部件',40,'0'),
('电机','gearbox','减速机','关键部件',50,'0'),
('电机','motor_model','电机型号','基本参数',60,'0');

-- 泵/风机类
INSERT INTO field_config (category, field_key, field_label, group_name, sort_order, is_required) VALUES
('泵/风机','flow_max','最大流量','运行参数',10,'0'),
('泵/风机','flow_normal','正常流量','运行参数',20,'0'),
('泵/风机','flow_min','最小流量','运行参数',30,'0'),
('泵/风机','op_pressure','操作压力','运行参数',40,'0'),
('泵/风机','op_temperature','操作温度','运行参数',50,'0'),
('泵/风机','bearing','轴承','关键部件',60,'0'),
('泵/风机','gearbox','减速机','关键部件',70,'0'),
('泵/风机','seal','密封件','关键部件',80,'0'),
('泵/风机','power','功率','基本参数',5,'0');

-- 锅炉/压力容器类
INSERT INTO field_config (category, field_key, field_label, group_name, sort_order, is_required) VALUES
('锅炉/压力容器','pressure_class','压力等级','基本参数',10,'0'),
('锅炉/压力容器','temperature','温度','基本参数',20,'0'),
('锅炉/压力容器','material','材质','材质',30,'0'),
('锅炉/压力容器','pressure_valve_before','阀前压力','运行参数',40,'0'),
('锅炉/压力容器','pressure_valve_after','阀后压力','运行参数',50,'0'),
('锅炉/压力容器','pressure_diff','压差','运行参数',60,'0');

-- 通用工艺参数（多类别通用）
INSERT INTO field_config (category, field_key, field_label, group_name, sort_order, is_required) VALUES
('阀门','medium','介质','工艺介质',1,'0'),
('仪表','medium','介质','工艺介质',1,'0'),
('电机','medium','介质','工艺介质',1,'0'),
('泵/风机','medium','介质','工艺介质',1,'0'),
('锅炉/压力容器','medium','介质','工艺介质',1,'0'),
('阀门','density','密度','工艺介质',2,'0'),
('仪表','density','密度','工艺介质',2,'0'),
('电机','density','密度','工艺介质',2,'0'),
('泵/风机','density','密度','工艺介质',2,'0'),
('锅炉/压力容器','density','密度','工艺介质',2,'0'),
('阀门','viscosity','粘度','工艺介质',3,'0'),
('仪表','viscosity','粘度','工艺介质',3,'0'),
('电机','viscosity','粘度','工艺介质',3,'0'),
('泵/风机','viscosity','粘度','工艺介质',3,'0'),
('锅炉/压力容器','viscosity','粘度','工艺介质',3,'0');

-- ========== 管理员账号（admin / admin123） ==========
INSERT INTO users (username, password_hash, role, real_name) VALUES
('admin', 'pbkdf2-sha256$100000$tnIhFyDtfq4Un06uadPrKg==$tbzU9bVS9qls28W971yzBpwBhVQ10Xu4Ah1J/9/DPs4=', 'admin', '系统管理员');