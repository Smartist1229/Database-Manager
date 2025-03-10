import * as vscode from 'vscode';
import * as mysql from 'mysql2/promise';
import * as sqlite3 from 'sqlite3';
import { MongoClient } from 'mongodb';
import * as oracledb from 'oracledb';
import { DatabaseConfig, DatabaseService, QueryResult } from '../interfaces/database';

// 声明 Oracle 连接类型
type OracleConnection = any; // 简化处理

export class DatabaseServiceImpl implements DatabaseService {
    private connections: Map<string, mysql.Connection | sqlite3.Database | MongoClient | OracleConnection> = new Map();
    private transactionConnections: Map<string, any> = new Map();

    public isConnected(connectionId: string): boolean {
        return this.connections.has(connectionId);
    }

    public async beginTransaction(connectionId: string): Promise<void> {
        const connection = this.connections.get(connectionId);
        if (!connection) {
            throw new Error('未找到数据库连接');
        }

        try {
            let transaction;
            if ('execute' in connection && 'beginTransaction' in connection) {
                await connection.beginTransaction();
                transaction = connection;
            } else if (connection instanceof sqlite3.Database) {
                await new Promise((resolve, reject) => {
                    connection.run('BEGIN TRANSACTION', (err) => {
                        if (err) {
                            reject(err);
                        }
                        resolve(true);
                    });
                });
                transaction = connection;
            } else if (connection instanceof MongoClient) {
                // MongoDB 事务需要会话
                const session = connection.startSession();
                session.startTransaction();
                transaction = session;
            } else if ('execute' in connection) {
                // Oracle
                await connection.execute('BEGIN');
                transaction = connection;
            }
            this.transactionConnections.set(connectionId, transaction);
        } catch (error) {
            throw new Error(`开始事务失败: ${(error as Error).message}`);
        }
    }

    public async commitTransaction(connectionId: string): Promise<void> {
        const transaction = this.transactionConnections.get(connectionId);
        if (!transaction) {
            throw new Error('未找到活动事务');
        }

        try {
            // 检查是否为MySQL连接
            if ('commit' in transaction && typeof transaction.commit === 'function') {
                await transaction.commit();
            } else if (transaction instanceof sqlite3.Database) {
                await new Promise((resolve, reject) => {
                    transaction.run('COMMIT', (err) => {
                        if (err) {
                            reject(err);
                        }
                        resolve(true);
                    });
                });
            } else if ('endSession' in transaction) {
                // MongoDB 会话
                await transaction.commitTransaction();
                transaction.endSession();
            } else {
                // Oracle
                await transaction.execute('COMMIT');
            }
            this.transactionConnections.delete(connectionId);
        } catch (error) {
            throw new Error(`提交事务失败: ${(error as Error).message}`);
        }
    }

    public async rollbackTransaction(connectionId: string): Promise<void> {
        const transaction = this.transactionConnections.get(connectionId);
        if (!transaction) {
            throw new Error('未找到活动事务');
        }

        try {
            // 检查是否为MySQL连接（使用duck typing检查方法是否存在）
            if ('rollback' in transaction && typeof transaction.rollback === 'function') {
                await transaction.rollback();
            } else if (transaction instanceof sqlite3.Database) {
                await new Promise((resolve, reject) => {
                    transaction.run('ROLLBACK', (err) => {
                        if (err) {
                            reject(err);
                        }
                        resolve(true);
                    });
                });
            } else if ('endSession' in transaction) {
                // MongoDB 会话
                await transaction.abortTransaction();
                transaction.endSession();
            } else {
                // Oracle
                await transaction.execute('ROLLBACK');
            }
            this.transactionConnections.delete(connectionId);
        } catch (error) {
            throw new Error(`回滚事务失败: ${(error as Error).message}`);
        }
    }

    public async connect(config: DatabaseConfig): Promise<boolean> {
        const maxRetries = 3;
        const retryDelay = 1000; // 1秒

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                let connection;
                const connectionId = this.generateConnectionId(config);

                switch (config.type) {
                    case 'mysql':
                        connection = await mysql.createConnection({
                            host: config.host,
                            port: config.port,
                            user: config.username,
                            password: config.password,
                            database: config.database,
                            connectTimeout: 10000
                        });
                        break;

                    case 'sqlite':
                        connection = new sqlite3.Database(config.filename!);
                        break;

                    case 'mongodb':
                        if (!config.host || !config.port) {
                            throw new Error('MongoDB连接配置不完整，请提供主机地址和端口');
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
                        throw new Error('不支持的数据库类型');
                }

                this.connections.set(connectionId, connection);
                return true;
            } catch (error) {
                if (attempt === maxRetries) {
                    vscode.window.showErrorMessage(`数据库连接失败 (尝试 ${attempt}/${maxRetries}): ${(error as Error).message}`);
                    return false;
                }
                
                vscode.window.showWarningMessage(`连接失败，正在重试 (${attempt}/${maxRetries})...`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
        }

        return false;
    }

    public async disconnect(connectionId: string): Promise<void> {
        const connection = this.connections.get(connectionId);
        if (!connection) {
            return;
        }

        try {
            // 根据不同数据库类型调用相应的断开连接方法
            // 使用duck typing检查end方法是否存在，而不是使用instanceof
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
        } catch (error: unknown) {
            vscode.window.showErrorMessage(`断开连接失败: ${(error as Error).message}`);
        }
    }

    public async executeQuery(connectionId: string, query: string): Promise<QueryResult> {
        const connection = this.connections.get(connectionId);
        if (!connection) {
            throw new Error('未找到数据库连接');
        }

        try {
            let result: any[] = [];
            if ('execute' in connection) {
                if ('beginTransaction' in connection) {
                    // MySQL
                    const [rows] = await (connection as any).execute(query);
                    if (Array.isArray(rows)) {
                        result = rows;
                    } else if (rows && typeof rows === 'object') {
                        // 处理非查询操作的结果
                        result = [rows];
                    }
                } else {
                    // Oracle
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
                // 这里简化处理，假设查询格式为 "db.collection.find({})"
                const db = connection.db();
                
                // 简单解析查询字符串，提取集合名称
                let collectionName = '';
                const match = query.match(/db\.(\w+)\.find/);
                if (match && match[1]) {
                    collectionName = match[1];
                } else {
                    throw new Error('无效的MongoDB查询，请使用格式: db.collection.find({})');
                }
                
                const cursor = db.collection(collectionName).find({});
                result = await cursor.toArray();
            }
            return { rows: result };
        } catch (error) {
            console.error('执行查询失败:', error);
            throw error;
        }
    }

    public getConnections(): string[] {
        return Array.from(this.connections.keys());
    }

    private generateConnectionId(config: DatabaseConfig): string {
        if (config.type === 'sqlite') {
            return `${config.type}:${config.filename}`;
        } else if (config.type === 'mongodb') {
            return `${config.type}:${config.host}:${config.port}/${config.database || ''}`;
        } else if (config.type === 'oracle') {
            if (config.connectionString) {
                return `${config.type}:${config.connectionString}`;
            } else {
                return `${config.type}:${config.host}:${config.port}:${config.sid || config.serviceName}`;
            }
        } else {
            return `${config.type}:${config.host}:${config.port}:${config.database}`;
        }
    }
}