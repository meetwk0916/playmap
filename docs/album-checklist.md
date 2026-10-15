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

## 页面适配与夹具

修改浏览器适配器时，先在已获准的相册范围内连续读取两张不同照片，确认身份与详情对应，再扩大读取范围。把证明对应关系所需的最小 DOM 和观察结果存到仓库外；访问或接管尚未获准时，记录真实适配未验证。

从实际页面样本建立合成夹具：将原链接、媒体编号、姓名、坐标和图片地址替换为合成值，保留编号之间的对应关系、隐藏节点及加载时序。夹具既要包含当前条目，也要包含预加载的相邻条目。下面是已观察到、需要复查的页面合同：

| 观察对象 | 对应证据与行为 |
| --- | --- |
| 当前媒体 | 活动 `c-wiz` 的 `data-media-key` 与请求链接中的条目编号相同；相邻媒体节点可能仍留在 DOM 中。 |
| 当前详情 | 可见文件名所在详情容器的 `data-p` 包含同一编号；文件名、日期或时间相同不能代替编号核对。 |
| 信息按钮 | 操作实际 `button`；同名工具提示不是按钮。工具栏淡出时按钮仍可点击，隐藏关闭控件不能证明面板已打开。 |
| 导航与加载 | 新文档隔离旧详情；以实际活动媒体和详情状态等待加载，超时保留 `pending-retry`。 |
| 视频 | 识别当前条目后直接记录 `skipped-video`，在打开详情或读取视频日期、位置之前结束该条。 |

先用现有 `npm run test:album` 验证这些状态，再单独记录小范围真实照片的验证结果。合成检查通过不等于真实网页适配通过。第三方 DOM、语言或日期格式变化时重新检查这个合同，位置仍不明确则保留待重试。

输出必须在仓库外；拒绝仓库内路径与输出文件软链接，文件权限限制为维护者可读写。原始来源和坐标不进入公开仓库。日志只输出数量，避免打印 `result` 全文。

合成浏览器页面回归检查：`npm run test:album`。使用项目已有 Playwright Chromium，合成测试不证明真实登录网页适配成功；小范围真实读取须单独获准并分别记录结果。

## 中断恢复

使用同一个 `outputPath`、相册、时间段和来源链接集合重新运行上面的调用。已有 `read`、`out-of-window` 和 `skipped-video` 条目直接复用；只读取 `pending-retry`。新运行不会扩大或缩小既有来源索引，改变来源范围需另用输出文件。浏览器断开等错误会保留当前条目的待重试状态并抛出错误；其他尚未读取条目也在清单中，不会静默消失。

初始来源索引和每条进度均通过同目录临时文件保存，再原子替换目标文件。保存失败保留最后一份可用文件；既有文件无法解析或完成条目不合法时报告原因并保留原文件，不从空清单继续。输出拒绝所有 Git checkout 内的路径及软链接，文件权限为 `0600`。

`sourceIndex` 是读取来源，`items` 是读取结果，`review` 是人工核对状态。工具初始化 `review.status: not-started` 和空 `confirmedBatches`，之后保留维护者写入的核对与已确认批次信息，不自动确认到访或发布。重试条目会刷新采集字段、清除旧读取错误，并保留人工排除决定与其他维护者记录。索引处理完成、人工核对完成、发布完成分别成立；只完成给定的两个链接不能证明整个月完成。

### 状态归属与审查

| 数据 | 更新责任与恢复约定 |
| --- | --- |
| `albumUrl`、`from`、`to`、`sourceIndex`、条目 `url` | 来源身份与读取范围；恢复必须使用原范围，变更范围另用输出文件。 |
| 条目日期、媒体类型、位置、来源说明、读取状态及错误 | 采集器更新；只重读待处理项，成功重读清除旧错误。 |
| `excluded`、`reviewStatus`、其他人工条目字段及 `review` | 维护者更新；重读保留，采集器不确认到访或撤销排除。 |
| `indexedReadComplete`、`readComplete` | 采集器计算索引处理状态；`readComplete` 保持 `false`，不宣称完整时间段已覆盖。 |

Reviewer 核对中断、重读、排除、范围改变和损坏文件这几条恢复路径：来源与未完成项仍可见，人工字段未丢失，完成标记与覆盖证据一致。对应回归已在相册测试中维护；新增行为扩展这些用例。

读取结果可按[私人腾讯候选地点查询](album-tencent.md)交给候选查询工具；发送坐标前仍需匹配当前会话授权与人工排除决定。

恢复演示：先用两个已授权的照片链接执行采集；若第二张读取时浏览器断开，文件中第一张为 `read`、第二张为 `pending-retry`。恢复接管后用完全相同参数再次调用，第一张复用，只继续第二张。`npm run test:album` 中的中断、详情超时重试、时间段外保留及保存故障用例可重复验证此行为。

早期没有 `sourceIndex` 的清单不能证明完整来源范围，工具拒绝覆盖；保留它作为来源证据，使用新的输出文件读取明确提供的链接。真实照片与坐标仍只保存在仓库外，恢复不会代替 POI 核对和三步发布。
