# [SIK] DVI Insights 0.4.86

By SIKAer · [MIT](https://github.com/SIKAdeerMX/-SIK-DVI-Insights/blob/main/LICENSE) · [Privacy](https://github.com/SIKAdeerMX/-SIK-DVI-Insights/blob/main/PRIVACY.md)

## 中文介绍

0.4.84：修复手机设置标签文字溢出，按内容宽度排布并自动换行。同步正式服烟花工作与品质规则；修复手机观测计时、农田高度与掉落日志频道状态。设置页支持手动下载完整本地计算快照，无角色上传。原生解锁与强化费用说明直接沿用，经验预估继续处理原生菜单漏算的世界增益。家园采购试用未加入公开包。



[SIK] DVI信息增强为 Deep Vein Idle 补充经验、材料、时间与收支信息，沿用游戏面板和主题配色。

- 游戏「设置」内新增 **[SIK] Insights** 专属页，集中管理功能开关、药水成本和更新提醒。更改即时生效、保存在当前浏览器，沿用既有配置；工作列表的旧设置入口已移除。

- 当前任务显示有效观测时长，同一任务在近 12 小时内可跨切换、停止与刷新续记；战斗期望按区域、装备和补给配置分开。断线空档不稀释收入，离线收益在结算中单列，并按有效时长折算日利，成本不全时只显示日入。
- 装备标题栏显示穿戴装备参考估值 / 1,000,000 的评分，展开查看战斗装备、工具和坐骑；查看其他玩家时只显示总分。为排除代强化挂单，强化装备不采用 +N 挂单或历史成交，使用同品质底装价加统一强化100级、无精通/家园的重做期望成本，计失败回退、碎片或核心、保护卷轴并比较保护起点。参考标≈；缺保护报价或旧超限装备仅显示已知下限（≥）。未强化底装仍沿用有效报价、历史、缓存或商人兜底。分数不是原生P50、实际投入、成交价值或战斗力，不含家园；市场和仓库报价保持真实来源。
- 保存最近 30 场本人的已收到 Boss 排名和掉落，聊天区独立“掉落日志”按实际品质显示名称、数量和颜色；原生结算缺少个人名次时补充，未收到的排行明确标注。记录仅存本机，不补发查询。手机家园计时只在地图页显示。
- 公会日志保持原生日志，不再附加统计。成员、日志和公会列表不再铺浅色白底。公会首页在「捐献积分」按钮右侧显示当前挂售价下每分金币最少的捐献物品名称。

- 工作列表显示实际路线预计 XP/h 与期望日利，经验统一 K/M/B 简写，点击“升级计算”查看目标等级的工作次数、耗时与材料缺口；材料表补充逐项估价、材料总估价和补齐成本，按买价与订单深度计算；收支只用箭头展开。
- 展开工作行可直接查看投入计价明细，包括材料稀有度、每日用量、单价及客户端/公开快照/缓存/历史来源。公开快照保留客户端缓存，不误删较近报价；现价缺失或数量不足时继续用有效缓存和历史估价兜底。
- 采集经验与升级时间跟随当前“丢弃采集物”开关，计入减少的仓库往返；丢弃与存仓模式分别缓存，丢弃模式不显示可出售的产物收益。
- 制作支持“稀有优先”，按已有完整配方选品质，缺料按普通材料补齐；同时强化时仍显示主行动收入和经验，强化状态单独显示。
- 规则跟随正式服 1.0.3160：同步新路径算法及新增通道，工作和战斗走到最近一侧；原生分批刷新行动列表时同步恢复缓存日利，减少文字闪动。已确认原生菜单因固定模拟时钟漏算世界增益，经验率恢复独立实际路线预估，保留原生阵亡警告；升级计算继续使用同一增益规则。战斗补给同步出发前补回已吃食物，农田顺序同步分区收割规则。角色状态跟随服务器快照采用的新对象；有效观测时长不凭墙钟空增，并行强化不计入主任务耗材。农田显示 0–200% 进度，自动收获仍按 100% 估算；代工订单收益暂不估算。
- PC 原生战斗浮窗内增加可折叠的 DPS 与承伤统计，手机顶部原生血条恢复血量数字。DPS 按怪物有效掉血计算，承伤按已收到的受击事件统计，缺数据显示未知，重连重新观测。制作升级计算增加分品质的材料成本、税后即卖和挂售单价参考，缺价保留未知。
- 当前任务依次显示每天收入、期望日入、期望日利；期望日入为未扣消耗的期望产值。每天收入超过期望日入时显示金色光晕。普通战斗补充 EPH、食物续航；普通工作和战斗的药水默认显示当前品质最先到期的实际图标与时长，名称保留在提示中，待机和单独强化时也保留生效药水摘要，按时间计时；八种药水图标均内嵌，不依赖仓库是否打开；瓶子与倒计时紧邻显示，点击展开按剩余时间排序的列表。
- buff 弹层对齐名称、时间轴和剩余时长，保留未生效的灰色图标；药水显示当前生效品质的单瓶价格，时长提示明确为“当前品质剩余时间”。饱食与扎根优先从近期报价量足够的食物中比较续24小时总成本，名称后只加“数量个”，费用另列金币/d；公开快照标估价。保留历史与缓存估价，悬浮提示简列续24小时、价源和报价时间。到期后仍保留推荐并标记未生效；原生战斗倒计时保持。扎根、饱食和药水的右侧剩余时间统一使用 d/h/m/s 两个相邻单位，世界增益与祝福同步，不足一分钟只显示 s。
- 选怪主行显示当前状态下未来一小时的预计总经验（各战斗技能合计），保留原生阵亡警告；下方补充路线模拟的折算日利，展开查看食物与药水成本，以及一小时内战斗、移动、补给回血和停战后闲置的时间。日利与成本并非全天保证值。首领伤害窗适配新版原生皇冠、奖杯、名次变化、伤害占比与个人行，保留紧凑样式。补给默认收起，顶部加入／显示入口统一按钮样式。首领开战播放 6 秒全屏烟花，Esc 可收起，鼠标操作不受阻挡。
- 选怪展开区提供战斗升级计算，选择近战、远程、魔法、防御或生命技能及目标等级，按当前路线经验估算升级时间，包含移动、补给和回血。
- 战斗期望收入包含按攻击机会与各品质概率计算的随机坐骑掉落；实际掉落收入单独记账。铁人账号按商人计价，普通账号保留买卖分价、税费和有限订单深度。
- 手机市场优化输入框和触摸操作，减少 Safari 输入时自动放大及滑动物品时的重复估价刷新，保留滚动与双指缩放。
- 世界首领同一次召唤的动画跨刷新去重；价值排序在打开快速出售、选择物品和筛选时保持，仅切换原生排序时退出。
- 家园地图标签的弹窗遮挡使用原生处理；右上角计时按剩余时间排序，手机显示最近完工项目。房间建成、设施升级后显示一次可关闭的提醒，已记录工程支持离线补报，取消工程不误报。
- 战斗列表刷新时保留浏览位置和已展开明细，减少滚动回跳，兼顾手机窄屏。
- 物品提示补充求购、挂售和商人价格；买入缺价时可参考已接收的公开历史成交与一天内的报价缓存。被动行情接收增加兜底，切到后台及时保存价格，收到成交价后刷新期望日利；缺价时列出具体物品。
- 仓库和市场“我的物品”的整堆估值按税后求购和商人价计算；一个按钮按价值排序，重复点击保持排序，仓库锁定物品保持原位。市场同类物品按各品质分别计价后汇总；仓库按钮和数量操作区统一棕金样式。
- 农田和隐藏花园采用自适应卡片，保留每田原生作物下拉框与实时成熟状态；升级计算中的农田明细显示当前作物、成熟时间、浇水和下次播种，窄屏自动换行。仅调整信息布局，种植仍是单田参考，不含跨田移动与花园清障。公会用进度和缺口表达升级与成员名额，仓库操作保留。
- 公会恢复原来的按钮、等级徽章、公告纸和奖励架呈现。公告、规则与招募默认阅读，原生保存确认后退出编辑，草稿只在页面内存保留。三种世界首领各用一套中英文名称艺术字：矿脉巨像为矿晶、霜冻利维坦为冰霜、余烬飞龙为余烬主题，仅三处短闪光，无牌匾。伤害榜支持三位数及更长名次。经验球使用原生 MC 贴图；食物跟随当前实际进食物品，药水图标跟随当前品质最先到期的实际药水。全部素材内嵌。
- 仓库和市场“我的物品”默认不显示估值，点击“价值排序”后才在左上角显示整堆价值（最多两位小数），估值字体、字号和颜色与对应原生数量一致，数量位置保持原生不变；切换原生排序会隐藏估值并恢复原生顺序与数量样式。
- 离线总结汇总掉落产值、金币变化与材料、食物、药水成本。有完整离线前记录时显示净收益。
- 自动跟随游戏的中文 / English 设置，适配浅色与深色主题。
- 改善原生字体、数字、按钮与提示框，减轻字重；修正制作分类布局和深色行动面板，保留原生进度条颜色。默认文字提示变为跟随主题的小浮层，农田不弹出重复状态。
- 右侧快捷栏提供 Alice战斗模拟器入口，点击后在新标签页打开。
- 数字使用 K/M/B；中文收支速率为金币/d，英文为 coins/d，经验为 XP/h。

在 Tampermonkey 中安装脚本后刷新游戏。已有测试版用户请用新版全部内容覆盖旧脚本，不同时运行两份。离线净收益需要安装后留下离线前快照；缺价或消耗记录不全时保留产值，不把未知成本当成零。

脚本进行本地计算，行情同时使用客户端已收到的报价和官方公开规划器快照；后者每 5 分钟匿名读取一次，共享缓存，不上传角色数据。除该公开接口外不增加游戏查询，不自动工作、进食、喝药、交易或修改队列。买卖两侧按报价时间合并，新数据优先；API 无完整深度，使用时标估价，批量成交可能不同；仓库即卖估值仍使用实际收到的报价和商人价。`≈` 表示估价。食物比较全部品质，按额外续一天的整数购买数量计算，不扣已有时长。种植预测目前采用单田模型，不含跨田路线与隐藏花园清障耗时；当前普通战斗使用实测速率与概率期望，选怪列表从当前位置与当前血量起算一小时，使用真实食物库存、携带量、补给与泉水路线，计算增益到期和经验升级。按 16 个固定模拟种子取平均，以概率期望计价掉落；折算日利是该小时流量的 24 倍投影，不保证能持续一天。未来任务奖励、活动箱与房屋升级未预测；战斗支持按已收到的家园布局模拟离家路径，工作升级计算暂不支持动态家园路径。首领战收益和强化目标尚未支持。

作者 SIKAer，MIT 开源。这是社区工具，与 Deep Vein Idle 官方没有隶属关系。游戏名称、机制数据及原有界面素材的权利归各自权利人。隐私与本地缓存说明见随附 [PRIVACY.md](https://github.com/SIKAdeerMX/-SIK-DVI-Insights/blob/main/PRIVACY.md)。

- 轻量更新提醒重新打开页面时检查 Greasy Fork 公开版本信息，随后每小时检查、失败后 15 分钟重试；跨标签共享一分钟最短间隔。设置独立挂载，显示运行版本、立即检查与更新页面入口。有新版时显示独立小提示，手机切换界面也可见；可关闭自动检查或忽略当前版本。不强制更新，不上传角色数据。

## English description

0.4.84 fixes mobile Settings tab text overflow with content-sized, wrapping tabs. It supports live 1.0.3160 recipes and rarity rules, fixes mobile observation timers, compact fields and loot-log channel state, and adds manual local calculation snapshots in Settings. Native unlock and enhancement-cost hints remain in use; independent XP forecasts retain world buffs missed by the native menu. The home procurement trial is excluded from this public release.


- Open game **Settings → [SIK] Insights** to control features, potion costs and update reminders. Changes apply immediately and persist in this browser; existing preferences are retained. The old work-list settings entry has been removed.

- Active tasks show observed duration and resume matching samples from the last twelve hours across task switches, stops and reloads. Combat expectations separate zone, equipment and food configurations. Unobserved gaps are excluded; offline settlements remain separate and show a daily profit estimate over effective duration, or income only when costs are incomplete.
- Equipment score is reference worn-gear value divided by 1,000,000, with a folded breakdown of combat gear, tools and mount. Enhanced listings and trades may be service escrow, so the score uses the same-quality base price plus expected rebuilding cost at a shared Enhancing 100 baseline, with no mastery/home bonus. Includes failures, shards or cores, and protection scrolls, comparing protection thresholds. References show ≈; missing scroll quotes or legacy levels show only known lower bounds (≥). Base prices retain quote/history/cache/vendor fallbacks. This is not native P50, actual spending, resale value or combat power, and excludes home. Market and bank quotes remain unchanged. Inspecting another player shows only the total.
- A separate chat Loot log preserves the latest thirty received personal boss rewards, with exact rarities, quantities and colors. Empty native personal results can be supplemented with received ranks; missing ranks remain unknown. No recovery queries are sent. Mobile Home timers stay on the map tab and hide under dialogs.
- The guild log stays native and no longer adds statistics. Member, log and guild-list pages no longer use the light paper background. The guild home page shows the best-value donation item immediately to the right of Donate points.


[SIK] DVI Insights adds XP, material, time and income information to Deep Vein Idle's existing interface, using the game's theme colors.

- Work rows show real-route projected XP/h in K/M/B notation and estimated daily profit. Open Level calculator to plan attempts, time and materials for a target level. Material tables include per-item estimates, total material value and the cost to cover shortages, using purchase prices and order depth; financial breakdowns expand with a chevron.
- Expanded work rows show input rarity, projected daily consumption, unit price and each price source. Public snapshots retain client purchase caches; missing quotes or volume still fall back to valid cached prices and trade history, marked as estimates.
- Gathering XP and level-time estimates follow the current discard setting and account for fewer bank trips. Discard and bank modes use separate caches; discarded outputs are excluded from sale income.
- Crafting supports Best first, selecting complete recipes from owned stock and filling shortages with Normal materials. Concurrent enhancement keeps the main action income and XP visible, with a separate enhancement status line.
- Rules follow live client 1.0.3160, including updated path costs and the new passage. Cached profit estimates are restored during native list redraws to reduce flicker. The native menu loses active world buffs when it resets the simulation clock; independent XP forecasts correct this while preserving native death warnings. Level calculations use the same buff rules. Combat forecasts replace meals eaten before departing a bank; farming field selection follows the new harvest groups. State follows the newly adopted snapshot object; observation time does not grow from wall time alone, and parallel enhancement is excluded from primary-task material counts. Farming remains a single-field reference and commission income remains unestimated.
- Responsive field and garden cards retain the original per-field crop dropdowns and live maturity updates. Calculator details show current crops, time remaining, watering and next crops in read-only cards. Farming estimates remain single-field references, excluding travel between fields and garden clearing.
- The original desktop combat HUD gains collapsible DPS and damage-taken statistics; mobile restores numeric HP inside the original top health bar. DPS uses effective enemy HP loss; damage taken uses received hit events and stays unknown without data. Measurements reset after reconnects. Crafting calculators show per-quality material costs and after-tax unit revenue, retaining unknown prices.
- Boss animations remember the same summon across reloads. Quick sell and item selection retain local value sorting; switching native sort exits it. Home timers sort by remaining time and show completion notices; no upgrade overview or added gameplay controls.
- The active task shows daily income, expected income before consumption costs, and expected profit. Daily income gains a golden glow when it exceeds expected income. Normal combat also includes EPH and food endurance; both work and combat show a potion summary with the actual icon of the active potion whose current rarity expires first, and its name in the tooltip. Idle time and standalone enhancement retain active potion timers. All eight native potion icons are embedded and remain visible with the inventory closed; icon and countdown stay together. Click to expand the sorted duration list.
- Home map labels stay below skill panels and dialogs. Home timers sort by time remaining; the mobile pill names the next completion. A dismissible notice confirms completed rooms and station upgrades, including previously recorded jobs completed while away. Cancelled jobs do not trigger success notices.
- The buff sheet aligns names, timelines and remaining durations, retaining inactive grey icons. Potions show a per-bottle price for the active quality. Well fed and Well rooted prioritize recent quotes with enough stock before comparing full 24-hour costs. The compact label shows the food name and quantity in pieces; cost is separate in coins/d. Public snapshots remain estimates. History and cached budgets remain available, with 24-hour duration, sources and quote age in the tooltip. Recommendations remain after buffs expire, and native combat timers are preserved. Food buffs and potions use the same two-unit remaining time format: days/hours, hours/minutes, minutes/seconds, or seconds alone.
- Monster rows show projected total XP over the next hour from the actual character state, retain native death warnings and add route-based daily profit. Details show projected food/potion costs and time spent fighting, travelling, resupplying/healing or idle after stopping. Daily profit and costs are projections, not guarantees. Boss windows retain the new native crowns, cups, rank movement, damage shares and your own row, with compact typography. Food controls fold by default, and Join/Show pills use consistent buttons. Native boss-start announcements trigger six seconds of full-screen fireworks, dismissible with Esc without blocking pointer input.
- Expanded monster rows offer a combat level calculator for melee, ranged, magic, defense or health and a target level. Estimates use the current route's XP rates, including travel, restocking and healing.
- Expected combat income includes random mount drops based on attack opportunities and quality probabilities; actual drops are accounted for separately. Ironman accounts use merchant valuation. Normal accounts retain separate buying/selling prices, tax and finite order depth.
- Mobile market inputs and touch controls reduce Safari's automatic input zoom and repeated valuation refreshes while scrolling items, retaining scrolling and pinch zoom.
- Combat-list refreshes retain your scroll position and expanded details, reducing scroll jumps on narrow mobile layouts.
- Item tooltips show buy offers, sell listings and merchant prices. Received public trade history and cached asks from the last day can help estimate missing purchase prices. Passive market capture has a fallback, saves prices when the page moves to the background and refreshes expected profit when trade prices arrive; missing prices identify the specific items.
- Bank slots and the market's My items view calculate stack values using bids after tax and vendor prices. Sort by value keeps its order on repeated clicks; locked bank items stay in place. Grouped market tiles add values priced separately for each quality. Bank buttons and quantity controls use the same brown and gold style.
- Compact farming tiles and guild pages with level arrows, progress percentages, remaining XP/points, compact contribution values with comparison bars, and an event timeline. Guild lists retain their native icons and show visible positions and capacity meters. Warehouse operations remain native.
- Guild pages retain the previous native buttons, level emblem, notice paper and reward shelf. Notices, rules and recruitment default to reading mode. Native Save acknowledgement closes editing; drafts stay only in page memory. Vein Colossus, Frost Leviathan and Ember Wyrm each have Chinese/English name artwork in mineral, frost and ember themes, with three brief sparkles and no plaque. Damage rankings support three-digit and longer ranks. Native Minecraft XP orb art is embedded; provisions use the current food and the actual potion icon with the shortest remaining time.
- Bank and market My items hide estimates by default. Sort by value reveals stack values in the upper left with up to two decimal places, as plain numbers without a background, matching the font, size and color of the corresponding native quantity and keeping its position; switching native sorting restores the native order and quantity display; quick sell retains value sorting.
- Away summaries value item drops and coins, deducting materials, food and potion costs when a matching pre-away snapshot is available.
- Automatically follows the game’s English / Chinese language setting and light / dark theme.
- Refines typography, numbers, buttons and tooltips with lighter text weights. Fixes crafting category layouts while retaining the native dark task panel and progress colors. Plain text tooltips follow the theme; farming tiles omit duplicate status tips.
- A sidebar shortcut opens Alice Combat Simulator in a new tab.
- Compact K/M/B numbers, coins/d income rates and XP/h experience rates.

Install with Tampermonkey, then reload the game. If updating a test version, replace its entire contents rather than running both copies. Offline net accounting needs a snapshot captured after installation. Missing costs are not treated as zero.

The script calculates locally and combines received client quotes with the officially documented public market snapshot, fetched anonymously every five minutes with shared caching and no character upload. It makes no other game queries, automates no gameplay and does not modify task queues. Fresh client quotes and depth take priority; older native sides and cached observations compare timestamps independently with the snapshot. Public snapshots never delete the client purchase-price fallback. Public top prices lack full order depth and remain estimates; bulk execution may differ. Bank liquidation labels retain received quotes and vendor prices; `≈` marks estimates. Food recommendations compare all rarities using whole-item purchase budgets for an additional day, without subtracting existing buff time. Farming uses a single-field model, excluding inter-field travel and hidden-garden obstacle clearing. Active combat uses measured rates and expected loot; Monster-list simulations start from current position and HP, use finite food stocks and carrying policies, travel to banks/fountains, account for buff expiry and XP level-ups, and average 16 deterministic samples. Loot is valued by probability expectation. Daily profit projects the next hour’s flows by 24; it does not guarantee day-long supplies or performance. Quest rewards, seasonal boxes and future room upgrades are excluded; combat includes Home doors and exit portals using received room layouts; work-level calculators do not yet support dynamic Home paths. Boss income and enhancing plans are not supported.

By SIKAer, licensed under MIT. An independent community tool, not affiliated with Deep Vein Idle. Game names, mechanism data and original interface assets remain the property of their respective owners. See [PRIVACY.md](https://github.com/SIKAdeerMX/-SIK-DVI-Insights/blob/main/PRIVACY.md) for local storage details.

The embedded XP orb texture is from [Mojang's official Bedrock samples](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/textures/entity/experience_orb.png), © Mojang AB, all rights reserved, subject to the [Minecraft EULA](https://www.minecraft.net/eula). Original game and Minecraft assets are not covered by the plugin's MIT license.

- A lightweight update reminder checks official Greasy Fork metadata on page startup and then hourly, retrying failures after 15 minutes, with a shared one-minute minimum interval. Independently mounted settings show the running version, Check now and an update-page link. A standalone notice stays visible across mobile panels. No forced installation or character uploads.

