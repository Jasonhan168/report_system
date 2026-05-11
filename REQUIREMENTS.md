# 报表查询系统 - 完整需求文档

**项目名称**：报表查询系统（Report Query System）  
**最后更新**：2026年5月10日  
**版本**：v2.0.0（dev分支）  
**状态**：持续开发中

---

## 目录

1. [系统概述](#系统概述)
2. [核心功能](#核心功能)
3. [报表模块](#报表模块)
4. [技术架构](#技术架构)
5. [数据库设计](#数据库设计)
6. [API 接口](#api-接口)
7. [前端功能](#前端功能)
8. [优化清单](#优化清单)
9. [版本更新日志](#版本更新日志)

---

## 系统概述

### 项目背景

报表查询系统是一个企业级报表管理平台，用于集中管理和查询各类生产报表（如封装厂WIP汇总表、委外订单明细表、工程批封装在制品报表等）。系统支持多数据源接入（ClickHouse、MySQL、Oracle）、灵活的权限控制、操作日志审计、以及Excel导出功能。

### 核心目标

- **集中管理**：统一管理多个报表模块，按权限分配访问权限
- **灵活查询**：支持多维度筛选、分页查询、实时数据聚合
- **数据导出**：支持Excel导出，格式严格对齐业务模板
- **权限控制**：细粒度权限管理（用户×模块×操作）
- **审计追踪**：记录用户的所有操作日志，支持查询和分析
- **可扩展性**：模块化架构，新增报表模块无需修改核心代码

---

## 核心功能

### 1. 用户认证与授权

| 功能 | 说明 |
|---|---|
| **双模式登录** | 支持本地密码认证（AUTH_MODE=local）和LDAP域认证（AUTH_MODE=ldap） |
| **会话管理** | JWT令牌验证，支持登出和密码修改 |
| **角色管理** | admin/user 两种角色，管理员可创建用户、重置密码 |
| **权限控制** | 细粒度权限：用户×报表模块×查看/导出权限 |

### 2. 报表管理

| 功能 | 说明 |
|---|---|
| **模块注册** | 支持动态注册报表模块，包含名称、分类、数据源、路由等元数据 |
| **权限分配** | 为用户分配特定报表的查看/导出权限 |
| **侧边栏导航** | 根据用户权限动态显示可访问的报表，按分类分组 |
| **数据源配置** | 支持配置多个数据源（Mock、ClickHouse、MySQL、Oracle） |

### 3. 查询与筛选

| 功能 | 说明 |
|---|---|
| **多维度筛选** | 支持按日期、标签品名、供应商、工程量产等条件筛选 |
| **实时过滤选项** | 筛选条件下拉框实时更新，支持模糊搜索 |
| **分页查询** | 支持分页显示，每页条数可配置 |
| **合计行** | 自动计算数值列的合计值 |
| **筛选锁定** | 从其他报表跳转时支持锁定筛选条件，防止误操作 |

### 4. 数据导出

| 功能 | 说明 |
|---|---|
| **Excel导出** | 生成格式化的Excel文件，包含标题、表头、数据、合计行 |
| **文件命名** | 导出文件名包含日期和筛选条件，便于区分 |
| **权限验证** | 导出前验证用户权限 |
| **列头对齐** | 导出列头与页面显示保持一致 |

### 5. 操作日志审计

| 功能 | 说明 |
|---|---|
| **操作记录** | 记录用户的查询、导出等操作，包含时间、用户、操作类型、报表模块等 |
| **日志查询** | 支持按用户、时间、操作类型等条件查询操作日志 |
| **审计报告** | 生成用户操作统计报告 |

---

## 报表模块

### 1. 封装厂WIP汇总表

**模块代码**：`pkg_wip_summary`  
**分类**：封装厂报表  
**数据源**：ClickHouse/Mock  
**权限**：查看、导出

#### 功能特性

| 功能 | 说明 |
|---|---|
| **筛选条件** | 日期（默认当天）、标签品名、委外厂商、工程量产、分公司 |
| **显示列** | 日期、标签品名、委外厂商、工程量产、未投数量、未回货数量、合计WIP数量、WIP明细 |
| **超链接** | 未回货数量→委外订单明细表；合计WIP数量→WIP明细表 |
| **订单过滤** | 点击超链接跳转时，明细表仅显示该行关联的订单号 |
| **导出** | Excel格式，包含未回货数量列，自动计算合计行 |

#### 数据聚合

```sql
SELECT 
  date, label_name, vendor_name, production_type,
  SUM(uninvested_qty) AS uninvested_qty,
  SUM(open_qty) AS open_qty,
  SUM(total_wip) AS total_wip,
  groupArray(order_no) AS order_nos
FROM v_dwd_ab_wip
GROUP BY date, label_name, vendor_name, production_type
```

### 2. 委外订单明细表

**模块代码**：`outsource_order_detail`  
**分类**：生产报表  
**数据源**：ClickHouse/Mock  
**权限**：查看、导出

#### 功能特性

| 功能 | 说明 |
|---|---|
| **筛选条件** | 日期（默认当天）、工程量产、委外厂商、标签品名、供应商料号、分公司 |
| **固定条件** | received_rate < 98%（仅显示未完全回货的订单） |
| **显示列** | 订单号、下单日期、预计交期、工序类型、工程量产、委外厂商、料号、批号、标签品名、供应商料号、下单数量、未回货数量、回货率、分公司、拖期天数 |
| **预警高亮** | 拖期行红色背景，临近交期（≤5天）黄色背景 |
| **来源标签** | 从汇总表跳转时显示"来自汇总表筛选"标签，筛选栏锁定 |
| **订单过滤** | 从汇总表跳转时，仅显示该行关联的订单号 |
| **导出** | Excel格式，包含预计交期和拖期天数列，自动计算合计行 |

#### 拖期计算

```javascript
const today = new Date();
const eddDate = new Date(edd);
const overdueDays = Math.max(0, Math.floor((today - eddDate) / (1000 * 60 * 60 * 24)));
```

### 3. 封装厂WIP明细表

**模块代码**：`pkg_wip_detail`  
**分类**：生产报表  
**数据源**：ClickHouse/Mock  
**权限**：查看、导出

#### 功能特性

| 功能 | 说明 |
|---|---|
| **筛选条件** | 日期（默认当天）、委外厂商、标签品名、供应商料号 |
| **显示列** | 日期、委外厂商、订单号、标签品名、供应商料号、批号、装片、焊线、塑封、测试、测试后、合计WIP数量 |
| **过滤条件** | 合计WIP数量 > 0（后端SQL WHERE条件） |
| **来源标签** | 从汇总表跳转时显示"来自汇总表筛选"标签，筛选栏锁定 |
| **导出** | Excel格式，包含合计WIP数量列，自动计算合计行 |

#### 合计WIP计算

```javascript
const totalWip = die_attach + wire_bond + molding + testing + test_done;
```

### 4. 封装厂在制品汇总表（新增）

**模块代码**：`pkg_wip_inproc_summary`  
**分类**：封装厂报表  
**数据源**：ClickHouse/Mock  
**权限**：查看、导出

#### 功能特性

| 功能 | 说明 |
|---|---|
| **筛选条件** | 日期（默认当天）、标签品名、委外厂商、工程量产 |
| **显示列** | 日期、标签品名、委外厂商、工程量产、装片、焊线、塑封、测试、测试后、合计WIP数量 |
| **数据来源** | v_dws_ab_wip（DWS 层汇总视图，无日期维度） |
| **导出** | Excel格式，自动计算合计行 |

### 5. 封装厂在制品明细表（新增）

**模块代码**：`pkg_wip_inproc_detail`  
**分类**：生产报表  
**数据源**：ClickHouse/Mock  
**权限**：查看、导出

#### 功能特性

| 功能 | 说明 |
|---|---|
| **筛选条件** | 委外厂商、标签品名、供应商料号 |
| **显示列** | 委外厂商、订单号、标签品名、供应商料号、批号、装片、焊线、塑封、测试、测试后、合计WIP数量、进度更新时间 |
| **过滤条件** | 合计WIP数量 > 0 |
| **数据来源** | v_dws_ab_wip（实时进度数据） |
| **导出** | Excel格式 |

### 6. 工程批封装在制品报表（新增）

**模块代码**：`eng_pkg_wip`  
**分类**：工程报表  
**数据源**：ClickHouse/Mock  
**权限**：查看、导出

#### 功能特性

| 功能 | 说明 |
|---|---|
| **筛选条件** | 下单日期范围、工程批号、工程产品名称 |
| **显示列** | 下单日期、工程批号、工程产品名称、工程数量、预计交期、拖期天数、装片、焊线、塑封、测试、测试后、合计WIP数量 |
| **预警高亮** | 拖期行红色背景，临近交期（≤5天）黄色背景 |
| **表头固定** | 上下滚动时表头保持可见 |
| **排序** | 数据按下单日期降序排序 |
| **导出** | Excel格式，包含预计交期和拖期天数列 |

### 7. 封装订单未投统计表（新增）

**模块代码**：`pkg_unissued_pivot`  
**分类**：生产报表  
**数据源**：ClickHouse/Mock  
**权限**：查看、导出

#### 功能特性

| 功能 | 说明 |
|---|---|
| **筛选条件** | 日期范围、工程批号、工程产品名称 |
| **显示列** | 工程批号、工程产品名称、未投数量、已投数量、总订单数 |
| **数据聚合** | 按工程批号和产品名称聚合未投统计 |
| **导出** | Excel格式 |

### 8. 订单在制品明细表（新增）

**模块代码**：`order_wip_detail`  
**分类**：生产报表  
**数据源**：ClickHouse/Mock  
**权限**：查看、导出

#### 功能特性

| 功能 | 说明 |
|---|---|
| **筛选条件** | 日期、工程批号、工程产品名称、供应商 |
| **显示列** | 订单号、工程批号、工程产品名称、供应商、装片、焊线、塑封、测试、测试后、合计WIP数量 |
| **数据来源** | 订单级别的在制品数据 |
| **导出** | Excel格式 |

---

## 技术架构

### 前端技术栈

| 技术 | 版本 | 用途 |
|---|---|---|
| React | 19 | UI框架 |
| TypeScript | 5.x | 类型安全 |
| Tailwind CSS | 4 | 样式框架 |
| tRPC | 11 | 类型安全的RPC |
| Wouter | 3 | 路由管理 |
| shadcn/ui | 最新 | UI组件库 |
| ExcelJS | 4 | Excel生成 |

### 后端技术栈

| 技术 | 版本 | 用途 |
|---|---|---|
| Node.js | 22 | 运行时 |
| Express | 4 | Web框架 |
| tRPC | 11 | RPC框架 |
| Drizzle ORM | 最新 | 数据库ORM |
| ClickHouse Client | 最新 | ClickHouse驱动 |
| JWT | 9 | 会话管理 |
| bcrypt | 5 | 密码哈希 |

### 数据库

| 类型 | 用途 |
|---|---|
| MySQL/TiDB | 系统数据（用户、权限、配置、操作日志） |
| ClickHouse | 报表数据（WIP、订单等） |

---

## 数据库设计

### 系统表

#### users（用户表）

```sql
CREATE TABLE users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  open_id VARCHAR(255) UNIQUE,
  name VARCHAR(255),
  email VARCHAR(255),
  role ENUM('admin', 'user') DEFAULT 'user',
  isActive BOOLEAN DEFAULT TRUE,
  department VARCHAR(255),
  passwordHash VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

#### report_modules（报表模块表）

```sql
CREATE TABLE report_modules (
  id INT PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(100) UNIQUE,
  name VARCHAR(255),
  description TEXT,
  category VARCHAR(100),
  route VARCHAR(255),
  datasource_id INT,
  sortOrder INT DEFAULT 0,
  isActive BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

#### report_permissions（权限表）

```sql
CREATE TABLE report_permissions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT,
  module_id INT,
  canView BOOLEAN DEFAULT FALSE,
  canExport BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (module_id) REFERENCES report_modules(id)
);
```

#### operation_logs（操作日志表）

```sql
CREATE TABLE operation_logs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT,
  module_id INT,
  operation_type VARCHAR(50),
  operation_details JSON,
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (module_id) REFERENCES report_modules(id)
);
```

#### datasources（数据源表）

```sql
CREATE TABLE datasources (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255),
  type ENUM('mock', 'clickhouse', 'mysql', 'oracle'),
  config JSON,
  isActive BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## API 接口

### 认证接口

#### POST /api/auth/login
登录接口，支持本地密码和LDAP认证

**请求参数**：
```json
{
  "username": "string",
  "password": "string"
}
```

**响应**：
```json
{
  "user": { "id": 1, "name": "张三", "role": "admin" },
  "token": "jwt_token_string"
}
```

#### POST /api/auth/logout
登出接口

### 报表查询接口

#### tRPC: pkgWipSummary.query
查询WIP汇总表数据

**输入参数**：
```typescript
{
  date: string;
  labelName?: string;
  vendorName?: string;
  productionType?: string;
  plant?: string;
  page: number;
  pageSize: number;
}
```

#### tRPC: outsourceOrderDetail.query
查询委外订单明细表

**输入参数**：
```typescript
{
  date: string;
  labelName?: string;
  vendorName?: string;
  vendorPartNo?: string;
  plant?: string;
  productionType?: string;
  orderNos?: string[];
  page: number;
  pageSize: number;
}
```

#### tRPC: pkgWipDetail.query
查询WIP明细表

**输入参数**：
```typescript
{
  date: string;
  vendorName?: string;
  labelName?: string;
  vendorPartNo?: string;
  page: number;
  pageSize: number;
}
```

#### tRPC: engPkgWip.query
查询工程批封装在制品报表

**输入参数**：
```typescript
{
  startDate: string;
  endDate: string;
  engBatchNo?: string;
  engProductName?: string;
  page: number;
  pageSize: number;
}
```

### 导出接口

#### GET /api/export/pkg-wip-summary
导出WIP汇总表为Excel

#### GET /api/export/outsource-order-detail
导出委外订单明细表为Excel

#### GET /api/export/pkg-wip-detail
导出WIP明细表为Excel

#### GET /api/export/eng-pkg-wip
导出工程批封装在制品报表为Excel

---

## 前端功能

### 页面结构

```
/
├── /login                          # 登录页
├── /                               # 系统首页（报表卡片展示）
├── /reports/
│   ├── pkg-wip-summary            # 封装厂WIP汇总表
│   ├── outsource-order-detail     # 委外订单明细表
│   ├── pkg-wip-detail             # 封装厂WIP明细表
│   ├── pkg-wip-inproc-summary     # 封装厂在制品汇总表
│   ├── pkg-wip-inproc-detail      # 封装厂在制品明细表
│   ├── eng-pkg-wip                # 工程批封装在制品报表
│   ├── pkg-unissued-pivot         # 封装订单未投统计表
│   └── order-wip-detail           # 订单在制品明细表
└── /admin/
    ├── users                       # 用户管理
    ├── datasources                 # 数据源配置
    ├── report-modules              # 报表模块管理
    ├── report-permissions          # 权限配置
    ├── operation-logs              # 操作日志
    └── system-config               # 系统配置
```

### 关键功能

#### 1. 筛选与查询

- **日期选择**：日期输入框，默认当天
- **下拉筛选**：供应商、标签品名等，支持模糊搜索
- **实时过滤**：输入时实时更新下拉选项
- **查询按钮**：触发数据查询

#### 2. 表格显示

- **分页**：支持分页显示，显示总条数
- **合计行**：表格底部自动计算数值列合计
- **超链接**：支持跳转到其他报表
- **预警高亮**：根据数据状态显示不同背景色
- **固定表头**：上下滚动时表头保持可见（工程批报表）

#### 3. 导出功能

- **Excel导出**：生成格式化的Excel文件
- **文件命名**：包含日期和筛选条件
- **权限验证**：导出前检查用户权限
- **合计行**：导出文件包含合计行

#### 4. 导航与交互

- **侧边栏导航**：根据权限动态显示报表模块
- **来源标签**：从其他报表跳转时显示来源提示
- **筛选锁定**：来源跳转时筛选条件锁定，可手动解锁
- **返回按钮**：返回上级报表时保持过滤条件

---

## 优化清单

### 第一阶段（2026-04-18）

| 优化项 | 说明 |
|---|---|
| 列序调整 | WIP汇总表未回货数量列移到未投数量前 |
| 新增列 | WIP明细表新增合计WIP数量列 |
| 后端过滤 | WIP明细表合计WIP=0的过滤移至后端SQL |
| 合计行 | WIP明细表和委外订单明细表添加合计行 |
| 登录页美化 | 登录页色调改为明快蓝色调 |

### 第二阶段（2026-04-18）

| 优化项 | 说明 |
|---|---|
| 来源标签 | 明细表从汇总表跳转时显示来源提示 |
| 筛选锁定 | 来源跳转时筛选条件锁定（可解锁） |
| 导出对齐 | 导出Excel列头与页面显示保持一致 |
| 回货率去色 | 委外订单明细表回货率列改为普通文本 |

### 第三阶段（2026-04-18）

| 优化项 | 说明 |
|---|---|
| 导出合计行 | WIP明细表和委外订单明细表导出添加合计行 |
| 汇总表导出 | WIP汇总表导出添加未回货数量列 |
| 返回按钮 | 明细表来源标签旁增加返回汇总表按钮 |

### 第四阶段（2026-04-19）

| 优化项 | 说明 |
|---|---|
| 交期字段 | 委外订单明细表新增预计交期列（edd） |
| 拖期计算 | 新增拖期天数列（当前日期-预计交期） |
| 交期预警 | 拖期行红色高亮，临近交期（≤5天）黄色高亮 |
| 路径修复 | 返回汇总表路径修正为/reports/pkg-wip-summary |

### 第五阶段（2026-04-21）

| 优化项 | 说明 |
|---|---|
| 订单过滤 | WIP汇总表跳转委外订单时仅显示该行订单号 |
| 过滤恢复 | 返回汇总表时保持原有过滤条件（日期、标签、供应商） |
| 后端支持 | 后端新增order_nos参数支持精确过滤 |

### 第六阶段（2026-04-30 - 2026-05-10，dev分支）

| 优化项 | 说明 |
|---|---|
| 新增在制品汇总表 | 新增封装厂在制品汇总表（pkg_wip_inproc_summary） |
| 新增在制品明细表 | 新增封装厂在制品明细表（pkg_wip_inproc_detail） |
| 新增工程批报表 | 新增工程批封装在制品报表（eng_pkg_wip），包含预计交期和拖期预警 |
| 表头固定优化 | 工程批报表实现表头固定，上下滚动时表头保持可见 |
| 布局自适应 | 工程批报表页面自适应浏览器高度，垂直滚动仅在表格内部 |
| 时区修复 | 修复全项目报表默认日期在凌晨显示前一天的时区问题 |
| 新增未投统计 | 新增封装订单未投统计表（pkg_unissued_pivot） |
| 新增订单明细 | 新增订单在制品明细表（order_wip_detail） |
| 操作日志 | 新增操作日志管理功能，记录用户的查询、导出等操作 |
| 日志查询 | 支持按用户、时间、操作类型等条件查询操作日志 |

---

## 版本更新日志

### v2.0.0（dev分支，2026-05-10）

**新增功能**：
- ✓ 新增4个报表模块（在制品汇总、在制品明细、工程批、未投统计、订单明细）
- ✓ 操作日志审计功能
- ✓ 表头固定优化（工程批报表）
- ✓ 时区问题修复

**优化改进**：
- ✓ 工程批报表字段显示顺序调整
- ✓ 工程批报表数据按下单日期降序排序
- ✓ 修复sticky表头在某些浏览器失效的问题
- ✓ 页面自适应浏览器高度

**bug修复**：
- ✓ 修复用户操作日志时间显示问题
- ✓ 修复全项目报表默认日期时区问题

### v1.0.0（main分支，2026-04-21）

**核心功能**：
- ✓ 3个报表模块（WIP汇总、委外订单、WIP明细）
- ✓ 用户认证与授权
- ✓ 报表权限管理
- ✓ Excel导出功能
- ✓ 报表间跳转与过滤联动
- ✓ 交期预警高亮

**优化特性**：
- ✓ 6阶段UI/功能优化
- ✓ 来源标签与筛选锁定
- ✓ 返回按钮保持过滤条件
- ✓ 后端精确过滤支持

---

## 部署与配置

### 环境变量

```bash
# 数据库
DATABASE_URL=mysql://user:pass@host:3306/db

# 认证
AUTH_MODE=local|ldap
JWT_SECRET=your_jwt_secret
LDAP_URL=ldap://ldap.example.com
LDAP_BASE_DN=dc=example,dc=com

# OAuth（可选）
OAUTH_SERVER_URL=https://api.manus.im
VITE_OAUTH_PORTAL_URL=https://oauth.manus.im

# 构建
VITE_APP_ID=app_id
VITE_APP_TITLE=报表查询系统
VITE_APP_LOGO=https://...
```

### 启动命令

```bash
# 开发环境
pnpm dev

# 生产构建
NODE_ENV=production pnpm build

# 生产运行
NODE_ENV=production node dist/index.js
```

---

## 测试覆盖

| 模块 | 测试数 | 状态 |
|---|---|---|
| 认证（auth.logout） | 1 | ✓ 通过 |
| Mock数据生成器 | 8 | ✓ 通过 |
| 报表查询路由 | 8 | ✓ 通过 |
| 认证扩展（auth.login） | 9 | ✓ 通过 |
| **总计** | **26** | **✓ 全部通过** |

---

## 后续扩展方向

### 短期（1-2周）

1. **WIP汇总表恢复高亮**：返回汇总表后自动高亮来源行
2. **委外订单标签优化**：来源标签显示订单数量
3. **预计交期筛选**：支持按交期范围过滤订单

### 中期（1个月）

1. **拖期预警汇总**：WIP汇总表新增拖期订单数列
2. **数据钻取**：支持多层级数据钻取
3. **自定义报表**：支持用户自定义报表模板

### 长期（2-3个月）

1. **实时数据推送**：支持WebSocket实时更新
2. **数据分析**：集成BI分析功能
3. **移动端适配**：支持移动设备访问
4. **多语言支持**：国际化界面

---

## 常见问题

### Q: 如何新增报表模块？

A: 在 `report_modules` 表中插入新记录，指定 `code`、`name`、`route` 等字段，然后在后端实现对应的 tRPC 路由即可。侧边栏会自动显示。

### Q: 如何修改数据源？

A: 在管理后台"数据源配置"页面新增或修改数据源，然后在"报表模块管理"中为报表分配数据源。

### Q: 如何导出Excel失败？

A: 检查用户是否有导出权限，以及数据源是否正常连接。查看浏览器控制台错误信息。

### Q: 如何支持LDAP认证？

A: 设置 `AUTH_MODE=ldap`，配置 `LDAP_URL` 和 `LDAP_BASE_DN` 环境变量，重启应用。

### Q: 如何查看操作日志？

A: 登录后进入"系统管理"→"操作日志"，可按用户、时间、操作类型等条件查询。

---

## 分支说明

| 分支 | 说明 | 状态 |
|---|---|---|
| **main** | 稳定版本，v1.0.0 | 生产就绪 |
| **dev** | 开发版本，v2.0.0 | 持续开发 |

---

**文档维护**：报表查询系统开发团队  
**最后更新**：2026年5月10日  
**版本**：v2.0.0
