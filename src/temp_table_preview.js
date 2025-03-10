/**
 * 表格预览功能的JavaScript部分
 * 使用事件委托模式实现交互功能
 */

// 全局变量
let vscode;
let modifiedData = {};
let deletedRows = [];
let newRows = [];
let currentRowIndex = null;
let primaryKeys = [];
let columnsMetadata = [];

// 初始化函数
function initTablePreview() {
    console.log("initTablePreview 被调用");
    
    try {
        // 获取 vscode API
        vscode = acquireVsCodeApi();
        console.log("vscode API 已获取");
        
        // 设置事件委托
        setupEventDelegation();
        
        // 绑定按钮事件
        bindButtonEvents();
        
        console.log("初始化完成，primaryKeys:", primaryKeys);
        console.log("columnsMetadata:", columnsMetadata);
        console.log("currentRowIndex:", currentRowIndex);
    } catch (error) {
        console.error("初始化表格预览时出错:", error);
    }
}
    
    // 状态管理函数
    function showStatus(message, duration = 3000) {
        const statusEl = document.getElementById('status');
        if (statusEl) {
            statusEl.textContent = message;
            if (duration > 0) {
                setTimeout(() => {
                    statusEl.textContent = '';
                }, duration);
            }
        }
    }
    
    // 行标识符获取函数
    function getRowIdentifier(row) {
        const identifier = {};
        if (primaryKeys.length > 0) {
            // 如果有主键，使用主键值
            primaryKeys.forEach(key => {
                const cell = row.querySelector(`td[data-column="${key}"]`);
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
            if (!cell.classList.contains('editable')) { return; }
                const column = cell.dataset.column;
            if (!column) { return; }
                const value = cell.textContent.trim();
                // 只有当值真的是 'NULL' 时才设为 null
                identifier[column] = value === 'NULL' ? null : value;
            });
        }
        return identifier;
    }
    
    // 数据验证函数
    function validateData(data) {
        const errors = [];
        
        columnsMetadata.forEach(col => {
            const value = data[col.name];
            // 主键或非空字段必须有值（去除空格后）
            if ((col.isPrimaryKey || col.notNull) && 
                (value === undefined || value === null || value === '' || value === 'NULL')) {
                errors.push(col.name + ' 不能为空');
            }
        });
    
        return errors;
    }
    
    // 删除行函数
    function deleteRow(rowIndex) {
        console.log('删除行函数被调用，行索引:', rowIndex);
        // 确保rowIndex是数字
        rowIndex = parseInt(rowIndex, 10);
        if (isNaN(rowIndex)) {
            console.error('无效的行索引:', rowIndex);
            showStatus('删除失败：无效的行索引');
            return;
        }
        
        // 使用更精确的选择器查找行
        const row = document.querySelector(`tr[data-row-index="${rowIndex}"]`);
        if (!row) {
            console.error('未找到要删除的行:', rowIndex);
            showStatus('删除失败：未找到指定行');
            return;
        }
        
        // 增强确认删除提示
        if (!confirm('警告：此操作将从数据库中永久删除此行数据，且无法恢复！\n\n确定要删除这行数据吗？')) {
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
        
        const newRowId = `new-${Date.now()}`;
        const tr = document.createElement('tr');
        tr.dataset.id = newRowId;
        tr.classList.add('new-row');
        
        const columns = table.querySelectorAll('thead th');
        columns.forEach(column => {
            const td = document.createElement('td');
            td.dataset.column = column.textContent;
            td.textContent = '';
            td.addEventListener('click', function() {
                startEditing(this);
            });
            tr.appendChild(td);
        });
        
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
    
    // 完成编辑函数
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
        const isNotNull = columnsMetadata.some(col => col.name === column && col.isNotNull);
        
        if ((isPrimary || isNotNull) && (!newValue || newValue === 'NULL' || newValue.trim() === '')) {
            showError(`${column} 不能为空`);
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
                showError(`行 ${rowId} 验证错误: ${errors.join(', ')}`);
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
                const column = cell.dataset.column;
                modifiedData[rowId][column] = cell.textContent;
            });
            
            const errors = validateData(modifiedData[rowId]);
            if (errors.length > 0) {
                hasErrors = true;
                showError(`新行验证错误: ${errors.join(', ')}`);
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
        showError(`保存时出错: ${error.message}`);
    }
}

// 刷新数据
    function refreshData() {
    console.log("刷新数据按钮被点击");
    try {
        vscode.postMessage({
            command: 'refreshData'
        });
        document.getElementById('status').textContent = '正在刷新...';
        console.log("已发送刷新请求");
    } catch (error) {
        console.error("刷新数据时出错:", error);
        showError(`刷新时出错: ${error.message}`);
    }
    }
    
    // 单元格双击事件处理函数
    function handleDblClick(event) {
        const cell = event.target;
        if (!cell.classList.contains('editing') && cell.classList.contains('editable')) {
            const value = cell.dataset.originalValue || '';
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
                    this.value = this.parentElement.dataset.originalValue || '';
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
    
    // 使用事件委托绑定事件
    function setupEventDelegation() {
    console.log("设置事件委托");
    try {
        // 表格单元格点击事件
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
    } catch (error) {
        console.error("设置事件委托时出错:", error);
    }
}

// 绑定按钮事件
function bindButtonEvents() {
    console.log("绑定按钮事件");
    try {
        // 这些事件绑定是备用的，以防 onclick 属性不起作用
        const addNewRowBtn = document.getElementById('addNewRowBtn');
        if (addNewRowBtn) {
            addNewRowBtn.addEventListener('click', function() {
                console.log("添加新行按钮被点击（通过事件监听器）");
                addNewRow();
            });
            console.log("添加新行按钮事件已绑定");
        } else {
            console.error("未找到添加新行按钮");
        }
        
        const saveChangesBtn = document.getElementById('saveChangesBtn');
        if (saveChangesBtn) {
            saveChangesBtn.addEventListener('click', function() {
                console.log("保存更改按钮被点击（通过事件监听器）");
                saveChanges();
            });
            console.log("保存更改按钮事件已绑定");
        } else {
            console.error("未找到保存更改按钮");
        }
        
        const refreshDataBtn = document.getElementById('refreshDataBtn');
        if (refreshDataBtn) {
            refreshDataBtn.addEventListener('click', function() {
                console.log("刷新数据按钮被点击（通过事件监听器）");
                refreshData();
            });
            console.log("刷新数据按钮事件已绑定");
        } else {
            console.error("未找到刷新数据按钮");
        }
    } catch (error) {
        console.error("绑定按钮事件时出错:", error);
    }
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

// 当 DOM 内容加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    console.log("DOMContentLoaded 事件触发");
    initTablePreview();
});

// 如果 DOM 已经加载完成，立即初始化
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    console.log("DOM 已加载，立即初始化");
    setTimeout(initTablePreview, 0);
}