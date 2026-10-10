# DVI Insights 0.4.5

By SIKAer · [MIT](https://github.com/SIKAdeerMX/dvi-insights/blob/main/LICENSE) · [Privacy](https://github.com/SIKAdeerMX/dvi-insights/blob/main/PRIVACY.md)

## 中文介绍

DVI信息增强为 Deep Vein Idle 补充经验、材料、时间与收支信息，沿用游戏面板和主题配色。

- 工作列表显示 XP/h 和期望日利，展开后计算目标等级的工作次数、耗时与材料缺口。
- 当前任务显示期望日利与每天收入；普通战斗补充 EPH、食物续航和有效药水时间。
- 物品提示补充求购、挂售和商人价格；买入缺价时可参考已接收的公开历史成交与一天内的报价缓存。
- 离线总结汇总掉落产值、金币变化与材料、食物、药水成本。有完整离线前记录时显示净收益。
- 自动跟随游戏的中文 / English 设置，适配浅色与深色主题。
- 右侧快捷栏提供 Alice战斗模拟器入口，点击后在新标签页打开。
- 数字使用 K/M/B；中文收支速率为金币/d，英文为 coins/d，经验为 XP/h。

在 Tampermonkey 中安装脚本后刷新游戏。已有测试版用户请用新版全部内容覆盖旧脚本，不同时运行两份。离线净收益需要安装后留下离线前快照；缺价或消耗记录不全时保留产值，不把未知成本当成零。

脚本进行被动读取和本地计算，不增加游戏请求，不自动工作、喝药、交易或修改队列。市场价格随已收到的数据更新；`≈` 表示估价。种植预测目前采用单田模型，普通战斗使用实测速率与概率期望，首领战和强化目标尚未支持。

作者 SIKAer，MIT 开源。这是社区工具，与 Deep Vein Idle 官方没有隶属关系。游戏名称、机制数据及原有界面素材的权利归各自权利人。隐私与本地缓存说明见随附 [PRIVACY.md](https://github.com/SIKAdeerMX/dvi-insights/blob/main/PRIVACY.md)。

## English description

DVI Insights adds XP, material, time and income information to Deep Vein Idle's existing interface, using the game's theme colors.

- Work rows show XP/h and estimated daily profit. Expand a row to plan attempts, time and required materials for a target level.
- The active task shows expected daily profit and daily income. Normal combat also includes EPH, food endurance and active potion durations.
- Item tooltips show buy offers, sell listings and merchant prices. Received public trade history and cached asks from the last day can help estimate missing purchase prices.
- Away summaries value item drops and coins, deducting materials, food and potion costs when a matching pre-away snapshot is available.
- Automatically follows the game’s English / Chinese language setting and light / dark theme.
- A sidebar shortcut opens Alice Combat Simulator in a new tab.
- Compact K/M/B numbers, coins/d income rates and XP/h experience rates.

Install with Tampermonkey, then reload the game. If updating a test version, replace its entire contents rather than running both copies. Offline net accounting needs a snapshot captured after installation. Missing costs are not treated as zero.

The script passively reads already-received data and performs calculations locally. It does not make extra game requests, automate gameplay or modify task queues. Prices depend on received quotes; `≈` marks estimates. Farming planning currently uses a single-field model. Normal combat uses measured rates and expected loot; boss combat and enhancing plans are not supported.

By SIKAer, licensed under MIT. An independent community tool, not affiliated with Deep Vein Idle. Game names, mechanism data and original interface assets remain the property of their respective owners. See [PRIVACY.md](https://github.com/SIKAdeerMX/dvi-insights/blob/main/PRIVACY.md) for local storage details.

