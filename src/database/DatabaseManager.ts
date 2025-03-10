import * as vscode from 'vscode';
import * as mysql from 'mysql2/promise';
import * as sqlite3 from 'sqlite3';
import { MongoClient } from 'mongodb';
import * as oracledb from 'oracledb';
import { ConfigManager } from './ConfigManager';

// 声明 Oracle 连接类型
type OracleConnection = any; // 简化处理

export interface DatabaseConfig {
    type: 'mysql' | 'sqlite' | 'mongodb' | 'oracle';
    alias: string; // 数据库别名
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    database?: string;
    filename?: string; // 用于SQLite
    connectionString?: string; // 用于Oracle
    sid?: string; // 用于Oracle
    serviceName?: string; // 用于Oracle
}

// SQLite表结构接口
interface SQLiteTableInfo {
    name: string;
    type: string;
}

export class DatabaseManager {
    private static instance: DatabaseManager;
    private connections: Map<string, mysql.Connection | sqlite3.Database | MongoClient | OracleConnection> = new Map();
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

                case 'sqlite':
                    if (!config.filename) {
                        throw new Error('SQLite连接配置不完整');
                    }
                    connection = new sqlite3.Database(config.filename);
                    break;

                case 'mongodb':
                    if (!config.host || !config.port) {
                        throw new Error('MongoDB连接配置不完整');
                    }
                    const mongoUrl = `mongodb://${config.username && config.password ? 
                        `${config.username}:${config.password}@` : ''}${config.host}:${config.port}/${config.database || ''}`;
                    const client = new MongoClient(mongoUrl);
                    await client.connect();
                    connection = client;
                    break;

                case 'oracle':
                    if ((!config.host || !config.port || !config.username || !config.password) && 
                        !config.connectionString) {
                        throw new Error('Oracle连接配置不完整');
                    }
                    
                    let connectionConfig: oracledb.ConnectionAttributes = {};
                    
                    if (config.connectionString) {
                        connectionConfig.connectString = config.connectionString;
                    } else {
                        // 构建连接字符串
                        let connectString = `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${config.host})(PORT=${config.port}))`;
                        
                        if (config.sid) {
                            connectString += `(CONNECT_DATA=(SID=${config.sid})))`;
                        } else if (config.serviceName) {
                            connectString += `(CONNECT_DATA=(SERVICE_NAME=${config.serviceName})))`;
                        } else {
                            throw new Error('Oracle连接需要提供SID或ServiceName');
                        }
                        
                        connectionConfig.connectString = connectString;
                    }
                    
                    connectionConfig.user = config.username;
                    connectionConfig.password = config.password;
                    
                    connection = await oracledb.getConnection(connectionConfig);
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
            } else if (connection instanceof sqlite3.Database) {
                await new Promise<void>((resolve, reject) => {
                    connection.close((err) => {
                        if (err) {
                            reject(err);
                        }
                        resolve();
                    });
                });
            } else if (connection instanceof MongoClient) {
                await connection.close();
            } else if ('close' in connection && typeof connection.close === 'function') {
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

    public async removeConfig(connectionId: string): Promise<boolean> {
        await this.disconnect(connectionId);
        return await this.configManager.removeConfig(connectionId);
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
                case 'mongodb':
                    // 对于 MongoDB，如果指定了数据库，则获取该数据库中的集合
                    // 否则，返回空数组，因为我们会先列出所有数据库
                    if (config.database) {
                        const client = connection as MongoClient;
                        const db = client.db(config.database);
                        const collections = await db.listCollections().toArray();
                        tables = collections.map(collection => collection.name);
                    }
                    break;
                case 'oracle':
                    const oracleConn = connection as oracledb.Connection;
                    const result = await oracleConn.execute(
                        `SELECT table_name FROM user_tables ORDER BY table_name`,
                        [],
                        { outFormat: oracledb.OUT_FORMAT_OBJECT }
                    );
                    if (result.rows) {
                        tables = result.rows.map((row: any) => row.TABLE_NAME);
                    }
                    break;
            }
            return tables;
        } catch (error) {
            console.error('获取表列表失败:', error);
            throw error;
        }
    }

    /**
     * 获取 MongoDB 连接中的所有数据库
     * @param connectionId 连接ID
     * @returns 数据库名称数组
     */
    public async getDatabases(connectionId: string): Promise<string[]> {
        const connection = this.connections.get(connectionId);
        const config = this.configManager.getConfig(connectionId);
        if (!connection || !config) {
            throw new Error('未找到数据库连接');
        }

        if (config.type !== 'mongodb') {
            throw new Error('只有 MongoDB 连接支持获取数据库列表');
        }

        try {
            const client = connection as MongoClient;
            const adminDb = client.db('admin');
            const result = await adminDb.admin().listDatabases();
            return result.databases.map((db: { name: string }) => db.name);
        } catch (error) {
            console.error('获取数据库列表失败:', error);
            throw error;
        }
    }

    /**
     * 获取指定数据库中的所有表/集合
     * @param connectionId 连接ID
     * @param databaseName 数据库名称
     * @returns 表/集合名称数组
     */
    public async getTablesInDatabase(connectionId: string, databaseName: string): Promise<string[]> {
        const connection = this.connections.get(connectionId);
        const config = this.configManager.getConfig(connectionId);
        if (!connection || !config) {
            throw new Error('未找到数据库连接');
        }

        if (config.type !== 'mongodb') {
            throw new Error('只有 MongoDB 连接支持此操作');
        }

        try {
            const client = connection as MongoClient;
            const db = client.db(databaseName);
            const collections = await db.listCollections().toArray();
            return collections.map(collection => collection.name);
        } catch (error) {
            console.error(`获取数据库 ${databaseName} 中的集合失败:`, error);
            throw error;
        }
    }

    public async getColumns(connectionId: string, tableName: string, databaseName?: string): Promise<Array<{name: string, type: string}>> {
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
                        `SHOW COLUMNS FROM ${tableName}`
                    );
                    columns = (mysqlRows as any[]).map(row => ({
                        name: row.Field,
                        type: row.Type
                    }));
                    break;
                case 'sqlite':
                    columns = await new Promise((resolve, reject) => {
                        (connection as sqlite3.Database).all(
                            `PRAGMA table_info(${tableName})`,
                            [],
                            (err, rows: any[]) => {
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
                case 'mongodb':
                    // MongoDB是无模式的，我们需要从一个文档中推断字段
                    const client = connection as MongoClient;
                    // 使用指定的数据库名称或配置中的数据库名称
                    const db = client.db(databaseName || config.database);
                    const collection = db.collection(tableName);
                    const sample = await collection.findOne({});
                    if (sample) {
                        columns = Object.entries(sample).map(([key, value]) => ({
                            name: key,
                            type: typeof value
                        }));
                    }
                    break;
                case 'oracle':
                    const oracleConn = connection as oracledb.Connection;
                    const result = await oracleConn.execute(
                        `SELECT column_name, data_type FROM user_tab_columns WHERE table_name = :tableName ORDER BY column_id`,
                        { tableName: tableName.toUpperCase() },
                        { outFormat: oracledb.OUT_FORMAT_OBJECT }
                    );
                    if (result.rows) {
                        columns = result.rows.map((row: any) => ({
                            name: row.COLUMN_NAME,
                            type: row.DATA_TYPE
                        }));
                    }
                    break;
            }
            return columns;
        } catch (error) {
            console.error('获取列信息失败:', error);
            throw error;
        }
    }

    public async executeQuery(connectionId: string, query: string, databaseName?: string): Promise<any[]> {
        const connection = this.connections.get(connectionId);
        const config = this.configManager.getConfig(connectionId);
        if (!connection || !config) {
            throw new Error('未找到数据库连接');
        }

        try {
            let result: any[] = [];
            if ('execute' in connection) {
                if (config.type === 'mysql') {
                    const [rows] = await (connection as any).execute(query);
                    if (Array.isArray(rows)) {
                        result = rows;
                    } else if (rows && typeof rows === 'object') {
                        // 处理非查询操作的结果
                        result = [rows];
                    }
                } else if (config.type === 'oracle') {
                    const oracleResult = await (connection as OracleConnection).execute(
                        query, 
                        [], 
                        { outFormat: oracledb.OUT_FORMAT_OBJECT }
                    );
                    if (oracleResult.rows) {
                        result = oracleResult.rows;
                    }
                }
            } else if (connection instanceof sqlite3.Database) {
                result = await new Promise((resolve, reject) => {
                    connection.all(query, [], (err, rows) => {
                        if (err) {
                            reject(err);
                        }
                        resolve(rows);
                    });
                });
            } else if (connection instanceof MongoClient) {
                // 对于MongoDB，我们需要解析查询字符串
                const db = connection.db(databaseName || config.database);
                
                // 详细日志输出
                console.log('MongoDB查询详情:');
                console.log('- 原始查询:', query);
                console.log('- 查询类型:', typeof query);
                console.log('- 查询长度:', query.length);
                console.log('- 查询前20个字符:', query.substring(0, 20));
                console.log('- 查询后20个字符:', query.substring(query.length - 20));
                
                // 检查查询是否包含特殊字符或不可见字符
                const hexDump = Array.from(query).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
                console.log('- 查询十六进制:', hexDump);
                
                // 尝试修复可能的问题
                const cleanQuery = query.trim().replace(/\s+/g, ' ');
                console.log('- 清理后的查询:', cleanQuery);
                
                // 解析MongoDB查询字符串
                // 支持的格式：
                // 1. db.collection.find({})
                // 2. db.collection.insertOne({})
                // 3. db.collection.insertMany([{}])
                // 4. db.collection.updateOne({}, {})
                // 5. db.collection.updateMany({}, {})
                // 6. db.collection.deleteOne({})
                // 7. db.collection.deleteMany({})
                
                // 提取集合名称和操作类型
                console.log('尝试匹配MongoDB查询格式...');
                
                // 使用更宽松的正则表达式匹配
                const collectionMatch = cleanQuery.match(/db\.([^\.]+)\.(find|insertOne|insertMany|updateOne|updateMany|deleteOne|deleteMany)/i);
                if (!collectionMatch) {
                    console.error('MongoDB查询格式匹配失败!');
                    
                    // 尝试手动解析
                    const dbPrefix = 'db.';
                    if (cleanQuery.startsWith(dbPrefix)) {
                        const afterPrefix = cleanQuery.substring(dbPrefix.length);
                        const dotIndex = afterPrefix.indexOf('.');
                        if (dotIndex > 0) {
                            const possibleCollection = afterPrefix.substring(0, dotIndex);
                            const afterCollection = afterPrefix.substring(dotIndex + 1);
                            const operationEndIndex = afterCollection.indexOf('(');
                            if (operationEndIndex > 0) {
                                const possibleOperation = afterCollection.substring(0, operationEndIndex);
                                console.log('- 可能的集合名称:', possibleCollection);
                                console.log('- 可能的操作:', possibleOperation);
                                
                                // 检查操作是否是支持的操作
                                const supportedOperations = ['find', 'insertOne', 'insertMany', 'updateOne', 'updateMany', 'deleteOne', 'deleteMany'];
                                if (supportedOperations.includes(possibleOperation)) {
                                    console.log('- 找到支持的操作:', possibleOperation);
                                    
                                    // 使用手动解析的结果
                                    const collectionName = possibleCollection;
                                    const operation = possibleOperation;
                                    const collection = db.collection(collectionName);
                                    
                                    console.log('- 使用手动解析的结果:', { collectionName, operation });
                                    
                                    // 提取参数
                                    let params: any[] = [];
                                    try {
                                        // 使用更简单的方法提取括号内的内容
                                        const startIndex = cleanQuery.indexOf('(', cleanQuery.indexOf(operation)) + 1;
                                        const endIndex = cleanQuery.lastIndexOf(')');
                                        
                                        if (startIndex > 0 && endIndex > startIndex) {
                                            const paramsStr = cleanQuery.substring(startIndex, endIndex).trim();
                                            console.log('- 参数字符串:', paramsStr);
                                            
                                            if (paramsStr) {
                                                // 简单处理：将参数字符串作为JSON解析
                                                // 对于单个参数
                                                if (!paramsStr.startsWith('[') && !paramsStr.includes('},{')) {
                                                    try {
                                                        params.push(JSON.parse(paramsStr));
                                                    } catch (e) {
                                                        console.error('- 参数解析失败:', e);
                                                        // 如果不是有效的JSON，尝试作为空对象处理
                                                        params.push({});
                                                    }
                                                } 
                                                // 对于多个参数（如updateOne的两个参数）
                                                else if (paramsStr.includes('},{')) {
                                                    const parts = paramsStr.split('},{');
                                                    try {
                                                        params.push(JSON.parse(parts[0] + '}'));
                                                        params.push(JSON.parse('{' + parts[1]));
                                                    } catch (e) {
                                                        console.error('- 多参数解析失败:', e);
                                                        // 如果解析失败，使用空对象
                                                        params.push({});
                                                        params.push({});
                                                    }
                                                }
                                                // 对于数组参数（如insertMany）
                                                else if (paramsStr.startsWith('[')) {
                                                    try {
                                                        params.push(JSON.parse(paramsStr));
                                                    } catch (e) {
                                                        console.error('- 数组参数解析失败:', e);
                                                        // 如果解析失败，使用空数组
                                                        params.push([]);
                                                    }
                                                }
                                            } else {
                                                // 空参数，使用默认值
                                                params.push({});
                                            }
                                        } else {
                                            console.error('- 未找到参数括号');
                                            // 没有找到括号，使用默认参数
                                            params.push({});
                                        }
                                        
                                        console.log('- 解析后的参数:', params);
                                        
                                        // 执行操作
                                        switch (operation) {
                                            case 'find':
                                                const filter = params[0] || {};
                                                const options = params[1] || {};
                                                const cursor = collection.find(filter, options);
                                                result = await cursor.toArray();
                                                break;
                                            case 'insertOne':
                                                const insertOneResult = await collection.insertOne(params[0] || {});
                                                result = [{ acknowledged: insertOneResult.acknowledged, insertedId: insertOneResult.insertedId }];
                                                break;
                                            case 'insertMany':
                                                const insertManyResult = await collection.insertMany(params[0] || []);
                                                result = [{ acknowledged: insertManyResult.acknowledged, insertedCount: insertManyResult.insertedCount, insertedIds: insertManyResult.insertedIds }];
                                                break;
                                            case 'updateOne':
                                                const updateOneResult = await collection.updateOne(params[0] || {}, params[1] || {});
                                                result = [{ acknowledged: updateOneResult.acknowledged, matchedCount: updateOneResult.matchedCount, modifiedCount: updateOneResult.modifiedCount }];
                                                break;
                                            case 'updateMany':
                                                const updateManyResult = await collection.updateMany(params[0] || {}, params[1] || {});
                                                result = [{ acknowledged: updateManyResult.acknowledged, matchedCount: updateManyResult.matchedCount, modifiedCount: updateManyResult.modifiedCount }];
                                                break;
                                            case 'deleteOne':
                                                const deleteOneResult = await collection.deleteOne(params[0] || {});
                                                result = [{ acknowledged: deleteOneResult.acknowledged, deletedCount: deleteOneResult.deletedCount }];
                                                break;
                                            case 'deleteMany':
                                                const deleteManyResult = await collection.deleteMany(params[0] || {});
                                                result = [{ acknowledged: deleteManyResult.acknowledged, deletedCount: deleteManyResult.deletedCount }];
                                                break;
                                            default:
                                                throw new Error(`不支持的MongoDB操作: ${operation}`);
                                        }
                                        
                                        return result;
                                    } catch (error: unknown) {
                                        console.error('- 手动解析执行失败:', error);
                                        throw error;
                                    }
                                }
                            }
                        }
                    }
                    
                    throw new Error('无效的MongoDB查询，支持的格式: db.collection.find({}), db.collection.insertOne({}), db.collection.insertMany([{}]), db.collection.updateOne({}, {}), db.collection.updateMany({}, {}), db.collection.deleteOne({}), db.collection.deleteMany({})');
                }
                
                const collectionName = collectionMatch[1];
                const operation = collectionMatch[2];
                const collection = db.collection(collectionName);
                
                console.log('MongoDB集合:', collectionName);
                console.log('MongoDB操作:', operation);
                
                // 提取参数
                let params: any[] = [];
                try {
                    // 使用更简单的方法提取括号内的内容
                    const startIndex = cleanQuery.indexOf('(', cleanQuery.indexOf(operation)) + 1;
                    const endIndex = cleanQuery.lastIndexOf(')');
                    
                    if (startIndex > 0 && endIndex > startIndex) {
                        const paramsStr = cleanQuery.substring(startIndex, endIndex).trim();
                        console.log('MongoDB参数字符串:', paramsStr);
                        
                        if (paramsStr) {
                            // 简单处理：将参数字符串作为JSON解析
                            // 对于单个参数
                            if (!paramsStr.startsWith('[') && !paramsStr.includes('},{')) {
                                try {
                                    params.push(JSON.parse(paramsStr));
                                } catch (e) {
                                    console.error('参数解析失败:', e);
                                    // 如果不是有效的JSON，尝试作为空对象处理
                                    params.push({});
                                }
                            } 
                            // 对于多个参数（如updateOne的两个参数）
                            else if (paramsStr.includes('},{')) {
                                const parts = paramsStr.split('},{');
                                try {
                                    params.push(JSON.parse(parts[0] + '}'));
                                    params.push(JSON.parse('{' + parts[1]));
                                } catch (e) {
                                    console.error('多参数解析失败:', e);
                                    // 如果解析失败，使用空对象
                                    params.push({});
                                    params.push({});
                                }
                            }
                            // 对于数组参数（如insertMany）
                            else if (paramsStr.startsWith('[')) {
                                try {
                                    params.push(JSON.parse(paramsStr));
                                } catch (e) {
                                    console.error('数组参数解析失败:', e);
                                    // 如果解析失败，使用空数组
                                    params.push([]);
                                }
                            }
                        } else {
                            // 空参数，使用默认值
                            params.push({});
                        }
                    } else {
                        console.error('未找到参数括号');
                        // 没有找到括号，使用默认参数
                        params.push({});
                    }
                    
                    console.log('MongoDB解析后的参数:', params);
                } catch (error: unknown) {
                    console.error('解析MongoDB参数失败:', error);
                    // 使用默认参数继续执行
                    params = [{}];
                }
                
                // 执行操作
                switch (operation) {
                    case 'find':
                        const filter = params[0] || {};
                        const options = params[1] || {};
                        const cursor = collection.find(filter, options);
                        result = await cursor.toArray();
                        break;
                    case 'insertOne':
                        const insertOneResult = await collection.insertOne(params[0] || {});
                        result = [{ acknowledged: insertOneResult.acknowledged, insertedId: insertOneResult.insertedId }];
                        break;
                    case 'insertMany':
                        const insertManyResult = await collection.insertMany(params[0] || []);
                        result = [{ acknowledged: insertManyResult.acknowledged, insertedCount: insertManyResult.insertedCount, insertedIds: insertManyResult.insertedIds }];
                        break;
                    case 'updateOne':
                        const updateOneResult = await collection.updateOne(params[0] || {}, params[1] || {});
                        result = [{ acknowledged: updateOneResult.acknowledged, matchedCount: updateOneResult.matchedCount, modifiedCount: updateOneResult.modifiedCount }];
                        break;
                    case 'updateMany':
                        const updateManyResult = await collection.updateMany(params[0] || {}, params[1] || {});
                        result = [{ acknowledged: updateManyResult.acknowledged, matchedCount: updateManyResult.matchedCount, modifiedCount: updateManyResult.modifiedCount }];
                        break;
                    case 'deleteOne':
                        const deleteOneResult = await collection.deleteOne(params[0] || {});
                        result = [{ acknowledged: deleteOneResult.acknowledged, deletedCount: deleteOneResult.deletedCount }];
                        break;
                    case 'deleteMany':
                        const deleteManyResult = await collection.deleteMany(params[0] || {});
                        result = [{ acknowledged: deleteManyResult.acknowledged, deletedCount: deleteManyResult.deletedCount }];
                        break;
                    default:
                        throw new Error(`不支持的MongoDB操作: ${operation}`);
                }
            }
            return result;
        } catch (error) {
            console.error('执行查询失败:', error);
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
            let connection: mysql.Connection | sqlite3.Database | MongoClient | oracledb.Connection;
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

                case 'mongodb':
                    if (!config.host || !config.port) {
                        throw new Error('MongoDB连接配置不完整');
                    }
                    const mongoUrl = `mongodb://${config.username && config.password ? 
                        `${config.username}:${config.password}@` : ''}${config.host}:${config.port}/${config.database || ''}`;
                    const client = new MongoClient(mongoUrl);
                    await client.connect();
                    await client.close();
                    break;

                case 'oracle':
                    if ((!config.host || !config.port || !config.username || !config.password) && 
                        !config.connectionString) {
                        throw new Error('Oracle连接配置不完整');
                    }
                    
                    let connectionConfig: oracledb.ConnectionAttributes = {};
                    
                    if (config.connectionString) {
                        connectionConfig.connectString = config.connectionString;
                    } else {
                        // 构建连接字符串
                        let connectString = `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${config.host})(PORT=${config.port}))`;
                        
                        if (config.sid) {
                            connectString += `(CONNECT_DATA=(SID=${config.sid})))`;
                        } else if (config.serviceName) {
                            connectString += `(CONNECT_DATA=(SERVICE_NAME=${config.serviceName})))`;
                        } else {
                            throw new Error('Oracle连接需要提供SID或ServiceName');
                        }
                        
                        connectionConfig.connectString = connectString;
                    }
                    
                    connectionConfig.user = config.username;
                    connectionConfig.password = config.password;
                    
                    connection = await oracledb.getConnection(connectionConfig);
                    await connection.close();
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

    /**
     * 获取 MongoDB 连接
     * @param connectionId 连接ID
     * @param databaseName 数据库名称（可选）
     * @returns MongoDB 数据库连接
     */
    public async getMongoConnection(connectionId: string, databaseName?: string): Promise<any> {
        const connection = this.connections.get(connectionId);
        const config = this.configManager.getConfig(connectionId);
        if (!connection || !config) {
            throw new Error('未找到数据库连接');
        }

        if (config.type !== 'mongodb') {
            throw new Error('不是 MongoDB 连接');
        }

        try {
            const client = connection as MongoClient;
            return client.db(databaseName || config.database);
        } catch (error) {
            console.error('获取 MongoDB 连接失败:', error);
            throw error;
        }
    }
}