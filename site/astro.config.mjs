// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// Project page on GitHub Pages: https://jinglonglong.github.io/springgraph/
// `site` + `base` make every internal link resolve under the /springgraph/ prefix.
export default defineConfig({
	site: 'https://jinglonglong.github.io',
	base: '/springgraph',
	integrations: [
		starlight({
			title: 'springgraph',
			description:
				'A local-first code-intelligence tool that turns any codebase into a queryable knowledge graph for AI coding agents.',
			favicon: '/favicon.svg',
			defaultLocale: 'root',
			locales: {
				root: {
					label: '简体中文',
					lang: 'zh-CN',
				},
			},
			head: [
				{
					// Default to the light / paper theme on first visit; the toggle still
					// lets a visitor switch to (and persist) the dark / ink theme.
					tag: 'script',
					content:
						"if(!localStorage.getItem('starlight-theme')){try{localStorage.setItem('starlight-theme','light')}catch(e){}document.documentElement.dataset.theme='light';document.documentElement.style.colorScheme='light'}",
				},
			],
			social: [
				{
					icon: 'github',
					label: 'GitHub',
					href: 'https://github.com/jinglonglong/springgraph',
				},
			],
			customCss: [
				'@fontsource-variable/archivo',
				'@fontsource/ibm-plex-mono/400.css',
				'@fontsource/ibm-plex-mono/500.css',
				'@fontsource/ibm-plex-mono/600.css',
				'./src/styles/theme.css',
			],
			components: {
				// Wordmark in the docs header.
				SiteTitle: './src/components/SiteTitle.astro',
				// Default GitHub icon + a live star-count pill (matches the landing nav).
				SocialIcons: './src/components/SocialIcons.astro',
			},
			expressiveCode: {
				themes: ['github-light', 'github-dark'],
				styleOverrides: {
					borderRadius: '0px',
					borderColor: '#cdcabf',
					codeFontFamily: "'IBM Plex Mono', ui-monospace, monospace",
				},
			},
			sidebar: [
				{
					label: '快速开始',
					items: [
						{ label: '项目介绍', slug: 'getting-started/introduction' },
						{ label: '快速启动', slug: 'getting-started/quickstart' },
						{ label: '安装指南', slug: 'getting-started/installation' },
						{ label: '配置说明', slug: 'getting-started/configuration' },
						{ label: '构建第一个图谱', slug: 'getting-started/your-first-graph' },
						{ label: '下一步', slug: 'getting-started/next-steps' },
					],
				},
				{
					label: '核心概念',
					items: [
						{ label: '工作原理', slug: 'core-concepts/how-it-works' },
						{ label: '知识图谱', slug: 'core-concepts/knowledge-graph' },
						{ label: '解析与框架', slug: 'core-concepts/resolution' },
					],
				},
				{
					label: '使用指南',
					items: [
						{ label: '项目索引建档', slug: 'guides/indexing' },
						{ label: '框架路由解析', slug: 'guides/framework-routes' },
						{ label: 'CI 受影响测试分析', slug: 'guides/affected-tests' },
						{ label: 'Web UI 可视化', slug: 'guides/web-ui' },
					],
				},
				{
					label: '参考指南',
					items: [
						{ label: 'MCP 服务器', slug: 'reference/mcp-server' },
						{ label: '工具集成', slug: 'reference/integrations' },
						{ label: '命令行工具', slug: 'reference/cli' },
						{ label: 'API 参考', slug: 'reference/api' },
						{ label: '支持的编程语言', slug: 'reference/languages' },
					],
				},
				{ label: '故障排查', slug: 'troubleshooting' },
			],
		}),
	],
});
