import * as vscode from 'vscode';
import * as mysql from 'mysql2/promise';
import * as pg from 'pg';
import * as sqlite3 from 'sqlite3';
import * as mssql from 'mssql';
import { ConfigManager } from './ConfigManager';

export interface DatabaseConfig {
    type: 'mysql' | 'postgresql' | 'sqlite' | 'mssql';
    alias: string; // 数据库别名
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    database?: string;
    filename?: string; // 用于SQLite
}

// SQLite表结构接口
interface SQLiteTableInfo {
    name: string;
    type: string;
}

export class DatabaseManager {
    private static instance: DatabaseManager;
    private connections: Map<string, mysql.Connection | pg.Client | sqlite3.Database | mssql.ConnectionPool> = new Map();
    private configManager!: ConfigManager;
    private connectionStatus: Map<string, boolean> = new Map();

    private constructor() {
        // 构造函数中不初始化 configManager
    }

    public static getInstance(): DatabaseManager {
        if (!DatabaseManager.instance) {
            DatabaseManager.instance = new DatabaseManager();
        }
        return DatabaseManager.instance;
    }

    public initialize(context: vscode.ExtensionContext) {
        this.configManager = ConfigManager.getInstance(context);
    }

    public getConnections(): string[] {
        return Array.from(this.connections.keys());
    }

    public isConnected(connectionId: string): boolean {
        return this.connectionStatus.get(connectionId) === true;
    }

    public async connect(configOrId: DatabaseConfig | string): Promise<boolean> {
        try {
            let connection;
            let config: DatabaseConfig;
            let connectionId: string;
            
            // 判断参数类型
            if (typeof configOrId === 'string') {
                // 如果是字符串，则视为连接ID
                connectionId = configOrId;
                const configObj = this.configManager.getConfig(connectionId);
                if (!configObj) {
                    throw new Error('未找到数据库配置');
                }
                config = configObj;
            } else {
                // 如果是配置对象，则生成连接ID
                config = configOrId;
                connectionId = this.generateConnectionId(config);
            }

            switch (config.type) {
                case 'mysql':
                    if (!config.host || !config.username || !config.password || !config.database || !config.port) {
                        throw new Error('MySQL连接配置不完整');
                    }
                    connection = await mysql.createConnection({
                        host: config.host,
                        port: config.port,
                        user: config.username,
                        password: config.password,
                        database: config.database
                    });
                    break;

                case 'postgresql':
                    if (!config.host || !config.username || !config.password || !config.database || !config.port) {
                        throw new Error('PostgreSQL连接配置不完整');
                    }
                    connection = new pg.Client({
                        host: config.host,
                        port: config.port,
                        user: config.username,
                        password: config.password,
                        database: config.database
                    });
                    await connection.connect();
                    break;

                case 'sqlite':
                    if (!config.filename) {
                        throw new Error('SQLite连接配置不完整');
                    }
                    connection = new sqlite3.Database(config.filename);
                    break;

                case 'mssql':
                    if (!config.host || !config.username || !config.password || !config.database || !config.port) {
                        throw new Error('MSSQL连接配置不完整');
                    }
                    connection = await mssql.connect({
                        server: config.host,
                        port: config.port,
                        user: config.username,
                        password: config.password,
                        database: config.database,
                        options: {
                            trustServerCertificate: true
                        }
                    });
                    break;

                default:
                    throw new Error(`不支持的数据库类型: ${config.type}`);
            }

            this.connections.set(connectionId, connection);
            this.connectionStatus.set(connectionId, true);  // 设置连接状态为已连接
            return true;
        } catch (error) {
            console.error('连接失败:', error);
            throw error;
        }
    }

    public async disconnect(connectionId: string): Promise<void> {
        const connection = this.connections.get(connectionId);
        if (!connection) {
            return;
        }

        try {
            if ('end' in connection && typeof connection.end === 'function') {
                await connection.end();
            } else if (connection instanceof pg.Client) {
                await connection.end();
            } else if (connection instanceof sqlite3.Database) {
                await new Promise<void>((resolve, reject) => {
                    connection.close((err) => {
                        if (err) {
                            reject(err);
                        }
                        resolve();
                    });
                });
            } else if (connection instanceof mssql.ConnectionPool) {
                await connection.close();
            }
            this.connections.delete(connectionId);
            this.connectionStatus.set(connectionId, false);
        } catch (error: unknown) {
            vscode.window.showErrorMessage(`断开连接失败: ${(error as Error).message}`);
        }
    }

    public getConnectionConfig(connectionId: string): DatabaseConfig | undefined {
        return this.configManager.getConfig(connectionId);
    }

    public getAllConfigs(): Map<string, DatabaseConfig> {
        return this.configManager.getAllConfigs();
    }

    public addConfig(config: DatabaseConfig): string {
        return this.configManager.addConfig(config);
    }

    public removeConfig(connectionId: string): boolean {
        this.disconnect(connectionId);
        return this.configManager.removeConfig(connectionId);
    }

    public updateConfig(connectionId: string, config: DatabaseConfig): boolean {
        this.disconnect(connectionId);
        return this.configManager.updateConfig(connectionId, config);
    }

    public async getTables(connectionId: string): Promise<string[]> {
        const connection = this.connections.get(connectionId);
        const config = this.configManager.getConfig(connectionId);
        if (!connection || !config) {
            throw new Error('未找到数据库连接');
        }

        try {
            let tables: string[] = [];
            switch (config.type) {
                case 'mysql':
                    const [mysqlRows] = await (connection as mysql.Connection).execute('SHOW TABLES');
                    tables = (mysqlRows as any[]).map(row => Object.values(row)[0] as string);
                    break;
                case 'postgresql':
                    const pgResult = await (connection as pg.Client).query(
                        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
                    );
                    tables = pgResult.rows.map(row => row.table_name);
                    break;
                case 'sqlite':
                    tables = await new Promise((resolve, reject) => {
                        (connection as sqlite3.Database).all(
                            "SELECT name FROM sqlite_master WHERE type='table'",
                            [],
                            (err, rows: SQLiteTableInfo[]) => {
                                if (err) {
                                    reject(err);
                                }
                                resolve(rows.map(row => row.name));
                            }
                        );
                    });
                    break;
                case 'mssql':
                    const mssqlResult = await (connection as mssql.ConnectionPool)
                        .request()
                        .query("SELECT table_name FROM information_schema.tables WHERE table_type = 'BASE TABLE'");
                    tables = mssqlResult.recordset.map(row => row.table_name);
                    break;
            }
            return tables;
        } catch (error) {
            console.error('获取表列表失败:', error);
            throw error;
        }
    }

    public async getColumns(connectionId: string, tableName: string): Promise<Array<{name: string, type: string}>> {
        const connection = this.connections.get(connectionId);
        const config = this.configManager.getConfig(connectionId);
        if (!connection || !config) {
            throw new Error('未找到数据库连接');
        }

        try {
            let columns: Array<{name: string, type: string}> = [];
            switch (config.type) {
                case 'mysql':
                    const [mysqlRows] = await (connection as mysql.Connection).execute(
                        'SHOW COLUMNS FROM ??',
                        [tableName]
                    );
                    columns = (mysqlRows as any[]).map(row => ({
                        name: row.Field,
                        type: row.Type
                    }));
                    break;
                case 'postgresql':
                    const pgResult = await (connection as pg.Client).query(
                        `SELECT column_name, data_type 
                         FROM information_schema.columns 
                         WHERE table_name = $1`,
                        [tableName]
                    );
                    columns = pgResult.rows.map(row => ({
                        name: row.column_name,
                        type: row.data_type
                    }));
                    break;
                case 'sqlite':
                    columns = await new Promise((resolve, reject) => {
                        (connection as sqlite3.Database).all(
                            `PRAGMA table_info(${tableName})`,
                            [],
                            (err, rows: SQLiteTableInfo[]) => {
                                if (err) {
                                    reject(err);
                                }
                                resolve(rows.map(row => ({
                                    name: row.name,
                                    type: row.type
                                })));
                            }
                        );
                    });
                    break;
                case 'mssql':
                    const mssqlResult = await (connection as mssql.ConnectionPool)
                        .request()
                        .input('tableName', mssql.VarChar, tableName)
                        .query(`
                            SELECT column_name, data_type
                            FROM information_schema.columns
                            WHERE table_name = @tableName
                        `);
                    columns = mssqlResult.recordset.map(row => ({
                        name: row.column_name,
                        type: row.data_type
                    }));
                    break;
            }
            return columns;
        } catch (error) {
            console.error('获取列信息失败:', error);
            throw error;
        }
    }

    public async executeQuery(connectionId: string, query: string): Promise<any> {
        const connection = this.connections.get(connectionId);
        if (!connection) {
            throw new Error('未找到数据库连接');
        }

        try {
            let result;
            if ('execute' in connection) {
                [result] = await connection.execute(query);
            } else if (connection instanceof pg.Client) {
                result = await connection.query(query);
                result = result.rows;
            } else if (connection instanceof sqlite3.Database) {
                result = await new Promise((resolve, reject) => {
                    connection.all(query, [], (err, rows) => {
                        if (err) {
                            reject(err);
                        }
                        resolve(rows);
                    });
                });
            } else if (connection instanceof mssql.ConnectionPool) {
                result = await connection.request().query(query);
                result = result.recordset;
            }
            return result;
        } catch (error) {
            vscode.window.showErrorMessage(`查询执行失败: ${(error as Error).message}`);
            throw error;
        }
    }

    private generateConnectionId(config: DatabaseConfig): string {
        const timestamp = Date.now();
        return `${config.type}-${config.host || config.filename || ''}-${config.database || ''}-${timestamp}`;
    }

    public getActiveConnections(): string[] {
        // 返回已连接的数据库列表
        return Array.from(this.connections.keys());
    }

    public async testConnection(config: DatabaseConfig): Promise<boolean> {
        try {
            let connection: mysql.Connection | pg.Client | sqlite3.Database | mssql.ConnectionPool;
            switch (config.type) {
                case 'mysql':
                    if (!config.host || !config.username || !config.password || !config.database || !config.port) {
                        throw new Error('MySQL连接配置不完整');
                    }
                    connection = await mysql.createConnection({
                        host: config.host,
                        port: config.port,
                        user: config.username,
                        password: config.password,
                        database: config.database
                    });
                    await connection.end();
                    break;

                case 'postgresql':
                    if (!config.host || !config.username || !config.password || !config.database || !config.port) {
                        throw new Error('PostgreSQL连接配置不完整');
                    }
                    connection = new pg.Client({
                        host: config.host,
                        port: config.port,
                        user: config.username,
                        password: config.password,
                        database: config.database
                    });
                    await connection.connect();
                    await connection.end();
                    break;

                case 'sqlite':
                    if (!config.filename) {
                        throw new Error('SQLite连接配置不完整');
                    }
                    connection = new sqlite3.Database(config.filename);
                    await new Promise<void>((resolve, reject) => {
                        (connection as sqlite3.Database).close((err: Error | null) => {
                            if (err) {
                                reject(err);
                            }
                            resolve();
                        });
                    });
                    break;

                case 'mssql':
                    if (!config.host || !config.username || !config.password || !config.database || !config.port) {
                        throw new Error('MSSQL连接配置不完整');
                    }
                    const pool = await mssql.connect({
                        server: config.host,
                        port: config.port,
                        user: config.username,
                        password: config.password,
                        database: config.database,
                        options: {
                            trustServerCertificate: true,
                            encrypt: false,
                            enableArithAbort: true
                        }
                    });
                    await pool.close();
                    break;
            }
            return true;
        } catch (error) {
            console.error('测试连接失败:', error);
            throw error;
        }
    }

    public async ensureConnected(connectionId: string): Promise<boolean> {
        if (this.connectionStatus.get(connectionId)) {
            return true;
        }

        try {
            // 直接使用连接ID进行连接
            await this.connect(connectionId);
            return true;
        } catch (error) {
            console.error('连接失败:', error);
            throw error;
        }
    }
}