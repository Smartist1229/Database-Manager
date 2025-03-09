import * as vscode from 'vscode';

export class DatabaseError extends Error {
    constructor(message: string, public readonly code?: string) {
        super(message);
        this.name = 'DatabaseError';
    }
}

export class ErrorHandler {
    public static handleError(error: Error | DatabaseError): void {
        let message = error.message;
        if (error instanceof DatabaseError && error.code) {
            message = `[${error.code}] ${message}`;
        }
        vscode.window.showErrorMessage(`数据库操作失败: ${message}`);
    }

    public static createDatabaseError(message: string, code?: string): DatabaseError {
        return new DatabaseError(message, code);
    }

    public static isConnectionError(error: Error): boolean {
        const connectionErrorMessages = [
            'ECONNREFUSED',
            'ETIMEDOUT',
            'ENOTFOUND',
            'authentication failed',
            'Connection refused'
        ];
        return connectionErrorMessages.some(msg => error.message.includes(msg));
    }

    public static isQueryError(error: Error): boolean {
        const queryErrorMessages = [
            'syntax error',
            'invalid query',
            'table not found',
            'column not found'
        ];
        return queryErrorMessages.some(msg => error.message.toLowerCase().includes(msg));
    }
}