# [SIK] DVI Insights 0.4.31

By SIKAer · [MIT](https://github.com/SIKAdeerMX/-SIK-DVI-Insights/blob/main/LICENSE) · [Privacy](https://github.com/SIKAdeerMX/-SIK-DVI-Insights/blob/main/PRIVACY.md)

## 中文介绍

系列组件：[SIK] DVI信息增强负责信息与规划，[[SIK] 动态DVI](https://greasyfork.org/zh-CN/scripts/599633-sik-dynamic-dvi) 提供装备美术、武器动作与本地特效，两个脚本可同时使用。

[SIK] DVI信息增强为 Deep Vein Idle 补充经验、材料、时间与收支信息，沿用游戏面板和主题配色。

- 工作列表显示 XP/h 和期望日利，点击“升级计算”查看目标等级的工作次数、耗时与材料缺口；材料表补充逐项估价、材料总估价和补齐成本，按买价与订单深度计算；收支只用箭头展开。
- 当前任务依次显示每天收入、期望日入、期望日利；期望日入为未扣消耗的期望产值。每天收入超过期望日入时显示金色光晕。普通战斗补充 EPH、食物续航；药水默认收成一行，点击展开时长。
- buff 弹层对齐名称、时间轴和剩余时长，保留未生效的灰色图标；药水显示当前生效品质的单瓶价格。饱食与扎根直接显示续 24 小时最省钱的食物、品质及日成本，名称后直接显示续一天的购买数量，不附单位。
- 选怪主行统一显示一小时路线预计总经验（各战斗技能合计，含跑路、补给和回血）。首次等待或失败时显示原生经验，原生阵亡警告优先；下方显示折算日利，展开查看食物与药水成本，以及一小时内战斗、移动、补给回血和停战后闲置的时间。日利与成本并非全天保证值。首领伤害窗保持之前的排行与战况布局，保留个人一行和长名次对齐。补给默认收起，顶部加入／显示入口统一按钮样式。首领开战播放 6 秒全屏烟花，Esc 可收起，鼠标操作不受阻挡。
- 战斗列表刷新时保留浏览位置和已展开明细，减少滚动回跳，兼顾手机窄屏。
- 物品提示补充求购、挂售和商人价格；买入缺价时可参考已接收的公开历史成交与一天内的报价缓存。
- 仓库和市场“我的物品”的整堆估值按税后求购和商人价计算；一个按钮按价值排序，重复点击保持排序，仓库锁定物品保持原位。市场同类物品按各品质分别计价后汇总；仓库按钮和数量操作区统一棕金样式。
- 农田采用紧凑状态格；公会用升级箭头、进度百分比和缺口表达升级与成员名额；贡献使用 K/M/B 和同列比例条，日志采用时间线，公会列表保留原生图标并显示序号与名额使用情况。公会仓库操作保留。
- 公会恢复原来的按钮、等级徽章、公告纸和奖励架呈现。公告、规则与招募默认阅读，原生保存确认后退出编辑，草稿只在页面内存保留。三种世界首领各用一套中英文名称艺术字：矿脉巨像为矿晶、霜冻利维坦为冰霜、余烬飞龙为余烬主题，仅三处短闪光，无牌匾。伤害榜支持三位数及更长名次。经验球使用原生 MC 贴图；食物跟随当前实际进食物品，药水图标使用矿脉药水。全部素材内嵌。
- 仓库和市场“我的物品”默认不显示估值，点击“价值排序”后才在左上角显示整堆价值（最多两位小数），估值字体、字号和颜色与对应原生数量一致，数量位置保持原生不变；点击其他按钮或切换原生排序会隐藏估值并恢复原生顺序与数量样式。
- 离线总结汇总掉落产值、金币变化与材料、食物、药水成本。有完整离线前记录时显示净收益。
- 自动跟随游戏的中文 / English 设置，适配浅色与深色主题。
- 改善原生字体、数字、按钮与提示框，减轻字重；修正制作分类布局和深色行动面板，保留原生进度条颜色。默认文字提示变为跟随主题的小浮层，农田不弹出重复状态。
- 右侧快捷栏提供 Alice战斗模拟器入口，点击后在新标签页打开。
- 数字使用 K/M/B；中文收支速率为金币/d，英文为 coins/d，经验为 XP/h。

在 Tampermonkey 中安装脚本后刷新游戏。已有测试版用户请用新版全部内容覆盖旧脚本，不同时运行两份。离线净收益需要安装后留下离线前快照；缺价或消耗记录不全时保留产值，不把未知成本当成零。

脚本进行被动读取和本地计算，不增加游戏请求，不自动工作、进食、喝药、交易或修改队列。市场价格随已收到的数据更新；`≈` 表示估价。食物比较全部品质，按额外续一天的整数购买数量计算，不扣已有时长。种植预测目前采用单田模型；当前普通战斗使用实测速率与概率期望，选怪列表从当前位置与当前血量起算一小时，使用真实食物库存、携带量、补给与泉水路线，计算增益到期和经验升级。按 16 个固定模拟种子取平均，以概率期望计价掉落；折算日利是该小时流量的 24 倍投影，不保证能持续一天。未来任务奖励、活动箱、坐骑掉落与房屋升级未预测；动态家园路线暂不支持。首领战收益和强化目标尚未支持。

作者 SIKAer，MIT 开源。这是社区工具，与 Deep Vein Idle 官方没有隶属关系。游戏名称、机制数据及原有界面素材的权利归各自权利人。隐私与本地缓存说明见随附 [PRIVACY.md](https://github.com/SIKAdeerMX/-SIK-DVI-Insights/blob/main/PRIVACY.md)。

## English description

Companion script: [[SIK] Dynamic DVI](https://greasyfork.org/en/scripts/599633-sik-dynamic-dvi) adds equipment art, weapon motion and local visual effects. Both scripts can run together.

[SIK] DVI Insights adds XP, material, time and income information to Deep Vein Idle's existing interface, using the game's theme colors.

- Work rows show XP/h and estimated daily profit. Open Level calculator to plan attempts, time and materials for a target level. Material tables include per-item estimates, total material value and the cost to cover shortages, using purchase prices and order depth; financial breakdowns expand with a chevron.
- The active task shows daily income, expected income before consumption costs, and expected profit. Daily income gains a golden glow when it exceeds expected income. Normal combat also includes EPH and food endurance; potion durations expand on click.
- The buff sheet aligns names, timelines and remaining durations, retaining inactive grey icons. Potions show a per-bottle price for the currently active quality. Well fed and Well rooted show the cheapest food, its quality and daily budget inline; the quantity for adding 24 hours appears next to the food name, without a unit.
- Monster rows show projected total XP across combat skills from a one-hour route simulation, including travel, restocking and healing. Native XP provides a fallback while waiting or after an error; native death warnings take priority. Details show projected food/potion costs and time spent fighting, travelling, resupplying/healing or idle after stopping. Daily profit and costs are projections, not guarantees. Boss windows retain the previous ranking and combat layout, with your own row and aligned long ranks. Food controls fold by default, and Join/Show pills use consistent buttons. Native boss-start announcements trigger six seconds of full-screen fireworks, dismissible with Esc without blocking pointer input.
- Combat-list refreshes retain your scroll position and expanded details, reducing scroll jumps on narrow mobile layouts.
- Item tooltips show buy offers, sell listings and merchant prices. Received public trade history and cached asks from the last day can help estimate missing purchase prices.
- Bank slots and the market's My items view calculate stack values using bids after tax and vendor prices. Sort by value keeps its order on repeated clicks; locked bank items stay in place. Grouped market tiles add values priced separately for each quality. Bank buttons and quantity controls use the same brown and gold style.
- Compact farming tiles and guild pages with level arrows, progress percentages, remaining XP/points, compact contribution values with comparison bars, and an event timeline. Guild lists retain their native icons and show visible positions and capacity meters. Warehouse operations remain native.
- Guild pages retain the previous native buttons, level emblem, notice paper and reward shelf. Notices, rules and recruitment default to reading mode. Native Save acknowledgement closes editing; drafts stay only in page memory. Vein Colossus, Frost Leviathan and Ember Wyrm each have Chinese/English name artwork in mineral, frost and ember themes, with three brief sparkles and no plaque. Damage rankings support three-digit and longer ranks. Native Minecraft XP orb art is embedded; provisions use the current food and native Vein Elixir icon.
- Bank and market My items hide estimates by default. Sort by value reveals stack values in the upper left with up to two decimal places, as plain numbers without a background, matching the font, size and color of the corresponding native quantity and keeping its position; other buttons or native sorting restore the native order and quantity display.
- Away summaries value item drops and coins, deducting materials, food and potion costs when a matching pre-away snapshot is available.
- Automatically follows the game’s English / Chinese language setting and light / dark theme.
- Refines typography, numbers, buttons and tooltips with lighter text weights. Fixes crafting category layouts and the dark task panel while retaining native progress colors. Plain text tooltips follow the theme; farming tiles omit duplicate status tips.
- A sidebar shortcut opens Alice Combat Simulator in a new tab.
- Compact K/M/B numbers, coins/d income rates and XP/h experience rates.

Install with Tampermonkey, then reload the game. If updating a test version, replace its entire contents rather than running both copies. Offline net accounting needs a snapshot captured after installation. Missing costs are not treated as zero.

The script passively reads already-received data and performs calculations locally. It does not make extra game requests, automate gameplay or modify task queues. Prices depend on received quotes; `≈` marks estimates. Food recommendations compare all rarities using whole-item purchase budgets for an additional day, without subtracting existing buff time. Farming uses a single-field model. Active combat uses measured rates and expected loot; Monster-list simulations start from current position and HP, use finite food stocks and carrying policies, travel to banks/fountains, account for buff expiry and XP level-ups, and average 16 deterministic samples. Loot is valued by probability expectation. Daily profit projects the next hour’s flows by 24; it does not guarantee day-long supplies or performance. Quest rewards, seasonal boxes, mount drops and future room upgrades are excluded; dynamic Home routes are unsupported. Boss income and enhancing plans are not supported.

By SIKAer, licensed under MIT. An independent community tool, not affiliated with Deep Vein Idle. Game names, mechanism data and original interface assets remain the property of their respective owners. See [PRIVACY.md](https://github.com/SIKAdeerMX/-SIK-DVI-Insights/blob/main/PRIVACY.md) for local storage details.

The embedded XP orb texture is from [Mojang's official Bedrock samples](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/textures/entity/experience_orb.png), © Mojang AB, all rights reserved, subject to the [Minecraft EULA](https://www.minecraft.net/eula). Original game and Minecraft assets are not covered by the plugin's MIT license.

