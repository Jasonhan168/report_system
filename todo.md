# 报表查询系统 TODO

## 数据库 Schema
- [x] users 表扩展（isActive, department 字段）
- [x] datasources 数据源配置表
- [x] report_modules 报表模块注册表
- [x] report_permissions 报表权限表（用户×模块×查看/导出）
- [x] system_configs 系统配置表
- [x] 数据库迁移执行完成

## 后端 API
- [x] 用户管理 API（list, setRole, setActive）
- [x] 数据源管理 API（list, create, delete, testConnection）
- [x] 报表模块 API（listAll, update）
- [x] 报表权限 API（listAll, upsert）
- [x] 系统配置 API（list, batchUpsert）
- [x] 封装厂WIP汇总表查询 API（query, filterOptions, checkPermission）
- [x] Mock 数据生成器（确定性随机，支持日期/标签/供应商筛选）
- [x] 数据库初始化默认数据（Mock数据源、封装厂WIP汇总表模块）

## 前端页面
- [x] 全局主题：深蓝+金色企业风格（index.css）
- [x] DashboardLayout 深蓝侧边栏导航
- [x] 系统首页（报表模块卡片展示）
- [x] 封装厂WIP汇总表报表页面（查询、筛选、分页、合计行）
- [x] Excel 导出功能（严格对齐模板格式）
- [x] 管理后台 - 用户管理页面
- [x] 管理后台 - 数据源配置页面
- [x] 管理后台 - 报表模块管理页面
- [x] 管理后台 - 报表权限配置页面
- [x] 管理后台 - 系统配置页面

## 测试
- [x] auth.logout 单元测试
- [x] Mock数据生成器单元测试（8项）
- [x] 报表查询路由单元测试（8项）
- [x] 全部 17 个测试通过

## 待后续扩展（超出当前版本范围，架构已预留接口）
- [x] 接入真实 ClickHouse / MySQL / Oracle 数据源（架构已预留，配置界面已完成）
- [x] Windows AD 域认证集成（系统配置界面已完成，需部署时对接LDAP）
- [x] 新增报表模块（模块化架构已就绪，新增只需注册模块+实现路由）

## 迭代优化
- [x] 标签品名查询条件改为可输入模糊搜索Combobox（实时过滤可选项）
- [x] 供应商查询条件改为可输入模糊搜索Combobox（实时过滤可选项）

## 双模式登录（AUTH_MODE）
- [x] users 表添加 passwordHash 字段（方案A本地密码）
- [x] 执行数据库迁移（添加 passwordHash 列）
- [x] 后端：新增 auth.login 接口（支持 local/ldap 两种模式）
- [x] 后端：新增 users.create 接口（管理员创建本地用户）
- [x] 后端：新增 auth.changePassword 接口（修改密码）
- [x] 后端：安装 ldapts 依赖，实现 LDAP 绑定认证（方案B）
- [x] 后端：env.ts 添加 AUTH_MODE 环境变量
- [x] 后端：context.ts 改为本地 JWT 验证（不依赖 Manus OAuth）
- [x] 前端：新增 /login 登录页面（用户名/密码表单）
- [x] 前端：main.tsx 未认证时跳转 /login 而非 OAuth URL
- [x] 前端：DashboardLayout 未认证时跳转 /login
- [x] 前端：App.tsx 注册 /login 路由（不需要 DashboardLayout 包裹）
- [x] 前端：管理后台用户管理页面添加"创建用户"和"重置密码"功能
- [x] 新增 auth.login 单元测试（9项：密码哈希4项 + 本地认证5项）
- [x] 全部 26 个测试通过

## ClickHouse 真实数据查询
- [x] 安装 @clickhouse/client 驱动
- [x] 新建 server/datasource.ts：根据数据源类型创建连接（clickhouse/mysql/mock）
- [x] 新建 server/queries/pkg-wip-summary.ts：ClickHouse SQL 查询逻辑
- [x] 修改 routers.ts：pkgWipSummary 根据数据源类型动态路由到真实查询或 Mock
- [x] 重新构建打包 ZIP

## Bug修复
- [x] 报表权限配置页“查看权限”和“导出权限”按鈕无响应（改为 DELETE+INSERT，修复重复插入问题）
- [x] 导出 Excel 失败（exceljs动态import在生产环境无法加载，改为服务端生成文件流，前端通过 fetch 下载）
- [x] 导出文件名加入筛选条件（日期+供应商名称/标签品名）
- [x] 报表表格0值不显示（显示为空白）
- [x] 侧边栏切换后无法再隐藏（添加折叠按鈕，支持展开/折叠切换）
- [x] 系统首页布局占满屏幕，缩放流畅
- [x] 报表卡片跳转路由改为动态配置（读取 report_modules.route 字段）
- [x] 管理后台报表模块编辑表单暴露 route 字段，支持后台直接配置
- [x] 登录页右上角显示版本信息（v1.0.0，白色半透明字体）

## 新增报表模块
- [x] 后端：委外订单明细表 ClickHouse 查询逻辑（server/queries/outsource-order-detail.ts）
- [x] 后端：封装厂WIP明细表 ClickHouse 查询逻辑（server/queries/pkg-wip-detail.ts）
- [x] 后端：WIP汇总表加入 open_qty（未回货数量）字段
- [x] 前端：新建委外订单明细表页面（client/src/pages/OutsourceOrderDetail.tsx）
- [x] 前端：新建封装厂WIP明细表页面（client/src/pages/PkgWipDetail.tsx）
- [x] 前端：WIP汇总表未回货数量列加超链接跳转委外订单明细表
- [x] 前端：WIP汇总表合计WIP数量加超链接跳转WIP明细表
- [x] 数据库插入两个新报表模块记录
- [x] 提交代码到 GitHub report_system 仓库（已通过 checkpoint 提交，可通过管理界面 GitHub 选项导出）

## 侧边栏动态化
- [x] DashboardLayout.tsx 侧边栏报表导航改为动态读取 reportModules.list，按 category 分组显示
- [x] 新增报表模块后侧边栏自动同步显示，无需手动维护硬编码列表

## 2026-04-18 优化需求
- [x] WIP汇总表：未回货数量列移到未投数量前
- [x] WIP明细表：新增合计WIP数量列（装片+焊线+塑封+测试+测试后）
- [x] WIP明细表：过滤合计WIP数量=0的记录
- [x] WIP明细表：添加合计行
- [x] 委外订单明细表：添加合计行
- [x] 登录页：色调改为更明快的蓝色调

## 2026-04-18 第二批优化
- [x] WIP明细表：合计WIP=0的过滤移至后端查询层（SQL WHERE条件）
- [x] 委外订单明细表：回货率列去掉着色
- [x] WIP明细表：从汇总表跳转时显示“来自汇总表筛选”提示标签并冻结筛选条件

## 2026-04-18 第三批优化
- [x] 委外订单明细表：从汇总表跳转时显示“来自汇总表筛选”标签并冻结筛选条件
- [x] WIP明细表导出 Excel 列头“合计WIP数量”与页面保持一致

## 2026-04-18 第四批优化
- [x] WIP明细表导出 Excel 添加合计行
- [x] 委外订单明细表导出 Excel 添加合计行
- [x] WIP汇总表导出 Excel 添加未回货数量列
- [x] WIP明细表来源标签旁增加“返回汇总表”按鈕
- [x] 委外订单明细表来源标签旁增加“返回汇总表”按鈕
