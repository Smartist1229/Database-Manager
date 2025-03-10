import * as vscode from 'vscode';
import { DatabaseManager, DatabaseConfig } from '../database/DatabaseManager';
import * as fs from 'fs';
import * as path from 'path';

// 添加SQLite文件验证函数
async function isSQLiteFile(filePath: string): Promise<boolean> {
    try {
        // 读取文件的前16个字节
        const fd = await fs.promises.open(filePath, 'r');
        const buffer = Buffer.alloc(16);
        await fd.read(buffer, 0, 16, 0);
        await fd.close();

        // SQLite文件的魔数是 "SQLite format 3\0"
        const header = buffer.toString('utf8', 0, 16);
        return header === 'SQLite format 3\0';
    } catch (error) {
        console.error('验证SQLite文件失败:', error);
        return false;
    }
}

// 定义树节点类型
type TreeNode = ConnectionNode | DatabaseNode | TableNode | ColumnNode;

// 数据库节点
class DatabaseNode extends vscode.TreeItem {
    constructor(
        public readonly connectionId: string,
        public readonly databaseName: string
    ) {
        super(databaseName, vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = 'database';
        this.iconPath = new vscode.ThemeIcon('database');
        this.tooltip = `数据库: ${databaseName}`;
    }
}

// 表节点
class TableNode extends vscode.TreeItem {
    constructor(
        public readonly connectionId: string,
        public readonly tableName: string,
        public readonly databaseName?: string
    ) {
        super(tableName, vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = 'table';
        this.iconPath = new vscode.ThemeIcon('table');
        this.tooltip = `表: ${tableName}`;
        this.command = {
            command: 'database-manager.previewTable',
            title: '预览表数据',
            arguments: [{
                table: {
                    connectionId: connectionId,
                    name: tableName,
                    database: databaseName
                }
            }]
        };
    }
}

// 列节点
class ColumnNode extends vscode.TreeItem {
    constructor(
        public readonly connectionId: string,
        public readonly tableName: string,
        public readonly columnName: string,
        public readonly dataType: string,
        public readonly databaseName?: string
    ) {
        super(columnName, vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'column';
        this.iconPath = new vscode.ThemeIcon('symbol-field');
        this.tooltip = `列: ${columnName}\n类型: ${dataType}`;
        this.description = dataType;
    }
}

export class DatabaseExplorerProvider implements vscode.TreeDataProvider<TreeNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeNode | undefined | null | void> = new vscode.EventEmitter<TreeNode | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TreeNode | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private databaseManager: DatabaseManager) {
        console.log('DatabaseExplorerProvider 构造函数被调用');
    }

    refresh(): void {
        console.log('DatabaseExplorerProvider refresh 被调用');
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TreeNode): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: TreeNode): Promise<TreeNode[]> {
        try {
            if (!element) {
                // 根节点，显示所有连接
                console.log('获取所有连接...');
                const connections = this.databaseManager.getConnections();
                console.log('当前连接数量:', connections.length);
                
                // 获取所有配置
                const allConfigs = this.databaseManager.getAllConfigs();
                console.log('配置数量:', allConfigs.size);
                
                if (allConfigs.size === 0) {
                    return [new ConnectionNode('点击"连接数据库"按钮添加新连接', vscode.TreeItemCollapsibleState.None)];
                }
                
                // 使用配置创建连接节点
                return Array.from(allConfigs.keys()).map(id => 
                    new ConnectionNode(id, vscode.TreeItemCollapsibleState.Collapsed)
                );
            } else if (element instanceof ConnectionNode && element.contextValue === 'connection') {
                // 连接节点，尝试连接并显示所有表或数据库
                try {
                    await this.databaseManager.ensureConnected(element.connectionId);
                    const config = this.databaseManager.getConnectionConfig(element.connectionId);
                    
                    if (config && config.type === 'mongodb') {
                        // MongoDB 连接显示所有数据库
                        const databases = await this.databaseManager.getDatabases(element.connectionId);
                        return databases.map(db => new DatabaseNode(element.connectionId, db));
                    } else {
                        // 其他数据库类型直接显示表
                        const tables = await this.databaseManager.getTables(element.connectionId);
                        return tables.map(table => new TableNode(element.connectionId, table));
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(`连接失败: ${(error as Error).message}`);
                    return [];
                }
            } else if (element instanceof DatabaseNode) {
                // 数据库节点，显示该数据库中的所有表
                try {
                    const tables = await this.databaseManager.getTablesInDatabase(element.connectionId, element.databaseName);
                    return tables.map(table => new TableNode(element.connectionId, table, element.databaseName));
                } catch (error) {
                    vscode.window.showErrorMessage(`获取表失败: ${(error as Error).message}`);
                    return [];
                }
            } else if (element instanceof TableNode) {
                // 表节点，显示所有列
                try {
                    const columns = await this.databaseManager.getColumns(
                        element.connectionId, 
                        element.tableName, 
                        element.databaseName
                    );
                    return columns.map(col => 
                        new ColumnNode(
                            element.connectionId, 
                            element.tableName, 
                            col.name, 
                            col.type, 
                            element.databaseName
                        )
                    );
            } catch (error) {
                    vscode.window.showErrorMessage(`获取列失败: ${(error as Error).message}`);
                    return [];
            }
            }
            return [];
        } catch (error) {
            console.error('获取树节点失败:', error);
            return [new ConnectionNode('加载失败: ' + (error as Error).message, vscode.TreeItemCollapsibleState.None)];
        }
    }
}

class ConnectionNode extends vscode.TreeItem {
    constructor(
        public readonly connectionId: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(connectionId, collapsibleState);
        
        if (connectionId === '点击"连接数据库"按钮添加新连接') {
            this.contextValue = 'empty';
            this.iconPath = new vscode.ThemeIcon('plug');
            this.tooltip = '点击标题栏的"连接数据库"按钮添加新的数据库连接';
        } else {
            const config = DatabaseManager.getInstance().getConnectionConfig(connectionId);
            if (config) {
        this.contextValue = 'connection';
                // 根据连接状态设置不同的图标
                const isConnected = DatabaseManager.getInstance().isConnected(connectionId);
                switch (config.type) {
                    case 'mysql':
                        this.iconPath = new vscode.ThemeIcon('database', new vscode.ThemeColor(isConnected ? 'charts.blue' : 'disabledForeground'));
                        break;
                    case 'sqlite':
                        this.iconPath = new vscode.ThemeIcon('database', new vscode.ThemeColor(isConnected ? 'charts.green' : 'disabledForeground'));
                        break;
                    case 'mongodb':
                        this.iconPath = new vscode.ThemeIcon('database', new vscode.ThemeColor(isConnected ? 'charts.purple' : 'disabledForeground'));
                        break;
                    case 'oracle':
                        this.iconPath = new vscode.ThemeIcon('database', new vscode.ThemeColor(isConnected ? 'charts.red' : 'disabledForeground'));
                        break;
                }
                
                // 构建连接地址
                let connectionPath = '';
                if (config.type === 'sqlite') {
                    connectionPath = `${config.filename}`;
                } else if (config.type === 'mongodb') {
                    connectionPath = `${config.host || 'localhost'}:${config.port || '27017'}`;
                } else if (config.type === 'oracle') {
                    connectionPath = config.connectionString || `${config.host || 'localhost'}:${config.port || '1521'}`;
                } else {
                    connectionPath = `${config.host || 'localhost'}:${config.port || '3306'}/${config.database || ''}`;
                }
                
                this.tooltip = `数据库连接: ${config.alias}\n类型: ${config.type}\n连接地址: ${connectionPath}`;
                this.label = config.alias;
                this.description = `${config.type}`;
            }
        }
    }
}

export async function connectToDatabase() {
    const dbType = await vscode.window.showQuickPick(
        ['mysql', 'sqlite', 'mongodb', 'oracle'],
        { placeHolder: '选择数据库类型' }
    );

    if (!dbType) {
        return;
    }

    // 先获取别名
    const alias = await vscode.window.showInputBox({
        prompt: '请输入数据库连接的别名',
        placeHolder: '例如: 本地开发数据库'
    });

    if (!alias) {
        return;
    }

    let config: DatabaseConfig;

    if (dbType === 'sqlite') {
        const filePath = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            filters: { '所有文件': ['*'] }
        });

        if (!filePath || filePath.length === 0) {
            return;
        }

        const isValidSQLite = await isSQLiteFile(filePath[0].fsPath);
        if (!isValidSQLite) {
            vscode.window.showErrorMessage('所选文件不是有效的SQLite数据库文件');
            return;
        }

        config = {
            type: 'sqlite',
            alias,
            filename: filePath[0].fsPath
        };
    } else if (dbType === 'mongodb') {
        const host = await vscode.window.showInputBox({ prompt: '输入主机地址', value: 'localhost' });
        const port = await vscode.window.showInputBox({ prompt: '输入端口号', value: '27017' });
        const username = await vscode.window.showInputBox({ prompt: '输入用户名（可选）' });
        const password = await vscode.window.showInputBox({ prompt: '输入密码（可选）', password: true });
        
        // 对于 MongoDB，数据库名称是可选的
        const specifyDatabase = await vscode.window.showQuickPick(
            ['是', '否'],
            { placeHolder: '是否指定默认数据库？（可选，连接后可以浏览所有数据库）' }
        );
        
        let database: string | undefined;
        if (specifyDatabase === '是') {
            database = await vscode.window.showInputBox({ prompt: '输入数据库名（可选）' });
        }

        if (!host || !port) {
            return;
        }

        config = {
            type: 'mongodb',
            alias,
            host,
            port: parseInt(port),
            username: username || undefined,
            password: password || undefined,
            database: database || undefined
        };
    } else if (dbType === 'oracle') {
        const useConnectionString = await vscode.window.showQuickPick(
            ['是', '否'],
            { placeHolder: '是否使用连接字符串？' }
        );

        if (!useConnectionString) {
            return;
        }

        if (useConnectionString === '是') {
            const connectionString = await vscode.window.showInputBox({ 
                prompt: '输入连接字符串',
                placeHolder: '例如: (DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=localhost)(PORT=1521))(CONNECT_DATA=(SID=ORCL)))'
            });
            const username = await vscode.window.showInputBox({ prompt: '输入用户名' });
            const password = await vscode.window.showInputBox({ prompt: '输入密码', password: true });

            if (!connectionString || !username || !password) {
                return;
            }

            config = {
                type: 'oracle',
                alias,
                connectionString,
                username,
                password
            };
        } else {
            const host = await vscode.window.showInputBox({ prompt: '输入主机地址', value: 'localhost' });
            const port = await vscode.window.showInputBox({ prompt: '输入端口号', value: '1521' });
            const username = await vscode.window.showInputBox({ prompt: '输入用户名' });
            const password = await vscode.window.showInputBox({ prompt: '输入密码', password: true });
            
            const connectType = await vscode.window.showQuickPick(
                ['SID', 'Service Name'],
                { placeHolder: '选择连接类型' }
            );
            
            if (!connectType) {
                return;
            }
            
            let sid: string | undefined;
            let serviceName: string | undefined;
            
            if (connectType === 'SID') {
                sid = await vscode.window.showInputBox({ prompt: '输入SID', value: 'ORCL' });
                if (!sid) {
                    return;
                }
            } else {
                serviceName = await vscode.window.showInputBox({ prompt: '输入Service Name' });
                if (!serviceName) {
                    return;
                }
            }

            if (!host || !port || !username || !password) {
                return;
            }

            config = {
                type: 'oracle',
                alias,
                host,
                port: parseInt(port),
                username,
                password,
                sid,
                serviceName
            };
        }
    } else {
        // MySQL
        const host = await vscode.window.showInputBox({ prompt: '输入主机地址', value: 'localhost' });
        const port = await vscode.window.showInputBox({ prompt: '输入端口号', value: '3306' });
        const username = await vscode.window.showInputBox({ prompt: '输入用户名' });
        const password = await vscode.window.showInputBox({ prompt: '输入密码', password: true });
        const database = await vscode.window.showInputBox({ prompt: '输入数据库名' });

        if (!host || !port || !username || !password || !database) {
            return;
        }

        config = {
            type: 'mysql',
            alias,
            host,
            port: parseInt(port),
            username,
            password,
            database
        };
    }

    try {
        // 先测试连接
        await DatabaseManager.getInstance().testConnection(config);
        // 添加配置但不立即连接
        const connectionId = DatabaseManager.getInstance().addConfig(config);
        vscode.window.showInformationMessage(`数据库配置已添加: ${config.alias}`);
    } catch (error) {
        vscode.window.showErrorMessage(`数据库连接测试失败: ${(error as Error).message}`);
    }
}