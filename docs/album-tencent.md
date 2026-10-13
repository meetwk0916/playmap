# 私人腾讯候选地点查询

相册的照片核对清单可交给 `scripts/album-tencent.mjs` 的 `queryTencentCandidates` 按需查询。结果只是供维护者核对的候选地点；坐标、原始响应和来源链接都保存在仓库外，不写公开地点、评分或照片。

首次查询前，执行者向维护者说明接收方是腾讯位置服务、拟发送的确切坐标范围和候选 POI 匹配用途。复用会话里已明确覆盖的授权；范围变更只暂停新范围。调用者把可信的会话授权转成 `authorization` 参数，不从相册、清单、缓存或模型推断授权，不让不可信文件自行授予权限。工具审批或浏览器接管暂停仍按原有工具规则处理，不能用辅助工具绕过。

只处理 `mediaType: 'photo'`、`readStatus: 'read'`、有效位置、未排除且链接及坐标完全获准的条目。视频、未知媒体、待重试信息、无位置及未授权条目不发请求。维护者排除决定记录为 `excluded: true` 或 `reviewStatus: 'excluded'`。

在原 Ego TaskSpace 中使用现有 Page，先进入 `http://127.0.0.1:4173/`，读页面已有公开浏览器 Key；不要使用 SecretKey/SK。示例中的批准范围必须来自会话里的真实授权，不能照抄作为授权证据：

```js
const { queryTencentCandidates } = await import('/absolute/path/to/playmap/scripts/album-tencent.mjs');
const browserKey = await page.evaluate(() => new URL(document.querySelector('#tmapSdk').src).searchParams.get('key'));
const result = await queryTencentCandidates({
  page,
  checklist,
  authorization: {
    recipient: 'tencent',
    purpose: 'candidate-poi-matching',
    approved: approvedInThisSession.map(({ url, latitude, longitude }) => ({ url, latitude, longitude })),
  },
  browserKey,
  outputPath: '/absolute/private-directory/tencent-candidates.json',
  repoRoot: '/absolute/path/to/playmap',
});
console.log({ success: result.items.filter(item => item.status === 'success').length,
  blocked: result.items.filter(item => item.status === 'blocked').length,
  pending: result.items.filter(item => item.status === 'pending-retry').length,
  unauthorized: result.items.filter(item => item.status === 'unauthorized').length });
```

每次网络请求只加入位置及腾讯必需的公开 Key、坐标类型、POI 和 JSONP 协议参数，不附照片、来源链接或姓名。使用 `coord_type=1` 让腾讯按 GPS 输入处理；页面位置的来源仍可能未知，这种坐标转换不能证明位置准确或实际到访。候选保留 `provider: 'tencent'` 和 `poiId`，单条查询按该身份去重；相同或相近候选仍须维护者确认。

默认每条最多三次请求，只有 `status: 120` 明确限流才在 1.2 秒、2.4 秒后重试。可提供最多三个、每个不超过 60 秒的退避延迟，尝试上限写入输出。持续限流保留 `pending-retry`；其他错误、权限或授权拒绝、网络错误和超时立即保留 `blocked` 与原因，不自动重试。修复原因后再次显式执行才重新尝试。工具审批拒绝由调用者报告，不能包装成普通限流。

每个响应原子保存到私人文件，权限为 `0600`，拒绝任何 Git checkout 内路径及软链接。重新运行复用相同链接和坐标的成功结果，复用前仍重新核对当前授权、照片类型和排除决定；改变坐标必须获准并重新查询。损坏或不兼容的既有文件报错，保留原文件。重跑应提供原完整清单和同一输出路径，成功结果不需重查；缩小传入清单将缩小当前输出范围，原文件应先备份。

合成检查使用 `npm run test:album`，通过浏览器网络边界拦截腾讯响应，不消耗真实配额。它验证请求内容、授权范围、重试与私人恢复状态；真实域名白名单和在线服务可用性须另行核验。后续内容确认和发布按[到访内容维护](public-places.md)执行。
