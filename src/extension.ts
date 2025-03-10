import * as vscode from 'vscode';
import { DatabaseManager } from './database/DatabaseManager';
import { DatabaseExplorerProvider, connectToDatabase } from './views/DatabaseExplorer';

export function activate(context: vscode.ExtensionContext) {
    console.log('数据库管理器插件已激活');

    const databaseManager = DatabaseManager.getInstance();
    databaseManager.initialize(context);
    console.log('DatabaseManager 实例已创建');

    const databaseExplorerProvider = new DatabaseExplorerProvider(databaseManager);
    console.log('DatabaseExplorerProvider 实例已创建');

    // 注册视图
    try {
        console.log('开始注册视图提供程序...');
        // 先创建视图容器
        // 使用createTreeView正确注册视图
        const treeView = vscode.window.createTreeView('databaseExplorer', {
            treeDataProvider: databaseExplorerProvider,
            showCollapseAll: true
        });
        context.subscriptions.push(treeView);
        console.log('视图注册成功');

        // 注册刷新命令
        const refreshCommand = vscode.commands.registerCommand('database-manager.refresh', () => {
            databaseExplorerProvider.refresh();
        });
        context.subscriptions.push(refreshCommand);

        // 初始刷新视图
        databaseExplorerProvider.refresh();
    } catch (error) {
        console.error('注册视图提供程序时出错:', error);
        vscode.window.showErrorMessage(`注册视图提供程序失败: ${(error as Error).message}`);
    }

    // 注册命令
    context.subscriptions.push(
        vscode.commands.registerCommand('database-manager.connectDatabase', async () => {
            await connectToDatabase();
            databaseExplorerProvider.refresh();
        }),

        vscode.commands.registerCommand('database-manager.refreshConnection', () => {
            databaseExplorerProvider.refresh();
        }),

        vscode.commands.registerCommand('database-manager.executeQuery', async () => {
            // 打开输入框让用户输入SQL查询
            const query = await vscode.window.showInputBox({
                prompt: '输入SQL查询语句',
                placeHolder: 'SELECT * FROM table_name'
            });

            if (!query) {
                return;
            }

            // 获取当前选中的连接
            const connections = databaseManager.getConnections();
            if (connections.length === 0) {
                vscode.window.showErrorMessage('没有可用的数据库连接');
                return;
            }

            // 如果有多个连接，让用户选择
            let connectionId: string;
            if (connections.length === 1) {
                connectionId = connections[0];
            } else {
                const configs = databaseManager.getAllConfigs();
                const items = Array.from(configs.entries()).map(([id, config]) => ({
                    label: config.alias,
                    description: config.type,
                    connectionId: id
                }));

                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: '选择要执行查询的数据库连接'
                });

                if (!selected) {
                    return;
                }

                connectionId = selected.connectionId;
            }

            try {
                // 确保连接已建立
                await databaseManager.ensureConnected(connectionId);

                // 执行查询
                const result = await databaseManager.executeQuery(connectionId, query);

                // 创建和显示 WebView 展示结果
                const panel = vscode.window.createWebviewPanel(
                    'queryResult',
                    '查询结果',
                    vscode.ViewColumn.One,
                    {
                        enableScripts: true
                    }
                );

                // 生成表格HTML
                let tableHtml = '';
                if (Array.isArray(result) && result.length > 0) {
                    // 生成表头
                    const headers = Object.keys(result[0]);
                    const headerRow = headers.map(h => `<th>${h}</th>`).join('');
                    
                    // 生成表体
                    const rows = result.map(row => {
                        const cells = headers.map(h => `<td>${row[h] === null ? 'NULL' : row[h]}</td>`).join('');
                        return `<tr>${cells}</tr>`;
                    }).join('');
                    
                    tableHtml = `
                    <table>
                        <thead>
                            <tr>${headerRow}</tr>
                        </thead>
                        <tbody>
                            ${rows}
                        </tbody>
                    </table>
                    `;
                } else {
                    tableHtml = '<p>查询执行成功，但没有返回数据。</p>';
                }

                // 设置WebView内容
                panel.webview.html = `
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>查询结果</title>
                    <style>
                        body {
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
                            padding: 10px;
                            background-color: #1e1e1e;
                            color: #cccccc;
                        }
                        table {
                            border-collapse: collapse;
                            width: 100%;
                        }
                        th, td {
                            text-align: left;
                            padding: 8px;
                            border: 1px solid #3c3c3c;
                        }
                        th {
                            background-color: #252526;
                        }
                        tr:nth-child(even) {
                            background-color: #252526;
                        }
                        tr:hover {
                            background-color: #2a2d2e;
                        }
                    </style>
                </head>
                <body>
                    <h2>查询结果</h2>
                    <p>执行的SQL: <code>${query}</code></p>
                    <p>返回记录数: ${Array.isArray(result) ? result.length : 0}</p>
                    ${tableHtml}
                </body>
                </html>
                `;
            } catch (error) {
                vscode.window.showErrorMessage(`执行查询失败: ${(error as Error).message}`);
            }
        }),

        vscode.commands.registerCommand('database-manager.removeConnection', async (node) => {
            try {
                if (!node || !node.connectionId) {
                return;
                }
                const confirm = await vscode.window.showWarningMessage(
                    `确定要删除连接 ${node.label} 吗？`, 
                    { modal: true }, 
                    '确定'
                );
                if (confirm === '确定') {
                    await DatabaseManager.getInstance().removeConfig(node.connectionId);
                    databaseExplorerProvider.refresh();
                    vscode.window.showInformationMessage('连接已删除');
                }
            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : '未知错误';
                console.error('删除连接失败:', error);
                vscode.window.showErrorMessage(`删除失败: ${errorMessage}`);
            }
        }),

        vscode.commands.registerCommand('database-manager.previewTable', async (node) => {
            try {
                if (!node || !node.table || !node.table.connectionId || !node.table.name) {
                    throw new Error('无效的表数据');
                }

                const connectionId = node.table.connectionId;
                const tableName = node.table.name;
                const databaseName = node.table.database; // 获取数据库名称

                // 检查数据库配置
                const config = databaseManager.getConnectionConfig(connectionId);
                if (!config) {
                    throw new Error('未找到数据库配置');
                }

                // 确保数据库已连接
                await databaseManager.ensureConnected(connectionId);

                // 创建和显示 WebView
                const panel = vscode.window.createWebviewPanel(
                    'tablePreview',
                    `${config.alias} - ${databaseName ? databaseName + '.' : ''}${tableName}`,
                    vscode.ViewColumn.One,
                    {
                        enableScripts: true,
                        retainContextWhenHidden: true
                    }
                );

                // 执行查询获取表数据
                let result;
                if (config.type === 'mongodb') {
                    try {
                        console.log('获取MongoDB表数据...');
                        
                        // 获取 MongoDB 连接
                        const connection = await databaseManager.getMongoConnection(connectionId, databaseName);
                        if (!connection) {
                            throw new Error('无法获取 MongoDB 连接');
                        }
                        
                        // 执行查询
                        console.log('执行MongoDB查询:', { collection: tableName });
                        const cursor = connection.collection(tableName).find({});
                        result = await cursor.toArray();
                        console.log('MongoDB查询结果:', result);
                    } catch (error) {
                        console.error('获取MongoDB表数据失败:', error);
                        vscode.window.showErrorMessage(`获取MongoDB表数据失败: ${(error as Error).message}`);
                        throw error;
                    }
                } else {
                    // 其他数据库使用 SQL 查询
                    result = await databaseManager.executeQuery(connectionId, `SELECT * FROM ${tableName} LIMIT 1000`) as Record<string, any>[];
                }

                // 获取表的主键信息
                let primaryKeys: string[] = [];
                try {
                    if (config.type === 'mongodb') {
                        // MongoDB 没有传统意义上的主键，但 _id 字段通常作为唯一标识符
                        primaryKeys = ['_id'];
                    } else if (config.type === 'sqlite') {
                        const pkQuery = `PRAGMA table_info(${tableName})`;
                        const pkResult = await databaseManager.executeQuery(connectionId, pkQuery);
                        primaryKeys = pkResult.filter((row: any) => row.pk === 1).map((row: any) => row.name);
                    } else if (config.type === 'oracle') {
                        // Oracle 查询主键
                        const pkQuery = `
                            SELECT cols.column_name
                            FROM all_constraints cons, all_cons_columns cols
                            WHERE cols.table_name = '${tableName.toUpperCase()}'
                            AND cons.constraint_type = 'P'
                            AND cons.constraint_name = cols.constraint_name
                            AND cons.owner = cols.owner
                            ORDER BY cols.position`;
                        const pkResult = await databaseManager.executeQuery(connectionId, pkQuery);
                        primaryKeys = pkResult.map((row: any) => row.COLUMN_NAME);
                    } else {
                        // MySQL 查询主键
                        const pkQuery = `
                            SELECT k.column_name
                            FROM information_schema.table_constraints t
                            JOIN information_schema.key_column_usage k
                            USING(constraint_name,table_schema,table_name)
                            WHERE t.constraint_type='PRIMARY KEY'
                                AND t.table_name='${tableName}'`;
                        const pkResult = await databaseManager.executeQuery(connectionId, pkQuery);
                        primaryKeys = pkResult.map((row: any) => row.column_name);
                    }
                } catch (error) {
                    console.warn('获取主键信息失败:', error);
                }

                // 如果没有主键，添加行号作为标识
                if (primaryKeys.length === 0 && config.type !== 'mongodb') {
                    if (config.type === 'sqlite') {
                        result = await databaseManager.executeQuery(connectionId, `SELECT rowid as __rowid, * FROM ${tableName} LIMIT 1000`);
                    } else if (config.type === 'oracle') {
                        // Oracle 使用 ROWNUM
                        const rowNumberQuery = `SELECT ROWNUM as __rowid, t.* FROM ${tableName} t WHERE ROWNUM <= 1000`;
                        result = await databaseManager.executeQuery(connectionId, rowNumberQuery);
                    } else {
                        // MySQL 使用变量
                        const rowNumberQuery = `SELECT (@row_number:=@row_number + 1) AS __rowid, t.* 
                             FROM ${tableName} t, (SELECT @row_number:=0) r 
                             LIMIT 1000`;
                        result = await databaseManager.executeQuery(connectionId, rowNumberQuery);
                    }
                }

                // 获取表的结构信息
                let columnInfo = [];
                try {
                    if (config.type === 'mongodb') {
                        // MongoDB 没有固定的表结构，从第一条记录推断
                        if (result.length > 0) {
                            columnInfo = Object.keys(result[0]).map(key => ({
                                column_name: key,
                                is_nullable: 'YES', // MongoDB 字段默认可为空
                                column_key: key === '_id' ? 'PRI' : ''
                            }));
                        }
                    } else if (config.type === 'sqlite') {
                        const columnQuery = `PRAGMA table_info(${tableName})`;
                        columnInfo = await databaseManager.executeQuery(connectionId, columnQuery);
                    } else if (config.type === 'oracle') {
                        const columnQuery = `
                            SELECT column_name, 
                                   CASE WHEN nullable = 'N' THEN 'NO' ELSE 'YES' END as is_nullable,
                                   CASE WHEN constraint_type = 'P' THEN 'PRI' ELSE '' END as column_key
                            FROM (
                                SELECT c.column_name, c.nullable, pk.constraint_type
                                FROM user_tab_columns c
                                LEFT JOIN (
                                    SELECT cols.column_name, cons.constraint_type
                                    FROM user_constraints cons
                                    JOIN user_cons_columns cols ON cons.constraint_name = cols.constraint_name
                                    WHERE cons.table_name = '${tableName.toUpperCase()}'
                                    AND cons.constraint_type = 'P'
                                ) pk ON c.column_name = pk.column_name
                                WHERE c.table_name = '${tableName.toUpperCase()}'
                            )`;
                        columnInfo = await databaseManager.executeQuery(connectionId, columnQuery);
                    } else {
                        // MySQL
                        const columnQuery = `SELECT column_name, is_nullable, column_key
                         FROM information_schema.columns 
                         WHERE table_name = '${tableName}'`;
                        columnInfo = await databaseManager.executeQuery(connectionId, columnQuery);
                    }
                } catch (error) {
                    console.warn('获取表结构信息失败:', error);
                }

                // 处理列信息
                interface ColumnInfo {
                    name?: string;
                    column_name?: string;
                    notnull?: number;
                    is_nullable?: string;
                    pk?: number;
                    column_key?: string;
                }

                let columnsMetadata;
                if (config.type === 'sqlite') {
                    columnsMetadata = columnInfo.map((col: ColumnInfo) => ({
                        name: col.name,
                        notNull: col.notnull === 1,
                        isPrimaryKey: col.pk === 1
                    }));
                } else if (config.type === 'mongodb' || config.type === 'oracle') {
                    columnsMetadata = columnInfo.map((col: ColumnInfo) => ({
                        name: col.column_name,
                        notNull: col.is_nullable === 'NO',
                        isPrimaryKey: col.column_key === 'PRI' || primaryKeys.includes(col.column_name || '')
                    }));
                } else {
                    columnsMetadata = columnInfo.map((col: ColumnInfo) => ({
                        name: col.column_name,
                        notNull: col.is_nullable === 'NO',
                        isPrimaryKey: col.column_key === 'PRI'
                    }));
                }

                // 生成表头和表体
                const headers = Object.keys(result[0] || {})
                    .filter(key => key !== '__rowid')
                    .map(key =>
                        '<th' + (primaryKeys.includes(key) ? ' class="primary-key"' : '') + '>' +
                        key +
                        '</th>'
                    ).join('');

                const tableBody = result.map((row: Record<string, any>, rowIndex: number) => {
                    const rowId = row.__rowid || rowIndex;
                    return '<tr data-row-index="' + rowIndex + '" data-row-id="' + rowId + '">' +
                        Object.entries(row)
                            .filter(([key]) => key !== '__rowid')
                            .map(([key, value]) =>
                                '<td class="editable' + (primaryKeys.includes(key) ? ' primary-key' : '') +
                                '" data-column="' + key +
                                '" data-original-value="' + (value === null ? '' : value) +
                                '" data-is-pk="' + (primaryKeys.includes(key) ? 'true' : 'false') + '">' +
                                (value === null ? 'NULL' : value) +
                                '</td>'
                            ).join('') +
                        '<td>' +
                        '<div class="row-actions">' +
                        '<button class="delete" title="删除此行" data-row-index="' + rowIndex + '">删除</button>' +
                        '</div>' +
                        '</td>' +
                        '</tr>';
                }).join('');

                // 生成 HTML 内容
                const htmlContent = `
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>表格预览</title>
                    <style>
                        body {
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
                            padding: 0;
                            margin: 0;
                            background-color: #1e1e1e;
                            color: #cccccc;
                        }
                        .container {
                            padding: 10px;
                        }
                        .toolbar {
                            margin-bottom: 10px;
                            padding: 5px 0;
                            display: flex;
                            align-items: center;
                        }
                        button {
                            background-color: #0e639c;
                            color: white;
                            border: none;
                            padding: 5px 10px;
                            margin-right: 10px;
                            cursor: pointer;
                            border-radius: 2px;
                        }
                        button:hover {
                            background-color: #1177bb;
                        }
                        button:active {
                            background-color: #0e5384;
                        }
                        .table-container {
                            overflow: auto;
                            max-height: calc(100vh - 100px);
                            border: 1px solid #3c3c3c;
                        }
                        table {
                            border-collapse: collapse;
                            width: 100%;
                        }
                        th, td {
                            text-align: left;
                            padding: 8px;
                            border: 1px solid #3c3c3c;
                        }
                        th {
                            background-color: #252526;
                            position: sticky;
                            top: 0;
                            z-index: 10;
                        }
                        tr:nth-child(even) {
                            background-color: #252526;
                        }
                        tr:hover {
                            background-color: #2a2d2e;
                        }
                        .primary-key {
                            font-weight: bold;
                            color: #3794ff;
                        }
                        .modified {
                            background-color: rgba(14, 99, 156, 0.2) !important;
                        }
                        .new-row {
                            background-color: rgba(0, 128, 0, 0.2) !important;
                        }
                        .deleted {
                            background-color: rgba(255, 0, 0, 0.2) !important;
                            text-decoration: line-through;
                        }
                        .editing input {
                            width: 100%;
                            box-sizing: border-box;
                            background-color: #2d2d2d;
                            color: #cccccc;
                            border: 1px solid #3794ff;
                            padding: 2px 5px;
                        }
                        #status {
                            margin-left: 10px;
                            color: #cccccc;
                        }
                        .error {
                            color: #ff6347;
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="toolbar">
                            <input type="text" id="searchInput" placeholder="搜索数据..." style="padding: 5px 10px; margin-right: 10px; background-color: #3c3c3c; border: 1px solid #4c4c4c; color: #cccccc; border-radius: 2px; width: 200px;">
                            <button id="addNewRowBtn" onclick="addNewRow()" title="添加新数据">添加数据</button>
                            <button id="saveChangesBtn" onclick="saveChanges()" title="保存所有修改的数据到数据库">保存更改</button>
                            <button id="refreshDataBtn" onclick="refreshData()" title="从数据库重新加载数据">刷新数据</button>
                            <span id="status"></span>
                        </div>
                        <div class="table-container">
                            <table>
                                <thead>
                                    <tr>
                                        ${columnsMetadata.map((col: any) => `<th class="${col.isPrimaryKey ? 'primary-key' : ''}" title="${col.name}${col.notNull ? ' (NOT NULL)' : ''}">${col.name}</th>`).join('')}
                                        <th>操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${result.map((row: any, rowIndex: number) => `
                                        <tr data-id="${rowIndex}">
                                            ${columnsMetadata.map((col: any) => `<td class="${col.isPrimaryKey ? 'primary-key editable' : 'editable'}" data-column="${col.name}" data-original-value="${row[col.name] === null ? '' : row[col.name]}">${row[col.name] === null ? 'NULL' : row[col.name]}</td>`).join('')}
                                            <td class="delete-row"><button class="delete-row-btn" title="删除此行">删除</button></td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <script>
                        // 初始化全局变量
                        let vscode = acquireVsCodeApi();
                        let modifiedData = {};
                        let deletedRows = [];
                        let newRows = [];
                        let currentRowIndex = null;
                        let primaryKeys = ${JSON.stringify(primaryKeys)};
                        let columnsMetadata = ${JSON.stringify(columnsMetadata)};

                        console.log('初始化全局变量完成');
                        console.log('primaryKeys:', primaryKeys);
                        console.log('columnsMetadata:', columnsMetadata);

                        // 添加新行
                        function addNewRow() {
                            console.log("添加新行按钮被点击");
                            try {
                                const table = document.querySelector('table');
                                if (!table) {
                                    console.error("未找到表格元素");
                                    return;
                                }
                                
                                const tbody = table.querySelector('tbody');
                                if (!tbody) {
                                    console.error("未找到表格体元素");
                return;
            }

                                const newRowId = \`new-\${Date.now()}\`;
                                const tr = document.createElement('tr');
                                tr.dataset.id = newRowId;
                                tr.classList.add('new-row');
                                
                                const columns = table.querySelectorAll('thead th');
                                columns.forEach((column, index) => {
                                    if (index < columns.length - 1) { // 跳过最后一列（操作列）
                                        const td = document.createElement('td');
                                        td.dataset.column = column.textContent;
                                        td.textContent = '';
                                        td.addEventListener('click', function() {
                                            startEditing(this);
                                        });
                                        tr.appendChild(td);
                                    }
                                });
                                
                                // 添加删除按钮
                                const deleteCell = document.createElement('td');
                                deleteCell.className = 'delete-row';
                                const deleteButton = document.createElement('button');
                                deleteButton.className = 'delete-row-btn';
                                deleteButton.title = '删除此行';
                                deleteButton.textContent = '删除';
                                deleteCell.appendChild(deleteButton);
                                tr.appendChild(deleteCell);
                                
                                tbody.appendChild(tr);
                                
                                // 添加到新行数组
                                newRows.push(newRowId);
                                
                                // 自动开始编辑第一个单元格
                                const firstCell = tr.querySelector('td');
                                if (firstCell) {
                                    startEditing(firstCell);
                                }
                                
                                console.log("新行已添加，ID:", newRowId);
                            } catch (error) {
                                console.error("添加新行时出错:", error);
                            }
                        }

                        // 保存更改
                        function saveChanges() {
                            console.log("保存更改按钮被点击");
                            try {
                                // 验证所有修改和新行
                                let hasErrors = false;
                                
                                // 验证修改的行
                                for (const rowId in modifiedData) {
                                    const data = modifiedData[rowId];
                                    const errors = validateData(data);
                                    if (errors.length > 0) {
                                        hasErrors = true;
                                        showError(\`行 \${rowId} 验证错误: \${errors.join(', ')}\`);
                                    }
                                }
                                
                                // 验证新行
                                const newRowElements = document.querySelectorAll('.new-row');
                                newRowElements.forEach(row => {
                                    const rowId = row.dataset.id;
                                    if (!modifiedData[rowId]) {
                                        modifiedData[rowId] = {};
                                    }
                                    
                                    const cells = row.querySelectorAll('td');
                                    cells.forEach(cell => {
                                        if (!cell.classList.contains('delete-row')) {
                                            const column = cell.dataset.column;
                                            modifiedData[rowId][column] = cell.textContent;
                                        }
                                    });
                                    
                                    const errors = validateData(modifiedData[rowId]);
                                    if (errors.length > 0) {
                                        hasErrors = true;
                                        showError(\`新行验证错误: \${errors.join(', ')}\`);
                                    }
                                });
                                
                                if (hasErrors) {
                return;
            }

                                // 发送数据到扩展
                                vscode.postMessage({
                                    command: 'saveChanges',
                                    modifiedData,
                                    deletedRows,
                                    newRows
                                });
                                
                                // 更新状态
                                document.getElementById('status').textContent = '正在保存...';
                                
                                console.log("已发送保存请求，数据:", {
                                    modifiedData,
                                    deletedRows,
                                    newRows
                                });
                            } catch (error) {
                                console.error("保存更改时出错:", error);
                                showError(\`保存时出错: \${error.message}\`);
                            }
                        }

                        // 刷新数据
                        function refreshData() {
                            console.log("刷新数据按钮被点击");
                            try {
                                vscode.postMessage({
                                    command: 'refreshData'
                                });
                                document.getElementById('status').textContent = '数据已刷新';
                            } catch (error) {
                                console.error("刷新数据时出错:", error);
                                showError(\`刷新时出错: \${error.message}\`);
                            }
                        }

                        // 验证数据
                        function validateData(data) {
                            const errors = [];
                            
                            // 检查主键和非空字段
                            columnsMetadata.forEach(column => {
                                const columnName = column.name;
                                const isPrimary = primaryKeys.includes(columnName);
                                const isNotNull = column.notNull;
                                
                                if ((isPrimary || isNotNull) && (!data[columnName] || data[columnName] === 'NULL' || data[columnName].trim() === '')) {
                                    errors.push(columnName + ' 不能为空');
                                }
                            });
                            
                            return errors;
                        }

                        // 开始编辑单元格
                        function startEditing(cell) {
                            console.log("开始编辑单元格:", cell.dataset.column);
                            try {
                                // 如果已经在编辑，先完成之前的编辑
                                const currentEditing = document.querySelector('.editing');
                                if (currentEditing) {
                                    const input = currentEditing.querySelector('input');
                                    if (input) {
                                        finishEditing(input);
                                    }
                                }
                                
                                // 保存原始值
                                cell.dataset.originalValue = cell.textContent;
                                
                                // 创建输入框
                                const input = document.createElement('input');
                                input.type = 'text';
                                input.value = cell.textContent;
                                input.style.width = '100%';
                                input.style.boxSizing = 'border-box';
                                input.style.backgroundColor = '#2d2d2d';
                                input.style.color = '#cccccc';
                                input.style.border = '1px solid #3794ff';
                                input.style.padding = '2px 5px';
                                
                                // 清空单元格并添加输入框
                                cell.textContent = '';
                                cell.classList.add('editing');
                                cell.appendChild(input);
                                
                                // 聚焦输入框
                                input.focus();
                                
                                // 输入框失去焦点时完成编辑
                                input.addEventListener('blur', function() {
                                    finishEditing(this);
                                });
                                
                                // 记录当前行索引
                                const row = cell.parentElement;
                                currentRowIndex = Array.from(row.parentElement.children).indexOf(row);
                                
                                console.log("单元格编辑已开始");
            } catch (error) {
                                console.error("开始编辑单元格时出错:", error);
                            }
                        }

                        // 完成编辑单元格
                        function finishEditing(input) {
                            console.log("完成编辑单元格");
                            try {
                                const cell = input.parentElement;
                                const newValue = input.value;
                                const column = cell.dataset.column;
                                const row = cell.parentElement;
                                const rowId = row.dataset.id;
                                
                                // 检查主键和非空字段
                                const isPrimary = primaryKeys.includes(column);
                                const isNotNull = columnsMetadata.some(col => col.name === column && col.notNull);
                                
                                if ((isPrimary || isNotNull) && (!newValue || newValue === 'NULL' || newValue.trim() === '')) {
                                    showError(column + ' 不能为空');
                                    input.focus();
                return;
            }

                                // 更新单元格内容
                                cell.textContent = newValue;
                                cell.classList.remove('editing');
                                
                                // 如果值发生变化，记录修改
                                if (newValue !== cell.dataset.originalValue) {
                                    if (!modifiedData[rowId]) {
                                        modifiedData[rowId] = {};
                                    }
                                    modifiedData[rowId][column] = newValue;
                                    
                                    // 标记行为已修改
                                    if (!row.classList.contains('new-row')) {
                                        row.classList.add('modified');
                                    }
                                    
                                    console.log("单元格已修改:", {
                                        rowId,
                                        column,
                                        value: newValue
                                    });
                                }
                                
                                // 重置当前行索引
                                currentRowIndex = null;
                            } catch (error) {
                                console.error("完成编辑单元格时出错:", error);
                            }
                        }

                        // 显示错误消息
                        function showError(message) {
                            console.error("错误:", message);
                            try {
                                const statusElement = document.getElementById('status');
                                if (statusElement) {
                                    statusElement.textContent = message;
                                    statusElement.style.color = '#ff6347';
                                    
                                    // 3秒后清除错误消息
                                    setTimeout(() => {
                                        statusElement.textContent = '';
                                        statusElement.style.color = '';
                                    }, 3000);
                                } else {
                                    console.error("未找到状态元素");
                                    alert(message);
                                }
                            } catch (error) {
                                console.error("显示错误消息时出错:", error);
                                alert(message);
                            }
                        }

                        // 设置事件委托
                        document.addEventListener('click', function(event) {
                            const target = event.target;
                            
                            // 处理删除行按钮点击
                            if (target.classList.contains('delete-row-btn')) {
                                const row = target.closest('tr');
                                if (row) {
                                    const rowId = row.dataset.id;
                                    if (rowId) {
                                        // 如果是新行，直接移除
                                        if (newRows.includes(rowId)) {
                                            const index = newRows.indexOf(rowId);
                                            if (index > -1) {
                                                newRows.splice(index, 1);
                                            }
                                            row.remove();
                                        } else {
                                            // 否则标记为删除
                                            deletedRows.push(rowId);
                                            row.classList.add('deleted');
                                            row.style.display = 'none';
                                        }
                                        console.log("行已删除，ID:", rowId);
                                    }
                                }
                            }
                            
                            // 处理单元格点击
                            if (target.tagName === 'TD' && !target.classList.contains('delete-row')) {
                                startEditing(target);
                            }
                        });
                        
                        // 处理键盘事件
                        document.addEventListener('keydown', function(event) {
                            if (event.key === 'Escape') {
                                const input = document.querySelector('.editing input');
                                if (input) {
                                    const cell = input.parentElement;
                                    cell.textContent = cell.dataset.originalValue || '';
                                    cell.classList.remove('editing');
                                    currentRowIndex = null;
                                }
                            } else if (event.key === 'Enter') {
                                const input = document.querySelector('.editing input');
                                if (input) {
                                    finishEditing(input);
                                }
                            }
                        });
                        
                        // 处理搜索输入
                        const searchInput = document.getElementById('searchInput');
                        if (searchInput) {
                            searchInput.addEventListener('input', function() {
                                const searchTerm = this.value.toLowerCase();
                                const rows = document.querySelectorAll('tbody tr');
                                
                                rows.forEach(row => {
                                    const cells = row.querySelectorAll('td');
                                    let found = false;
                                    
                                    cells.forEach(cell => {
                                        if (cell.textContent.toLowerCase().includes(searchTerm)) {
                                            found = true;
                                        }
                                    });
                                    
                                    row.style.display = found ? '' : 'none';
                                });
                            });
                            console.log("搜索输入事件已绑定");
                        } else {
                            console.error("未找到搜索输入框");
                        }

                        // 接收来自扩展的消息
                        window.addEventListener('message', event => {
                            const message = event.data;
                            
                            switch (message.command) {
                                case 'saveSuccess':
                                    // 清除所有修改标记
                                    document.querySelectorAll('.modified, .new-row').forEach(row => {
                                        row.classList.remove('modified', 'new-row');
                                    });
                                    
                                    // 重置数据
                                    modifiedData = {};
                                    deletedRows = [];
                                    newRows = [];
                                    
                                    document.getElementById('status').textContent = '保存成功';
                                    setTimeout(() => {
                                        document.getElementById('status').textContent = '';
                                    }, 3000);
                                    break;
                                    
                                case 'updateData':
                                    console.log('收到数据更新消息:', message.data);
                                    // 更新表格数据
                                    const tbody = document.querySelector('tbody');
                                    if (tbody) {
                                        // 清空表格
                                        tbody.innerHTML = '';
                                        
                                        // 添加新数据
                                        message.data.forEach((row, rowIndex) => {
                                            const tr = document.createElement('tr');
                                            tr.dataset.id = rowIndex.toString();
                                            
                                            // 添加数据列
                                            columnsMetadata.forEach(col => {
                                                const td = document.createElement('td');
                                                td.dataset.column = col.name;
                                                td.dataset.originalValue = row[col.name] === null ? '' : row[col.name];
                                                td.textContent = row[col.name] === null ? 'NULL' : row[col.name];
                                                td.classList.add('editable');
                                                if (col.isPrimaryKey) {
                                                    td.classList.add('primary-key');
                                                }
                                                tr.appendChild(td);
                                            });
                                            
                                            // 添加操作列
                                            const actionTd = document.createElement('td');
                                            actionTd.classList.add('delete-row');
                                            const deleteBtn = document.createElement('button');
                                            deleteBtn.classList.add('delete-row-btn');
                                            deleteBtn.title = '删除此行';
                                            deleteBtn.textContent = '删除';
                                            actionTd.appendChild(deleteBtn);
                                            tr.appendChild(actionTd);
                                            
                                            tbody.appendChild(tr);
                                        });
                                    }
                                    
                                    // 重置数据
                                    modifiedData = {};
                                    deletedRows = [];
                                    newRows = [];
                                    
                                    document.getElementById('status').textContent = '数据已刷新';
                                    setTimeout(() => {
                                        document.getElementById('status').textContent = '';
                                    }, 3000);
                                    break;
                                    
                                case 'error':
                                    showError(message.error);
                                    break;
                            }
                        });

                        console.log("脚本初始化完成");
                    </script>
                </body>
                </html>
                `;

                panel.webview.html = htmlContent;

                // 处理来自 WebView 的消息
                panel.webview.onDidReceiveMessage(async message => {
                    console.log('收到来自 WebView 的消息:', message);
                    
                    try {
                        switch (message.command) {
                            case 'saveChanges':
                                console.log('处理保存更改请求:', message);
                                
                                // 获取原始数据
                                let originalData: Record<string, any> = {};
                                
                                if (config.type === 'mongodb') {
                                    try {
                                        console.log('获取MongoDB原始数据...');
                                        
                                        // 获取 MongoDB 连接
                                        const connection = await databaseManager.getMongoConnection(connectionId, databaseName);
                                        if (!connection) {
                                            throw new Error('无法获取 MongoDB 连接');
                                        }
                                        
                                        // 执行查询
                                        console.log('执行MongoDB查询:', { collection: tableName });
                                        const cursor = connection.collection(tableName).find({});
                                        const mongoResult = await cursor.toArray();
                                        console.log('MongoDB查询结果:', mongoResult);
                                        
                                        // 将结果转换为索引对象
                                        mongoResult.forEach((row: any, index: number) => {
                                            originalData[index] = row;
                                        });
                                    } catch (error) {
                                        console.error('获取MongoDB原始数据失败:', error);
                                        vscode.window.showErrorMessage(`获取MongoDB原始数据失败: ${(error as Error).message}`);
                                        throw error;
                                    }
                                } else {
                                    const result = await databaseManager.executeQuery(connectionId, 'SELECT * FROM ' + tableName + ' LIMIT 1000');
                                    result.forEach((row: any, index: number) => {
                                        originalData[index] = row;
                                    });
                                }
                                
                                // 构建 changes 对象
                                const changes = {
                                    deletes: [] as Array<{primaryKeyData: Record<string, any>, rowData: Record<string, any>}>,
                                    updates: [] as Array<{primaryKeyData: Record<string, any>, updateData: Record<string, any>}>,
                                    inserts: [] as Array<{insertData: Record<string, any>}>
                                };
                                
                                // 处理删除的行
                                if (message.deletedRows && message.deletedRows.length > 0) {
                                    for (const rowId of message.deletedRows) {
                                        if (originalData[rowId]) {
                                            // 获取主键数据
                                            const primaryKeyData: Record<string, any> = {};
                                            for (const pk of primaryKeys) {
                                                primaryKeyData[pk] = originalData[rowId][pk];
                                            }
                                            // 保存整行数据用于无主键情况
                                            changes.deletes.push({ 
                                                primaryKeyData,
                                                rowData: {...originalData[rowId]} 
                                            });
                                        }
                                    }
                                }
                                
                                // 处理修改的行
                                if (message.modifiedData) {
                                    for (const rowId in message.modifiedData) {
                                        // 跳过新行，新行会在 inserts 中处理
                                        if (message.newRows && message.newRows.includes(rowId)) {
                                            continue;
                                        }
                                        
                                        const updateData = message.modifiedData[rowId];
                                        // 获取主键数据
                                        const primaryKeyData: Record<string, any> = {};
                                        for (const pk of primaryKeys) {
                                            if (originalData[rowId]) {
                                                primaryKeyData[pk] = originalData[rowId][pk];
                                            }
                                        }
                                        changes.updates.push({ primaryKeyData, updateData });
                                    }
                                }
                                
                                // 处理新行
                                if (message.newRows && message.newRows.length > 0) {
                                    for (const rowId of message.newRows) {
                                        if (message.modifiedData && message.modifiedData[rowId]) {
                                            changes.inserts.push({ insertData: message.modifiedData[rowId] });
                                        }
                                    }
                                }
                                
                                console.log('构建的 changes 对象:', changes);
                                
                                // MongoDB 需要特殊处理
                                if (config.type === 'mongodb') {
                                    try {
                                        console.log('处理MongoDB数据保存...');
                                        
                                        // 获取 MongoDB 连接
                                        const connection = await databaseManager.getMongoConnection(connectionId, databaseName);
                                        if (!connection) {
                                            throw new Error('无法获取 MongoDB 连接');
                                        }
                                        
                                        // 处理删除
                                        for (const deleteOp of changes.deletes) {
                                            // 构建删除条件
                                            const filter: Record<string, any> = {};
                                            // 如果有 _id 字段，优先使用
                                            if (deleteOp.rowData._id) {
                                                filter._id = deleteOp.rowData._id;
                                            } else {
                                                // 否则使用所有非空字段作为条件
                                                Object.entries(deleteOp.rowData).forEach(([key, value]) => {
                                                    if (value !== null && value !== undefined && value !== '') {
                                                        filter[key] = value;
                                                    }
                                                });
                                            }
                                            
                                            // 执行删除操作
                                            console.log('执行MongoDB删除操作:', { collection: tableName, filter });
                                            const deleteResult = await connection.collection(tableName).deleteOne(filter);
                                            console.log('MongoDB删除结果:', deleteResult);
                                        }
                                        
                                        // 处理更新
                                        for (const updateOp of changes.updates) {
                                            // 构建更新条件
                                            const filter: Record<string, any> = {};
                                            // 如果有 _id 字段，优先使用
                                            if (updateOp.primaryKeyData._id) {
                                                filter._id = updateOp.primaryKeyData._id;
                                            } else {
                                                // 否则使用所有主键字段作为条件
                                                Object.entries(updateOp.primaryKeyData).forEach(([key, value]) => {
                                                    if (value !== null && value !== undefined && value !== '') {
                                                        filter[key] = value;
                                                    }
                                                });
                                            }
                                            
                                            // 构建更新数据
                                            const update = { $set: updateOp.updateData };
                                            
                                            // 执行更新操作
                                            console.log('执行MongoDB更新操作:', { collection: tableName, filter, update });
                                            const updateResult = await connection.collection(tableName).updateOne(filter, update);
                                            console.log('MongoDB更新结果:', updateResult);
                                        }
                                        
                                        // 处理插入
                                        for (const insertOp of changes.inserts) {
                                            // 执行插入操作
                                            console.log('执行MongoDB插入操作:', { collection: tableName, data: insertOp.insertData });
                                            const insertResult = await connection.collection(tableName).insertOne(insertOp.insertData);
                                            console.log('MongoDB插入结果:', insertResult);
                                        }
                                    } catch (error) {
                                        console.error('MongoDB数据保存失败:', error);
                                        vscode.window.showErrorMessage(`MongoDB数据保存失败: ${(error as Error).message}`);
                                        throw error;
                                    }
                                } else {
                                    // 处理删除
                                    for (const deleteOp of changes.deletes) {
                                        // 使用所有列构建更精确的WHERE条件
                                        const rowId = message.deletedRows.find((id: string) => 
                                            Object.entries(deleteOp.primaryKeyData).some(([key, value]) => 
                                                originalData[id] && originalData[id][key] === value
                                            )
                                        );
                                        
                                        if (!rowId || !originalData[rowId]) {
                                            console.warn('跳过删除操作：找不到原始行数据');
                                            continue;
                                        }
                                        
                                        // 使用所有列构建WHERE条件
                                        const whereConditions = Object.entries(originalData[rowId])
                                            .map(([column, value]) => {
                                                if (value === null || value === 'NULL' || value === '') {
                                                    return column + ' IS NULL';
                                                }
                                                return column + ' = ' + (typeof value === 'string' ? "'" + value.replace(/'/g, "''") + "'" : value);
                                            })
                                            .filter(condition => condition) // 过滤掉空条件
                                            .join(' AND ');

                                        if (!whereConditions) {
                                            console.warn('跳过删除操作：没有有效的 WHERE 条件');
                                            continue;
                                        }

                                        const deleteQuery = 'DELETE FROM ' + tableName + ' WHERE ' + whereConditions;
                                        console.log('执行删除查询:', deleteQuery);
                                        await databaseManager.executeQuery(connectionId, deleteQuery);
                                    }

                                    // 处理更新
                                    for (const updateOp of changes.updates) {
                                        const whereConditions = Object.entries(updateOp.primaryKeyData)
                                            .map(([column, value]) => {
                                                // 主键不允许为 NULL
                                                if (primaryKeys.includes(column)) {
                                                    return column + ' = ' + (typeof value === 'string' ? "'" + value + "'" : value);
                                                } else if (value === null || value === 'NULL' || value === '') {
                                                    return column + ' IS NULL';
                                                } else {
                                                    return column + ' = ' + (typeof value === 'string' ? "'" + value + "'" : value);
                                                }
                                            })
                                            .filter(condition => condition) // 过滤掉空条件
                                            .join(' AND ');

                                        const setValues = Object.entries(updateOp.updateData)
                                            .map(([column, value]) => {
                                                // 主键不允许为 NULL
                                                if (primaryKeys.includes(column)) {
                                                    return column + ' = ' + (typeof value === 'string' ? "'" + value + "'" : value);
                                                } else if (value === null) {
                                                    return column + ' = NULL';
                                                } else {
                                                    return column + ' = ' + (typeof value === 'string' ? "'" + value + "'" : value);
                                                }
                                            })
                                            .join(', ');

                                        const updateQuery = 'UPDATE ' + tableName + ' SET ' + setValues + ' WHERE ' + whereConditions;
                                        console.log('执行更新查询:', updateQuery);
                                        await databaseManager.executeQuery(connectionId, updateQuery);
                                    }

                                    // 处理插入
                                    for (const insertOp of changes.inserts) {
                                        // 过滤掉空值和NULL值的主键
                                        const insertData = { ...insertOp.insertData };
                                        
                                        // 检查主键是否为空或NULL
                                        const hasPrimaryKeyValue = primaryKeys.some(pk => 
                                            insertData[pk] !== undefined && 
                                            insertData[pk] !== null && 
                                            insertData[pk] !== 'NULL' && 
                                            insertData[pk].toString().trim() !== ''
                                        );
                                        
                                        // 如果是自增主键且没有提供值，则不包含主键列
                                        const columns = Object.keys(insertData)
                                            .filter(col => {
                                                // 如果是主键且值为空，则不包含该列（让数据库自动生成）
                                                if (primaryKeys.includes(col)) {
                                                    const value = insertData[col];
                                                    return value !== undefined && 
                                                           value !== null && 
                                                           value !== 'NULL' && 
                                                           value.toString().trim() !== '';
                                                }
                                                return true; // 非主键列都包含
                                            });
                                        
                                        const values = columns.map(column => {
                                            const value = insertData[column];
                                            if (value === null || value === 'NULL' || value === '') {
                                                return 'NULL';
                                            } else {
                                                return typeof value === 'string' ? "'" + value.replace(/'/g, "''") + "'" : value;
                                            }
                                        });

                                        const insertQuery = columns.length > 0 ?
                                            'INSERT INTO ' + tableName + ' (' + columns.join(', ') + ') VALUES (' + values.join(', ') + ')' :
                                            'INSERT INTO ' + tableName + ' DEFAULT VALUES';
                                            
                                        console.log('执行插入查询:', insertQuery);
                                        await databaseManager.executeQuery(connectionId, insertQuery);
                                    }
                                }
                                
                                // 发送保存成功消息
                                panel.webview.postMessage({ command: 'saveSuccess' });
                                vscode.window.showInformationMessage('数据更新成功');

                                // 刷新数据
                                let refreshResult;
                                try {
                                    if (config.type === 'mongodb') {
                                        console.log('刷新MongoDB数据...');
                                        
                                        // 获取 MongoDB 连接
                                        const connection = await databaseManager.getMongoConnection(connectionId, databaseName);
                                        if (!connection) {
                                            throw new Error('无法获取 MongoDB 连接');
                                        }
                                        
                                        // 执行查询
                                        console.log('执行MongoDB查询:', { collection: tableName });
                                        const cursor = connection.collection(tableName).find({});
                                        refreshResult = await cursor.toArray();
                                        console.log('MongoDB查询结果:', refreshResult);
                                    } else {
                                        refreshResult = await databaseManager.executeQuery(connectionId, 'SELECT * FROM ' + tableName + ' LIMIT 1000');
                                    }
                                    
                                    panel.webview.postMessage({ 
                                        command: 'updateData',
                                        data: refreshResult
                                    });
                                } catch (error) {
                                    console.error('刷新数据失败:', error);
                                    vscode.window.showErrorMessage(`刷新数据失败: ${(error as Error).message}`);
                                }
                                break;
                                
                            case 'refreshData':
                                console.log('处理刷新数据请求');
                                
                                let refreshDataResult;
                                try {
                                    if (config.type === 'mongodb') {
                                        console.log('刷新MongoDB数据...');
                                        
                                        // 获取 MongoDB 连接
                                        const connection = await databaseManager.getMongoConnection(connectionId, databaseName);
                                        if (!connection) {
                                            throw new Error('无法获取 MongoDB 连接');
                                        }
                                        
                                        // 执行查询
                                        console.log('执行MongoDB查询:', { collection: tableName });
                                        const cursor = connection.collection(tableName).find({});
                                        refreshDataResult = await cursor.toArray();
                                        console.log('MongoDB查询结果:', refreshDataResult);
                                    } else {
                                        refreshDataResult = await databaseManager.executeQuery(connectionId, 'SELECT * FROM ' + tableName + ' LIMIT 1000');
                                    }
                                    
                                    panel.webview.postMessage({ 
                                        command: 'updateData',
                                        data: refreshDataResult
                                    });
                                } catch (error) {
                                    console.error('刷新数据失败:', error);
                                    vscode.window.showErrorMessage(`刷新数据失败: ${(error as Error).message}`);
                                }
                                break;
                                
                            default:
                                console.warn('未知命令:', message.command);
                                break;
                        }
                    } catch (error: any) {
                        console.error('处理 WebView 消息时出错:', error);
                        panel.webview.postMessage({ 
                            command: 'error',
                            error: error.message
                        });
                        vscode.window.showErrorMessage(`操作失败: ${error.message}`);
                    }
                });
            } catch (error) {
                console.error('预览表数据时出错:', error);
                vscode.window.showErrorMessage(`预览表数据失败: ${(error as Error).message}`);
            }
        }));
}
