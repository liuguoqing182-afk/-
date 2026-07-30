# AIMirror 首屏配置巡检

面向维护者和其他 AI 的完整设计总结、实现边界与跨项目复用方法见：[AM首屏配置巡检系统总结与跨项目复用指南.md](./AM首屏配置巡检系统总结与跨项目复用指南.md)。

系统通过飞书应用机器人的 WebSocket 长连接接收发布通知，然后自动执行：

1. 解析“`AIMirror首屏配置发布成功!`”及声明的变更。
2. 拉取 DEV、PRO 的 `/config/v4` 和对应模型目录。
3. 比较 PRO 发布前后变化，并核对发布声明。
4. 检查 DEV/PRO 差异和本次变更资源 URL。
5. 把简要结论回复到发布群，详细 JSON 保存在 `data/reports/`。

## 首次运行

需要以下用户环境变量：

```text
FEISHU_APP_ID
FEISHU_APP_SECRET
FEISHU_CHAT_ID（正式发布群）
FEISHU_TEST_CHAT_ID（测试群）
AM_INSPECT_UID
```

安装和启动：

```powershell
npm install
npm run listen:feishu
```

控制台出现 WebSocket 已连接后，在飞书开发者后台进入：

```text
开发配置 → 事件与回调 → 事件配置
```

选择“使用长连接接收事件”，添加事件 `im.message.receive_v1`。权限管理中至少申请：

- 普通用户消息：`im:message.group_msg`，或只收 @ 消息的 `im:message.group_at_msg:readonly`。
- 发送巡检报告：`im:message:send_as_bot`。
- 其他机器人消息：发送方必须 @ 本机器人，并申请 `im:message.group_at_msg.include_bot:readonly`。

最后创建并发布应用版本，再把应用机器人加入目标群。

## 正式群与测试群

- `FEISHU_CHAT_ID` 是正式发布群。只有该群中包含 `AIMirror首屏配置发布成功!` 的通知会执行正式巡检。
- `FEISHU_TEST_CHAT_ID` 是测试群。发送 `@机器人` 或 `@机器人 状态` 会收到在线自检回复；发送 `@机器人 + 完整发布通知` 会执行完整的测试巡检。
- 测试巡检使用 `AM_INSPECT_TEST_DATA_DIR`（默认 `data-test`）中的独立基线、备份和报告。首次创建时从正式巡检保存的上一版本基线克隆，之后独立更新，不会修改正式群的 PRO 基线。

> `im:message.receive_v1` 不包含其他机器人发送的消息。若发布平台机器人不 @ 巡检机器人，可以使用下方的历史消息只读轮询；若历史消息接口也无法返回发布机器人的消息，再使用发布平台主动 Webhook。

## 正式群历史消息只读轮询

轮询器使用飞书“获取会话历史消息”接口读取 `FEISHU_CHAT_ID` 对应的正式群。启动时立即读取最近一小时，之后默认每隔一小时读取上次成功检查点到当前时间的消息；每次向前重叠一分钟，避免时间边界漏消息。接口分页会全部读取，成功后把检查点原子写入：

```text
data/feishu-history-poller-state.json
```

飞书卡片 Markdown 格式清理后，只有正文以 `AIMirror首屏配置发布成功!`（也兼容中文感叹号）开头的消息才会被识别。新候选会先完整解析发布声明，再调用正式 `ReleaseMonitor` 执行 DEV/PRO、PRO 发布前后、资源 URL 和已知差异巡检，并把报告文件写入 `AM_INSPECT_DATA_DIR`。

发布候选按飞书 `message_id` 持久化去重，状态默认保存在 `data/feishu-history-processed-message-ids.json`。同一条消息即使被重叠时间窗口再次读取或轮询进程重启，也不会重复交给后续巡检；候选处理失败时不会写入已处理状态，以便下一轮重试。

巡检在发布消息时间达到 `AM_PUBLISH_SETTLE_MS`（默认 8 秒）后开始。解析不完整、基线初始化失败或巡检接口异常时，本轮不会推进消息处理状态和轮询检查点；巡检得到“通过”或“不通过”的完整结论都视为已完成，不会重复执行。

当前验证阶段，巡检报告只发送到 `FEISHU_TEST_CHAT_ID`，启动时会强制校验它不能等于正式群 `FEISHU_CHAT_ID`。报告在巡检完成后先持久化到 `data/feishu-history-report-outbox.json`，再由智能牛马发送；发送失败时保留为待发送状态，下一轮只重试发报告，不会重复执行巡检。正式群报告投递暂未启用。

Windows 测试观察期使用计划任务 `AIMirror-AM-Config-History-Poller-Test`，系统开机且网络可用后自动启动（无需用户登录），启动后立即轮询一次，随后默认每小时轮询。任务使用 S4U 用户身份读取用户级环境配置；启动入口为 `scripts/run-history-poller-task.ps1`，管理员注册入口为 `scripts/register-history-poller-startup-task.ps1`。运行日志分别写入 `feishu-history-poller-task.log`、`feishu-history-poller.stdout.log` 和 `feishu-history-poller.stderr.log`。

权限审批完成后先执行一次只读验证：

```powershell
npm run poll:feishu-history -- --once
```

确认能够读到发布机器人的消息后，再持续运行：

```powershell
npm run poll:feishu-history
```

默认配置：

```text
FEISHU_HISTORY_POLL_INTERVAL_MS=3600000
FEISHU_HISTORY_INITIAL_LOOKBACK_MS=3600000
FEISHU_HISTORY_OVERLAP_MS=60000
FEISHU_HISTORY_POLL_STATE_PATH=data/feishu-history-poller-state.json
```

轮询需要 `FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_CHAT_ID`，并要求智能牛马在正式群内且应用已获批“获取群组中所有消息”权限。接口失败时不会推进检查点，下一小时会继续补读。

## 基线说明

监听器首次启动会把当前 PRO 配置保存为 `data/pro-baseline.json`。它必须在下一次发布前保持运行，收到发布通知后才有“发布前”和“发布后”两份配置可比较。

国际化新增声明目前可以识别，但 `/config/v4` 一次只返回一个语言，本阶段会明确标记为待接多语言接口核验，不会冒充已检查。

## 已知差异基线

首次启用时，系统会把当时已有的 DEV/PRO 差异和 PRO 缺失模型引用写入 `data/known-differences.json`。后续判定规则是：

- 已知差异继续存在：展示但不拦截。
- 已知差异被修复：报告为已解决，不拦截。
- 出现新的 DEV/PRO 差异或新的缺失引用：巡检不通过。
- 发布声明不一致或变更资源 URL 失败：仍然直接不通过。

基线不会自动吸收巡检中新出现的问题，避免同一个新问题在第二次检查时被自动放行。

## DEV/PRO 配置备份

首次启用会立即读取并归档当前 DEV、PRO 数据。每份备份包含：

- `/config/v4` 原始响应。
- `model_url` 返回的完整模型目录。
- 标准化配置快照。
- 缺失模型引用明细、查询时间和请求地址。

当前版本指针保存在 `data/current-environment-backup.json`，不可变历史版本保存在 `data/backups/`。每次发布报告目录中的 `environment-backups.json` 会记录发布前和发布后两个归档路径，发布检查是否通过都不会影响备份保存。

## Windows 登录自动启动

计划任务名称为 `AIMirror-AM-Config-Inspector`，登录 Windows 后自动运行 `scripts/run-listener-task.ps1`。脚本从当前用户环境变量读取配置，不会把 App Secret 写入任务命令；若监听器已经运行，会直接退出以避免重复进程。

查看任务：

```powershell
Get-ScheduledTask -TaskName 'AIMirror-AM-Config-Inspector'
```

查看启动日志：

```powershell
Get-Content .\feishu-listener-task.log -Tail 30
```

## 主动发布 Webhook 接收端

主动 Webhook 与现有飞书 `@机器人` 监听器相互独立。接收端负责请求验签、事件校验、`event_id` 去重和磁盘持久化排队；同进程 Worker 随后执行巡检并把报告发到正式群，不会改动现有监听入口。

启动前设置至少 32 字节的共享密钥：

```powershell
$env:AM_WEBHOOK_SECRET='由发布平台与巡检服务共同保存的随机密钥'
npm run serve:webhook
```

Worker 默认启用，还需读取 `FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_CHAT_ID` 和 `AM_INSPECT_UID`。联调时可用 `AM_WEBHOOK_FEISHU_CHAT_ID` 临时指定测试群；正式运行应设为正式群。Webhook 收到发布成功事件后会立即验签落盘，并等待发布时间满 10 分钟再执行巡检，为后端配置上线预留传播时间；该延迟可用 `AM_WEBHOOK_SETTLE_MS` 调整。巡检最多重试 3 次，飞书报告最多重试 5 次，成功巡检的结果会先持久化，飞书重试不会重复推进 PRO 基线。

默认只监听本机 `127.0.0.1:8787`，接口为：

```text
POST /api/v1/webhooks/home-config-published
GET  /healthz
```

签名请求头：

```text
X-AM-Timestamp: Unix 秒时间戳
X-AM-Delivery-ID: 与请求体 event_id 相同
X-AM-Signature: sha256=<HMAC-SHA256十六进制摘要>
```

签名原文按以下顺序拼接，并且必须使用尚未解析的原始 JSON 请求体：

```text
timestamp + "\n" + delivery_id + "\n" + raw_body
```

请求体格式：

```json
{
  "event_type": "am.home_config.published.v1",
  "event_id": "evt-20260721-00000001",
  "release_id": "AM-20260721-001",
  "published_at": "2026-07-21T19:00:00+08:00",
  "operator": "user@riverolls.com",
  "source_environment": "DEV",
  "target_environment": "PRO",
  "status": "success",
  "notification_text": "AIMirror首屏配置发布成功!\n操作人: user@riverolls.com\n发布环境: 从DEV发布到PRO"
}
```

首次事件验签并落盘后返回 `202`；相同 `event_id` 和内容再次投递返回 `200` 且标记为重复；同一 `event_id` 携带不同内容返回 `409`。超过五分钟、签名错误或请求被篡改均返回 `401`。

主动入口使用独立目录：

```text
data-webhook/queue/jobs/   已验签的持久化任务
data-webhook/inspection/   主动巡检的独立基线、备份和报告
```

任务状态会依次经过 `QUEUED`、`PROCESSING`、`REPORT_PENDING`/`REPORTING`，最后进入 `COMPLETED` 或 `FAILED`。进程重启会自动恢复中断的巡检或报告任务；相同 `event_id` 完成后再次投递只返回重复结果，不会再次巡检或发送报告。

Windows 登录自动启动可使用 `scripts/run-webhook-task.ps1`，建议注册为计划任务 `AIMirror-AM-Config-Webhook`。该脚本只从当前用户环境变量读取密钥，不把密钥写进任务命令或日志。

完整 HTTPS 联调需显式运行 `scripts/run-webhook-integration.mjs`。它会验证首次 `202`、重复事件 `200`、错误签名 `401`、错误签名不落盘、Worker 完成状态和飞书 `message_id`；该脚本不会被日常 `node --test` 自动执行。

本服务自身只提供 HTTP；正式环境应通过公司网关或反向代理提供 HTTPS，不要直接把本地端口暴露到公网。
