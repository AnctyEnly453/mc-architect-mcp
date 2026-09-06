# 集成计算机键盘

这是可选的实体红石计算机终端，安装 Mod 不会生成计算机，也不会给普通存档自动添加绑定。

只有当前存档、当前维度的绑定有效，且绑定的控制元件和信号探针已加载、仍然存在时，按 F8 才会打开操作面板。未绑定的世界只显示一条提示，不打开空面板；建筑、施工、相机和独立红石加速照常使用。计算机区块未加载时，请靠近后重试。

窗口不会暂停世界；程序草稿随存档保存。打开后若绑定失效、元件缺失或区块卸载，面板隐藏读数并禁用写入和运行，不会把缺失信号显示成 0。

输入最多 8 条指令，支持十进制或 `0x` 十六进制的 0–255。空余位置填 HLT。

```text
LDI 5
ADD 3
OUT
HLT
```

点击“写入并运行”，这段程序应输出 8。LDI 装载常数，ADD/ADDI 加立即数，IN 读取实体输入总线，OUT 保存输出，HLT 停机。

“写入”逐行按下实体地址、操作码、高位和低位按钮，再按 STORE，并校验实体 RAM。过程中请等待进度结束。“取消 / 恢复”恢复操作前的控制输入；已写入的 RAM 内容仍保留。

“可视化演示”读取真实电路上的 PC、指令、输入、ACC、OUT、HALT 和 CLK。“单步时钟”先把实体地址选择切到当前 PC，再完整脉冲一次时钟。“慢速观察 / 快速运行”仅改变红石速度；近期 CLK 图按信号变化记录，并非等间隔采样波形。

快捷键：F5 从复位开始运行，Ctrl+Enter 写入并运行，Ctrl+V 粘贴多行程序。F8 可在游戏按键设置中重新绑定。

开发或更换实体布局后，在 `bridge/` 目录运行：

```text
node scripts/bind-keyboard.mjs /path/to/computer-workspace
```

该命令仅为已经建好的兼容计算机记录绑定，不创建方块、不写入程序。可选的第二个参数是程序文本文件，用于初始化编辑器内容。

兼容布局必须提供以下工程端口；各多位端口的位置从最低位开始排列：

| 端口 | 位数 / 编号 |
|---|---|
| `cpu.run`、`cpu.manual`、`cpu.reset`、`cpu.view`、`cpu.store`、`io.carryIn` | 各 1 位拉杆或按钮输入 |
| `key_hi_N.press`、`key_lo_N.press` | N 为 0–15，各 1 位按钮输入 |
| `key_addr_N.press` | N 为 0–7，各 1 位按钮输入 |
| `key_op_N.press` | N 为 0–4，对应 LDI、ADD、OUT、HLT、IN |
| `cpu.pc`、`cpu.opcode`、`terminal.address` | 各 3 位红石粉探针 |
| `cpu.out`、`io.qA` | 各 8 位红石粉探针 |
| `cpu.clock`、`cpu.halt` | 各 1 位红石粉探针 |
| `terminal.entry`、`terminal.read` | 各 11 位红石粉探针 |

绑定记录世界身份、维度和物理坐标，不能把其他存档的 `keyboard.json` 直接拿来使用。Mod 不在软件中代算 CPU，也不支持任意红石电脑的自动识别。认证与其他 MC Engineer 工具一致。

`mc_keyboard status` 返回 `bound`（是否存在配置）、`available`（当前是否可操作），不可用时提供 `reason` 且不返回虚构的 `live` 数据。`open` 在不可用时返回 `opened: false` 和原因。独立红石加速使用 `mc_redstone` 或 `/mcengineer redstone`，不需要计算机绑定。
