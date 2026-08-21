# AGENTS.md

## 项目

「11去哪玩」是一个帮助家长快速完成“找地点 → 看关键信息 → 导航出发”的上海亲子地图。

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
- `CONTEXT.md`：单一领域词汇表；产品现状以 `README.md` 和代码为准。

## 稳定约束

- 核心任务是“出行决策”，不要把清单、评分、游玩记录、社区功能重新带回主流程。
- 新用户预制 33 个上海亲子地点；已有非空地图只按名称补种，主动清空后的地图不得复活。
- 保持旧 `localStorage` 数据兼容，避免丢失历史评分、记录和照片。
- 手工编辑只改必要文件；遵守现有设计令牌、键盘焦点和 reduced-motion 约束。

## 当前状态与下一步

当前为无后端的单人版，现役界面已收敛为地图、搜索、类别筛选、地点详情、导航和最简添加。下一步只围绕缩短出行决策链路迭代。

## Agent 配置

- GitHub Issues：`docs/agents/issue-tracker.md`
- 标签映射：`docs/agents/triage-labels.md`
- 领域文档约定：`docs/agents/domain.md`

## 技能参考文件路径（WSL 会话）

VS Code 同步到 WSL 的技能镜像只投递各技能的 `SKILL.md`，不含 `references/` 等配套文件。在 WSL 会话中加载技能后，如需其配套文件，从规范库读取：

`/home/wakun/shared/copilot-skills/<技能名>/`

该路径解析到 Windows 规范库 `C:\Users\wakun\.copilot\skills`。不要改动 `agentPlugins` 同步镜像，也不要创建 `~/.copilot/skills`。
