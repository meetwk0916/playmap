# 私人相册核对清单

按需从已授权接管的 Google Photos 登录浏览器读取指定相册的照片条目。辅助工具不创建到访、评分、选片或公开数据；后续核对确切腾讯 POI 和发布仍按[到访内容维护](public-places.md)执行。

先取得指定相册的原条目链接清单（或复用仓库外的来源索引），只提供指定时间段的候选链接。工具会验证相册归属、按已读取日期标记时间段并去重。时间段外的照片保留为 `out-of-window`，来源范围不会因过滤而消失。日期未能可靠读取的条目保留 `pending-retry`，由维护者回看；不把它归入已完成范围。清单只覆盖传入链接；`indexedReadComplete` 表示这个来源索引已处理完，`readComplete` 始终为 `false`，因为工具没有遍历证据证明整个时间段已覆盖。视频只计为跳过条目，不计为已读取照片。

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
  skippedVideos: result.items.filter(item => item.readStatus === 'skipped-video').length,
  pending: result.items.filter(item => item.readStatus === 'pending-retry').length });
```

`from`/`to` 是包含两端的页面日期；不转换时区。每条包含 `url`、`date`、`mediaType`、`location`、`locationProvenance` 与 `readStatus`。位置仅是候选依据，来源未说明时始终为 `unknown`。明确的添加位置控件代表当前无位置；仅缺少地图链接不能证明无位置，超时后保留待重试。

工具先确认条目来自指定相册，以新文档导航隔离旧详情，再等待当前媒体的条目标识、可见详情的条目标识与请求链接中的标识完全一致。仅有相同文件名、日期或时间不足以证明对应关系。预加载的隐藏媒体和详情不参与采集；识别当前条目为视频后，直接记录 `skipped-video`，不打开信息面板、不读取视频日期或位置、不访问播放器、不截帧。视频跳过记录不属于照片完成范围。第三方 DOM、语言或日期格式变化会保留待重试，需要重新检查浏览器适配，不应改为猜测位置。

输出必须在仓库外；拒绝仓库内路径与输出文件软链接，文件权限限制为维护者可读写。原始来源和坐标不进入公开仓库。日志只输出数量，避免打印 `result` 全文。

合成浏览器页面回归检查：`npm run test:album`。使用项目已有 Playwright Chromium，合成测试不证明真实登录网页适配成功；小范围真实读取须单独获准并分别记录结果。

## 中断恢复

使用同一个 `outputPath`、相册、时间段和来源链接集合重新运行上面的调用。已有 `read`、`out-of-window` 和 `skipped-video` 条目直接复用；只读取 `pending-retry`。新运行不会扩大或缩小既有来源索引，改变来源范围需另用输出文件。浏览器断开等错误会保留当前条目的待重试状态并抛出错误；其他尚未读取条目也在清单中，不会静默消失。

初始来源索引和每条进度均通过同目录临时文件保存，再原子替换目标文件。保存失败保留最后一份可用文件；既有文件无法解析或完成条目不合法时报告原因并保留原文件，不从空清单继续。输出拒绝所有 Git checkout 内的路径及软链接，文件权限为 `0600`。

`sourceIndex` 是读取来源，`items` 是读取结果，`review` 是人工核对状态。工具初始化 `review.status: not-started` 和空 `confirmedBatches`，之后保留维护者写入的核对与已确认批次信息，不自动确认到访或发布。索引处理完成、人工核对完成、发布完成分别成立；只完成给定的两个链接不能证明整个月完成。

恢复演示：先用两个已授权的照片链接执行采集；若第二张读取时浏览器断开，文件中第一张为 `read`、第二张为 `pending-retry`。恢复接管后用完全相同参数再次调用，第一张复用，只继续第二张。`npm run test:album` 中的中断、详情超时重试、时间段外保留及保存故障用例可重复验证此行为。

早期没有 `sourceIndex` 的清单不能证明完整来源范围，工具拒绝覆盖；保留它作为来源证据，使用新的输出文件读取明确提供的链接。真实照片与坐标仍只保存在仓库外，恢复不会代替 POI 核对和三步发布。
