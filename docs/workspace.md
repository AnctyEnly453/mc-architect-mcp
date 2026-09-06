# 工程、模块与电路

## 源文件

```json
{
  "format": "mcengineer/workspace/1",
  "projectId": "computer",
  "name": "红石计算机",
  "worldId": "从 mc_world context 获取",
  "dimension": "minecraft:overworld",
  "origin": {"x": 0, "y": 64, "z": 0},
  "statePolicy": "redstone",
  "stages": [
    {"id": "support"},
    {"id": "logic", "dependsOn": ["support"]},
    {"id": "controls", "dependsOn": ["logic"]}
  ],
  "templates": {},
  "modules": [],
  "connections": []
}
```

示意中的 worldId 必须替换成实际值。ID 使用 ASCII 字母、数字、下划线和连字符；projectId 另允许点。名字可以中文。

模块字段：`id`、`name`、`kind`（自由分类）、可选 `parent`、可选 `template`、`offset`、`rotation`（0/90/180/270）、`stage`、`operations`、`ports`。默认阶段为 `main`，默认工程阶段也为 `main`；自定义阶段时应为有操作的模块指定有效阶段。

每项操作是 `{from:{x,y,z},to:{x,y,z},block:"minecraft:...",stage?:"logic"}`。坐标相对模块；父模块变换先组合，最终再加工程 origin。模板提供 operations 和 ports，实例可追加自身操作；同名端口不允许覆盖。

旋转同时改变几何、朝向、轴、四向连接键和端口方向。源顺序决定同阶段重叠格子的最终状态；不同阶段按依赖排序。每格只属于最后生效的阶段。空白格保留世界，显式 `minecraft:air` 清除世界。

需要圆弧、穹顶、楼梯或盒体时，可从 `bridge/dist/geometry.js`、`bridge/dist/boxes.js` 生成 operations 放入模块；这些是离线几何函数，不是另一条世界写入通道。

## 修改与部署

工程目录保存 `HEAD.json` 和不可变 `revisions/*.json`，修改需要当前 `expectedRevision`。`mc_edit module` 用一个模块 JSON 替换该模块；`source` 导入完整新设计，适合统一修改模板或连接。`restore` 新建一个内容等于旧版本的修订，不会直接撤销世界。

`mc_build plan` 对比当前版本和 `DEPLOYED.json` 指向的最后完成版本，计算最终方块差异。移走模块会清理旧位置；移除覆盖模块会显露下面仍存在的模块。待替换/清除格子附带原设计状态守卫，防止覆盖玩家后来的修改。新位置没有旧设计守卫，会记录施工当时的 before-image。

`mc_build deploy` 上传所有分区，再启动 Mod 内的阶段执行。`plan`/`deploy` 的 MCP 调用立即返回后台工作状态，用 `status` 查询。命令行版本等待准备/上传完成，施工仍由 Mod 自行推进。

修改源文件后不能部署旧预览；需重新规划。运行中的部署必须先完成或回滚，才能规划下一次修改。查询到远端完成后才更新 DEPLOYED，不能靠提交请求成功推断完成。

恢复操作：

| 情况 | 操作 |
|---|---|
| 上传中断 | 对同一工程重试 `deploy` |
| 已启动但响应丢失 | 查 `status`；必要时 `resume`，不会生成另一份工程 |
| 游戏退出/施工暂停 | 打开同一存档和维度，`resume` |
| 状态冲突 | 查当前 section 和错误，确认外部修改；不要新建计划绕过冲突 |
| 放弃本次部署 | `rollback`；按反向阶段恢复日志中的 before-image |
| 回滚途中中断 | `resume` 会继续回滚，不改回正向施工 |

回滚完成的部署不能重新正向执行。再次 `plan` 会生成新的部署身份。没有变化的计划可完成为一次源版本更新，不写世界。

`revisions/*.json` 是带元数据的修订封装，实际设计在 `source` 字段。不要把整个修订文件当源文件导入。`mc_workspace module` 可取得单个模块供编辑。

锁文件 `.workspace.lock` 防止并行进程改同一工程。进程意外退出时，先确认文件记录的 PID 已退出，再移除这一个锁文件；不要删除 HEAD、DEPLOYED 或部署目录来“恢复”。

## 红石端口与调试

端口：`{id,kind,positions,facing?,sample?}`。kind 为 `input`、`output`、`probe` 或 `anchor`。引用为 `模块ID.端口ID`。positions 的第 0 项是最低有效位；1–64 个坐标表示单信号或总线。

输入端口指向已有拉杆或按钮。按钮的 true 事件调用原版按下行为，按原版时长自动弹起；false 可提前释放。它不是持续电平源。输出/探针的 sample 可用 `wire` 读取红石粉自身 power，`received` 读取该格收到的最强邻接信号，或六个方向读取原版方向信号 API。方向随模块旋转。默认 received，读取导线通常显式选 wire。

施工支持比较器。比较器内部的输出强度属于运行时信号，不作为 NBT 快照保存；编辑后需让电路稳定或复位。其他方块实体仍受保护，不支持容器或自定义 NBT 的批量放置与覆盖。

connections 是 `{id,from:"a.out",to:"b.in"}` 的逻辑契约，检查端口存在和宽度；不放置电线，不保证实际导通。物理连线属于工程模块；功能测试才检查信号。

套件例子：

```json
{
  "name": "写入 5 后读取",
  "inputs": ["bus.data"],
  "probes": ["bus.out"],
  "events": [{"tick": 0, "set": {"bus.data": 5}}],
  "assertions": [{"tick": 4, "port": "bus.out", "equals": 5}],
  "durationTicks": 8,
  "sampleEveryTicks": 1
}
```

值可为安全整数、单比特 boolean 或低位在前的 boolean 数组。整数最大为 JavaScript 安全整数，更宽的总线用数组。逻辑 0 对应强度 0，逻辑 1 对应 1–15；这不是模拟量精确断言。

事件在服务端 Tick 末尾执行，随后采样；Tick 0 切换后立刻读到的结果不代表多级电路已稳定。为组合逻辑传播、寄存器时钟和复位留出明确 Tick。套件中的 Tick 是游戏 Tick，不是“红石 Tick”，也不是墙钟毫秒。不会用 HTTP 连续发包假装精确时序。

最多 48000 游戏 Tick，定期采样最多 6001 帧（长程序请增大 sampleEveryTicks）、4096 个事件、展开后 4096 个位断言。默认测试区域是整个工程包围盒；超大工程应指定 `bounds:{from,to}`，覆盖被测模块内部及线路，而不只是端点。测试区最多覆盖 384 个区块，临时模拟票还会加载周边必要区块。

施工与调试互斥；暂停施工后才开始测试。输入原始状态先落盘，再切换拉杆。结束/取消后恢复全部能安全恢复的输入；结构被外部改动的输入报冲突。退出世界时保留恢复文件，用 `mc_test restore` 恢复输入。测试并不回滚内部存储器、活塞、实体或随机状态；计算机要设计显式复位协议。

`status` 返回失败断言、最近采样和 tracePath。`mc_test waveform` 的 sourcePath 指向实际 `trace.json`，生成可查看采样值的波形。没有断言的采样不会标为 passed。

`statePolicy:redstone` 放宽自动变化的 powered/lit/locked、红石粉 power 与四向连接状态。中继器朝向/延迟、比较器模式及块类型仍检查。粉线形态正确性交给实际信号测试；需要强制点线形态时使用 exact 并自行安排放置顺序。不要在施工时启动自由运行时钟。
