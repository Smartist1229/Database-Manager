import * as vscode from 'vscode';
import { DatabaseManager } from './database/DatabaseManager';
import { DatabaseExplorerProvider, connectToDatabase } from './views/DatabaseExplorer';
import { ConfigManager } from './database/ConfigManager';

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

        vscode.commands.registerCommand('database-manager.previewTable', async (node) => {
            try {
                if (!node || !node.table || !node.table.connectionId || !node.table.name) {
                    throw new Error('无效的表数据');
                }

                const connectionId = node.table.connectionId;
                const tableName = node.table.name;

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
                    `${config.alias} - ${tableName}`,
                    vscode.ViewColumn.One,
                    {
                        enableScripts: true,
                        retainContextWhenHidden: true
                    }
                );

                // 执行查询获取表数据
                let result = await databaseManager.executeQuery(connectionId, `SELECT * FROM ${tableName} LIMIT 1000`) as Record<string, any>[];

                // 获取表的主键信息
                let primaryKeys: string[] = [];
                try {
                    const pkQuery = config.type === 'sqlite' ?
                        `PRAGMA table_info(${tableName})` :
                        `SELECT k.column_name
                        FROM information_schema.table_constraints t
                        JOIN information_schema.key_column_usage k
                        USING(constraint_name,table_schema,table_name)
                        WHERE t.constraint_type='PRIMARY KEY'
                            AND t.table_name='${tableName}'`;

                    const pkResult = await databaseManager.executeQuery(connectionId, pkQuery);
                    primaryKeys = config.type === 'sqlite' ?
                        pkResult.filter((row: any) => row.pk === 1).map((row: any) => row.name) :
                        pkResult.map((row: any) => row.column_name);
                } catch (error) {
                    console.warn('获取主键信息失败:', error);
                }

                // 如果没有主键，添加行号作为标识
                if (primaryKeys.length === 0) {
                    if (config.type === 'sqlite') {
                        result = await databaseManager.executeQuery(connectionId, `SELECT rowid as __rowid, * FROM ${tableName} LIMIT 1000`);
                    } else {
                        // 对于其他数据库，使用 ROW_NUMBER() 函数
                        const rowNumberQuery = config.type === 'mysql' ?
                            `SELECT (@row_number:=@row_number + 1) AS __rowid, t.* 
                             FROM ${tableName} t, (SELECT @row_number:=0) r 
                             LIMIT 1000` :
                            `SELECT ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) as __rowid, * 
                             FROM ${tableName} 
                             LIMIT 1000`;
                        result = await databaseManager.executeQuery(connectionId, rowNumberQuery);
                    }
                }

                // 获取表的结构信息
                let columnInfo = [];
                try {
                    const columnQuery = config.type === 'sqlite' ?
                        `PRAGMA table_info(${tableName})` :
                        `SELECT column_name, is_nullable, column_key
                         FROM information_schema.columns 
                         WHERE table_name = '${tableName}'`;

                    columnInfo = await databaseManager.executeQuery(connectionId, columnQuery);
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

                const columnsMetadata = config.type === 'sqlite' ?
                    columnInfo.map((col: ColumnInfo) => ({
                        name: col.name,
                        notNull: col.notnull === 1,
                        isPrimaryKey: col.pk === 1
                    })) :
                    columnInfo.map((col: ColumnInfo) => ({
                        name: col.column_name,
                        notNull: col.is_nullable === 'NO',
                        isPrimaryKey: col.column_key === 'PRI'
                    }));

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
                        '<button onclick="deleteRow(' + rowIndex + ')" class="delete" title="删除此行">删除</button>' +
                        '</div>' +
                        '</td>' +
                        '</tr>';
                }).join('');

                // 生成HTML内容
                const htmlContent = `<!DOCTYPE html>
<html>
<head>
    <style>
        body { 
            padding: 10px; 
            font-family: Arial, sans-serif;
            background-color: #1e1e1e;
            color: #cccccc;
        }
        .toolbar {
            margin-bottom: 10px;
            padding: 10px;
            background: #252526;
            border-radius: 4px;
            position: sticky;
            top: 0;
            z-index: 1000;
        }
        .toolbar button {
            padding: 5px 10px;
            margin-right: 5px;
            cursor: pointer;
            background-color: #2d2d2d;
            border: 1px solid #3c3c3c;
            color: #cccccc;
            border-radius: 2px;
            position: relative;
        }
        .toolbar button:hover {
            background-color: #37373d;
        }
        .toolbar button[title]:hover::after {
            content: attr(title);
            position: absolute;
            bottom: 100%;
            left: 50%;
            transform: translateX(-50%);
            padding: 4px 8px;
            background-color: #252526;
            border: 1px solid #3c3c3c;
            border-radius: 2px;
            white-space: nowrap;
            z-index: 1000;
        }
        .table-container {
            overflow: auto;
            max-height: calc(100vh - 100px);
            position: relative;
            padding-bottom: 20px;
        }
        table {
            border-collapse: collapse;
            width: 100%;
            margin-top: 10px;
            margin-bottom: 20px;
            background-color: #1e1e1e;
        }
        th, td {
            border: 1px solid #3c3c3c;
            padding: 8px;
            text-align: left;
            min-width: 100px;
            max-width: 300px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        th {
            background-color: #252526;
            position: sticky;
            top: 0;
            color: #cccccc;
            z-index: 10;
        }
        tr {
            background-color: #1e1e1e;
            position: relative;
        }
        tr:nth-child(even) {
            background-color: #252526;
        }
        .editable {
            cursor: pointer;
            user-select: none;
        }
        .editable:hover {
            background-color: #37373d;
        }
        .editing input {
            width: 100%;
            padding: 5px;
            box-sizing: border-box;
            border: 1px solid #0e639c;
            border-radius: 2px;
            background-color: #3c3c3c;
            color: #cccccc;
        }
        .modified {
            background-color: #3c1e1e !important;
        }
        #status {
            color: #89d185;
            margin-left: 10px;
        }
        .toolbar button.danger {
            background-color: #4d1f1f;
            border-color: #6e2c2c;
        }
        .toolbar button.danger:hover {
            background-color: #6e2c2c;
        }
        .toolbar button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }
        .row-actions {
            visibility: hidden;
            position: absolute;
            right: 4px;
            top: 50%;
            transform: translateY(-50%);
            z-index: 100;
            transition: visibility 0s;
        }
        tr:hover .row-actions {
            visibility: visible;
        }
        .row-actions button {
            padding: 4px 8px;
            margin: 0;
            cursor: pointer;
            background-color: transparent;
            border: none;
            color: #cccccc;
            font-size: 14px;
            line-height: 1;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            opacity: 0.6;
        }
        .row-actions button.delete {
            color: #ff6b6b;
            opacity: 0.8;
            background-color: rgba(255, 107, 107, 0.1);
            padding: 6px;
            border-radius: 4px;
            margin-right: 4px;
        }
        .row-actions button.delete:hover {
            opacity: 1;
            transform: scale(1.1);
            background-color: rgba(255, 107, 107, 0.2);
        }
        .row-actions button.delete::before {
            content: '🗑';
            font-size: 16px;
        }
        td:last-child {
            position: relative;
            width: 40px;
            padding: 8px;
            min-width: 40px;
        }
        .primary-key {
            color: #ffd700 !important;
            font-weight: bold;
            position: relative;
        }
        th.primary-key {
            padding-right: 24px;
        }
        th.primary-key::after {
            content: '';
            position: absolute;
            right: 8px;
            top: 50%;
            transform: translateY(-50%);
            width: 12px;
            height: 12px;
            background: #ffd700;
            mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z'/%3E%3C/svg%3E");
            mask-size: contain;
            mask-repeat: no-repeat;
            mask-position: center;
            -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z'/%3E%3C/svg%3E");
            -webkit-mask-size: contain;
            -webkit-mask-repeat: no-repeat;
            -webkit-mask-position: center;
            opacity: 0.8;
        }
        th.primary-key:hover::after {
            opacity: 1;
            transform: translateY(-50%) scale(1.1);
            transition: all 0.2s ease;
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <input type="text" id="searchInput" placeholder="搜索数据..." style="padding: 5px 10px; margin-right: 10px; background-color: #3c3c3c; border: 1px solid #4c4c4c; color: #cccccc; border-radius: 2px; width: 200px;">
        <button onclick="addNewRow()" title="添加新数据">添加数据</button>
        <button onclick="saveChanges()" title="保存所有修改的数据到数据库">保存更改</button>
        <button onclick="refreshData()" title="从数据库重新加载数据">刷新数据</button>
        <span id="status"></span>
    </div>
    <div class="table-container">
        <table id="dataTable">
            <thead>
                <tr>
                    ${headers}
                    <th style="width: 100px;">操作</th>
                </tr>
            </thead>
            <tbody>
                ${tableBody}
            </tbody>
        </table>
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        let modifiedData = new Map();
        let deletedRows = new Set();
        let newRows = new Set();
        let currentRowIndex = ${result.length};
        let primaryKeys = ${JSON.stringify(primaryKeys)};
        let columnsMetadata = ${JSON.stringify(columnsMetadata)};

        function getRowIdentifier(row) {
            const identifier = {};
            if (primaryKeys.length > 0) {
                // 如果有主键，使用主键值
                primaryKeys.forEach(key => {
                    const cell = row.querySelector('td[data-column="' + key + '"]');
                    if (cell) {
                        const value = cell.textContent.trim();
                        // 主键不允许为 NULL
                        identifier[key] = value === 'NULL' ? '' : value;
                    }
                });
            } else {
                // 如果没有主键，使用行ID和所有列的值组合
                const rowId = row.dataset.rowId;
                identifier['__rowid'] = rowId;
                
                // 同时也保存所有列的值作为额外的验证
                Array.from(row.cells).forEach(cell => {
                    if (!cell.classList.contains('editable')) return;
                    const column = cell.dataset.column;
                    const value = cell.textContent.trim();
                    // 只有当值真的是 'NULL' 时才设为 null
                    identifier[column] = value === 'NULL' ? null : value;
                });
            }
            return identifier;
        }

        function deleteRow(rowIndex) {
            const row = document.querySelector('tr[data-row-index="' + rowIndex + '"]');
            if (!row) return;
            
            // 确认删除
            if (!confirm('确定要删除这行数据吗？')) {
                return;
            }
            
            // 如果是新添加的行，直接从DOM中移除
            if (newRows.has(parseInt(rowIndex))) {
                row.remove();
                newRows.delete(parseInt(rowIndex));
                return;
            }
            
            // 标记为已删除
            row.style.display = 'none';
            const rowId = row.dataset.rowId;
            deletedRows.add(rowId || rowIndex.toString());
            
            // 清空搜索框，显示所有数据
            const searchInput = document.getElementById('searchInput');
            if (searchInput && searchInput.value) {
                searchInput.value = '';
                // 触发 input 事件以更新表格显示
                searchInput.dispatchEvent(new Event('input'));
            }
        }

        function addNewRow() {
            const tbody = document.querySelector('tbody');
            const headers = Array.from(document.querySelectorAll('thead th')).slice(0, -1);
            const newRowIndex = currentRowIndex++;
            
            const tr = document.createElement('tr');
            tr.dataset.rowIndex = newRowIndex.toString();
            tr.innerHTML = headers.map(th => {
                const columnName = th.textContent.replace(' 🔑', ''); // 移除可能存在的主键图标
                const isPrimaryKey = primaryKeys.includes(columnName);
                const columnMeta = columnsMetadata.find(col => col.name === columnName);
                const isNotNull = columnMeta?.notNull;
                const value = '';
                
                return '<td class="editable' + (isPrimaryKey ? ' primary-key' : '') + 
                    '" data-column="' + columnName + 
                    '" data-original-value="' + value + 
                    '" data-is-pk="' + isPrimaryKey + '">' +
                    (isPrimaryKey || isNotNull ? '' : 'NULL') +
                '</td>';
            }).join('') + '<td>' +
                '<div class="row-actions">' +
                    '<button onclick="deleteRow(' + newRowIndex + ')" class="delete" title="删除此行">删除</button>' +
                '</div>' +
            '</td>';
            
            tbody.appendChild(tr);
            bindEditableEvents();
            newRows.add(newRowIndex);

            // 自动开始编辑第一个单元格
            const firstCell = tr.querySelector('.editable');
            if (firstCell) {
                firstCell.dispatchEvent(new MouseEvent('dblclick', {
                    bubbles: true,
                    cancelable: true,
                    view: window
                }));
            }

            // 更新状态显示
            document.getElementById('status').textContent = '已添加新行，请输入数据后点击保存更改';
            setTimeout(() => {
                document.getElementById('status').textContent = '';
            }, 3000);
        }

        function validateData(data) {
            const errors = [];
            
            columnsMetadata.forEach(col => {
                const value = data[col.name];
                // 主键或非空字段必须有值（去除空格后）
                if ((col.isPrimaryKey || col.notNull) && 
                    (value === undefined || value === null || value.toString().trim() === '' || value === 'NULL')) {
                    errors.push(col.name + ' 不能为空');
                }
            });

            return errors;
        }

        function finishEditing(input) {
            const cell = input.parentElement;
            const newValue = input.value.trim();  // 去除首尾空格
            const originalValue = cell.dataset.originalValue;
            const column = cell.dataset.column;
            const rowIndex = cell.parentElement.dataset.rowIndex;
            const isPrimaryKey = cell.dataset.isPk === 'true';
            const columnMeta = columnsMetadata.find(col => col.name === column);
            
            // 验证主键和非空字段
            if ((isPrimaryKey || columnMeta?.notNull) && (!newValue || newValue === 'NULL')) {
                document.getElementById('status').textContent = column + ' 不能为空';
                setTimeout(() => {
                    document.getElementById('status').textContent = '';
                }, 3000);
                input.focus();
                return;
            }
            
            cell.classList.remove('editing');
            
            // 如果是主键或非空字段，直接使用值，否则如果为空则显示 NULL
            cell.textContent = (isPrimaryKey || columnMeta?.notNull) ? newValue : (newValue || 'NULL');
            
            if (newValue !== originalValue) {
                cell.classList.add('modified');
                
                if (!modifiedData.has(rowIndex)) {
                    modifiedData.set(rowIndex, new Map());
                }
                
                // 保存实际值，主键和非空字段不允许为 null
                if (isPrimaryKey || columnMeta?.notNull) {
                    modifiedData.get(rowIndex).set(column, newValue);
                } else {
                    modifiedData.get(rowIndex).set(column, newValue === 'NULL' || !newValue ? null : newValue);
                }
            } else {
                cell.classList.remove('modified');
            }
        }

        function saveChanges() {
            if (modifiedData.size === 0 && deletedRows.size === 0 && newRows.size === 0) {
                document.getElementById('status').textContent = '没有需要保存的更改';
                setTimeout(() => {
                    document.getElementById('status').textContent = '';
                }, 3000);
                return;
            }

            // 验证所有更改
            let hasErrors = false;
            const allErrors = [];

            // 验证更新
            modifiedData.forEach((columns, rowIndex) => {
                if (newRows.has(parseInt(rowIndex))) return;
                const row = document.querySelector('tr[data-row-index="' + rowIndex + '"]');
                if (!row || deletedRows.has(parseInt(rowIndex))) return;

                const updateData = {};
                columns.forEach((value, column) => {
                    const cell = row.querySelector('td[data-column="' + column + '"]');
                    const isPrimaryKey = cell && cell.dataset.isPk === 'true';
                    const columnMeta = columnsMetadata.find(col => col.name === column);
                    
                    // 对于主键和非空字段，直接使用值
                    // 对于可空字段，如果值为 'NULL' 或空字符串，则设为 null
                    if (isPrimaryKey || columnMeta?.notNull) {
                        updateData[column] = value;
                    } else {
                        updateData[column] = (!value || value === 'NULL') ? null : value;
                    }
                });

                const errors = validateData(updateData);
                if (errors.length > 0) {
                    hasErrors = true;
                    allErrors.push('第 ' + (parseInt(rowIndex) + 1) + ' 行: ' + errors.join(', '));
                }
            });

            // 验证新增
            newRows.forEach(rowIndex => {
                const row = document.querySelector('tr[data-row-index="' + rowIndex + '"]');
                if (!row) return;

                const insertData = {};
                Array.from(row.cells).forEach(cell => {
                    if (!cell.classList.contains('editable')) return;
                    const column = cell.dataset.column;
                    const value = cell.textContent.trim();
                    const isPrimaryKey = cell.dataset.isPk === 'true';
                    const columnMeta = columnsMetadata.find(col => col.name === column);
                    
                    // 对于主键和非空字段，直接使用值
                    // 对于可空字段，如果值为 'NULL' 或空字符串，则设为 null
                    if (isPrimaryKey || columnMeta?.notNull) {
                        insertData[column] = value;
                    } else {
                        insertData[column] = (!value || value === 'NULL') ? null : value;
                    }
                });

                const errors = validateData(insertData);
                if (errors.length > 0) {
                    hasErrors = true;
                    allErrors.push('新增行 ' + (parseInt(rowIndex) + 1) + ': ' + errors.join(', '));
                }
            });

            if (hasErrors) {
                document.getElementById('status').textContent = '验证错误: ' + allErrors.join('; ');
                setTimeout(() => {
                    document.getElementById('status').textContent = '';
                }, 5000);
                return;
            }

            const saveButton = document.querySelector('button[onclick="saveChanges()"]');
            saveButton.disabled = true;
            saveButton.textContent = '保存中...';
            document.getElementById('status').textContent = '正在保存...';

            const changes = {
                updates: [],
                deletes: [],
                inserts: []
            };

            // 处理更新
            modifiedData.forEach((columns, rowIndex) => {
                if (newRows.has(parseInt(rowIndex))) return;
                const row = document.querySelector('tr[data-row-index="' + rowIndex + '"]');
                if (!row || deletedRows.has(parseInt(rowIndex))) return;

                const updateData = {};
                columns.forEach((value, column) => {
                    const cell = row.querySelector('td[data-column="' + column + '"]');
                    const isPrimaryKey = cell && cell.dataset.isPk === 'true';
                    const columnMeta = columnsMetadata.find(col => col.name === column);
                    
                    // 对于主键和非空字段，直接使用值
                    // 对于可空字段，如果值为 'NULL' 或空字符串，则设为 null
                    if (isPrimaryKey || columnMeta?.notNull) {
                        updateData[column] = value;
                    } else {
                        updateData[column] = (!value || value === 'NULL') ? null : value;
                    }
                });

                changes.updates.push({
                    primaryKeyData: getRowIdentifier(row),
                    updateData
                });
            });

            // 处理删除
            deletedRows.forEach(rowIndex => {
                const row = document.querySelector('tr[data-row-index="' + rowIndex + '"]');
                if (!row) return;

                changes.deletes.push({
                    primaryKeyData: getRowIdentifier(row)
                });
            });

            // 处理插入
            newRows.forEach(rowIndex => {
                const row = document.querySelector('tr[data-row-index="' + rowIndex + '"]');
                if (!row) return;

                const insertData = {};
                Array.from(row.cells).forEach(cell => {
                    if (!cell.classList.contains('editable')) return;
                    const column = cell.dataset.column;
                    const value = cell.textContent.trim();
                    const isPrimaryKey = cell.dataset.isPk === 'true';
                    const columnMeta = columnsMetadata.find(col => col.name === column);
                    
                    // 对于主键和非空字段，直接使用值
                    // 对于可空字段，如果值为 'NULL' 或空字符串，则设为 null
                    if (isPrimaryKey || columnMeta?.notNull) {
                        insertData[column] = value;
                    } else {
                        insertData[column] = (!value || value === 'NULL') ? null : value;
                    }
                });

                changes.inserts.push({ insertData });
            });

            vscode.postMessage({
                command: 'saveChanges',
                changes: changes
            });
        }

        function handleDblClick(event) {
            const cell = event.target;
            if (!cell.classList.contains('editing')) {
                const value = cell.dataset.originalValue;
                const input = document.createElement('input');
                input.value = value === 'NULL' ? '' : value;
                input.addEventListener('blur', function() {
                    finishEditing(this);
                });
                input.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        this.blur();
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        this.value = this.parentElement.dataset.originalValue;
                        this.blur();
                    }
                });
                cell.textContent = '';
                cell.classList.add('editing');
                cell.appendChild(input);
                input.focus();
                input.select();
            }
        }

        // 初始化可编辑单元格
        document.addEventListener('DOMContentLoaded', function() {
            bindEditableEvents();
            
            // 添加搜索功能
            const searchInput = document.getElementById('searchInput');
            searchInput.addEventListener('input', function() {
                const searchText = this.value.toLowerCase();
                const rows = document.querySelectorAll('tbody tr');
                
                rows.forEach(row => {
                    let found = false;
                    const cells = row.querySelectorAll('td');
                    
                    cells.forEach(cell => {
                        if (cell.textContent.toLowerCase().includes(searchText)) {
                            found = true;
                        }
                    });
                    
                    row.style.display = found ? '' : 'none';
                });
            });
            
            // 添加快捷键支持
            document.addEventListener('keydown', function(e) {
                // 检查是否按下 Ctrl+S 或 Command+S
                if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                    e.preventDefault();
                    saveChanges();
                }
                // 检查是否按下 Ctrl+F 或 Command+F
                if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                    e.preventDefault();
                    searchInput.focus();
                }
            });
        });

        function bindEditableEvents() {
            document.querySelectorAll('.editable').forEach(cell => {
                cell.removeEventListener('dblclick', handleDblClick);
                cell.addEventListener('dblclick', handleDblClick);
            });
        }

        function refreshData() {
            const refreshButton = document.querySelector('button[onclick="refreshData()"]');
            refreshButton.disabled = true;
            refreshButton.textContent = '刷新中...';
            document.getElementById('status').textContent = '正在刷新数据...';

            vscode.postMessage({
                command: 'refreshData'
            });
        }

        // 接收来自扩展的消息
        window.addEventListener('message', event => {
            const message = event.data;
            const saveButton = document.querySelector('button[onclick="saveChanges()"]');
            const refreshButton = document.querySelector('button[onclick="refreshData()"]');

            switch (message.command) {
                case 'saveSuccess':
                    document.querySelectorAll('.modified').forEach(cell => {
                        cell.classList.remove('modified');
                        cell.dataset.originalValue = cell.textContent;
                    });
                    modifiedData.clear();
                    deletedRows.clear();
                    newRows.clear();
                    document.getElementById('status').textContent = '保存成功';
                    saveButton.disabled = false;
                    saveButton.textContent = '保存更改';
                    setTimeout(() => {
                        document.getElementById('status').textContent = '';
                    }, 3000);
                    break;
                case 'updateData':
                    // 更新表格数据
                    const tbody = document.querySelector('tbody');
                    tbody.innerHTML = message.data.map((row, rowIndex) => 
                        '<tr data-row-index="' + rowIndex + '">' +
                            Object.entries(row).map(([key, value]) => 
                                '<td class="editable' + (primaryKeys.includes(key) ? ' primary-key' : '') + 
                                '" data-column="' + key + 
                                '" data-original-value="' + (value === null ? '' : value) + 
                                '" data-is-pk="' + (primaryKeys.includes(key) ? 'true' : 'false') + '">' +
                                    (value === null ? 'NULL' : value) +
                                '</td>'
                            ).join('') +
                            '<td>' +
                                '<div class="row-actions">' +
                                    '<button onclick="deleteRow(' + rowIndex + ')" class="delete" title="删除此行">删除</button>' +
                                '</div>' +
                            '</td>' +
                        '</tr>'
                    ).join('');
                    // 重新绑定事件监听器
                    bindEditableEvents();
                    refreshButton.disabled = false;
                    refreshButton.textContent = '刷新数据';
                    document.getElementById('status').textContent = '数据已刷新';
                    setTimeout(() => {
                        document.getElementById('status').textContent = '';
                    }, 3000);
                    break;
                case 'error':
                    document.getElementById('status').textContent = '错误: ' + message.error;
                    saveButton.disabled = false;
                    saveButton.textContent = '保存更改';
                    refreshButton.disabled = false;
                    refreshButton.textContent = '刷新数据';
                    setTimeout(() => {
                        document.getElementById('status').textContent = '';
                    }, 5000);
                    break;
            }
        });
    </script>
</body>
</html>`;

                panel.webview.html = htmlContent;

                // 处理来自 WebView 的消息
                panel.webview.onDidReceiveMessage(async message => {
                    try {
                        switch (message.command) {
                            case 'saveChanges':
                                try {
                                    // 处理删除
                                    for (const deleteOp of message.changes.deletes) {
                                        const whereConditions = Object.entries(deleteOp.primaryKeyData)
                                            .map(([column, value]) => {
                                                if (value === null || value === 'NULL' || value === '') {
                                                    return column + ' IS NULL';
                                                }
                                                return column + ' = ' + (typeof value === 'string' ? "'" + value + "'" : value);
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
                                    for (const updateOp of message.changes.updates) {
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
                                    for (const insertOp of message.changes.inserts) {
                                        const columns = Object.keys(insertOp.insertData).filter(col => col !== 'id');
                                        const values = Object.entries(insertOp.insertData)
                                            .filter(([col]) => col !== 'id')
                                            .map(([column, value]) => {
                                                // 主键不允许为 NULL
                                                if (primaryKeys.includes(column)) {
                                                    return typeof value === 'string' ? "'" + value + "'" : value;
                                                } else if (value === null) {
                                                    return 'NULL';
                                                } else {
                                                    return typeof value === 'string' ? "'" + value + "'" : value;
                                                }
                                            });

                                    const insertQuery = columns.length > 0 ?
                                        'INSERT INTO ' + tableName + ' (' + columns.join(', ') + ') VALUES (' + values.join(', ') + ')' :
                                        'INSERT INTO ' + tableName + ' DEFAULT VALUES';

                                    console.log('执行插入查询:', insertQuery);
                                    await databaseManager.executeQuery(connectionId, insertQuery);
                                }

                                panel.webview.postMessage({ command: 'saveSuccess' });
                                vscode.window.showInformationMessage('数据更新成功');

                                // 刷新数据
                                const result = await databaseManager.executeQuery(connectionId, 'SELECT * FROM ' + tableName + ' LIMIT 1000');
                                panel.webview.postMessage({
                                    command: 'updateData',
                                    data: result
                                });
                            } catch (error: any) {
                                panel.webview.postMessage({
                                    command: 'error',
                                    error: error.message
                                });
                                vscode.window.showErrorMessage('更新失败: ' + error.message);
                            }
                            break;

                        case 'refreshData':
                            try {
                                const result = await databaseManager.executeQuery(connectionId, 'SELECT * FROM ' + tableName + ' LIMIT 1000');
                                panel.webview.postMessage({
                                    command: 'updateData',
                                    data: result
                                });
                            } catch (error: any) {
                                panel.webview.postMessage({
                                    command: 'error',
                                    error: error.message
                                });
                                vscode.window.showErrorMessage('刷新数据失败: ' + error.message);
                            }
                            break;
                        }
                    } catch (error: any) {
                        vscode.window.showErrorMessage('处理消息失败: ' + error.message);
                    }
                });
            } catch (error) {
                vscode.window.showErrorMessage(`加载表数据失败: ${(error as Error).message}`);
            }
        }));
}

export function deactivate() { }
