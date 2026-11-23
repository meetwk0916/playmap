# AGENTS.md

## 项目

先读 [README 产品范围](README.md#产品范围) 和 [领域词汇](CONTEXT.md)；核对发布或接续本地变更时看[发布记录](docs/releases.md)。规格不证明实现、部署或真人验收。

## 运行与验证

启动与预览归属见 [README「运行」](README.md#运行)；Playwright、文档门禁和完整复跑见 [README「验证」](README.md#验证)。

## 技术栈与结构

- `index.html`：现役地图页面，原生 HTML/CSS/JavaScript + 腾讯地图 GL JS API；与维护页共用 `assets/visit-rules.js` 到访规则。
- `maintainer.html`：仅本地的玩后感、照片手工补充和草稿批量导出；维护机制见 `docs/public-places.md`。
- `tests/accessibility.spec.js`、`tests/maintainer.spec.js`：地图流程、数据兼容、可访问性及维护草稿保护测试。
- `scripts/check-design-discipline.mjs`：设计令牌静态门禁。
- `docs/product-history.md`：已退役方向及仍有效的决策背景。

## 稳定约束

- 访客只浏览公开到访，不能新增、修改或删除公开地点。新增地点是维护流程，绑定确切腾讯地图在线 POI；[地点类别规则](docs/public-places.md#地点类别)同时适用于本地选类和 Agent 补录。
- “我的位置”必须由用户主动点击后才请求浏览器权限；定位点只用于地图语境，不得保存为地点或绕过在线 POI 添加流程。
- 旧个人 `localStorage` 数据不解析、不迁移、不重写；仅访客在「数据与隐私」中两次明确确认清空时可删除。
- 真实名单与头像必须由维护者提供，不能把测试内容当作正式经历发布。
- 维护页仅限本地，草稿与个人地图分开存储；保存和导出不等于发布。
- 不增加账号、用户标识、业务遥测、行为埋点或客户端错误上报；产品成效只在完整实现并部署后通过真人验收和用户主动反馈判断。
- 生产站点使用域名受限的腾讯地图浏览器 Key；不要删除其 GL JS 接入，也不要把腾讯 SecretKey/SK 写入前端或仓库。
- 手工编辑只改必要文件；遵守现有设计令牌、键盘焦点和 reduced-motion 约束。

## Agent 配置

- 判断分支或执行 Git 写操作前，重新核对当前分支、工作树和提交状态；判断远端状态时先刷新远端引用。已获授权的提交若被 `.git` 沙箱权限拦截，在同一轮按权限流程重试并核对结果。
- 修改公开地点、评分、照片或维护页，或读取相册、选片、发布公开内容：先读[到访内容维护](docs/public-places.md)，按[三步发布](docs/public-places.md#三步发布workbuddy-接管)执行。
- GitHub Issues、PR 交接或委派实现：[tracker 指南](docs/agents/issue-tracker.md)
- 标签映射：`docs/agents/triage-labels.md`
- 领域文档约定：`docs/agents/domain.md`
- 改动现有界面前，按 README 的预览归属检查核对当前工作树，并在预览中定位要复用的控件。
- 视觉原型调整：先读 `docs/11-visit-map-design.md` 的「界面原型」，以原页面为对照评阅局部变化。

## 技能参考文件路径（WSL 会话）

WSL 技能镜像缺少 `references/` 等配套文件；需要时按 [WSL 技能配套文件](docs/agents/wsl-skill-mirror.md) 从规范库读取。
