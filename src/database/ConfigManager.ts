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

    private saveConfigs() {
        try {
            const configs = Array.from(this.configs.values());
            const configData = {
                configs: configs,
                lastUpdated: new Date().toISOString()
            };
            fs.writeFileSync(this.configPath, JSON.stringify(configData, null, 2));
        } catch (error: any) {
            console.error('保存配置文件失败:', error);
            vscode.window.showErrorMessage(`保存数据库配置失败: ${error.message}`);
            throw error;
        }
    }

    public addConfig(config: DatabaseConfig): string {
        const id = this.generateConnectionId(config);
        this.configs.set(id, { ...config });  // 创建配置的副本
        this.saveConfigs();
        return id;
    }

    public removeConfig(id: string) {
        if (this.configs.delete(id)) {
            this.saveConfigs();
            return true;
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