# 运行时接口

仅监听回环地址。除 health 外都要求 `Authorization: Bearer <config token>`；请求上限 256 KiB，网络处理在虚拟线程，世界操作调度到 Minecraft 服务端线程。存储 I/O 在独立工作线程。

只保留以下普通接口：GET `/v1/health`、`/v1/ui`、`/v1/worlds`、`/v1/context`；POST `/v1/create-world`、`/v1/open-world`、`/v1/disconnect`、`/v1/scan`、`/v1/access`、`/v1/compare`、`/v1/screenshot`、`/v1/camera/begin`、`/v1/camera/move`、`/v1/camera/restore`。v1 是这些仍有用途的路由路径，不表示支持旧施工 API。

旧 apply/fill/transform/replace/transactions/undo/jobs 路由及其实现已经删除。

0.8 增加 POST `/v1/save-world`（保存但不退出），以及 POST `/v2/redstone`：

- `status`：当前维度的加速状态、世界 tick、红石逻辑 tick、实测吞吐量、软预算和工作线程统计。
- `configure`：`speed:1..256`、`workers:1..16`、`budgetMs:1..40`、`optimizeWires:boolean`。默认仅本次打开世界期间启用。
- `disable`：关闭并将待执行红石事件交还原版区块队列。

施工与加速互斥；正在执行测试时不能切换时钟。加速测试沿用 `/v2/circuits`，其 tick 指红石子步。详细语义及兼容边界见 [红石加速](redstone-acceleration.md)。

## 可选计算机终端

POST `/v2/keyboard` 提供 `status`、`open`、`bind`、`draft`、`write`、`write-run`、`run`、`reset`、`stop`、`step`、`input`、`cancel`、`restore` 和 `speed`。绑定仅保存在对应存档的 `mcarchitect/keyboard.json`，不随安装自动创建。

0.9.1 的 `status` 区分 `bound` 与 `available`；不可用时返回 `reason`，不返回 `live` 或旧历史。`open` 在不可用时返回 `opened:false`，不会显示终端。运行、写入、输入和终端内加速同样核对绑定与实体端点。独立 `/v2/redstone` 不依赖计算机。详见 [计算机终端](computer-keyboard.md)。

## 分区传输与施工

POST `/v2/projects` 是内部传输/施工层，通常由工程部署调用。

- open: `projectId, worldId, dimension, planId, sectionCount`
- upload: `planId, index, data`；data 为不可变分区 JSON 原文
- list / status
- start / resume / pause / rollback；可设置 `tickBudgetMs:0.25..10` 和 `maxBlocksPerTick:1..8192`

分区包含 `x,y,z,palette,runs,statePolicy?,expected?`。坐标是 section 坐标，负数用 floor division。palette[0]=null 表示 KEEP，runs 为交替的 paletteIndex,length，按 X→Z→Y 展开至 4096 格。expected 使用相同编码，仅对有旧设计的目标格设置守卫。

planId 是 SHA-256：`JSON.stringify([projectId,worldId,dimension])+"\n"+sectionHashes.join("\n")`，sectionHash 取原始分区 JSON 的 UTF-8 字节。模板/模块属于客户端源模型，不进入世界线程。

施工快照 before-image 写入 gzip journal 并同步持久化后才改世界。恢复从头按实际状态核对，不能假设进度文件与存档保存同步。一个施工分区持有一个临时工作区块票，完成/暂停释放；区块生成、方块邻接更新的单次成本无法硬性截断。

## 阶段部署

POST `/v2/assemblies`：start 包含 `{id,worldId,dimension,steps:[{name,planId}]}`；其他 action 为 status/pause/resume/rollback，携带 id。

id 为 `SHA256(planIds.join("\n"))`。最多 4096 个非空阶段，阶段目标格必须互不重叠；编译器按最终归属保证这一点，服务端再次检查。串行推进，回滚反向推进。回滚方向用持久标记记录，重启不会丢失。

## 信号测试

POST `/v2/circuits`：start 接收

```text
id: UUID
name, worldId, dimension
bounds: {from:{x,y,z},to:{x,y,z}}
inputs: [{id,position:{x,y,z}}]
probes: [{id,position:{x,y,z},face:"wire|received|north|east|south|west|up|down"}]
events: [{tick,set:{inputId:boolean}}]
assertions: [{tick,probe,min,max}]
durationTicks, sampleEveryTicks
```

status/cancel/restore 携带 id。相同测试 ID 不重复执行刺激；新实验使用新 UUID。records 位于存档 `mcarchitect/tests/<id>`，含 before.json、trace.json、result.json，恢复操作另写 recovery.json。

整个世界只有一个施工/测试写入者。阶段部署持有写入者时，外部不能直接启动它的子施工计划。请求失败或连接断开不代表操作未发生，应按已有 ID 查询。
