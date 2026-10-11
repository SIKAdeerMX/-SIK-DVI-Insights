# [SIK] DVI Insights 0.4.22

By SIKAer · [MIT](https://github.com/SIKAdeerMX/-SIK-DVI-Insights/blob/main/LICENSE) · [Privacy](https://github.com/SIKAdeerMX/-SIK-DVI-Insights/blob/main/PRIVACY.md)

## 中文介绍

系列组件：[SIK] DVI信息增强负责信息与规划，[[SIK] 动态DVI](https://greasyfork.org/zh-CN/scripts/599633-sik-dynamic-dvi) 负责原版装备的本地动作显示，两个脚本可同时使用。

[SIK] DVI信息增强为 Deep Vein Idle 补充经验、材料、时间与收支信息，沿用游戏面板和主题配色。

- 工作列表显示 XP/h 和期望日利，点击“升级计算”查看目标等级的工作次数、耗时与材料缺口；收支只用箭头展开。
- 当前任务依次显示每天收入、期望日入、期望日利；期望日入为未扣消耗的期望产值。每天收入超过期望日入时显示金色光晕。普通战斗补充 EPH、食物续航；药水默认收成一行，点击展开时长。
- buff 弹层对齐名称、时间轴和剩余时长，保留未生效的灰色图标；药水显示当前生效品质的单瓶价格。饱食与扎根直接显示续 24 小时最省钱的食物、品质及日成本，名称后直接显示续一天的购买数量，不附单位。
- 选怪列表显示连续单怪期望日利和 XP/h，另列食物、药水成本。首领窗支持拖动、方向键移动和复位；伤害榜突出榜首大数字、领先幅度和个人一行，贡献条相对榜首，前三名采用现代数字字标。补给默认收起，顶部加入／显示入口统一按钮样式。首领开战播放 6 秒全屏烟花，Esc 可收起，鼠标操作不受阻挡。
- 物品提示补充求购、挂售和商人价格；买入缺价时可参考已接收的公开历史成交与一天内的报价缓存。
- 仓库和市场“我的物品”显示一个整堆估值，按税后求购和商人价计算；一个按钮按价值排序，重复点击保持排序，仓库锁定物品保持原位。市场同类物品按各品质分别计价后汇总；仓库按钮和数量操作区统一棕金样式。
- 农田采用紧凑状态格；公会用升级箭头、进度百分比和缺口表达升级与成员名额；贡献使用 K/M/B 和同列比例条，日志采用时间线，公会列表保留原生图标并显示序号与名额使用情况。公会仓库操作保留。
- 公会恢复原来的按钮、等级徽章、公告纸和奖励架呈现。公告、规则与招募默认阅读，原生保存确认后退出编辑，草稿只在页面内存保留。三种世界首领各用一套中英文名称艺术字：矿脉巨像为矿晶、霜冻利维坦为冰霜、余烬飞龙为余烬主题，仅三处短闪光，无牌匾。伤害榜支持三位数及更长名次。经验球使用原生 MC 贴图；食物跟随当前实际进食物品，药水图标使用矿脉药水。全部素材内嵌。
- 离线总结汇总掉落产值、金币变化与材料、食物、药水成本。有完整离线前记录时显示净收益。
- 自动跟随游戏的中文 / English 设置，适配浅色与深色主题。
- 改善原生字体、数字、按钮与提示框，减轻字重；修正制作分类布局和深色行动面板，保留原生进度条颜色。默认文字提示变为跟随主题的小浮层，农田不弹出重复状态。
- 右侧快捷栏提供 Alice战斗模拟器入口，点击后在新标签页打开。
- 数字使用 K/M/B；中文收支速率为金币/d，英文为 coins/d，经验为 XP/h。

在 Tampermonkey 中安装脚本后刷新游戏。已有测试版用户请用新版全部内容覆盖旧脚本，不同时运行两份。离线净收益需要安装后留下离线前快照；缺价或消耗记录不全时保留产值，不把未知成本当成零。

脚本进行被动读取和本地计算，不增加游戏请求，不自动工作、进食、喝药、交易或修改队列。市场价格随已收到的数据更新；`≈` 表示估价。食物比较全部品质，按额外续一天的整数购买数量计算，不扣已有时长。种植预测目前采用单田模型；当前普通战斗使用实测速率与概率期望，选怪列表为固定当前等级的连续单怪比较，已计食物、药水成本，未计找怪、跑路与补货耗时。首领战收益和强化目标尚未支持。

作者 SIKAer，MIT 开源。这是社区工具，与 Deep Vein Idle 官方没有隶属关系。游戏名称、机制数据及原有界面素材的权利归各自权利人。隐私与本地缓存说明见随附 [PRIVACY.md](https://github.com/SIKAdeerMX/-SIK-DVI-Insights/blob/main/PRIVACY.md)。

## English description

Companion script: [[SIK] Dynamic DVI](https://greasyfork.org/en/scripts/599633-sik-dynamic-dvi) improves local equipment motion using original game assets. Both scripts can run together.

[SIK] DVI Insights adds XP, material, time and income information to Deep Vein Idle's existing interface, using the game's theme colors.

- Work rows show XP/h and estimated daily profit. Open Level calculator to plan attempts, time and materials for a target level; financial breakdowns expand with a chevron.
- The active task shows daily income, expected income before consumption costs, and expected profit. Daily income gains a golden glow when it exceeds expected income. Normal combat also includes EPH and food endurance; potion durations expand on click.
- The buff sheet aligns names, timelines and remaining durations, retaining inactive grey icons. Potions show a per-bottle price for the currently active quality. Well fed and Well rooted show the cheapest food, its quality and daily budget inline; the quantity for adding 24 hours appears next to the food name, without a unit.
- Monster rows show continuous single-monster profit and XP/h estimates, with food and potion costs. Boss windows support dragging, arrow-key movement and resetting. Damage rankings emphasize the leader, approximate lead and your own row, with bars relative to first place and modern rank numerals. Food controls fold by default, and Join/Show pills use consistent buttons. Native boss-start announcements trigger six seconds of full-screen fireworks, dismissible with Esc without blocking pointer input.
- Item tooltips show buy offers, sell listings and merchant prices. Received public trade history and cached asks from the last day can help estimate missing purchase prices.
- Bank slots and the market's My items view show one stack value using bids after tax and vendor prices. Sort by value keeps its order on repeated clicks; locked bank items stay in place. Grouped market tiles add values priced separately for each quality. Bank buttons and quantity controls use the same brown and gold style.
- Compact farming tiles and guild pages with level arrows, progress percentages, remaining XP/points, compact contribution values with comparison bars, and an event timeline. Guild lists retain their native icons and show visible positions and capacity meters. Warehouse operations remain native.
- Guild pages retain the previous native buttons, level emblem, notice paper and reward shelf. Notices, rules and recruitment default to reading mode. Native Save acknowledgement closes editing; drafts stay only in page memory. Vein Colossus, Frost Leviathan and Ember Wyrm each have Chinese/English name artwork in mineral, frost and ember themes, with three brief sparkles and no plaque. Damage rankings support three-digit and longer ranks. Native Minecraft XP orb art is embedded; provisions use the current food and native Vein Elixir icon.
- Away summaries value item drops and coins, deducting materials, food and potion costs when a matching pre-away snapshot is available.
- Automatically follows the game’s English / Chinese language setting and light / dark theme.
- Refines typography, numbers, buttons and tooltips with lighter text weights. Fixes crafting category layouts and the dark task panel while retaining native progress colors. Plain text tooltips follow the theme; farming tiles omit duplicate status tips.
- A sidebar shortcut opens Alice Combat Simulator in a new tab.
- Compact K/M/B numbers, coins/d income rates and XP/h experience rates.

Install with Tampermonkey, then reload the game. If updating a test version, replace its entire contents rather than running both copies. Offline net accounting needs a snapshot captured after installation. Missing costs are not treated as zero.

The script passively reads already-received data and performs calculations locally. It does not make extra game requests, automate gameplay or modify task queues. Prices depend on received quotes; `≈` marks estimates. Food recommendations compare all rarities using whole-item purchase budgets for an additional day, without subtracting existing buff time. Farming uses a single-field model. Active combat uses measured rates and expected loot; monster comparisons hold current levels fixed and include food and potion costs, but exclude searching, travel and restocking time. Boss income and enhancing plans are not supported.

By SIKAer, licensed under MIT. An independent community tool, not affiliated with Deep Vein Idle. Game names, mechanism data and original interface assets remain the property of their respective owners. See [PRIVACY.md](https://github.com/SIKAdeerMX/-SIK-DVI-Insights/blob/main/PRIVACY.md) for local storage details.

The embedded XP orb texture is from [Mojang's official Bedrock samples](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/textures/entity/experience_orb.png), © Mojang AB, all rights reserved, subject to the [Minecraft EULA](https://www.minecraft.net/eula). Original game and Minecraft assets are not covered by the plugin's MIT license.

