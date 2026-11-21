# 11去哪玩

在地图上浏览 11 去过的地点，回看每次到访的打卡照和「11’s 玩后感」。

## 运行

```bash
npm run dev
```

打开 <http://127.0.0.1:4173/index.html>。应用使用原生 HTML/CSS/JavaScript 和腾讯地图 GL JS API，无自建后端。公开记录来自仓库 JSON；浏览器 `localStorage` 分别保留本地维护草稿和旧个人数据。地图与维护页共用 `assets/visit-rules.js` 解释到访记录。

验证预览归属运行 `npm run check:preview`。并行工作树可在启动、校验和测试命令前加同一个 `PLAYMAP_PORT=4202`，例如 `PLAYMAP_PORT=4202 npm run dev`。调整现有界面前，先打开该地址确认要改的控件确实存在。

生产站点为 <https://meetwk.site/playmap/>，由 GitHub Pages 从 `main` 分支根目录发布并强制使用 HTTPS。本地维护页不发布。

## 腾讯地图配置

生产页面使用受域名限制的浏览器 Key 加载腾讯地图 GL JS，并供地点搜索降级通道复用。腾讯位置服务控制台必须允许 `meetwk.site`，同时为地点搜索启用 WebService API 和相应配额。本地调试在线搜索还需允许 `127.0.0.1:4173`，并通过上面的 HTTP 地址打开；`file://` 页面没有可授权来源，不支持在线搜索。启动与浏览器测试会校验所选端口是否服务于当前工作目录；发现其他目录或无响应服务时停止并报告，不自动结束占用进程。

浏览器 Key 会随页面源码公开，必须依靠域名白名单和额度限制控制使用范围。密钥与 GL JS 接入的安全红线见 `AGENTS.md`「稳定约束」。

## 验证

```bash
npm run check:design
npm test
```

`npm run check:design` 包含设计令牌门禁，以及 `npm run check:places`：公开地点 `address` 必须能被地点列表解析出「…市」。`npm test` 使用 Playwright，并自动启动或复用当前工作目录的静态服务器；首次运行前执行 `npm ci` 和 `npx playwright install chromium`。

首轮本地诊断可用 `npm test -- --max-failures=1`，让运行器在首次失败后停止，避免重复启动故障。根据失败日志判断原因：`browserType.launch` 中的 Chromium 缺失、系统动态库缺失或 macOS `MachPortRendezvousServer ... Permission denied` 表示浏览器启动环境受限；浏览器已启动后的页面断言失败仍需按产品问题排查，不能把首次失败一概归为环境问题。

缺少浏览器时运行 `npx playwright install chromium`；缺少系统依赖时按 Playwright 的系统依赖提示修复；启动权限受限时说明具体限制，使用获准的执行方式或请求必要权限。未启动或未执行的测试不得标为通过。环境修复后，在最终内容上完整运行 `npm run check:design`、`npm test` 和 `git diff --check`，报告实际结果及未通过项；首次失败停止的诊断轮不能替代完整检查，也不代表部署或真人验收。

[检查工作流](.github/workflows/checks.yml) 在推送到 `main` 或向 `main` 提交 PR 时运行上述检查，并自动安装 Chromium 及系统依赖。文档改动可先跑 `npm run check:docs`，检查已跟踪 Markdown 的相对行内链接和 Markdown 标题锚点，不访问外链。

相册辅助工具另运行 `npm run test:album`，现有 CI 已配置该项。逐项执行检查，记录命令、退出码、简短结论和完整日志路径；命令依赖前项成功时使用 `&&`。完整输出保存在仓库外，失败与未运行项分别报告，终端只展示必要摘要。

发布核验工具与本地服务身份检查的回归使用 `npm run test:release`，已接入 CI，使用本地测试服务器。生产文件核验使用 `npm run --silent verify:production -- <完整提交SHA>`，可追加 `--wait-for-pages` 同时等待目标部署；交互验证另行执行，详见[发布流程](docs/public-places.md#三步发布workbuddy-接管)。

## 产品范围

一个确切腾讯 POI 对应一个地点。有至少一次[完整到访](docs/public-places.md#地图显示条件)时，地点才在地图、足迹胶卷和按城市分组的「足迹」列表中各出现一次。胶卷按各地点最近一次完整到访的日期倒序排列。

城市与[地点类别](docs/public-places.md#地点类别)共同筛选这三个视图；切换后地图框住匹配地点（只有一处则居中）。类别条只显示当前城市有完整到访的类别，切到没有原类别的城市时回到「全部」。地点数见「足迹」入口，列表标题另显示完整到访次数。

点击地图图钉会选中相应画格；点击画格或「足迹」条目直接打开详情。详情默认展示最近一次完整到访；在照片上左右滑动或用箭头切换同一地点的到访，日期、打卡年龄、照片与可选玩后感同步更新。「上一个」「下一个地点」按当前筛选的胶卷顺序切换地点，导航另有入口。退出详情返回原画格或列表位置；点击详情上方地图则回到对应选中图钉与画格。视口高度不足 520px 时收起胶卷，仍可通过「足迹」浏览。

旧个人地点、历史评分、记录和照片继续保存在原浏览器存储中，页面不再读取其中的地点内容、自动迁移或重写它们；只有用户在「数据与隐私」中明确两次确认清空时才改变这份存储。公共记录不能由访客修改或删除，维护草稿仍与个人存储分开。

维护者可以直接把确认的到访日期和照片交给 Codex 或 WorkBuddy，也可以指定 Google Photos 相册和时间段。Agent 核对腾讯 POI，为每次确认的到访挑一张原始照片，并在维护者确认差异和选片后发布。只有视频的到访暂不配照片。详见 [11 到访内容维护](docs/public-places.md)。

地图不可用时仍可按城市与类别筛选列表并打开详情。公开页面没有搜索新地点、个人添加或个人地图入口。定位仅在访客主动点击后申请权限，不会保存为地点。界面布局和视觉约定见[地图设计](docs/11-visit-map-design.md#当前地图优先界面)。

### 足迹回放

在原胶卷标题旁点「播放」，从最早的一次完整到访开始，按日期播放全部完整到访。同一地点重游按次停靠，当天的照片随路线自动滚入视野。亮黄色画格和 ▶ 标记当前站，暂停时也保留。两站之间的直线距离低于 500 公里时用小汽车造型，达到 500 公里时用小飞机造型，弧线表示到访顺序。

回放支持暂停、继续、结束和重播。结束后恢复当前城市和类别的浏览视野及胶卷顺序。地图加载失败时可继续用「足迹」浏览；胶卷因视口高度不足 520px 收起时结束回放。

## 发布边界

各次发布的提交、部署与核验结果先记录在原 PR，随后随正常 PR 汇总到[发布记录](docs/releases.md)；产品范围说明不作为部署凭据。[类别功能 PR #79](https://github.com/meetwk0916/playmap/pull/79) 不改公开地点数据；[Issue #78](https://github.com/meetwk0916/playmap/issues/78) 确认的 14 处存量打点重分类另走内容发布流程。

公开内容交给 WorkBuddy 发布只需「指定相册与时间段 → 核对地点和选片 → 确认发布」，检查和上线核验由它执行；可复制指令及完成标准见 [三步发布](docs/public-places.md#三步发布workbuddy-接管)。

公开记录随 `main` 分支通过 GitHub Pages 发布；是否上线以 Pages 构建和生产页面、公开数据核对结果为准。代码测试、提交、推送、部署和真实使用反馈分别记录。旧 Wayfinder 的五家庭导航验收门槛不作为这次记录册调整的验收标准；新方向尚未制定真人验收标准或发布 v1 标签。

## 文档地图

- 本文：现役产品范围、运行、配置与验证。
- [11 到访内容维护](docs/public-places.md)：到访数据、Agent 维护和发布交接。
- [CONTEXT.md](CONTEXT.md)：领域词汇。
- [docs/adr/](docs/adr/)：仍有效的架构与产品决策。
- [docs/product-history.md](docs/product-history.md)：已退役方向及保留下来的决策。
- [AGENTS.md](AGENTS.md)：Agent 工程约束。
- [发布「11去哪玩」产品级功能 v1](https://github.com/meetwk0916/playmap/issues/4)：旧 Wayfinder 决策地图规格，保留历史背景。
