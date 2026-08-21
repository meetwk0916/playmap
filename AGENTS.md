# AGENTS.md

## 项目

先读 `README.md` 了解现役产品范围，读 `CONTEXT.md` 使用统一领域词汇。

## 运行与验证

```bash
python3 -m http.server 4173 --bind 127.0.0.1
npm run check:design
npm test
```

Playwright 需要 Chromium 及其系统动态库。缺少系统依赖时，不要把浏览器无法启动误报为代码测试失败。

## 技术栈与结构

- `index.html`：现役单文件应用，原生 HTML/CSS/JavaScript + 腾讯地图 GL JS API。
- `tests/accessibility.spec.js`：核心流程、可访问性、响应式和种子升级行为测试。
- `scripts/check-design-discipline.mjs`：设计令牌静态门禁。
- `docs/product-history.md`：已退役方向及仍有效的决策背景。

## 稳定约束

- 核心任务是“出行决策”，不要把清单、评分、游玩记录、社区功能重新带回主流程。
- 新用户预制 33 个上海亲子地点；已有非空地图只按名称补种，主动清空后的地图不得复活。
- 动物园、水族馆、博物馆、科技馆必须保持独立类别和筛选；旧版合并类别只按名称中的明确场馆词迁移。
- 用户新增地点必须来自腾讯地图在线 POI；不要恢复任意坐标选点或只手填名称的入口。
- 保持旧 `localStorage` 数据兼容，避免丢失历史评分、记录和照片。
- 生产站点使用域名受限的腾讯地图浏览器 Key；不要删除其 GL JS 接入，也不要把腾讯 SecretKey/SK 写入前端或仓库。
- 手工编辑只改必要文件；遵守现有设计令牌、键盘焦点和 reduced-motion 约束。

## Agent 配置

- GitHub Issues：`docs/agents/issue-tracker.md`
- 标签映射：`docs/agents/triage-labels.md`
- 领域文档约定：`docs/agents/domain.md`

## 技能参考文件路径（WSL 会话）

VS Code 同步到 WSL 的技能镜像只投递各技能的 `SKILL.md`，不含 `references/` 等配套文件。在 WSL 会话中加载技能后，如需其配套文件，从规范库读取：

`/home/wakun/shared/copilot-skills/<技能名>/`

该路径解析到 Windows 规范库 `C:\Users\wakun\.copilot\skills`。不要改动 `agentPlugins` 同步镜像，也不要创建 `~/.copilot/skills`。
