# Database Manager

一个功能强大的VSCode数据库管理扩展，支持多种数据库系统的连接、查询和管理。

## 功能特点

- 支持多种数据库系统
  - MySQL
  - PostgreSQL
  - SQLite
  - Microsoft SQL Server
- 直观的数据库连接管理
  - 可视化的连接配置界面
  - 保存和管理多个数据库连接
  - 快速切换不同的数据库连接
- 强大的SQL工具
  - SQL查询编辑器，支持语法高亮
  - SQL语句执行和结果展示
  - 查询历史记录
- 数据库对象管理
  - 表格数据的增删改查
  - 数据库结构查看和修改
  - 存储过程和视图管理

## 安装

在VSCode扩展市场中搜索"Database Manager"并安装，或者通过以下步骤安装：

1. 打开VSCode
2. 按下`Ctrl+P`打开命令面板
3. 输入以下命令：
   ```
   ext install database-manager
   ```

## 使用方法

1. 添加数据库连接
   - 点击侧边栏的数据库图标
   - 点击"+"按钮添加新连接
   - 选择数据库类型并填写连接信息

2. 执行SQL查询
   - 在连接上右键选择"New Query"
   - 在查询编辑器中输入SQL语句
   - 点击工具栏的执行按钮或使用快捷键`Ctrl+Enter`执行查询

3. 管理数据库对象
   - 在数据库树视图中浏览表格、视图等对象
   - 右键点击对象进行相应操作

## 配置说明

在VSCode设置中可以自定义以下配置：

* `database-manager.maxConnections`: 最大同时连接数
* `database-manager.saveQueries`: 是否保存查询历史
* `database-manager.queryTimeout`: 查询超时时间（秒）
* `database-manager.logLevel`: 日志级别（debug/info/warn/error）

## 快捷键

* `Ctrl+Enter`: 执行当前SQL语句
* `Ctrl+Shift+E`: 打开新的查询编辑器
* `Ctrl+Alt+R`: 刷新数据库连接

## 版本历史

### 1.0.0
- 初始版本发布
- 支持基本的数据库连接和查询功能
- 实现数据库对象的基础管理功能

### 1.1.0
- 添加对PostgreSQL的支持
- 优化查询编辑器的性能
- 改进数据展示界面
- 修复已知问题

## 问题反馈

如果您在使用过程中遇到任何问题，或有功能建议，请在GitHub仓库提交Issue：
[GitHub Issues](https://github.com/yourusername/database-manager/issues)

## 贡献

欢迎提交Pull Request来改进这个项目。在提交之前，请确保：

1. 代码符合项目的编码规范
2. 添加了必要的测试用例
3. 更新了相关文档

## 许可证

本项目采用MIT许可证。详见[LICENSE](LICENSE)文件。

---

**享受使用Database Manager!**
