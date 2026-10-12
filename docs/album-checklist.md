# 私人相册核对清单

按需从已授权接管的 Google Photos 登录浏览器读取指定相册条目。辅助工具不创建到访、评分、选片或公开数据；后续核对确切腾讯 POI 和发布仍按[到访内容维护](public-places.md)执行。

先取得指定相册的原条目链接清单（或复用仓库外的来源索引），只提供指定时间段的候选链接。工具会验证相册归属、按已读取日期过滤时间段并去重。日期未能可靠读取的条目保留 `pending-retry`，由维护者回看；不把它归入已完成范围。清单只覆盖传入链接，`readComplete: false` 不代表整个相册已读完。

在同一个 Ego 浏览器 TaskSpace 中通过 Node 导入辅助工具，把现有 `page` 传入。不要另开浏览器绕过接管、权限提示或用户控制。

```js
const { collectAlbumChecklist } = await import('/absolute/path/to/playmap/scripts/album-checklist.mjs');
const result = await collectAlbumChecklist({
  page,
  albumUrl: 'https://photos.google.com/album/ALBUM_ID',
  itemUrls: sourceItems.map(item => item.url),
  from: '2026-09-01',
  to: '2026-09-30',
  outputPath: '/absolute/private-directory/checklist.json',
  repoRoot: '/absolute/path/to/playmap',
  detailTimeoutMs: 10000,
});
console.log({ read: result.items.filter(item => item.readStatus === 'read').length,
  pending: result.items.filter(item => item.readStatus === 'pending-retry').length });
```

`from`/`to` 是包含两端的页面日期；不转换时区。每条包含 `url`、`date`、`mediaType`、`location`、`locationProvenance` 与 `readStatus`。位置仅是候选依据，来源未说明时始终为 `unknown`。明确的添加位置控件代表当前无位置；仅缺少地图链接不能证明无位置，超时后保留待重试。

工具先确认条目来自指定相册，以新文档导航隔离旧详情，再等待当前媒体的条目标识、可见详情的条目标识与请求链接中的标识完全一致。仅有相同文件名、日期或时间不足以证明对应关系。预加载的隐藏媒体和详情不参与采集；播放中的视频从活动幻灯片读取媒体类型，不访问播放器、不截帧。第三方 DOM、语言或日期格式变化会保留待重试，需要重新检查浏览器适配，不应改为猜测位置。

输出必须在仓库外；拒绝仓库内路径与输出文件软链接，文件权限限制为维护者可读写。原始来源和坐标不进入公开仓库。日志只输出数量，避免打印 `result` 全文。

合成浏览器页面回归检查：`npm run test:album`。使用项目已有 Playwright Chromium，合成测试不证明真实登录网页适配成功；小范围真实读取须单独获准并分别记录结果。
