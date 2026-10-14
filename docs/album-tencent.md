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

默认每次显式调用对每条最多发出三次请求，只有 `status: 120` 明确限流才在 1.2 秒、2.4 秒后重试。可提供最多三个、每个不超过 60 秒的退避延迟，本次调用的尝试上限写入输出。持续限流保留 `pending-retry`；其他错误、权限或授权拒绝、网络错误和超时立即保留 `blocked` 与原因，不自动重试。修复原因后再次显式执行才重新尝试，历史响应和累计尝试数继续保留。工具审批拒绝由调用者报告，不能包装成普通限流。

每个响应原子保存到私人文件，权限为 `0600`，拒绝任何 Git checkout 内路径及软链接。重新运行复用相同链接和坐标的成功结果，复用前仍重新核对当前授权、照片类型和排除决定；改变坐标必须获准并重新查询。损坏或不兼容的既有文件报错，保留原文件。

`items` 只代表当前传入清单的查询状态；私人 `queryHistory` 按来源链接和坐标保留成功、待重试、受阻查询及其全部响应，也保留已进入查询范围但尚未发出请求的条目。缩小、清空清单或临时撤回授权、排除条目都不会删除这份历史。当前未获准或被排除的条目不展示历史候选且不发请求；恢复符合要求的授权与条目后，成功结果直接复用，未完成查询由再次显式调用重新尝试并追加响应。`maxAttempts` 是每次调用的请求上限，条目的 `attempts` 是累计已保存响应数量。

既有版本 1 文件缺少 `queryHistory` 时，从当前条目的实际查询进度及旧 `successfulQueries` 缓存补入；历史损坏时保留文件并报错。历史只是私人查询证据，不能授予授权、取消排除或证明到访。

## 状态归属与恢复审查

| 数据 | 更新责任与边界 |
| --- | --- |
| `authorization`、照片类型、读取状态和人工排除 | 当前调用的准入条件；历史记录不能替代当前授权或撤销排除。 |
| `items` | 当前清单的可见结果；未获准或被排除的条目没有候选、没有请求。 |
| `queryHistory` | 按链接与坐标保存实际查询进度；保留成功、受阻、待重试和尚未尝试的工作。 |
| `responses`、`attempts`、`maxAttempts` | 响应与次数累计保存；每次显式执行仍有独立的请求上限。 |

| 场景 | Reviewer 应核对的结果 |
| --- | --- |
| 缩小或清空当前清单 | 当前结果随清单变化，历史中的成功和未完成工作均保留。 |
| 撤回授权或排除条目 | 停止请求并隐藏当前候选，历史不丢失。 |
| 恢复原范围和有效授权 | 成功结果复用；未完成项只在显式执行时继续，响应追加保存。 |
| 改变坐标 | 重新匹配授权及查询身份，原坐标历史保留。 |
| 浏览器中断、损坏文件或保存失败 | 已完成结果和未完成来源保留；无法安全读取或保存时报告阻塞。 |

审查同时覆盖成功、失败、待重试和尚未尝试四类进度，以及采集重读后的人工排除标记。现有相册回归覆盖这些场景；改变恢复行为时更新对应测试。

合成检查使用 `npm run test:album`，通过浏览器网络边界拦截腾讯响应，不消耗真实配额。它验证请求内容、授权范围、重试与私人恢复状态；真实域名白名单和在线服务可用性须另行核验。后续内容确认和发布按[到访内容维护](public-places.md)执行。
