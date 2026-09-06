# MC Engineer · Minecraft 建筑 MCP

[English](README.en-US.md) · [安装包](https://github.com/AnctyEnly453/mc-architect-mcp/releases) · [MIT](LICENSE)

让 AI 在 **Minecraft Java 1.21.11** 的单人存档里设计、修改和调试建筑与红石工程。项目原名 MC Architect MCP，仓库地址与 Mod ID `mcarchitect` 保持不变。

**当前版本：0.9.1。普通存档可以直接使用，不需要预先放置红石计算机。**

## 有什么功能

- 用有名字的模块组织建筑，支持局部坐标、嵌套、旋转和模板复用。
- 在本地预览设计，比较改动，只施工需要改变的方块。
- 按阶段和区块后台施工，支持暂停、重启恢复、冲突检查与日志回滚。
- 扫描地形、方块、碰撞和照明，检查普通玩家的通行路线。
- 临时旁观相机、截图验收，以及玩家视角恢复。
- 红石输入序列、真实信号采样、断言和波形调试。
- 可选的独立红石加速与多线程粉线网络计算。
- 可选的实体红石计算机终端，仅在当前世界存在有效绑定时开放。

大块设计保存在本地 JSON，MCP 返回模块摘要、施工状态和文件路径。世界读写由 Fabric Mod 执行；离线预览不模拟红石。

## 安装

需要 **Minecraft Java 1.21.11、Fabric Loader 0.18.6+、Fabric API 0.141.3+1.21.11、Java 21+、Node.js 22+**。

1. 从 [Releases](https://github.com/AnctyEnly453/mc-architect-mcp/releases) 下载 `mcarchitect-0.9.1.jar`，和匹配的 Fabric API 一起放进游戏实例的 `mods` 目录。替换旧版 Mod 后重启游戏。
2. 克隆本仓库，在 `bridge` 目录安装并构建 MCP：

   ```text
   git clone https://github.com/AnctyEnly453/mc-architect-mcp.git
   cd mc-architect-mcp/bridge
   npm ci
   npm run build
   ```

3. 启动游戏并打开需要编辑的单人存档。首次启动会生成该游戏实例的 `config/mcarchitect.json`。
4. 在 MCP 客户端中配置以下入口，将路径换成自己的安装位置：

   ```toml
   [mcp_servers.mcengineer]
   command = "node"
   args = ["D:/minecraft/mc-architect-mcp/bridge/dist/index.js"]

   [mcp_servers.mcengineer.env]
   MCA_CONFIG = "D:/MinecraftInstance/config/mcarchitect.json"
   ```

`MCA_CONFIG` 指向游戏实例的配置文件，不是存档文件。未设置时使用系统默认 `.minecraft/config/mcarchitect.json`。Mod 只监听 `127.0.0.1` 并使用随机 Token 认证；不要上传本机配置文件。

也可以从源码构建 Mod：在 `mod` 目录运行 Windows 的 `.\gradlew.bat build` 或 Linux/macOS 的 `./gradlew build`。JAR 位于 `mod/build/libs/`。

## MCP 工具

| 工具 | 用途 |
|---|---|
| `mc_world` | 世界身份、存档列表、创建/打开/关闭/保存、游戏 tick rate |
| `mc_workspace` | 创建工程、模块树、端口、修订历史、交互预览 |
| `mc_edit` | 修改或移除模块、导入设计、恢复源文件版本 |
| `mc_build` | 增量计划、部署、进度、暂停、恢复、回滚 |
| `mc_inspect` | 地形、方块状态、碰撞、照明与通行检查 |
| `mc_camera` | 临时相机、移动、截图、恢复玩家视角 |
| `mc_test` | 红石输入、信号断言、输入恢复与波形 |
| `mc_redstone` | 独立红石加速、粉线优化和实际吞吐统计 |
| `mc_keyboard` | 已绑定实体计算机的程序输入与实时读数 |

通常从 `mc_world context` 开始，用返回的世界身份创建工程。设计分成命名模块，先规划和预览，再部署并查询状态。建筑用游戏截图和通行检查验收，红石电路用真实信号测试验收。

## 没有红石计算机的存档

建筑功能不依赖计算机，安装也不会自动生成计算机或复制演示存档。

- 未绑定时按 F8 只显示简短提示，不弹出电脑操作面板。
- 当前存档和维度匹配、绑定的按钮/拉杆与红石探针均可用时，才打开终端。
- 区块未加载或元件缺失时，隐藏读数并禁用操作，不把缺失信号显示为 0。
- F8 可以在游戏按键设置中修改。它只控制计算机终端，建筑由 MCP 工具操作。

终端支持 `LDI`、`ADD`、`IN`、`OUT`、`HLT`，最多 8 条指令。它通过真实按钮写入实体 RAM，不能在软件里代算一台电脑。已有兼容电路的开发者可按 [绑定与端口说明](docs/computer-keyboard.md) 接入自己的布局。

## 红石加速

独立红石加速不需要计算机绑定，默认关闭。拥有游戏命令权限时可输入：

```text
/mcengineer redstone 128 8
/mcengineer redstone status
/mcengineer redstone off
```

`128` 是每游戏 tick 的红石子步上限，`8` 是工作线程数；实际速度取决于负载与预算。世界和实体保持原来的时间速度。依赖更新顺序的线路、活塞等机械装置需要另外验证。详见 [红石加速](docs/redstone-acceleration.md)。

## 示例与开发

`bridge/examples/signal-bus/` 提供一个模块化四位总线及测试套件。先把 `workspace.json` 中的 `worldId` 换成当前世界身份，并选择合适的 `origin`。在 `bridge/` 下创建本地工程和预览：

```text
npm run workspace -- create /path/to/my-bus examples/signal-bus/workspace.json
npm run workspace -- plan /path/to/my-bus
npm run workspace -- preview /path/to/my-bus
```

预览不会修改世界。该总线是工作流示例，不是已认证的电路元件库。开发检查为 `bridge/` 下的 `npm test`，以及 `mod/` 下的 `gradlew check`；CI 同时验证两端。

## 从 0.5 升级

0.7 起使用新的命名工程与模块工作流，**不兼容 0.5 的 32 个工具、原子蓝图接口和旧施工脚本**。请同时更新 Mod 与 Bridge，在客户端重新加载 MCP 工具。旧示例保留在 Git 历史中，新版使用 `mc_workspace`、`mc_edit` 和 `mc_build`。

新的部署日志不会接管旧版本的撤销记录。已有世界可继续打开，但需要为后续工程建立新的本地工作区。Mod ID 与认证配置文件名仍然是 `mcarchitect`。

## 边界与文档

施工支持普通方块及方块状态，不提供容器/NBT 批量编辑、自动布线或 CPU 综合。回滚恢复该次施工实际修改前的方块，不恢复实体、流体或电路内部运行历史。施工预算是软上限，不能保证整个游戏不掉帧。

[工程格式与恢复](docs/workspace.md) · [本地接口](docs/protocol.md) · [计算机终端](docs/computer-keyboard.md) · [更新记录](CHANGELOG.md)
