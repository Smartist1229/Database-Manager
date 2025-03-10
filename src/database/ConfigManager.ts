import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DatabaseConfig } from './DatabaseManager';

export class ConfigManager {
    private static instance: ConfigManager;
    private configPath: string;
    private configs: Map<string, DatabaseConfig>;

    private constructor(context: vscode.ExtensionContext) {
        this.configPath = path.join(context.globalStoragePath, 'database-configs.json');
        this.configs = new Map();
        this.ensureConfigFile();
        this.loadConfigs();
    }

    public static getInstance(context?: vscode.ExtensionContext): ConfigManager {
        if (!ConfigManager.instance && context) {
            ConfigManager.instance = new ConfigManager(context);
        }
        return ConfigManager.instance;
    }

    private ensureConfigFile() {
        const dir = path.dirname(this.configPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        if (!fs.existsSync(this.configPath)) {
            fs.writeFileSync(this.configPath, JSON.stringify({ configs: [] }, null, 2));
        }
    }

    private loadConfigs() {
        try {
            const data = fs.readFileSync(this.configPath, 'utf-8');
            const configData = JSON.parse(data);
            const configs = configData.configs || [];
            
            this.configs.clear();
            configs.forEach((config: DatabaseConfig) => {
                const id = this.generateConnectionId(config);
                this.configs.set(id, config);
            });
        } catch (error) {
            console.error('加载配置文件失败:', error);
            this.configs.clear();
            // 如果文件损坏，重新创建
            this.ensureConfigFile();
        }
    }

    private async saveConfigs(): Promise<void> {
        try {
            const configs = Array.from(this.configs.values());
            const configData = {
                configs: configs,
                lastUpdated: new Date().toISOString()
            };
            await fs.promises.writeFile(this.configPath, JSON.stringify(configData, null, 2));
            console.log('配置文件已成功保存至:', this.configPath);
        } catch (error: any) {
            console.error('[配置保存错误] 路径:', this.configPath, '错误详情:', error);
            vscode.window.showErrorMessage(`配置保存失败: ${error.message}`);
            throw error;
        }
    }

    public addConfig(config: DatabaseConfig): string {
        const id = this.generateConnectionId(config);
        this.configs.set(id, { ...config });  // 创建配置的副本
        this.saveConfigs();
        return id;
    }

    public async removeConfig(id: string): Promise<boolean> {
        if (this.configs.delete(id)) {
            try {
                await this.saveConfigs();
                console.log(`配置 ${id} 已成功删除并保存`);
                return true;
            } catch (error) {
                console.error('删除配置保存失败:', error);
                throw new Error('删除配置保存失败');
            }
        }
        return false;
    }

    public updateConfig(id: string, config: DatabaseConfig) {
        if (this.configs.has(id)) {
            this.configs.set(id, { ...config });  // 创建配置的副本
            this.saveConfigs();
            return true;
        }
        return false;
    }

    public getConfig(id: string): DatabaseConfig | undefined {
        const config = this.configs.get(id);
        return config ? { ...config } : undefined;  // 返回配置的副本
    }

    public getAllConfigs(): Map<string, DatabaseConfig> {
        // 返回所有配置的副本
        const configsCopy = new Map();
        this.configs.forEach((config, id) => {
            configsCopy.set(id, { ...config });
        });
        return configsCopy;
    }

    private generateConnectionId(config: DatabaseConfig): string {
        const timestamp = Date.now();
        return `${config.type}-${config.host || config.filename || ''}-${config.database || ''}-${timestamp}`;
    }
}