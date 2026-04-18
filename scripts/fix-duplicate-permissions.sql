-- 清理 report_permissions 表中的重复记录
-- 保留每个 (userId, reportModuleId) 组合中 id 最大（最新）的一条
-- 在升级到新版本后执行一次即可

DELETE rp1 FROM report_permissions rp1
INNER JOIN report_permissions rp2
  ON rp1.userId = rp2.userId
 AND rp1.reportModuleId = rp2.reportModuleId
 AND rp1.id < rp2.id;

-- 可选：添加唯一索引防止后续重复（MySQL 5.7+）
-- ALTER TABLE report_permissions ADD UNIQUE KEY uq_user_module (userId, reportModuleId);
