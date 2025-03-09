import * as vscode from 'vscode';
import * as mysql from 'mysql2/promise';
import * as pg from 'pg';
import * as sqlite3 from 'sqlite3';
import * as mssql from 'mssql';
import { DatabaseConfig, DatabaseService, QueryResult } from '../interfaces/database';

export class DatabaseServiceImpl implements DatabaseService {
    private connections: Map<string, mysql.Connection | pg.Client | sqlite3.Database | mssql.ConnectionPool> = new Map();
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
            } else if (connection instanceof pg.Client) {
                await connection.query('BEGIN');
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
            } else if (connection instanceof mssql.ConnectionPool) {
                transaction = await connection.transaction();
                await transaction.begin();
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
            } else if (transaction instanceof pg.Client) {
                await transaction.query('COMMIT');
            } else if (transaction instanceof sqlite3.Database) {
                await new Promise((resolve, reject) => {
                    transaction.run('COMMIT', (err) => {
                        if (err) {
                            reject(err);
                        }
                        resolve(true);
                    });
                });
            } else if (transaction instanceof mssql.Transaction) {
                await transaction.commit();
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
            } else if (transaction instanceof pg.Client) {
                await transaction.query('ROLLBACK');
            } else if (transaction instanceof sqlite3.Database) {
                await new Promise((resolve, reject) => {
                    transaction.run('ROLLBACK', (err) => {
                        if (err) {
                            reject(err);
                        }
                        resolve(true);
                    });
                });
            } else if (transaction instanceof mssql.Transaction) {
                await transaction.rollback();
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

                    case 'postgresql':
                        connection = new pg.Client({
                            host: config.host,
                            port: config.port,
                            user: config.username,
                            password: config.password,
                            database: config.database,
                            connectionTimeoutMillis: 10000, // 10秒连接超时
                            query_timeout: 60000 // 60秒查询超时
                        });
                        await connection.connect();
                        break;

                    case 'sqlite':
                        connection = new sqlite3.Database(config.filename!);
                        break;

                    case 'mssql':
                        if (!config.host || !config.username || !config.password || !config.database || !config.port) {
                            throw new Error('MSSQL连接配置不完整，请提供主机地址、端口、用户名、密码和数据库名');
                        }
                        connection = await mssql.connect({
                            server: config.host,
                            port: config.port,
                            user: config.username,
                            password: config.password,
                            database: config.database,
                            options: {
                                trustServerCertificate: true,
                                encrypt: false,
                                enableArithAbort: true,
                                connectTimeout: 10000 // 10秒连接超时
                            },
                            pool: {
                                max: 10,
                                min: 0,
                                idleTimeoutMillis: 30000
                            },
                            requestTimeout: 60000 // 60秒查询超时
                        });
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
            let result;
            if ('execute' in connection && typeof connection.execute === 'function') {
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
            return { rows: Array.isArray(result) ? result : [] };
        } catch (error) {
            vscode.window.showErrorMessage(`查询执行失败: ${(error as Error).message}`);
            throw error;
        }
    }

    public getConnections(): string[] {
        return Array.from(this.connections.keys());
    }

    private generateConnectionId(config: DatabaseConfig): string {
        return `${config.type}-${config.host || config.filename}-${config.database || ''}`;
    }
}