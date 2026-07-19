-- ============================================================
-- Doris 建表语句 (从 ClickHouse 18.16.1 迁移)
-- 分区策略: 按天动态分区
-- 分桶策略: 3 BE 节点, 每表 6 桶 (每节点 2 tablet/分区, 兼顾并行度与tablet数量)
-- 去重策略: UNIQUE KEY + sequence column (替代 ReplacingMergeTree)
-- Colocation: 三表同属 wip_group, 支持 Colocate Join 消除 Shuffle
-- ============================================================

CREATE DATABASE IF NOT EXISTS wip_db;

-- ------------------------------------------------------------
-- 表1: dwd_ab_wip
-- 说明: UNIQUE KEY 模型 + sequence_col(data_time) 自动保留最新行,
--       无需像 ClickHouse 那样通过 argMax 视图手动去重
-- ------------------------------------------------------------
CREATE TABLE wip_db.dwd_ab_wip
(
    `date`           DATE         COMMENT '数据日期',
    `vendor_code`    VARCHAR(64)  COMMENT '供应商编码',
    `order_no`       VARCHAR(64)  COMMENT '订单号',
    `vendor_part_no` VARCHAR(64)  COMMENT '供应商料号',
    `batch_no`       VARCHAR(64)  DEFAULT '' COMMENT '批次号',
    `vendor_name`    VARCHAR(128) DEFAULT '' COMMENT '供应商名称',
    `label_name`     VARCHAR(128) DEFAULT '' COMMENT '标签名',
    `die_attach`     BIGINT       DEFAULT 0 COMMENT '固晶数',
    `wire_bond`      BIGINT       DEFAULT 0 COMMENT '焊线数',
    `molding`        BIGINT       DEFAULT 0 COMMENT '塑封数',
    `testing`        BIGINT       DEFAULT 0 COMMENT '测试中',
    `test_done`      BIGINT       DEFAULT 0 COMMENT '测试完成',
    `data_time`      DATETIME     NOT NULL COMMENT '数据时间(版本列)',
    `order_qty`      BIGINT       DEFAULT 0 COMMENT '订单数量',
    `before_attach`  BIGINT       DEFAULT 0 COMMENT '待固晶',
    `stock_in`       BIGINT       DEFAULT 0 COMMENT '入库数',
    `package_type`   VARCHAR(64)  DEFAULT '' COMMENT '封装类型'
)
UNIQUE KEY(`date`, `vendor_code`, `order_no`, `vendor_part_no`, `batch_no`)
PARTITION BY RANGE(`date`) ()
DISTRIBUTED BY HASH(`order_no`) BUCKETS 6
PROPERTIES (
    "replication_num" = "3",
    "colocate_with" = "wip_group",
    "enable_unique_key_merge_on_write" = "true",
    "function_column.sequence_col" = "data_time",
    "dynamic_partition.enable" = "true",
    "dynamic_partition.time_unit" = "DAY",
    "dynamic_partition.start" = "-60",
    "dynamic_partition.end" = "3",
    "dynamic_partition.prefix" = "p",
    "dynamic_partition.buckets" = "6",
    "dynamic_partition.replication_num" = "3",
    "dynamic_partition.create_history_partition" = "true"
);

-- ------------------------------------------------------------
-- 表2: dwd_order
-- 说明: UNIQUE KEY 模型 + sequence_col(sync_time) 自动保留最新行
-- ------------------------------------------------------------
CREATE TABLE wip_db.dwd_order
(
    `date`            DATE         COMMENT '数据日期',
    `order_no`        VARCHAR(64)  COMMENT '订单号',
    `order_item`      VARCHAR(64)  COMMENT '订单行项',
    `process_type`    VARCHAR(64)  DEFAULT '' COMMENT '工艺类型',
    `order_status`    VARCHAR(32)  DEFAULT '' COMMENT '订单状态',
    `order_date`      DATE         NULL COMMENT '订单日期',
    `vendor_code`     VARCHAR(64)  DEFAULT '' COMMENT '供应商编码',
    `vendor_name`     VARCHAR(128) DEFAULT '' COMMENT '供应商名称',
    `part_no`         VARCHAR(64)  DEFAULT '' COMMENT '料号',
    `lot_no`          VARCHAR(64)  DEFAULT '' COMMENT '批号',
    `lable`           VARCHAR(128) DEFAULT '' COMMENT '标签',
    `vendor_part_no`  VARCHAR(64)  DEFAULT '' COMMENT '供应商料号',
    `qty`             BIGINT       DEFAULT 0 COMMENT '数量',
    `open_qty`        BIGINT       DEFAULT 0 COMMENT '未交数量',
    `received_rate`   FLOAT        DEFAULT 0 COMMENT '收货率',
    `production_type` VARCHAR(64)  DEFAULT '' COMMENT '生产类型',
    `plant`           VARCHAR(32)  DEFAULT '' COMMENT '工厂',
    `sync_time`       DATETIME     NOT NULL COMMENT '同步时间(版本列)',
    `edd`             DATE         NULL COMMENT '预计交期',
    `package_type`    VARCHAR(64)  DEFAULT '' COMMENT '封装类型'
)
UNIQUE KEY(`date`, `order_no`, `order_item`)
PARTITION BY RANGE(`date`) ()
DISTRIBUTED BY HASH(`order_no`) BUCKETS 6
PROPERTIES (
    "replication_num" = "3",
    "colocate_with" = "wip_group",
    "enable_unique_key_merge_on_write" = "true",
    "function_column.sequence_col" = "sync_time",
    "dynamic_partition.enable" = "true",
    "dynamic_partition.time_unit" = "DAY",
    "dynamic_partition.start" = "-60",
    "dynamic_partition.end" = "3",
    "dynamic_partition.prefix" = "p",
    "dynamic_partition.buckets" = "6",
    "dynamic_partition.replication_num" = "3",
    "dynamic_partition.create_history_partition" = "true"
);

-- ------------------------------------------------------------
-- 表3: dws_ab_wip
-- 说明: 当前状态汇总表, 每个 (vendor_code, order_no, vendor_part_no, batch_no)
--       仅保留最新一行. 不分区, 与 ClickHouse 原始设计一致.
--       原 CH 中 ORDER BY 含 toDate(data_time) 仅用于排序, 非分区.
-- ------------------------------------------------------------
CREATE TABLE wip_db.dws_ab_wip
(
    `vendor_code`    VARCHAR(64)  COMMENT '供应商编码',
    `order_no`       VARCHAR(64)  COMMENT '订单号',
    `vendor_part_no` VARCHAR(64)  COMMENT '供应商料号',
    `batch_no`       VARCHAR(64)  DEFAULT '' COMMENT '批次号',
    `vendor_name`    VARCHAR(128) DEFAULT '' COMMENT '供应商名称',
    `label_name`     VARCHAR(128) DEFAULT '' COMMENT '标签名',
    `die_attach`     BIGINT       DEFAULT 0 COMMENT '固晶数',
    `wire_bond`      BIGINT       DEFAULT 0 COMMENT '焊线数',
    `molding`        BIGINT       DEFAULT 0 COMMENT '塑封数',
    `testing`        BIGINT       DEFAULT 0 COMMENT '测试中',
    `test_done`      BIGINT       DEFAULT 0 COMMENT '测试完成',
    `data_time`      DATETIME     NOT NULL COMMENT '数据时间(版本列)',
    `before_attach`  BIGINT       DEFAULT 0 COMMENT '待固晶'
)
UNIQUE KEY(`vendor_code`, `order_no`, `vendor_part_no`, `batch_no`)
DISTRIBUTED BY HASH(`order_no`) BUCKETS 6
PROPERTIES (
    "replication_num" = "3",
    "colocate_with" = "wip_group",
    "enable_unique_key_merge_on_write" = "true",
    "function_column.sequence_col" = "data_time"
);


-- ============================================================
-- 以下为视图定义
-- v_dwd_ab_wip / v_dwd_order: 字段兼容视图(重命名+裁剪), 保持下游接口一致
-- v_dws_ab_wip: 兼容视图, Doris UNIQUE KEY 已自动去重, 仅做列重命名
-- ============================================================

-- ------------------------------------------------------------
-- 视图: v_dws_ab_wip (兼容视图, 保持与 ClickHouse argMax 去重视图相同接口)
-- 作用: data_time → update_time, 暴露所有业务字段
-- ------------------------------------------------------------
CREATE VIEW wip_db.v_dws_ab_wip AS
SELECT
    vendor_code,
    order_no,
    vendor_part_no,
    batch_no,
    vendor_name,
    label_name,
    before_attach,
    die_attach,
    wire_bond,
    molding,
    testing,
    test_done,
    data_time AS update_time
FROM wip_db.dws_ab_wip;

-- ------------------------------------------------------------
-- 视图: v_dwd_ab_wip (字段兼容视图)
-- 作用: data_time → update_time, 隐藏 order_qty/stock_in/package_type
-- ------------------------------------------------------------
CREATE VIEW wip_db.v_dwd_ab_wip AS
SELECT
    `date`,
    vendor_code,
    vendor_name,
    order_no,
    label_name,
    vendor_part_no,
    batch_no,
    before_attach,
    die_attach,
    wire_bond,
    molding,
    testing,
    test_done,
    data_time AS update_time
FROM wip_db.dwd_ab_wip;

-- ------------------------------------------------------------
-- 视图: v_dwd_order (字段兼容视图)
-- 作用: lable → label, 隐藏 sync_time
-- ------------------------------------------------------------
CREATE VIEW wip_db.v_dwd_order AS
SELECT
    `date`,
    order_no,
    order_item,
    process_type,
    order_status,
    order_date,
    edd,
    vendor_code,
    vendor_name,
    part_no,
    lot_no,
    lable AS label,
    package_type,
    vendor_part_no,
    qty,
    open_qty,
    received_rate,
    production_type,
    plant
FROM wip_db.dwd_order;

-- ------------------------------------------------------------
-- 视图: v_dwd_ab_wip_agg (聚合视图, 基于 v_dwd_ab_wip)
-- ------------------------------------------------------------
CREATE VIEW wip_db.v_dwd_ab_wip_agg AS
SELECT
    `date`,
    order_no,
    vendor_part_no,
    label_name,
    vendor_name,
    SUM(die_attach)  AS die_attach,
    SUM(wire_bond)   AS wire_bond,
    SUM(molding)     AS molding,
    SUM(testing)     AS testing,
    SUM(test_done)   AS test_done
FROM wip_db.dwd_ab_wip
GROUP BY
    `date`,
    order_no,
    vendor_part_no,
    label_name,
    vendor_name;

-- ------------------------------------------------------------
-- 视图: v_dwd_order_agg (聚合视图, 直接基于基表)
-- ------------------------------------------------------------
CREATE VIEW wip_db.v_dwd_order_agg AS
SELECT
    `date`,
    order_no,
    vendor_part_no,
    lable        AS label,
    ANY_VALUE(vendor_name) AS vendor_name,
    SUM(qty)     AS qty,
    SUM(open_qty) AS open_qty
FROM wip_db.dwd_order
WHERE received_rate < 98 AND order_status != '已结案'
GROUP BY
    `date`,
    order_no,
    vendor_part_no,
    lable;

-- ------------------------------------------------------------
-- 视图: v_dws_ab_wip_agg (聚合视图, 直接基于基表)
-- ------------------------------------------------------------
CREATE VIEW wip_db.v_dws_ab_wip_agg AS
SELECT
    order_no,
    vendor_part_no,
    label_name,
    vendor_name,
    SUM(before_attach) AS before_attach,
    SUM(die_attach)    AS die_attach,
    SUM(wire_bond)     AS wire_bond,
    SUM(molding)       AS molding,
    SUM(testing)       AS testing,
    SUM(test_done)     AS test_done,
    MAX(data_time)     AS update_time
FROM wip_db.dws_ab_wip
GROUP BY
    order_no,
    vendor_part_no,
    label_name,
    vendor_name;

-- ------------------------------------------------------------
-- 视图: v_dwd_order_wip (订单与WIP关联视图)
-- 已将 ClickHouse 特有函数替换为 Doris 兼容写法
-- ------------------------------------------------------------
CREATE VIEW wip_db.v_dwd_order_wip AS
SELECT
    IFNULL(o.order_no, '')                   AS order_no,
    CAST(o.order_date AS VARCHAR(32))        AS order_date,
    CAST(o.edd AS VARCHAR(32))               AS edd,
    IFNULL(o.process_type, '')               AS process_type,
    IFNULL(o.production_type, '')            AS production_type,
    IFNULL(o.vendor_name, '')                AS vendor_name,
    IFNULL(o.part_no, '')                    AS part_no,
    IFNULL(o.lot_no, '')                     AS lot_no,
    IFNULL(o.lable, '')                      AS label,
    IFNULL(o.vendor_part_no, '')             AS vendor_part_no,
    IFNULL(o.package_type, '')               AS package_type,
    IFNULL(o.qty, 0)                         AS order_qty,
    IFNULL(o.open_qty, 0)                    AS open_qty,
    IFNULL(w.before_attach, 0)              AS before_attach,
    IFNULL(w.die_attach, 0)                 AS die_attach,
    IFNULL(w.wire_bond, 0)                  AS wire_bond,
    IFNULL(w.molding, 0)                    AS molding,
    IFNULL(w.testing, 0)                    AS testing,
    IFNULL(w.test_done, 0)                  AS test_done,
    IFNULL(w.stock_qty, 0)                  AS stock_qty,
    case when IFNULL(w.delivery_qty, 0) - IFNULL(o.qty, 0)+IFNULL(o.open_qty, 0) > 0 then IFNULL(w.delivery_qty, 0) - IFNULL(o.qty, 0)+IFNULL(o.open_qty, 0) else 0 END as in_transit_qty ,
    IFNULL(o.plant, '')                      AS plant,
    CAST(w.update_time AS VARCHAR(32))       AS update_time
FROM wip_db.dwd_order o
LEFT JOIN (
    SELECT
        ww.order_no,
        ww.vendor_part_no,
        ww.batch_no AS lot_no,
        ww.before_attach,
        ww.die_attach,
        ww.wire_bond,
        ww.molding,
        ww.testing,
        ww.test_done,
        ww.stock_qty,
        case when ww.delivery_qty>dd.good_qty+dd.fail_qty then ww.delivery_qty else dd.good_qty+dd.fail_qty end AS delivery_qty, 
        ww.data_time AS update_time
    FROM wip_db.dws_ab_wip ww
    left join wip_db.mv_dwd_ab_delivery_agg dd
    ON ww.order_no = dd.order_no
        AND ww.vendor_part_no = dd.vendor_part_no
        AND ww.batch_no = dd.batch_no
) w ON o.order_no = w.order_no
    AND o.vendor_part_no = w.vendor_part_no
    AND o.lot_no = w.lot_no
WHERE o.`date` = CURDATE()
    AND o.order_status != '已结案'
    AND o.vendor_name != '江苏长电'
    AND o.received_rate < 98
    AND o.vendor_name IN (
        SELECT DISTINCT vendor_name
        FROM wip_db.dws_ab_wip
        WHERE vendor_name != ''
    )

UNION ALL

SELECT
    IFNULL(o.order_no, '')                   AS order_no,
    CAST(o.order_date AS VARCHAR(32))        AS order_date,
    CAST(o.edd AS VARCHAR(32))               AS edd,
    IFNULL(o.process_type, '')               AS process_type,
    IFNULL(o.production_type, '')            AS production_type,
    IFNULL(o.vendor_name, '')                AS vendor_name,
    IFNULL(o.part_no, '')                    AS part_no,
    SPLIT_PART(IFNULL(o.lot_no, ''), '_', 1) AS lot_no,
    IFNULL(o.lable, '')                      AS label,
    IFNULL(o.vendor_part_no, '')             AS vendor_part_no,
    IFNULL(o.package_type, '')               AS package_type,
    IFNULL(o.order_qty, 0)                   AS order_qty,
    IFNULL(o.open_qty, 0)                    AS open_qty,
    IFNULL(w.before_attach, 0)              AS before_attach,
    IFNULL(w.die_attach, 0)                 AS die_attach,
    IFNULL(w.wire_bond, 0)                  AS wire_bond,
    IFNULL(w.molding, 0)                    AS molding,
    IFNULL(w.testing, 0)                    AS testing,
    IFNULL(w.test_done, 0)                  AS test_done,
    IFNULL(w.stock_qty, 0)                  AS stock_qty,
    case when IFNULL(w.delivery_qty, 0) - IFNULL(o.order_qty, 0)+IFNULL(o.open_qty, 0) > 0 then IFNULL(w.delivery_qty, 0) - IFNULL(o.order_qty, 0)+IFNULL(o.open_qty, 0) else 0 END as in_transit_qty ,    
    IFNULL(o.plant, '')                      AS plant,
    CAST(w.update_time AS VARCHAR(32))       AS update_time
FROM (
    SELECT
        order_no,
        vendor_part_no,
        ANY_VALUE(process_type)    AS process_type,
        ANY_VALUE(order_date)      AS order_date,
        ANY_VALUE(edd)             AS edd,
        ANY_VALUE(production_type) AS production_type,
        vendor_name,
        ANY_VALUE(lable)           AS lable,
        ANY_VALUE(part_no)         AS part_no,
        ANY_VALUE(package_type)    AS package_type,
        ANY_VALUE(lot_no)          AS lot_no,
        SUM(qty)                   AS order_qty,
        SUM(open_qty)              AS open_qty,
        ANY_VALUE(plant)           AS plant
    FROM wip_db.dwd_order
    WHERE `date` = CURDATE()
        AND order_status != '已结案'
        AND vendor_name = '江苏长电'
        AND received_rate < 98
    GROUP BY
        `date`,
        order_no,
        vendor_part_no,
        vendor_name
) o
LEFT JOIN (
    SELECT
        ww.order_no,
        ww.vendor_part_no,
        ww.batch_no AS lot_no,
        ww.before_attach,
        ww.die_attach,
        ww.wire_bond,
        ww.molding,
        ww.testing,
        ww.test_done,
        ww.stock_qty,
        case when ww.delivery_qty>dd.good_qty+dd.fail_qty then ww.delivery_qty else dd.good_qty+dd.fail_qty end AS delivery_qty, 
        ww.data_time AS update_time
    FROM wip_db.dws_ab_wip ww
    left join wip_db.mv_dwd_ab_delivery_agg dd
    ON ww.order_no = dd.order_no
        AND ww.vendor_part_no = dd.vendor_part_no
        AND ww.batch_no = dd.batch_no
) w ON o.order_no = w.order_no
    AND o.vendor_part_no = w.vendor_part_no;
