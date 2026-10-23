# [SIK] DVI Insights — Privacy / 隐私说明

Author: SIKAer · License: MIT

Settings includes a manual local calculation snapshot download. It contains allow-listed character calculation state (including current position, inventory, skills, equipment and buffs) and received public prices/windows. It is saved on the user's device, never uploaded by this script. It excludes chat, guild-bank logs, account credentials and order boards; export is blocked during active commissions to avoid incomplete ownership accounting.

The sidebar includes a link to Alice Combat Simulator at `https://dvi-lab.pages.dev/`. It opens only when clicked, in a new tab without a referrer or character data in the URL. Opening the link does not export a character configuration.

[SIK] DVI Insights runs locally on `deepveinidle.com` and its `www` host. It observes objects the game has already parsed, with a passive listener on already received WebSocket text when the parser hook is bypassed, calculates in local workers, and adds information to existing panels. It reads the officially documented public market snapshot as described below. It does not make other game queries, operate game controls, collect analytics, or upload character data. It has no external dependencies; its userscript permission remains `@grant none`.

The optional update reminder reads this script's public version metadata from `update.greasyfork.org` on page startup and then hourly, with a 15-minute retry after failures and a shared one-minute minimum interval across refreshes, tabs and manual checks. The request sends no character data, cookies or referrer; the server receives ordinary connection information such as the IP address. No remote code is executed. The notice opens the existing script's official installation link only when clicked; installation remains under the userscript manager's control. Turn the reminder off in the work-list plugin settings, or dismiss the current version's notice.

The folded damage meter uses enemy HP/kill counters or received boss-hit events; samples stay in memory and do not upload or alter combat. Boss summon identifiers and acknowledgement times are stored in the existing plugin preferences, bounded to 64 recent entries, to suppress repeated animations after reload.

The running script uses the current character's HP, current map position, inventory, XP, equipment, active bonuses, task counters, received market quotes, and settlement amounts for calculation. Recent observation counters and personal boss results are retained locally as listed below. Only exact native system notices from “The Deep” matching the personal boss-loot template are retained; ordinary chat and private messages are excluded. Credentials, cookies and payment information are not used by the calculators or written to its caches. The parser wrapper returns the original result without changing it and preserves the original parser's errors and reviver behavior.

Bank value sorting changes CSS display order only, not the stored bank order. No sorting request is sent; locked slots remain in place. Guild presentation reads the already displayed notice, rules and recruitment text in page memory. Drafts and the matching guild acknowledgement are held only in memory to preserve editing through redraws and return to reading after the native Save succeeds. The plugin does not submit or persist these texts. Native edit controls are required before local Edit is offered. Farming status tiles reuse the game's displayed text and keep the original seed preference control. Decorative artwork and native item sprites are embedded in the script; no asset server is contacted.

Local storage entries on the game origin:

| Key | Contents |
| --- | --- |
| `dvi-planner.preferences.v1` | Target levels and display/calculation settings |
| `dvi-insights.purchase-prices.v1` | Recent public ask price and original receive time per exact item variant; no orders, quantities or identities; expires after one day |
| `dvi-assistant.price-history.v1` | Public historical price summaries by exact item variant; no buyer or seller identities |
| `dvi-insights.offline-before.v1` | The latest character's internal ID, tick, summed inventory, collection counters, coins, active potion times/rarity buckets, and discard mode, for offline accounting |
| `dvi-insights.home-timers.v1` | The latest character's internal ID, tick, pending home room/station jobs and undismissed completion notices, for completion reminders across reconnects |
| `dvi-insights.public-market.v1` | Public item prices and generation time plus shared five-minute request cooldown; no character data or order identities |
| `dvi-insights.update-check.v1` | Last check attempt/success times, a failure flag, latest public version and dismissed version; no character data |
| `dvi-insights.observations.v1` | Up to 1,440 observation buckets from the last 12 hours: internal character ID, task/configuration signature, observed duration, item/XP/consumption counters; no unobserved time or coordinates |
| `dvi-insights.observations.before-clock-fix.v1` | One local backup of the old observation buckets when upgrading to the corrected snapshot clock; excluded from active calculations and kept until manually removed |
| `dvi-insights.boss-records.v1` | Up to 30 personal boss results: internal character ID, boss identity, received own rank/damage, completion flag, loot system-notice payload and timestamps; no other players' identities or ordinary chat |

The offline baseline is overwritten with the latest snapshot. It contains no character name, account credentials, chat, or movement history. Market settlement records used to reconcile an in-tab away report stay in page memory and are reset on a new welcome message. Public historical estimates expire after seven days; cached ask estimates expire after one day. Each saved price cache is limited to 2,000 variants.

Observation history uses observed active time only; it excludes task-switch and unobserved disconnect gaps. Offline settlements are shown separately. Records are isolated by internal character ID. Expected combat samples are also isolated by zone, equipment and food settings. Observation buckets expire after twelve hours; the boss ledger keeps only the latest thirty results. All remain on the current game origin and are never uploaded.

0.4.91 restarts observations because delayed snapshots could have corrupted their time denominator. The previous counters are backed up once locally for recovery, without uploading them or reusing them in current income estimates. 后续正常观测仍保留近12小时；0.4.91升级时旧样本另存一份本地备份，不继续参与日收入计算，备份可手动删除，设置与行情缓存保留。

The script reads the game’s existing `deepvein.locale` language setting without writing to it. It also reads the game's existing `deepvein-seen` record to align the native away summary. It does not write to that entry. To remove the script's saved data, disable the script and remove only its entries listed above from the site's local storage. Uninstalling a userscript may leave site local storage behind.

脚本在本机读取游戏已收到的数据并计算，同时匿名读取官方明确公开的规划器行情快照；不查询其他游戏接口，不操作工作或交易，不上传角色数据。离线核算需要在游戏域名的本地存储中保留最近一次角色库存、金币、收集计数和药水状态；旧快照会被覆盖。家园提醒另保留最近角色的内部 ID、工程与未关闭的完工提醒，用于重连和离线补报。以上表格列出了全部持久缓存。删除缓存时只删上表的插件条目，保留游戏的 `deepvein-seen`。插件还只读游戏已有的 `deepvein.locale` 以跟随界面语言，不写入该项。

近 12 小时任务观测保存内部角色 ID、任务配置和产出/经验/消耗计数，最多 1,440 个观测桶，不保存坐标；只累计已观测的有效时间，切换与断线空档不计时，离线结算单列。Boss 记录最多保留最近 30 场本人的已收到名次、伤害及掉落；系统消息仅接受 The Deep 发出的原生个人掉落格式，不保存普通聊天、私信或其他玩家身份。装备和房屋估值只在内存计算。上述数据均不上报。

快捷栏的 Alice战斗模拟器链接仅在点击时打开，不附带角色配置或来源页面信息。

公会公告、规则、招募文字及编辑草稿只在当前页面内存中用于阅读展示和确认原生保存结果，不写入缓存、不上传。只有原生提供编辑权限时才显示编辑入口，提交仍由用户点击原生保存按钮完成。装饰素材与物品图标内嵌，无额外素材请求。

战斗路线模拟额外读取当前血量、当前地图坐标、食物库存和携带设置，仅用于本地 Worker 计算；不会上传或持久保存移动记录。

更新提醒每小时读取 Greasy Fork 的公开版本信息，失败后 15 分钟重试；手动检查每分钟最多一次，不发送角色信息、Cookie 或来源页面；服务器会收到 IP 等通常连接信息。不会运行远程代码，也不会强制安装。可在工作列表的插件设置中关闭提醒；点击提示才进入原脚本安装流程。更新缓存只含检查时间、失败标记和版本号；不可持久存储时仅在当前页面内存冷却。

Public market prices are fetched only from https://deepveinidle.com/api/market/prices.json, with no cookies, referrer or character parameters and no redirects. The endpoint is documented by the game for planners and rebuilds every five minutes. Tabs share a local cache/cooldown; failures also wait five minutes. Checks pause while hidden/offline or using Ironman. Snapshots older than fifteen minutes are discarded. The server receives ordinary IP/connection information. Price JSON is validated as data, never executed. Public snapshots do not provide full order depth; estimates are marked.

公开行情只匿名 GET 官方固定地址，每 5 分钟检查一次，跨标签共享缓存；失败同样冷却。后台、离线及铁人模式暂停，超过 15 分钟的公开快照失效。不带 Cookie、来源页面、角色参数，不跟随重定向；服务器会收到通常的 IP 等连接信息。只验证价格数据，不运行远程代码，不主动查询游戏私有市场接口。

