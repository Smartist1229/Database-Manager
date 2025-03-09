import * as vscode from 'vscode';
import { DatabaseConfig } from '../interfaces/database';

export class DatabaseConfigManager {
    private static readonly CONFIG_KEY = 'database-manager.connections';

    public static async saveConfig(config: DatabaseConfig): Promise<void> {
        const configs = await this.getConfigs();
        const configId = this.generateConfigId(config);
        configs.set(configId, config);
        await vscode.workspace.getConfiguration().update(
            this.CONFIG_KEY,
            Array.from(configs.entries()),
            vscode.ConfigurationTarget.Global
        );
    }

    public static async getConfigs(): Promise<Map<string, DatabaseConfig>> {
        const configs = vscode.workspace.getConfiguration().get<[string, DatabaseConfig][]>(
            this.CONFIG_KEY,
            []
        );
        return new Map(configs);
    }

    public static async deleteConfig(configId: string): Promise<void> {
        const configs = await this.getConfigs();
        configs.delete(configId);
        await vscode.workspace.getConfiguration().update(
            this.CONFIG_KEY,
            Array.from(configs.entries()),
            vscode.ConfigurationTarget.Global
        );
    }

    private static generateConfigId(config: DatabaseConfig): string {
        return `${config.type}-${config.host || config.filename}-${config.database || ''}`;
    }
}