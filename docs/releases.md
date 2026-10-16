# 发布记录

发布流程与完成标准见 [public-places.md](public-places.md#三步发布workbuddy-接管)。每条记录分别说明部署、文件和交互核验；尚未执行的项目写明未确认。

## 2026-10-17：11 到访地图与草莓章

- 目标提交：`c5ff7247c8dbd75ca124a6f01cb5aa8f3c723c79`，已推送至 `main`。
- [CI](https://github.com/meetwk0916/playmap/actions/runs/38928251337) 与 [Pages 部署](https://github.com/meetwk0916/playmap/actions/runs/38928249018)：成功，Pages 构建对应目标提交。
- 生产文件：页面、公开 JSON、草莓章、头像和全部三张到访照片与目标提交字节一致；维护页返回 404。乐高照片首次请求发生 TLS EOF，重试后字节一致。
- 手机交互：生产浏览器工具连续两次报 `Unable to load browser request-header policy`，未开始页面检查；底层原因未知。本地手机预览已通过，不能代替生产交互验证。
- 结论：部署成功、文件核验通过、交互未确认；整体核验未完成，真人验收未进行。
