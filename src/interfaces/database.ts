import { Connection } from 'mysql2/promise';
import { Client } from 'pg';
import { Database } from 'sqlite3';
import { ConnectionPool } from 'mssql';

export type DatabaseType = 'mysql' | 'postgresql' | 'sqlite' | 'mssql';

export interface DatabaseConfig {
    type: DatabaseType;
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    database?: string;
    filename?: string; // 用于SQLite
}

export interface DatabaseConnection {
    type: DatabaseType;
    connection: Connection | Client | Database | ConnectionPool;
}

export interface QueryResult {
    rows: any[];
    fields?: any[];
    rowCount?: number;
}

export interface DatabaseService {
    connect(config: DatabaseConfig): Promise<boolean>;
    disconnect(connectionId: string): Promise<void>;
    executeQuery(connectionId: string, query: string): Promise<QueryResult>;
    getConnections(): string[];
    isConnected(connectionId: string): boolean;
    beginTransaction(connectionId: string): Promise<void>;
    commitTransaction(connectionId: string): Promise<void>;
    rollbackTransaction(connectionId: string): Promise<void>;
}