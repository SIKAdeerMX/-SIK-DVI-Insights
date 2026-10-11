# [SIK] DVI Insights — Privacy / 隐私说明

Author: SIKAer · License: MIT

The sidebar includes a link to Alice Combat Simulator at `https://dvi-lab.pages.dev/`. It opens only when clicked, in a new tab without a referrer or character data in the URL. Opening the link does not export a character configuration.

[SIK] DVI Insights runs locally on `deepveinidle.com` and its `www` host. It observes objects the game has already parsed, calculates in local workers, and adds information to existing panels. It does not send additional game requests, operate game controls, collect analytics, or upload data. It has no external dependencies or external update URLs; its userscript permission is `@grant none`.

The running script uses the current character's inventory, XP, equipment, active bonuses, task counters, received market quotes, and settlement amounts for calculation. These are held in page memory. Chat, credentials, cookies, payment information, and private messages are not used by the calculators or written to its caches. The parser wrapper returns the original result without changing it and preserves the original parser's errors and reviver behavior.

Bank value sorting changes CSS display order only, not the stored bank order. No sorting request is sent; locked slots remain in place. Guild presentation reads the already displayed notice, rules and recruitment text in page memory. Drafts and the matching guild acknowledgement are held only in memory to preserve editing through redraws and return to reading after the native Save succeeds. The plugin does not submit or persist these texts. Native edit controls are required before local Edit is offered. Farming status tiles reuse the game's displayed text and keep the original seed preference control. Decorative artwork and native item sprites are embedded in the script; no asset server is contacted.

Four local storage entries are used on the game origin:

| Key | Contents |
| --- | --- |
| `dvi-planner.preferences.v1` | Target levels and display/calculation settings |
| `dvi-insights.purchase-prices.v1` | Recent public ask price and original receive time per exact item variant; no orders, quantities or identities; expires after one day |
| `dvi-assistant.price-history.v1` | Public historical price summaries by exact item variant; no buyer or seller identities |
| `dvi-insights.offline-before.v1` | The latest character's internal ID, tick, summed inventory, collection counters, coins, active potion times/rarity buckets, and discard mode, for offline accounting |

The offline baseline is overwritten with the latest snapshot. It contains no character name, account credentials, chat, or movement history. Market settlement records used to reconcile an in-tab away report stay in page memory and are reset on a new welcome message. Public historical estimates expire after seven days; cached ask estimates expire after one day. Each saved price cache is limited to 2,000 variants.

The script reads the game’s existing `deepvein.locale` language setting without writing to it. It also reads the game's existing `deepvein-seen` record to align the native away summary. It does not write to that entry. To remove the script's saved data, disable the script and remove only its four entries listed above from the site's local storage. Uninstalling a userscript may leave site local storage behind.

脚本只在本机读取游戏已收到的数据、计算并补充界面，不增加游戏请求，不操作工作或交易，不上传数据。离线核算需要在游戏域名的本地存储中保留最近一次角色库存、金币、收集计数和药水状态；旧快照会被覆盖。以上表格列出了全部持久缓存。删除缓存时只删插件自己的四项，保留游戏的 `deepvein-seen`。插件还只读游戏已有的 `deepvein.locale` 以跟随界面语言，不写入该项。

快捷栏的 Alice战斗模拟器链接仅在点击时打开，不附带角色配置或来源页面信息。

公会公告、规则、招募文字及编辑草稿只在当前页面内存中用于阅读展示和确认原生保存结果，不写入缓存、不上传。只有原生提供编辑权限时才显示编辑入口，提交仍由用户点击原生保存按钮完成。装饰素材与物品图标内嵌，无额外素材请求。
