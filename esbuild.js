const esbuild = require("esbuild");
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

// 确保输出目录存在
const outDir = path.join(__dirname, 'out');
if (!fs.existsSync(outDir)) {
	fs.mkdirSync(outDir, { recursive: true });
}

// 复制模板文件
const templatesDir = path.join(__dirname, 'src', 'templates');
const outTemplatesDir = path.join(outDir, 'templates');
if (!fs.existsSync(outTemplatesDir)) {
	fs.mkdirSync(outTemplatesDir, { recursive: true });
}
if (fs.existsSync(templatesDir)) {
	fs.readdirSync(templatesDir).forEach(file => {
		fs.copyFileSync(
			path.join(templatesDir, file),
			path.join(outTemplatesDir, file)
		);
	});
}

// 删除 dist 目录（如果存在）
const distDir = path.join(__dirname, 'dist');
if (fs.existsSync(distDir)) {
	console.log('删除 dist 目录...');
	fs.rmSync(distDir, { recursive: true, force: true });
}

async function main() {
	const ctx = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'out/extension.js',
		external: [
			'vscode',
			'mysql2',
			'pg',
			'sqlite3',
			'mssql'
		],
		logLevel: 'info',
		mainFields: ['module', 'main'],
		resolveExtensions: ['.ts', '.js'],
		target: ['node16'],
		plugins: [
			esbuildProblemMatcherPlugin,
		],
	});
	if (watch) {
		await ctx.watch();
	} else {
		await ctx.rebuild();
		await ctx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
