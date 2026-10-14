# 11去哪玩

记录 11 到访过的地点：在地图上查看地点、11 的主观评分与一张到访打卡照。

## 运行

```bash
python3 -m http.server 4173 --bind 127.0.0.1
```

打开 <http://127.0.0.1:4173/index.html>。应用是单文件原生 HTML/CSS/JavaScript，使用腾讯地图 GL JS API；数据保存在浏览器 `localStorage`，不需要后端。

生产站点为 <https://meetwk.site/playmap/>，由 GitHub Pages 从 `main` 分支根目录发布并强制使用 HTTPS。

## 腾讯地图配置

生产页面使用受域名限制的浏览器 Key 加载腾讯地图 GL JS，并供地点搜索降级通道复用。腾讯位置服务控制台必须允许 `meetwk.site`，同时为地点搜索启用 WebService API 和相应配额。本地调试在线搜索还需允许 `127.0.0.1:4173`，并通过上面的 HTTP 地址打开；`file://` 页面没有可授权来源，不支持在线搜索。

浏览器 Key 会随页面源码公开，必须依靠域名白名单和额度限制控制使用范围。不要把腾讯地图 SecretKey/SK 写入 HTML、JavaScript 或仓库；如需使用 SK，应改由服务端代理持有。

## 验证

```bash
npm run check:design
npm test
```

`npm test` 使用 Playwright，并自动启动 4173 端口的静态服务器；首次运行前需安装项目依赖及 Playwright Chromium 运行环境。

首轮本地诊断可用 `npm test -- --max-failures=1`，让运行器在首次失败后停止，避免重复启动故障。根据失败日志判断原因：`browserType.launch` 中的 Chromium 缺失、系统动态库缺失或 macOS `MachPortRendezvousServer ... Permission denied` 表示浏览器启动环境受限；浏览器已启动后的页面断言失败仍需按产品问题排查，不能把首次失败一概归为环境问题。

缺少浏览器时运行 `npx playwright install chromium`；缺少系统依赖时按 Playwright 的系统依赖提示修复；启动权限受限时说明具体限制，使用获准的执行方式或请求必要权限。未启动或未执行的测试不得标为通过。环境修复后，在最终内容上完整运行 `npm run check:design`、`npm test` 和 `git diff --check`，报告实际结果及未通过项；首次失败停止的诊断轮不能替代完整检查，也不代表部署或真人验收。

[检查工作流](.github/workflows/checks.yml) 在推送到 `main` 或向 `main` 提交 PR 时运行上述两项检查，并自动安装 Chromium 及系统依赖。

相册辅助工具另运行 `npm run test:album`，现有 CI 已配置该项。逐项执行检查，记录命令、退出码、简短结论和完整日志路径；命令依赖前项成功时使用 `&&`。完整输出保存在仓库外，失败与未运行项分别报告，终端只展示必要摘要。

## 产品范围

地图公开显示维护者确认的 11 到访地点。点击公开图钉，详情展示地点名、类别、11 的主观评分和最多一张到访打卡照；尚未填写评分时显示「暂无评分」。旧版三维体验、推荐、日期、设施及来源暂不在详情展示，也不会自动换算成主观评分。主观评分由维护者提供，未填写时不从旧评价推断。

地点类别包含酒店住宿，并保留原有类别筛选。新增公开地点仍须绑定确切腾讯 POI；搜索、导航和个人保存入口暂时保留。个人地点及旧家庭游玩档案继续保存在浏览器本地，历史评分、记录和照片不会因本次页面调整而丢失。公共地点由维护者发布，普通访客不能修改公共评分或照片；清空个人数据不会清掉公共地点。

默认由维护者指定 Google Photos 相册和时间段，Codex 或 WorkBuddy 读取日期与位置、核对腾讯 POI，并为每个已确认到访地点挑选最多一张原始照片。只有视频的地点暂不配照片。维护者核对具体选片和发布结果后，照片与地点数据一起部署。详见 [11 到访内容维护](docs/public-places.md)。[本地维护页](maintainer.html)保留为手工补充入口。

地图或在线搜索不可用时，页面保留公开和个人地点的本地浏览。无法读取旧个人数据时进入只读保护，不覆盖原始内容。定位仅在用户主动点击后申请权限，不会保存为地点。

## 发布边界

公开内容交给 WorkBuddy 发布只需「指定相册与时间段 → 核对地点和选片 → 确认发布」，检查和上线核验由它执行；可复制指令及完成标准见 [三步发布](docs/public-places.md#三步发布workbuddy-接管)。

公开记录随 `main` 分支通过 GitHub Pages 发布；是否上线以 Pages 构建和生产页面、公开数据核对结果为准。代码测试、提交、推送、部署和真实使用反馈分别记录。旧 Wayfinder 的五家庭导航验收门槛不作为这次记录册调整的验收标准；新方向尚未制定真人验收标准或发布 v1 标签。

## 文档地图

- 本文：现役产品范围、运行、配置与验证。
- [11 到访内容维护](docs/public-places.md)：本地维护入口、草稿恢复、批量导出和发布交接。
- [CONTEXT.md](CONTEXT.md)：领域词汇。
- [docs/adr/](docs/adr/)：仍有效的架构与产品决策。
- [docs/product-history.md](docs/product-history.md)：已退役方向及保留下来的决策。
- [AGENTS.md](AGENTS.md)：Agent 工程约束。
- [发布「11去哪玩」产品级功能 v1](https://github.com/meetwk0916/playmap/issues/4)：旧 Wayfinder 决策地图规格，保留历史背景。
