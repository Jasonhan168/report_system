-- ============================================================
-- 报表查询系统 - 数据库初始化脚本
-- 适用数据库：MySQL 5.7+ / MariaDB 10.3+
-- 执行方式：mysql -u root -p report_db < scripts/init-db.sql
-- ============================================================

-- 创建数据库（如已存在则跳过）
CREATE DATABASE IF NOT EXISTS `report_db`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `report_db`;

-- ─── 用户表 ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `users` (
  `id`           INT AUTO_INCREMENT NOT NULL,
  `openId`       VARCHAR(64) NOT NULL,
  `name`         VARCHAR(255),
  `email`        VARCHAR(320),
  `loginMethod`  VARCHAR(64),
  `role`         ENUM('user','admin') NOT NULL DEFAULT 'user',
  `department`   VARCHAR(128),
  `isActive`     TINYINT(1) NOT NULL DEFAULT 1,
  `passwordHash` TEXT,
  `createdAt`    DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`    DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `lastSignedIn` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT `users_id` PRIMARY KEY (`id`),
  CONSTRAINT `users_openId_unique` UNIQUE (`openId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 数据源配置表 ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `datasources` (
  `id`           INT AUTO_INCREMENT NOT NULL,
  `name`         VARCHAR(128) NOT NULL,
  `type`         VARCHAR(32) NOT NULL DEFAULT 'mock',
  `host`         VARCHAR(255),
  `port`         BIGINT DEFAULT 3306,
  `database`     VARCHAR(128),
  `username`     VARCHAR(128),
  `password`     VARCHAR(255),
  `extraOptions` JSON,
  `isDefault`    TINYINT(1) NOT NULL DEFAULT 0,
  `isActive`     TINYINT(1) NOT NULL DEFAULT 1,
  `status`       VARCHAR(20) DEFAULT 'active',
  `createdAt`    DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`    DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT `datasources_id` PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 报表模块注册表 ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `report_modules` (
  `id`           INT AUTO_INCREMENT NOT NULL,
  `code`         VARCHAR(64) NOT NULL,
  `name`         VARCHAR(128) NOT NULL,
  `category`     VARCHAR(64),
  `description`  TEXT,
  `datasourceId` INT,
  `isActive`     TINYINT(1) NOT NULL DEFAULT 1,
  `sortOrder`    INT NOT NULL DEFAULT 0,
  `route`        VARCHAR(255),
  `icon`         VARCHAR(64),
  `status`       VARCHAR(20) DEFAULT 'active',
  `createdAt`    DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`    DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT `report_modules_id` PRIMARY KEY (`id`),
  CONSTRAINT `report_modules_code_unique` UNIQUE (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 报表权限表 ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `report_permissions` (
  `id`             INT AUTO_INCREMENT NOT NULL,
  `userId`         BIGINT UNSIGNED NOT NULL,
  `reportModuleId` INT NOT NULL,
  `reportCode`     VARCHAR(64) NOT NULL DEFAULT '',
  `canView`        TINYINT(1) NOT NULL DEFAULT 0,
  `canExport`      TINYINT(1) NOT NULL DEFAULT 0,
  `createdAt`      DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`      DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT `report_permissions_id` PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 系统配置表 ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `system_configs` (
  `id`          INT AUTO_INCREMENT NOT NULL,
  `key`         VARCHAR(128) NOT NULL,
  `value`       TEXT,
  `description` TEXT,
  `category`    VARCHAR(64) DEFAULT 'general',
  `configKey`   VARCHAR(128) NOT NULL DEFAULT '',
  `configValue` TEXT,
  `createdAt`   DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT `system_configs_id` PRIMARY KEY (`id`),
  CONSTRAINT `system_configs_key_unique` UNIQUE (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 初始系统配置 ──────────────────────────────────────────────────────────────
INSERT IGNORE INTO `system_configs` (`key`, `configKey`, `value`, `description`, `category`) VALUES
  ('system_name',       'system_name',       '报表查询系统', '系统名称',                                    'general'),
  ('company_name',      'company_name',       '',            '公司名称',                                    'general'),
  ('ad_server_url',     'ad_server_url',      '',            'AD域服务器地址（如 ldap://10.10.1.1:389）',   'auth'),
  ('ad_domain',         'ad_domain',          '',            'AD域名称（如 CORP 或 corp.example.com）',     'auth'),
  ('ad_base_dn',        'ad_base_dn',         '',            'AD Base DN（如 DC=corp,DC=example,DC=com）',  'auth'),
  ('ad_bind_user',      'ad_bind_user',       '',            'AD绑定服务账号（可选，用于搜索用户属性）',    'auth'),
  ('ad_bind_password',  'ad_bind_password',   '',            'AD绑定服务账号密码',                          'auth');

-- ─── 初始演示数据源 ────────────────────────────────────────────────────────────
INSERT IGNORE INTO `datasources` (`name`, `type`, `host`, `port`, `database`, `isDefault`, `isActive`, `status`) VALUES
  ('演示数据源（Mock）', 'mock', 'localhost', 0, 'mock', 1, 1, 'active');

-- ─── 初始报表模块 ──────────────────────────────────────────────────────────────
INSERT IGNORE INTO `report_modules`
  (`code`, `name`, `category`, `description`, `route`, `icon`, `isActive`, `status`, `sortOrder`)
VALUES (
  'pkg_wip_summary',
  '封装厂WIP汇总表',
  '封装厂报表',
  '展示封装厂各工序在制品（WIP）汇总数据，支持按日期、标签品名、供应商查询',
  '/reports/pkg-wip-summary',
  'BarChart2',
  1,
  'active',
  1
);

INSERT IGNORE INTO `report_modules`
  (`code`, `name`, `category`, `description`, `route`, `icon`, `isActive`, `status`, `sortOrder`)
VALUES (
  'outsource_order_detail',
  '委外订单明细表',
  '生产报表',
  '按日期查询委外订单明细，received_rate<98为固定条件',
  '/reports/outsource-order-detail',
  'FileText',
  1,
  'active',
  20
);

INSERT IGNORE INTO `report_modules`
  (`code`, `name`, `category`, `description`, `route`, `icon`, `isActive`, `status`, `sortOrder`)
VALUES (
  'pkg_wip_detail',
  '原封装厂WIP明细表',
  '生产报表',
  '按日期查询封装厂WIP明细数据（来源：v_dwd_ab_wip）',
  '/reports/pkg-wip-detail',
  'List',
  1,
  'active',
  30
);

INSERT IGNORE INTO `report_modules`
  (`code`, `name`, `category`, `description`, `route`, `icon`, `isActive`, `status`, `sortOrder`)
VALUES (
  'pkg_wip_inproc_detail',
  '封装厂在制品明细表',
  '生产报表',
  '封装厂在制品当前快照明细（来源：v_dws_ab_wip，带进度更新时间）',
  '/reports/pkg-wip-inproc-detail',
  'List',
  1,
  'active',
  40
);

-- 兼容升级：若旧模块名称仍为“封装厂WIP明细表”，重命名为“原封装厂WIP明细表”
UPDATE `report_modules`
  SET `name` = '原封装厂WIP明细表'
  WHERE `code` = 'pkg_wip_detail' AND `name` = '封装厂WIP明细表';

-- ─── 完成提示 ──────────────────────────────────────────────────────────────────────────────
SELECT '✅ 数据库初始化完成！请使用 node scripts/create-admin.mjs 创建管理员账号。' AS message;