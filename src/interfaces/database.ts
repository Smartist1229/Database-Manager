import { Connection } from 'mysql2/promise';
import { Database } from 'sqlite3';
import { MongoClient } from 'mongodb';
import * as oracledb from 'oracledb';

export type DatabaseType = 'mysql' | 'sqlite' | 'mongodb' | 'oracle';

export interface DatabaseConfig {
    type: DatabaseType;
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

export interface DatabaseConnection {
    type: DatabaseType;
    connection: Connection | Database | MongoClient | oracledb.Connection;
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