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
- `maintainer.html`：仅本地的评分、照片手工补充和草稿批量导出；维护机制见 `docs/public-places.md`。
- `tests/accessibility.spec.js`、`tests/maintainer.spec.js`：地图流程、数据兼容、可访问性及维护草稿保护测试。
- `scripts/check-design-discipline.mjs`：设计令牌静态门禁。
- `docs/product-history.md`：已退役方向及仍有效的决策背景。

## 稳定约束

- 当前核心是“11 到访地记录册”：公开地点详情显示地点名、类别、维护者直接填写的 11 评分和最多一张到访打卡照。旧三维体验与推荐保留但暂不显示，不自动换算评分；普通用户档案与社区功能不进入主流程。
- 默认显示 11 的公开到访地点与用户个人地点，不再预制启动样例。公共内容不能被普通用户删除；清空只清个人数据。旧预制仅在完整匹配已发布默认数据、且没有个人使用或修改时退出，归属不明保留。
- 酒店住宿是独立类别和筛选；动物园、水族馆、博物馆、科技馆也保持独立，旧版合并类别只按名称中的明确场馆词迁移。
- 用户新增地点必须来自腾讯地图在线 POI；不要恢复任意坐标选点或只手填名称的入口。
- “我的位置”必须由用户主动点击后才请求浏览器权限；定位点只用于地图语境，不得保存为地点或绕过在线 POI 添加流程。
- 保持旧 `localStorage` 数据兼容，避免丢失历史评分、记录和照片。
- 公开地点、主观评分、单张打卡照及本地维护以 `docs/public-places.md` 为现役合同；[早期实施规格](https://github.com/meetwk0916/playmap/issues/31) 保留决策背景。真实名单与头像必须由维护者提供，不能把测试内容当作正式经历发布。
- 维护页仅限本地，草稿与个人地图分开存储；保存和导出不等于发布。
- [Wayfinder 地图](https://github.com/meetwk0916/playmap/issues/4) 是旧目标规格；当前先改 11 到访地记录册。旧决策票不能证明代码已实现、部署或通过真人验收。
- 不增加账号、用户标识、业务遥测、行为埋点或客户端错误上报；产品成效只在完整实现并部署后通过真人验收和用户主动反馈判断。
- 生产站点使用域名受限的腾讯地图浏览器 Key；不要删除其 GL JS 接入，也不要把腾讯 SecretKey/SK 写入前端或仓库。
- 手工编辑只改必要文件；遵守现有设计令牌、键盘焦点和 reduced-motion 约束。

## Agent 配置

- 读取相册、挑代表照或发布公开内容：执行 `docs/public-places.md` 的相册维护与“三步发布”；每处最多一张原始照片，只有视频时留空。先展示准确本地结果，确认后连续完成推送与页面、数据及照片的生产核验。
- GitHub Issues：`docs/agents/issue-tracker.md`
- 标签映射：`docs/agents/triage-labels.md`
- 领域文档约定：`docs/agents/domain.md`

## 技能参考文件路径（WSL 会话）

VS Code 同步到 WSL 的技能镜像只投递各技能的 `SKILL.md`，不含 `references/` 等配套文件。在 WSL 会话中加载技能后，如需其配套文件，从规范库读取：

`/home/wakun/shared/copilot-skills/<技能名>/`

该路径解析到 Windows 规范库 `C:\Users\wakun\.copilot\skills`。不要改动 `agentPlugins` 同步镜像，也不要创建 `~/.copilot/skills`。
