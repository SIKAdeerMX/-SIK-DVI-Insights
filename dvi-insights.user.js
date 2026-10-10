// ==UserScript==
// @name         DVI Insights
// @name:zh-CN   DVI信息增强
// @namespace    SIKAer.DVIInsights
// @version      0.4.5
// @author       SIKAer
// @copyright    2026, SIKAer
// @license      MIT
// @description  Passive XP, work planning, income and offline accounting enhancements for Deep Vein Idle.
// @description:zh-CN 本地计算经验、材料、工作时间、行动收益和离线收支，融入游戏界面。
// @match        https://deepveinidle.com/*
// @match        https://www.deepveinidle.com/*
// @run-at       document-start
// @grant        none
// @sandbox      raw
// @noframes
// ==/UserScript==
/*
MIT License

Copyright (c) 2026 SIKAer

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/

(function () {
  "use strict";
  const installKey = Symbol.for("SIKAer.DVIInsights");
  if (window[installKey]) return;
  window[installKey] = true;

  // ---- src/core.js ----
  /* Independent calculator. No browser, game requests or game-state writes. */
  (function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.DVIPlannerCore = factory();
  })(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";
    const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
    const sum = (xs) => xs.reduce((a, b) => a + b, 0);
    const add = (obj, key, value) => {
      obj[key] = (obj[key] || 0) + value;
    };
    const clone = (x) => JSON.parse(JSON.stringify(x));
    const neighbors = [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ];
    const skillSlots = {
      mining: "pickaxe",
      fishing: "rod",
      woodcutting: "axe",
      thieving: "gloves",
      cooking: "pan",
      smithing: "hammer",
      fletching: "knife",
      crafting: "needle",
      herblore: "mortar",
      farming: "hoe",
    };
    const gathers = new Set(["mining", "fishing", "woodcutting", "thieving", "farming"]);
    function hash(a, b, c) {
      let x = (a ^ 2654435769) >>> 0;
      x = Math.imul(x ^ (b >>> 0), 2246822507) >>> 0;
      x = (x ^ (x >>> 13)) >>> 0;
      x = Math.imul(x ^ (c >>> 0), 3266489909) >>> 0;
      return (x ^ (x >>> 16)) >>> 0;
    }
    function rng(seed) {
      let x = seed >>> 0;
      return () => {
        x += 0x6d2b79f5;
        let t = Math.imul(x ^ (x >>> 15), 1 | x);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    class Heap {
      constructor(compare) {
        this.q = [];
        this.compare = compare;
      }
      push(v) {
        const q = this.q;
        let i = q.length;
        q.push(v);
        while (i) {
          const p = (i - 1) >> 1;
          if (this.compare(q[p], v) <= 0) break;
          q[i] = q[p];
          i = p;
        }
        q[i] = v;
      }
      pop() {
        const q = this.q,
          v = q[0],
          last = q.pop();
        if (q.length) {
          let i = 0;
          while (i * 2 + 1 < q.length) {
            let j = i * 2 + 1;
            if (j + 1 < q.length && this.compare(q[j + 1], q[j]) < 0) j++;
            if (this.compare(last, q[j]) <= 0) break;
            q[i] = q[j];
            i = j;
          }
          q[i] = last;
        }
        return v;
      }
    }
    const octile = (ax, ay, bx, by) => {
      const x = Math.abs(ax - bx),
        y = Math.abs(ay - by);
      return Math.max(x, y) + (Math.SQRT2 - 1) * Math.min(x, y);
    };
    function create(data) {
      const jobs = new Map(data.jobs.map((x) => [x.id, x])),
        items = new Map(data.items.map((x) => [x.id, x]));
      const tools = new Map(data.tools.map((x) => [x.itemId, x])),
        gear = new Map(data.gear.map((x) => [x.itemId, x]));
      const mastery = new Map(data.masteries.map((x) => [x.id, x.perRank]));
      const eligible = new Set(data.rarityEligible),
        seeds = new Set(data.seedIds),
        map = data.world;
      const c = data.constants,
        paths = new Map(),
        bankFields = new Map(),
        rotations = [];
      function level(xp) {
        let lo = 1,
          hi = data.xpTable.length - 1;
        while (lo < hi) {
          const mid = Math.ceil((lo + hi) / 2);
          if (data.xpTable[mid] <= xp) lo = mid;
          else hi = mid - 1;
        }
        return lo;
      }
      const base = (id) => (id % 10000) % 1000,
        tier = (id) => Math.floor((id % 10000) / 1000);
      const identity = (id, t) => id + t * 1000;
      const item = (id) => items.get(id % 10000) || items.get(base(id));
      function tool(id) {
        if (id == null) return null;
        const t = tools.get(id % 10000);
        return t
          ? {
              ...t,
              bonus:
                t.bonus *
                (1 +
                  (t.slot === "mount" ? c.mountEnhance : c.toolEnhance) * Math.floor(id / 10000)),
            }
          : null;
      }
      const bonus = (id) => tool(id)?.bonus || 0;
      function luck(p) {
        const id = p.equipment?.amulet;
        if (id == null) return 0;
        return (gear.get(id % 10000)?.luck || 0) * (1 + c.toolEnhance * Math.floor(id / 10000));
      }
      const master = (p, k) => 1 + (p.masteries?.[k] || 0) * (mastery.get(k) || 0);
      function brewTier(p, k, tick) {
        const buckets = p.brewBuckets?.[k];
        if (buckets?.length) {
          const elapsed = Math.max(0, tick - ((p.brews?.[k] || 0) - sum(buckets)));
          let used = 0;
          for (let i = buckets.length - 1; i >= 0; i--) {
            used += buckets[i];
            if (elapsed < used) return clamp(i, 0, 4);
          }
        }
        return clamp(p.brewTier?.[k] || 0, 0, 4);
      }
      const brew = (p, k, tick) =>
        (p.brews?.[k] || 0) > tick ? c.brewStrength[brewTier(p, k, tick)] : 0;
      const active = (p, k, tick) => (p.brews?.[k] || 0) > tick;
      function home(p, kind, skill) {
        let n = 0;
        for (const r of data.rooms)
          if (
            p.houseFurniture?.[r.id] !== undefined &&
            r.bonus.kind === kind &&
            (!skill || r.bonus.skill === skill)
          )
            n += (p.house?.[r.id] || 0) * 0.01 * (r.rate ?? 1);
        return n;
      }
      function rotation(tick) {
        const kinds = [
          "mining",
          "fishing",
          "woodcutting",
          "farming",
          "thieving",
          "cooking",
          "smithing",
          "fletching",
          "herblore",
          "crafting",
          "enhancing",
          "combat",
        ];
        const index = Math.floor(tick / 3000);
        for (let i = rotations.length; i <= index; i++) {
          let k = hash(i, 1, 1213158433) % kinds.length;
          if (i && k === rotations[i - 1]) k = (k + 1) % kinds.length;
          rotations.push(k);
        }
        const skill = kinds[rotations[index]],
          rare =
            ["mining", "fishing", "woodcutting", "farming", "combat"].includes(skill) &&
            hash(index, 2, 1213158433) % 3 === 0;
        return {
          skill,
          kind: rare ? "rarity" : "xp",
          mult: rare ? 1.25 : 1.2,
          until: (index + 1) * 3000,
        };
      }
      function world(windows, tick, key) {
        let value = 1;
        for (const w of windows || [])
          if (tick >= w.fromTick && tick <= w.toTick) value += (w[key] ?? 1) - 1;
        return value;
      }
      function xpMultiplier(p, job, tick, windows, watering = false) {
        const gathering = job.inputs.length === 0 || job.grow !== undefined;
        const r = rotation(tick);
        return (
          world(windows, tick, "xpMult") +
          0.1 * brew(p, "elixir", tick) +
          (gathering ? 0.1 * brew(p, "gatherer", tick) : 0) +
          (active(p, "blessing", tick) ? 0.05 : 0) +
          (p.guildBonus || 0) +
          (master(p, "xp") - 1) +
          (!watering && r.skill === job.skill && r.kind === "xp" ? r.mult - 1 : 0)
        );
      }
      const xp = (p, j, t, windows, rarity) =>
        Math.round(j.xp * c.xpRarity[rarity] * xpMultiplier(p, j, t, windows));
      function rarityProbabilities(p, j, t, windows, seedReturn = false) {
        const r = rotation(t),
          toolId = p.equipment?.[skillSlots[j.skill]],
          toolLuck = seedReturn ? 0 : c.toolLuck[tier(toolId || 0)] || 0;
        const multiplier =
          world(windows, t, "rarityMult") +
          0.25 * brew(p, "hunter", t) +
          (active(p, "blessing", t) ? 0.1 : 0) +
          (r.skill === j.skill && r.kind === "rarity" ? r.mult - 1 : 0) +
          home(p, "rareChance") +
          master(p, "rare") -
          1;
        const factor = (1 + luck(p) + toolLuck) * multiplier;
        const thresholds = [
          c.rareThresholds.uncommon,
          c.rareThresholds.rare,
          c.rareThresholds.epic,
          c.rareThresholds.legendary,
        ].map((x) => clamp(x * factor, 0, 1));
        return [
          1 - thresholds[0],
          thresholds[0] - thresholds[1],
          thresholds[1] - thresholds[2],
          thresholds[2] - thresholds[3],
          thresholds[3],
        ];
      }
      function draw(probs, random) {
        let u = random();
        for (let i = 0; i < probs.length; i++) {
          u -= probs[i];
          if (u < 0) return i;
        }
        return probs.length - 1;
      }
      function chance(p, j) {
        const lev = level(p.skills[j.skill]);
        const equipped = tool(p.equipment?.[skillSlots[j.skill]]);
        return Math.min(
          1,
          ((1 + Math.max(0, lev - j.levelReq) * 0.005) *
            (1 + (equipped?.slot === skillSlots[j.skill] ? equipped.bonus : 0)) *
            (1 +
              0.005 * (p.perks?.quick || 0) +
              home(p, gathers.has(j.skill) ? "gatherSpeed" : "craftSpeed", j.skill)) *
            master(p, gathers.has(j.skill) ? "gather" : "craft")) /
            j.baseTicks,
        );
      }
      function failure(p, j) {
        const f = j.burn || j.caught;
        return f
          ? clamp(
              f.chanceAtReq *
                (1 - (level(p.skills[j.skill]) - j.levelReq) / (f.safeAtLevel - j.levelReq)) *
                (1 - 0.03 * (p.perks?.hands || 0)),
              0,
              1,
            )
          : 0;
      }
      function inputs(j, rarity) {
        return j.inputs.map((x) => ({
          ...x,
          itemId:
            rarity &&
            eligible.has(x.itemId) &&
            x.itemId !== 5 &&
            !(x.itemId >= 201 && x.itemId <= 207)
              ? identity(x.itemId, rarity)
              : x.itemId,
        }));
      }
      const walkable = (x, y) =>
        x >= 0 &&
        y >= 0 &&
        x < map.width &&
        y < map.height &&
        map.collision[y * map.width + x] === 0;
      function canStep(x, y, nx, ny) {
        return walkable(nx, ny) && (x === nx || y === ny || (walkable(nx, y) && walkable(x, ny)));
      }
      function adjacent(site, id = 0) {
        const points = neighbors
          .map(([dx, dy]) => ({ x: site.x + dx, y: site.y + dy }))
          .filter((p) => walkable(p.x, p.y));
        return points[id === 0 ? 0 : hash(id, site.x, site.y) % points.length] || null;
      }
      function path(ax, ay, bx, by) {
        const key = [ax, ay, bx, by].join(",");
        if (paths.has(key)) return paths.get(key);
        if (!walkable(ax, ay) || !walkable(bx, by)) return null;
        const width = map.width,
          start = ay * width + ax,
          goal = by * width + bx,
          n = width * map.height;
        const g = new Float64Array(n).fill(Infinity),
          prev = new Int32Array(n).fill(-1);
        const heap = new Heap((a, b) => a.f - b.f || b.g - a.g || a.id - b.id);
        g[start] = 0;
        heap.push({ id: start, g: 0, f: octile(ax, ay, bx, by) });
        while (heap.q.length) {
          const u = heap.pop();
          if (u.g !== g[u.id]) continue;
          if (u.id === goal) {
            const out = [];
            for (let v = goal; v !== start; v = prev[v])
              out.push({ x: v % width, y: Math.floor(v / width) });
            out.reverse();
            if (paths.size > 2048) paths.clear();
            paths.set(key, out);
            return out;
          }
          const x = u.id % width,
            y = Math.floor(u.id / width);
          for (const [dx, dy] of neighbors) {
            const nx = x + dx,
              ny = y + dy;
            if (!canStep(x, y, nx, ny)) continue;
            const id = ny * width + nx,
              ng = u.g + (dx && dy ? Math.SQRT2 : 1);
            if (ng < g[id]) {
              g[id] = ng;
              prev[id] = u.id;
              heap.push({ id, g: ng, f: ng + octile(nx, ny, bx, by) });
            }
          }
        }
        paths.set(key, null);
        return null;
      }
      function bankDistance(bank, x, y) {
        let distances = bankFields.get(bank.id);
        if (!distances) {
          distances = new Int32Array(map.width * map.height).fill(-1);
          const queue = [];
          for (const [dx, dy] of neighbors)
            if (walkable(bank.x + dx, bank.y + dy)) {
              const i = (bank.y + dy) * map.width + bank.x + dx;
              distances[i] = 0;
              queue.push(i);
            }
          for (let at = 0; at < queue.length; at++) {
            const i = queue[at],
              cx = i % map.width,
              cy = Math.floor(i / map.width);
            for (const [dx, dy] of neighbors) {
              const nx = cx + dx,
                ny = cy + dy;
              if (!canStep(cx, cy, nx, ny)) continue;
              const ni = ny * map.width + nx;
              if (distances[ni] < 0) {
                distances[ni] = distances[i] + 1;
                queue.push(ni);
              }
            }
          }
          bankFields.set(bank.id, distances);
        }
        const d = distances[y * map.width + x];
        return d >= 0 ? d : Infinity;
      }
      function nearestBank(p) {
        const homeBank = map.banks.find((b) => b.id === p.homeBank);
        if (homeBank && Number.isFinite(bankDistance(homeBank, p.x, p.y))) return homeBank;
        return (
          [...map.banks]
            .sort((a, b) => bankDistance(a, p.x, p.y) - bankDistance(b, p.x, p.y) || a.id - b.id)
            .find((b) => Number.isFinite(bankDistance(b, p.x, p.y))) || null
        );
      }
      function nearestSite(j, p) {
        return map.sites
          .filter((s) => s.jobIds?.includes(j.id))
          .sort(
            (a, b) => octile(a.x, a.y, p.x, p.y) - octile(b.x, b.y, p.x, p.y) || a.id - b.id,
          )[0];
      }
      function farmingStatus(p) {
        const fields = map.sites
          .filter((s) => s.kind === "field")
          .sort((a, b) => a.id - b.id)
          .slice(
            0,
            (data.farming?.unlockLevels || [1]).filter((n) => level(p.skills.farming) >= n).length,
          );
        const matureAt = (plot) => {
          const job = data.jobs.find(
            (j) => j.grow !== undefined && j.inputs[0]?.itemId === base(plot.seedItemId),
          );
          if (!job) return null;
          const grow = Math.round(job.grow / (plot.sowSpeed ?? 1)),
            trim =
              plot.trim ??
              Math.min(plot.watered ?? 0, Math.floor(job.grow / 40)) *
                (data.farming?.waterTrim ?? 20);
          return plot.plantedAt + grow - Math.min(trim, Math.floor(grow / 2));
        };
        const ready = fields.filter(
          (s) => p.plots?.[s.id] && matureAt(p.plots[s.id]) <= p.lastTick,
        );
        const distance = (s) => Math.max(Math.abs(s.x - p.x), Math.abs(s.y - p.y));
        const next =
          [...ready].sort(
            (a, b) =>
              (distance(a) <= 1 ? 0 : distance(a)) - (distance(b) <= 1 ? 0 : distance(b)) ||
              a.id - b.id,
          )[0] ||
          fields.find((s) => !p.plots?.[s.id]) ||
          null;
        let stand = null;
        if (next)
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue;
              const x = next.x + dx,
                y = next.y + dy;
              if (!walkable(x, y)) continue;
              const score = ready.filter(
                  (s) => Math.max(Math.abs(s.x - x), Math.abs(s.y - y)) <= 1,
                ).length,
                dist = Math.max(Math.abs(p.x - x), Math.abs(p.y - y));
              if (!stand || score > stand.score || (score === stand.score && dist < stand.dist))
                stand = { x, y, score, dist };
            }
        return {
          fields: fields.map((s, i) => ({
            id: s.id,
            number: i + 1,
            x: s.x,
            y: s.y,
            plot: p.plots?.[s.id] || null,
            matureAt: p.plots?.[s.id] ? matureAt(p.plots[s.id]) : null,
            current: s.id === p.workSiteId,
          })),
          nextId: next?.id ?? null,
          stand,
          currentId: p.workSiteId ?? null,
          errand: !!p.route?.errand,
        };
      }
      const capacity = (p) => c.packSlots + (p.perks?.pockets || 0);
      const held = (p, id) => sum(p.pack.filter((x) => x.itemId === id).map((x) => x.qty));
      function put(p, id, qty) {
        if (qty <= 0) return true;
        if (item(id)?.stackable) {
          const entry = p.pack.find((x) => x.itemId === id);
          if (entry) {
            entry.qty += qty;
            return true;
          }
          if (p.pack.length >= capacity(p)) return false;
          p.pack.push({ itemId: id, qty });
          return true;
        }
        if (p.pack.length + qty > capacity(p)) return false;
        for (let i = 0; i < qty; i++) p.pack.push({ itemId: id, qty: 1 });
        return true;
      }
      function remove(p, id, qty) {
        for (let i = p.pack.length - 1; i >= 0 && qty > 0; i--) {
          if (p.pack[i].itemId !== id) continue;
          const take = Math.min(qty, p.pack[i].qty);
          p.pack[i].qty -= take;
          qty -= take;
          if (!p.pack[i].qty) p.pack.splice(i, 1);
        }
      }
      function canWork(p, j, rarity) {
        const ins = inputs(j, rarity);
        if (ins.some((x) => held(p, x.itemId) < x.qty)) return false;
        if (!ins.length) return p.pack.length < capacity(p);
        const output = identity(j.output.itemId, rarity);
        if (j.output.itemId === c.coins || (item(output)?.stackable && held(p, output) > 0))
          return true;
        let freed = 0;
        for (const x of ins)
          freed += item(x.itemId)?.stackable ? (held(p, x.itemId) === x.qty ? 1 : 0) : x.qty;
        return p.pack.length - freed < capacity(p);
      }
      function withdraw(p, j, rarity) {
        const ins = inputs(j, rarity),
          free = capacity(p) - p.pack.length;
        const nonstack = sum(ins.filter((x) => !item(x.itemId)?.stackable).map((x) => x.qty)),
          stack = ins.filter((x) => item(x.itemId)?.stackable).length,
          outStack = !!item(j.output.itemId)?.stackable;
        const max = nonstack
          ? Math.floor((free - stack - (outStack ? 1 : 0)) / nonstack)
          : outStack
            ? free - stack - 1 >= 0
              ? 1e9
              : 0
            : free - stack;
        const n = Math.max(
          0,
          Math.min(
            max,
            ...ins.map((x) => Math.floor(((p.bank[x.itemId] || 0) + held(p, x.itemId)) / x.qty)),
          ),
        );
        for (const x of ins) {
          const q = n * x.qty;
          add(p.bank, x.itemId, -q);
          put(p, x.itemId, q);
        }
        return n;
      }
      function run(options, random, mode) {
        const j = jobs.get(Number(options.jobId));
        if (!j) throw new Error("未知工作");
        if (j.grow !== undefined) return runFarm(options, random, mode);
        const p = clone(options.player),
          rarity = Number(options.rarity || 0),
          startTick = p.lastTick;
        if (level(p.skills[j.skill]) < j.levelReq) throw new Error("当前等级尚未解锁这个工作");
        p.pack = p.pack || [];
        p.bank = p.bank || {};
        p.skills = p.skills || {};
        const site =
          (p.route?.jobId === j.id && p.workRarity === rarity
            ? map.sites.find((s) => s.id === p.route.siteId)
            : null) || nearestSite(j, p);
        if (!site) throw new Error("没有找到可用工作地点");
        const ins = inputs(j, rarity);
        for (const x of ins) p.bank[x.itemId] = Math.max(p.bank[x.itemId] || 0, 1e9);
        const target = data.xpTable[options.targetLevel],
          deadline = mode === "hour" ? startTick + 6000 : Infinity;
        const r = {
          attempts: 0,
          successes: 0,
          burnt: 0,
          caught: 0,
          ticks: 0,
          workTicks: 0,
          walkTicks: 0,
          bankTicks: 0,
          stunTicks: 0,
          inputs: {},
          outputs: {},
          xp: 0,
          trips: 0,
        };
        const matching = p.route?.jobId === j.id && p.workRarity === rarity;
        if (mode !== "hour" && p.skills[j.skill] >= target) return r;
        let phase = matching ? p.route.phase : canWork(p, j, rarity) ? "toWork" : "toBank";
        let alreadyWorking = matching && p.activity === "working" && phase === "working";
        const near = (s) => Math.abs(p.x - s.x) <= 1 && Math.abs(p.y - s.y) <= 1;
        function advance(ticks, kind) {
          const used = Math.min(ticks, deadline - p.lastTick);
          p.lastTick += used;
          r[kind] += used;
          return used === ticks;
        }
        function travel(destination, id) {
          if (near(destination)) return true;
          const end = adjacent(destination, id);
          if (!end) throw new Error("目标地点不可达");
          const route = path(p.x, p.y, end.x, end.y);
          if (!route) throw new Error("无法寻路；请在主地图上再计算");
          if (!advance(1, "bankTicks")) return false;
          const speed = Math.round(
            (1000 + Math.round(bonus(p.equipment?.mount) * 1000)) *
              (1 + 0.2 * brew(p, "swift", p.lastTick)) *
              master(p, "move"),
          );
          if (!advance(Math.ceil((route.length * 1000) / speed), "walkTicks")) return false;
          p.x = end.x;
          p.y = end.y;
          return true;
        }
        // Resume the game's already planned walk, with its recorded speed/stride.
        if (matching && p.activity === "walking" && p.path?.length) {
          const remaining = p.path.length - (p.pathIndex || 0),
            ticks = Math.max(
              0,
              Math.ceil((remaining * 1000 - (p.stride || 0)) / (p.strideSpeed || 1000)),
            );
          if (advance(ticks, "walkTicks")) Object.assign(p, p.path.at(-1));
        }
        while (p.lastTick < deadline && (mode === "hour" || p.skills[j.skill] < target)) {
          if (r.attempts >= (options.maxAttempts || 150000))
            throw new Error("目标需要过多工作次数；请缩小目标等级或选择更高经验的工作");
          if (phase === "toWork") {
            if (!travel(site, p.id)) break;
            if (!advance(1, "bankTicks")) break;
            phase = "working";
            alreadyWorking = false;
            continue;
          }
          if (phase === "toBank") {
            const bank = nearestBank(p);
            if (!bank) throw new Error("找不到可达仓库");
            if (!travel(bank, 0)) break;
            if (!advance(1, "bankTicks")) break;
            phase = "banking";
            continue;
          }
          if (phase === "banking") {
            if (!advance(1, "bankTicks")) break;
            for (const x of p.pack) add(p.bank, x.itemId, x.qty);
            p.pack = [];
            if (ins.length && !withdraw(p, j, rarity)) throw new Error("背包无法容纳这份配方");
            r.trips++;
            if (!advance(1, "bankTicks")) break;
            phase = "toWork";
            continue;
          }
          if (!canWork(p, j, rarity)) {
            if (!advance(1, "bankTicks")) break;
            phase = "toBank";
            alreadyWorking = false;
            continue;
          }
          if (!alreadyWorking) {
            if (!advance(1, "bankTicks")) break;
            alreadyWorking = true;
          }
          if (
            (p.stunUntil || 0) > p.lastTick + 1 &&
            !advance(p.stunUntil - p.lastTick - 1, "stunTicks")
          )
            break;
          const probability = j.inputs.length === 0 && p.skills[j.skill] === 0 ? 1 : chance(p, j);
          const wait =
            probability === 1
              ? 1
              : Math.floor(Math.log(1 - random()) / Math.log(1 - probability)) + 1;
          if (!advance(wait, "workTicks")) break;
          r.attempts++;
          for (const x of ins) {
            remove(p, x.itemId, x.qty);
            add(r.inputs, x.itemId, x.qty);
          }
          if (random() < failure(p, j)) {
            if (j.burn) {
              r.burnt++;
              put(p, j.burn.itemId, 1);
              add(r.outputs, j.burn.itemId, 1);
            } else {
              r.caught++;
              p.stunUntil = p.lastTick + j.caught.stunTicks;
            }
            continue;
          }
          r.successes++;
          const gathering = !ins.length && j.output.itemId !== c.coins;
          const outputProbs = gathering
            ? rarityProbabilities(p, j, p.lastTick, options.windows)
            : null;
          const rt = gathering ? draw(outputProbs, random) : rarity;
          const output = j.output.itemId === c.coins ? c.coins : identity(j.output.itemId, rt),
            gain = xp(p, j, p.lastTick, options.windows, rt);
          p.skills[j.skill] += gain;
          r.xp += gain;
          // Price every rarity by its conditional expectation, including very rare tiers
          // which a small timing simulation may never actually draw.
          if (outputProbs)
            for (let t = 0; t < 5; t++)
              add(r.outputs, identity(j.output.itemId, t), outputProbs[t] * j.output.qty);
          else add(r.outputs, output, j.output.qty);
          if (output !== c.coins && !put(p, output, j.output.qty))
            add(p.bank, output, j.output.qty);
          if (j.bonus) {
            const probs = eligible.has(j.bonus.itemId)
              ? rarityProbabilities(p, j, p.lastTick, options.windows)
              : [1, 0, 0, 0, 0];
            const bonusTier = draw(probs, random);
            // Expected auxiliary loot is priced separately, avoiding rare-drop sample noise.
            const id = identity(
              j.bonus.itemId,
              seeds.has(j.bonus.itemId) ? Math.max(1, bonusTier) : bonusTier,
            );
            for (let t = 0; t < 5; t++)
              if (probs[t] > 0)
                add(
                  r.outputs,
                  identity(j.bonus.itemId, seeds.has(j.bonus.itemId) ? Math.max(1, t) : t),
                  probs[t] * j.bonus.chance,
                );
            if (random() < j.bonus.chance) put(p, id, 1);
          }
        }
        r.ticks = p.lastTick - startTick;
        return r;
      }
      function runFarm(options, random, mode) {
        // A single selected field: explicitly labelled in the UI. Other plots remain untouched.
        const j = jobs.get(Number(options.jobId)),
          p = clone(options.player),
          rarity = Number(options.rarity || 0),
          start = p.lastTick,
          target = data.xpTable[options.targetLevel];
        if (level(p.skills.farming) < j.levelReq) throw new Error("当前等级尚未解锁这项种植");
        const end = mode === "hour" ? start + 6000 : Infinity;
        const r = {
          attempts: 0,
          successes: 0,
          burnt: 0,
          caught: 0,
          ticks: 0,
          workTicks: 0,
          walkTicks: 0,
          bankTicks: 0,
          stunTicks: 0,
          inputs: {},
          outputs: {},
          xp: 0,
          trips: 0,
        };
        let seedStock = 0;
        function advance(ticks) {
          const n = Math.min(ticks, end - p.lastTick);
          p.lastTick += n;
          r.workTicks += n;
          return n === ticks;
        }
        while (p.lastTick < end && (mode === "hour" || p.skills.farming < target)) {
          if (r.attempts >= (options.maxAttempts || 150000)) throw new Error("种植目标过大");
          const seed = identity(j.inputs[0].itemId, rarity),
            cost = j.inputs[0].qty;
          if (seedStock < cost) {
            add(r.inputs, seed, cost - seedStock);
            seedStock = cost;
          }
          seedStock -= cost;
          const planted = p.lastTick;
          if (!advance(1)) break;
          const grow = Math.round(j.grow / (1 + home(p, "gatherSpeed", "farming"))),
            maxWater = Math.floor(j.grow / 40),
            trimEach = Math.round(20 * (1 + bonus(p.equipment?.hoe)));
          let trim = 0,
            watered = 0;
          while (p.lastTick < planted + grow - Math.min(trim, Math.floor(grow / 2))) {
            const mature = planted + grow - Math.min(trim, Math.floor(grow / 2)),
              next = (Math.floor(p.lastTick / 100) + 1) * 100;
            if (watered < maxWater && next < mature) {
              if (!advance(next - p.lastTick)) break;
              watered++;
              trim += trimEach;
              const gain = Math.max(
                1,
                Math.round(j.xp * 0.1 * xpMultiplier(p, j, p.lastTick, options.windows, true)),
              );
              p.skills.farming += gain;
              r.xp += gain;
              if (mode !== "hour" && p.skills.farming >= target) break;
            } else {
              advance(mature - p.lastTick);
              break;
            }
          }
          if (p.lastTick >= end || (mode !== "hour" && p.skills.farming >= target)) break;
          if (!advance(1)) break;
          r.attempts++;
          r.successes++;
          const lev = level(p.skills.farming),
            count =
              3 +
              Math.floor(random() * 3) +
              Math.floor(lev / 100) +
              (random() < (lev / 100) % 1 ? 1 : 0);
          add(r.outputs, identity(j.output.itemId, rarity), count);
          const gain = xp(p, j, p.lastTick, options.windows, rarity);
          p.skills.farming += gain;
          r.xp += gain;
          for (let k = 0; k < cost; k++) {
            const rt = draw(rarityProbabilities(p, j, p.lastTick, options.windows, true), random);
            const id = identity(j.inputs[0].itemId, rt);
            if (rt === rarity) seedStock++;
            else add(r.outputs, id, 1);
          }
        }
        r.ticks = p.lastTick - start;
        return r;
      }
      const quantile = (values, q) => {
        const xs = [...values].sort((a, b) => a - b);
        return xs[Math.min(xs.length - 1, Math.ceil(q * xs.length) - 1)] || 0;
      };
      function summarize(runs) {
        const result = {};
        for (const k of [
          "attempts",
          "successes",
          "burnt",
          "caught",
          "ticks",
          "workTicks",
          "walkTicks",
          "bankTicks",
          "stunTicks",
          "xp",
          "trips",
        ])
          result[k] = sum(runs.map((x) => x[k])) / runs.length;
        for (const k of ["inputs", "outputs"]) {
          result[k] = {};
          for (const r of runs)
            for (const [id, n] of Object.entries(r[k])) add(result[k], id, n / runs.length);
        }
        result.seconds = (result.ticks * c.tickMs) / 1000;
        result.secondsP05 = quantile(
          runs.map((r) => (r.ticks * c.tickMs) / 1000),
          0.05,
        );
        result.secondsP95 = quantile(
          runs.map((r) => (r.ticks * c.tickMs) / 1000),
          0.95,
        );
        result.attemptsP95 = quantile(
          runs.map((r) => r.attempts),
          0.95,
        );
        result.materialsP95 = {};
        for (const id of Object.keys(result.inputs))
          result.materialsP95[id] = quantile(
            runs.map((r) => r.inputs[id] || 0),
            0.95,
          );
        return result;
      }
      function forecast(options) {
        if (
          !Number.isSafeInteger(options.player?.lastTick) ||
          !Number.isFinite(options.player?.skills?.[jobs.get(Number(options.jobId))?.skill])
        )
          throw new Error("等待有效角色快照");
        if (
          jobs.get(Number(options.jobId)).grow === undefined &&
          map.regions?.some(
            (r) =>
              r.name === "Home" &&
              options.player.x >= r.x &&
              options.player.y >= r.y &&
              options.player.x < r.x + r.width &&
              options.player.y < r.y + r.height,
          )
        )
          throw new Error("动态家园路线尚未校准；请返回主地图后计算完整时间");
        const current = level(options.player.skills[jobs.get(Number(options.jobId)).skill]);
        if (
          !Number.isInteger(options.targetLevel) ||
          options.targetLevel < 1 ||
          options.targetLevel >= data.xpTable.length
        )
          throw new Error(`目标等级须为 1–${data.xpTable.length - 1} 的整数`);
        const count = clamp(options.samples || 32, 8, 128),
          planRuns = [],
          hourRuns = [];
        for (let i = 0; i < count; i++) {
          planRuns.push(run(options, rng(7919 * (i + 1)), "target"));
          hourRuns.push(run(options, rng(104729 * (i + 1)), "hour"));
        }
        const plan = summarize(planRuns),
          hour = summarize(hourRuns);
        const materials = Object.entries(plan.inputs).map(([id, mean]) => {
          id = Number(id);
          const owned =
            (options.player.bank?.[id] || 0) +
            held({ ...options.player, pack: options.player.pack || [] }, id);
          return {
            id,
            mean,
            p95: plan.materialsP95[id],
            owned,
            shortage: Math.max(0, Math.ceil(mean) - owned),
            shortageP95: Math.max(0, Math.ceil(plan.materialsP95[id]) - owned),
          };
        });
        return {
          jobId: Number(options.jobId),
          currentLevel: current,
          targetLevel: options.targetLevel,
          xpLeft: Math.max(
            0,
            data.xpTable[options.targetLevel] -
              options.player.skills[jobs.get(Number(options.jobId)).skill],
          ),
          samples: count,
          plan,
          hour,
          materials,
          farming: jobs.get(Number(options.jobId)).grow !== undefined,
          build: data.version.version,
        };
      }
      function forecastHour(options) {
        const j = jobs.get(Number(options.jobId));
        if (
          !j ||
          !Number.isSafeInteger(options.player?.lastTick) ||
          !Number.isFinite(options.player.skills?.[j.skill])
        )
          throw new Error("等待有效角色快照");
        if (
          j.grow === undefined &&
          map.regions?.some(
            (r) =>
              r.name === "Home" &&
              options.player.x >= r.x &&
              options.player.y >= r.y &&
              options.player.x < r.x + r.width &&
              options.player.y < r.y + r.height,
          )
        )
          throw new Error("家园路线尚未校准");
        const count = clamp(options.samples || 8, 8, 128),
          runs = [];
        for (let i = 0; i < count; i++) runs.push(run(options, rng(104729 * (i + 1)), "hour"));
        return {
          jobId: j.id,
          hour: summarize(runs),
          samples: count,
          farming: j.grow !== undefined,
        };
      }
      return {
        data,
        jobs,
        item,
        level,
        base,
        tier,
        inputs,
        tool,
        brew,
        brewTier,
        master,
        home,
        rotation,
        xpMultiplier,
        xp,
        rarityProbabilities,
        chance,
        failure,
        path,
        adjacent,
        nearestBank,
        nearestSite,
        farmingStatus,
        forecast,
        forecastHour,
        run,
        summarize,
        rng,
      };
    }
    function fillBook(levels, qty, side, taxBp = 0) {
      let left = qty,
        gross = 0;
      const fills = [];
      for (const l of [...levels]
        .filter((l) => l.price > 0 && l.qty > 0)
        .sort((a, b) => (side === "buy" ? a.price - b.price : b.price - a.price))) {
        const n = Math.min(left, l.qty);
        if (n <= 0) break;
        left -= n;
        gross += n * l.price;
        fills.push({ price: l.price, qty: n });
      }
      return {
        gross,
        net: side === "sell" ? gross * (1 - taxBp / 10000) : gross,
        filled: qty - left,
        left,
        fills,
      };
    }
    function vendorPrice(id, books, pricing = {}) {
      // Enhancements do not change buyback value; received server floors take precedence.
      const plain = id % 10000,
        price = books[id]?.floor ?? pricing.vendorPrices?.[plain];
      return price > 0 ? price : null;
    }
    function valueFlows(flow, books, mode, taxBp, now = Date.now(), pricing = {}) {
      const missing = [],
        stale = [],
        partial = [],
        details = [],
        estimated = [];
      let total = 0,
        unknownTax = false;
      const put = (id, qty, price, source, extra = {}) => {
        if (qty <= 1e-9) return;
        const taxed = source === "market" && mode !== "buy";
        if (taxed && taxBp == null) unknownTax = true;
        const value = qty * price * (taxed ? 1 - (taxBp ?? 0) / 10000 : 1);
        total += value;
        details.push({ id, qty, value, price, source, ...extra });
      };
      for (const [key, qty] of Object.entries(flow)) {
        const id = Number(key);
        if (!(qty > 0)) continue;
        if (id === 200) {
          put(id, qty, 1, "coins");
          continue;
        }
        const b = books[id] || {},
          sell = mode !== "buy",
          vendor = sell ? vendorPrice(id, books, pricing) : pricing.vendorBuys?.[id],
          factor = sell ? 1 - (taxBp ?? 0) / 10000 : 1;
        const quote =
          mode === "buy" ? b.ask : mode === "sell" ? b.bid : mode === "list" ? b.ask : null;
        const side = mode === "sell" ? "bid" : "ask",
          quoteAt = b[side + "At"] ?? b.at,
          depthAt = b[side + "DepthAt"] ?? b.depthAt;
        if (mode !== "vendor" && quote > 0 && now - (quoteAt || 0) > 300000) stale.push(id);
        const levels = mode === "buy" ? b.asks : mode === "sell" ? b.bids : null;
        let left = qty;
        if (mode !== "vendor" && Array.isArray(levels)) {
          const old = now - (depthAt || 0) > 300000;
          const useful = levels.filter(
            (x) => !(vendor > 0) || (sell ? x.price * factor > vendor : x.price < vendor),
          );
          const fill = fillBook(useful, qty, mode, taxBp ?? 0);
          for (const f of fill.fills)
            put(id, f.qty, f.price, "market", { depth: !old, estimated: old, quoteAt: depthAt });
          if (old && fill.filled > 0) estimated.push(id);
          left = fill.left;
        } else if (
          mode !== "vendor" &&
          quote > 0 &&
          (!(vendor > 0) || (sell ? quote * factor > vendor : quote < vendor))
        ) {
          const old = now - (quoteAt || 0) > 300000,
            available =
              mode === "list"
                ? qty
                : Number.isFinite(b[side + "Qty"])
                  ? Math.max(0, b[side + "Qty"])
                  : qty,
            filled = Math.min(qty, available);
          put(id, filled, quote, "market", { depth: false, estimated: old, quoteAt });
          if (old && filled > 0) estimated.push(id);
          left = qty - filled;
        }
        if (left > 1e-9 && vendor > 0) {
          put(id, left, vendor, "vendor");
          left = 0;
        }
        // Restored asks are short-lived cost estimates, never executable orders.
        // Prefer more recent trade history when it supersedes the cached ask.
        const history =
          mode === "buy" &&
          b.history?.price > 0 &&
          Number.isFinite(b.history.tradeAt) &&
          b.history.tradeAt <= now &&
          now - b.history.tradeAt <= 7 * 86400000
            ? b.history
            : null;
        const cached =
          mode === "buy" &&
          Number.isFinite(b.purchaseCache?.price) &&
          b.purchaseCache.price > 0 &&
          Number.isFinite(b.purchaseCache.at) &&
          b.purchaseCache.at <= now &&
          now - b.purchaseCache.at <= 86400000
            ? b.purchaseCache
            : null;
        if (left > 1e-9 && (cached || history)) {
          if (cached && (!history || cached.at > history.tradeAt))
            put(id, left, cached.price, "cached", { estimated: true, cachedAt: cached.at });
          else
            put(id, left, history.price, "history", { estimated: true, tradeAt: history.tradeAt });
          estimated.push(id);
          left = 0;
        }
        // Known nontradable outputs have no cash resale value, rather than an unknown price.
        if (
          left > 1e-9 &&
          sell &&
          Object.hasOwn(pricing.vendorPrices || {}, id % 10000) &&
          pricing.vendorPrices[id % 10000] === null
        ) {
          put(id, left, 0, "nontradable");
          left = 0;
        }
        if (left > 1e-9) {
          if (left < qty) partial.push({ id, unfilled: left, filled: qty - left });
          else missing.push(id);
          details.push({ id, qty: left, value: null, source: "missing" });
        }
      }
      return {
        total: missing.length || partial.length || unknownTax ? null : total,
        pricedSubtotal: total,
        missing,
        stale,
        partial,
        details,
        estimated,
        unknownTax,
        vendorSubtotal: sum(details.filter((x) => x.source === "vendor").map((x) => x.value)),
        coinSubtotal: sum(details.filter((x) => x.source === "coins").map((x) => x.value)),
      };
    }
    function profits(hour, books, taxBp, now, pricing = {}) {
      const cost = valueFlows(hour.inputs, books, "buy", taxBp, now, pricing),
        immediate = valueFlows(hour.outputs, books, "sell", taxBp, now, pricing),
        listing = valueFlows(hour.outputs, books, "list", taxBp, now, pricing),
        vendor = valueFlows(hour.outputs, books, "vendor", taxBp, now, pricing);
      const net = (revenue) =>
        revenue.total !== null && cost.total !== null ? revenue.total - cost.total : null;
      return {
        cost,
        immediate,
        listing,
        vendor,
        immediateProfit: net(immediate),
        listingProfit: net(listing),
        vendorProfit: net(vendor),
        immediateKnownNet: immediate.pricedSubtotal - cost.pricedSubtotal,
        listingKnownNet: listing.pricedSubtotal - cost.pricedSubtotal,
        vendorKnownNet: vendor.pricedSubtotal - cost.pricedSubtotal,
      };
    }
    function dailyProfits(hour, books, taxBp, now, pricing) {
      const daily = { inputs: {}, outputs: {} };
      for (const kind of ["inputs", "outputs"])
        for (const [id, n] of Object.entries(hour[kind] || {})) daily[kind][id] = n * 24;
      // Quote depth is consumed once across the whole projected day.
      return profits(daily, books, taxBp, now, pricing);
    }
    function formatNumber(n, d = 0) {
      if (!Number.isFinite(n)) return "—";
      const units = ["", "K", "M", "B"];
      let i = Math.min(3, Math.max(0, Math.floor(Math.log10(Math.max(1, Math.abs(n))) / 3)));
      let scaled = n / 1000 ** i;
      if (i && Math.abs(Number(scaled.toFixed(2))) >= 1000 && i < 3) {
        i++;
        scaled = n / 1000 ** i;
      }
      const text = scaled.toLocaleString("en-US", { maximumFractionDigits: i ? 2 : d });
      return (text === "-0" ? "0" : text) + units[i];
    }
    return {
      create,
      hash,
      rng,
      fillBook,
      vendorPrice,
      valueFlows,
      profits,
      dailyProfits,
      formatNumber,
    };
  });

  // ---- src/observer.js ----
  /* Observe objects already parsed by the client. Never sends a game message. */
  (function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.DVIPlannerObserver = factory();
  })(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";
    const HISTORY_MAX_AGE = 7 * 86400000,
      PURCHASE_MAX_AGE = 86400000;
    const numericCounts = (value) =>
      Object.fromEntries(
        Object.entries(value || {}).filter(
          ([id, n]) =>
            Number.isSafeInteger(Number(id)) && Number(id) > 0 && Number.isFinite(n) && n >= 0,
        ),
      );
    function historicalPrice(rows, frameTick, now, source) {
      if (!Array.isArray(rows) || !Number.isSafeInteger(frameTick) || !Number.isFinite(now))
        return null;
      const valid = rows.filter(
        (x) =>
          x &&
          typeof x === "object" &&
          Number.isSafeInteger(x.tick) &&
          x.tick <= frameTick &&
          frameTick - x.tick <= HISTORY_MAX_AGE / 600 &&
          Number.isFinite(x.price) &&
          x.price > 0 &&
          Number.isFinite(x.qty) &&
          x.qty > 0,
      );
      const recent = valid.filter((x) => frameTick - x.tick <= 86400000 / 600),
        chosen = recent.length ? recent : valid;
      if (!chosen.length) return null;
      const sorted = [...chosen].sort((a, b) => a.price - b.price),
        volume = sorted.reduce((n, x) => n + x.qty, 0);
      if (!Number.isFinite(volume)) return null;
      let accumulated = 0,
        price = null;
      for (const x of sorted) {
        accumulated += x.qty;
        if (accumulated >= volume / 2) {
          price = x.price;
          break;
        }
      }
      return {
        price,
        tradeAt:
          now - (frameTick - chosen.reduce((last, x) => Math.max(last, x.tick), -Infinity)) * 600,
        receivedAt: now,
        source,
        volume,
        periodDays: recent.length ? 1 : 7,
      };
    }
    function createStore(now = () => Date.now(), cache = {}, purchaseCache = {}) {
      const state = {
        player: null,
        windows: [],
        books: {},
        orders: [],
        taxBp: null,
        frameTick: null,
        receivedAt: null,
        revision: 0,
        offline: null,
        seen: null,
        marketAway: [],
        marketAwayTick: null,
        settlements: [],
        settlementFloorTick: null,
        lastDropTick: null,
      };
      const listeners = new Set(),
        batchListeners = new Set();
      const histories = {};
      for (const [id, h] of Object.entries(
        cache && typeof cache === "object" && !Array.isArray(cache) ? cache : {},
      ))
        if (
          Number.isSafeInteger(Number(id)) &&
          Number(id) > 0 &&
          h &&
          Number.isFinite(h.price) &&
          h.price > 0 &&
          Number.isFinite(h.tradeAt) &&
          h.tradeAt <= now() &&
          now() - h.tradeAt <= HISTORY_MAX_AGE &&
          ["chart", "trades"].includes(h.source)
        )
          histories[id] = {
            price: h.price,
            tradeAt: h.tradeAt,
            receivedAt: h.receivedAt,
            source: h.source,
            volume: h.volume,
            periodDays: h.periodDays,
          };
      const purchases = {};
      const validPurchase = (q) =>
        q &&
        Number.isFinite(q.price) &&
        q.price > 0 &&
        Number.isFinite(q.at) &&
        q.at <= now() &&
        now() - q.at <= PURCHASE_MAX_AGE;
      for (const [id, q] of Object.entries(
        purchaseCache && typeof purchaseCache === "object" && !Array.isArray(purchaseCache)
          ? purchaseCache
          : {},
      ))
        if (Number.isSafeInteger(Number(id)) && Number(id) > 0 && validPurchase(q))
          purchases[id] = { price: q.price, at: q.at };
      const restoreHistory = () => {
        for (const [id, history] of Object.entries(histories))
          if (now() - history.tradeAt <= HISTORY_MAX_AGE)
            state.books[id] = { history: { ...history } };
        for (const [id, q] of Object.entries(purchases))
          if (validPurchase(q)) state.books[id] = { ...state.books[id], purchaseCache: { ...q } };
      };
      function recordPurchase(id, price) {
        if (Number.isFinite(price) && price > 0) purchases[id] = { price, at: now() };
        else delete purchases[id];
      }
      restoreHistory();
      function recordHistory(id, rows, tick, source) {
        if (!Number.isSafeInteger(id) || id <= 0 || !Array.isArray(rows)) return false;
        const history = historicalPrice(rows, tick, now(), source),
          old = histories[id];
        if (!history) return false;
        if (
          (old && old.tradeAt > history.tradeAt) ||
          (old && old.tradeAt === history.tradeAt && old.source === "chart" && source === "trades")
        )
          return false;
        histories[id] = history;
        state.books[id] = { ...state.books[id], history };
        return true;
      }
      const validPlayer = (p) =>
        p &&
        typeof p === "object" &&
        p.skills &&
        p.equipment &&
        Array.isArray(p.pack) &&
        p.bank &&
        Number.isSafeInteger(p.lastTick);
      function ownQty(id, side, price) {
        return state.orders
          .filter((x) => x.itemId === id && x.side === side && x.price === price)
          .reduce((n, x) => n + (x.qtyRemaining || 0), 0);
      }
      function top(value) {
        if (!value || !Number.isSafeInteger(value.itemId) || value.itemId <= 0) return;
        const old = { ...state.books[value.itemId] };
        const copy = { itemId: value.itemId };
        for (const key of ["bid", "ask", "bidQty", "askQty", "floor", "traded"])
          if (value[key] === null || (Number.isFinite(value[key]) && value[key] >= 0))
            copy[key] = value[key];
        for (const key of ["bidMore", "askMore"])
          if (typeof value[key] === "boolean") copy[key] = value[key];
        for (const [quote, side, levels] of [
          ["bid", "buy", "bids"],
          ["ask", "sell", "asks"],
        ]) {
          const own = ownQty(copy.itemId, side, copy[quote]);
          if (own > 0) {
            if (copy[quote + "Qty"] === undefined || copy[quote + "Qty"] <= own) copy[quote] = null;
            else copy[quote + "Qty"] -= own;
          }
          const changed = [quote, quote + "Qty"].some(
            (k) => copy[k] !== undefined && copy[k] !== old[k],
          );
          if (changed) {
            delete old[levels];
            delete old[quote + "DepthAt"];
            if (copy[quote] !== undefined && copy[quote] !== old[quote]) {
              delete old[quote + "Qty"];
              delete old[quote + "More"];
            }
          }
          if (copy[quote] !== undefined || copy[quote + "Qty"] !== undefined)
            copy[quote + "At"] = now();
        }
        // A restored cost estimate is not an order. Any explicit fresh ask replaces
        // it, including an empty market; known finite depth stays finite.
        if (Object.hasOwn(copy, "ask")) {
          recordPurchase(copy.itemId, copy.ask);
          delete old.purchaseCache;
        }
        state.books[value.itemId] = { ...old, ...copy, at: now() };
      }
      function receive(frame) {
        // The game parses its own last-seen record immediately before building an
        // in-tab away report. Observe that already-read record, without querying.
        if (
          frame &&
          frame.id === state.player?.id &&
          Number.isSafeInteger(frame.tick) &&
          frame.items &&
          frame.found &&
          frame.skills &&
          !Array.isArray(frame.m)
        ) {
          state.seen = {
            id: frame.id,
            tick: frame.tick,
            items: numericCounts(frame.items),
            found: numericCounts(frame.found),
            coins: frame.coins,
          };
          state.revision++;
          for (const listener of listeners) {
            try {
              listener(state);
            } catch {}
          }
          return;
        }
        if (!frame || !Number.isSafeInteger(frame.tick) || !Array.isArray(frame.m)) return;
        let changed = false;
        for (const m of frame.m) {
          if (!m || typeof m !== "object") continue;
          switch (m.t) {
            case "welcome":
              if (!validPlayer(m.you)) break;
              state.player = m.you;
              state.orders = Array.isArray(m.orders) ? m.orders : [];
              state.books = {};
              restoreHistory();
              state.windows = Array.isArray(m.windows) ? m.windows : [];
              state.taxBp =
                Number.isInteger(m.marketTaxBp) && m.marketTaxBp >= 0 && m.marketTaxBp <= 10000
                  ? m.marketTaxBp
                  : null;
              state.offline =
                m.offline && Number.isFinite(m.offline.ticksApplied)
                  ? {
                      ticksApplied: m.offline.ticksApplied,
                      ticksElapsed: m.offline.ticksElapsed,
                      endTick: m.you.lastTick,
                      itemsGained: numericCounts(m.offline.itemsGained),
                      coins: m.offline.coins,
                      drops: m.offline.drops,
                    }
                  : null;
              state.seen = null;
              state.marketAway = Array.isArray(m.marketAway)
                ? m.marketAway
                    .filter((x) => x && ["sold", "bought"].includes(x.side))
                    .map((x) => ({ itemId: x.itemId, qty: x.qty, coins: x.coins, side: x.side }))
                : [];
              state.marketAwayTick = m.you.lastTick;
              state.settlements = [];
              state.settlementFloorTick = null;
              state.lastDropTick = null;
              changed = true;
              break;
            case "batch":
              if (Array.isArray(m.e)) {
                if (m.e.some((e) => e?.kind === "dropped")) state.lastDropTick = frame.tick;
                const events = m.e
                  .filter(
                    (e) =>
                      e &&
                      [
                        "produced",
                        "bonus",
                        "pet",
                        "mount",
                        "voidshard",
                        "killed",
                        "dropped",
                      ].includes(e.kind),
                  )
                  .map((e) => ({
                    kind: e.kind,
                    itemId: e.itemId,
                    qty: e.qty,
                    coins: e.coins,
                    jobId: e.jobId,
                    monsterId: e.monsterId,
                  }));
                if (events.length)
                  for (const listener of batchListeners) {
                    try {
                      listener({ tick: frame.tick, events });
                    } catch {}
                  }
              }
              break;
            case "snapshot":
              if (validPlayer(m.you)) {
                state.player = m.you;
                if (Array.isArray(m.orders)) state.orders = m.orders;
                if (Array.isArray(m.windows)) state.windows = m.windows;
                changed = true;
              }
              break;
            case "windows":
              if (Array.isArray(m.windows)) {
                state.windows = m.windows;
                changed = true;
              }
              break;
            case "marketBook":
              top(m.top);
              changed = true;
              break;
            case "marketBooks":
              for (const v of m.tops || []) top(v);
              changed = true;
              break;
            case "marketStock":
              if (Array.isArray(m.summary))
                for (const s of m.summary)
                  if (Array.isArray(s))
                    top({
                      itemId: s[0],
                      ask: s[1] > 0 ? s[1] : null,
                      bid: s[2] > 0 ? s[2] : null,
                      traded: s[3] || 0,
                    });
              changed = true;
              break;
            case "marketDepth":
              if (Number.isInteger(m.itemId) && Array.isArray(m.bids) && Array.isArray(m.asks)) {
                const other = (levels, side) =>
                  levels
                    .map((x) => ({
                      ...x,
                      qty: Math.max(0, x.qty - ownQty(m.itemId, side, x.price)),
                    }))
                    .filter((x) => x.price > 0 && x.qty > 0);
                const bids = other(m.bids, "buy"),
                  asks = other(m.asks, "sell");
                const bid = bids.length ? Math.max(...bids.map((x) => x.price)) : null,
                  ask = asks.length ? Math.min(...asks.map((x) => x.price)) : null;
                state.books[m.itemId] = {
                  ...state.books[m.itemId],
                  itemId: m.itemId,
                  bids,
                  asks,
                  bid,
                  ask,
                  bidQty: bids.filter((x) => x.price === bid).reduce((n, x) => n + x.qty, 0),
                  askQty: asks.filter((x) => x.price === ask).reduce((n, x) => n + x.qty, 0),
                  bidAt: now(),
                  askAt: now(),
                  bidDepthAt: now(),
                  askDepthAt: now(),
                  at: now(),
                  depthAt: now(),
                };
                changed = true;
                recordPurchase(m.itemId, ask);
                delete state.books[m.itemId].purchaseCache;
                recordHistory(m.itemId, m.trades, frame.tick, "trades");
              }
              break;
            case "marketChart":
              if (Array.isArray(m.points))
                changed =
                  recordHistory(
                    m.itemId,
                    m.points
                      .filter((x) => x && typeof x === "object")
                      .map((x) => ({ tick: x.tick, price: x.avg, qty: x.vol })),
                    frame.tick,
                    "chart",
                  ) || changed;
              break;
            // A fill invalidates depth. Do not reuse a consumed order as available volume.
            case "marketFilled":
              if (
                Number.isSafeInteger(m.itemId) &&
                m.itemId > 0 &&
                Number.isFinite(m.qty) &&
                m.qty > 0 &&
                Number.isFinite(m.coins) &&
                m.coins >= 0 &&
                ["buy", "sell"].includes(m.side)
              ) {
                const coins =
                  m.side === "sell"
                    ? Math.max(0, m.coins - (Number.isFinite(m.tax) && m.tax >= 0 ? m.tax : 0))
                    : m.coins;
                state.settlements.push({
                  tick: frame.tick,
                  itemId: m.itemId,
                  qty: m.qty,
                  coins,
                  side: m.side === "buy" ? "bought" : "sold",
                });
                const kept = state.settlements
                    .filter((x) => x.tick >= frame.tick - 288000)
                    .slice(-2000),
                  removed = state.settlements.length - kept.length;
                if (removed) state.settlementFloorTick = state.settlements[removed - 1].tick;
                state.settlements = kept;
                changed = true;
              }
              if (state.books[m.itemId]) {
                recordPurchase(m.itemId, null);
                const b = state.books[m.itemId];
                delete b.purchaseCache;
                delete b.bids;
                delete b.asks;
                b.bid = null;
                b.ask = null;
                delete b.bidQty;
                delete b.askQty;
                b.bidAt = 0;
                b.askAt = 0;
                b.at = 0;
                changed = true;
              }
              break;
          }
        }
        if (changed) {
          state.frameTick = frame.tick;
          state.receivedAt = now();
          state.revision++;
          for (const listener of listeners) {
            try {
              listener(state);
            } catch {}
          }
        }
      }
      return {
        state,
        receive,
        exportPurchases() {
          return Object.fromEntries(
            Object.entries(purchases)
              .filter(([, q]) => validPurchase(q))
              .sort((a, b) => b[1].at - a[1].at)
              .slice(0, 2000)
              .map(([id, q]) => [id, { ...q }]),
          );
        },
        exportHistory() {
          return Object.fromEntries(
            Object.entries(histories)
              .filter(([, h]) => now() - h.tradeAt <= HISTORY_MAX_AGE)
              .sort((a, b) => b[1].tradeAt - a[1].tradeAt)
              .slice(0, 2000)
              .map(([id, h]) => [id, { ...h }]),
          );
        },
        subscribe(fn) {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
        subscribeBatches(fn) {
          batchListeners.add(fn);
          return () => batchListeners.delete(fn);
        },
      };
    }
    function install(page, store) {
      const nativeParse = page.JSON.parse;
      function observedParse(...args) {
        const result = Reflect.apply(nativeParse, this, args);
        try {
          if (typeof args[0] === "string") store.receive(result);
        } catch {}
        return result;
      }
      page.JSON.parse = observedParse;
      return () => {
        if (page.JSON.parse === observedParse) page.JSON.parse = nativeParse;
      };
    }
    return { createStore, install, historicalPrice };
  });

  // ---- src/combat.js ----
  /* Passive current-fight sampling. Counters and inventory are copied, never changed. */
  (function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.DVICombat = factory();
  })(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";
    const kinds = ["warrior", "haste", "abyssal", "nourish", "hunter", "elixir", "swift"];
    const RATE_WINDOW = 3000,
      EPH_WINDOW = 500; // 30-minute valuation, 5-minute current encounter rate.
    const skills = ["melee", "ranged", "magic", "defence", "hitpoints"];
    const add = (flow, id, n) => {
      if (n) flow[id] = (flow[id] || 0) + n;
    };
    function inventory(p) {
      const counts = { ...p.bank };
      for (const s of p.pack || []) add(counts, s.itemId, s.qty);
      return counts;
    }
    function foodEligible(model, p, id) {
      return (
        (model.item(id)?.heals || 0) > 0 &&
        (model.tier(id) <= (p.foodMaxTier ?? 0) || id === p.foodItemId)
      );
    }
    function selectedFood(model, p) {
      const pack = p.pack || [];
      if (p.foodItemId > 0 && pack.some((x) => x.itemId === p.foodItemId && x.qty > 0))
        return p.foodItemId;
      const held = pack.find((x) => x.qty > 0 && foodEligible(model, p, x.itemId));
      if (held) return held.itemId;
      if (p.foodItemId > 0 && p.bank?.[p.foodItemId] > 0) return p.foodItemId;
      return (
        Object.keys(p.bank || {})
          .map(Number)
          .filter((id) => p.bank[id] > 0 && foodEligible(model, p, id))
          .sort(
            (a, b) =>
              (model.item(b).heals - model.item(a).heals) * (p.foodItemId === -2 ? -1 : 1) || a - b,
          )[0] ?? null
      );
    }
    function potionFlow(model, p, start, end, potionKinds = kinds) {
      const out = {};
      for (const kind of potionKinds) {
        let tick = start;
        while (tick < end && (p.brews?.[kind] || 0) > tick) {
          const tier = model.brewTier(p, kind, tick),
            buckets = p.brewBuckets?.[kind];
          let until = p.brews[kind];
          if (buckets?.length) {
            let accumulated = 0;
            for (let i = buckets.length - 1; i >= tier; i--) accumulated += buckets[i];
            until = Math.min(
              until,
              p.brews[kind] - buckets.reduce((a, b) => a + b, 0) + accumulated,
            );
          }
          until = Math.min(end, until);
          if (until <= tick) break;
          const potion = model.data.potions.find((x) => x.kind === kind && x.tier === tier);
          if (potion) add(out, potion.id, (until - tick) / model.data.constants.potionTicks);
          tick = until;
        }
      }
      return out;
    }
    function loot(model, p, monster, tick, windows = []) {
      const out = {},
        facts = model.data.combat;
      let gold = 0;
      for (let n = monster.gold[0]; n <= monster.gold[1]; n++)
        gold += Math.floor(n * (1 + facts.abyssalCoins * model.brew(p, "abyssal", tick)));
      add(out, 200, gold / (monster.gold[1] - monster.gold[0] + 1));
      const probs = model.rarityProbabilities(p, { skill: "combat", inputs: [] }, tick, windows);
      probs.forEach((prob, tier) =>
        add(out, monster.drop + tier * 1000, (monster.dropChance ?? 1) * prob),
      );
      let rare = 1;
      for (const w of windows)
        if (tick >= w.fromTick && tick <= w.toTick) rare += (w.rarityMult ?? 1) - 1;
      const rotation = model.rotation(tick);
      rare +=
        0.25 * model.brew(p, "hunter", tick) +
        ((p.brews?.blessing || 0) > tick ? 0.1 : 0) +
        (rotation.skill === "combat" && rotation.kind === "rarity" ? 0.25 : 0) +
        model.master(p, "rare") -
        1;
      const amulet = p.equipment?.amulet || 0,
        gear = model.data.gear.find((x) => x.itemId === amulet % 10000);
      const luck =
        (gear?.luck || 0) * (1 + model.data.constants.toolEnhance * Math.floor(amulet / 10000));
      if (monster.bonus)
        add(out, monster.bonus.itemId, Math.min(1, monster.bonus.chance * (1 + luck) * rare));
      add(
        out,
        facts.shardId,
        Math.min(0.2, 0.08 + monster.level * 0.0013) * (1 + Math.floor(monster.level / 30)),
      );
      add(out, facts.pets[monster.id], facts.petChance);
      return out;
    }
    function create(model) {
      let previous = null,
        segments = [],
        key = null,
        lastFood = null,
        reason = "等待战斗数据";
      function reset(message) {
        previous = null;
        segments = [];
        lastFood = null;
        reason = message;
      }
      function sample(p, windows = []) {
        const zone = p?.route?.zoneId;
        if (zone == null || !p.tally?.monsters) {
          reset("没有正在进行的普通战斗");
          key = null;
          return null;
        }
        // A change of loadout, food policy or zone starts a new measurement window.
        const signature = JSON.stringify([
          p.id,
          zone,
          p.equipment,
          p.masteries,
          p.perks,
          p.house,
          p.houseFurniture,
          p.foodItemId,
          p.foodMaxTier,
          p.eatAt,
          p.foodPerTrip,
        ]);
        if (key !== signature) {
          key = signature;
          reset("刚开始观测");
        }
        const counts = inventory(p),
          snap = {
            ...p,
            skills: { ...p.skills },
            equipment: { ...p.equipment },
            brews: { ...p.brews },
            brewTier: { ...p.brewTier },
            brewBuckets: JSON.parse(JSON.stringify(p.brewBuckets || {})),
            tally: JSON.parse(JSON.stringify(p.tally)),
            counts,
            food: selectedFood(model, p),
            windows: JSON.parse(JSON.stringify(windows)),
          };
        if (previous) {
          const ticks = p.lastTick - previous.lastTick;
          const decreased =
            skills.some((k) => (p.skills[k] || 0) < (previous.skills[k] || 0)) ||
            Object.entries(previous.tally.monsters).some(
              ([id, n]) => (p.tally.monsters[id] || 0) < n,
            ) ||
            (p.tally.eaten || 0) < (previous.tally.eaten || 0);
          if (ticks < 0 || ticks > 200 || decreased) {
            reset("数据重同步，重新观测");
          } else if (ticks > 0) {
            const segment = {
              start: previous.lastTick,
              end: p.lastTick,
              outputs: {},
              inputs: potionFlow(model, previous, previous.lastTick, p.lastTick),
              food: {},
              xp: {},
              kills: 0,
              deaths: Math.max(0, (p.tally.deaths || 0) - (previous.tally.deaths || 0)),
              unknownFood: 0,
            };
            for (const monster of model.data.combat.monsters) {
              const kills =
                (p.tally.monsters[monster.id] || 0) - (previous.tally.monsters[monster.id] || 0);
              if (kills <= 0) continue;
              segment.kills += kills;
              // Average known buffs over the sampling interval; does not invent rare drops from a small sample.
              for (let t = previous.lastTick; t < p.lastTick; t++)
                for (const [id, n] of Object.entries(
                  loot(model, previous, monster, t, previous.windows),
                ))
                  add(segment.outputs, id, (n * kills) / ticks);
            }
            let eaten = (p.tally.eaten || 0) - (previous.tally.eaten || 0);
            for (const [id, before] of Object.entries(previous.counts))
              if (eaten > 0 && foodEligible(model, previous, Number(id))) {
                const n = Math.min(eaten, Math.max(0, before - (counts[id] || 0)));
                if (n) {
                  add(segment.food, id, n);
                  eaten -= n;
                  lastFood = Number(id);
                }
              }
            // A concurrent purchase can conceal food consumption. Use the unchanged selected food only.
            if (eaten > 0 && previous.food != null && previous.food === snap.food) {
              add(segment.food, previous.food, eaten);
              lastFood = previous.food;
              eaten = 0;
            }
            segment.unknownFood = eaten;
            for (const [id, n] of Object.entries(segment.food)) add(segment.inputs, id, n);
            for (const skill of skills)
              segment.xp[skill] = (p.skills[skill] || 0) - (previous.skills[skill] || 0);
            segments.push(segment);
            segments = segments.filter((s) => s.end > p.lastTick - RATE_WINDOW);
            reason = "";
          }
        }
        if (!previous || p.lastTick !== previous.lastTick) previous = snap;
        return report(p);
      }
      function report(p) {
        const zone = p?.route?.zoneId;
        if (zone == null || key === null) return null;
        const cutoff = p.lastTick - RATE_WINDOW,
          recent = { ticks: 0, kills: 0, deaths: 0 },
          totals = {
            outputs: {},
            inputs: {},
            food: {},
            xp: {},
            ticks: 0,
            kills: 0,
            deaths: 0,
            unknownFood: 0,
          };
        for (const s of segments) {
          const ticks = s.end - s.start,
            factor = Math.max(0, s.end - Math.max(s.start, cutoff)) / ticks;
          totals.ticks += ticks * factor;
          totals.kills += s.kills * factor;
          totals.deaths += s.deaths * factor;
          totals.unknownFood += s.unknownFood * factor;
          const recentFactor =
            Math.max(0, s.end - Math.max(s.start, p.lastTick - EPH_WINDOW)) / ticks;
          recent.ticks += ticks * recentFactor;
          recent.kills += s.kills * recentFactor;
          recent.deaths += s.deaths * recentFactor;
          for (const name of ["outputs", "inputs", "food", "xp"])
            for (const [id, n] of Object.entries(s[name])) add(totals[name], id, n * factor);
        }
        const factor = totals.ticks ? 6000 / totals.ticks : 0,
          hour = { ticks: 6000, outputs: {}, inputs: {}, xp: {}, food: {} };
        for (const name of ["outputs", "inputs", "food", "xp"])
          for (const [id, n] of Object.entries(totals[name])) hour[name][id] = n * factor;
        const owned = inventory(p),
          foodId = selectedFood(model, p) ?? lastFood,
          foodRate = hour.food[foodId] || 0;
        const foods = Object.entries(owned)
          .filter(([id, n]) => n > 0 && foodEligible(model, p, Number(id)))
          .map(([id, qty]) => ({ id: Number(id), qty }));
        return {
          zone,
          reason,
          seconds: totals.ticks * 0.6,
          ready: totals.ticks >= 100,
          hour,
          killsPerHour: totals.kills * factor,
          encountersPerHour: recent.ticks
            ? ((recent.kills + recent.deaths) * 6000) / recent.ticks
            : 0,
          unknownFood: totals.unknownFood,
          foodId,
          foodQty: owned[foodId] || 0,
          foods,
          foodSeconds: foodRate > 0 ? ((owned[foodId] || 0) / foodRate) * 3600 : null,
          potions: kinds
            .filter((kind) => (p.brews?.[kind] || 0) > p.lastTick)
            .map((kind) => ({
              kind,
              tier: model.brewTier(p, kind, p.lastTick),
              seconds: (p.brews[kind] - p.lastTick) * 0.6,
              currentTierSeconds: currentTierTicks(model, p, kind) * 0.6,
            })),
        };
      }
      return { sample, report, reset };
    }
    function currentTierTicks(model, p, kind) {
      const tier = model.brewTier(p, kind, p.lastTick),
        buckets = p.brewBuckets?.[kind];
      if (!buckets?.length) return p.brews[kind] - p.lastTick;
      let sum = 0;
      for (let i = buckets.length - 1; i >= tier; i--) sum += buckets[i];
      return Math.min(
        p.brews[kind] - p.lastTick,
        p.brews[kind] - buckets.reduce((a, b) => a + b, 0) + sum - p.lastTick,
      );
    }
    return { create, loot, potionFlow, inventory, selectedFood, kinds };
  });

  // ---- src/activity.js ----
  /* Current-action actual output ledger; no game operations or inventory writes. */
  (function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.DVIActivity = factory();
  })(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";
    const add = (out, id, qty) => {
      if (Number.isSafeInteger(Number(id)) && Number.isFinite(qty) && qty > 0)
        out[id] = (out[id] || 0) + qty;
    };
    function identity(p) {
      const r = p?.route;
      if (!r || p.enhance) return null;
      return JSON.stringify([
        p.id,
        r.zoneId != null ? "fight" : "job",
        r.zoneId ?? r.jobId,
        r.zoneId == null ? (p.workRarity ?? 0) : null,
        !!r.errand,
        r.questId ?? null,
        r.onFull ?? null,
      ]);
    }
    function create(model) {
      let key = null,
        start = null,
        last = null,
        outputs = {},
        counterOutputs = {},
        eventOutputs = {},
        inputs = {},
        xp = {},
        attempts = 0;
      function reset(p) {
        key = identity(p);
        start = last = p ? copy(p) : null;
        outputs = {};
        counterOutputs = {};
        eventOutputs = {};
        inputs = {};
        xp = {};
        attempts = 0;
      }
      function copy(p) {
        return {
          tick: p.lastTick,
          collections: { ...p.collections },
          skills: { ...p.skills },
          actionIndex: p.actionIndex,
          caught: p.tally?.caught || 0,
          burnt: p.tally?.burnt || 0,
          plots: JSON.parse(JSON.stringify(p.plots || {})),
        };
      }
      function events(p, batch) {
        if (!p || !identity(p)) return;
        if (key !== identity(p)) reset(p);
        if (!Number.isSafeInteger(batch.tick) || batch.tick < start.tick) return;
        const job = p.route.zoneId == null ? model.jobs.get(p.route.jobId) : null;
        for (const e of batch.events) {
          if (e.kind === "produced") {
            if ((job && e.jobId !== job.id) || (!job && e.jobId !== 0)) continue;
            // Stall coins are deterministic and counted from completed attempts below.
            if (e.itemId === 200) continue;
            add(eventOutputs, e.itemId, e.qty ?? 1);
          } else if (e.kind === "killed" && !job) add(eventOutputs, 200, e.coins);
          else if (["bonus", "pet", "mount", "voidshard"].includes(e.kind))
            add(eventOutputs, e.itemId, e.kind === "voidshard" ? e.qty : 1);
        }
        merge();
      }
      function merge() {
        outputs = {};
        for (const id of new Set([...Object.keys(counterOutputs), ...Object.keys(eventOutputs)]))
          outputs[id] = Math.max(counterOutputs[id] || 0, eventOutputs[id] || 0);
      }
      function sample(p) {
        const id = identity(p);
        if (!id) {
          reset(null);
          return null;
        }
        if (key !== id || !last || p.lastTick < last.tick || p.lastTick - last.tick > 200) {
          reset(p);
          return report(p);
        }
        if (p.lastTick === last.tick) return report(p);
        const job = p.route.zoneId == null ? model.jobs.get(p.route.jobId) : null;
        if (job) {
          const delta = (p.actionIndex ?? last.actionIndex) - (last.actionIndex ?? p.actionIndex);
          if (delta < 0) {
            reset(p);
            return report(p);
          }
          if (Number.isFinite(delta)) {
            attempts += delta;
            if (job.grow === undefined) {
              for (const x of model.inputs(job, p.workRarity || 0))
                add(inputs, x.itemId, x.qty * delta);
            }
            if (job.output.itemId === 200)
              add(
                counterOutputs,
                200,
                Math.max(0, delta - Math.max(0, (p.tally?.caught || 0) - last.caught)) *
                  job.output.qty,
              );
          }
          // Crafted/farmed output is simulated deterministically by the official
          // client. Random gathering/combat loot is counted from received batches.
          if (job.inputs.length)
            for (const [item, n] of Object.entries(p.collections || {})) {
              const delta = n - (last.collections[item] || 0);
              if (delta > 0 && model.base(Number(item)) === job.output.itemId)
                add(counterOutputs, item, delta);
            }
          if (job.burn)
            add(counterOutputs, job.burn.itemId, Math.max(0, (p.tally?.burnt || 0) - last.burnt));
          if (job.grow !== undefined)
            for (const [id, plot] of Object.entries(p.plots || {}))
              if (
                plot.plantedAt !== last.plots[id]?.plantedAt &&
                plot.plantedAt >= last.tick &&
                plot.plantedAt <= p.lastTick
              )
                add(inputs, plot.seedItemId, 1);
        }
        for (const [skill, n] of Object.entries(p.skills || {}))
          if (
            (job
              ? skill === job.skill
              : ["melee", "ranged", "magic", "defence", "hitpoints"].includes(skill)) &&
            Number.isFinite(n) &&
            n > (last.skills[skill] || 0)
          )
            xp[skill] = (xp[skill] || 0) + n - (last.skills[skill] || 0);
        merge();
        last = copy(p);
        return report(p);
      }
      function report(p) {
        if (!key || !start) return null;
        const seconds = Math.max(0, (p.lastTick - start.tick) * 0.6),
          factor = seconds ? 3600 / seconds : 0;
        return {
          key,
          jobId: p.route?.zoneId == null ? p.route?.jobId : null,
          zone: p.route?.zoneId ?? null,
          seconds,
          ready: seconds >= 60,
          outputs: { ...outputs },
          inputs: { ...inputs },
          xp: { ...xp },
          xpPerHour: Object.values(xp).reduce((n, x) => n + x, 0) * factor,
          attempts,
        };
      }
      return { sample, events, reset, report };
    }
    function offlineFlow(report) {
      if (!report || !Number.isFinite(report.ticksApplied) || report.ticksApplied <= 0) return null;
      const outputs = {};
      for (const [id, qty] of Object.entries(report.itemsGained || {}))
        if (Number(id) !== 200) add(outputs, id, qty);
      // Report coins already includes stall/monster coins and achievement rewards.
      // Do not also count itemsGained[200]. Market-away settlements are separate.
      const cash = Number.isFinite(report.coins) ? report.coins : 0;
      if (cash > 0) add(outputs, 200, cash);
      return {
        outputs,
        inputs: cash < 0 ? { 200: -cash } : {},
        seconds: report.ticksApplied * 0.6,
      };
    }
    function offlineSnapshot(p) {
      if (!p || !Number.isSafeInteger(p.lastTick)) return null;
      const items = {};
      for (const [id, n] of Object.entries(p.bank || {})) add(items, id, n);
      for (const x of p.pack || []) add(items, x.itemId, x.qty);
      return {
        id: p.id,
        tick: p.lastTick,
        items,
        found: p.collections ? { ...p.collections } : null,
        coins: p.coins,
        brews: { ...p.brews },
        brewTier: { ...p.brewTier },
        brewBuckets: JSON.parse(JSON.stringify(p.brewBuckets || {})),
        discarding: p.route?.onFull === "drop",
        buffsKnown: !!p.brews && typeof p.brews === "object",
      };
    }
    function offlineAccounting(report, before, after, trades = [], potionInputs = {}) {
      if (!after) return null;
      const matched =
        before?.id === after.id && Number.isSafeInteger(before.tick) && before.tick < after.tick;
      const gap = matched ? after.tick - before.tick : 0;
      const currentReport =
        report &&
        (!Number.isFinite(report.endTick) || Math.abs(report.endTick - after.tick) <= 100);
      const fullReport =
        currentReport &&
        report.ticksApplied > 0 &&
        (!matched ||
          (Number.isFinite(report.ticksElapsed) && Math.abs(report.ticksElapsed - gap) <= 100));
      if (!matched) {
        const flow = currentReport ? offlineFlow(report) : null;
        return flow
          ? { ...flow, cash: report.coins, complete: false, estimated: false, source: "report" }
          : null;
      }
      const moved = {},
        marketCoins = trades.reduce((n, x) => {
          if (!Number.isSafeInteger(x.itemId) || !(x.qty > 0)) return n;
          addSigned(moved, x.itemId, x.side === "bought" ? x.qty : -x.qty);
          return n + (x.side === "sold" ? 1 : -1) * (Number.isFinite(x.coins) ? x.coins : 0);
        }, 0);
      const outputs = {};
      if (fullReport) {
        for (const [id, n] of Object.entries(report.itemsGained || {}))
          if (Number(id) !== 200) add(outputs, id, n);
      } else
        for (const id of new Set([
          ...Object.keys(before.found || {}),
          ...Object.keys(after.found || {}),
          ...Object.keys(before.items || {}),
          ...Object.keys(after.items || {}),
        ])) {
          if (Number(id) === 200) continue;
          const found = (after.found?.[id] || 0) - (before.found?.[id] || 0),
            net = (after.items?.[id] || 0) - (before.items?.[id] || 0) - (moved[id] || 0);
          add(outputs, id, Math.max(0, found, after.tradeRecordGap ? 0 : net));
        }
      const cash = fullReport
        ? report.coins
        : Number.isFinite(after.coins) && Number.isFinite(before.coins)
          ? after.coins - before.coins - marketCoins
          : null;
      if (cash > 0) add(outputs, 200, cash);
      const inputs = {};
      if (cash < 0) add(inputs, 200, -cash);
      for (const id of new Set([
        ...Object.keys(before.items || {}),
        ...Object.keys(after.items || {}),
        ...Object.keys(outputs),
        ...Object.keys(moved),
      ]))
        if (Number(id) !== 200) {
          add(
            inputs,
            id,
            Math.max(
              0,
              (before.items?.[id] || 0) +
                (outputs[id] || 0) +
                (moved[id] || 0) -
                (after.items?.[id] || 0),
            ),
          );
        }
      for (const [id, n] of Object.entries(potionInputs)) add(inputs, id, n);
      const dropped =
        after.observedDrop ||
        (currentReport && (report?.drops || 0) > 0) ||
        (!fullReport && (before.discarding || after.discarding));
      return {
        outputs,
        inputs,
        cash,
        seconds: (fullReport ? report.ticksApplied : gap) * 0.6,
        complete:
          (fullReport || !!before.found) &&
          before.buffsKnown === true &&
          Number.isFinite(cash) &&
          !dropped &&
          !after.tradeRecordGap,
        estimated: !fullReport,
        source: fullReport ? "report" : "snapshot",
      };
    }
    function addSigned(flow, id, n) {
      if (Number.isFinite(n)) flow[id] = (flow[id] || 0) + n;
    }
    function income(core, flow, seconds, books, tax, now, pricing) {
      const value = core.valueFlows(flow, books, "sell", tax, now, pricing);
      return {
        value,
        total: value.total,
        known: value.pricedSubtotal,
        perDay: seconds > 0 ? (value.pricedSubtotal * 86400) / seconds : null,
      };
    }
    return { create, identity, offlineFlow, offlineSnapshot, offlineAccounting, income };
  });

  // ---- src/i18n.js ----
  /* Local UI translations. Reads the game's locale; never changes game settings. */
  (function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.DVIInsightsI18n = factory();
  })(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";
    const en = {
      DVI信息增强: "DVI Insights",
      Alice战斗模拟器: "Alice Combat Simulator",
      金币: "coins",
      "金币/d": "coins/d",
      普通: "Common",
      罕见: "Uncommon",
      稀有: "Rare",
      史诗: "Epic",
      传说: "Legendary",
      采矿: "Mining",
      钓鱼: "Fishing",
      伐木: "Woodcutting",
      种植: "Farming",
      偷窃: "Thieving",
      烹饪: "Cooking",
      锻造: "Smithing",
      箭矢制作: "Fletching",
      炼药: "Herblore",
      制作: "Crafting",
      战斗: "Combat",
      强化: "Enhancing",
      近战: "Melee",
      远程: "Ranged",
      魔法: "Magic",
      防御: "Defence",
      生命: "Hitpoints",
      战士: "Warrior",
      急速: "Haste",
      深渊: "Abyssal",
      滋养: "Nourish",
      猎人: "Hunter",
      经验: "XP",
      疾行: "Swift",
      经验药水: "Elixir",
      明细: "Details",
      "等级 / 材料": "Level / materials",
      升到: "Target",
      级: "",
      计算: "Calculate",
      "{name}目标等级": "{name} target level",
      "{tier}材料": "{tier} materials",
      概率产出: "Random drops",
      待报价: "Price unavailable",
      缺买价: "Purchase price missing",
      估价: "Estimate",
      产物收入: "Output income",
      材料成本: "Material cost",
      药水成本: "Potion cost",
      食物成本: "Food cost",
      收入: "Income",
      成本: "Cost",
      部分成本: "Partial cost",
      产值: "Output value",
      "缺价：{items}": "Missing prices: {items}",
      产物缺价: "Output price missing",
      税率待接收: "Tax unavailable",
      刚更新: "just updated",
      "{n}分钟前": "{n}m ago",
      "{n}小时前": "{n}h ago",
      "{n}天前": "{n}d ago",
      "报价 {age}": "Quotes {age}",
      "历史价 {age}": "History {age}",
      "缓存价 {age}": "Cached quotes {age}",
      缓存买价: "Cached ask",
      商人: "Merchant",
      挂售: "Ask",
      求购: "Bid",
      商人买价: "Merchant buy price",
      不可出售: "Not sellable",
      挂售需等待买家: "Listings need a buyer",
      需等待买家: "Needs a buyer",
      "（税后）": " (after tax)",
      "税前 {value}": "Before tax: {value}",
      稀有度和强化不抬高商人回收价: "Rarity and enhancement do not raise merchant resale prices",
      金币按面值计价: "Coins valued at face value",
      报价已过期: "Stale quote",
      "期望日利 {value}": "Expected daily profit {value}",
      期望日利: "Expected daily profit",
      日利: "Daily profit",
      "每天收入 {value}": "Daily income {value}",
      观测中: "Observing",
      暂不计: "Not counted",
      "当前设置：丢弃产物": "Current mode: discard output",
      "累计 {value} {unit} · {time} · 未扣成本": "Total {value} {unit} · {time} · before costs",
      产物或税率缺价: "Output price or tax unavailable",
      "单田预估 {value}": "Single-field estimate {value}",
      "丢弃产物 · 暂不估算日利": "Discarding output · no profit estimate",
      经验观测中: "Observing XP",
      本次观测实际经验除以总时长: "Observed XP divided by elapsed time",
      预测暂不可用: "Estimate unavailable",
      离线净收益: "Offline net income",
      离线产值: "Offline output value",
      掉落产值: "Loot value",
      金币变化: "Coin change",
      "素材 / 食物 / 药水": "Materials / food / potions",
      净收益: "Net income",
      消耗记录不全: "Incomplete cost records",
      "观测中 · {time} / 1 分": "Observing · {time} / 1m",
      食物成本待核实: "Food cost unconfirmed",
      "{skill}经验": "{skill} XP",
      部分成本缺价: "Some costs lack prices",
      部分食物成本待确认: "Some food costs are unconfirmed",
      "近五分钟遭遇数/小时，含死亡": "Encounters/hour over the last 5 minutes, including deaths",
      无食物: "No food",
      续航观测中: "Observing endurance",
      "约 {time}": "~{time}",
      "食物 {qty} · {time}": "Food {qty} · {time}",
      无可用食物: "No usable food",
      "{tier} {name}；整组耗尽 {time}": "{tier} {name}; all tiers expire in {time}",
      "；当前强度结束后降为较低稀有度": "; then switches to a lower rarity",
      "计算中…": "Calculating…",
      "正在估算经验与收益…": "Estimating XP and income…",
      未解锁或当前位置无可用工作地点: "Locked or no available work site",
      等待角色数据: "Waiting for character data",
      未来一小时平均经验: "Average XP over the next hour",
      单田参考: "Single-field estimate",
      "客户端已更新，规则待校验": "Client updated; rules need verification",
      "工作 {work}；跑路 {walk}；存取 {bank}；被抓 {stun}；95% 尝试预算 {attempts} 次":
        "Work {work}; travel {walk}; banking {bank}; stun {stun}; 95% attempt budget {attempts}",
      "单田估算，未计多田与跑路": "Single field; excludes multi-field travel",
      "约 {count} 次 · {time}": "~{count} attempts · {time}",
      材料: "Materials",
      总需: "Required",
      需补: "Missing",
      "已有 {owned}；95% 需补 {missing}": "Owned {owned}; 95% extra budget {missing}",
      无需材料: "No materials required",
      收益明细: "Income details",
      当前农田: "Current fields",
      "浇水只作用于当前工作田。换田时优先成熟田；相邻成熟田同优先级，按编号选取。已有相邻站位会保留，重新寻路才挑落脚点。「收获并补种」不浇水。":
        "Watering affects the active field. Mature fields come first; adjacent mature fields tie by ID. An existing adjacent position is kept until repathing. Harvest-and-replant does not water.",
      田地: "Field",
      状态: "State",
      浇水: "Watered",
      当前: "Active",
      空田: "Empty",
      已成熟: "Mature",
      工作收益扣除药水成本: "Include potion costs in work profit",
      "战斗始终扣除食物与有效药水成本。": "Combat always includes food and active potion costs.",
      稀有度: "Rarity",
      当前概率: "Current chance",
      "当前单次概率；预测会计算已知加成到期。每个稀有度分别计价，包括极低概率掉落。":
        "Current chance per attempt. Forecasts account for known buff expiry and value every rarity.",
      "当前 {skill} {level} 级；经验合计 +{xp}%": "{skill} level {level}; total XP bonus +{xp}%",
      "工具速度 +{tool}%；任务速度 perk +{perk}%；已摆放房屋 +{house}%；{kind}精通 +{master}%":
        "Tool speed +{tool}%; speed perk +{perk}%; placed rooms +{house}%; {kind} mastery +{master}%",
      采集: "Gathering",
      "坐骑速度 +{mount}%；当前疾行 +{swift}%；移动精通 +{move}%":
        "Mount speed +{mount}%; Swift +{swift}%; movement mastery +{move}%",
      "轮换：{skill} {kind} +{bonus}%，{time}后切换；后续轮换也参与预测":
        "Rotation: {skill} {kind} +{bonus}%; switches in {time}. Future rotations are included.",
      稀有发现: "Rare finds",
      "已生效的经验/稀有精通、世界窗口、公会、祝福和剩余药水参与计算。未来房屋升级与领取任务奖励未预测。":
        "Includes active XP/rarity masteries, world buffs, guild, blessing and remaining potions. Future room upgrades and unclaimed rewards are excluded.",
      "物品 {id}": "Item {id}",
      预测进程不可用: "Prediction worker unavailable",
      预测耗时过长: "Prediction timed out",
      浏览器未允许本地计算: "Local calculation unavailable",
      本地计算进程发生错误: "Calculation worker failed",
      "计算耗时过长，请缩小等级目标": "Calculation timed out; lower the target level",
      "浏览器未允许本地计算 Worker": "Local calculation worker unavailable",
      未知工作: "Unknown job",
      当前等级尚未解锁这个工作: "This job is not unlocked",
      没有找到可用工作地点: "No available work site",
      目标地点不可达: "Destination unreachable",
      "无法寻路；请在主地图上再计算": "No route found; calculate on the main map",
      "目标需要过多工作次数；请缩小目标等级或选择更高经验的工作":
        "Too many attempts; lower the target or choose a higher-XP job",
      找不到可达仓库: "No reachable bank",
      背包无法容纳这份配方: "The recipe does not fit in the pack",
      当前等级尚未解锁这项种植: "This crop is not unlocked",
      种植目标过大: "Farming target too large",
      等待有效角色快照: "Waiting for a valid character snapshot",
      "动态家园路线尚未校准；请返回主地图后计算完整时间":
        "Home routes are unsupported; calculate on the main map",
      家园路线尚未校准: "Home routes are unsupported",
      "目标等级须为 1–{max} 的整数": "Target level must be an integer from 1 to {max}",
    };
    function resolve({ storage, document, navigator } = {}) {
      try {
        const saved = storage?.getItem("deepvein.locale");
        if (saved === "en" || saved === "zh") return saved;
      } catch {}
      const root = (document?.documentElement?.lang || "").toLowerCase().split("-")[0];
      if (root === "en" || root === "zh") return root;
      for (const value of navigator?.languages?.length
        ? navigator.languages
        : [navigator?.language]) {
        const lang = (value || "").toLowerCase().split("-")[0];
        if (lang === "en" || lang === "zh") return lang;
      }
      return "en";
    }
    function create(environment) {
      let language = resolve(environment);
      const t = (key, values = {}) => {
        const text = language === "en" ? (en[key] ?? key) : key;
        return text.replace(/\{(\w+)\}/g, (match, name) =>
          Object.hasOwn(values, name) ? String(values[name]) : match,
        );
      };
      function error(message) {
        const match = /^目标等级须为 1–(\d+) 的整数$/.exec(message || "");
        return match ? t("目标等级须为 1–{max} 的整数", { max: match[1] }) : t(message || "");
      }
      function duration(seconds) {
        if (!Number.isFinite(seconds)) return "—";
        const s = Math.max(0, Math.round(seconds));
        if (language === "en") {
          if (s < 60) return `${s}s`;
          if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
          if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
          return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
        }
        if (s < 60) return `${s} 秒`;
        if (s < 3600) return `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
        if (s < 86400) return `${Math.floor(s / 3600)} 小时 ${Math.floor((s % 3600) / 60)} 分`;
        return `${Math.floor(s / 86400)} 天 ${Math.floor((s % 86400) / 3600)} 小时`;
      }
      return {
        get language() {
          return language;
        },
        t,
        error,
        duration,
        refresh() {
          const next = resolve(environment),
            changed = next !== language;
          language = next;
          return changed;
        },
      };
    }
    return { create, resolve, en };
  });

  // ---- Static game facts ----
  const GAME_DATA = {
    jobs: [
      {
        id: 1,
        name: "Copper",
        skill: "mining",
        group: "Ore",
        levelReq: 1,
        baseTicks: 5,
        xp: 2,
        inputs: [],
        output: { itemId: 1, qty: 1 },
      },
      {
        id: 2,
        name: "Tin",
        skill: "mining",
        group: "Ore",
        levelReq: 1,
        baseTicks: 5,
        xp: 3,
        inputs: [],
        output: { itemId: 2, qty: 1 },
      },
      {
        id: 3,
        name: "Iron",
        skill: "mining",
        group: "Ore",
        levelReq: 15,
        baseTicks: 6,
        xp: 5,
        inputs: [],
        output: { itemId: 3, qty: 1 },
        bonus: { itemId: 100, chance: 0.0005 },
      },
      {
        id: 4,
        name: "Silver",
        skill: "mining",
        group: "Ore",
        levelReq: 30,
        baseTicks: 7,
        xp: 9,
        inputs: [],
        output: { itemId: 4, qty: 1 },
        bonus: { itemId: 100, chance: 0.001 },
      },
      {
        id: 5,
        name: "Coal",
        skill: "mining",
        group: "Ore",
        levelReq: 40,
        baseTicks: 8,
        xp: 14,
        inputs: [],
        output: { itemId: 5, qty: 1 },
        bonus: { itemId: 100, chance: 0.001 },
      },
      {
        id: 6,
        name: "Gold",
        skill: "mining",
        group: "Ore",
        levelReq: 55,
        baseTicks: 9,
        xp: 22,
        inputs: [],
        output: { itemId: 6, qty: 1 },
        bonus: { itemId: 100, chance: 0.002 },
      },
      {
        id: 7,
        name: "Cobalt",
        skill: "mining",
        group: "Ore",
        levelReq: 65,
        baseTicks: 11,
        xp: 37,
        inputs: [],
        output: { itemId: 7, qty: 1 },
        bonus: { itemId: 100, chance: 0.003 },
      },
      {
        id: 8,
        name: "Meteoric",
        skill: "mining",
        group: "Ore",
        levelReq: 85,
        baseTicks: 13,
        xp: 59,
        inputs: [],
        output: { itemId: 8, qty: 1 },
        bonus: { itemId: 100, chance: 0.005 },
      },
      {
        id: 21,
        name: "Shrimp",
        skill: "fishing",
        group: "Fish",
        levelReq: 1,
        baseTicks: 5,
        xp: 2,
        inputs: [],
        output: { itemId: 20, qty: 1 },
      },
      {
        id: 22,
        name: "Sardine",
        skill: "fishing",
        group: "Fish",
        levelReq: 5,
        baseTicks: 5,
        xp: 3,
        inputs: [],
        output: { itemId: 21, qty: 1 },
      },
      {
        id: 23,
        name: "Trout",
        skill: "fishing",
        group: "Fish",
        levelReq: 20,
        baseTicks: 6,
        xp: 7,
        inputs: [],
        output: { itemId: 22, qty: 1 },
      },
      {
        id: 24,
        name: "Salmon",
        skill: "fishing",
        group: "Fish",
        levelReq: 30,
        baseTicks: 7,
        xp: 11,
        inputs: [],
        output: { itemId: 23, qty: 1 },
      },
      {
        id: 25,
        name: "Tuna",
        skill: "fishing",
        group: "Fish",
        levelReq: 45,
        baseTicks: 8,
        xp: 17,
        inputs: [],
        output: { itemId: 24, qty: 1 },
      },
      {
        id: 26,
        name: "Lobster",
        skill: "fishing",
        group: "Fish",
        levelReq: 60,
        baseTicks: 10,
        xp: 28,
        inputs: [],
        output: { itemId: 25, qty: 1 },
      },
      {
        id: 27,
        name: "Swordfish",
        skill: "fishing",
        group: "Fish",
        levelReq: 75,
        baseTicks: 11,
        xp: 44,
        inputs: [],
        output: { itemId: 26, qty: 1 },
      },
      {
        id: 28,
        name: "Shark",
        skill: "fishing",
        group: "Fish",
        levelReq: 90,
        baseTicks: 13,
        xp: 60,
        inputs: [],
        output: { itemId: 27, qty: 1 },
      },
      {
        id: 30,
        name: "Tree",
        skill: "woodcutting",
        group: "Wood",
        levelReq: 1,
        baseTicks: 5,
        xp: 3,
        inputs: [],
        output: { itemId: 10, qty: 1 },
        bonus: { itemId: 160, chance: 0.0125 },
      },
      {
        id: 31,
        name: "Oak",
        skill: "woodcutting",
        group: "Wood",
        levelReq: 15,
        baseTicks: 6,
        xp: 7,
        inputs: [],
        output: { itemId: 11, qty: 1 },
        bonus: { itemId: 161, chance: 0.008333333333333333 },
      },
      {
        id: 32,
        name: "Willow",
        skill: "woodcutting",
        group: "Wood",
        levelReq: 30,
        baseTicks: 7,
        xp: 11,
        inputs: [],
        output: { itemId: 12, qty: 1 },
        bonus: { itemId: 162, chance: 0.005555555555555556 },
      },
      {
        id: 33,
        name: "Maple",
        skill: "woodcutting",
        group: "Wood",
        levelReq: 45,
        baseTicks: 8,
        xp: 18,
        inputs: [],
        output: { itemId: 13, qty: 1 },
        bonus: { itemId: 163, chance: 0.0038461538461538464 },
      },
      {
        id: 34,
        name: "Yew",
        skill: "woodcutting",
        group: "Wood",
        levelReq: 60,
        baseTicks: 10,
        xp: 29,
        inputs: [],
        output: { itemId: 14, qty: 1 },
        bonus: { itemId: 164, chance: 0.002777777777777778 },
      },
      {
        id: 35,
        name: "Magic",
        skill: "woodcutting",
        group: "Wood",
        levelReq: 75,
        baseTicks: 12,
        xp: 48,
        inputs: [],
        output: { itemId: 15, qty: 1 },
        bonus: { itemId: 165, chance: 0.0022222222222222222 },
      },
      {
        id: 160,
        name: "Potato",
        skill: "farming",
        group: "Crops",
        levelReq: 1,
        baseTicks: 2,
        xp: 110,
        inputs: [{ itemId: 160, qty: 1 }],
        output: { itemId: 170, qty: 1 },
        grow: 800,
      },
      {
        id: 161,
        name: "Glowcap",
        skill: "farming",
        group: "Crops",
        levelReq: 15,
        baseTicks: 2,
        xp: 380,
        inputs: [{ itemId: 161, qty: 1 }],
        output: { itemId: 171, qty: 1 },
        grow: 1500,
      },
      {
        id: 162,
        name: "Cave turnip",
        skill: "farming",
        group: "Crops",
        levelReq: 30,
        baseTicks: 2,
        xp: 900,
        inputs: [{ itemId: 162, qty: 1 }],
        output: { itemId: 172, qty: 1 },
        grow: 2500,
      },
      {
        id: 163,
        name: "Bitterroot",
        skill: "farming",
        group: "Crops",
        levelReq: 45,
        baseTicks: 2,
        xp: 1900,
        inputs: [{ itemId: 163, qty: 1 }],
        output: { itemId: 173, qty: 1 },
        grow: 4000,
      },
      {
        id: 164,
        name: "Voidmelon",
        skill: "farming",
        group: "Crops",
        levelReq: 60,
        baseTicks: 2,
        xp: 3800,
        inputs: [{ itemId: 164, qty: 1 }],
        output: { itemId: 174, qty: 1 },
        grow: 6000,
      },
      {
        id: 165,
        name: "Ember pepper",
        skill: "farming",
        group: "Crops",
        levelReq: 75,
        baseTicks: 2,
        xp: 6500,
        inputs: [{ itemId: 165, qty: 1 }],
        output: { itemId: 175, qty: 1 },
        grow: 9000,
      },
      {
        id: 41,
        name: "Bronze bar",
        skill: "smithing",
        group: "Bars",
        levelReq: 1,
        baseTicks: 4,
        xp: 6,
        inputs: [
          { itemId: 1, qty: 1 },
          { itemId: 2, qty: 1 },
        ],
        output: { itemId: 40, qty: 1 },
      },
      {
        id: 42,
        name: "Iron bar",
        skill: "smithing",
        group: "Bars",
        levelReq: 15,
        baseTicks: 4,
        xp: 8,
        inputs: [{ itemId: 3, qty: 1 }],
        output: { itemId: 41, qty: 1 },
      },
      {
        id: 43,
        name: "Steel bar",
        skill: "smithing",
        group: "Bars",
        levelReq: 30,
        baseTicks: 4,
        xp: 35,
        inputs: [
          { itemId: 3, qty: 1 },
          { itemId: 5, qty: 2 },
        ],
        output: { itemId: 42, qty: 1 },
      },
      {
        id: 44,
        name: "Cobalt bar",
        skill: "smithing",
        group: "Bars",
        levelReq: 60,
        baseTicks: 4,
        xp: 108,
        inputs: [
          { itemId: 7, qty: 1 },
          { itemId: 5, qty: 3 },
        ],
        output: { itemId: 43, qty: 1 },
      },
      {
        id: 45,
        name: "Meteoric bar",
        skill: "smithing",
        group: "Bars",
        levelReq: 85,
        baseTicks: 4,
        xp: 253,
        inputs: [
          { itemId: 8, qty: 1 },
          { itemId: 5, qty: 4 },
        ],
        output: { itemId: 44, qty: 1 },
      },
      {
        id: 51,
        name: "Bronze pickaxe",
        skill: "smithing",
        group: "Pickaxes",
        levelReq: 1,
        baseTicks: 5,
        xp: 17,
        inputs: [{ itemId: 40, qty: 2 }],
        output: { itemId: 80, qty: 1 },
      },
      {
        id: 52,
        name: "Iron pickaxe",
        skill: "smithing",
        group: "Pickaxes",
        levelReq: 15,
        baseTicks: 5,
        xp: 27,
        inputs: [{ itemId: 41, qty: 2 }],
        output: { itemId: 81, qty: 1 },
      },
      {
        id: 53,
        name: "Steel pickaxe",
        skill: "smithing",
        group: "Pickaxes",
        levelReq: 30,
        baseTicks: 5,
        xp: 83,
        inputs: [{ itemId: 42, qty: 2 }],
        output: { itemId: 82, qty: 1 },
      },
      {
        id: 54,
        name: "Cobalt pickaxe",
        skill: "smithing",
        group: "Pickaxes",
        levelReq: 60,
        baseTicks: 5,
        xp: 240,
        inputs: [{ itemId: 43, qty: 2 }],
        output: { itemId: 83, qty: 1 },
      },
      {
        id: 55,
        name: "Meteoric pickaxe",
        skill: "smithing",
        group: "Pickaxes",
        levelReq: 85,
        baseTicks: 5,
        xp: 552,
        inputs: [{ itemId: 44, qty: 2 }],
        output: { itemId: 84, qty: 1 },
      },
      {
        id: 56,
        name: "Bronze rod",
        skill: "fletching",
        group: "Rods",
        levelReq: 1,
        baseTicks: 5,
        xp: 8,
        inputs: [
          { itemId: 40, qty: 1 },
          { itemId: 10, qty: 1 },
        ],
        output: { itemId: 85, qty: 1 },
      },
      {
        id: 57,
        name: "Iron rod",
        skill: "fletching",
        group: "Rods",
        levelReq: 15,
        baseTicks: 5,
        xp: 13,
        inputs: [
          { itemId: 41, qty: 1 },
          { itemId: 11, qty: 1 },
        ],
        output: { itemId: 86, qty: 1 },
      },
      {
        id: 58,
        name: "Steel rod",
        skill: "fletching",
        group: "Rods",
        levelReq: 30,
        baseTicks: 5,
        xp: 41,
        inputs: [
          { itemId: 42, qty: 1 },
          { itemId: 12, qty: 1 },
        ],
        output: { itemId: 87, qty: 1 },
      },
      {
        id: 59,
        name: "Cobalt rod",
        skill: "fletching",
        group: "Rods",
        levelReq: 60,
        baseTicks: 5,
        xp: 120,
        inputs: [
          { itemId: 43, qty: 1 },
          { itemId: 14, qty: 1 },
        ],
        output: { itemId: 88, qty: 1 },
      },
      {
        id: 60,
        name: "Meteoric rod",
        skill: "fletching",
        group: "Rods",
        levelReq: 85,
        baseTicks: 5,
        xp: 276,
        inputs: [
          { itemId: 44, qty: 1 },
          { itemId: 15, qty: 1 },
        ],
        output: { itemId: 89, qty: 1 },
      },
      {
        id: 308,
        name: "Bronze pan",
        skill: "smithing",
        group: "Pans",
        levelReq: 1,
        baseTicks: 5,
        xp: 8,
        inputs: [{ itemId: 40, qty: 1 }],
        output: { itemId: 360, qty: 1 },
      },
      {
        id: 309,
        name: "Iron pan",
        skill: "smithing",
        group: "Pans",
        levelReq: 15,
        baseTicks: 5,
        xp: 13,
        inputs: [{ itemId: 41, qty: 1 }],
        output: { itemId: 361, qty: 1 },
      },
      {
        id: 310,
        name: "Steel pan",
        skill: "smithing",
        group: "Pans",
        levelReq: 30,
        baseTicks: 5,
        xp: 41,
        inputs: [{ itemId: 42, qty: 1 }],
        output: { itemId: 362, qty: 1 },
      },
      {
        id: 311,
        name: "Cobalt pan",
        skill: "smithing",
        group: "Pans",
        levelReq: 60,
        baseTicks: 5,
        xp: 120,
        inputs: [{ itemId: 43, qty: 1 }],
        output: { itemId: 363, qty: 1 },
      },
      {
        id: 312,
        name: "Meteoric pan",
        skill: "smithing",
        group: "Pans",
        levelReq: 85,
        baseTicks: 5,
        xp: 276,
        inputs: [{ itemId: 44, qty: 1 }],
        output: { itemId: 364, qty: 1 },
      },
      {
        id: 313,
        name: "Bronze hammer",
        skill: "smithing",
        group: "Hammers",
        levelReq: 1,
        baseTicks: 5,
        xp: 17,
        inputs: [{ itemId: 40, qty: 2 }],
        output: { itemId: 365, qty: 1 },
      },
      {
        id: 314,
        name: "Iron hammer",
        skill: "smithing",
        group: "Hammers",
        levelReq: 15,
        baseTicks: 5,
        xp: 27,
        inputs: [{ itemId: 41, qty: 2 }],
        output: { itemId: 366, qty: 1 },
      },
      {
        id: 315,
        name: "Steel hammer",
        skill: "smithing",
        group: "Hammers",
        levelReq: 30,
        baseTicks: 5,
        xp: 83,
        inputs: [{ itemId: 42, qty: 2 }],
        output: { itemId: 367, qty: 1 },
      },
      {
        id: 316,
        name: "Cobalt hammer",
        skill: "smithing",
        group: "Hammers",
        levelReq: 60,
        baseTicks: 5,
        xp: 240,
        inputs: [{ itemId: 43, qty: 2 }],
        output: { itemId: 368, qty: 1 },
      },
      {
        id: 317,
        name: "Meteoric hammer",
        skill: "smithing",
        group: "Hammers",
        levelReq: 85,
        baseTicks: 5,
        xp: 552,
        inputs: [{ itemId: 44, qty: 2 }],
        output: { itemId: 369, qty: 1 },
      },
      {
        id: 318,
        name: "Bronze knife",
        skill: "smithing",
        group: "Knives",
        levelReq: 1,
        baseTicks: 5,
        xp: 8,
        inputs: [{ itemId: 40, qty: 1 }],
        output: { itemId: 370, qty: 1 },
      },
      {
        id: 319,
        name: "Iron knife",
        skill: "smithing",
        group: "Knives",
        levelReq: 15,
        baseTicks: 5,
        xp: 13,
        inputs: [{ itemId: 41, qty: 1 }],
        output: { itemId: 371, qty: 1 },
      },
      {
        id: 320,
        name: "Steel knife",
        skill: "smithing",
        group: "Knives",
        levelReq: 30,
        baseTicks: 5,
        xp: 41,
        inputs: [{ itemId: 42, qty: 1 }],
        output: { itemId: 372, qty: 1 },
      },
      {
        id: 321,
        name: "Cobalt knife",
        skill: "smithing",
        group: "Knives",
        levelReq: 60,
        baseTicks: 5,
        xp: 120,
        inputs: [{ itemId: 43, qty: 1 }],
        output: { itemId: 373, qty: 1 },
      },
      {
        id: 322,
        name: "Meteoric knife",
        skill: "smithing",
        group: "Knives",
        levelReq: 85,
        baseTicks: 5,
        xp: 276,
        inputs: [{ itemId: 44, qty: 1 }],
        output: { itemId: 374, qty: 1 },
      },
      {
        id: 323,
        name: "Bronze needle",
        skill: "crafting",
        group: "Needles",
        levelReq: 1,
        baseTicks: 5,
        xp: 8,
        inputs: [{ itemId: 40, qty: 1 }],
        output: { itemId: 375, qty: 1 },
      },
      {
        id: 324,
        name: "Iron needle",
        skill: "crafting",
        group: "Needles",
        levelReq: 15,
        baseTicks: 5,
        xp: 13,
        inputs: [{ itemId: 41, qty: 1 }],
        output: { itemId: 376, qty: 1 },
      },
      {
        id: 325,
        name: "Steel needle",
        skill: "crafting",
        group: "Needles",
        levelReq: 30,
        baseTicks: 5,
        xp: 41,
        inputs: [{ itemId: 42, qty: 1 }],
        output: { itemId: 377, qty: 1 },
      },
      {
        id: 326,
        name: "Cobalt needle",
        skill: "crafting",
        group: "Needles",
        levelReq: 60,
        baseTicks: 5,
        xp: 120,
        inputs: [{ itemId: 43, qty: 1 }],
        output: { itemId: 378, qty: 1 },
      },
      {
        id: 327,
        name: "Meteoric needle",
        skill: "crafting",
        group: "Needles",
        levelReq: 85,
        baseTicks: 5,
        xp: 276,
        inputs: [{ itemId: 44, qty: 1 }],
        output: { itemId: 379, qty: 1 },
      },
      {
        id: 328,
        name: "Bronze mortar",
        skill: "crafting",
        group: "Mortars",
        levelReq: 1,
        baseTicks: 5,
        xp: 17,
        inputs: [{ itemId: 40, qty: 2 }],
        output: { itemId: 380, qty: 1 },
      },
      {
        id: 329,
        name: "Iron mortar",
        skill: "crafting",
        group: "Mortars",
        levelReq: 15,
        baseTicks: 5,
        xp: 27,
        inputs: [{ itemId: 41, qty: 2 }],
        output: { itemId: 381, qty: 1 },
      },
      {
        id: 330,
        name: "Steel mortar",
        skill: "crafting",
        group: "Mortars",
        levelReq: 30,
        baseTicks: 5,
        xp: 83,
        inputs: [{ itemId: 42, qty: 2 }],
        output: { itemId: 382, qty: 1 },
      },
      {
        id: 331,
        name: "Cobalt mortar",
        skill: "crafting",
        group: "Mortars",
        levelReq: 60,
        baseTicks: 5,
        xp: 240,
        inputs: [{ itemId: 43, qty: 2 }],
        output: { itemId: 383, qty: 1 },
      },
      {
        id: 332,
        name: "Meteoric mortar",
        skill: "crafting",
        group: "Mortars",
        levelReq: 85,
        baseTicks: 5,
        xp: 552,
        inputs: [{ itemId: 44, qty: 2 }],
        output: { itemId: 384, qty: 1 },
      },
      {
        id: 333,
        name: "Bronze hoe",
        skill: "fletching",
        group: "Hoes",
        levelReq: 1,
        baseTicks: 5,
        xp: 17,
        inputs: [
          { itemId: 40, qty: 1 },
          { itemId: 10, qty: 2 },
        ],
        output: { itemId: 385, qty: 1 },
      },
      {
        id: 334,
        name: "Iron hoe",
        skill: "fletching",
        group: "Hoes",
        levelReq: 15,
        baseTicks: 5,
        xp: 27,
        inputs: [
          { itemId: 41, qty: 1 },
          { itemId: 11, qty: 2 },
        ],
        output: { itemId: 386, qty: 1 },
      },
      {
        id: 335,
        name: "Steel hoe",
        skill: "fletching",
        group: "Hoes",
        levelReq: 30,
        baseTicks: 5,
        xp: 83,
        inputs: [
          { itemId: 42, qty: 1 },
          { itemId: 12, qty: 2 },
        ],
        output: { itemId: 387, qty: 1 },
      },
      {
        id: 336,
        name: "Cobalt hoe",
        skill: "fletching",
        group: "Hoes",
        levelReq: 60,
        baseTicks: 5,
        xp: 240,
        inputs: [
          { itemId: 43, qty: 1 },
          { itemId: 14, qty: 2 },
        ],
        output: { itemId: 388, qty: 1 },
      },
      {
        id: 337,
        name: "Meteoric hoe",
        skill: "fletching",
        group: "Hoes",
        levelReq: 85,
        baseTicks: 5,
        xp: 552,
        inputs: [
          { itemId: 44, qty: 1 },
          { itemId: 15, qty: 2 },
        ],
        output: { itemId: 389, qty: 1 },
      },
      {
        id: 46,
        name: "Bronze axe",
        skill: "smithing",
        group: "Axes",
        levelReq: 1,
        baseTicks: 5,
        xp: 17,
        inputs: [{ itemId: 40, qty: 2 }],
        output: { itemId: 90, qty: 1 },
      },
      {
        id: 47,
        name: "Iron axe",
        skill: "smithing",
        group: "Axes",
        levelReq: 15,
        baseTicks: 5,
        xp: 27,
        inputs: [{ itemId: 41, qty: 2 }],
        output: { itemId: 91, qty: 1 },
      },
      {
        id: 48,
        name: "Steel axe",
        skill: "smithing",
        group: "Axes",
        levelReq: 30,
        baseTicks: 5,
        xp: 83,
        inputs: [{ itemId: 42, qty: 2 }],
        output: { itemId: 92, qty: 1 },
      },
      {
        id: 49,
        name: "Cobalt axe",
        skill: "smithing",
        group: "Axes",
        levelReq: 60,
        baseTicks: 5,
        xp: 240,
        inputs: [{ itemId: 43, qty: 2 }],
        output: { itemId: 93, qty: 1 },
      },
      {
        id: 50,
        name: "Meteoric axe",
        skill: "smithing",
        group: "Axes",
        levelReq: 85,
        baseTicks: 5,
        xp: 552,
        inputs: [{ itemId: 44, qty: 2 }],
        output: { itemId: 94, qty: 1 },
      },
      {
        id: 61,
        name: "Cook shrimp",
        skill: "cooking",
        group: "Food",
        levelReq: 1,
        baseTicks: 4,
        xp: 4,
        inputs: [{ itemId: 20, qty: 1 }],
        output: { itemId: 60, qty: 1 },
        burn: { itemId: 70, chanceAtReq: 0.3, safeAtLevel: 26 },
      },
      {
        id: 62,
        name: "Cook sardine",
        skill: "cooking",
        group: "Food",
        levelReq: 5,
        baseTicks: 4,
        xp: 5,
        inputs: [{ itemId: 21, qty: 1 }],
        output: { itemId: 61, qty: 1 },
        burn: { itemId: 70, chanceAtReq: 0.3, safeAtLevel: 30 },
      },
      {
        id: 63,
        name: "Cook trout",
        skill: "cooking",
        group: "Food",
        levelReq: 20,
        baseTicks: 4,
        xp: 10,
        inputs: [{ itemId: 22, qty: 1 }],
        output: { itemId: 62, qty: 1 },
        burn: { itemId: 70, chanceAtReq: 0.3, safeAtLevel: 45 },
      },
      {
        id: 64,
        name: "Cook salmon",
        skill: "cooking",
        group: "Food",
        levelReq: 30,
        baseTicks: 4,
        xp: 14,
        inputs: [{ itemId: 23, qty: 1 }],
        output: { itemId: 63, qty: 1 },
        burn: { itemId: 70, chanceAtReq: 0.3, safeAtLevel: 55 },
      },
      {
        id: 65,
        name: "Cook tuna",
        skill: "cooking",
        group: "Food",
        levelReq: 45,
        baseTicks: 4,
        xp: 22,
        inputs: [{ itemId: 24, qty: 1 }],
        output: { itemId: 64, qty: 1 },
        burn: { itemId: 70, chanceAtReq: 0.3, safeAtLevel: 70 },
      },
      {
        id: 66,
        name: "Cook lobster",
        skill: "cooking",
        group: "Food",
        levelReq: 60,
        baseTicks: 4,
        xp: 36,
        inputs: [{ itemId: 25, qty: 1 }],
        output: { itemId: 65, qty: 1 },
        burn: { itemId: 70, chanceAtReq: 0.3, safeAtLevel: 85 },
      },
      {
        id: 67,
        name: "Cook swordfish",
        skill: "cooking",
        group: "Food",
        levelReq: 75,
        baseTicks: 4,
        xp: 59,
        inputs: [{ itemId: 26, qty: 1 }],
        output: { itemId: 66, qty: 1 },
        burn: { itemId: 70, chanceAtReq: 0.3, safeAtLevel: 100 },
      },
      {
        id: 68,
        name: "Cook shark",
        skill: "cooking",
        group: "Food",
        levelReq: 90,
        baseTicks: 4,
        xp: 92,
        inputs: [{ itemId: 27, qty: 1 }],
        output: { itemId: 67, qty: 1 },
        burn: { itemId: 70, chanceAtReq: 0.3, safeAtLevel: 115 },
      },
      {
        id: 110,
        name: "Bronze blade",
        skill: "smithing",
        group: "Weapons",
        levelReq: 1,
        baseTicks: 5,
        xp: 8,
        inputs: [{ itemId: 40, qty: 1 }],
        output: { itemId: 110, qty: 1 },
      },
      {
        id: 111,
        name: "Iron blade",
        skill: "smithing",
        group: "Weapons",
        levelReq: 15,
        baseTicks: 5,
        xp: 13,
        inputs: [{ itemId: 41, qty: 1 }],
        output: { itemId: 111, qty: 1 },
      },
      {
        id: 112,
        name: "Steel blade",
        skill: "smithing",
        group: "Weapons",
        levelReq: 30,
        baseTicks: 5,
        xp: 41,
        inputs: [{ itemId: 42, qty: 1 }],
        output: { itemId: 112, qty: 1 },
      },
      {
        id: 113,
        name: "Cobalt blade",
        skill: "smithing",
        group: "Weapons",
        levelReq: 60,
        baseTicks: 5,
        xp: 120,
        inputs: [{ itemId: 43, qty: 1 }],
        output: { itemId: 113, qty: 1 },
      },
      {
        id: 114,
        name: "Meteoric blade",
        skill: "smithing",
        group: "Weapons",
        levelReq: 85,
        baseTicks: 5,
        xp: 276,
        inputs: [{ itemId: 44, qty: 1 }],
        output: { itemId: 114, qty: 1 },
      },
      {
        id: 338,
        name: "Bronze greatsword",
        skill: "smithing",
        group: "Two-handers",
        levelReq: 1,
        baseTicks: 5,
        xp: 17,
        inputs: [{ itemId: 40, qty: 2 }],
        output: { itemId: 390, qty: 1 },
      },
      {
        id: 339,
        name: "Iron greatsword",
        skill: "smithing",
        group: "Two-handers",
        levelReq: 15,
        baseTicks: 5,
        xp: 27,
        inputs: [{ itemId: 41, qty: 2 }],
        output: { itemId: 391, qty: 1 },
      },
      {
        id: 340,
        name: "Steel greatsword",
        skill: "smithing",
        group: "Two-handers",
        levelReq: 30,
        baseTicks: 5,
        xp: 83,
        inputs: [{ itemId: 42, qty: 2 }],
        output: { itemId: 392, qty: 1 },
      },
      {
        id: 341,
        name: "Cobalt greatsword",
        skill: "smithing",
        group: "Two-handers",
        levelReq: 60,
        baseTicks: 5,
        xp: 240,
        inputs: [{ itemId: 43, qty: 2 }],
        output: { itemId: 393, qty: 1 },
      },
      {
        id: 342,
        name: "Meteoric greatsword",
        skill: "smithing",
        group: "Two-handers",
        levelReq: 85,
        baseTicks: 5,
        xp: 552,
        inputs: [{ itemId: 44, qty: 2 }],
        output: { itemId: 394, qty: 1 },
      },
      {
        id: 343,
        name: "Colossus greatsword",
        skill: "smithing",
        group: "Two-handers",
        levelReq: 99,
        baseTicks: 6,
        xp: 1350,
        inputs: [
          { itemId: 44, qty: 2 },
          { itemId: 252, qty: 3 },
        ],
        output: { itemId: 395, qty: 1 },
      },
      {
        id: 115,
        name: "Bronze shield",
        skill: "smithing",
        group: "Shields",
        levelReq: 1,
        baseTicks: 5,
        xp: 25,
        inputs: [{ itemId: 40, qty: 3 }],
        output: { itemId: 115, qty: 1 },
      },
      {
        id: 116,
        name: "Iron shield",
        skill: "smithing",
        group: "Shields",
        levelReq: 15,
        baseTicks: 5,
        xp: 40,
        inputs: [{ itemId: 41, qty: 3 }],
        output: { itemId: 116, qty: 1 },
      },
      {
        id: 117,
        name: "Steel shield",
        skill: "smithing",
        group: "Shields",
        levelReq: 30,
        baseTicks: 5,
        xp: 124,
        inputs: [{ itemId: 42, qty: 3 }],
        output: { itemId: 117, qty: 1 },
      },
      {
        id: 118,
        name: "Cobalt shield",
        skill: "smithing",
        group: "Shields",
        levelReq: 60,
        baseTicks: 5,
        xp: 360,
        inputs: [{ itemId: 43, qty: 3 }],
        output: { itemId: 118, qty: 1 },
      },
      {
        id: 119,
        name: "Meteoric shield",
        skill: "smithing",
        group: "Shields",
        levelReq: 85,
        baseTicks: 5,
        xp: 828,
        inputs: [{ itemId: 44, qty: 3 }],
        output: { itemId: 119, qty: 1 },
      },
      {
        id: 120,
        name: "Bronze helm",
        skill: "smithing",
        group: "Helmets",
        levelReq: 1,
        baseTicks: 5,
        xp: 17,
        inputs: [{ itemId: 40, qty: 2 }],
        output: { itemId: 120, qty: 1 },
      },
      {
        id: 121,
        name: "Iron helm",
        skill: "smithing",
        group: "Helmets",
        levelReq: 15,
        baseTicks: 5,
        xp: 27,
        inputs: [{ itemId: 41, qty: 2 }],
        output: { itemId: 121, qty: 1 },
      },
      {
        id: 122,
        name: "Steel helm",
        skill: "smithing",
        group: "Helmets",
        levelReq: 30,
        baseTicks: 5,
        xp: 83,
        inputs: [{ itemId: 42, qty: 2 }],
        output: { itemId: 122, qty: 1 },
      },
      {
        id: 123,
        name: "Cobalt helm",
        skill: "smithing",
        group: "Helmets",
        levelReq: 60,
        baseTicks: 5,
        xp: 240,
        inputs: [{ itemId: 43, qty: 2 }],
        output: { itemId: 123, qty: 1 },
      },
      {
        id: 124,
        name: "Meteoric helm",
        skill: "smithing",
        group: "Helmets",
        levelReq: 85,
        baseTicks: 5,
        xp: 552,
        inputs: [{ itemId: 44, qty: 2 }],
        output: { itemId: 124, qty: 1 },
      },
      {
        id: 125,
        name: "Bronze plate",
        skill: "smithing",
        group: "Bodies",
        levelReq: 1,
        baseTicks: 5,
        xp: 42,
        inputs: [{ itemId: 40, qty: 5 }],
        output: { itemId: 125, qty: 1 },
      },
      {
        id: 126,
        name: "Iron plate",
        skill: "smithing",
        group: "Bodies",
        levelReq: 15,
        baseTicks: 5,
        xp: 67,
        inputs: [{ itemId: 41, qty: 5 }],
        output: { itemId: 126, qty: 1 },
      },
      {
        id: 127,
        name: "Steel plate",
        skill: "smithing",
        group: "Bodies",
        levelReq: 30,
        baseTicks: 5,
        xp: 207,
        inputs: [{ itemId: 42, qty: 5 }],
        output: { itemId: 127, qty: 1 },
      },
      {
        id: 128,
        name: "Cobalt plate",
        skill: "smithing",
        group: "Bodies",
        levelReq: 60,
        baseTicks: 5,
        xp: 600,
        inputs: [{ itemId: 43, qty: 5 }],
        output: { itemId: 128, qty: 1 },
      },
      {
        id: 129,
        name: "Meteoric plate",
        skill: "smithing",
        group: "Bodies",
        levelReq: 85,
        baseTicks: 5,
        xp: 1380,
        inputs: [{ itemId: 44, qty: 5 }],
        output: { itemId: 129, qty: 1 },
      },
      {
        id: 130,
        name: "Bronze greaves",
        skill: "smithing",
        group: "Legs",
        levelReq: 1,
        baseTicks: 5,
        xp: 34,
        inputs: [{ itemId: 40, qty: 4 }],
        output: { itemId: 130, qty: 1 },
      },
      {
        id: 131,
        name: "Iron greaves",
        skill: "smithing",
        group: "Legs",
        levelReq: 15,
        baseTicks: 5,
        xp: 53,
        inputs: [{ itemId: 41, qty: 4 }],
        output: { itemId: 131, qty: 1 },
      },
      {
        id: 132,
        name: "Steel greaves",
        skill: "smithing",
        group: "Legs",
        levelReq: 30,
        baseTicks: 5,
        xp: 165,
        inputs: [{ itemId: 42, qty: 4 }],
        output: { itemId: 132, qty: 1 },
      },
      {
        id: 133,
        name: "Cobalt greaves",
        skill: "smithing",
        group: "Legs",
        levelReq: 60,
        baseTicks: 5,
        xp: 480,
        inputs: [{ itemId: 43, qty: 4 }],
        output: { itemId: 133, qty: 1 },
      },
      {
        id: 134,
        name: "Meteoric greaves",
        skill: "smithing",
        group: "Legs",
        levelReq: 85,
        baseTicks: 5,
        xp: 1104,
        inputs: [{ itemId: 44, qty: 4 }],
        output: { itemId: 134, qty: 1 },
      },
      {
        id: 301,
        name: "Colossus blade",
        skill: "smithing",
        group: "Weapons",
        levelReq: 99,
        baseTicks: 6,
        xp: 1900,
        inputs: [
          { itemId: 44, qty: 3 },
          { itemId: 252, qty: 2 },
        ],
        output: { itemId: 350, qty: 1 },
      },
      {
        id: 302,
        name: "Colossus shield",
        skill: "smithing",
        group: "Shields",
        levelReq: 99,
        baseTicks: 6,
        xp: 1900,
        inputs: [
          { itemId: 44, qty: 3 },
          { itemId: 252, qty: 2 },
        ],
        output: { itemId: 351, qty: 1 },
      },
      {
        id: 303,
        name: "Colossus helm",
        skill: "smithing",
        group: "Helmets",
        levelReq: 99,
        baseTicks: 6,
        xp: 1250,
        inputs: [
          { itemId: 44, qty: 2 },
          { itemId: 252, qty: 1 },
        ],
        output: { itemId: 352, qty: 1 },
      },
      {
        id: 304,
        name: "Colossus plate",
        skill: "smithing",
        group: "Bodies",
        levelReq: 99,
        baseTicks: 6,
        xp: 3100,
        inputs: [
          { itemId: 44, qty: 5 },
          { itemId: 252, qty: 3 },
        ],
        output: { itemId: 353, qty: 1 },
      },
      {
        id: 305,
        name: "Colossus greaves",
        skill: "smithing",
        group: "Legs",
        levelReq: 99,
        baseTicks: 6,
        xp: 2500,
        inputs: [
          { itemId: 44, qty: 4 },
          { itemId: 252, qty: 2 },
        ],
        output: { itemId: 354, qty: 1 },
      },
      {
        id: 140,
        name: "Shortbow",
        skill: "fletching",
        group: "Shortbows",
        levelReq: 1,
        baseTicks: 5,
        xp: 5,
        inputs: [{ itemId: 10, qty: 1 }],
        output: { itemId: 140, qty: 1 },
      },
      {
        id: 141,
        name: "Oak shortbow",
        skill: "fletching",
        group: "Shortbows",
        levelReq: 15,
        baseTicks: 5,
        xp: 11,
        inputs: [{ itemId: 11, qty: 1 }],
        output: { itemId: 141, qty: 1 },
      },
      {
        id: 142,
        name: "Willow shortbow",
        skill: "fletching",
        group: "Shortbows",
        levelReq: 30,
        baseTicks: 5,
        xp: 17,
        inputs: [{ itemId: 12, qty: 1 }],
        output: { itemId: 142, qty: 1 },
      },
      {
        id: 143,
        name: "Maple shortbow",
        skill: "fletching",
        group: "Shortbows",
        levelReq: 45,
        baseTicks: 5,
        xp: 27,
        inputs: [{ itemId: 13, qty: 1 }],
        output: { itemId: 143, qty: 1 },
      },
      {
        id: 144,
        name: "Yew shortbow",
        skill: "fletching",
        group: "Shortbows",
        levelReq: 60,
        baseTicks: 5,
        xp: 43,
        inputs: [{ itemId: 14, qty: 1 }],
        output: { itemId: 144, qty: 1 },
      },
      {
        id: 145,
        name: "Magic shortbow",
        skill: "fletching",
        group: "Shortbows",
        levelReq: 75,
        baseTicks: 5,
        xp: 70,
        inputs: [{ itemId: 15, qty: 1 }],
        output: { itemId: 145, qty: 1 },
      },
      {
        id: 146,
        name: "Longbow",
        skill: "fletching",
        group: "Longbows",
        levelReq: 1,
        baseTicks: 5,
        xp: 10,
        inputs: [{ itemId: 10, qty: 2 }],
        output: { itemId: 146, qty: 1 },
      },
      {
        id: 147,
        name: "Oak longbow",
        skill: "fletching",
        group: "Longbows",
        levelReq: 15,
        baseTicks: 5,
        xp: 22,
        inputs: [{ itemId: 11, qty: 2 }],
        output: { itemId: 147, qty: 1 },
      },
      {
        id: 148,
        name: "Willow longbow",
        skill: "fletching",
        group: "Longbows",
        levelReq: 30,
        baseTicks: 5,
        xp: 34,
        inputs: [{ itemId: 12, qty: 2 }],
        output: { itemId: 148, qty: 1 },
      },
      {
        id: 149,
        name: "Maple longbow",
        skill: "fletching",
        group: "Longbows",
        levelReq: 45,
        baseTicks: 5,
        xp: 54,
        inputs: [{ itemId: 13, qty: 2 }],
        output: { itemId: 149, qty: 1 },
      },
      {
        id: 150,
        name: "Yew longbow",
        skill: "fletching",
        group: "Longbows",
        levelReq: 60,
        baseTicks: 5,
        xp: 86,
        inputs: [{ itemId: 14, qty: 2 }],
        output: { itemId: 150, qty: 1 },
      },
      {
        id: 151,
        name: "Magic longbow",
        skill: "fletching",
        group: "Longbows",
        levelReq: 75,
        baseTicks: 5,
        xp: 140,
        inputs: [{ itemId: 15, qty: 2 }],
        output: { itemId: 151, qty: 1 },
      },
      {
        id: 200,
        name: "Staff",
        skill: "fletching",
        group: "Staffs",
        levelReq: 1,
        baseTicks: 5,
        xp: 8,
        inputs: [{ itemId: 10, qty: 2 }],
        output: { itemId: 152, qty: 1 },
      },
      {
        id: 201,
        name: "Oak staff",
        skill: "fletching",
        group: "Staffs",
        levelReq: 15,
        baseTicks: 5,
        xp: 22,
        inputs: [{ itemId: 11, qty: 2 }],
        output: { itemId: 153, qty: 1 },
      },
      {
        id: 202,
        name: "Willow staff",
        skill: "fletching",
        group: "Staffs",
        levelReq: 30,
        baseTicks: 5,
        xp: 40,
        inputs: [{ itemId: 12, qty: 2 }],
        output: { itemId: 154, qty: 1 },
      },
      {
        id: 203,
        name: "Maple staff",
        skill: "fletching",
        group: "Staffs",
        levelReq: 45,
        baseTicks: 5,
        xp: 65,
        inputs: [{ itemId: 13, qty: 2 }],
        output: { itemId: 155, qty: 1 },
      },
      {
        id: 204,
        name: "Yew staff",
        skill: "fletching",
        group: "Staffs",
        levelReq: 60,
        baseTicks: 5,
        xp: 100,
        inputs: [{ itemId: 14, qty: 2 }],
        output: { itemId: 156, qty: 1 },
      },
      {
        id: 205,
        name: "Magic staff",
        skill: "fletching",
        group: "Staffs",
        levelReq: 75,
        baseTicks: 5,
        xp: 150,
        inputs: [{ itemId: 15, qty: 2 }],
        output: { itemId: 157, qty: 1 },
      },
      {
        id: 210,
        name: "Sage",
        skill: "farming",
        group: "Herbs",
        levelReq: 10,
        baseTicks: 2,
        xp: 260,
        inputs: [{ itemId: 190, qty: 1 }],
        output: { itemId: 193, qty: 1 },
        grow: 1200,
      },
      {
        id: 211,
        name: "Nightshade",
        skill: "farming",
        group: "Herbs",
        levelReq: 35,
        baseTicks: 2,
        xp: 1200,
        inputs: [{ itemId: 191, qty: 1 }],
        output: { itemId: 194, qty: 1 },
        grow: 3000,
      },
      {
        id: 212,
        name: "Dragonleaf",
        skill: "farming",
        group: "Herbs",
        levelReq: 65,
        baseTicks: 2,
        xp: 4600,
        inputs: [{ itemId: 192, qty: 1 }],
        output: { itemId: 195, qty: 1 },
        grow: 7000,
      },
      {
        id: 220,
        name: "Gatherer's draught",
        skill: "herblore",
        group: "Potions",
        levelReq: 1,
        baseTicks: 6,
        xp: 30,
        inputs: [
          { itemId: 193, qty: 1 },
          { itemId: 240, qty: 1 },
        ],
        output: { itemId: 220, qty: 1 },
      },
      {
        id: 225,
        name: "Swift draught",
        skill: "herblore",
        group: "Potions",
        levelReq: 20,
        baseTicks: 6,
        xp: 70,
        inputs: [
          { itemId: 193, qty: 1 },
          { itemId: 242, qty: 1 },
        ],
        output: { itemId: 225, qty: 1 },
      },
      {
        id: 226,
        name: "Nourishing draught",
        skill: "herblore",
        group: "Potions",
        levelReq: 50,
        baseTicks: 6,
        xp: 240,
        inputs: [
          { itemId: 194, qty: 1 },
          { itemId: 244, qty: 1 },
        ],
        output: { itemId: 226, qty: 1 },
      },
      {
        id: 227,
        name: "Haste draught",
        skill: "herblore",
        group: "Potions",
        levelReq: 70,
        baseTicks: 7,
        xp: 460,
        inputs: [
          { itemId: 195, qty: 1 },
          { itemId: 245, qty: 1 },
        ],
        output: { itemId: 227, qty: 1 },
      },
      {
        id: 221,
        name: "Hunter's brew",
        skill: "herblore",
        group: "Potions",
        levelReq: 35,
        baseTicks: 6,
        xp: 120,
        inputs: [
          { itemId: 194, qty: 1 },
          { itemId: 243, qty: 1 },
        ],
        output: { itemId: 221, qty: 1 },
      },
      {
        id: 222,
        name: "Warrior's tonic",
        skill: "herblore",
        group: "Potions",
        levelReq: 60,
        baseTicks: 6,
        xp: 300,
        inputs: [
          { itemId: 195, qty: 1 },
          { itemId: 244, qty: 1 },
        ],
        output: { itemId: 222, qty: 1 },
      },
      {
        id: 223,
        name: "Elixir of the vein",
        skill: "herblore",
        group: "Potions",
        levelReq: 80,
        baseTicks: 7,
        xp: 700,
        inputs: [
          { itemId: 194, qty: 1 },
          { itemId: 195, qty: 1 },
          { itemId: 246, qty: 1 },
        ],
        output: { itemId: 223, qty: 1 },
      },
      {
        id: 224,
        name: "Abyssal tonic",
        skill: "herblore",
        group: "Potions",
        levelReq: 95,
        baseTicks: 7,
        xp: 1600,
        inputs: [
          { itemId: 195, qty: 1 },
          { itemId: 249, qty: 1 },
        ],
        output: { itemId: 224, qty: 1 },
      },
      {
        id: 230,
        name: "Cut gem",
        skill: "crafting",
        group: "Gems",
        levelReq: 1,
        baseTicks: 5,
        xp: 16,
        inputs: [{ itemId: 100, qty: 1 }],
        output: { itemId: 180, qty: 1 },
      },
      {
        id: 231,
        name: "Silver ring",
        skill: "crafting",
        group: "Rings",
        levelReq: 20,
        baseTicks: 6,
        xp: 58,
        inputs: [
          { itemId: 4, qty: 1 },
          { itemId: 180, qty: 1 },
        ],
        output: { itemId: 181, qty: 1 },
      },
      {
        id: 232,
        name: "Gold ring",
        skill: "crafting",
        group: "Rings",
        levelReq: 45,
        baseTicks: 6,
        xp: 156,
        inputs: [
          { itemId: 6, qty: 1 },
          { itemId: 180, qty: 1 },
        ],
        output: { itemId: 182, qty: 1 },
      },
      {
        id: 233,
        name: "Meteoric ring",
        skill: "crafting",
        group: "Rings",
        levelReq: 75,
        baseTicks: 7,
        xp: 455,
        inputs: [
          { itemId: 44, qty: 1 },
          { itemId: 180, qty: 2 },
        ],
        output: { itemId: 183, qty: 1 },
      },
      {
        id: 307,
        name: "Wyrm ring",
        skill: "crafting",
        group: "Rings",
        levelReq: 95,
        baseTicks: 8,
        xp: 1200,
        inputs: [
          { itemId: 356, qty: 1 },
          { itemId: 180, qty: 2 },
        ],
        output: { itemId: 358, qty: 1 },
      },
      {
        id: 234,
        name: "Silver amulet",
        skill: "crafting",
        group: "Amulets",
        levelReq: 30,
        baseTicks: 6,
        xp: 84,
        inputs: [
          { itemId: 4, qty: 1 },
          { itemId: 180, qty: 1 },
        ],
        output: { itemId: 184, qty: 1 },
      },
      {
        id: 235,
        name: "Gold amulet",
        skill: "crafting",
        group: "Amulets",
        levelReq: 55,
        baseTicks: 6,
        xp: 221,
        inputs: [
          { itemId: 6, qty: 1 },
          { itemId: 180, qty: 1 },
        ],
        output: { itemId: 185, qty: 1 },
      },
      {
        id: 236,
        name: "Meteoric amulet",
        skill: "crafting",
        group: "Amulets",
        levelReq: 85,
        baseTicks: 7,
        xp: 618,
        inputs: [
          { itemId: 44, qty: 1 },
          { itemId: 180, qty: 2 },
        ],
        output: { itemId: 186, qty: 1 },
      },
      {
        id: 306,
        name: "Leviathan amulet",
        skill: "crafting",
        group: "Amulets",
        levelReq: 95,
        baseTicks: 8,
        xp: 1400,
        inputs: [
          { itemId: 355, qty: 1 },
          { itemId: 180, qty: 2 },
        ],
        output: { itemId: 357, qty: 1 },
      },
      {
        id: 260,
        name: "Pelt coif",
        skill: "crafting",
        group: "Leather",
        levelReq: 1,
        baseTicks: 6,
        xp: 8,
        inputs: [{ itemId: 240, qty: 2 }],
        output: { itemId: 260, qty: 1 },
      },
      {
        id: 261,
        name: "Pelt chaps",
        skill: "crafting",
        group: "Leather",
        levelReq: 1,
        baseTicks: 6,
        xp: 12,
        inputs: [{ itemId: 240, qty: 3 }],
        output: { itemId: 262, qty: 1 },
      },
      {
        id: 262,
        name: "Pelt jerkin",
        skill: "crafting",
        group: "Leather",
        levelReq: 1,
        baseTicks: 6,
        xp: 20,
        inputs: [{ itemId: 240, qty: 5 }],
        output: { itemId: 261, qty: 1 },
      },
      {
        id: 263,
        name: "Bogskin coif",
        skill: "crafting",
        group: "Leather",
        levelReq: 15,
        baseTicks: 6,
        xp: 22,
        inputs: [{ itemId: 241, qty: 2 }],
        output: { itemId: 263, qty: 1 },
      },
      {
        id: 264,
        name: "Bogskin chaps",
        skill: "crafting",
        group: "Leather",
        levelReq: 15,
        baseTicks: 6,
        xp: 33,
        inputs: [{ itemId: 241, qty: 3 }],
        output: { itemId: 265, qty: 1 },
      },
      {
        id: 265,
        name: "Bogskin jerkin",
        skill: "crafting",
        group: "Leather",
        levelReq: 15,
        baseTicks: 6,
        xp: 55,
        inputs: [{ itemId: 241, qty: 5 }],
        output: { itemId: 264, qty: 1 },
      },
      {
        id: 266,
        name: "Chitin coif",
        skill: "crafting",
        group: "Leather",
        levelReq: 30,
        baseTicks: 6,
        xp: 60,
        inputs: [{ itemId: 242, qty: 2 }],
        output: { itemId: 266, qty: 1 },
      },
      {
        id: 267,
        name: "Chitin chaps",
        skill: "crafting",
        group: "Leather",
        levelReq: 30,
        baseTicks: 6,
        xp: 90,
        inputs: [{ itemId: 242, qty: 3 }],
        output: { itemId: 268, qty: 1 },
      },
      {
        id: 268,
        name: "Chitin jerkin",
        skill: "crafting",
        group: "Leather",
        levelReq: 30,
        baseTicks: 6,
        xp: 150,
        inputs: [{ itemId: 242, qty: 5 }],
        output: { itemId: 267, qty: 1 },
      },
      {
        id: 269,
        name: "Fur coif",
        skill: "crafting",
        group: "Leather",
        levelReq: 60,
        baseTicks: 7,
        xp: 180,
        inputs: [{ itemId: 245, qty: 2 }],
        output: { itemId: 269, qty: 1 },
      },
      {
        id: 270,
        name: "Fur chaps",
        skill: "crafting",
        group: "Leather",
        levelReq: 60,
        baseTicks: 7,
        xp: 270,
        inputs: [{ itemId: 245, qty: 3 }],
        output: { itemId: 271, qty: 1 },
      },
      {
        id: 271,
        name: "Fur jerkin",
        skill: "crafting",
        group: "Leather",
        levelReq: 60,
        baseTicks: 7,
        xp: 450,
        inputs: [{ itemId: 245, qty: 5 }],
        output: { itemId: 270, qty: 1 },
      },
      {
        id: 272,
        name: "Scale coif",
        skill: "crafting",
        group: "Leather",
        levelReq: 85,
        baseTicks: 7,
        xp: 460,
        inputs: [{ itemId: 247, qty: 2 }],
        output: { itemId: 272, qty: 1 },
      },
      {
        id: 273,
        name: "Scale chaps",
        skill: "crafting",
        group: "Leather",
        levelReq: 85,
        baseTicks: 7,
        xp: 690,
        inputs: [{ itemId: 247, qty: 3 }],
        output: { itemId: 274, qty: 1 },
      },
      {
        id: 274,
        name: "Scale jerkin",
        skill: "crafting",
        group: "Leather",
        levelReq: 85,
        baseTicks: 7,
        xp: 1150,
        inputs: [{ itemId: 247, qty: 5 }],
        output: { itemId: 273, qty: 1 },
      },
      {
        id: 289,
        name: "Troll coif",
        skill: "crafting",
        group: "Leather",
        levelReq: 95,
        baseTicks: 8,
        xp: 1250,
        inputs: [{ itemId: 248, qty: 2 }],
        output: { itemId: 338, qty: 1 },
      },
      {
        id: 290,
        name: "Troll chaps",
        skill: "crafting",
        group: "Leather",
        levelReq: 95,
        baseTicks: 8,
        xp: 1900,
        inputs: [{ itemId: 248, qty: 3 }],
        output: { itemId: 340, qty: 1 },
      },
      {
        id: 291,
        name: "Troll jerkin",
        skill: "crafting",
        group: "Leather",
        levelReq: 95,
        baseTicks: 8,
        xp: 3100,
        inputs: [{ itemId: 248, qty: 5 }],
        output: { itemId: 339, qty: 1 },
      },
      {
        id: 292,
        name: "Drake coif",
        skill: "crafting",
        group: "Leather",
        levelReq: 99,
        baseTicks: 8,
        xp: 3300,
        inputs: [{ itemId: 251, qty: 2 }],
        output: { itemId: 341, qty: 1 },
      },
      {
        id: 293,
        name: "Drake chaps",
        skill: "crafting",
        group: "Leather",
        levelReq: 99,
        baseTicks: 8,
        xp: 5000,
        inputs: [{ itemId: 251, qty: 3 }],
        output: { itemId: 343, qty: 1 },
      },
      {
        id: 294,
        name: "Drake jerkin",
        skill: "crafting",
        group: "Leather",
        levelReq: 99,
        baseTicks: 8,
        xp: 8300,
        inputs: [{ itemId: 251, qty: 5 }],
        output: { itemId: 342, qty: 1 },
      },
      {
        id: 240,
        name: "Bread stall",
        skill: "thieving",
        group: "Stalls",
        levelReq: 1,
        baseTicks: 6,
        xp: 8,
        inputs: [],
        output: { itemId: 200, qty: 6 },
        caught: { chanceAtReq: 0.25, safeAtLevel: 30, stunTicks: 8 },
      },
      {
        id: 241,
        name: "Silk stall",
        skill: "thieving",
        group: "Stalls",
        levelReq: 25,
        baseTicks: 7,
        xp: 30,
        inputs: [],
        output: { itemId: 200, qty: 28 },
        caught: { chanceAtReq: 0.3, safeAtLevel: 60, stunTicks: 10 },
        bonus: { itemId: 191, chance: 0.03333333333333333 },
      },
      {
        id: 242,
        name: "Gem stall",
        skill: "thieving",
        group: "Stalls",
        levelReq: 50,
        baseTicks: 8,
        xp: 80,
        inputs: [],
        output: { itemId: 200, qty: 90 },
        bonus: { itemId: 100, chance: 0.04 },
        caught: { chanceAtReq: 0.32, safeAtLevel: 85, stunTicks: 12 },
      },
      {
        id: 243,
        name: "Relic stall",
        skill: "thieving",
        group: "Stalls",
        levelReq: 75,
        baseTicks: 9,
        xp: 200,
        inputs: [],
        output: { itemId: 200, qty: 260 },
        bonus: { itemId: 208, chance: 0.03 },
        caught: { chanceAtReq: 0.35, safeAtLevel: 110, stunTicks: 15 },
      },
      {
        id: 244,
        name: "Linen line",
        skill: "thieving",
        group: "Cloth",
        levelReq: 1,
        baseTicks: 7,
        xp: 7,
        inputs: [],
        output: { itemId: 300, qty: 1 },
        caught: { chanceAtReq: 0.25, safeAtLevel: 30, stunTicks: 8 },
      },
      {
        id: 245,
        name: "Silk cart",
        skill: "thieving",
        group: "Cloth",
        levelReq: 25,
        baseTicks: 8,
        xp: 26,
        inputs: [],
        output: { itemId: 301, qty: 1 },
        caught: { chanceAtReq: 0.3, safeAtLevel: 60, stunTicks: 10 },
      },
      {
        id: 246,
        name: "Gilded loom",
        skill: "thieving",
        group: "Cloth",
        levelReq: 50,
        baseTicks: 9,
        xp: 70,
        inputs: [],
        output: { itemId: 302, qty: 1 },
        caught: { chanceAtReq: 0.32, safeAtLevel: 85, stunTicks: 12 },
      },
      {
        id: 247,
        name: "Reliquary vestry",
        skill: "thieving",
        group: "Cloth",
        levelReq: 75,
        baseTicks: 10,
        xp: 175,
        inputs: [],
        output: { itemId: 303, qty: 1 },
        caught: { chanceAtReq: 0.35, safeAtLevel: 110, stunTicks: 15 },
      },
      {
        id: 248,
        name: "Homespun hood",
        skill: "crafting",
        group: "Cloth",
        levelReq: 1,
        baseTicks: 6,
        xp: 9,
        inputs: [{ itemId: 300, qty: 2 }],
        output: { itemId: 304, qty: 1 },
      },
      {
        id: 249,
        name: "Homespun skirt",
        skill: "crafting",
        group: "Cloth",
        levelReq: 1,
        baseTicks: 6,
        xp: 14,
        inputs: [{ itemId: 300, qty: 3 }],
        output: { itemId: 306, qty: 1 },
      },
      {
        id: 250,
        name: "Homespun robe",
        skill: "crafting",
        group: "Cloth",
        levelReq: 1,
        baseTicks: 6,
        xp: 23,
        inputs: [{ itemId: 300, qty: 5 }],
        output: { itemId: 305, qty: 1 },
      },
      {
        id: 251,
        name: "Silk hood",
        skill: "crafting",
        group: "Cloth",
        levelReq: 25,
        baseTicks: 6,
        xp: 50,
        inputs: [{ itemId: 301, qty: 2 }],
        output: { itemId: 307, qty: 1 },
      },
      {
        id: 252,
        name: "Silk skirt",
        skill: "crafting",
        group: "Cloth",
        levelReq: 25,
        baseTicks: 6,
        xp: 75,
        inputs: [{ itemId: 301, qty: 3 }],
        output: { itemId: 309, qty: 1 },
      },
      {
        id: 253,
        name: "Silk robe",
        skill: "crafting",
        group: "Cloth",
        levelReq: 25,
        baseTicks: 6,
        xp: 125,
        inputs: [{ itemId: 301, qty: 5 }],
        output: { itemId: 308, qty: 1 },
      },
      {
        id: 254,
        name: "Gilded hood",
        skill: "crafting",
        group: "Cloth",
        levelReq: 50,
        baseTicks: 7,
        xp: 145,
        inputs: [{ itemId: 302, qty: 2 }],
        output: { itemId: 310, qty: 1 },
      },
      {
        id: 255,
        name: "Gilded skirt",
        skill: "crafting",
        group: "Cloth",
        levelReq: 50,
        baseTicks: 7,
        xp: 215,
        inputs: [{ itemId: 302, qty: 3 }],
        output: { itemId: 312, qty: 1 },
      },
      {
        id: 256,
        name: "Gilded robe",
        skill: "crafting",
        group: "Cloth",
        levelReq: 50,
        baseTicks: 7,
        xp: 360,
        inputs: [{ itemId: 302, qty: 5 }],
        output: { itemId: 311, qty: 1 },
      },
      {
        id: 257,
        name: "Voidweave hood",
        skill: "crafting",
        group: "Cloth",
        levelReq: 75,
        baseTicks: 7,
        xp: 380,
        inputs: [{ itemId: 303, qty: 2 }],
        output: { itemId: 313, qty: 1 },
      },
      {
        id: 258,
        name: "Voidweave skirt",
        skill: "crafting",
        group: "Cloth",
        levelReq: 75,
        baseTicks: 7,
        xp: 570,
        inputs: [{ itemId: 303, qty: 3 }],
        output: { itemId: 315, qty: 1 },
      },
      {
        id: 259,
        name: "Voidweave robe",
        skill: "crafting",
        group: "Cloth",
        levelReq: 75,
        baseTicks: 7,
        xp: 950,
        inputs: [{ itemId: 303, qty: 5 }],
        output: { itemId: 314, qty: 1 },
      },
      {
        id: 295,
        name: "Wightweave hood",
        skill: "crafting",
        group: "Cloth",
        levelReq: 90,
        baseTicks: 8,
        xp: 1000,
        inputs: [
          { itemId: 303, qty: 2 },
          { itemId: 250, qty: 1 },
        ],
        output: { itemId: 344, qty: 1 },
      },
      {
        id: 296,
        name: "Wightweave skirt",
        skill: "crafting",
        group: "Cloth",
        levelReq: 90,
        baseTicks: 8,
        xp: 1500,
        inputs: [
          { itemId: 303, qty: 3 },
          { itemId: 250, qty: 2 },
        ],
        output: { itemId: 346, qty: 1 },
      },
      {
        id: 297,
        name: "Wightweave robe",
        skill: "crafting",
        group: "Cloth",
        levelReq: 90,
        baseTicks: 8,
        xp: 2500,
        inputs: [
          { itemId: 303, qty: 5 },
          { itemId: 250, qty: 3 },
        ],
        output: { itemId: 345, qty: 1 },
      },
      {
        id: 275,
        name: "Pelt gloves",
        skill: "crafting",
        group: "Gloves",
        levelReq: 5,
        baseTicks: 6,
        xp: 10,
        inputs: [{ itemId: 240, qty: 4 }],
        output: { itemId: 323, qty: 1 },
      },
      {
        id: 276,
        name: "Bogskin gloves",
        skill: "crafting",
        group: "Gloves",
        levelReq: 25,
        baseTicks: 6,
        xp: 28,
        inputs: [
          { itemId: 241, qty: 2 },
          { itemId: 202, qty: 1 },
        ],
        output: { itemId: 324, qty: 1 },
      },
      {
        id: 277,
        name: "Chitin gloves",
        skill: "crafting",
        group: "Gloves",
        levelReq: 45,
        baseTicks: 6,
        xp: 75,
        inputs: [
          { itemId: 242, qty: 2 },
          { itemId: 203, qty: 1 },
        ],
        output: { itemId: 325, qty: 1 },
      },
      {
        id: 278,
        name: "Bone gloves",
        skill: "crafting",
        group: "Gloves",
        levelReq: 65,
        baseTicks: 7,
        xp: 225,
        inputs: [
          { itemId: 243, qty: 2 },
          { itemId: 204, qty: 1 },
        ],
        output: { itemId: 326, qty: 1 },
      },
      {
        id: 280,
        name: "Pelt quiver",
        skill: "fletching",
        group: "Quivers",
        levelReq: 1,
        baseTicks: 5,
        xp: 14,
        inputs: [
          { itemId: 240, qty: 2 },
          { itemId: 10, qty: 1 },
        ],
        output: { itemId: 329, qty: 1 },
      },
      {
        id: 281,
        name: "Bogskin quiver",
        skill: "fletching",
        group: "Quivers",
        levelReq: 15,
        baseTicks: 5,
        xp: 34,
        inputs: [
          { itemId: 241, qty: 2 },
          { itemId: 11, qty: 1 },
        ],
        output: { itemId: 330, qty: 1 },
      },
      {
        id: 282,
        name: "Chitin quiver",
        skill: "fletching",
        group: "Quivers",
        levelReq: 30,
        baseTicks: 5,
        xp: 70,
        inputs: [
          { itemId: 242, qty: 2 },
          { itemId: 12, qty: 1 },
        ],
        output: { itemId: 331, qty: 1 },
      },
      {
        id: 283,
        name: "Fur quiver",
        skill: "fletching",
        group: "Quivers",
        levelReq: 60,
        baseTicks: 5,
        xp: 150,
        inputs: [
          { itemId: 245, qty: 2 },
          { itemId: 13, qty: 1 },
        ],
        output: { itemId: 332, qty: 1 },
      },
      {
        id: 284,
        name: "Scale quiver",
        skill: "fletching",
        group: "Quivers",
        levelReq: 85,
        baseTicks: 5,
        xp: 320,
        inputs: [
          { itemId: 247, qty: 2 },
          { itemId: 14, qty: 1 },
        ],
        output: { itemId: 333, qty: 1 },
      },
      {
        id: 298,
        name: "Troll quiver",
        skill: "fletching",
        group: "Quivers",
        levelReq: 95,
        baseTicks: 6,
        xp: 700,
        inputs: [
          { itemId: 248, qty: 2 },
          { itemId: 15, qty: 1 },
        ],
        output: { itemId: 347, qty: 1 },
      },
      {
        id: 299,
        name: "Drake quiver",
        skill: "fletching",
        group: "Quivers",
        levelReq: 99,
        baseTicks: 6,
        xp: 1400,
        inputs: [
          { itemId: 251, qty: 2 },
          { itemId: 15, qty: 2 },
        ],
        output: { itemId: 348, qty: 1 },
      },
      {
        id: 285,
        name: "Linen grimoire",
        skill: "crafting",
        group: "Grimoires",
        levelReq: 1,
        baseTicks: 6,
        xp: 16,
        inputs: [{ itemId: 300, qty: 3 }],
        output: { itemId: 334, qty: 1 },
      },
      {
        id: 286,
        name: "Silk grimoire",
        skill: "crafting",
        group: "Grimoires",
        levelReq: 25,
        baseTicks: 6,
        xp: 85,
        inputs: [
          { itemId: 301, qty: 3 },
          { itemId: 241, qty: 1 },
        ],
        output: { itemId: 335, qty: 1 },
      },
      {
        id: 287,
        name: "Gilded grimoire",
        skill: "crafting",
        group: "Grimoires",
        levelReq: 50,
        baseTicks: 7,
        xp: 230,
        inputs: [
          { itemId: 302, qty: 3 },
          { itemId: 244, qty: 1 },
        ],
        output: { itemId: 336, qty: 1 },
      },
      {
        id: 288,
        name: "Voidweave grimoire",
        skill: "crafting",
        group: "Grimoires",
        levelReq: 75,
        baseTicks: 7,
        xp: 560,
        inputs: [
          { itemId: 303, qty: 3 },
          { itemId: 246, qty: 2 },
        ],
        output: { itemId: 337, qty: 1 },
      },
      {
        id: 300,
        name: "Wightweave grimoire",
        skill: "crafting",
        group: "Grimoires",
        levelReq: 90,
        baseTicks: 8,
        xp: 1200,
        inputs: [
          { itemId: 303, qty: 3 },
          { itemId: 250, qty: 2 },
        ],
        output: { itemId: 349, qty: 1 },
      },
      {
        id: 279,
        name: "Scale gloves",
        skill: "crafting",
        group: "Gloves",
        levelReq: 85,
        baseTicks: 7,
        xp: 575,
        inputs: [
          { itemId: 247, qty: 2 },
          { itemId: 206, qty: 1 },
        ],
        output: { itemId: 327, qty: 1 },
      },
    ],
    items: [
      { id: 1, name: "Copper", stackable: false, value: 3 },
      { id: 2, name: "Tin", stackable: false, value: 4 },
      { id: 3, name: "Iron", stackable: false, value: 12 },
      { id: 4, name: "Silver", stackable: false, value: 40 },
      { id: 5, name: "Coal", stackable: false, value: 55 },
      { id: 6, name: "Gold", stackable: false, value: 140 },
      { id: 7, name: "Cobalt", stackable: false, value: 380 },
      { id: 8, name: "Meteoric", stackable: false, value: 900 },
      { id: 10, name: "Logs", stackable: false, value: 3 },
      { id: 11, name: "Oak logs", stackable: false, value: 15 },
      { id: 12, name: "Willow logs", stackable: false, value: 45 },
      { id: 13, name: "Maple logs", stackable: false, value: 100 },
      { id: 14, name: "Yew logs", stackable: false, value: 240 },
      { id: 15, name: "Magic logs", stackable: false, value: 600 },
      { id: 20, name: "Shrimp", stackable: false, value: 4 },
      { id: 21, name: "Sardine", stackable: false, value: 9 },
      { id: 22, name: "Trout", stackable: false, value: 26 },
      { id: 23, name: "Salmon", stackable: false, value: 48 },
      { id: 24, name: "Tuna", stackable: false, value: 92 },
      { id: 25, name: "Lobster", stackable: false, value: 175 },
      { id: 26, name: "Swordfish", stackable: false, value: 330 },
      { id: 27, name: "Shark", stackable: false, value: 780 },
      { id: 40, name: "Bronze bar", stackable: false, value: 12 },
      { id: 41, name: "Iron bar", stackable: false, value: 22 },
      { id: 42, name: "Steel bar", stackable: false, value: 156 },
      { id: 43, name: "Cobalt bar", stackable: false, value: 660 },
      { id: 44, name: "Meteoric bar", stackable: false, value: 1527 },
      { id: 60, name: "Cooked shrimp", stackable: false, value: 9, heals: 3 },
      { id: 61, name: "Cooked sardine", stackable: false, value: 15, heals: 4 },
      { id: 62, name: "Cooked trout", stackable: false, value: 44, heals: 7 },
      { id: 63, name: "Cooked salmon", stackable: false, value: 82, heals: 9 },
      { id: 64, name: "Cooked tuna", stackable: false, value: 150, heals: 12 },
      { id: 65, name: "Cooked lobster", stackable: false, value: 290, heals: 16 },
      { id: 66, name: "Cooked swordfish", stackable: false, value: 550, heals: 20 },
      { id: 67, name: "Cooked shark", stackable: false, value: 1280, heals: 26 },
      { id: 70, name: "Burnt food", stackable: true, value: 0 },
      { id: 80, name: "Bronze pickaxe", stackable: false, value: 29 },
      { id: 81, name: "Iron pickaxe", stackable: false, value: 54 },
      { id: 82, name: "Steel pickaxe", stackable: false, value: 346 },
      { id: 83, name: "Cobalt pickaxe", stackable: false, value: 1435 },
      { id: 84, name: "Meteoric pickaxe", stackable: false, value: 3461 },
      { id: 85, name: "Bronze rod", stackable: false, value: 20 },
      { id: 86, name: "Iron rod", stackable: false, value: 47 },
      { id: 87, name: "Steel rod", stackable: false, value: 235 },
      { id: 88, name: "Cobalt rod", stackable: false, value: 1015 },
      { id: 89, name: "Meteoric rod", stackable: false, value: 2534 },
      { id: 90, name: "Bronze axe", stackable: false, value: 29 },
      { id: 91, name: "Iron axe", stackable: false, value: 54 },
      { id: 92, name: "Steel axe", stackable: false, value: 346 },
      { id: 93, name: "Cobalt axe", stackable: false, value: 1435 },
      { id: 94, name: "Meteoric axe", stackable: false, value: 3461 },
      { id: 110, name: "Bronze blade", stackable: false, value: 17 },
      { id: 111, name: "Iron blade", stackable: false, value: 32 },
      { id: 112, name: "Steel blade", stackable: false, value: 190 },
      { id: 113, name: "Cobalt blade", stackable: false, value: 775 },
      { id: 114, name: "Meteoric blade", stackable: false, value: 1934 },
      { id: 115, name: "Bronze shield", stackable: false, value: 41 },
      { id: 116, name: "Iron shield", stackable: false, value: 76 },
      { id: 117, name: "Steel shield", stackable: false, value: 502 },
      { id: 118, name: "Cobalt shield", stackable: false, value: 2095 },
      { id: 119, name: "Meteoric shield", stackable: false, value: 4988 },
      { id: 120, name: "Bronze helm", stackable: false, value: 29 },
      { id: 121, name: "Iron helm", stackable: false, value: 54 },
      { id: 122, name: "Steel helm", stackable: false, value: 346 },
      { id: 123, name: "Cobalt helm", stackable: false, value: 1435 },
      { id: 124, name: "Meteoric helm", stackable: false, value: 3461 },
      { id: 125, name: "Bronze plate", stackable: false, value: 65 },
      { id: 126, name: "Iron plate", stackable: false, value: 120 },
      { id: 127, name: "Steel plate", stackable: false, value: 814 },
      { id: 128, name: "Cobalt plate", stackable: false, value: 3415 },
      { id: 129, name: "Meteoric plate", stackable: false, value: 8042 },
      { id: 130, name: "Bronze greaves", stackable: false, value: 53 },
      { id: 131, name: "Iron greaves", stackable: false, value: 98 },
      { id: 132, name: "Steel greaves", stackable: false, value: 658 },
      { id: 133, name: "Cobalt greaves", stackable: false, value: 2755 },
      { id: 134, name: "Meteoric greaves", stackable: false, value: 6515 },
      { id: 140, name: "Shortbow", stackable: false, value: 8 },
      { id: 141, name: "Oak shortbow", stackable: false, value: 25 },
      { id: 142, name: "Willow shortbow", stackable: false, value: 79 },
      { id: 143, name: "Maple shortbow", stackable: false, value: 158 },
      { id: 144, name: "Yew shortbow", stackable: false, value: 355 },
      { id: 145, name: "Magic shortbow", stackable: false, value: 820 },
      { id: 146, name: "Longbow", stackable: false, value: 11 },
      { id: 147, name: "Oak longbow", stackable: false, value: 40 },
      { id: 148, name: "Willow longbow", stackable: false, value: 124 },
      { id: 149, name: "Maple longbow", stackable: false, value: 258 },
      { id: 150, name: "Yew longbow", stackable: false, value: 595 },
      { id: 151, name: "Magic longbow", stackable: false, value: 1420 },
      { id: 152, name: "Staff", stackable: false, value: 11 },
      { id: 153, name: "Oak staff", stackable: false, value: 40 },
      { id: 154, name: "Willow staff", stackable: false, value: 124 },
      { id: 155, name: "Maple staff", stackable: false, value: 258 },
      { id: 156, name: "Yew staff", stackable: false, value: 595 },
      { id: 157, name: "Magic staff", stackable: false, value: 1420 },
      { id: 100, name: "Rough gem", stackable: true, value: 2500 },
      { id: 200, name: "Coins", stackable: true, value: 1 },
      { id: 201, name: "Gnawed charm", stackable: true, value: 1500 },
      { id: 202, name: "Bog pearl", stackable: true, value: 4000 },
      { id: 203, name: "Dry sigil", stackable: true, value: 12000 },
      { id: 204, name: "Cairn token", stackable: true, value: 40000 },
      { id: 205, name: "Rime fang", stackable: true, value: 120000 },
      { id: 206, name: "Ember heart", stackable: true, value: 350000 },
      { id: 207, name: "Abyssal eye", stackable: true, value: 900000 },
      { id: 208, name: "Voidshard", stackable: true, value: 1500 },
      { id: 160, name: "Potato seed", stackable: true, value: 2 },
      { id: 161, name: "Glowcap spore", stackable: true, value: 6 },
      { id: 162, name: "Turnip seed", stackable: true, value: 14 },
      { id: 163, name: "Bitterroot seed", stackable: true, value: 30 },
      { id: 164, name: "Voidmelon seed", stackable: true, value: 60 },
      { id: 165, name: "Pepper seed", stackable: true, value: 110 },
      { id: 170, name: "Potato", stackable: false, value: 7, heals: 3 },
      { id: 171, name: "Glowcap", stackable: false, value: 22, heals: 5 },
      { id: 172, name: "Cave turnip", stackable: false, value: 55, heals: 7 },
      { id: 173, name: "Bitterroot", stackable: false, value: 120, heals: 10 },
      { id: 174, name: "Voidmelon", stackable: false, value: 260, heals: 14 },
      { id: 175, name: "Ember pepper", stackable: false, value: 520, heals: 20 },
      { id: 180, name: "Cut gem", stackable: true, value: 2505 },
      { id: 181, name: "Silver ring", stackable: false, value: 2563 },
      { id: 182, name: "Gold ring", stackable: false, value: 2703 },
      { id: 183, name: "Meteoric ring", stackable: false, value: 6757 },
      { id: 184, name: "Silver amulet", stackable: false, value: 2579 },
      { id: 185, name: "Gold amulet", stackable: false, value: 2741 },
      { id: 186, name: "Meteoric amulet", stackable: false, value: 6944 },
      { id: 190, name: "Sage seed", stackable: true, value: 6 },
      { id: 191, name: "Nightshade seed", stackable: true, value: 40 },
      { id: 192, name: "Dragonleaf seed", stackable: true, value: 220 },
      { id: 193, name: "Sage", stackable: true, value: 18 },
      { id: 194, name: "Nightshade", stackable: true, value: 110 },
      { id: 195, name: "Dragonleaf", stackable: true, value: 520 },
      { id: 209, name: "Gravemaw skull", stackable: false, value: 250000 },
      { id: 210, name: "Hollow crown", stackable: false, value: 1000000 },
      { id: 211, name: "Riftborne heart", stackable: false, value: 4000000 },
      { id: 212, name: "Colossus core", stackable: false, value: 15000000 },
      { id: 213, name: "Wraith ash", stackable: true, value: 15000 },
      { id: 214, name: "Stalker fang", stackable: true, value: 30000 },
      { id: 215, name: "Troll tusk", stackable: true, value: 50000 },
      { id: 216, name: "Wight crown", stackable: true, value: 120000 },
      { id: 217, name: "Drake scale", stackable: true, value: 250000 },
      { id: 218, name: "Colossus ember", stackable: true, value: 500000 },
      { id: 220, name: "Gatherer's draught", stackable: true, value: 28 },
      { id: 221, name: "Hunter's brew", stackable: true, value: 272 },
      { id: 222, name: "Warrior's tonic", stackable: true, value: 835 },
      { id: 223, name: "Elixir of the vein", stackable: true, value: 1643 },
      { id: 224, name: "Abyssal tonic", stackable: true, value: 2103 },
      { id: 225, name: "Swift draught", stackable: true, value: 96 },
      { id: 226, name: "Nourishing draught", stackable: true, value: 387 },
      { id: 227, name: "Haste draught", stackable: true, value: 1205 },
      { id: 240, name: "Gnawer pelt", stackable: true, value: 5 },
      { id: 241, name: "Bogling skin", stackable: true, value: 12 },
      { id: 242, name: "Husk chitin", stackable: true, value: 60 },
      { id: 243, name: "Cairn bone", stackable: true, value: 120 },
      { id: 244, name: "Wraith dust", stackable: true, value: 200 },
      { id: 245, name: "Rimewolf fur", stackable: true, value: 500 },
      { id: 246, name: "Stalker claw", stackable: true, value: 700 },
      { id: 247, name: "Ember scale", stackable: true, value: 1200 },
      { id: 248, name: "Troll hide", stackable: true, value: 800 },
      { id: 249, name: "Horror ichor", stackable: true, value: 1000 },
      { id: 250, name: "Ice wight shard", stackable: true, value: 1500 },
      { id: 251, name: "Drake hide", stackable: true, value: 2000 },
      { id: 252, name: "Colossus chip", stackable: true, value: 3000 },
      { id: 260, name: "Pelt coif", stackable: false, value: 15 },
      { id: 261, name: "Pelt jerkin", stackable: false, value: 30 },
      { id: 262, name: "Pelt chaps", stackable: false, value: 20 },
      { id: 263, name: "Bogskin coif", stackable: false, value: 34 },
      { id: 264, name: "Bogskin jerkin", stackable: false, value: 70 },
      { id: 265, name: "Bogskin chaps", stackable: false, value: 46 },
      { id: 266, name: "Chitin coif", stackable: false, value: 154 },
      { id: 267, name: "Chitin jerkin", stackable: false, value: 334 },
      { id: 268, name: "Chitin chaps", stackable: false, value: 214 },
      { id: 269, name: "Fur coif", stackable: false, value: 1115 },
      { id: 270, name: "Fur jerkin", stackable: false, value: 2615 },
      { id: 271, name: "Fur chaps", stackable: false, value: 1615 },
      { id: 272, name: "Scale coif", stackable: false, value: 2807 },
      { id: 273, name: "Scale jerkin", stackable: false, value: 6407 },
      { id: 274, name: "Scale chaps", stackable: false, value: 4007 },
      { id: 300, name: "Homespun bolt", stackable: true, value: 12 },
      { id: 301, name: "Silk bolt", stackable: true, value: 70 },
      { id: 302, name: "Gilded bolt", stackable: true, value: 260 },
      { id: 303, name: "Voidweave bolt", stackable: true, value: 900 },
      { id: 304, name: "Homespun hood", stackable: false, value: 29 },
      { id: 305, name: "Homespun robe", stackable: false, value: 65 },
      { id: 306, name: "Homespun skirt", stackable: false, value: 41 },
      { id: 307, name: "Silk hood", stackable: false, value: 166 },
      { id: 308, name: "Silk robe", stackable: false, value: 376 },
      { id: 309, name: "Silk skirt", stackable: false, value: 236 },
      { id: 310, name: "Gilded hood", stackable: false, value: 597 },
      { id: 311, name: "Gilded robe", stackable: false, value: 1377 },
      { id: 312, name: "Gilded skirt", stackable: false, value: 857 },
      { id: 313, name: "Voidweave hood", stackable: false, value: 2020 },
      { id: 314, name: "Voidweave robe", stackable: false, value: 4720 },
      { id: 315, name: "Voidweave skirt", stackable: false, value: 2920 },
      { id: 316, name: "Rock mite nymph", stackable: false, value: 0 },
      { id: 317, name: "Fen lurker spawn", stackable: false, value: 0 },
      { id: 318, name: "Grave beetle grub", stackable: false, value: 0 },
      { id: 319, name: "Sump crawler hatchling", stackable: false, value: 0 },
      { id: 320, name: "Stone eater pebble", stackable: false, value: 0 },
      { id: 321, name: "Barrow pup", stackable: false, value: 0 },
      { id: 322, name: "Chalk wightling", stackable: false, value: 0 },
      { id: 323, name: "Pelt gloves", stackable: false, value: 75 },
      { id: 324, name: "Bogskin gloves", stackable: false, value: 4000 },
      { id: 325, name: "Chitin gloves", stackable: false, value: 12000 },
      { id: 326, name: "Bone gloves", stackable: false, value: 40000 },
      { id: 327, name: "Scale gloves", stackable: false, value: 350000 },
      { id: 328, name: "Horse", stackable: false, value: 10000 },
      { id: 329, name: "Pelt quiver", stackable: false, value: 18 },
      { id: 330, name: "Bogskin quiver", stackable: false, value: 49 },
      { id: 331, name: "Chitin quiver", stackable: false, value: 199 },
      { id: 332, name: "Fur quiver", stackable: false, value: 1215 },
      { id: 333, name: "Scale quiver", stackable: false, value: 3047 },
      { id: 334, name: "Linen grimoire", stackable: false, value: 41 },
      { id: 335, name: "Silk grimoire", stackable: false, value: 248 },
      { id: 336, name: "Gilded grimoire", stackable: false, value: 1057 },
      { id: 337, name: "Voidweave grimoire", stackable: false, value: 4320 },
      { id: 338, name: "Troll coif", stackable: false, value: 2183 },
      { id: 339, name: "Troll jerkin", stackable: false, value: 4583 },
      { id: 340, name: "Troll chaps", stackable: false, value: 2983 },
      { id: 341, name: "Drake coif", stackable: false, value: 4650 },
      { id: 342, name: "Drake jerkin", stackable: false, value: 10650 },
      { id: 343, name: "Drake chaps", stackable: false, value: 6650 },
      { id: 344, name: "Wightweave hood", stackable: false, value: 3800 },
      { id: 345, name: "Wightweave robe", stackable: false, value: 9500 },
      { id: 346, name: "Wightweave skirt", stackable: false, value: 6200 },
      { id: 347, name: "Troll quiver", stackable: false, value: 2783 },
      { id: 348, name: "Drake quiver", stackable: false, value: 5850 },
      { id: 349, name: "Wightweave grimoire", stackable: false, value: 6200 },
      { id: 350, name: "Colossus blade", stackable: false, value: 11231 },
      { id: 351, name: "Colossus shield", stackable: false, value: 11231 },
      { id: 352, name: "Colossus helm", stackable: false, value: 6704 },
      { id: 353, name: "Colossus plate", stackable: false, value: 17285 },
      { id: 354, name: "Colossus greaves", stackable: false, value: 12758 },
      { id: 355, name: "Leviathan scale", stackable: true, value: 20000 },
      { id: 356, name: "Wyrm ember", stackable: true, value: 20000 },
      { id: 357, name: "Leviathan amulet", stackable: false, value: 25593 },
      { id: 358, name: "Wyrm ring", stackable: false, value: 25593 },
      { id: 359, name: "Protection scroll", stackable: true, value: 10 },
      { id: 360, name: "Bronze pan", stackable: false, value: 17 },
      { id: 361, name: "Iron pan", stackable: false, value: 32 },
      { id: 362, name: "Steel pan", stackable: false, value: 190 },
      { id: 363, name: "Cobalt pan", stackable: false, value: 775 },
      { id: 364, name: "Meteoric pan", stackable: false, value: 1934 },
      { id: 365, name: "Bronze hammer", stackable: false, value: 29 },
      { id: 366, name: "Iron hammer", stackable: false, value: 54 },
      { id: 367, name: "Steel hammer", stackable: false, value: 346 },
      { id: 368, name: "Cobalt hammer", stackable: false, value: 1435 },
      { id: 369, name: "Meteoric hammer", stackable: false, value: 3461 },
      { id: 370, name: "Bronze knife", stackable: false, value: 17 },
      { id: 371, name: "Iron knife", stackable: false, value: 32 },
      { id: 372, name: "Steel knife", stackable: false, value: 190 },
      { id: 373, name: "Cobalt knife", stackable: false, value: 775 },
      { id: 374, name: "Meteoric knife", stackable: false, value: 1934 },
      { id: 375, name: "Bronze needle", stackable: false, value: 17 },
      { id: 376, name: "Iron needle", stackable: false, value: 32 },
      { id: 377, name: "Steel needle", stackable: false, value: 190 },
      { id: 378, name: "Cobalt needle", stackable: false, value: 775 },
      { id: 379, name: "Meteoric needle", stackable: false, value: 1934 },
      { id: 380, name: "Bronze mortar", stackable: false, value: 29 },
      { id: 381, name: "Iron mortar", stackable: false, value: 54 },
      { id: 382, name: "Steel mortar", stackable: false, value: 346 },
      { id: 383, name: "Cobalt mortar", stackable: false, value: 1435 },
      { id: 384, name: "Meteoric mortar", stackable: false, value: 3461 },
      { id: 385, name: "Bronze hoe", stackable: false, value: 23 },
      { id: 386, name: "Iron hoe", stackable: false, value: 62 },
      { id: 387, name: "Steel hoe", stackable: false, value: 280 },
      { id: 388, name: "Cobalt hoe", stackable: false, value: 1255 },
      { id: 389, name: "Meteoric hoe", stackable: false, value: 3134 },
      { id: 390, name: "Bronze greatsword", stackable: false, value: 29 },
      { id: 391, name: "Iron greatsword", stackable: false, value: 54 },
      { id: 392, name: "Steel greatsword", stackable: false, value: 346 },
      { id: 393, name: "Cobalt greatsword", stackable: false, value: 1435 },
      { id: 394, name: "Meteoric greatsword", stackable: false, value: 3461 },
      { id: 395, name: "Colossus greatsword", stackable: false, value: 12704 },
      { id: 396, name: "Golden Week gift box", stackable: true, value: 25 },
      { id: 400, name: "Pebble golem", stackable: false, value: 0 },
      { id: 401, name: "Baby kraken", stackable: false, value: 0 },
      { id: 402, name: "Acorn squirrel", stackable: false, value: 0 },
      { id: 403, name: "Queen bee", stackable: false, value: 0 },
      { id: 404, name: "Raccoon", stackable: false, value: 0 },
      { id: 405, name: "Chef rat", stackable: false, value: 0 },
      { id: 406, name: "Ember salamander", stackable: false, value: 0 },
      { id: 407, name: "Fletch falcon", stackable: false, value: 0 },
      { id: 408, name: "Toadstool", stackable: false, value: 0 },
      { id: 409, name: "Yarn kitten", stackable: false, value: 0 },
      { id: 410, name: "Star fairy", stackable: false, value: 0 },
      { id: 280, name: "Gnawer pup", stackable: false, value: 0 },
      { id: 281, name: "Bogling tadpole", stackable: false, value: 0 },
      { id: 282, name: "Husk grub", stackable: false, value: 0 },
      { id: 283, name: "Cairn wisp", stackable: false, value: 0 },
      { id: 284, name: "Rimewolf cub", stackable: false, value: 0 },
      { id: 285, name: "Emberkin spark", stackable: false, value: 0 },
      { id: 286, name: "Horror spawn", stackable: false, value: 0 },
      { id: 287, name: "Wraith mote", stackable: false, value: 0 },
      { id: 288, name: "Stalker kit", stackable: false, value: 0 },
      { id: 289, name: "Frost troll whelp", stackable: false, value: 0 },
      { id: 290, name: "Ice wight shard-child", stackable: false, value: 0 },
      { id: 291, name: "Ash drake hatchling", stackable: false, value: 0 },
      { id: 292, name: "Cinder ember", stackable: false, value: 0 },
      { id: 293, name: "Gem pack", stackable: true, value: 10 },
      { id: 294, name: "Pouch of gems", stackable: true, value: 1200 },
      { id: 295, name: "Chest of gems", stackable: true, value: 2600 },
      { id: 296, name: "Vein of gems", stackable: true, value: 7000 },
      { id: 297, name: "Hoard of gems", stackable: true, value: 15000 },
      { id: 1001, name: "Uncommon Copper", stackable: false, value: 15 },
      { id: 2001, name: "Rare Copper", stackable: false, value: 75 },
      { id: 3001, name: "Epic Copper", stackable: false, value: 450 },
      { id: 4001, name: "Legendary Copper", stackable: false, value: 3000 },
      { id: 1002, name: "Uncommon Tin", stackable: false, value: 20 },
      { id: 2002, name: "Rare Tin", stackable: false, value: 100 },
      { id: 3002, name: "Epic Tin", stackable: false, value: 600 },
      { id: 4002, name: "Legendary Tin", stackable: false, value: 4000 },
      { id: 1003, name: "Uncommon Iron", stackable: false, value: 60 },
      { id: 2003, name: "Rare Iron", stackable: false, value: 300 },
      { id: 3003, name: "Epic Iron", stackable: false, value: 1800 },
      { id: 4003, name: "Legendary Iron", stackable: false, value: 12000 },
      { id: 1004, name: "Uncommon Silver", stackable: false, value: 200 },
      { id: 2004, name: "Rare Silver", stackable: false, value: 1000 },
      { id: 3004, name: "Epic Silver", stackable: false, value: 6000 },
      { id: 4004, name: "Legendary Silver", stackable: false, value: 40000 },
      { id: 1005, name: "Uncommon Coal", stackable: false, value: 275 },
      { id: 2005, name: "Rare Coal", stackable: false, value: 1375 },
      { id: 3005, name: "Epic Coal", stackable: false, value: 8250 },
      { id: 4005, name: "Legendary Coal", stackable: false, value: 55000 },
      { id: 1006, name: "Uncommon Gold", stackable: false, value: 700 },
      { id: 2006, name: "Rare Gold", stackable: false, value: 3500 },
      { id: 3006, name: "Epic Gold", stackable: false, value: 21000 },
      { id: 4006, name: "Legendary Gold", stackable: false, value: 140000 },
      { id: 1007, name: "Uncommon Cobalt", stackable: false, value: 1900 },
      { id: 2007, name: "Rare Cobalt", stackable: false, value: 9500 },
      { id: 3007, name: "Epic Cobalt", stackable: false, value: 57000 },
      { id: 4007, name: "Legendary Cobalt", stackable: false, value: 380000 },
      { id: 1008, name: "Uncommon Meteoric", stackable: false, value: 4500 },
      { id: 2008, name: "Rare Meteoric", stackable: false, value: 22500 },
      { id: 3008, name: "Epic Meteoric", stackable: false, value: 135000 },
      { id: 4008, name: "Legendary Meteoric", stackable: false, value: 900000 },
      { id: 1010, name: "Uncommon Logs", stackable: false, value: 15 },
      { id: 2010, name: "Rare Logs", stackable: false, value: 75 },
      { id: 3010, name: "Epic Logs", stackable: false, value: 450 },
      { id: 4010, name: "Legendary Logs", stackable: false, value: 3000 },
      { id: 1011, name: "Uncommon Oak logs", stackable: false, value: 75 },
      { id: 2011, name: "Rare Oak logs", stackable: false, value: 375 },
      { id: 3011, name: "Epic Oak logs", stackable: false, value: 2250 },
      { id: 4011, name: "Legendary Oak logs", stackable: false, value: 15000 },
      { id: 1012, name: "Uncommon Willow logs", stackable: false, value: 225 },
      { id: 2012, name: "Rare Willow logs", stackable: false, value: 1125 },
      { id: 3012, name: "Epic Willow logs", stackable: false, value: 6750 },
      { id: 4012, name: "Legendary Willow logs", stackable: false, value: 45000 },
      { id: 1013, name: "Uncommon Maple logs", stackable: false, value: 500 },
      { id: 2013, name: "Rare Maple logs", stackable: false, value: 2500 },
      { id: 3013, name: "Epic Maple logs", stackable: false, value: 15000 },
      { id: 4013, name: "Legendary Maple logs", stackable: false, value: 100000 },
      { id: 1014, name: "Uncommon Yew logs", stackable: false, value: 1200 },
      { id: 2014, name: "Rare Yew logs", stackable: false, value: 6000 },
      { id: 3014, name: "Epic Yew logs", stackable: false, value: 36000 },
      { id: 4014, name: "Legendary Yew logs", stackable: false, value: 240000 },
      { id: 1015, name: "Uncommon Magic logs", stackable: false, value: 3000 },
      { id: 2015, name: "Rare Magic logs", stackable: false, value: 15000 },
      { id: 3015, name: "Epic Magic logs", stackable: false, value: 90000 },
      { id: 4015, name: "Legendary Magic logs", stackable: false, value: 600000 },
      { id: 1020, name: "Uncommon Shrimp", stackable: false, value: 20 },
      { id: 2020, name: "Rare Shrimp", stackable: false, value: 100 },
      { id: 3020, name: "Epic Shrimp", stackable: false, value: 600 },
      { id: 4020, name: "Legendary Shrimp", stackable: false, value: 4000 },
      { id: 1021, name: "Uncommon Sardine", stackable: false, value: 45 },
      { id: 2021, name: "Rare Sardine", stackable: false, value: 225 },
      { id: 3021, name: "Epic Sardine", stackable: false, value: 1350 },
      { id: 4021, name: "Legendary Sardine", stackable: false, value: 9000 },
      { id: 1022, name: "Uncommon Trout", stackable: false, value: 130 },
      { id: 2022, name: "Rare Trout", stackable: false, value: 650 },
      { id: 3022, name: "Epic Trout", stackable: false, value: 3900 },
      { id: 4022, name: "Legendary Trout", stackable: false, value: 26000 },
      { id: 1023, name: "Uncommon Salmon", stackable: false, value: 240 },
      { id: 2023, name: "Rare Salmon", stackable: false, value: 1200 },
      { id: 3023, name: "Epic Salmon", stackable: false, value: 7200 },
      { id: 4023, name: "Legendary Salmon", stackable: false, value: 48000 },
      { id: 1024, name: "Uncommon Tuna", stackable: false, value: 460 },
      { id: 2024, name: "Rare Tuna", stackable: false, value: 2300 },
      { id: 3024, name: "Epic Tuna", stackable: false, value: 13800 },
      { id: 4024, name: "Legendary Tuna", stackable: false, value: 92000 },
      { id: 1025, name: "Uncommon Lobster", stackable: false, value: 875 },
      { id: 2025, name: "Rare Lobster", stackable: false, value: 4375 },
      { id: 3025, name: "Epic Lobster", stackable: false, value: 26250 },
      { id: 4025, name: "Legendary Lobster", stackable: false, value: 175000 },
      { id: 1026, name: "Uncommon Swordfish", stackable: false, value: 1650 },
      { id: 2026, name: "Rare Swordfish", stackable: false, value: 8250 },
      { id: 3026, name: "Epic Swordfish", stackable: false, value: 49500 },
      { id: 4026, name: "Legendary Swordfish", stackable: false, value: 330000 },
      { id: 1027, name: "Uncommon Shark", stackable: false, value: 3900 },
      { id: 2027, name: "Rare Shark", stackable: false, value: 19500 },
      { id: 3027, name: "Epic Shark", stackable: false, value: 117000 },
      { id: 4027, name: "Legendary Shark", stackable: false, value: 780000 },
      { id: 1040, name: "Uncommon Bronze bar", stackable: false, value: 60 },
      { id: 2040, name: "Rare Bronze bar", stackable: false, value: 300 },
      { id: 3040, name: "Epic Bronze bar", stackable: false, value: 1800 },
      { id: 4040, name: "Legendary Bronze bar", stackable: false, value: 12000 },
      { id: 1041, name: "Uncommon Iron bar", stackable: false, value: 110 },
      { id: 2041, name: "Rare Iron bar", stackable: false, value: 550 },
      { id: 3041, name: "Epic Iron bar", stackable: false, value: 3300 },
      { id: 4041, name: "Legendary Iron bar", stackable: false, value: 22000 },
      { id: 1042, name: "Uncommon Steel bar", stackable: false, value: 780 },
      { id: 2042, name: "Rare Steel bar", stackable: false, value: 3900 },
      { id: 3042, name: "Epic Steel bar", stackable: false, value: 23400 },
      { id: 4042, name: "Legendary Steel bar", stackable: false, value: 156000 },
      { id: 1043, name: "Uncommon Cobalt bar", stackable: false, value: 3300 },
      { id: 2043, name: "Rare Cobalt bar", stackable: false, value: 16500 },
      { id: 3043, name: "Epic Cobalt bar", stackable: false, value: 99000 },
      { id: 4043, name: "Legendary Cobalt bar", stackable: false, value: 660000 },
      { id: 1044, name: "Uncommon Meteoric bar", stackable: false, value: 7635 },
      { id: 2044, name: "Rare Meteoric bar", stackable: false, value: 38175 },
      { id: 3044, name: "Epic Meteoric bar", stackable: false, value: 229050 },
      { id: 4044, name: "Legendary Meteoric bar", stackable: false, value: 1527000 },
      { id: 1060, name: "Uncommon Cooked shrimp", stackable: false, value: 45, heals: 4 },
      { id: 2060, name: "Rare Cooked shrimp", stackable: false, value: 225, heals: 5 },
      { id: 3060, name: "Epic Cooked shrimp", stackable: false, value: 1350, heals: 6 },
      { id: 4060, name: "Legendary Cooked shrimp", stackable: false, value: 9000, heals: 9 },
      { id: 1061, name: "Uncommon Cooked sardine", stackable: false, value: 75, heals: 5 },
      { id: 2061, name: "Rare Cooked sardine", stackable: false, value: 375, heals: 6 },
      { id: 3061, name: "Epic Cooked sardine", stackable: false, value: 2250, heals: 8 },
      { id: 4061, name: "Legendary Cooked sardine", stackable: false, value: 15000, heals: 12 },
      { id: 1062, name: "Uncommon Cooked trout", stackable: false, value: 220, heals: 8 },
      { id: 2062, name: "Rare Cooked trout", stackable: false, value: 1100, heals: 11 },
      { id: 3062, name: "Epic Cooked trout", stackable: false, value: 6600, heals: 14 },
      { id: 4062, name: "Legendary Cooked trout", stackable: false, value: 44000, heals: 21 },
      { id: 1063, name: "Uncommon Cooked salmon", stackable: false, value: 410, heals: 11 },
      { id: 2063, name: "Rare Cooked salmon", stackable: false, value: 2050, heals: 14 },
      { id: 3063, name: "Epic Cooked salmon", stackable: false, value: 12300, heals: 18 },
      { id: 4063, name: "Legendary Cooked salmon", stackable: false, value: 82000, heals: 27 },
      { id: 1064, name: "Uncommon Cooked tuna", stackable: false, value: 750, heals: 14 },
      { id: 2064, name: "Rare Cooked tuna", stackable: false, value: 3750, heals: 18 },
      { id: 3064, name: "Epic Cooked tuna", stackable: false, value: 22500, heals: 24 },
      { id: 4064, name: "Legendary Cooked tuna", stackable: false, value: 150000, heals: 36 },
      { id: 1065, name: "Uncommon Cooked lobster", stackable: false, value: 1450, heals: 19 },
      { id: 2065, name: "Rare Cooked lobster", stackable: false, value: 7250, heals: 24 },
      { id: 3065, name: "Epic Cooked lobster", stackable: false, value: 43500, heals: 32 },
      { id: 4065, name: "Legendary Cooked lobster", stackable: false, value: 290000, heals: 48 },
      { id: 1066, name: "Uncommon Cooked swordfish", stackable: false, value: 2750, heals: 24 },
      { id: 2066, name: "Rare Cooked swordfish", stackable: false, value: 13750, heals: 30 },
      { id: 3066, name: "Epic Cooked swordfish", stackable: false, value: 82500, heals: 40 },
      { id: 4066, name: "Legendary Cooked swordfish", stackable: false, value: 550000, heals: 60 },
      { id: 1067, name: "Uncommon Cooked shark", stackable: false, value: 6400, heals: 31 },
      { id: 2067, name: "Rare Cooked shark", stackable: false, value: 32000, heals: 39 },
      { id: 3067, name: "Epic Cooked shark", stackable: false, value: 192000, heals: 52 },
      { id: 4067, name: "Legendary Cooked shark", stackable: false, value: 1280000, heals: 78 },
      { id: 1080, name: "Uncommon Bronze pickaxe", stackable: false, value: 145 },
      { id: 2080, name: "Rare Bronze pickaxe", stackable: false, value: 725 },
      { id: 3080, name: "Epic Bronze pickaxe", stackable: false, value: 4350 },
      { id: 4080, name: "Legendary Bronze pickaxe", stackable: false, value: 29000 },
      { id: 1081, name: "Uncommon Iron pickaxe", stackable: false, value: 270 },
      { id: 2081, name: "Rare Iron pickaxe", stackable: false, value: 1350 },
      { id: 3081, name: "Epic Iron pickaxe", stackable: false, value: 8100 },
      { id: 4081, name: "Legendary Iron pickaxe", stackable: false, value: 54000 },
      { id: 1082, name: "Uncommon Steel pickaxe", stackable: false, value: 1730 },
      { id: 2082, name: "Rare Steel pickaxe", stackable: false, value: 8650 },
      { id: 3082, name: "Epic Steel pickaxe", stackable: false, value: 51900 },
      { id: 4082, name: "Legendary Steel pickaxe", stackable: false, value: 346000 },
      { id: 1083, name: "Uncommon Cobalt pickaxe", stackable: false, value: 7175 },
      { id: 2083, name: "Rare Cobalt pickaxe", stackable: false, value: 35875 },
      { id: 3083, name: "Epic Cobalt pickaxe", stackable: false, value: 215250 },
      { id: 4083, name: "Legendary Cobalt pickaxe", stackable: false, value: 1435000 },
      { id: 1084, name: "Uncommon Meteoric pickaxe", stackable: false, value: 17305 },
      { id: 2084, name: "Rare Meteoric pickaxe", stackable: false, value: 86525 },
      { id: 3084, name: "Epic Meteoric pickaxe", stackable: false, value: 519150 },
      { id: 4084, name: "Legendary Meteoric pickaxe", stackable: false, value: 3461000 },
      { id: 1085, name: "Uncommon Bronze rod", stackable: false, value: 100 },
      { id: 2085, name: "Rare Bronze rod", stackable: false, value: 500 },
      { id: 3085, name: "Epic Bronze rod", stackable: false, value: 3000 },
      { id: 4085, name: "Legendary Bronze rod", stackable: false, value: 20000 },
      { id: 1086, name: "Uncommon Iron rod", stackable: false, value: 235 },
      { id: 2086, name: "Rare Iron rod", stackable: false, value: 1175 },
      { id: 3086, name: "Epic Iron rod", stackable: false, value: 7050 },
      { id: 4086, name: "Legendary Iron rod", stackable: false, value: 47000 },
      { id: 1087, name: "Uncommon Steel rod", stackable: false, value: 1175 },
      { id: 2087, name: "Rare Steel rod", stackable: false, value: 5875 },
      { id: 3087, name: "Epic Steel rod", stackable: false, value: 35250 },
      { id: 4087, name: "Legendary Steel rod", stackable: false, value: 235000 },
      { id: 1088, name: "Uncommon Cobalt rod", stackable: false, value: 5075 },
      { id: 2088, name: "Rare Cobalt rod", stackable: false, value: 25375 },
      { id: 3088, name: "Epic Cobalt rod", stackable: false, value: 152250 },
      { id: 4088, name: "Legendary Cobalt rod", stackable: false, value: 1015000 },
      { id: 1089, name: "Uncommon Meteoric rod", stackable: false, value: 12670 },
      { id: 2089, name: "Rare Meteoric rod", stackable: false, value: 63350 },
      { id: 3089, name: "Epic Meteoric rod", stackable: false, value: 380100 },
      { id: 4089, name: "Legendary Meteoric rod", stackable: false, value: 2534000 },
      { id: 1090, name: "Uncommon Bronze axe", stackable: false, value: 145 },
      { id: 2090, name: "Rare Bronze axe", stackable: false, value: 725 },
      { id: 3090, name: "Epic Bronze axe", stackable: false, value: 4350 },
      { id: 4090, name: "Legendary Bronze axe", stackable: false, value: 29000 },
      { id: 1091, name: "Uncommon Iron axe", stackable: false, value: 270 },
      { id: 2091, name: "Rare Iron axe", stackable: false, value: 1350 },
      { id: 3091, name: "Epic Iron axe", stackable: false, value: 8100 },
      { id: 4091, name: "Legendary Iron axe", stackable: false, value: 54000 },
      { id: 1092, name: "Uncommon Steel axe", stackable: false, value: 1730 },
      { id: 2092, name: "Rare Steel axe", stackable: false, value: 8650 },
      { id: 3092, name: "Epic Steel axe", stackable: false, value: 51900 },
      { id: 4092, name: "Legendary Steel axe", stackable: false, value: 346000 },
      { id: 1093, name: "Uncommon Cobalt axe", stackable: false, value: 7175 },
      { id: 2093, name: "Rare Cobalt axe", stackable: false, value: 35875 },
      { id: 3093, name: "Epic Cobalt axe", stackable: false, value: 215250 },
      { id: 4093, name: "Legendary Cobalt axe", stackable: false, value: 1435000 },
      { id: 1094, name: "Uncommon Meteoric axe", stackable: false, value: 17305 },
      { id: 2094, name: "Rare Meteoric axe", stackable: false, value: 86525 },
      { id: 3094, name: "Epic Meteoric axe", stackable: false, value: 519150 },
      { id: 4094, name: "Legendary Meteoric axe", stackable: false, value: 3461000 },
      { id: 1110, name: "Uncommon Bronze blade", stackable: false, value: 85 },
      { id: 2110, name: "Rare Bronze blade", stackable: false, value: 425 },
      { id: 3110, name: "Epic Bronze blade", stackable: false, value: 2550 },
      { id: 4110, name: "Legendary Bronze blade", stackable: false, value: 17000 },
      { id: 1111, name: "Uncommon Iron blade", stackable: false, value: 160 },
      { id: 2111, name: "Rare Iron blade", stackable: false, value: 800 },
      { id: 3111, name: "Epic Iron blade", stackable: false, value: 4800 },
      { id: 4111, name: "Legendary Iron blade", stackable: false, value: 32000 },
      { id: 1112, name: "Uncommon Steel blade", stackable: false, value: 950 },
      { id: 2112, name: "Rare Steel blade", stackable: false, value: 4750 },
      { id: 3112, name: "Epic Steel blade", stackable: false, value: 28500 },
      { id: 4112, name: "Legendary Steel blade", stackable: false, value: 190000 },
      { id: 1113, name: "Uncommon Cobalt blade", stackable: false, value: 3875 },
      { id: 2113, name: "Rare Cobalt blade", stackable: false, value: 19375 },
      { id: 3113, name: "Epic Cobalt blade", stackable: false, value: 116250 },
      { id: 4113, name: "Legendary Cobalt blade", stackable: false, value: 775000 },
      { id: 1114, name: "Uncommon Meteoric blade", stackable: false, value: 9670 },
      { id: 2114, name: "Rare Meteoric blade", stackable: false, value: 48350 },
      { id: 3114, name: "Epic Meteoric blade", stackable: false, value: 290100 },
      { id: 4114, name: "Legendary Meteoric blade", stackable: false, value: 1934000 },
      { id: 1115, name: "Uncommon Bronze shield", stackable: false, value: 205 },
      { id: 2115, name: "Rare Bronze shield", stackable: false, value: 1025 },
      { id: 3115, name: "Epic Bronze shield", stackable: false, value: 6150 },
      { id: 4115, name: "Legendary Bronze shield", stackable: false, value: 41000 },
      { id: 1116, name: "Uncommon Iron shield", stackable: false, value: 380 },
      { id: 2116, name: "Rare Iron shield", stackable: false, value: 1900 },
      { id: 3116, name: "Epic Iron shield", stackable: false, value: 11400 },
      { id: 4116, name: "Legendary Iron shield", stackable: false, value: 76000 },
      { id: 1117, name: "Uncommon Steel shield", stackable: false, value: 2510 },
      { id: 2117, name: "Rare Steel shield", stackable: false, value: 12550 },
      { id: 3117, name: "Epic Steel shield", stackable: false, value: 75300 },
      { id: 4117, name: "Legendary Steel shield", stackable: false, value: 502000 },
      { id: 1118, name: "Uncommon Cobalt shield", stackable: false, value: 10475 },
      { id: 2118, name: "Rare Cobalt shield", stackable: false, value: 52375 },
      { id: 3118, name: "Epic Cobalt shield", stackable: false, value: 314250 },
      { id: 4118, name: "Legendary Cobalt shield", stackable: false, value: 2095000 },
      { id: 1119, name: "Uncommon Meteoric shield", stackable: false, value: 24940 },
      { id: 2119, name: "Rare Meteoric shield", stackable: false, value: 124700 },
      { id: 3119, name: "Epic Meteoric shield", stackable: false, value: 748200 },
      { id: 4119, name: "Legendary Meteoric shield", stackable: false, value: 4988000 },
      { id: 1120, name: "Uncommon Bronze helm", stackable: false, value: 145 },
      { id: 2120, name: "Rare Bronze helm", stackable: false, value: 725 },
      { id: 3120, name: "Epic Bronze helm", stackable: false, value: 4350 },
      { id: 4120, name: "Legendary Bronze helm", stackable: false, value: 29000 },
      { id: 1121, name: "Uncommon Iron helm", stackable: false, value: 270 },
      { id: 2121, name: "Rare Iron helm", stackable: false, value: 1350 },
      { id: 3121, name: "Epic Iron helm", stackable: false, value: 8100 },
      { id: 4121, name: "Legendary Iron helm", stackable: false, value: 54000 },
      { id: 1122, name: "Uncommon Steel helm", stackable: false, value: 1730 },
      { id: 2122, name: "Rare Steel helm", stackable: false, value: 8650 },
      { id: 3122, name: "Epic Steel helm", stackable: false, value: 51900 },
      { id: 4122, name: "Legendary Steel helm", stackable: false, value: 346000 },
      { id: 1123, name: "Uncommon Cobalt helm", stackable: false, value: 7175 },
      { id: 2123, name: "Rare Cobalt helm", stackable: false, value: 35875 },
      { id: 3123, name: "Epic Cobalt helm", stackable: false, value: 215250 },
      { id: 4123, name: "Legendary Cobalt helm", stackable: false, value: 1435000 },
      { id: 1124, name: "Uncommon Meteoric helm", stackable: false, value: 17305 },
      { id: 2124, name: "Rare Meteoric helm", stackable: false, value: 86525 },
      { id: 3124, name: "Epic Meteoric helm", stackable: false, value: 519150 },
      { id: 4124, name: "Legendary Meteoric helm", stackable: false, value: 3461000 },
      { id: 1125, name: "Uncommon Bronze plate", stackable: false, value: 325 },
      { id: 2125, name: "Rare Bronze plate", stackable: false, value: 1625 },
      { id: 3125, name: "Epic Bronze plate", stackable: false, value: 9750 },
      { id: 4125, name: "Legendary Bronze plate", stackable: false, value: 65000 },
      { id: 1126, name: "Uncommon Iron plate", stackable: false, value: 600 },
      { id: 2126, name: "Rare Iron plate", stackable: false, value: 3000 },
      { id: 3126, name: "Epic Iron plate", stackable: false, value: 18000 },
      { id: 4126, name: "Legendary Iron plate", stackable: false, value: 120000 },
      { id: 1127, name: "Uncommon Steel plate", stackable: false, value: 4070 },
      { id: 2127, name: "Rare Steel plate", stackable: false, value: 20350 },
      { id: 3127, name: "Epic Steel plate", stackable: false, value: 122100 },
      { id: 4127, name: "Legendary Steel plate", stackable: false, value: 814000 },
      { id: 1128, name: "Uncommon Cobalt plate", stackable: false, value: 17075 },
      { id: 2128, name: "Rare Cobalt plate", stackable: false, value: 85375 },
      { id: 3128, name: "Epic Cobalt plate", stackable: false, value: 512250 },
      { id: 4128, name: "Legendary Cobalt plate", stackable: false, value: 3415000 },
      { id: 1129, name: "Uncommon Meteoric plate", stackable: false, value: 40210 },
      { id: 2129, name: "Rare Meteoric plate", stackable: false, value: 201050 },
      { id: 3129, name: "Epic Meteoric plate", stackable: false, value: 1206300 },
      { id: 4129, name: "Legendary Meteoric plate", stackable: false, value: 8042000 },
      { id: 1130, name: "Uncommon Bronze greaves", stackable: false, value: 265 },
      { id: 2130, name: "Rare Bronze greaves", stackable: false, value: 1325 },
      { id: 3130, name: "Epic Bronze greaves", stackable: false, value: 7950 },
      { id: 4130, name: "Legendary Bronze greaves", stackable: false, value: 53000 },
      { id: 1131, name: "Uncommon Iron greaves", stackable: false, value: 490 },
      { id: 2131, name: "Rare Iron greaves", stackable: false, value: 2450 },
      { id: 3131, name: "Epic Iron greaves", stackable: false, value: 14700 },
      { id: 4131, name: "Legendary Iron greaves", stackable: false, value: 98000 },
      { id: 1132, name: "Uncommon Steel greaves", stackable: false, value: 3290 },
      { id: 2132, name: "Rare Steel greaves", stackable: false, value: 16450 },
      { id: 3132, name: "Epic Steel greaves", stackable: false, value: 98700 },
      { id: 4132, name: "Legendary Steel greaves", stackable: false, value: 658000 },
      { id: 1133, name: "Uncommon Cobalt greaves", stackable: false, value: 13775 },
      { id: 2133, name: "Rare Cobalt greaves", stackable: false, value: 68875 },
      { id: 3133, name: "Epic Cobalt greaves", stackable: false, value: 413250 },
      { id: 4133, name: "Legendary Cobalt greaves", stackable: false, value: 2755000 },
      { id: 1134, name: "Uncommon Meteoric greaves", stackable: false, value: 32575 },
      { id: 2134, name: "Rare Meteoric greaves", stackable: false, value: 162875 },
      { id: 3134, name: "Epic Meteoric greaves", stackable: false, value: 977250 },
      { id: 4134, name: "Legendary Meteoric greaves", stackable: false, value: 6515000 },
      { id: 1140, name: "Uncommon Shortbow", stackable: false, value: 40 },
      { id: 2140, name: "Rare Shortbow", stackable: false, value: 200 },
      { id: 3140, name: "Epic Shortbow", stackable: false, value: 1200 },
      { id: 4140, name: "Legendary Shortbow", stackable: false, value: 8000 },
      { id: 1141, name: "Uncommon Oak shortbow", stackable: false, value: 125 },
      { id: 2141, name: "Rare Oak shortbow", stackable: false, value: 625 },
      { id: 3141, name: "Epic Oak shortbow", stackable: false, value: 3750 },
      { id: 4141, name: "Legendary Oak shortbow", stackable: false, value: 25000 },
      { id: 1142, name: "Uncommon Willow shortbow", stackable: false, value: 395 },
      { id: 2142, name: "Rare Willow shortbow", stackable: false, value: 1975 },
      { id: 3142, name: "Epic Willow shortbow", stackable: false, value: 11850 },
      { id: 4142, name: "Legendary Willow shortbow", stackable: false, value: 79000 },
      { id: 1143, name: "Uncommon Maple shortbow", stackable: false, value: 790 },
      { id: 2143, name: "Rare Maple shortbow", stackable: false, value: 3950 },
      { id: 3143, name: "Epic Maple shortbow", stackable: false, value: 23700 },
      { id: 4143, name: "Legendary Maple shortbow", stackable: false, value: 158000 },
      { id: 1144, name: "Uncommon Yew shortbow", stackable: false, value: 1775 },
      { id: 2144, name: "Rare Yew shortbow", stackable: false, value: 8875 },
      { id: 3144, name: "Epic Yew shortbow", stackable: false, value: 53250 },
      { id: 4144, name: "Legendary Yew shortbow", stackable: false, value: 355000 },
      { id: 1145, name: "Uncommon Magic shortbow", stackable: false, value: 4100 },
      { id: 2145, name: "Rare Magic shortbow", stackable: false, value: 20500 },
      { id: 3145, name: "Epic Magic shortbow", stackable: false, value: 123000 },
      { id: 4145, name: "Legendary Magic shortbow", stackable: false, value: 820000 },
      { id: 1146, name: "Uncommon Longbow", stackable: false, value: 55 },
      { id: 2146, name: "Rare Longbow", stackable: false, value: 275 },
      { id: 3146, name: "Epic Longbow", stackable: false, value: 1650 },
      { id: 4146, name: "Legendary Longbow", stackable: false, value: 11000 },
      { id: 1147, name: "Uncommon Oak longbow", stackable: false, value: 200 },
      { id: 2147, name: "Rare Oak longbow", stackable: false, value: 1000 },
      { id: 3147, name: "Epic Oak longbow", stackable: false, value: 6000 },
      { id: 4147, name: "Legendary Oak longbow", stackable: false, value: 40000 },
      { id: 1148, name: "Uncommon Willow longbow", stackable: false, value: 620 },
      { id: 2148, name: "Rare Willow longbow", stackable: false, value: 3100 },
      { id: 3148, name: "Epic Willow longbow", stackable: false, value: 18600 },
      { id: 4148, name: "Legendary Willow longbow", stackable: false, value: 124000 },
      { id: 1149, name: "Uncommon Maple longbow", stackable: false, value: 1290 },
      { id: 2149, name: "Rare Maple longbow", stackable: false, value: 6450 },
      { id: 3149, name: "Epic Maple longbow", stackable: false, value: 38700 },
      { id: 4149, name: "Legendary Maple longbow", stackable: false, value: 258000 },
      { id: 1150, name: "Uncommon Yew longbow", stackable: false, value: 2975 },
      { id: 2150, name: "Rare Yew longbow", stackable: false, value: 14875 },
      { id: 3150, name: "Epic Yew longbow", stackable: false, value: 89250 },
      { id: 4150, name: "Legendary Yew longbow", stackable: false, value: 595000 },
      { id: 1151, name: "Uncommon Magic longbow", stackable: false, value: 7100 },
      { id: 2151, name: "Rare Magic longbow", stackable: false, value: 35500 },
      { id: 3151, name: "Epic Magic longbow", stackable: false, value: 213000 },
      { id: 4151, name: "Legendary Magic longbow", stackable: false, value: 1420000 },
      { id: 1152, name: "Uncommon Staff", stackable: false, value: 55 },
      { id: 2152, name: "Rare Staff", stackable: false, value: 275 },
      { id: 3152, name: "Epic Staff", stackable: false, value: 1650 },
      { id: 4152, name: "Legendary Staff", stackable: false, value: 11000 },
      { id: 1153, name: "Uncommon Oak staff", stackable: false, value: 200 },
      { id: 2153, name: "Rare Oak staff", stackable: false, value: 1000 },
      { id: 3153, name: "Epic Oak staff", stackable: false, value: 6000 },
      { id: 4153, name: "Legendary Oak staff", stackable: false, value: 40000 },
      { id: 1154, name: "Uncommon Willow staff", stackable: false, value: 620 },
      { id: 2154, name: "Rare Willow staff", stackable: false, value: 3100 },
      { id: 3154, name: "Epic Willow staff", stackable: false, value: 18600 },
      { id: 4154, name: "Legendary Willow staff", stackable: false, value: 124000 },
      { id: 1155, name: "Uncommon Maple staff", stackable: false, value: 1290 },
      { id: 2155, name: "Rare Maple staff", stackable: false, value: 6450 },
      { id: 3155, name: "Epic Maple staff", stackable: false, value: 38700 },
      { id: 4155, name: "Legendary Maple staff", stackable: false, value: 258000 },
      { id: 1156, name: "Uncommon Yew staff", stackable: false, value: 2975 },
      { id: 2156, name: "Rare Yew staff", stackable: false, value: 14875 },
      { id: 3156, name: "Epic Yew staff", stackable: false, value: 89250 },
      { id: 4156, name: "Legendary Yew staff", stackable: false, value: 595000 },
      { id: 1157, name: "Uncommon Magic staff", stackable: false, value: 7100 },
      { id: 2157, name: "Rare Magic staff", stackable: false, value: 35500 },
      { id: 3157, name: "Epic Magic staff", stackable: false, value: 213000 },
      { id: 4157, name: "Legendary Magic staff", stackable: false, value: 1420000 },
      { id: 1100, name: "Uncommon Rough gem", stackable: true, value: 12500 },
      { id: 2100, name: "Rare Rough gem", stackable: true, value: 62500 },
      { id: 3100, name: "Epic Rough gem", stackable: true, value: 375000 },
      { id: 4100, name: "Legendary Rough gem", stackable: true, value: 2500000 },
      { id: 1160, name: "Uncommon Potato seed", stackable: true, value: 10 },
      { id: 2160, name: "Rare Potato seed", stackable: true, value: 50 },
      { id: 3160, name: "Epic Potato seed", stackable: true, value: 300 },
      { id: 4160, name: "Legendary Potato seed", stackable: true, value: 2000 },
      { id: 1161, name: "Uncommon Glowcap spore", stackable: true, value: 30 },
      { id: 2161, name: "Rare Glowcap spore", stackable: true, value: 150 },
      { id: 3161, name: "Epic Glowcap spore", stackable: true, value: 900 },
      { id: 4161, name: "Legendary Glowcap spore", stackable: true, value: 6000 },
      { id: 1162, name: "Uncommon Turnip seed", stackable: true, value: 70 },
      { id: 2162, name: "Rare Turnip seed", stackable: true, value: 350 },
      { id: 3162, name: "Epic Turnip seed", stackable: true, value: 2100 },
      { id: 4162, name: "Legendary Turnip seed", stackable: true, value: 14000 },
      { id: 1163, name: "Uncommon Bitterroot seed", stackable: true, value: 150 },
      { id: 2163, name: "Rare Bitterroot seed", stackable: true, value: 750 },
      { id: 3163, name: "Epic Bitterroot seed", stackable: true, value: 4500 },
      { id: 4163, name: "Legendary Bitterroot seed", stackable: true, value: 30000 },
      { id: 1164, name: "Uncommon Voidmelon seed", stackable: true, value: 300 },
      { id: 2164, name: "Rare Voidmelon seed", stackable: true, value: 1500 },
      { id: 3164, name: "Epic Voidmelon seed", stackable: true, value: 9000 },
      { id: 4164, name: "Legendary Voidmelon seed", stackable: true, value: 60000 },
      { id: 1165, name: "Uncommon Pepper seed", stackable: true, value: 550 },
      { id: 2165, name: "Rare Pepper seed", stackable: true, value: 2750 },
      { id: 3165, name: "Epic Pepper seed", stackable: true, value: 16500 },
      { id: 4165, name: "Legendary Pepper seed", stackable: true, value: 110000 },
      { id: 1170, name: "Uncommon Potato", stackable: false, value: 35, heals: 4 },
      { id: 2170, name: "Rare Potato", stackable: false, value: 175, heals: 5 },
      { id: 3170, name: "Epic Potato", stackable: false, value: 1050, heals: 6 },
      { id: 4170, name: "Legendary Potato", stackable: false, value: 7000, heals: 9 },
      { id: 1171, name: "Uncommon Glowcap", stackable: false, value: 110, heals: 6 },
      { id: 2171, name: "Rare Glowcap", stackable: false, value: 550, heals: 8 },
      { id: 3171, name: "Epic Glowcap", stackable: false, value: 3300, heals: 10 },
      { id: 4171, name: "Legendary Glowcap", stackable: false, value: 22000, heals: 15 },
      { id: 1172, name: "Uncommon Cave turnip", stackable: false, value: 275, heals: 8 },
      { id: 2172, name: "Rare Cave turnip", stackable: false, value: 1375, heals: 11 },
      { id: 3172, name: "Epic Cave turnip", stackable: false, value: 8250, heals: 14 },
      { id: 4172, name: "Legendary Cave turnip", stackable: false, value: 55000, heals: 21 },
      { id: 1173, name: "Uncommon Bitterroot", stackable: false, value: 600, heals: 12 },
      { id: 2173, name: "Rare Bitterroot", stackable: false, value: 3000, heals: 15 },
      { id: 3173, name: "Epic Bitterroot", stackable: false, value: 18000, heals: 20 },
      { id: 4173, name: "Legendary Bitterroot", stackable: false, value: 120000, heals: 30 },
      { id: 1174, name: "Uncommon Voidmelon", stackable: false, value: 1300, heals: 17 },
      { id: 2174, name: "Rare Voidmelon", stackable: false, value: 6500, heals: 21 },
      { id: 3174, name: "Epic Voidmelon", stackable: false, value: 39000, heals: 28 },
      { id: 4174, name: "Legendary Voidmelon", stackable: false, value: 260000, heals: 42 },
      { id: 1175, name: "Uncommon Ember pepper", stackable: false, value: 2600, heals: 24 },
      { id: 2175, name: "Rare Ember pepper", stackable: false, value: 13000, heals: 30 },
      { id: 3175, name: "Epic Ember pepper", stackable: false, value: 78000, heals: 40 },
      { id: 4175, name: "Legendary Ember pepper", stackable: false, value: 520000, heals: 60 },
      { id: 1180, name: "Uncommon Cut gem", stackable: true, value: 12525 },
      { id: 2180, name: "Rare Cut gem", stackable: true, value: 62625 },
      { id: 3180, name: "Epic Cut gem", stackable: true, value: 375750 },
      { id: 4180, name: "Legendary Cut gem", stackable: true, value: 2505000 },
      { id: 1181, name: "Uncommon Silver ring", stackable: false, value: 12815 },
      { id: 2181, name: "Rare Silver ring", stackable: false, value: 64075 },
      { id: 3181, name: "Epic Silver ring", stackable: false, value: 384450 },
      { id: 4181, name: "Legendary Silver ring", stackable: false, value: 2563000 },
      { id: 1182, name: "Uncommon Gold ring", stackable: false, value: 13515 },
      { id: 2182, name: "Rare Gold ring", stackable: false, value: 67575 },
      { id: 3182, name: "Epic Gold ring", stackable: false, value: 405450 },
      { id: 4182, name: "Legendary Gold ring", stackable: false, value: 2703000 },
      { id: 1183, name: "Uncommon Meteoric ring", stackable: false, value: 33785 },
      { id: 2183, name: "Rare Meteoric ring", stackable: false, value: 168925 },
      { id: 3183, name: "Epic Meteoric ring", stackable: false, value: 1013550 },
      { id: 4183, name: "Legendary Meteoric ring", stackable: false, value: 6757000 },
      { id: 1184, name: "Uncommon Silver amulet", stackable: false, value: 12895 },
      { id: 2184, name: "Rare Silver amulet", stackable: false, value: 64475 },
      { id: 3184, name: "Epic Silver amulet", stackable: false, value: 386850 },
      { id: 4184, name: "Legendary Silver amulet", stackable: false, value: 2579000 },
      { id: 1185, name: "Uncommon Gold amulet", stackable: false, value: 13705 },
      { id: 2185, name: "Rare Gold amulet", stackable: false, value: 68525 },
      { id: 3185, name: "Epic Gold amulet", stackable: false, value: 411150 },
      { id: 4185, name: "Legendary Gold amulet", stackable: false, value: 2741000 },
      { id: 1186, name: "Uncommon Meteoric amulet", stackable: false, value: 34720 },
      { id: 2186, name: "Rare Meteoric amulet", stackable: false, value: 173600 },
      { id: 3186, name: "Epic Meteoric amulet", stackable: false, value: 1041600 },
      { id: 4186, name: "Legendary Meteoric amulet", stackable: false, value: 6944000 },
      { id: 1190, name: "Uncommon Sage seed", stackable: true, value: 30 },
      { id: 2190, name: "Rare Sage seed", stackable: true, value: 150 },
      { id: 3190, name: "Epic Sage seed", stackable: true, value: 900 },
      { id: 4190, name: "Legendary Sage seed", stackable: true, value: 6000 },
      { id: 1191, name: "Uncommon Nightshade seed", stackable: true, value: 200 },
      { id: 2191, name: "Rare Nightshade seed", stackable: true, value: 1000 },
      { id: 3191, name: "Epic Nightshade seed", stackable: true, value: 6000 },
      { id: 4191, name: "Legendary Nightshade seed", stackable: true, value: 40000 },
      { id: 1192, name: "Uncommon Dragonleaf seed", stackable: true, value: 1100 },
      { id: 2192, name: "Rare Dragonleaf seed", stackable: true, value: 5500 },
      { id: 3192, name: "Epic Dragonleaf seed", stackable: true, value: 33000 },
      { id: 4192, name: "Legendary Dragonleaf seed", stackable: true, value: 220000 },
      { id: 1193, name: "Uncommon Sage", stackable: true, value: 90 },
      { id: 2193, name: "Rare Sage", stackable: true, value: 450 },
      { id: 3193, name: "Epic Sage", stackable: true, value: 2700 },
      { id: 4193, name: "Legendary Sage", stackable: true, value: 18000 },
      { id: 1194, name: "Uncommon Nightshade", stackable: true, value: 550 },
      { id: 2194, name: "Rare Nightshade", stackable: true, value: 2750 },
      { id: 3194, name: "Epic Nightshade", stackable: true, value: 16500 },
      { id: 4194, name: "Legendary Nightshade", stackable: true, value: 110000 },
      { id: 1195, name: "Uncommon Dragonleaf", stackable: true, value: 2600 },
      { id: 2195, name: "Rare Dragonleaf", stackable: true, value: 13000 },
      { id: 3195, name: "Epic Dragonleaf", stackable: true, value: 78000 },
      { id: 4195, name: "Legendary Dragonleaf", stackable: true, value: 520000 },
      { id: 1220, name: "Uncommon Gatherer's draught", stackable: true, value: 140 },
      { id: 2220, name: "Rare Gatherer's draught", stackable: true, value: 700 },
      { id: 3220, name: "Epic Gatherer's draught", stackable: true, value: 4200 },
      { id: 4220, name: "Legendary Gatherer's draught", stackable: true, value: 28000 },
      { id: 1221, name: "Uncommon Hunter's brew", stackable: true, value: 1360 },
      { id: 2221, name: "Rare Hunter's brew", stackable: true, value: 6800 },
      { id: 3221, name: "Epic Hunter's brew", stackable: true, value: 40800 },
      { id: 4221, name: "Legendary Hunter's brew", stackable: true, value: 272000 },
      { id: 1222, name: "Uncommon Warrior's tonic", stackable: true, value: 4175 },
      { id: 2222, name: "Rare Warrior's tonic", stackable: true, value: 20875 },
      { id: 3222, name: "Epic Warrior's tonic", stackable: true, value: 125250 },
      { id: 4222, name: "Legendary Warrior's tonic", stackable: true, value: 835000 },
      { id: 1223, name: "Uncommon Elixir of the vein", stackable: true, value: 8215 },
      { id: 2223, name: "Rare Elixir of the vein", stackable: true, value: 41075 },
      { id: 3223, name: "Epic Elixir of the vein", stackable: true, value: 246450 },
      { id: 4223, name: "Legendary Elixir of the vein", stackable: true, value: 1643000 },
      { id: 1224, name: "Uncommon Abyssal tonic", stackable: true, value: 10515 },
      { id: 2224, name: "Rare Abyssal tonic", stackable: true, value: 52575 },
      { id: 3224, name: "Epic Abyssal tonic", stackable: true, value: 315450 },
      { id: 4224, name: "Legendary Abyssal tonic", stackable: true, value: 2103000 },
      { id: 1225, name: "Uncommon Swift draught", stackable: true, value: 480 },
      { id: 2225, name: "Rare Swift draught", stackable: true, value: 2400 },
      { id: 3225, name: "Epic Swift draught", stackable: true, value: 14400 },
      { id: 4225, name: "Legendary Swift draught", stackable: true, value: 96000 },
      { id: 1226, name: "Uncommon Nourishing draught", stackable: true, value: 1935 },
      { id: 2226, name: "Rare Nourishing draught", stackable: true, value: 9675 },
      { id: 3226, name: "Epic Nourishing draught", stackable: true, value: 58050 },
      { id: 4226, name: "Legendary Nourishing draught", stackable: true, value: 387000 },
      { id: 1227, name: "Uncommon Haste draught", stackable: true, value: 6025 },
      { id: 2227, name: "Rare Haste draught", stackable: true, value: 30125 },
      { id: 3227, name: "Epic Haste draught", stackable: true, value: 180750 },
      { id: 4227, name: "Legendary Haste draught", stackable: true, value: 1205000 },
      { id: 1240, name: "Uncommon Gnawer pelt", stackable: true, value: 25 },
      { id: 2240, name: "Rare Gnawer pelt", stackable: true, value: 125 },
      { id: 3240, name: "Epic Gnawer pelt", stackable: true, value: 750 },
      { id: 4240, name: "Legendary Gnawer pelt", stackable: true, value: 5000 },
      { id: 1241, name: "Uncommon Bogling skin", stackable: true, value: 60 },
      { id: 2241, name: "Rare Bogling skin", stackable: true, value: 300 },
      { id: 3241, name: "Epic Bogling skin", stackable: true, value: 1800 },
      { id: 4241, name: "Legendary Bogling skin", stackable: true, value: 12000 },
      { id: 1242, name: "Uncommon Husk chitin", stackable: true, value: 300 },
      { id: 2242, name: "Rare Husk chitin", stackable: true, value: 1500 },
      { id: 3242, name: "Epic Husk chitin", stackable: true, value: 9000 },
      { id: 4242, name: "Legendary Husk chitin", stackable: true, value: 60000 },
      { id: 1243, name: "Uncommon Cairn bone", stackable: true, value: 600 },
      { id: 2243, name: "Rare Cairn bone", stackable: true, value: 3000 },
      { id: 3243, name: "Epic Cairn bone", stackable: true, value: 18000 },
      { id: 4243, name: "Legendary Cairn bone", stackable: true, value: 120000 },
      { id: 1244, name: "Uncommon Wraith dust", stackable: true, value: 1000 },
      { id: 2244, name: "Rare Wraith dust", stackable: true, value: 5000 },
      { id: 3244, name: "Epic Wraith dust", stackable: true, value: 30000 },
      { id: 4244, name: "Legendary Wraith dust", stackable: true, value: 200000 },
      { id: 1245, name: "Uncommon Rimewolf fur", stackable: true, value: 2500 },
      { id: 2245, name: "Rare Rimewolf fur", stackable: true, value: 12500 },
      { id: 3245, name: "Epic Rimewolf fur", stackable: true, value: 75000 },
      { id: 4245, name: "Legendary Rimewolf fur", stackable: true, value: 500000 },
      { id: 1246, name: "Uncommon Stalker claw", stackable: true, value: 3500 },
      { id: 2246, name: "Rare Stalker claw", stackable: true, value: 17500 },
      { id: 3246, name: "Epic Stalker claw", stackable: true, value: 105000 },
      { id: 4246, name: "Legendary Stalker claw", stackable: true, value: 700000 },
      { id: 1247, name: "Uncommon Ember scale", stackable: true, value: 6000 },
      { id: 2247, name: "Rare Ember scale", stackable: true, value: 30000 },
      { id: 3247, name: "Epic Ember scale", stackable: true, value: 180000 },
      { id: 4247, name: "Legendary Ember scale", stackable: true, value: 1200000 },
      { id: 1248, name: "Uncommon Troll hide", stackable: true, value: 4000 },
      { id: 2248, name: "Rare Troll hide", stackable: true, value: 20000 },
      { id: 3248, name: "Epic Troll hide", stackable: true, value: 120000 },
      { id: 4248, name: "Legendary Troll hide", stackable: true, value: 800000 },
      { id: 1249, name: "Uncommon Horror ichor", stackable: true, value: 5000 },
      { id: 2249, name: "Rare Horror ichor", stackable: true, value: 25000 },
      { id: 3249, name: "Epic Horror ichor", stackable: true, value: 150000 },
      { id: 4249, name: "Legendary Horror ichor", stackable: true, value: 1000000 },
      { id: 1250, name: "Uncommon Ice wight shard", stackable: true, value: 7500 },
      { id: 2250, name: "Rare Ice wight shard", stackable: true, value: 37500 },
      { id: 3250, name: "Epic Ice wight shard", stackable: true, value: 225000 },
      { id: 4250, name: "Legendary Ice wight shard", stackable: true, value: 1500000 },
      { id: 1251, name: "Uncommon Drake hide", stackable: true, value: 10000 },
      { id: 2251, name: "Rare Drake hide", stackable: true, value: 50000 },
      { id: 3251, name: "Epic Drake hide", stackable: true, value: 300000 },
      { id: 4251, name: "Legendary Drake hide", stackable: true, value: 2000000 },
      { id: 1252, name: "Uncommon Colossus chip", stackable: true, value: 15000 },
      { id: 2252, name: "Rare Colossus chip", stackable: true, value: 75000 },
      { id: 3252, name: "Epic Colossus chip", stackable: true, value: 450000 },
      { id: 4252, name: "Legendary Colossus chip", stackable: true, value: 3000000 },
      { id: 1260, name: "Uncommon Pelt coif", stackable: false, value: 75 },
      { id: 2260, name: "Rare Pelt coif", stackable: false, value: 375 },
      { id: 3260, name: "Epic Pelt coif", stackable: false, value: 2250 },
      { id: 4260, name: "Legendary Pelt coif", stackable: false, value: 15000 },
      { id: 1261, name: "Uncommon Pelt jerkin", stackable: false, value: 150 },
      { id: 2261, name: "Rare Pelt jerkin", stackable: false, value: 750 },
      { id: 3261, name: "Epic Pelt jerkin", stackable: false, value: 4500 },
      { id: 4261, name: "Legendary Pelt jerkin", stackable: false, value: 30000 },
      { id: 1262, name: "Uncommon Pelt chaps", stackable: false, value: 100 },
      { id: 2262, name: "Rare Pelt chaps", stackable: false, value: 500 },
      { id: 3262, name: "Epic Pelt chaps", stackable: false, value: 3000 },
      { id: 4262, name: "Legendary Pelt chaps", stackable: false, value: 20000 },
      { id: 1263, name: "Uncommon Bogskin coif", stackable: false, value: 170 },
      { id: 2263, name: "Rare Bogskin coif", stackable: false, value: 850 },
      { id: 3263, name: "Epic Bogskin coif", stackable: false, value: 5100 },
      { id: 4263, name: "Legendary Bogskin coif", stackable: false, value: 34000 },
      { id: 1264, name: "Uncommon Bogskin jerkin", stackable: false, value: 350 },
      { id: 2264, name: "Rare Bogskin jerkin", stackable: false, value: 1750 },
      { id: 3264, name: "Epic Bogskin jerkin", stackable: false, value: 10500 },
      { id: 4264, name: "Legendary Bogskin jerkin", stackable: false, value: 70000 },
      { id: 1265, name: "Uncommon Bogskin chaps", stackable: false, value: 230 },
      { id: 2265, name: "Rare Bogskin chaps", stackable: false, value: 1150 },
      { id: 3265, name: "Epic Bogskin chaps", stackable: false, value: 6900 },
      { id: 4265, name: "Legendary Bogskin chaps", stackable: false, value: 46000 },
      { id: 1266, name: "Uncommon Chitin coif", stackable: false, value: 770 },
      { id: 2266, name: "Rare Chitin coif", stackable: false, value: 3850 },
      { id: 3266, name: "Epic Chitin coif", stackable: false, value: 23100 },
      { id: 4266, name: "Legendary Chitin coif", stackable: false, value: 154000 },
      { id: 1267, name: "Uncommon Chitin jerkin", stackable: false, value: 1670 },
      { id: 2267, name: "Rare Chitin jerkin", stackable: false, value: 8350 },
      { id: 3267, name: "Epic Chitin jerkin", stackable: false, value: 50100 },
      { id: 4267, name: "Legendary Chitin jerkin", stackable: false, value: 334000 },
      { id: 1268, name: "Uncommon Chitin chaps", stackable: false, value: 1070 },
      { id: 2268, name: "Rare Chitin chaps", stackable: false, value: 5350 },
      { id: 3268, name: "Epic Chitin chaps", stackable: false, value: 32100 },
      { id: 4268, name: "Legendary Chitin chaps", stackable: false, value: 214000 },
      { id: 1269, name: "Uncommon Fur coif", stackable: false, value: 5575 },
      { id: 2269, name: "Rare Fur coif", stackable: false, value: 27875 },
      { id: 3269, name: "Epic Fur coif", stackable: false, value: 167250 },
      { id: 4269, name: "Legendary Fur coif", stackable: false, value: 1115000 },
      { id: 1270, name: "Uncommon Fur jerkin", stackable: false, value: 13075 },
      { id: 2270, name: "Rare Fur jerkin", stackable: false, value: 65375 },
      { id: 3270, name: "Epic Fur jerkin", stackable: false, value: 392250 },
      { id: 4270, name: "Legendary Fur jerkin", stackable: false, value: 2615000 },
      { id: 1271, name: "Uncommon Fur chaps", stackable: false, value: 8075 },
      { id: 2271, name: "Rare Fur chaps", stackable: false, value: 40375 },
      { id: 3271, name: "Epic Fur chaps", stackable: false, value: 242250 },
      { id: 4271, name: "Legendary Fur chaps", stackable: false, value: 1615000 },
      { id: 1272, name: "Uncommon Scale coif", stackable: false, value: 14035 },
      { id: 2272, name: "Rare Scale coif", stackable: false, value: 70175 },
      { id: 3272, name: "Epic Scale coif", stackable: false, value: 421050 },
      { id: 4272, name: "Legendary Scale coif", stackable: false, value: 2807000 },
      { id: 1273, name: "Uncommon Scale jerkin", stackable: false, value: 32035 },
      { id: 2273, name: "Rare Scale jerkin", stackable: false, value: 160175 },
      { id: 3273, name: "Epic Scale jerkin", stackable: false, value: 961050 },
      { id: 4273, name: "Legendary Scale jerkin", stackable: false, value: 6407000 },
      { id: 1274, name: "Uncommon Scale chaps", stackable: false, value: 20035 },
      { id: 2274, name: "Rare Scale chaps", stackable: false, value: 100175 },
      { id: 3274, name: "Epic Scale chaps", stackable: false, value: 601050 },
      { id: 4274, name: "Legendary Scale chaps", stackable: false, value: 4007000 },
      { id: 1300, name: "Uncommon Homespun bolt", stackable: true, value: 60 },
      { id: 2300, name: "Rare Homespun bolt", stackable: true, value: 300 },
      { id: 3300, name: "Epic Homespun bolt", stackable: true, value: 1800 },
      { id: 4300, name: "Legendary Homespun bolt", stackable: true, value: 12000 },
      { id: 1301, name: "Uncommon Silk bolt", stackable: true, value: 350 },
      { id: 2301, name: "Rare Silk bolt", stackable: true, value: 1750 },
      { id: 3301, name: "Epic Silk bolt", stackable: true, value: 10500 },
      { id: 4301, name: "Legendary Silk bolt", stackable: true, value: 70000 },
      { id: 1302, name: "Uncommon Gilded bolt", stackable: true, value: 1300 },
      { id: 2302, name: "Rare Gilded bolt", stackable: true, value: 6500 },
      { id: 3302, name: "Epic Gilded bolt", stackable: true, value: 39000 },
      { id: 4302, name: "Legendary Gilded bolt", stackable: true, value: 260000 },
      { id: 1303, name: "Uncommon Voidweave bolt", stackable: true, value: 4500 },
      { id: 2303, name: "Rare Voidweave bolt", stackable: true, value: 22500 },
      { id: 3303, name: "Epic Voidweave bolt", stackable: true, value: 135000 },
      { id: 4303, name: "Legendary Voidweave bolt", stackable: true, value: 900000 },
      { id: 1304, name: "Uncommon Homespun hood", stackable: false, value: 145 },
      { id: 2304, name: "Rare Homespun hood", stackable: false, value: 725 },
      { id: 3304, name: "Epic Homespun hood", stackable: false, value: 4350 },
      { id: 4304, name: "Legendary Homespun hood", stackable: false, value: 29000 },
      { id: 1305, name: "Uncommon Homespun robe", stackable: false, value: 325 },
      { id: 2305, name: "Rare Homespun robe", stackable: false, value: 1625 },
      { id: 3305, name: "Epic Homespun robe", stackable: false, value: 9750 },
      { id: 4305, name: "Legendary Homespun robe", stackable: false, value: 65000 },
      { id: 1306, name: "Uncommon Homespun skirt", stackable: false, value: 205 },
      { id: 2306, name: "Rare Homespun skirt", stackable: false, value: 1025 },
      { id: 3306, name: "Epic Homespun skirt", stackable: false, value: 6150 },
      { id: 4306, name: "Legendary Homespun skirt", stackable: false, value: 41000 },
      { id: 1307, name: "Uncommon Silk hood", stackable: false, value: 830 },
      { id: 2307, name: "Rare Silk hood", stackable: false, value: 4150 },
      { id: 3307, name: "Epic Silk hood", stackable: false, value: 24900 },
      { id: 4307, name: "Legendary Silk hood", stackable: false, value: 166000 },
      { id: 1308, name: "Uncommon Silk robe", stackable: false, value: 1880 },
      { id: 2308, name: "Rare Silk robe", stackable: false, value: 9400 },
      { id: 3308, name: "Epic Silk robe", stackable: false, value: 56400 },
      { id: 4308, name: "Legendary Silk robe", stackable: false, value: 376000 },
      { id: 1309, name: "Uncommon Silk skirt", stackable: false, value: 1180 },
      { id: 2309, name: "Rare Silk skirt", stackable: false, value: 5900 },
      { id: 3309, name: "Epic Silk skirt", stackable: false, value: 35400 },
      { id: 4309, name: "Legendary Silk skirt", stackable: false, value: 236000 },
      { id: 1310, name: "Uncommon Gilded hood", stackable: false, value: 2985 },
      { id: 2310, name: "Rare Gilded hood", stackable: false, value: 14925 },
      { id: 3310, name: "Epic Gilded hood", stackable: false, value: 89550 },
      { id: 4310, name: "Legendary Gilded hood", stackable: false, value: 597000 },
      { id: 1311, name: "Uncommon Gilded robe", stackable: false, value: 6885 },
      { id: 2311, name: "Rare Gilded robe", stackable: false, value: 34425 },
      { id: 3311, name: "Epic Gilded robe", stackable: false, value: 206550 },
      { id: 4311, name: "Legendary Gilded robe", stackable: false, value: 1377000 },
      { id: 1312, name: "Uncommon Gilded skirt", stackable: false, value: 4285 },
      { id: 2312, name: "Rare Gilded skirt", stackable: false, value: 21425 },
      { id: 3312, name: "Epic Gilded skirt", stackable: false, value: 128550 },
      { id: 4312, name: "Legendary Gilded skirt", stackable: false, value: 857000 },
      { id: 1313, name: "Uncommon Voidweave hood", stackable: false, value: 10100 },
      { id: 2313, name: "Rare Voidweave hood", stackable: false, value: 50500 },
      { id: 3313, name: "Epic Voidweave hood", stackable: false, value: 303000 },
      { id: 4313, name: "Legendary Voidweave hood", stackable: false, value: 2020000 },
      { id: 1314, name: "Uncommon Voidweave robe", stackable: false, value: 23600 },
      { id: 2314, name: "Rare Voidweave robe", stackable: false, value: 118000 },
      { id: 3314, name: "Epic Voidweave robe", stackable: false, value: 708000 },
      { id: 4314, name: "Legendary Voidweave robe", stackable: false, value: 4720000 },
      { id: 1315, name: "Uncommon Voidweave skirt", stackable: false, value: 14600 },
      { id: 2315, name: "Rare Voidweave skirt", stackable: false, value: 73000 },
      { id: 3315, name: "Epic Voidweave skirt", stackable: false, value: 438000 },
      { id: 4315, name: "Legendary Voidweave skirt", stackable: false, value: 2920000 },
      { id: 1323, name: "Uncommon Pelt gloves", stackable: false, value: 375 },
      { id: 2323, name: "Rare Pelt gloves", stackable: false, value: 1875 },
      { id: 3323, name: "Epic Pelt gloves", stackable: false, value: 11250 },
      { id: 4323, name: "Legendary Pelt gloves", stackable: false, value: 75000 },
      { id: 1324, name: "Uncommon Bogskin gloves", stackable: false, value: 20000 },
      { id: 2324, name: "Rare Bogskin gloves", stackable: false, value: 100000 },
      { id: 3324, name: "Epic Bogskin gloves", stackable: false, value: 600000 },
      { id: 4324, name: "Legendary Bogskin gloves", stackable: false, value: 4000000 },
      { id: 1325, name: "Uncommon Chitin gloves", stackable: false, value: 60000 },
      { id: 2325, name: "Rare Chitin gloves", stackable: false, value: 300000 },
      { id: 3325, name: "Epic Chitin gloves", stackable: false, value: 1800000 },
      { id: 4325, name: "Legendary Chitin gloves", stackable: false, value: 12000000 },
      { id: 1326, name: "Uncommon Bone gloves", stackable: false, value: 200000 },
      { id: 2326, name: "Rare Bone gloves", stackable: false, value: 1000000 },
      { id: 3326, name: "Epic Bone gloves", stackable: false, value: 6000000 },
      { id: 4326, name: "Legendary Bone gloves", stackable: false, value: 40000000 },
      { id: 1327, name: "Uncommon Scale gloves", stackable: false, value: 1750000 },
      { id: 2327, name: "Rare Scale gloves", stackable: false, value: 8750000 },
      { id: 3327, name: "Epic Scale gloves", stackable: false, value: 52500000 },
      { id: 4327, name: "Legendary Scale gloves", stackable: false, value: 350000000 },
      { id: 1328, name: "Uncommon Horse", stackable: false, value: 50000 },
      { id: 2328, name: "Rare Horse", stackable: false, value: 250000 },
      { id: 3328, name: "Epic Horse", stackable: false, value: 1500000 },
      { id: 4328, name: "Legendary Horse", stackable: false, value: 10000000 },
      { id: 1329, name: "Uncommon Pelt quiver", stackable: false, value: 90 },
      { id: 2329, name: "Rare Pelt quiver", stackable: false, value: 450 },
      { id: 3329, name: "Epic Pelt quiver", stackable: false, value: 2700 },
      { id: 4329, name: "Legendary Pelt quiver", stackable: false, value: 18000 },
      { id: 1330, name: "Uncommon Bogskin quiver", stackable: false, value: 245 },
      { id: 2330, name: "Rare Bogskin quiver", stackable: false, value: 1225 },
      { id: 3330, name: "Epic Bogskin quiver", stackable: false, value: 7350 },
      { id: 4330, name: "Legendary Bogskin quiver", stackable: false, value: 49000 },
      { id: 1331, name: "Uncommon Chitin quiver", stackable: false, value: 995 },
      { id: 2331, name: "Rare Chitin quiver", stackable: false, value: 4975 },
      { id: 3331, name: "Epic Chitin quiver", stackable: false, value: 29850 },
      { id: 4331, name: "Legendary Chitin quiver", stackable: false, value: 199000 },
      { id: 1332, name: "Uncommon Fur quiver", stackable: false, value: 6075 },
      { id: 2332, name: "Rare Fur quiver", stackable: false, value: 30375 },
      { id: 3332, name: "Epic Fur quiver", stackable: false, value: 182250 },
      { id: 4332, name: "Legendary Fur quiver", stackable: false, value: 1215000 },
      { id: 1333, name: "Uncommon Scale quiver", stackable: false, value: 15235 },
      { id: 2333, name: "Rare Scale quiver", stackable: false, value: 76175 },
      { id: 3333, name: "Epic Scale quiver", stackable: false, value: 457050 },
      { id: 4333, name: "Legendary Scale quiver", stackable: false, value: 3047000 },
      { id: 1334, name: "Uncommon Linen grimoire", stackable: false, value: 205 },
      { id: 2334, name: "Rare Linen grimoire", stackable: false, value: 1025 },
      { id: 3334, name: "Epic Linen grimoire", stackable: false, value: 6150 },
      { id: 4334, name: "Legendary Linen grimoire", stackable: false, value: 41000 },
      { id: 1335, name: "Uncommon Silk grimoire", stackable: false, value: 1240 },
      { id: 2335, name: "Rare Silk grimoire", stackable: false, value: 6200 },
      { id: 3335, name: "Epic Silk grimoire", stackable: false, value: 37200 },
      { id: 4335, name: "Legendary Silk grimoire", stackable: false, value: 248000 },
      { id: 1336, name: "Uncommon Gilded grimoire", stackable: false, value: 5285 },
      { id: 2336, name: "Rare Gilded grimoire", stackable: false, value: 26425 },
      { id: 3336, name: "Epic Gilded grimoire", stackable: false, value: 158550 },
      { id: 4336, name: "Legendary Gilded grimoire", stackable: false, value: 1057000 },
      { id: 1337, name: "Uncommon Voidweave grimoire", stackable: false, value: 21600 },
      { id: 2337, name: "Rare Voidweave grimoire", stackable: false, value: 108000 },
      { id: 3337, name: "Epic Voidweave grimoire", stackable: false, value: 648000 },
      { id: 4337, name: "Legendary Voidweave grimoire", stackable: false, value: 4320000 },
      { id: 1338, name: "Uncommon Troll coif", stackable: false, value: 10915 },
      { id: 2338, name: "Rare Troll coif", stackable: false, value: 54575 },
      { id: 3338, name: "Epic Troll coif", stackable: false, value: 327450 },
      { id: 4338, name: "Legendary Troll coif", stackable: false, value: 2183000 },
      { id: 1339, name: "Uncommon Troll jerkin", stackable: false, value: 22915 },
      { id: 2339, name: "Rare Troll jerkin", stackable: false, value: 114575 },
      { id: 3339, name: "Epic Troll jerkin", stackable: false, value: 687450 },
      { id: 4339, name: "Legendary Troll jerkin", stackable: false, value: 4583000 },
      { id: 1340, name: "Uncommon Troll chaps", stackable: false, value: 14915 },
      { id: 2340, name: "Rare Troll chaps", stackable: false, value: 74575 },
      { id: 3340, name: "Epic Troll chaps", stackable: false, value: 447450 },
      { id: 4340, name: "Legendary Troll chaps", stackable: false, value: 2983000 },
      { id: 1341, name: "Uncommon Drake coif", stackable: false, value: 23250 },
      { id: 2341, name: "Rare Drake coif", stackable: false, value: 116250 },
      { id: 3341, name: "Epic Drake coif", stackable: false, value: 697500 },
      { id: 4341, name: "Legendary Drake coif", stackable: false, value: 4650000 },
      { id: 1342, name: "Uncommon Drake jerkin", stackable: false, value: 53250 },
      { id: 2342, name: "Rare Drake jerkin", stackable: false, value: 266250 },
      { id: 3342, name: "Epic Drake jerkin", stackable: false, value: 1597500 },
      { id: 4342, name: "Legendary Drake jerkin", stackable: false, value: 10650000 },
      { id: 1343, name: "Uncommon Drake chaps", stackable: false, value: 33250 },
      { id: 2343, name: "Rare Drake chaps", stackable: false, value: 166250 },
      { id: 3343, name: "Epic Drake chaps", stackable: false, value: 997500 },
      { id: 4343, name: "Legendary Drake chaps", stackable: false, value: 6650000 },
      { id: 1344, name: "Uncommon Wightweave hood", stackable: false, value: 19000 },
      { id: 2344, name: "Rare Wightweave hood", stackable: false, value: 95000 },
      { id: 3344, name: "Epic Wightweave hood", stackable: false, value: 570000 },
      { id: 4344, name: "Legendary Wightweave hood", stackable: false, value: 3800000 },
      { id: 1345, name: "Uncommon Wightweave robe", stackable: false, value: 47500 },
      { id: 2345, name: "Rare Wightweave robe", stackable: false, value: 237500 },
      { id: 3345, name: "Epic Wightweave robe", stackable: false, value: 1425000 },
      { id: 4345, name: "Legendary Wightweave robe", stackable: false, value: 9500000 },
      { id: 1346, name: "Uncommon Wightweave skirt", stackable: false, value: 31000 },
      { id: 2346, name: "Rare Wightweave skirt", stackable: false, value: 155000 },
      { id: 3346, name: "Epic Wightweave skirt", stackable: false, value: 930000 },
      { id: 4346, name: "Legendary Wightweave skirt", stackable: false, value: 6200000 },
      { id: 1347, name: "Uncommon Troll quiver", stackable: false, value: 13915 },
      { id: 2347, name: "Rare Troll quiver", stackable: false, value: 69575 },
      { id: 3347, name: "Epic Troll quiver", stackable: false, value: 417450 },
      { id: 4347, name: "Legendary Troll quiver", stackable: false, value: 2783000 },
      { id: 1348, name: "Uncommon Drake quiver", stackable: false, value: 29250 },
      { id: 2348, name: "Rare Drake quiver", stackable: false, value: 146250 },
      { id: 3348, name: "Epic Drake quiver", stackable: false, value: 877500 },
      { id: 4348, name: "Legendary Drake quiver", stackable: false, value: 5850000 },
      { id: 1349, name: "Uncommon Wightweave grimoire", stackable: false, value: 31000 },
      { id: 2349, name: "Rare Wightweave grimoire", stackable: false, value: 155000 },
      { id: 3349, name: "Epic Wightweave grimoire", stackable: false, value: 930000 },
      { id: 4349, name: "Legendary Wightweave grimoire", stackable: false, value: 6200000 },
      { id: 1350, name: "Uncommon Colossus blade", stackable: false, value: 56155 },
      { id: 2350, name: "Rare Colossus blade", stackable: false, value: 280775 },
      { id: 3350, name: "Epic Colossus blade", stackable: false, value: 1684650 },
      { id: 4350, name: "Legendary Colossus blade", stackable: false, value: 11231000 },
      { id: 1351, name: "Uncommon Colossus shield", stackable: false, value: 56155 },
      { id: 2351, name: "Rare Colossus shield", stackable: false, value: 280775 },
      { id: 3351, name: "Epic Colossus shield", stackable: false, value: 1684650 },
      { id: 4351, name: "Legendary Colossus shield", stackable: false, value: 11231000 },
      { id: 1352, name: "Uncommon Colossus helm", stackable: false, value: 33520 },
      { id: 2352, name: "Rare Colossus helm", stackable: false, value: 167600 },
      { id: 3352, name: "Epic Colossus helm", stackable: false, value: 1005600 },
      { id: 4352, name: "Legendary Colossus helm", stackable: false, value: 6704000 },
      { id: 1353, name: "Uncommon Colossus plate", stackable: false, value: 86425 },
      { id: 2353, name: "Rare Colossus plate", stackable: false, value: 432125 },
      { id: 3353, name: "Epic Colossus plate", stackable: false, value: 2592750 },
      { id: 4353, name: "Legendary Colossus plate", stackable: false, value: 17285000 },
      { id: 1354, name: "Uncommon Colossus greaves", stackable: false, value: 63790 },
      { id: 2354, name: "Rare Colossus greaves", stackable: false, value: 318950 },
      { id: 3354, name: "Epic Colossus greaves", stackable: false, value: 1913700 },
      { id: 4354, name: "Legendary Colossus greaves", stackable: false, value: 12758000 },
      { id: 1357, name: "Uncommon Leviathan amulet", stackable: false, value: 127965 },
      { id: 2357, name: "Rare Leviathan amulet", stackable: false, value: 639825 },
      { id: 3357, name: "Epic Leviathan amulet", stackable: false, value: 3838950 },
      { id: 4357, name: "Legendary Leviathan amulet", stackable: false, value: 25593000 },
      { id: 1358, name: "Uncommon Wyrm ring", stackable: false, value: 127965 },
      { id: 2358, name: "Rare Wyrm ring", stackable: false, value: 639825 },
      { id: 3358, name: "Epic Wyrm ring", stackable: false, value: 3838950 },
      { id: 4358, name: "Legendary Wyrm ring", stackable: false, value: 25593000 },
      { id: 1360, name: "Uncommon Bronze pan", stackable: false, value: 85 },
      { id: 2360, name: "Rare Bronze pan", stackable: false, value: 425 },
      { id: 3360, name: "Epic Bronze pan", stackable: false, value: 2550 },
      { id: 4360, name: "Legendary Bronze pan", stackable: false, value: 17000 },
      { id: 1361, name: "Uncommon Iron pan", stackable: false, value: 160 },
      { id: 2361, name: "Rare Iron pan", stackable: false, value: 800 },
      { id: 3361, name: "Epic Iron pan", stackable: false, value: 4800 },
      { id: 4361, name: "Legendary Iron pan", stackable: false, value: 32000 },
      { id: 1362, name: "Uncommon Steel pan", stackable: false, value: 950 },
      { id: 2362, name: "Rare Steel pan", stackable: false, value: 4750 },
      { id: 3362, name: "Epic Steel pan", stackable: false, value: 28500 },
      { id: 4362, name: "Legendary Steel pan", stackable: false, value: 190000 },
      { id: 1363, name: "Uncommon Cobalt pan", stackable: false, value: 3875 },
      { id: 2363, name: "Rare Cobalt pan", stackable: false, value: 19375 },
      { id: 3363, name: "Epic Cobalt pan", stackable: false, value: 116250 },
      { id: 4363, name: "Legendary Cobalt pan", stackable: false, value: 775000 },
      { id: 1364, name: "Uncommon Meteoric pan", stackable: false, value: 9670 },
      { id: 2364, name: "Rare Meteoric pan", stackable: false, value: 48350 },
      { id: 3364, name: "Epic Meteoric pan", stackable: false, value: 290100 },
      { id: 4364, name: "Legendary Meteoric pan", stackable: false, value: 1934000 },
      { id: 1365, name: "Uncommon Bronze hammer", stackable: false, value: 145 },
      { id: 2365, name: "Rare Bronze hammer", stackable: false, value: 725 },
      { id: 3365, name: "Epic Bronze hammer", stackable: false, value: 4350 },
      { id: 4365, name: "Legendary Bronze hammer", stackable: false, value: 29000 },
      { id: 1366, name: "Uncommon Iron hammer", stackable: false, value: 270 },
      { id: 2366, name: "Rare Iron hammer", stackable: false, value: 1350 },
      { id: 3366, name: "Epic Iron hammer", stackable: false, value: 8100 },
      { id: 4366, name: "Legendary Iron hammer", stackable: false, value: 54000 },
      { id: 1367, name: "Uncommon Steel hammer", stackable: false, value: 1730 },
      { id: 2367, name: "Rare Steel hammer", stackable: false, value: 8650 },
      { id: 3367, name: "Epic Steel hammer", stackable: false, value: 51900 },
      { id: 4367, name: "Legendary Steel hammer", stackable: false, value: 346000 },
      { id: 1368, name: "Uncommon Cobalt hammer", stackable: false, value: 7175 },
      { id: 2368, name: "Rare Cobalt hammer", stackable: false, value: 35875 },
      { id: 3368, name: "Epic Cobalt hammer", stackable: false, value: 215250 },
      { id: 4368, name: "Legendary Cobalt hammer", stackable: false, value: 1435000 },
      { id: 1369, name: "Uncommon Meteoric hammer", stackable: false, value: 17305 },
      { id: 2369, name: "Rare Meteoric hammer", stackable: false, value: 86525 },
      { id: 3369, name: "Epic Meteoric hammer", stackable: false, value: 519150 },
      { id: 4369, name: "Legendary Meteoric hammer", stackable: false, value: 3461000 },
      { id: 1370, name: "Uncommon Bronze knife", stackable: false, value: 85 },
      { id: 2370, name: "Rare Bronze knife", stackable: false, value: 425 },
      { id: 3370, name: "Epic Bronze knife", stackable: false, value: 2550 },
      { id: 4370, name: "Legendary Bronze knife", stackable: false, value: 17000 },
      { id: 1371, name: "Uncommon Iron knife", stackable: false, value: 160 },
      { id: 2371, name: "Rare Iron knife", stackable: false, value: 800 },
      { id: 3371, name: "Epic Iron knife", stackable: false, value: 4800 },
      { id: 4371, name: "Legendary Iron knife", stackable: false, value: 32000 },
      { id: 1372, name: "Uncommon Steel knife", stackable: false, value: 950 },
      { id: 2372, name: "Rare Steel knife", stackable: false, value: 4750 },
      { id: 3372, name: "Epic Steel knife", stackable: false, value: 28500 },
      { id: 4372, name: "Legendary Steel knife", stackable: false, value: 190000 },
      { id: 1373, name: "Uncommon Cobalt knife", stackable: false, value: 3875 },
      { id: 2373, name: "Rare Cobalt knife", stackable: false, value: 19375 },
      { id: 3373, name: "Epic Cobalt knife", stackable: false, value: 116250 },
      { id: 4373, name: "Legendary Cobalt knife", stackable: false, value: 775000 },
      { id: 1374, name: "Uncommon Meteoric knife", stackable: false, value: 9670 },
      { id: 2374, name: "Rare Meteoric knife", stackable: false, value: 48350 },
      { id: 3374, name: "Epic Meteoric knife", stackable: false, value: 290100 },
      { id: 4374, name: "Legendary Meteoric knife", stackable: false, value: 1934000 },
      { id: 1375, name: "Uncommon Bronze needle", stackable: false, value: 85 },
      { id: 2375, name: "Rare Bronze needle", stackable: false, value: 425 },
      { id: 3375, name: "Epic Bronze needle", stackable: false, value: 2550 },
      { id: 4375, name: "Legendary Bronze needle", stackable: false, value: 17000 },
      { id: 1376, name: "Uncommon Iron needle", stackable: false, value: 160 },
      { id: 2376, name: "Rare Iron needle", stackable: false, value: 800 },
      { id: 3376, name: "Epic Iron needle", stackable: false, value: 4800 },
      { id: 4376, name: "Legendary Iron needle", stackable: false, value: 32000 },
      { id: 1377, name: "Uncommon Steel needle", stackable: false, value: 950 },
      { id: 2377, name: "Rare Steel needle", stackable: false, value: 4750 },
      { id: 3377, name: "Epic Steel needle", stackable: false, value: 28500 },
      { id: 4377, name: "Legendary Steel needle", stackable: false, value: 190000 },
      { id: 1378, name: "Uncommon Cobalt needle", stackable: false, value: 3875 },
      { id: 2378, name: "Rare Cobalt needle", stackable: false, value: 19375 },
      { id: 3378, name: "Epic Cobalt needle", stackable: false, value: 116250 },
      { id: 4378, name: "Legendary Cobalt needle", stackable: false, value: 775000 },
      { id: 1379, name: "Uncommon Meteoric needle", stackable: false, value: 9670 },
      { id: 2379, name: "Rare Meteoric needle", stackable: false, value: 48350 },
      { id: 3379, name: "Epic Meteoric needle", stackable: false, value: 290100 },
      { id: 4379, name: "Legendary Meteoric needle", stackable: false, value: 1934000 },
      { id: 1380, name: "Uncommon Bronze mortar", stackable: false, value: 145 },
      { id: 2380, name: "Rare Bronze mortar", stackable: false, value: 725 },
      { id: 3380, name: "Epic Bronze mortar", stackable: false, value: 4350 },
      { id: 4380, name: "Legendary Bronze mortar", stackable: false, value: 29000 },
      { id: 1381, name: "Uncommon Iron mortar", stackable: false, value: 270 },
      { id: 2381, name: "Rare Iron mortar", stackable: false, value: 1350 },
      { id: 3381, name: "Epic Iron mortar", stackable: false, value: 8100 },
      { id: 4381, name: "Legendary Iron mortar", stackable: false, value: 54000 },
      { id: 1382, name: "Uncommon Steel mortar", stackable: false, value: 1730 },
      { id: 2382, name: "Rare Steel mortar", stackable: false, value: 8650 },
      { id: 3382, name: "Epic Steel mortar", stackable: false, value: 51900 },
      { id: 4382, name: "Legendary Steel mortar", stackable: false, value: 346000 },
      { id: 1383, name: "Uncommon Cobalt mortar", stackable: false, value: 7175 },
      { id: 2383, name: "Rare Cobalt mortar", stackable: false, value: 35875 },
      { id: 3383, name: "Epic Cobalt mortar", stackable: false, value: 215250 },
      { id: 4383, name: "Legendary Cobalt mortar", stackable: false, value: 1435000 },
      { id: 1384, name: "Uncommon Meteoric mortar", stackable: false, value: 17305 },
      { id: 2384, name: "Rare Meteoric mortar", stackable: false, value: 86525 },
      { id: 3384, name: "Epic Meteoric mortar", stackable: false, value: 519150 },
      { id: 4384, name: "Legendary Meteoric mortar", stackable: false, value: 3461000 },
      { id: 1385, name: "Uncommon Bronze hoe", stackable: false, value: 115 },
      { id: 2385, name: "Rare Bronze hoe", stackable: false, value: 575 },
      { id: 3385, name: "Epic Bronze hoe", stackable: false, value: 3450 },
      { id: 4385, name: "Legendary Bronze hoe", stackable: false, value: 23000 },
      { id: 1386, name: "Uncommon Iron hoe", stackable: false, value: 310 },
      { id: 2386, name: "Rare Iron hoe", stackable: false, value: 1550 },
      { id: 3386, name: "Epic Iron hoe", stackable: false, value: 9300 },
      { id: 4386, name: "Legendary Iron hoe", stackable: false, value: 62000 },
      { id: 1387, name: "Uncommon Steel hoe", stackable: false, value: 1400 },
      { id: 2387, name: "Rare Steel hoe", stackable: false, value: 7000 },
      { id: 3387, name: "Epic Steel hoe", stackable: false, value: 42000 },
      { id: 4387, name: "Legendary Steel hoe", stackable: false, value: 280000 },
      { id: 1388, name: "Uncommon Cobalt hoe", stackable: false, value: 6275 },
      { id: 2388, name: "Rare Cobalt hoe", stackable: false, value: 31375 },
      { id: 3388, name: "Epic Cobalt hoe", stackable: false, value: 188250 },
      { id: 4388, name: "Legendary Cobalt hoe", stackable: false, value: 1255000 },
      { id: 1389, name: "Uncommon Meteoric hoe", stackable: false, value: 15670 },
      { id: 2389, name: "Rare Meteoric hoe", stackable: false, value: 78350 },
      { id: 3389, name: "Epic Meteoric hoe", stackable: false, value: 470100 },
      { id: 4389, name: "Legendary Meteoric hoe", stackable: false, value: 3134000 },
      { id: 1390, name: "Uncommon Bronze greatsword", stackable: false, value: 145 },
      { id: 2390, name: "Rare Bronze greatsword", stackable: false, value: 725 },
      { id: 3390, name: "Epic Bronze greatsword", stackable: false, value: 4350 },
      { id: 4390, name: "Legendary Bronze greatsword", stackable: false, value: 29000 },
      { id: 1391, name: "Uncommon Iron greatsword", stackable: false, value: 270 },
      { id: 2391, name: "Rare Iron greatsword", stackable: false, value: 1350 },
      { id: 3391, name: "Epic Iron greatsword", stackable: false, value: 8100 },
      { id: 4391, name: "Legendary Iron greatsword", stackable: false, value: 54000 },
      { id: 1392, name: "Uncommon Steel greatsword", stackable: false, value: 1730 },
      { id: 2392, name: "Rare Steel greatsword", stackable: false, value: 8650 },
      { id: 3392, name: "Epic Steel greatsword", stackable: false, value: 51900 },
      { id: 4392, name: "Legendary Steel greatsword", stackable: false, value: 346000 },
      { id: 1393, name: "Uncommon Cobalt greatsword", stackable: false, value: 7175 },
      { id: 2393, name: "Rare Cobalt greatsword", stackable: false, value: 35875 },
      { id: 3393, name: "Epic Cobalt greatsword", stackable: false, value: 215250 },
      { id: 4393, name: "Legendary Cobalt greatsword", stackable: false, value: 1435000 },
      { id: 1394, name: "Uncommon Meteoric greatsword", stackable: false, value: 17305 },
      { id: 2394, name: "Rare Meteoric greatsword", stackable: false, value: 86525 },
      { id: 3394, name: "Epic Meteoric greatsword", stackable: false, value: 519150 },
      { id: 4394, name: "Legendary Meteoric greatsword", stackable: false, value: 3461000 },
      { id: 1395, name: "Uncommon Colossus greatsword", stackable: false, value: 63520 },
      { id: 2395, name: "Rare Colossus greatsword", stackable: false, value: 317600 },
      { id: 3395, name: "Epic Colossus greatsword", stackable: false, value: 1905600 },
      { id: 4395, name: "Legendary Colossus greatsword", stackable: false, value: 12704000 },
    ],
    tools: [
      { itemId: 80, slot: "pickaxe", bonus: 0.08 },
      { itemId: 81, slot: "pickaxe", bonus: 0.16 },
      { itemId: 82, slot: "pickaxe", bonus: 0.25 },
      { itemId: 83, slot: "pickaxe", bonus: 0.35 },
      { itemId: 84, slot: "pickaxe", bonus: 0.5 },
      { itemId: 85, slot: "rod", bonus: 0.08 },
      { itemId: 86, slot: "rod", bonus: 0.16 },
      { itemId: 87, slot: "rod", bonus: 0.25 },
      { itemId: 88, slot: "rod", bonus: 0.35 },
      { itemId: 89, slot: "rod", bonus: 0.5 },
      { itemId: 90, slot: "axe", bonus: 0.08 },
      { itemId: 91, slot: "axe", bonus: 0.16 },
      { itemId: 92, slot: "axe", bonus: 0.25 },
      { itemId: 93, slot: "axe", bonus: 0.35 },
      { itemId: 94, slot: "axe", bonus: 0.5 },
      { itemId: 323, slot: "gloves", bonus: 0.08 },
      { itemId: 324, slot: "gloves", bonus: 0.16 },
      { itemId: 325, slot: "gloves", bonus: 0.25 },
      { itemId: 326, slot: "gloves", bonus: 0.35 },
      { itemId: 327, slot: "gloves", bonus: 0.5 },
      { itemId: 360, slot: "pan", bonus: 0.08 },
      { itemId: 361, slot: "pan", bonus: 0.16 },
      { itemId: 362, slot: "pan", bonus: 0.25 },
      { itemId: 363, slot: "pan", bonus: 0.35 },
      { itemId: 364, slot: "pan", bonus: 0.5 },
      { itemId: 365, slot: "hammer", bonus: 0.08 },
      { itemId: 366, slot: "hammer", bonus: 0.16 },
      { itemId: 367, slot: "hammer", bonus: 0.25 },
      { itemId: 368, slot: "hammer", bonus: 0.35 },
      { itemId: 369, slot: "hammer", bonus: 0.5 },
      { itemId: 370, slot: "knife", bonus: 0.08 },
      { itemId: 371, slot: "knife", bonus: 0.16 },
      { itemId: 372, slot: "knife", bonus: 0.25 },
      { itemId: 373, slot: "knife", bonus: 0.35 },
      { itemId: 374, slot: "knife", bonus: 0.5 },
      { itemId: 375, slot: "needle", bonus: 0.08 },
      { itemId: 376, slot: "needle", bonus: 0.16 },
      { itemId: 377, slot: "needle", bonus: 0.25 },
      { itemId: 378, slot: "needle", bonus: 0.35 },
      { itemId: 379, slot: "needle", bonus: 0.5 },
      { itemId: 380, slot: "mortar", bonus: 0.08 },
      { itemId: 381, slot: "mortar", bonus: 0.16 },
      { itemId: 382, slot: "mortar", bonus: 0.25 },
      { itemId: 383, slot: "mortar", bonus: 0.35 },
      { itemId: 384, slot: "mortar", bonus: 0.5 },
      { itemId: 385, slot: "hoe", bonus: 0.08 },
      { itemId: 386, slot: "hoe", bonus: 0.16 },
      { itemId: 387, slot: "hoe", bonus: 0.25 },
      { itemId: 388, slot: "hoe", bonus: 0.35 },
      { itemId: 389, slot: "hoe", bonus: 0.5 },
      { itemId: 328, slot: "mount", bonus: 0.12 },
      { itemId: 1080, slot: "pickaxe", bonus: 0.10400000000000001 },
      { itemId: 2080, slot: "pickaxe", bonus: 0.128 },
      { itemId: 3080, slot: "pickaxe", bonus: 0.17600000000000002 },
      { itemId: 4080, slot: "pickaxe", bonus: 0.24 },
      { itemId: 1081, slot: "pickaxe", bonus: 0.20800000000000002 },
      { itemId: 2081, slot: "pickaxe", bonus: 0.256 },
      { itemId: 3081, slot: "pickaxe", bonus: 0.35200000000000004 },
      { itemId: 4081, slot: "pickaxe", bonus: 0.48 },
      { itemId: 1082, slot: "pickaxe", bonus: 0.325 },
      { itemId: 2082, slot: "pickaxe", bonus: 0.4 },
      { itemId: 3082, slot: "pickaxe", bonus: 0.55 },
      { itemId: 4082, slot: "pickaxe", bonus: 0.75 },
      { itemId: 1083, slot: "pickaxe", bonus: 0.45499999999999996 },
      { itemId: 2083, slot: "pickaxe", bonus: 0.5599999999999999 },
      { itemId: 3083, slot: "pickaxe", bonus: 0.77 },
      { itemId: 4083, slot: "pickaxe", bonus: 1.0499999999999998 },
      { itemId: 1084, slot: "pickaxe", bonus: 0.65 },
      { itemId: 2084, slot: "pickaxe", bonus: 0.8 },
      { itemId: 3084, slot: "pickaxe", bonus: 1.1 },
      { itemId: 4084, slot: "pickaxe", bonus: 1.5 },
      { itemId: 1085, slot: "rod", bonus: 0.10400000000000001 },
      { itemId: 2085, slot: "rod", bonus: 0.128 },
      { itemId: 3085, slot: "rod", bonus: 0.17600000000000002 },
      { itemId: 4085, slot: "rod", bonus: 0.24 },
      { itemId: 1086, slot: "rod", bonus: 0.20800000000000002 },
      { itemId: 2086, slot: "rod", bonus: 0.256 },
      { itemId: 3086, slot: "rod", bonus: 0.35200000000000004 },
      { itemId: 4086, slot: "rod", bonus: 0.48 },
      { itemId: 1087, slot: "rod", bonus: 0.325 },
      { itemId: 2087, slot: "rod", bonus: 0.4 },
      { itemId: 3087, slot: "rod", bonus: 0.55 },
      { itemId: 4087, slot: "rod", bonus: 0.75 },
      { itemId: 1088, slot: "rod", bonus: 0.45499999999999996 },
      { itemId: 2088, slot: "rod", bonus: 0.5599999999999999 },
      { itemId: 3088, slot: "rod", bonus: 0.77 },
      { itemId: 4088, slot: "rod", bonus: 1.0499999999999998 },
      { itemId: 1089, slot: "rod", bonus: 0.65 },
      { itemId: 2089, slot: "rod", bonus: 0.8 },
      { itemId: 3089, slot: "rod", bonus: 1.1 },
      { itemId: 4089, slot: "rod", bonus: 1.5 },
      { itemId: 1090, slot: "axe", bonus: 0.10400000000000001 },
      { itemId: 2090, slot: "axe", bonus: 0.128 },
      { itemId: 3090, slot: "axe", bonus: 0.17600000000000002 },
      { itemId: 4090, slot: "axe", bonus: 0.24 },
      { itemId: 1091, slot: "axe", bonus: 0.20800000000000002 },
      { itemId: 2091, slot: "axe", bonus: 0.256 },
      { itemId: 3091, slot: "axe", bonus: 0.35200000000000004 },
      { itemId: 4091, slot: "axe", bonus: 0.48 },
      { itemId: 1092, slot: "axe", bonus: 0.325 },
      { itemId: 2092, slot: "axe", bonus: 0.4 },
      { itemId: 3092, slot: "axe", bonus: 0.55 },
      { itemId: 4092, slot: "axe", bonus: 0.75 },
      { itemId: 1093, slot: "axe", bonus: 0.45499999999999996 },
      { itemId: 2093, slot: "axe", bonus: 0.5599999999999999 },
      { itemId: 3093, slot: "axe", bonus: 0.77 },
      { itemId: 4093, slot: "axe", bonus: 1.0499999999999998 },
      { itemId: 1094, slot: "axe", bonus: 0.65 },
      { itemId: 2094, slot: "axe", bonus: 0.8 },
      { itemId: 3094, slot: "axe", bonus: 1.1 },
      { itemId: 4094, slot: "axe", bonus: 1.5 },
      { itemId: 1323, slot: "gloves", bonus: 0.10400000000000001 },
      { itemId: 2323, slot: "gloves", bonus: 0.128 },
      { itemId: 3323, slot: "gloves", bonus: 0.17600000000000002 },
      { itemId: 4323, slot: "gloves", bonus: 0.24 },
      { itemId: 1324, slot: "gloves", bonus: 0.20800000000000002 },
      { itemId: 2324, slot: "gloves", bonus: 0.256 },
      { itemId: 3324, slot: "gloves", bonus: 0.35200000000000004 },
      { itemId: 4324, slot: "gloves", bonus: 0.48 },
      { itemId: 1325, slot: "gloves", bonus: 0.325 },
      { itemId: 2325, slot: "gloves", bonus: 0.4 },
      { itemId: 3325, slot: "gloves", bonus: 0.55 },
      { itemId: 4325, slot: "gloves", bonus: 0.75 },
      { itemId: 1326, slot: "gloves", bonus: 0.45499999999999996 },
      { itemId: 2326, slot: "gloves", bonus: 0.5599999999999999 },
      { itemId: 3326, slot: "gloves", bonus: 0.77 },
      { itemId: 4326, slot: "gloves", bonus: 1.0499999999999998 },
      { itemId: 1327, slot: "gloves", bonus: 0.65 },
      { itemId: 2327, slot: "gloves", bonus: 0.8 },
      { itemId: 3327, slot: "gloves", bonus: 1.1 },
      { itemId: 4327, slot: "gloves", bonus: 1.5 },
      { itemId: 1360, slot: "pan", bonus: 0.10400000000000001 },
      { itemId: 2360, slot: "pan", bonus: 0.128 },
      { itemId: 3360, slot: "pan", bonus: 0.17600000000000002 },
      { itemId: 4360, slot: "pan", bonus: 0.24 },
      { itemId: 1361, slot: "pan", bonus: 0.20800000000000002 },
      { itemId: 2361, slot: "pan", bonus: 0.256 },
      { itemId: 3361, slot: "pan", bonus: 0.35200000000000004 },
      { itemId: 4361, slot: "pan", bonus: 0.48 },
      { itemId: 1362, slot: "pan", bonus: 0.325 },
      { itemId: 2362, slot: "pan", bonus: 0.4 },
      { itemId: 3362, slot: "pan", bonus: 0.55 },
      { itemId: 4362, slot: "pan", bonus: 0.75 },
      { itemId: 1363, slot: "pan", bonus: 0.45499999999999996 },
      { itemId: 2363, slot: "pan", bonus: 0.5599999999999999 },
      { itemId: 3363, slot: "pan", bonus: 0.77 },
      { itemId: 4363, slot: "pan", bonus: 1.0499999999999998 },
      { itemId: 1364, slot: "pan", bonus: 0.65 },
      { itemId: 2364, slot: "pan", bonus: 0.8 },
      { itemId: 3364, slot: "pan", bonus: 1.1 },
      { itemId: 4364, slot: "pan", bonus: 1.5 },
      { itemId: 1365, slot: "hammer", bonus: 0.10400000000000001 },
      { itemId: 2365, slot: "hammer", bonus: 0.128 },
      { itemId: 3365, slot: "hammer", bonus: 0.17600000000000002 },
      { itemId: 4365, slot: "hammer", bonus: 0.24 },
      { itemId: 1366, slot: "hammer", bonus: 0.20800000000000002 },
      { itemId: 2366, slot: "hammer", bonus: 0.256 },
      { itemId: 3366, slot: "hammer", bonus: 0.35200000000000004 },
      { itemId: 4366, slot: "hammer", bonus: 0.48 },
      { itemId: 1367, slot: "hammer", bonus: 0.325 },
      { itemId: 2367, slot: "hammer", bonus: 0.4 },
      { itemId: 3367, slot: "hammer", bonus: 0.55 },
      { itemId: 4367, slot: "hammer", bonus: 0.75 },
      { itemId: 1368, slot: "hammer", bonus: 0.45499999999999996 },
      { itemId: 2368, slot: "hammer", bonus: 0.5599999999999999 },
      { itemId: 3368, slot: "hammer", bonus: 0.77 },
      { itemId: 4368, slot: "hammer", bonus: 1.0499999999999998 },
      { itemId: 1369, slot: "hammer", bonus: 0.65 },
      { itemId: 2369, slot: "hammer", bonus: 0.8 },
      { itemId: 3369, slot: "hammer", bonus: 1.1 },
      { itemId: 4369, slot: "hammer", bonus: 1.5 },
      { itemId: 1370, slot: "knife", bonus: 0.10400000000000001 },
      { itemId: 2370, slot: "knife", bonus: 0.128 },
      { itemId: 3370, slot: "knife", bonus: 0.17600000000000002 },
      { itemId: 4370, slot: "knife", bonus: 0.24 },
      { itemId: 1371, slot: "knife", bonus: 0.20800000000000002 },
      { itemId: 2371, slot: "knife", bonus: 0.256 },
      { itemId: 3371, slot: "knife", bonus: 0.35200000000000004 },
      { itemId: 4371, slot: "knife", bonus: 0.48 },
      { itemId: 1372, slot: "knife", bonus: 0.325 },
      { itemId: 2372, slot: "knife", bonus: 0.4 },
      { itemId: 3372, slot: "knife", bonus: 0.55 },
      { itemId: 4372, slot: "knife", bonus: 0.75 },
      { itemId: 1373, slot: "knife", bonus: 0.45499999999999996 },
      { itemId: 2373, slot: "knife", bonus: 0.5599999999999999 },
      { itemId: 3373, slot: "knife", bonus: 0.77 },
      { itemId: 4373, slot: "knife", bonus: 1.0499999999999998 },
      { itemId: 1374, slot: "knife", bonus: 0.65 },
      { itemId: 2374, slot: "knife", bonus: 0.8 },
      { itemId: 3374, slot: "knife", bonus: 1.1 },
      { itemId: 4374, slot: "knife", bonus: 1.5 },
      { itemId: 1375, slot: "needle", bonus: 0.10400000000000001 },
      { itemId: 2375, slot: "needle", bonus: 0.128 },
      { itemId: 3375, slot: "needle", bonus: 0.17600000000000002 },
      { itemId: 4375, slot: "needle", bonus: 0.24 },
      { itemId: 1376, slot: "needle", bonus: 0.20800000000000002 },
      { itemId: 2376, slot: "needle", bonus: 0.256 },
      { itemId: 3376, slot: "needle", bonus: 0.35200000000000004 },
      { itemId: 4376, slot: "needle", bonus: 0.48 },
      { itemId: 1377, slot: "needle", bonus: 0.325 },
      { itemId: 2377, slot: "needle", bonus: 0.4 },
      { itemId: 3377, slot: "needle", bonus: 0.55 },
      { itemId: 4377, slot: "needle", bonus: 0.75 },
      { itemId: 1378, slot: "needle", bonus: 0.45499999999999996 },
      { itemId: 2378, slot: "needle", bonus: 0.5599999999999999 },
      { itemId: 3378, slot: "needle", bonus: 0.77 },
      { itemId: 4378, slot: "needle", bonus: 1.0499999999999998 },
      { itemId: 1379, slot: "needle", bonus: 0.65 },
      { itemId: 2379, slot: "needle", bonus: 0.8 },
      { itemId: 3379, slot: "needle", bonus: 1.1 },
      { itemId: 4379, slot: "needle", bonus: 1.5 },
      { itemId: 1380, slot: "mortar", bonus: 0.10400000000000001 },
      { itemId: 2380, slot: "mortar", bonus: 0.128 },
      { itemId: 3380, slot: "mortar", bonus: 0.17600000000000002 },
      { itemId: 4380, slot: "mortar", bonus: 0.24 },
      { itemId: 1381, slot: "mortar", bonus: 0.20800000000000002 },
      { itemId: 2381, slot: "mortar", bonus: 0.256 },
      { itemId: 3381, slot: "mortar", bonus: 0.35200000000000004 },
      { itemId: 4381, slot: "mortar", bonus: 0.48 },
      { itemId: 1382, slot: "mortar", bonus: 0.325 },
      { itemId: 2382, slot: "mortar", bonus: 0.4 },
      { itemId: 3382, slot: "mortar", bonus: 0.55 },
      { itemId: 4382, slot: "mortar", bonus: 0.75 },
      { itemId: 1383, slot: "mortar", bonus: 0.45499999999999996 },
      { itemId: 2383, slot: "mortar", bonus: 0.5599999999999999 },
      { itemId: 3383, slot: "mortar", bonus: 0.77 },
      { itemId: 4383, slot: "mortar", bonus: 1.0499999999999998 },
      { itemId: 1384, slot: "mortar", bonus: 0.65 },
      { itemId: 2384, slot: "mortar", bonus: 0.8 },
      { itemId: 3384, slot: "mortar", bonus: 1.1 },
      { itemId: 4384, slot: "mortar", bonus: 1.5 },
      { itemId: 1385, slot: "hoe", bonus: 0.10400000000000001 },
      { itemId: 2385, slot: "hoe", bonus: 0.128 },
      { itemId: 3385, slot: "hoe", bonus: 0.17600000000000002 },
      { itemId: 4385, slot: "hoe", bonus: 0.24 },
      { itemId: 1386, slot: "hoe", bonus: 0.20800000000000002 },
      { itemId: 2386, slot: "hoe", bonus: 0.256 },
      { itemId: 3386, slot: "hoe", bonus: 0.35200000000000004 },
      { itemId: 4386, slot: "hoe", bonus: 0.48 },
      { itemId: 1387, slot: "hoe", bonus: 0.325 },
      { itemId: 2387, slot: "hoe", bonus: 0.4 },
      { itemId: 3387, slot: "hoe", bonus: 0.55 },
      { itemId: 4387, slot: "hoe", bonus: 0.75 },
      { itemId: 1388, slot: "hoe", bonus: 0.45499999999999996 },
      { itemId: 2388, slot: "hoe", bonus: 0.5599999999999999 },
      { itemId: 3388, slot: "hoe", bonus: 0.77 },
      { itemId: 4388, slot: "hoe", bonus: 1.0499999999999998 },
      { itemId: 1389, slot: "hoe", bonus: 0.65 },
      { itemId: 2389, slot: "hoe", bonus: 0.8 },
      { itemId: 3389, slot: "hoe", bonus: 1.1 },
      { itemId: 4389, slot: "hoe", bonus: 1.5 },
      { itemId: 1328, slot: "mount", bonus: 0.18 },
      { itemId: 2328, slot: "mount", bonus: 0.27 },
      { itemId: 3328, slot: "mount", bonus: 0.42 },
      { itemId: 4328, slot: "mount", bonus: 0.6 },
    ],
    gear: [
      {
        itemId: 110,
        slot: "weapon",
        accuracy: 6,
        strength: 5,
        defence: 0,
        speed: 4,
        levelReq: 1,
        needs: "melee",
      },
      {
        itemId: 111,
        slot: "weapon",
        accuracy: 14,
        strength: 12,
        defence: 0,
        speed: 4,
        levelReq: 15,
        needs: "melee",
      },
      {
        itemId: 112,
        slot: "weapon",
        accuracy: 24,
        strength: 21,
        defence: 0,
        speed: 4,
        levelReq: 30,
        needs: "melee",
      },
      {
        itemId: 113,
        slot: "weapon",
        accuracy: 38,
        strength: 34,
        defence: 0,
        speed: 4,
        levelReq: 60,
        needs: "melee",
      },
      {
        itemId: 114,
        slot: "weapon",
        accuracy: 56,
        strength: 50,
        defence: 0,
        speed: 4,
        levelReq: 85,
        needs: "melee",
      },
      {
        itemId: 390,
        slot: "weapon",
        accuracy: 7,
        strength: 5,
        defence: 0,
        speed: 4,
        twoHanded: true,
        levelReq: 1,
        needs: "melee",
      },
      {
        itemId: 391,
        slot: "weapon",
        accuracy: 16,
        strength: 15,
        defence: 0,
        speed: 4,
        twoHanded: true,
        levelReq: 15,
        needs: "melee",
      },
      {
        itemId: 392,
        slot: "weapon",
        accuracy: 27,
        strength: 24,
        defence: 0,
        speed: 4,
        twoHanded: true,
        levelReq: 30,
        needs: "melee",
      },
      {
        itemId: 393,
        slot: "weapon",
        accuracy: 53,
        strength: 48,
        defence: 0,
        speed: 4,
        twoHanded: true,
        levelReq: 60,
        needs: "melee",
      },
      {
        itemId: 394,
        slot: "weapon",
        accuracy: 72,
        strength: 65,
        defence: 0,
        speed: 4,
        twoHanded: true,
        levelReq: 85,
        needs: "melee",
      },
      {
        itemId: 395,
        slot: "weapon",
        accuracy: 80,
        strength: 72,
        defence: 0,
        speed: 4,
        twoHanded: true,
        levelReq: 99,
        needs: "melee",
      },
      {
        itemId: 115,
        slot: "shield",
        accuracy: 0,
        strength: 3,
        defence: 4,
        levelReq: 1,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 116,
        slot: "shield",
        accuracy: 0,
        strength: 9,
        defence: 9,
        levelReq: 15,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 117,
        slot: "shield",
        accuracy: 0,
        strength: 14,
        defence: 16,
        levelReq: 30,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 118,
        slot: "shield",
        accuracy: 0,
        strength: 35,
        defence: 25,
        levelReq: 60,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 119,
        slot: "shield",
        accuracy: 0,
        strength: 43,
        defence: 37,
        levelReq: 85,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 329,
        slot: "shield",
        accuracy: 2,
        strength: 1,
        defence: 0,
        ranged: true,
        levelReq: 1,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 330,
        slot: "shield",
        accuracy: 4,
        strength: 3,
        defence: 0,
        ranged: true,
        levelReq: 15,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 331,
        slot: "shield",
        accuracy: 7,
        strength: 5,
        defence: 0,
        ranged: true,
        levelReq: 30,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 332,
        slot: "shield",
        accuracy: 11,
        strength: 8,
        defence: 0,
        ranged: true,
        levelReq: 60,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 333,
        slot: "shield",
        accuracy: 16,
        strength: 12,
        defence: 0,
        ranged: true,
        levelReq: 85,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 347,
        slot: "shield",
        accuracy: 20,
        strength: 15,
        defence: 0,
        ranged: true,
        levelReq: 95,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 348,
        slot: "shield",
        accuracy: 24,
        strength: 18,
        defence: 0,
        ranged: true,
        levelReq: 99,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 334,
        slot: "shield",
        accuracy: 2,
        strength: 1,
        defence: 0,
        magic: true,
        levelReq: 1,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 335,
        slot: "shield",
        accuracy: 5,
        strength: 4,
        defence: 0,
        magic: true,
        levelReq: 25,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 336,
        slot: "shield",
        accuracy: 9,
        strength: 7,
        defence: 0,
        magic: true,
        levelReq: 50,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 337,
        slot: "shield",
        accuracy: 14,
        strength: 11,
        defence: 0,
        magic: true,
        levelReq: 75,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 349,
        slot: "shield",
        accuracy: 18,
        strength: 14,
        defence: 0,
        magic: true,
        levelReq: 90,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 120,
        slot: "helmet",
        accuracy: 1,
        strength: 0,
        defence: 3,
        levelReq: 1,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 121,
        slot: "helmet",
        accuracy: 2,
        strength: 0,
        defence: 7,
        levelReq: 15,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 122,
        slot: "helmet",
        accuracy: 4,
        strength: 0,
        defence: 12,
        levelReq: 30,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 123,
        slot: "helmet",
        accuracy: 7,
        strength: 0,
        defence: 19,
        levelReq: 60,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 124,
        slot: "helmet",
        accuracy: 10,
        strength: 0,
        defence: 28,
        levelReq: 85,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 125,
        slot: "body",
        accuracy: 2,
        strength: 0,
        defence: 6,
        levelReq: 1,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 126,
        slot: "body",
        accuracy: 5,
        strength: 0,
        defence: 14,
        levelReq: 15,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 127,
        slot: "body",
        accuracy: 8,
        strength: 0,
        defence: 24,
        levelReq: 30,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 128,
        slot: "body",
        accuracy: 13,
        strength: 0,
        defence: 38,
        levelReq: 60,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 129,
        slot: "body",
        accuracy: 20,
        strength: 0,
        defence: 56,
        levelReq: 85,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 130,
        slot: "legs",
        accuracy: 2,
        strength: 0,
        defence: 5,
        levelReq: 1,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 131,
        slot: "legs",
        accuracy: 4,
        strength: 0,
        defence: 11,
        levelReq: 15,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 132,
        slot: "legs",
        accuracy: 7,
        strength: 0,
        defence: 19,
        levelReq: 30,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 133,
        slot: "legs",
        accuracy: 10,
        strength: 0,
        defence: 30,
        levelReq: 60,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 134,
        slot: "legs",
        accuracy: 15,
        strength: 0,
        defence: 44,
        levelReq: 85,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 350,
        slot: "weapon",
        accuracy: 70,
        strength: 63,
        defence: 0,
        speed: 4,
        levelReq: 99,
        needs: "melee",
      },
      {
        itemId: 351,
        slot: "shield",
        accuracy: 0,
        strength: 43,
        defence: 46,
        levelReq: 99,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 352,
        slot: "helmet",
        accuracy: 12,
        strength: 0,
        defence: 35,
        levelReq: 99,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 353,
        slot: "body",
        accuracy: 24,
        strength: 0,
        defence: 70,
        levelReq: 99,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 354,
        slot: "legs",
        accuracy: 19,
        strength: 0,
        defence: 55,
        levelReq: 99,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 260,
        slot: "helmet",
        accuracy: 1,
        strength: 0,
        defence: 2,
        levelReq: 1,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 261,
        slot: "body",
        accuracy: 2,
        strength: 0,
        defence: 4,
        levelReq: 1,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 262,
        slot: "legs",
        accuracy: 2,
        strength: 0,
        defence: 3,
        levelReq: 1,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 263,
        slot: "helmet",
        accuracy: 3,
        strength: 0,
        defence: 4,
        levelReq: 15,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 264,
        slot: "body",
        accuracy: 5,
        strength: 0,
        defence: 8,
        levelReq: 15,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 265,
        slot: "legs",
        accuracy: 4,
        strength: 0,
        defence: 7,
        levelReq: 15,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 266,
        slot: "helmet",
        accuracy: 5,
        strength: 0,
        defence: 7,
        levelReq: 30,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 267,
        slot: "body",
        accuracy: 8,
        strength: 0,
        defence: 14,
        levelReq: 30,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 268,
        slot: "legs",
        accuracy: 6,
        strength: 0,
        defence: 11,
        levelReq: 30,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 269,
        slot: "helmet",
        accuracy: 8,
        strength: 0,
        defence: 11,
        levelReq: 60,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 270,
        slot: "body",
        accuracy: 13,
        strength: 0,
        defence: 23,
        levelReq: 60,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 271,
        slot: "legs",
        accuracy: 10,
        strength: 0,
        defence: 18,
        levelReq: 60,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 272,
        slot: "helmet",
        accuracy: 12,
        strength: 0,
        defence: 17,
        levelReq: 85,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 273,
        slot: "body",
        accuracy: 20,
        strength: 0,
        defence: 34,
        levelReq: 85,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 274,
        slot: "legs",
        accuracy: 15,
        strength: 0,
        defence: 26,
        levelReq: 85,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 338,
        slot: "helmet",
        accuracy: 15,
        strength: 0,
        defence: 21,
        levelReq: 95,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 339,
        slot: "body",
        accuracy: 25,
        strength: 0,
        defence: 42,
        levelReq: 95,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 340,
        slot: "legs",
        accuracy: 19,
        strength: 0,
        defence: 32,
        levelReq: 95,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 341,
        slot: "helmet",
        accuracy: 18,
        strength: 0,
        defence: 25,
        levelReq: 99,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 342,
        slot: "body",
        accuracy: 30,
        strength: 0,
        defence: 50,
        levelReq: 99,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 343,
        slot: "legs",
        accuracy: 22,
        strength: 0,
        defence: 38,
        levelReq: 99,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 140,
        slot: "weapon",
        accuracy: 5,
        strength: 4,
        defence: 0,
        speed: 3,
        ranged: true,
        levelReq: 1,
        needs: "ranged",
      },
      {
        itemId: 141,
        slot: "weapon",
        accuracy: 12,
        strength: 10,
        defence: 0,
        speed: 3,
        ranged: true,
        levelReq: 15,
        needs: "ranged",
      },
      {
        itemId: 142,
        slot: "weapon",
        accuracy: 20,
        strength: 17,
        defence: 0,
        speed: 3,
        ranged: true,
        levelReq: 30,
        needs: "ranged",
      },
      {
        itemId: 143,
        slot: "weapon",
        accuracy: 30,
        strength: 26,
        defence: 0,
        speed: 3,
        ranged: true,
        levelReq: 45,
        needs: "ranged",
      },
      {
        itemId: 144,
        slot: "weapon",
        accuracy: 42,
        strength: 37,
        defence: 0,
        speed: 3,
        ranged: true,
        levelReq: 60,
        needs: "ranged",
      },
      {
        itemId: 145,
        slot: "weapon",
        accuracy: 56,
        strength: 50,
        defence: 0,
        speed: 3,
        ranged: true,
        levelReq: 75,
        needs: "ranged",
      },
      {
        itemId: 152,
        slot: "weapon",
        accuracy: 5,
        strength: 4,
        defence: 0,
        speed: 6,
        magic: true,
        levelReq: 1,
        needs: "magic",
      },
      {
        itemId: 153,
        slot: "weapon",
        accuracy: 12,
        strength: 10,
        defence: 0,
        speed: 6,
        magic: true,
        levelReq: 15,
        needs: "magic",
      },
      {
        itemId: 154,
        slot: "weapon",
        accuracy: 20,
        strength: 17,
        defence: 0,
        speed: 6,
        magic: true,
        levelReq: 30,
        needs: "magic",
      },
      {
        itemId: 155,
        slot: "weapon",
        accuracy: 30,
        strength: 26,
        defence: 0,
        speed: 6,
        magic: true,
        levelReq: 45,
        needs: "magic",
      },
      {
        itemId: 156,
        slot: "weapon",
        accuracy: 42,
        strength: 37,
        defence: 0,
        speed: 6,
        magic: true,
        levelReq: 60,
        needs: "magic",
      },
      {
        itemId: 157,
        slot: "weapon",
        accuracy: 56,
        strength: 50,
        defence: 0,
        speed: 6,
        magic: true,
        levelReq: 75,
        needs: "magic",
      },
      {
        itemId: 181,
        slot: "ring",
        accuracy: 4,
        strength: 2,
        defence: 0,
        levelReq: 20,
        needs: "defence",
      },
      {
        itemId: 182,
        slot: "ring",
        accuracy: 9,
        strength: 5,
        defence: 0,
        levelReq: 45,
        needs: "defence",
      },
      {
        itemId: 183,
        slot: "ring",
        accuracy: 16,
        strength: 9,
        defence: 0,
        levelReq: 75,
        needs: "defence",
      },
      {
        itemId: 358,
        slot: "ring",
        accuracy: 22,
        strength: 13,
        defence: 0,
        levelReq: 95,
        needs: "defence",
      },
      {
        itemId: 184,
        slot: "amulet",
        accuracy: 0,
        strength: 0,
        defence: 4,
        luck: 0.25,
        levelReq: 30,
        needs: "none",
      },
      {
        itemId: 185,
        slot: "amulet",
        accuracy: 0,
        strength: 0,
        defence: 8,
        luck: 0.5,
        levelReq: 55,
        needs: "none",
      },
      {
        itemId: 186,
        slot: "amulet",
        accuracy: 0,
        strength: 0,
        defence: 14,
        luck: 1,
        levelReq: 85,
        needs: "none",
      },
      {
        itemId: 357,
        slot: "amulet",
        accuracy: 0,
        strength: 0,
        defence: 18,
        luck: 1.5,
        levelReq: 95,
        needs: "none",
      },
      {
        itemId: 304,
        slot: "helmet",
        accuracy: 2,
        strength: 0,
        defence: 1,
        levelReq: 1,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 305,
        slot: "body",
        accuracy: 3,
        strength: 0,
        defence: 2,
        levelReq: 1,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 306,
        slot: "legs",
        accuracy: 2,
        strength: 0,
        defence: 1,
        levelReq: 1,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 307,
        slot: "helmet",
        accuracy: 6,
        strength: 0,
        defence: 2,
        levelReq: 25,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 308,
        slot: "body",
        accuracy: 10,
        strength: 0,
        defence: 5,
        levelReq: 25,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 309,
        slot: "legs",
        accuracy: 8,
        strength: 0,
        defence: 4,
        levelReq: 25,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 310,
        slot: "helmet",
        accuracy: 11,
        strength: 0,
        defence: 4,
        levelReq: 50,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 311,
        slot: "body",
        accuracy: 18,
        strength: 0,
        defence: 9,
        levelReq: 50,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 312,
        slot: "legs",
        accuracy: 14,
        strength: 0,
        defence: 7,
        levelReq: 50,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 313,
        slot: "helmet",
        accuracy: 17,
        strength: 0,
        defence: 7,
        levelReq: 75,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 314,
        slot: "body",
        accuracy: 28,
        strength: 0,
        defence: 14,
        levelReq: 75,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 315,
        slot: "legs",
        accuracy: 22,
        strength: 0,
        defence: 11,
        levelReq: 75,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 344,
        slot: "helmet",
        accuracy: 21,
        strength: 0,
        defence: 9,
        levelReq: 90,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 345,
        slot: "body",
        accuracy: 35,
        strength: 0,
        defence: 17,
        levelReq: 90,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 346,
        slot: "legs",
        accuracy: 27,
        strength: 0,
        defence: 14,
        levelReq: 90,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 146,
        slot: "weapon",
        accuracy: 7,
        strength: 6,
        defence: 0,
        speed: 5,
        ranged: true,
        levelReq: 1,
        needs: "ranged",
      },
      {
        itemId: 147,
        slot: "weapon",
        accuracy: 15,
        strength: 13,
        defence: 0,
        speed: 5,
        ranged: true,
        levelReq: 15,
        needs: "ranged",
      },
      {
        itemId: 148,
        slot: "weapon",
        accuracy: 24,
        strength: 22,
        defence: 0,
        speed: 5,
        ranged: true,
        levelReq: 30,
        needs: "ranged",
      },
      {
        itemId: 149,
        slot: "weapon",
        accuracy: 36,
        strength: 33,
        defence: 0,
        speed: 5,
        ranged: true,
        levelReq: 45,
        needs: "ranged",
      },
      {
        itemId: 150,
        slot: "weapon",
        accuracy: 50,
        strength: 46,
        defence: 0,
        speed: 5,
        ranged: true,
        levelReq: 60,
        needs: "ranged",
      },
      {
        itemId: 151,
        slot: "weapon",
        accuracy: 66,
        strength: 62,
        defence: 0,
        speed: 5,
        ranged: true,
        levelReq: 75,
        needs: "ranged",
      },
      {
        itemId: 1110,
        slot: "weapon",
        accuracy: 8,
        strength: 7,
        defence: 0,
        speed: 4,
        levelReq: 1,
        needs: "melee",
      },
      {
        itemId: 2110,
        slot: "weapon",
        accuracy: 10,
        strength: 8,
        defence: 0,
        speed: 4,
        levelReq: 1,
        needs: "melee",
      },
      {
        itemId: 3110,
        slot: "weapon",
        accuracy: 13,
        strength: 11,
        defence: 0,
        speed: 4,
        levelReq: 1,
        needs: "melee",
      },
      {
        itemId: 4110,
        slot: "weapon",
        accuracy: 18,
        strength: 15,
        defence: 0,
        speed: 4,
        levelReq: 1,
        needs: "melee",
      },
      {
        itemId: 1111,
        slot: "weapon",
        accuracy: 18,
        strength: 16,
        defence: 0,
        speed: 4,
        levelReq: 15,
        needs: "melee",
      },
      {
        itemId: 2111,
        slot: "weapon",
        accuracy: 22,
        strength: 19,
        defence: 0,
        speed: 4,
        levelReq: 15,
        needs: "melee",
      },
      {
        itemId: 3111,
        slot: "weapon",
        accuracy: 31,
        strength: 26,
        defence: 0,
        speed: 4,
        levelReq: 15,
        needs: "melee",
      },
      {
        itemId: 4111,
        slot: "weapon",
        accuracy: 42,
        strength: 36,
        defence: 0,
        speed: 4,
        levelReq: 15,
        needs: "melee",
      },
      {
        itemId: 1112,
        slot: "weapon",
        accuracy: 31,
        strength: 27,
        defence: 0,
        speed: 4,
        levelReq: 30,
        needs: "melee",
      },
      {
        itemId: 2112,
        slot: "weapon",
        accuracy: 38,
        strength: 34,
        defence: 0,
        speed: 4,
        levelReq: 30,
        needs: "melee",
      },
      {
        itemId: 3112,
        slot: "weapon",
        accuracy: 53,
        strength: 46,
        defence: 0,
        speed: 4,
        levelReq: 30,
        needs: "melee",
      },
      {
        itemId: 4112,
        slot: "weapon",
        accuracy: 72,
        strength: 63,
        defence: 0,
        speed: 4,
        levelReq: 30,
        needs: "melee",
      },
      {
        itemId: 1113,
        slot: "weapon",
        accuracy: 49,
        strength: 44,
        defence: 0,
        speed: 4,
        levelReq: 60,
        needs: "melee",
      },
      {
        itemId: 2113,
        slot: "weapon",
        accuracy: 61,
        strength: 54,
        defence: 0,
        speed: 4,
        levelReq: 60,
        needs: "melee",
      },
      {
        itemId: 3113,
        slot: "weapon",
        accuracy: 84,
        strength: 75,
        defence: 0,
        speed: 4,
        levelReq: 60,
        needs: "melee",
      },
      {
        itemId: 4113,
        slot: "weapon",
        accuracy: 114,
        strength: 102,
        defence: 0,
        speed: 4,
        levelReq: 60,
        needs: "melee",
      },
      {
        itemId: 1114,
        slot: "weapon",
        accuracy: 73,
        strength: 65,
        defence: 0,
        speed: 4,
        levelReq: 85,
        needs: "melee",
      },
      {
        itemId: 2114,
        slot: "weapon",
        accuracy: 90,
        strength: 80,
        defence: 0,
        speed: 4,
        levelReq: 85,
        needs: "melee",
      },
      {
        itemId: 3114,
        slot: "weapon",
        accuracy: 123,
        strength: 110,
        defence: 0,
        speed: 4,
        levelReq: 85,
        needs: "melee",
      },
      {
        itemId: 4114,
        slot: "weapon",
        accuracy: 168,
        strength: 150,
        defence: 0,
        speed: 4,
        levelReq: 85,
        needs: "melee",
      },
      {
        itemId: 1390,
        slot: "weapon",
        accuracy: 9,
        strength: 7,
        defence: 0,
        speed: 4,
        twoHanded: true,
        levelReq: 1,
        needs: "melee",
      },
      {
        itemId: 2390,
        slot: "weapon",
        accuracy: 11,
        strength: 8,
        defence: 0,
        speed: 4,
        twoHanded: true,
        levelReq: 1,
        needs: "melee",
      },
      {
        itemId: 3390,
        slot: "weapon",
        accuracy: 15,
        strength: 11,
        defence: 0,
        speed: 4,
        twoHanded: true,
        levelReq: 1,
        needs: "melee",
      },
      {
        itemId: 4390,
        slot: "weapon",
        accuracy: 21,
        strength: 15,
        defence: 0,
        speed: 4,
        twoHanded: true,
        levelReq: 1,
        needs: "melee",
      },
      {
        itemId: 1391,
        slot: "weapon",
        accuracy: 21,
        strength: 20,
        defence: 0,
        speed: 4,
        twoHanded: true,
        levelReq: 15,
        needs: "melee",
      },
      {
        itemId: 2391,
        slot: "weapon",
        accuracy: 26,
        strength: 24,
        defence: 0,
        speed: 4,
        twoHanded: true,
        levelReq: 15,
        needs: "melee",
      },
      {
        itemId: 3391,
        slot: "weapon",
        accuracy: 35,
        strength: 33,
        defence: 0,
        speed: 4,
        twoHanded: true,
        levelReq: 15,
        needs: "melee",
      },
      {
        itemId: 4391,
        slot: "weapon",
        accuracy: 48,
        strength: 45,
        defence: 0,
        speed: 4,
        twoHanded: true,
        levelReq: 15,
        needs: "melee",
      },
      {
        itemId: 1392,
        slot: "weapon",
        accuracy: 35,
        strength: 31,
        defence: 0,
        speed: 4,
        twoHanded: true,
        levelReq: 30,
        needs: "melee",
      },
      {
        itemId: 2392,
        slot: "weapon",
        accuracy: 43,
        strength: 38,
        defence: 0,
        speed: 4,
        twoHanded: true,
        levelReq: 30,
        needs: "melee",
      },
      {
        itemId: 3392,
        slot: "weapon",
        accuracy: 59,
        strength: 53,
        defence: 0,
        speed: 4,
        twoHanded: true,
        levelReq: 30,
        needs: "melee",
      },
      {
        itemId: 4392,
        slot: "weapon",
        accuracy: 81,
        strength: 72,
        defence: 0,
        speed: 4,
        twoHanded: true,
        levelReq: 30,
        needs: "melee",
      },
      {
        itemId: 1393,
        slot: "weapon",
        accuracy: 69,
        strength: 62,
        defence: 0,
        speed: 4,
        twoHanded: true,
        levelReq: 60,
        needs: "melee",
      },
      {
        itemId: 2393,
        slot: "weapon",
        accuracy: 85,
        strength: 77,
        defence: 0,
        speed: 4,
        twoHanded: true,
        levelReq: 60,
        needs: "melee",
      },
      {
        itemId: 3393,
        slot: "weapon",
        accuracy: 117,
        strength: 106,
        defence: 0,
        speed: 4,
        twoHanded: true,
        levelReq: 60,
        needs: "melee",
      },
      {
        itemId: 4393,
        slot: "weapon",
        accuracy: 159,
        strength: 144,
        defence: 0,
        speed: 4,
        twoHanded: true,
        levelReq: 60,
        needs: "melee",
      },
      {
        itemId: 1394,
        slot: "weapon",
        accuracy: 94,
        strength: 85,
        defence: 0,
        speed: 4,
        twoHanded: true,
        levelReq: 85,
        needs: "melee",
      },
      {
        itemId: 2394,
        slot: "weapon",
        accuracy: 115,
        strength: 104,
        defence: 0,
        speed: 4,
        twoHanded: true,
        levelReq: 85,
        needs: "melee",
      },
      {
        itemId: 3394,
        slot: "weapon",
        accuracy: 158,
        strength: 143,
        defence: 0,
        speed: 4,
        twoHanded: true,
        levelReq: 85,
        needs: "melee",
      },
      {
        itemId: 4394,
        slot: "weapon",
        accuracy: 216,
        strength: 195,
        defence: 0,
        speed: 4,
        twoHanded: true,
        levelReq: 85,
        needs: "melee",
      },
      {
        itemId: 1395,
        slot: "weapon",
        accuracy: 104,
        strength: 94,
        defence: 0,
        speed: 4,
        twoHanded: true,
        levelReq: 99,
        needs: "melee",
      },
      {
        itemId: 2395,
        slot: "weapon",
        accuracy: 128,
        strength: 115,
        defence: 0,
        speed: 4,
        twoHanded: true,
        levelReq: 99,
        needs: "melee",
      },
      {
        itemId: 3395,
        slot: "weapon",
        accuracy: 176,
        strength: 158,
        defence: 0,
        speed: 4,
        twoHanded: true,
        levelReq: 99,
        needs: "melee",
      },
      {
        itemId: 4395,
        slot: "weapon",
        accuracy: 240,
        strength: 216,
        defence: 0,
        speed: 4,
        twoHanded: true,
        levelReq: 99,
        needs: "melee",
      },
      {
        itemId: 1115,
        slot: "shield",
        accuracy: 0,
        strength: 4,
        defence: 5,
        levelReq: 1,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 2115,
        slot: "shield",
        accuracy: 0,
        strength: 5,
        defence: 6,
        levelReq: 1,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 3115,
        slot: "shield",
        accuracy: 0,
        strength: 7,
        defence: 9,
        levelReq: 1,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 4115,
        slot: "shield",
        accuracy: 0,
        strength: 9,
        defence: 12,
        levelReq: 1,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 1116,
        slot: "shield",
        accuracy: 0,
        strength: 12,
        defence: 12,
        levelReq: 15,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 2116,
        slot: "shield",
        accuracy: 0,
        strength: 14,
        defence: 14,
        levelReq: 15,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 3116,
        slot: "shield",
        accuracy: 0,
        strength: 20,
        defence: 20,
        levelReq: 15,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 4116,
        slot: "shield",
        accuracy: 0,
        strength: 27,
        defence: 27,
        levelReq: 15,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 1117,
        slot: "shield",
        accuracy: 0,
        strength: 18,
        defence: 21,
        levelReq: 30,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 2117,
        slot: "shield",
        accuracy: 0,
        strength: 22,
        defence: 26,
        levelReq: 30,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 3117,
        slot: "shield",
        accuracy: 0,
        strength: 31,
        defence: 35,
        levelReq: 30,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 4117,
        slot: "shield",
        accuracy: 0,
        strength: 42,
        defence: 48,
        levelReq: 30,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 1118,
        slot: "shield",
        accuracy: 0,
        strength: 46,
        defence: 33,
        levelReq: 60,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 2118,
        slot: "shield",
        accuracy: 0,
        strength: 56,
        defence: 40,
        levelReq: 60,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 3118,
        slot: "shield",
        accuracy: 0,
        strength: 77,
        defence: 55,
        levelReq: 60,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 4118,
        slot: "shield",
        accuracy: 0,
        strength: 105,
        defence: 75,
        levelReq: 60,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 1119,
        slot: "shield",
        accuracy: 0,
        strength: 56,
        defence: 48,
        levelReq: 85,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 2119,
        slot: "shield",
        accuracy: 0,
        strength: 69,
        defence: 59,
        levelReq: 85,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 3119,
        slot: "shield",
        accuracy: 0,
        strength: 95,
        defence: 81,
        levelReq: 85,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 4119,
        slot: "shield",
        accuracy: 0,
        strength: 129,
        defence: 111,
        levelReq: 85,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 1329,
        slot: "shield",
        accuracy: 3,
        strength: 1,
        defence: 0,
        ranged: true,
        levelReq: 1,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 2329,
        slot: "shield",
        accuracy: 3,
        strength: 2,
        defence: 0,
        ranged: true,
        levelReq: 1,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 3329,
        slot: "shield",
        accuracy: 4,
        strength: 2,
        defence: 0,
        ranged: true,
        levelReq: 1,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 4329,
        slot: "shield",
        accuracy: 6,
        strength: 3,
        defence: 0,
        ranged: true,
        levelReq: 1,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 1330,
        slot: "shield",
        accuracy: 5,
        strength: 4,
        defence: 0,
        ranged: true,
        levelReq: 15,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 2330,
        slot: "shield",
        accuracy: 6,
        strength: 5,
        defence: 0,
        ranged: true,
        levelReq: 15,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 3330,
        slot: "shield",
        accuracy: 9,
        strength: 7,
        defence: 0,
        ranged: true,
        levelReq: 15,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 4330,
        slot: "shield",
        accuracy: 12,
        strength: 9,
        defence: 0,
        ranged: true,
        levelReq: 15,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 1331,
        slot: "shield",
        accuracy: 9,
        strength: 7,
        defence: 0,
        ranged: true,
        levelReq: 30,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 2331,
        slot: "shield",
        accuracy: 11,
        strength: 8,
        defence: 0,
        ranged: true,
        levelReq: 30,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 3331,
        slot: "shield",
        accuracy: 15,
        strength: 11,
        defence: 0,
        ranged: true,
        levelReq: 30,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 4331,
        slot: "shield",
        accuracy: 21,
        strength: 15,
        defence: 0,
        ranged: true,
        levelReq: 30,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 1332,
        slot: "shield",
        accuracy: 14,
        strength: 10,
        defence: 0,
        ranged: true,
        levelReq: 60,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 2332,
        slot: "shield",
        accuracy: 18,
        strength: 13,
        defence: 0,
        ranged: true,
        levelReq: 60,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 3332,
        slot: "shield",
        accuracy: 24,
        strength: 18,
        defence: 0,
        ranged: true,
        levelReq: 60,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 4332,
        slot: "shield",
        accuracy: 33,
        strength: 24,
        defence: 0,
        ranged: true,
        levelReq: 60,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 1333,
        slot: "shield",
        accuracy: 21,
        strength: 16,
        defence: 0,
        ranged: true,
        levelReq: 85,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 2333,
        slot: "shield",
        accuracy: 26,
        strength: 19,
        defence: 0,
        ranged: true,
        levelReq: 85,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 3333,
        slot: "shield",
        accuracy: 35,
        strength: 26,
        defence: 0,
        ranged: true,
        levelReq: 85,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 4333,
        slot: "shield",
        accuracy: 48,
        strength: 36,
        defence: 0,
        ranged: true,
        levelReq: 85,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 1347,
        slot: "shield",
        accuracy: 26,
        strength: 20,
        defence: 0,
        ranged: true,
        levelReq: 95,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 2347,
        slot: "shield",
        accuracy: 32,
        strength: 24,
        defence: 0,
        ranged: true,
        levelReq: 95,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 3347,
        slot: "shield",
        accuracy: 44,
        strength: 33,
        defence: 0,
        ranged: true,
        levelReq: 95,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 4347,
        slot: "shield",
        accuracy: 60,
        strength: 45,
        defence: 0,
        ranged: true,
        levelReq: 95,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 1348,
        slot: "shield",
        accuracy: 31,
        strength: 23,
        defence: 0,
        ranged: true,
        levelReq: 99,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 2348,
        slot: "shield",
        accuracy: 38,
        strength: 29,
        defence: 0,
        ranged: true,
        levelReq: 99,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 3348,
        slot: "shield",
        accuracy: 53,
        strength: 40,
        defence: 0,
        ranged: true,
        levelReq: 99,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 4348,
        slot: "shield",
        accuracy: 72,
        strength: 54,
        defence: 0,
        ranged: true,
        levelReq: 99,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 1334,
        slot: "shield",
        accuracy: 3,
        strength: 1,
        defence: 0,
        magic: true,
        levelReq: 1,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 2334,
        slot: "shield",
        accuracy: 3,
        strength: 2,
        defence: 0,
        magic: true,
        levelReq: 1,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 3334,
        slot: "shield",
        accuracy: 4,
        strength: 2,
        defence: 0,
        magic: true,
        levelReq: 1,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 4334,
        slot: "shield",
        accuracy: 6,
        strength: 3,
        defence: 0,
        magic: true,
        levelReq: 1,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 1335,
        slot: "shield",
        accuracy: 7,
        strength: 5,
        defence: 0,
        magic: true,
        levelReq: 25,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 2335,
        slot: "shield",
        accuracy: 8,
        strength: 6,
        defence: 0,
        magic: true,
        levelReq: 25,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 3335,
        slot: "shield",
        accuracy: 11,
        strength: 9,
        defence: 0,
        magic: true,
        levelReq: 25,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 4335,
        slot: "shield",
        accuracy: 15,
        strength: 12,
        defence: 0,
        magic: true,
        levelReq: 25,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 1336,
        slot: "shield",
        accuracy: 12,
        strength: 9,
        defence: 0,
        magic: true,
        levelReq: 50,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 2336,
        slot: "shield",
        accuracy: 14,
        strength: 11,
        defence: 0,
        magic: true,
        levelReq: 50,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 3336,
        slot: "shield",
        accuracy: 20,
        strength: 15,
        defence: 0,
        magic: true,
        levelReq: 50,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 4336,
        slot: "shield",
        accuracy: 27,
        strength: 21,
        defence: 0,
        magic: true,
        levelReq: 50,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 1337,
        slot: "shield",
        accuracy: 18,
        strength: 14,
        defence: 0,
        magic: true,
        levelReq: 75,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 2337,
        slot: "shield",
        accuracy: 22,
        strength: 18,
        defence: 0,
        magic: true,
        levelReq: 75,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 3337,
        slot: "shield",
        accuracy: 31,
        strength: 24,
        defence: 0,
        magic: true,
        levelReq: 75,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 4337,
        slot: "shield",
        accuracy: 42,
        strength: 33,
        defence: 0,
        magic: true,
        levelReq: 75,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 1349,
        slot: "shield",
        accuracy: 23,
        strength: 18,
        defence: 0,
        magic: true,
        levelReq: 90,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 2349,
        slot: "shield",
        accuracy: 29,
        strength: 22,
        defence: 0,
        magic: true,
        levelReq: 90,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 3349,
        slot: "shield",
        accuracy: 40,
        strength: 31,
        defence: 0,
        magic: true,
        levelReq: 90,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 4349,
        slot: "shield",
        accuracy: 54,
        strength: 42,
        defence: 0,
        magic: true,
        levelReq: 90,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 1120,
        slot: "helmet",
        accuracy: 1,
        strength: 0,
        defence: 4,
        levelReq: 1,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 2120,
        slot: "helmet",
        accuracy: 2,
        strength: 0,
        defence: 5,
        levelReq: 1,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 3120,
        slot: "helmet",
        accuracy: 2,
        strength: 0,
        defence: 7,
        levelReq: 1,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 4120,
        slot: "helmet",
        accuracy: 3,
        strength: 0,
        defence: 9,
        levelReq: 1,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 1121,
        slot: "helmet",
        accuracy: 3,
        strength: 0,
        defence: 9,
        levelReq: 15,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 2121,
        slot: "helmet",
        accuracy: 3,
        strength: 0,
        defence: 11,
        levelReq: 15,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 3121,
        slot: "helmet",
        accuracy: 4,
        strength: 0,
        defence: 15,
        levelReq: 15,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 4121,
        slot: "helmet",
        accuracy: 6,
        strength: 0,
        defence: 21,
        levelReq: 15,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 1122,
        slot: "helmet",
        accuracy: 5,
        strength: 0,
        defence: 16,
        levelReq: 30,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 2122,
        slot: "helmet",
        accuracy: 6,
        strength: 0,
        defence: 19,
        levelReq: 30,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 3122,
        slot: "helmet",
        accuracy: 9,
        strength: 0,
        defence: 26,
        levelReq: 30,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 4122,
        slot: "helmet",
        accuracy: 12,
        strength: 0,
        defence: 36,
        levelReq: 30,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 1123,
        slot: "helmet",
        accuracy: 9,
        strength: 0,
        defence: 25,
        levelReq: 60,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 2123,
        slot: "helmet",
        accuracy: 11,
        strength: 0,
        defence: 30,
        levelReq: 60,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 3123,
        slot: "helmet",
        accuracy: 15,
        strength: 0,
        defence: 42,
        levelReq: 60,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 4123,
        slot: "helmet",
        accuracy: 21,
        strength: 0,
        defence: 57,
        levelReq: 60,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 1124,
        slot: "helmet",
        accuracy: 13,
        strength: 0,
        defence: 36,
        levelReq: 85,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 2124,
        slot: "helmet",
        accuracy: 16,
        strength: 0,
        defence: 45,
        levelReq: 85,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 3124,
        slot: "helmet",
        accuracy: 22,
        strength: 0,
        defence: 62,
        levelReq: 85,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 4124,
        slot: "helmet",
        accuracy: 30,
        strength: 0,
        defence: 84,
        levelReq: 85,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 1125,
        slot: "body",
        accuracy: 3,
        strength: 0,
        defence: 8,
        levelReq: 1,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 2125,
        slot: "body",
        accuracy: 3,
        strength: 0,
        defence: 10,
        levelReq: 1,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 3125,
        slot: "body",
        accuracy: 4,
        strength: 0,
        defence: 13,
        levelReq: 1,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 4125,
        slot: "body",
        accuracy: 6,
        strength: 0,
        defence: 18,
        levelReq: 1,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 1126,
        slot: "body",
        accuracy: 7,
        strength: 0,
        defence: 18,
        levelReq: 15,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 2126,
        slot: "body",
        accuracy: 8,
        strength: 0,
        defence: 22,
        levelReq: 15,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 3126,
        slot: "body",
        accuracy: 11,
        strength: 0,
        defence: 31,
        levelReq: 15,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 4126,
        slot: "body",
        accuracy: 15,
        strength: 0,
        defence: 42,
        levelReq: 15,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 1127,
        slot: "body",
        accuracy: 10,
        strength: 0,
        defence: 31,
        levelReq: 30,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 2127,
        slot: "body",
        accuracy: 13,
        strength: 0,
        defence: 38,
        levelReq: 30,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 3127,
        slot: "body",
        accuracy: 18,
        strength: 0,
        defence: 53,
        levelReq: 30,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 4127,
        slot: "body",
        accuracy: 24,
        strength: 0,
        defence: 72,
        levelReq: 30,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 1128,
        slot: "body",
        accuracy: 17,
        strength: 0,
        defence: 49,
        levelReq: 60,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 2128,
        slot: "body",
        accuracy: 21,
        strength: 0,
        defence: 61,
        levelReq: 60,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 3128,
        slot: "body",
        accuracy: 29,
        strength: 0,
        defence: 84,
        levelReq: 60,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 4128,
        slot: "body",
        accuracy: 39,
        strength: 0,
        defence: 114,
        levelReq: 60,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 1129,
        slot: "body",
        accuracy: 26,
        strength: 0,
        defence: 73,
        levelReq: 85,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 2129,
        slot: "body",
        accuracy: 32,
        strength: 0,
        defence: 90,
        levelReq: 85,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 3129,
        slot: "body",
        accuracy: 44,
        strength: 0,
        defence: 123,
        levelReq: 85,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 4129,
        slot: "body",
        accuracy: 60,
        strength: 0,
        defence: 168,
        levelReq: 85,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 1130,
        slot: "legs",
        accuracy: 3,
        strength: 0,
        defence: 7,
        levelReq: 1,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 2130,
        slot: "legs",
        accuracy: 3,
        strength: 0,
        defence: 8,
        levelReq: 1,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 3130,
        slot: "legs",
        accuracy: 4,
        strength: 0,
        defence: 11,
        levelReq: 1,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 4130,
        slot: "legs",
        accuracy: 6,
        strength: 0,
        defence: 15,
        levelReq: 1,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 1131,
        slot: "legs",
        accuracy: 5,
        strength: 0,
        defence: 14,
        levelReq: 15,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 2131,
        slot: "legs",
        accuracy: 6,
        strength: 0,
        defence: 18,
        levelReq: 15,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 3131,
        slot: "legs",
        accuracy: 9,
        strength: 0,
        defence: 24,
        levelReq: 15,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 4131,
        slot: "legs",
        accuracy: 12,
        strength: 0,
        defence: 33,
        levelReq: 15,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 1132,
        slot: "legs",
        accuracy: 9,
        strength: 0,
        defence: 25,
        levelReq: 30,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 2132,
        slot: "legs",
        accuracy: 11,
        strength: 0,
        defence: 30,
        levelReq: 30,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 3132,
        slot: "legs",
        accuracy: 15,
        strength: 0,
        defence: 42,
        levelReq: 30,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 4132,
        slot: "legs",
        accuracy: 21,
        strength: 0,
        defence: 57,
        levelReq: 30,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 1133,
        slot: "legs",
        accuracy: 13,
        strength: 0,
        defence: 39,
        levelReq: 60,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 2133,
        slot: "legs",
        accuracy: 16,
        strength: 0,
        defence: 48,
        levelReq: 60,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 3133,
        slot: "legs",
        accuracy: 22,
        strength: 0,
        defence: 66,
        levelReq: 60,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 4133,
        slot: "legs",
        accuracy: 30,
        strength: 0,
        defence: 90,
        levelReq: 60,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 1134,
        slot: "legs",
        accuracy: 20,
        strength: 0,
        defence: 57,
        levelReq: 85,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 2134,
        slot: "legs",
        accuracy: 24,
        strength: 0,
        defence: 70,
        levelReq: 85,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 3134,
        slot: "legs",
        accuracy: 33,
        strength: 0,
        defence: 97,
        levelReq: 85,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 4134,
        slot: "legs",
        accuracy: 45,
        strength: 0,
        defence: 132,
        levelReq: 85,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 1350,
        slot: "weapon",
        accuracy: 91,
        strength: 82,
        defence: 0,
        speed: 4,
        levelReq: 99,
        needs: "melee",
      },
      {
        itemId: 2350,
        slot: "weapon",
        accuracy: 112,
        strength: 101,
        defence: 0,
        speed: 4,
        levelReq: 99,
        needs: "melee",
      },
      {
        itemId: 3350,
        slot: "weapon",
        accuracy: 154,
        strength: 139,
        defence: 0,
        speed: 4,
        levelReq: 99,
        needs: "melee",
      },
      {
        itemId: 4350,
        slot: "weapon",
        accuracy: 210,
        strength: 189,
        defence: 0,
        speed: 4,
        levelReq: 99,
        needs: "melee",
      },
      {
        itemId: 1351,
        slot: "shield",
        accuracy: 0,
        strength: 56,
        defence: 60,
        levelReq: 99,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 2351,
        slot: "shield",
        accuracy: 0,
        strength: 69,
        defence: 74,
        levelReq: 99,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 3351,
        slot: "shield",
        accuracy: 0,
        strength: 95,
        defence: 101,
        levelReq: 99,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 4351,
        slot: "shield",
        accuracy: 0,
        strength: 129,
        defence: 138,
        levelReq: 99,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 1352,
        slot: "helmet",
        accuracy: 16,
        strength: 0,
        defence: 46,
        levelReq: 99,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 2352,
        slot: "helmet",
        accuracy: 19,
        strength: 0,
        defence: 56,
        levelReq: 99,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 3352,
        slot: "helmet",
        accuracy: 26,
        strength: 0,
        defence: 77,
        levelReq: 99,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 4352,
        slot: "helmet",
        accuracy: 36,
        strength: 0,
        defence: 105,
        levelReq: 99,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 1353,
        slot: "body",
        accuracy: 31,
        strength: 0,
        defence: 91,
        levelReq: 99,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 2353,
        slot: "body",
        accuracy: 38,
        strength: 0,
        defence: 112,
        levelReq: 99,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 3353,
        slot: "body",
        accuracy: 53,
        strength: 0,
        defence: 154,
        levelReq: 99,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 4353,
        slot: "body",
        accuracy: 72,
        strength: 0,
        defence: 210,
        levelReq: 99,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 1354,
        slot: "legs",
        accuracy: 25,
        strength: 0,
        defence: 72,
        levelReq: 99,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 2354,
        slot: "legs",
        accuracy: 30,
        strength: 0,
        defence: 88,
        levelReq: 99,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 3354,
        slot: "legs",
        accuracy: 42,
        strength: 0,
        defence: 121,
        levelReq: 99,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 4354,
        slot: "legs",
        accuracy: 57,
        strength: 0,
        defence: 165,
        levelReq: 99,
        needs: "melee",
        style: "melee",
      },
      {
        itemId: 1260,
        slot: "helmet",
        accuracy: 1,
        strength: 0,
        defence: 3,
        levelReq: 1,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 2260,
        slot: "helmet",
        accuracy: 2,
        strength: 0,
        defence: 3,
        levelReq: 1,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 3260,
        slot: "helmet",
        accuracy: 2,
        strength: 0,
        defence: 4,
        levelReq: 1,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 4260,
        slot: "helmet",
        accuracy: 3,
        strength: 0,
        defence: 6,
        levelReq: 1,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 1261,
        slot: "body",
        accuracy: 3,
        strength: 0,
        defence: 5,
        levelReq: 1,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 2261,
        slot: "body",
        accuracy: 3,
        strength: 0,
        defence: 6,
        levelReq: 1,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 3261,
        slot: "body",
        accuracy: 4,
        strength: 0,
        defence: 9,
        levelReq: 1,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 4261,
        slot: "body",
        accuracy: 6,
        strength: 0,
        defence: 12,
        levelReq: 1,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 1262,
        slot: "legs",
        accuracy: 3,
        strength: 0,
        defence: 4,
        levelReq: 1,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 2262,
        slot: "legs",
        accuracy: 3,
        strength: 0,
        defence: 5,
        levelReq: 1,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 3262,
        slot: "legs",
        accuracy: 4,
        strength: 0,
        defence: 7,
        levelReq: 1,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 4262,
        slot: "legs",
        accuracy: 6,
        strength: 0,
        defence: 9,
        levelReq: 1,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 1263,
        slot: "helmet",
        accuracy: 4,
        strength: 0,
        defence: 5,
        levelReq: 15,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 2263,
        slot: "helmet",
        accuracy: 5,
        strength: 0,
        defence: 6,
        levelReq: 15,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 3263,
        slot: "helmet",
        accuracy: 7,
        strength: 0,
        defence: 9,
        levelReq: 15,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 4263,
        slot: "helmet",
        accuracy: 9,
        strength: 0,
        defence: 12,
        levelReq: 15,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 1264,
        slot: "body",
        accuracy: 7,
        strength: 0,
        defence: 10,
        levelReq: 15,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 2264,
        slot: "body",
        accuracy: 8,
        strength: 0,
        defence: 13,
        levelReq: 15,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 3264,
        slot: "body",
        accuracy: 11,
        strength: 0,
        defence: 18,
        levelReq: 15,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 4264,
        slot: "body",
        accuracy: 15,
        strength: 0,
        defence: 24,
        levelReq: 15,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 1265,
        slot: "legs",
        accuracy: 5,
        strength: 0,
        defence: 9,
        levelReq: 15,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 2265,
        slot: "legs",
        accuracy: 6,
        strength: 0,
        defence: 11,
        levelReq: 15,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 3265,
        slot: "legs",
        accuracy: 9,
        strength: 0,
        defence: 15,
        levelReq: 15,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 4265,
        slot: "legs",
        accuracy: 12,
        strength: 0,
        defence: 21,
        levelReq: 15,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 1266,
        slot: "helmet",
        accuracy: 7,
        strength: 0,
        defence: 9,
        levelReq: 30,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 2266,
        slot: "helmet",
        accuracy: 8,
        strength: 0,
        defence: 11,
        levelReq: 30,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 3266,
        slot: "helmet",
        accuracy: 11,
        strength: 0,
        defence: 15,
        levelReq: 30,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 4266,
        slot: "helmet",
        accuracy: 15,
        strength: 0,
        defence: 21,
        levelReq: 30,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 1267,
        slot: "body",
        accuracy: 10,
        strength: 0,
        defence: 18,
        levelReq: 30,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 2267,
        slot: "body",
        accuracy: 13,
        strength: 0,
        defence: 22,
        levelReq: 30,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 3267,
        slot: "body",
        accuracy: 18,
        strength: 0,
        defence: 31,
        levelReq: 30,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 4267,
        slot: "body",
        accuracy: 24,
        strength: 0,
        defence: 42,
        levelReq: 30,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 1268,
        slot: "legs",
        accuracy: 8,
        strength: 0,
        defence: 14,
        levelReq: 30,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 2268,
        slot: "legs",
        accuracy: 10,
        strength: 0,
        defence: 18,
        levelReq: 30,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 3268,
        slot: "legs",
        accuracy: 13,
        strength: 0,
        defence: 24,
        levelReq: 30,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 4268,
        slot: "legs",
        accuracy: 18,
        strength: 0,
        defence: 33,
        levelReq: 30,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 1269,
        slot: "helmet",
        accuracy: 10,
        strength: 0,
        defence: 14,
        levelReq: 60,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 2269,
        slot: "helmet",
        accuracy: 13,
        strength: 0,
        defence: 18,
        levelReq: 60,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 3269,
        slot: "helmet",
        accuracy: 18,
        strength: 0,
        defence: 24,
        levelReq: 60,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 4269,
        slot: "helmet",
        accuracy: 24,
        strength: 0,
        defence: 33,
        levelReq: 60,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 1270,
        slot: "body",
        accuracy: 17,
        strength: 0,
        defence: 30,
        levelReq: 60,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 2270,
        slot: "body",
        accuracy: 21,
        strength: 0,
        defence: 37,
        levelReq: 60,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 3270,
        slot: "body",
        accuracy: 29,
        strength: 0,
        defence: 51,
        levelReq: 60,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 4270,
        slot: "body",
        accuracy: 39,
        strength: 0,
        defence: 69,
        levelReq: 60,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 1271,
        slot: "legs",
        accuracy: 13,
        strength: 0,
        defence: 23,
        levelReq: 60,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 2271,
        slot: "legs",
        accuracy: 16,
        strength: 0,
        defence: 29,
        levelReq: 60,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 3271,
        slot: "legs",
        accuracy: 22,
        strength: 0,
        defence: 40,
        levelReq: 60,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 4271,
        slot: "legs",
        accuracy: 30,
        strength: 0,
        defence: 54,
        levelReq: 60,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 1272,
        slot: "helmet",
        accuracy: 16,
        strength: 0,
        defence: 22,
        levelReq: 85,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 2272,
        slot: "helmet",
        accuracy: 19,
        strength: 0,
        defence: 27,
        levelReq: 85,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 3272,
        slot: "helmet",
        accuracy: 26,
        strength: 0,
        defence: 37,
        levelReq: 85,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 4272,
        slot: "helmet",
        accuracy: 36,
        strength: 0,
        defence: 51,
        levelReq: 85,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 1273,
        slot: "body",
        accuracy: 26,
        strength: 0,
        defence: 44,
        levelReq: 85,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 2273,
        slot: "body",
        accuracy: 32,
        strength: 0,
        defence: 54,
        levelReq: 85,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 3273,
        slot: "body",
        accuracy: 44,
        strength: 0,
        defence: 75,
        levelReq: 85,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 4273,
        slot: "body",
        accuracy: 60,
        strength: 0,
        defence: 102,
        levelReq: 85,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 1274,
        slot: "legs",
        accuracy: 20,
        strength: 0,
        defence: 34,
        levelReq: 85,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 2274,
        slot: "legs",
        accuracy: 24,
        strength: 0,
        defence: 42,
        levelReq: 85,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 3274,
        slot: "legs",
        accuracy: 33,
        strength: 0,
        defence: 57,
        levelReq: 85,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 4274,
        slot: "legs",
        accuracy: 45,
        strength: 0,
        defence: 78,
        levelReq: 85,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 1338,
        slot: "helmet",
        accuracy: 20,
        strength: 0,
        defence: 27,
        levelReq: 95,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 2338,
        slot: "helmet",
        accuracy: 24,
        strength: 0,
        defence: 34,
        levelReq: 95,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 3338,
        slot: "helmet",
        accuracy: 33,
        strength: 0,
        defence: 46,
        levelReq: 95,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 4338,
        slot: "helmet",
        accuracy: 45,
        strength: 0,
        defence: 63,
        levelReq: 95,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 1339,
        slot: "body",
        accuracy: 33,
        strength: 0,
        defence: 55,
        levelReq: 95,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 2339,
        slot: "body",
        accuracy: 40,
        strength: 0,
        defence: 67,
        levelReq: 95,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 3339,
        slot: "body",
        accuracy: 55,
        strength: 0,
        defence: 92,
        levelReq: 95,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 4339,
        slot: "body",
        accuracy: 75,
        strength: 0,
        defence: 126,
        levelReq: 95,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 1340,
        slot: "legs",
        accuracy: 25,
        strength: 0,
        defence: 42,
        levelReq: 95,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 2340,
        slot: "legs",
        accuracy: 30,
        strength: 0,
        defence: 51,
        levelReq: 95,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 3340,
        slot: "legs",
        accuracy: 42,
        strength: 0,
        defence: 70,
        levelReq: 95,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 4340,
        slot: "legs",
        accuracy: 57,
        strength: 0,
        defence: 96,
        levelReq: 95,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 1341,
        slot: "helmet",
        accuracy: 23,
        strength: 0,
        defence: 33,
        levelReq: 99,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 2341,
        slot: "helmet",
        accuracy: 29,
        strength: 0,
        defence: 40,
        levelReq: 99,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 3341,
        slot: "helmet",
        accuracy: 40,
        strength: 0,
        defence: 55,
        levelReq: 99,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 4341,
        slot: "helmet",
        accuracy: 54,
        strength: 0,
        defence: 75,
        levelReq: 99,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 1342,
        slot: "body",
        accuracy: 39,
        strength: 0,
        defence: 65,
        levelReq: 99,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 2342,
        slot: "body",
        accuracy: 48,
        strength: 0,
        defence: 80,
        levelReq: 99,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 3342,
        slot: "body",
        accuracy: 66,
        strength: 0,
        defence: 110,
        levelReq: 99,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 4342,
        slot: "body",
        accuracy: 90,
        strength: 0,
        defence: 150,
        levelReq: 99,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 1343,
        slot: "legs",
        accuracy: 29,
        strength: 0,
        defence: 49,
        levelReq: 99,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 2343,
        slot: "legs",
        accuracy: 35,
        strength: 0,
        defence: 61,
        levelReq: 99,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 3343,
        slot: "legs",
        accuracy: 48,
        strength: 0,
        defence: 84,
        levelReq: 99,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 4343,
        slot: "legs",
        accuracy: 66,
        strength: 0,
        defence: 114,
        levelReq: 99,
        needs: "ranged",
        style: "ranged",
      },
      {
        itemId: 1140,
        slot: "weapon",
        accuracy: 7,
        strength: 5,
        defence: 0,
        speed: 3,
        ranged: true,
        levelReq: 1,
        needs: "ranged",
      },
      {
        itemId: 2140,
        slot: "weapon",
        accuracy: 8,
        strength: 6,
        defence: 0,
        speed: 3,
        ranged: true,
        levelReq: 1,
        needs: "ranged",
      },
      {
        itemId: 3140,
        slot: "weapon",
        accuracy: 11,
        strength: 9,
        defence: 0,
        speed: 3,
        ranged: true,
        levelReq: 1,
        needs: "ranged",
      },
      {
        itemId: 4140,
        slot: "weapon",
        accuracy: 15,
        strength: 12,
        defence: 0,
        speed: 3,
        ranged: true,
        levelReq: 1,
        needs: "ranged",
      },
      {
        itemId: 1141,
        slot: "weapon",
        accuracy: 16,
        strength: 13,
        defence: 0,
        speed: 3,
        ranged: true,
        levelReq: 15,
        needs: "ranged",
      },
      {
        itemId: 2141,
        slot: "weapon",
        accuracy: 19,
        strength: 16,
        defence: 0,
        speed: 3,
        ranged: true,
        levelReq: 15,
        needs: "ranged",
      },
      {
        itemId: 3141,
        slot: "weapon",
        accuracy: 26,
        strength: 22,
        defence: 0,
        speed: 3,
        ranged: true,
        levelReq: 15,
        needs: "ranged",
      },
      {
        itemId: 4141,
        slot: "weapon",
        accuracy: 36,
        strength: 30,
        defence: 0,
        speed: 3,
        ranged: true,
        levelReq: 15,
        needs: "ranged",
      },
      {
        itemId: 1142,
        slot: "weapon",
        accuracy: 26,
        strength: 22,
        defence: 0,
        speed: 3,
        ranged: true,
        levelReq: 30,
        needs: "ranged",
      },
      {
        itemId: 2142,
        slot: "weapon",
        accuracy: 32,
        strength: 27,
        defence: 0,
        speed: 3,
        ranged: true,
        levelReq: 30,
        needs: "ranged",
      },
      {
        itemId: 3142,
        slot: "weapon",
        accuracy: 44,
        strength: 37,
        defence: 0,
        speed: 3,
        ranged: true,
        levelReq: 30,
        needs: "ranged",
      },
      {
        itemId: 4142,
        slot: "weapon",
        accuracy: 60,
        strength: 51,
        defence: 0,
        speed: 3,
        ranged: true,
        levelReq: 30,
        needs: "ranged",
      },
      {
        itemId: 1143,
        slot: "weapon",
        accuracy: 39,
        strength: 34,
        defence: 0,
        speed: 3,
        ranged: true,
        levelReq: 45,
        needs: "ranged",
      },
      {
        itemId: 2143,
        slot: "weapon",
        accuracy: 48,
        strength: 42,
        defence: 0,
        speed: 3,
        ranged: true,
        levelReq: 45,
        needs: "ranged",
      },
      {
        itemId: 3143,
        slot: "weapon",
        accuracy: 66,
        strength: 57,
        defence: 0,
        speed: 3,
        ranged: true,
        levelReq: 45,
        needs: "ranged",
      },
      {
        itemId: 4143,
        slot: "weapon",
        accuracy: 90,
        strength: 78,
        defence: 0,
        speed: 3,
        ranged: true,
        levelReq: 45,
        needs: "ranged",
      },
      {
        itemId: 1144,
        slot: "weapon",
        accuracy: 55,
        strength: 48,
        defence: 0,
        speed: 3,
        ranged: true,
        levelReq: 60,
        needs: "ranged",
      },
      {
        itemId: 2144,
        slot: "weapon",
        accuracy: 67,
        strength: 59,
        defence: 0,
        speed: 3,
        ranged: true,
        levelReq: 60,
        needs: "ranged",
      },
      {
        itemId: 3144,
        slot: "weapon",
        accuracy: 92,
        strength: 81,
        defence: 0,
        speed: 3,
        ranged: true,
        levelReq: 60,
        needs: "ranged",
      },
      {
        itemId: 4144,
        slot: "weapon",
        accuracy: 126,
        strength: 111,
        defence: 0,
        speed: 3,
        ranged: true,
        levelReq: 60,
        needs: "ranged",
      },
      {
        itemId: 1145,
        slot: "weapon",
        accuracy: 73,
        strength: 65,
        defence: 0,
        speed: 3,
        ranged: true,
        levelReq: 75,
        needs: "ranged",
      },
      {
        itemId: 2145,
        slot: "weapon",
        accuracy: 90,
        strength: 80,
        defence: 0,
        speed: 3,
        ranged: true,
        levelReq: 75,
        needs: "ranged",
      },
      {
        itemId: 3145,
        slot: "weapon",
        accuracy: 123,
        strength: 110,
        defence: 0,
        speed: 3,
        ranged: true,
        levelReq: 75,
        needs: "ranged",
      },
      {
        itemId: 4145,
        slot: "weapon",
        accuracy: 168,
        strength: 150,
        defence: 0,
        speed: 3,
        ranged: true,
        levelReq: 75,
        needs: "ranged",
      },
      {
        itemId: 1152,
        slot: "weapon",
        accuracy: 7,
        strength: 5,
        defence: 0,
        speed: 6,
        magic: true,
        levelReq: 1,
        needs: "magic",
      },
      {
        itemId: 2152,
        slot: "weapon",
        accuracy: 8,
        strength: 6,
        defence: 0,
        speed: 6,
        magic: true,
        levelReq: 1,
        needs: "magic",
      },
      {
        itemId: 3152,
        slot: "weapon",
        accuracy: 11,
        strength: 9,
        defence: 0,
        speed: 6,
        magic: true,
        levelReq: 1,
        needs: "magic",
      },
      {
        itemId: 4152,
        slot: "weapon",
        accuracy: 15,
        strength: 12,
        defence: 0,
        speed: 6,
        magic: true,
        levelReq: 1,
        needs: "magic",
      },
      {
        itemId: 1153,
        slot: "weapon",
        accuracy: 16,
        strength: 13,
        defence: 0,
        speed: 6,
        magic: true,
        levelReq: 15,
        needs: "magic",
      },
      {
        itemId: 2153,
        slot: "weapon",
        accuracy: 19,
        strength: 16,
        defence: 0,
        speed: 6,
        magic: true,
        levelReq: 15,
        needs: "magic",
      },
      {
        itemId: 3153,
        slot: "weapon",
        accuracy: 26,
        strength: 22,
        defence: 0,
        speed: 6,
        magic: true,
        levelReq: 15,
        needs: "magic",
      },
      {
        itemId: 4153,
        slot: "weapon",
        accuracy: 36,
        strength: 30,
        defence: 0,
        speed: 6,
        magic: true,
        levelReq: 15,
        needs: "magic",
      },
      {
        itemId: 1154,
        slot: "weapon",
        accuracy: 26,
        strength: 22,
        defence: 0,
        speed: 6,
        magic: true,
        levelReq: 30,
        needs: "magic",
      },
      {
        itemId: 2154,
        slot: "weapon",
        accuracy: 32,
        strength: 27,
        defence: 0,
        speed: 6,
        magic: true,
        levelReq: 30,
        needs: "magic",
      },
      {
        itemId: 3154,
        slot: "weapon",
        accuracy: 44,
        strength: 37,
        defence: 0,
        speed: 6,
        magic: true,
        levelReq: 30,
        needs: "magic",
      },
      {
        itemId: 4154,
        slot: "weapon",
        accuracy: 60,
        strength: 51,
        defence: 0,
        speed: 6,
        magic: true,
        levelReq: 30,
        needs: "magic",
      },
      {
        itemId: 1155,
        slot: "weapon",
        accuracy: 39,
        strength: 34,
        defence: 0,
        speed: 6,
        magic: true,
        levelReq: 45,
        needs: "magic",
      },
      {
        itemId: 2155,
        slot: "weapon",
        accuracy: 48,
        strength: 42,
        defence: 0,
        speed: 6,
        magic: true,
        levelReq: 45,
        needs: "magic",
      },
      {
        itemId: 3155,
        slot: "weapon",
        accuracy: 66,
        strength: 57,
        defence: 0,
        speed: 6,
        magic: true,
        levelReq: 45,
        needs: "magic",
      },
      {
        itemId: 4155,
        slot: "weapon",
        accuracy: 90,
        strength: 78,
        defence: 0,
        speed: 6,
        magic: true,
        levelReq: 45,
        needs: "magic",
      },
      {
        itemId: 1156,
        slot: "weapon",
        accuracy: 55,
        strength: 48,
        defence: 0,
        speed: 6,
        magic: true,
        levelReq: 60,
        needs: "magic",
      },
      {
        itemId: 2156,
        slot: "weapon",
        accuracy: 67,
        strength: 59,
        defence: 0,
        speed: 6,
        magic: true,
        levelReq: 60,
        needs: "magic",
      },
      {
        itemId: 3156,
        slot: "weapon",
        accuracy: 92,
        strength: 81,
        defence: 0,
        speed: 6,
        magic: true,
        levelReq: 60,
        needs: "magic",
      },
      {
        itemId: 4156,
        slot: "weapon",
        accuracy: 126,
        strength: 111,
        defence: 0,
        speed: 6,
        magic: true,
        levelReq: 60,
        needs: "magic",
      },
      {
        itemId: 1157,
        slot: "weapon",
        accuracy: 73,
        strength: 65,
        defence: 0,
        speed: 6,
        magic: true,
        levelReq: 75,
        needs: "magic",
      },
      {
        itemId: 2157,
        slot: "weapon",
        accuracy: 90,
        strength: 80,
        defence: 0,
        speed: 6,
        magic: true,
        levelReq: 75,
        needs: "magic",
      },
      {
        itemId: 3157,
        slot: "weapon",
        accuracy: 123,
        strength: 110,
        defence: 0,
        speed: 6,
        magic: true,
        levelReq: 75,
        needs: "magic",
      },
      {
        itemId: 4157,
        slot: "weapon",
        accuracy: 168,
        strength: 150,
        defence: 0,
        speed: 6,
        magic: true,
        levelReq: 75,
        needs: "magic",
      },
      {
        itemId: 1181,
        slot: "ring",
        accuracy: 5,
        strength: 3,
        defence: 0,
        levelReq: 20,
        needs: "defence",
      },
      {
        itemId: 2181,
        slot: "ring",
        accuracy: 6,
        strength: 3,
        defence: 0,
        levelReq: 20,
        needs: "defence",
      },
      {
        itemId: 3181,
        slot: "ring",
        accuracy: 9,
        strength: 4,
        defence: 0,
        levelReq: 20,
        needs: "defence",
      },
      {
        itemId: 4181,
        slot: "ring",
        accuracy: 12,
        strength: 6,
        defence: 0,
        levelReq: 20,
        needs: "defence",
      },
      {
        itemId: 1182,
        slot: "ring",
        accuracy: 12,
        strength: 7,
        defence: 0,
        levelReq: 45,
        needs: "defence",
      },
      {
        itemId: 2182,
        slot: "ring",
        accuracy: 14,
        strength: 8,
        defence: 0,
        levelReq: 45,
        needs: "defence",
      },
      {
        itemId: 3182,
        slot: "ring",
        accuracy: 20,
        strength: 11,
        defence: 0,
        levelReq: 45,
        needs: "defence",
      },
      {
        itemId: 4182,
        slot: "ring",
        accuracy: 27,
        strength: 15,
        defence: 0,
        levelReq: 45,
        needs: "defence",
      },
      {
        itemId: 1183,
        slot: "ring",
        accuracy: 21,
        strength: 12,
        defence: 0,
        levelReq: 75,
        needs: "defence",
      },
      {
        itemId: 2183,
        slot: "ring",
        accuracy: 26,
        strength: 14,
        defence: 0,
        levelReq: 75,
        needs: "defence",
      },
      {
        itemId: 3183,
        slot: "ring",
        accuracy: 35,
        strength: 20,
        defence: 0,
        levelReq: 75,
        needs: "defence",
      },
      {
        itemId: 4183,
        slot: "ring",
        accuracy: 48,
        strength: 27,
        defence: 0,
        levelReq: 75,
        needs: "defence",
      },
      {
        itemId: 1358,
        slot: "ring",
        accuracy: 29,
        strength: 17,
        defence: 0,
        levelReq: 95,
        needs: "defence",
      },
      {
        itemId: 2358,
        slot: "ring",
        accuracy: 35,
        strength: 21,
        defence: 0,
        levelReq: 95,
        needs: "defence",
      },
      {
        itemId: 3358,
        slot: "ring",
        accuracy: 48,
        strength: 29,
        defence: 0,
        levelReq: 95,
        needs: "defence",
      },
      {
        itemId: 4358,
        slot: "ring",
        accuracy: 66,
        strength: 39,
        defence: 0,
        levelReq: 95,
        needs: "defence",
      },
      {
        itemId: 1184,
        slot: "amulet",
        accuracy: 0,
        strength: 0,
        defence: 5,
        luck: 0.325,
        levelReq: 30,
        needs: "none",
      },
      {
        itemId: 2184,
        slot: "amulet",
        accuracy: 0,
        strength: 0,
        defence: 6,
        luck: 0.4,
        levelReq: 30,
        needs: "none",
      },
      {
        itemId: 3184,
        slot: "amulet",
        accuracy: 0,
        strength: 0,
        defence: 9,
        luck: 0.55,
        levelReq: 30,
        needs: "none",
      },
      {
        itemId: 4184,
        slot: "amulet",
        accuracy: 0,
        strength: 0,
        defence: 12,
        luck: 0.75,
        levelReq: 30,
        needs: "none",
      },
      {
        itemId: 1185,
        slot: "amulet",
        accuracy: 0,
        strength: 0,
        defence: 10,
        luck: 0.65,
        levelReq: 55,
        needs: "none",
      },
      {
        itemId: 2185,
        slot: "amulet",
        accuracy: 0,
        strength: 0,
        defence: 13,
        luck: 0.8,
        levelReq: 55,
        needs: "none",
      },
      {
        itemId: 3185,
        slot: "amulet",
        accuracy: 0,
        strength: 0,
        defence: 18,
        luck: 1.1,
        levelReq: 55,
        needs: "none",
      },
      {
        itemId: 4185,
        slot: "amulet",
        accuracy: 0,
        strength: 0,
        defence: 24,
        luck: 1.5,
        levelReq: 55,
        needs: "none",
      },
      {
        itemId: 1186,
        slot: "amulet",
        accuracy: 0,
        strength: 0,
        defence: 18,
        luck: 1.3,
        levelReq: 85,
        needs: "none",
      },
      {
        itemId: 2186,
        slot: "amulet",
        accuracy: 0,
        strength: 0,
        defence: 22,
        luck: 1.6,
        levelReq: 85,
        needs: "none",
      },
      {
        itemId: 3186,
        slot: "amulet",
        accuracy: 0,
        strength: 0,
        defence: 31,
        luck: 2.2,
        levelReq: 85,
        needs: "none",
      },
      {
        itemId: 4186,
        slot: "amulet",
        accuracy: 0,
        strength: 0,
        defence: 42,
        luck: 3,
        levelReq: 85,
        needs: "none",
      },
      {
        itemId: 1357,
        slot: "amulet",
        accuracy: 0,
        strength: 0,
        defence: 23,
        luck: 1.9500000000000002,
        levelReq: 95,
        needs: "none",
      },
      {
        itemId: 2357,
        slot: "amulet",
        accuracy: 0,
        strength: 0,
        defence: 29,
        luck: 2.4000000000000004,
        levelReq: 95,
        needs: "none",
      },
      {
        itemId: 3357,
        slot: "amulet",
        accuracy: 0,
        strength: 0,
        defence: 40,
        luck: 3.3000000000000003,
        levelReq: 95,
        needs: "none",
      },
      {
        itemId: 4357,
        slot: "amulet",
        accuracy: 0,
        strength: 0,
        defence: 54,
        luck: 4.5,
        levelReq: 95,
        needs: "none",
      },
      {
        itemId: 1304,
        slot: "helmet",
        accuracy: 3,
        strength: 0,
        defence: 1,
        levelReq: 1,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 2304,
        slot: "helmet",
        accuracy: 3,
        strength: 0,
        defence: 2,
        levelReq: 1,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 3304,
        slot: "helmet",
        accuracy: 4,
        strength: 0,
        defence: 2,
        levelReq: 1,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 4304,
        slot: "helmet",
        accuracy: 6,
        strength: 0,
        defence: 3,
        levelReq: 1,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 1305,
        slot: "body",
        accuracy: 4,
        strength: 0,
        defence: 3,
        levelReq: 1,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 2305,
        slot: "body",
        accuracy: 5,
        strength: 0,
        defence: 3,
        levelReq: 1,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 3305,
        slot: "body",
        accuracy: 7,
        strength: 0,
        defence: 4,
        levelReq: 1,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 4305,
        slot: "body",
        accuracy: 9,
        strength: 0,
        defence: 6,
        levelReq: 1,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 1306,
        slot: "legs",
        accuracy: 3,
        strength: 0,
        defence: 1,
        levelReq: 1,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 2306,
        slot: "legs",
        accuracy: 3,
        strength: 0,
        defence: 2,
        levelReq: 1,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 3306,
        slot: "legs",
        accuracy: 4,
        strength: 0,
        defence: 2,
        levelReq: 1,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 4306,
        slot: "legs",
        accuracy: 6,
        strength: 0,
        defence: 3,
        levelReq: 1,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 1307,
        slot: "helmet",
        accuracy: 8,
        strength: 0,
        defence: 3,
        levelReq: 25,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 2307,
        slot: "helmet",
        accuracy: 10,
        strength: 0,
        defence: 3,
        levelReq: 25,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 3307,
        slot: "helmet",
        accuracy: 13,
        strength: 0,
        defence: 4,
        levelReq: 25,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 4307,
        slot: "helmet",
        accuracy: 18,
        strength: 0,
        defence: 6,
        levelReq: 25,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 1308,
        slot: "body",
        accuracy: 13,
        strength: 0,
        defence: 7,
        levelReq: 25,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 2308,
        slot: "body",
        accuracy: 16,
        strength: 0,
        defence: 8,
        levelReq: 25,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 3308,
        slot: "body",
        accuracy: 22,
        strength: 0,
        defence: 11,
        levelReq: 25,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 4308,
        slot: "body",
        accuracy: 30,
        strength: 0,
        defence: 15,
        levelReq: 25,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 1309,
        slot: "legs",
        accuracy: 10,
        strength: 0,
        defence: 5,
        levelReq: 25,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 2309,
        slot: "legs",
        accuracy: 13,
        strength: 0,
        defence: 6,
        levelReq: 25,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 3309,
        slot: "legs",
        accuracy: 18,
        strength: 0,
        defence: 9,
        levelReq: 25,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 4309,
        slot: "legs",
        accuracy: 24,
        strength: 0,
        defence: 12,
        levelReq: 25,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 1310,
        slot: "helmet",
        accuracy: 14,
        strength: 0,
        defence: 5,
        levelReq: 50,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 2310,
        slot: "helmet",
        accuracy: 18,
        strength: 0,
        defence: 6,
        levelReq: 50,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 3310,
        slot: "helmet",
        accuracy: 24,
        strength: 0,
        defence: 9,
        levelReq: 50,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 4310,
        slot: "helmet",
        accuracy: 33,
        strength: 0,
        defence: 12,
        levelReq: 50,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 1311,
        slot: "body",
        accuracy: 23,
        strength: 0,
        defence: 12,
        levelReq: 50,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 2311,
        slot: "body",
        accuracy: 29,
        strength: 0,
        defence: 14,
        levelReq: 50,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 3311,
        slot: "body",
        accuracy: 40,
        strength: 0,
        defence: 20,
        levelReq: 50,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 4311,
        slot: "body",
        accuracy: 54,
        strength: 0,
        defence: 27,
        levelReq: 50,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 1312,
        slot: "legs",
        accuracy: 18,
        strength: 0,
        defence: 9,
        levelReq: 50,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 2312,
        slot: "legs",
        accuracy: 22,
        strength: 0,
        defence: 11,
        levelReq: 50,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 3312,
        slot: "legs",
        accuracy: 31,
        strength: 0,
        defence: 15,
        levelReq: 50,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 4312,
        slot: "legs",
        accuracy: 42,
        strength: 0,
        defence: 21,
        levelReq: 50,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 1313,
        slot: "helmet",
        accuracy: 22,
        strength: 0,
        defence: 9,
        levelReq: 75,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 2313,
        slot: "helmet",
        accuracy: 27,
        strength: 0,
        defence: 11,
        levelReq: 75,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 3313,
        slot: "helmet",
        accuracy: 37,
        strength: 0,
        defence: 15,
        levelReq: 75,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 4313,
        slot: "helmet",
        accuracy: 51,
        strength: 0,
        defence: 21,
        levelReq: 75,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 1314,
        slot: "body",
        accuracy: 36,
        strength: 0,
        defence: 18,
        levelReq: 75,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 2314,
        slot: "body",
        accuracy: 45,
        strength: 0,
        defence: 22,
        levelReq: 75,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 3314,
        slot: "body",
        accuracy: 62,
        strength: 0,
        defence: 31,
        levelReq: 75,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 4314,
        slot: "body",
        accuracy: 84,
        strength: 0,
        defence: 42,
        levelReq: 75,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 1315,
        slot: "legs",
        accuracy: 29,
        strength: 0,
        defence: 14,
        levelReq: 75,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 2315,
        slot: "legs",
        accuracy: 35,
        strength: 0,
        defence: 18,
        levelReq: 75,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 3315,
        slot: "legs",
        accuracy: 48,
        strength: 0,
        defence: 24,
        levelReq: 75,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 4315,
        slot: "legs",
        accuracy: 66,
        strength: 0,
        defence: 33,
        levelReq: 75,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 1344,
        slot: "helmet",
        accuracy: 27,
        strength: 0,
        defence: 12,
        levelReq: 90,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 2344,
        slot: "helmet",
        accuracy: 34,
        strength: 0,
        defence: 14,
        levelReq: 90,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 3344,
        slot: "helmet",
        accuracy: 46,
        strength: 0,
        defence: 20,
        levelReq: 90,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 4344,
        slot: "helmet",
        accuracy: 63,
        strength: 0,
        defence: 27,
        levelReq: 90,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 1345,
        slot: "body",
        accuracy: 46,
        strength: 0,
        defence: 22,
        levelReq: 90,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 2345,
        slot: "body",
        accuracy: 56,
        strength: 0,
        defence: 27,
        levelReq: 90,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 3345,
        slot: "body",
        accuracy: 77,
        strength: 0,
        defence: 37,
        levelReq: 90,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 4345,
        slot: "body",
        accuracy: 105,
        strength: 0,
        defence: 51,
        levelReq: 90,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 1346,
        slot: "legs",
        accuracy: 35,
        strength: 0,
        defence: 18,
        levelReq: 90,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 2346,
        slot: "legs",
        accuracy: 43,
        strength: 0,
        defence: 22,
        levelReq: 90,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 3346,
        slot: "legs",
        accuracy: 59,
        strength: 0,
        defence: 31,
        levelReq: 90,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 4346,
        slot: "legs",
        accuracy: 81,
        strength: 0,
        defence: 42,
        levelReq: 90,
        needs: "magic",
        style: "magic",
      },
      {
        itemId: 1146,
        slot: "weapon",
        accuracy: 9,
        strength: 8,
        defence: 0,
        speed: 5,
        ranged: true,
        levelReq: 1,
        needs: "ranged",
      },
      {
        itemId: 2146,
        slot: "weapon",
        accuracy: 11,
        strength: 10,
        defence: 0,
        speed: 5,
        ranged: true,
        levelReq: 1,
        needs: "ranged",
      },
      {
        itemId: 3146,
        slot: "weapon",
        accuracy: 15,
        strength: 13,
        defence: 0,
        speed: 5,
        ranged: true,
        levelReq: 1,
        needs: "ranged",
      },
      {
        itemId: 4146,
        slot: "weapon",
        accuracy: 21,
        strength: 18,
        defence: 0,
        speed: 5,
        ranged: true,
        levelReq: 1,
        needs: "ranged",
      },
      {
        itemId: 1147,
        slot: "weapon",
        accuracy: 20,
        strength: 17,
        defence: 0,
        speed: 5,
        ranged: true,
        levelReq: 15,
        needs: "ranged",
      },
      {
        itemId: 2147,
        slot: "weapon",
        accuracy: 24,
        strength: 21,
        defence: 0,
        speed: 5,
        ranged: true,
        levelReq: 15,
        needs: "ranged",
      },
      {
        itemId: 3147,
        slot: "weapon",
        accuracy: 33,
        strength: 29,
        defence: 0,
        speed: 5,
        ranged: true,
        levelReq: 15,
        needs: "ranged",
      },
      {
        itemId: 4147,
        slot: "weapon",
        accuracy: 45,
        strength: 39,
        defence: 0,
        speed: 5,
        ranged: true,
        levelReq: 15,
        needs: "ranged",
      },
      {
        itemId: 1148,
        slot: "weapon",
        accuracy: 31,
        strength: 29,
        defence: 0,
        speed: 5,
        ranged: true,
        levelReq: 30,
        needs: "ranged",
      },
      {
        itemId: 2148,
        slot: "weapon",
        accuracy: 38,
        strength: 35,
        defence: 0,
        speed: 5,
        ranged: true,
        levelReq: 30,
        needs: "ranged",
      },
      {
        itemId: 3148,
        slot: "weapon",
        accuracy: 53,
        strength: 48,
        defence: 0,
        speed: 5,
        ranged: true,
        levelReq: 30,
        needs: "ranged",
      },
      {
        itemId: 4148,
        slot: "weapon",
        accuracy: 72,
        strength: 66,
        defence: 0,
        speed: 5,
        ranged: true,
        levelReq: 30,
        needs: "ranged",
      },
      {
        itemId: 1149,
        slot: "weapon",
        accuracy: 47,
        strength: 43,
        defence: 0,
        speed: 5,
        ranged: true,
        levelReq: 45,
        needs: "ranged",
      },
      {
        itemId: 2149,
        slot: "weapon",
        accuracy: 58,
        strength: 53,
        defence: 0,
        speed: 5,
        ranged: true,
        levelReq: 45,
        needs: "ranged",
      },
      {
        itemId: 3149,
        slot: "weapon",
        accuracy: 79,
        strength: 73,
        defence: 0,
        speed: 5,
        ranged: true,
        levelReq: 45,
        needs: "ranged",
      },
      {
        itemId: 4149,
        slot: "weapon",
        accuracy: 108,
        strength: 99,
        defence: 0,
        speed: 5,
        ranged: true,
        levelReq: 45,
        needs: "ranged",
      },
      {
        itemId: 1150,
        slot: "weapon",
        accuracy: 65,
        strength: 60,
        defence: 0,
        speed: 5,
        ranged: true,
        levelReq: 60,
        needs: "ranged",
      },
      {
        itemId: 2150,
        slot: "weapon",
        accuracy: 80,
        strength: 74,
        defence: 0,
        speed: 5,
        ranged: true,
        levelReq: 60,
        needs: "ranged",
      },
      {
        itemId: 3150,
        slot: "weapon",
        accuracy: 110,
        strength: 101,
        defence: 0,
        speed: 5,
        ranged: true,
        levelReq: 60,
        needs: "ranged",
      },
      {
        itemId: 4150,
        slot: "weapon",
        accuracy: 150,
        strength: 138,
        defence: 0,
        speed: 5,
        ranged: true,
        levelReq: 60,
        needs: "ranged",
      },
      {
        itemId: 1151,
        slot: "weapon",
        accuracy: 86,
        strength: 81,
        defence: 0,
        speed: 5,
        ranged: true,
        levelReq: 75,
        needs: "ranged",
      },
      {
        itemId: 2151,
        slot: "weapon",
        accuracy: 106,
        strength: 99,
        defence: 0,
        speed: 5,
        ranged: true,
        levelReq: 75,
        needs: "ranged",
      },
      {
        itemId: 3151,
        slot: "weapon",
        accuracy: 145,
        strength: 136,
        defence: 0,
        speed: 5,
        ranged: true,
        levelReq: 75,
        needs: "ranged",
      },
      {
        itemId: 4151,
        slot: "weapon",
        accuracy: 198,
        strength: 186,
        defence: 0,
        speed: 5,
        ranged: true,
        levelReq: 75,
        needs: "ranged",
      },
    ],
    rooms: [
      {
        id: "mine",
        name: "The mine",
        bonus: { kind: "gatherSpeed", skill: "mining" },
        feeds: "wood",
        look: "house-mine",
        blurb:
          "Timber props hold the shaft: every log shores it deeper, and you mine the faster for it.",
      },
      {
        id: "sawmill",
        name: "The sawmill",
        bonus: { kind: "gatherSpeed", skill: "woodcutting" },
        feeds: "stone",
        look: "house-sawmill",
        blurb: "Millstones and blades of ore: the sharper the mill, the quicker the felling.",
      },
      {
        id: "pond",
        name: "The pond",
        bonus: { kind: "gatherSpeed", skill: "fishing" },
        feeds: "stone",
        look: "house-pond",
        blurb: "A stone basin, deepened rock by rock: the fuller the pond, the faster the catch.",
      },
      {
        id: "garden",
        name: "The garden",
        bonus: { kind: "gatherSpeed", skill: "farming" },
        feeds: "fish",
        alsoFeeds: ["crop"],
        look: "house-garden",
        blurb: "Fish dug into the beds as feed: the richer the soil, the faster the fields.",
      },
      {
        id: "forge",
        name: "The forge",
        bonus: { kind: "craftSpeed", skill: "smithing" },
        feeds: "hide",
        look: "house-forge",
        blurb:
          "Leather bellows breathe the fire -- the more hide worked into them, the hotter the hearth and the quicker the bar. A fighter brings the hides home.",
      },
      {
        id: "yard",
        name: "The training yard",
        bonus: { kind: "combatXp" },
        feeds: "fish",
        look: "house-yard",
        blurb:
          "Straw dummies to strike -- the more you drill against them, the more each blow teaches. The catch from the shore keeps the yard, never the fight itself.",
      },
      {
        id: "lockbox",
        name: "The lockbox bench",
        bonus: { kind: "gatherSpeed", skill: "thieving" },
        feeds: "hide",
        look: "house-lockbox",
        blurb:
          "Picks laid out on leather, a chest left open to practise on: the surer the hand, the quicker the lift.",
      },
      {
        id: "range",
        name: "The range",
        bonus: { kind: "craftSpeed", skill: "cooking" },
        feeds: "wood",
        look: "house-range",
        blurb:
          "A stone range fed with split logs: the hotter it draws, the faster the pot comes to the boil.",
      },
      {
        id: "fletchrack",
        name: "The fletching rack",
        bonus: { kind: "craftSpeed", skill: "fletching" },
        feeds: "stone",
        look: "house-fletch",
        blurb: "Whetstones and a rack of bows in the making: keen tools, quick arrows.",
      },
      {
        id: "herbrack",
        name: "The herb rack",
        bonus: { kind: "craftSpeed", skill: "herblore" },
        feeds: "hide",
        alsoFeeds: ["crop"],
        look: "house-herbs",
        blurb:
          "Bundles drying overhead on racks strung with sinew, a mortar on the bench: the fuller the rack, the faster the brew.",
      },
      {
        id: "loom",
        name: "The loom",
        bonus: { kind: "craftSpeed", skill: "crafting" },
        feeds: "fish",
        look: "house-loom",
        blurb:
          "A loom strung with sinew from the catch: the finer the thread, the quicker the work.",
      },
      {
        id: "lectern",
        name: "The rune lectern",
        bonus: { kind: "enhanceChance" },
        feeds: "stone",
        look: "house-lectern",
        blurb:
          "A lectern of cut stone and a book that glows: the more is written, the surer a charm takes -- every level lifts the odds of an enhance landing by a percent of themselves.",
      },
      {
        id: "post",
        name: "The sparring post",
        bonus: { kind: "dmg", skill: "melee" },
        rate: 0.5,
        feeds: "stone",
        look: "house-post",
        blurb:
          "A post bound in hide to strike at, notched by every blade that trained on it: the arm schooled here lands heavier blows.",
      },
      {
        id: "armour",
        name: "The armour stand",
        bonus: { kind: "skillXp", skill: "defence" },
        feeds: "wood",
        look: "house-armour",
        blurb:
          "A suit on a wooden stand to drill against: every guard you learn on it counts for more in the field.",
      },
      {
        id: "target",
        name: "The archery target",
        bonus: { kind: "dmg", skill: "ranged" },
        rate: 0.5,
        feeds: "wood",
        look: "house-target",
        blurb:
          "A straw butt on a stout wooden post: the eye trained here drives every arrow home harder.",
      },
      {
        id: "altar",
        name: "The altar",
        bonus: { kind: "dmg", skill: "magic" },
        rate: 0.5,
        feeds: "fish",
        look: "house-altar",
        blurb: "A stone altar with candles kept lit: the mind focused here casts with more force.",
      },
      {
        id: "shrine",
        name: "The lucky shrine",
        bonus: { kind: "rareChance" },
        feeds: "hide",
        look: "house-shrine",
        rate: 0.5,
        blurb:
          "Coins on a little shrine and a four-leaf clover pressed under glass: fortune, everywhere you look for it. Half a lift a level -- it reaches every skill.",
      },
      {
        id: "storeroom",
        name: "The storeroom",
        bonus: { kind: "bankSlots" },
        feeds: "wood",
        look: "house-store",
        rate: 0.5,
        blurb: "Shelves and crates: one more shelf in Storage for every two levels.",
      },
    ],
    combat: {
      monsters: [
        {
          id: 1,
          name: "Gnawer",
          level: 2,
          hp: 8,
          maxHit: 1,
          attack: 1,
          defence: 1,
          speed: 4,
          xp: 8,
          gold: [1, 2],
          bonus: { itemId: 201, chance: 0.0004 },
          drop: 240,
        },
        {
          id: 2,
          name: "Bogling",
          level: 8,
          hp: 18,
          maxHit: 3,
          attack: 8,
          defence: 6,
          speed: 4,
          xp: 22,
          gold: [2, 4],
          bonus: { itemId: 202, chance: 0.0006 },
          drop: 241,
        },
        {
          id: 3,
          name: "Husk",
          level: 20,
          hp: 40,
          maxHit: 6,
          attack: 20,
          defence: 18,
          speed: 4,
          xp: 60,
          gold: [17, 32],
          bonus: { itemId: 203, chance: 0.0008 },
          drop: 242,
        },
        {
          id: 4,
          name: "Cairn wight",
          level: 40,
          hp: 75,
          maxHit: 10,
          attack: 40,
          defence: 38,
          speed: 4,
          xp: 165,
          gold: [117, 217],
          bonus: { itemId: 204, chance: 0.001 },
          drop: 243,
        },
        {
          id: 5,
          name: "Rimewolf",
          level: 60,
          hp: 120,
          maxHit: 15,
          attack: 62,
          defence: 58,
          speed: 4,
          xp: 380,
          gold: [369, 685],
          bonus: { itemId: 205, chance: 0.0014 },
          drop: 245,
        },
        {
          id: 6,
          name: "Emberkin",
          level: 80,
          hp: 180,
          maxHit: 22,
          attack: 85,
          defence: 80,
          speed: 5,
          xp: 780,
          gold: [837, 1554],
          bonus: { itemId: 206, chance: 0.002 },
          drop: 247,
        },
        {
          id: 7,
          name: "Deep horror",
          level: 95,
          hp: 260,
          maxHit: 30,
          attack: 100,
          defence: 96,
          speed: 5,
          xp: 1500,
          gold: [1365, 2535],
          bonus: { itemId: 207, chance: 0.0015 },
          drop: 249,
          dropChance: 0.5,
        },
        {
          id: 8,
          name: "Sand wraith",
          level: 50,
          hp: 95,
          maxHit: 12,
          attack: 50,
          defence: 48,
          speed: 4,
          xp: 250,
          gold: [220, 409],
          bonus: { itemId: 213, chance: 0.0012 },
          drop: 244,
        },
        {
          id: 9,
          name: "Dune stalker",
          level: 70,
          hp: 150,
          maxHit: 18,
          attack: 72,
          defence: 68,
          speed: 4,
          xp: 550,
          gold: [572, 1063],
          bonus: { itemId: 214, chance: 0.0016 },
          drop: 246,
        },
        {
          id: 10,
          name: "Frost troll",
          level: 85,
          hp: 210,
          maxHit: 25,
          attack: 90,
          defence: 84,
          speed: 5,
          xp: 1000,
          gold: [994, 1847],
          bonus: { itemId: 215, chance: 0.0011 },
          drop: 248,
          dropChance: 0.5,
        },
        {
          id: 11,
          name: "Ice wight",
          level: 105,
          hp: 300,
          maxHit: 34,
          attack: 112,
          defence: 106,
          speed: 5,
          xp: 2000,
          gold: [1509, 2802],
          bonus: { itemId: 216, chance: 0.0015 },
          drop: 250,
          dropChance: 0.5,
        },
        {
          id: 12,
          name: "Ash drake",
          level: 120,
          hp: 360,
          maxHit: 40,
          attack: 128,
          defence: 120,
          speed: 5,
          xp: 2800,
          gold: [1724, 3202],
          bonus: { itemId: 217, chance: 0.00175 },
          drop: 251,
          dropChance: 0.5,
        },
        {
          id: 13,
          name: "Cinder colossus",
          level: 140,
          hp: 440,
          maxHit: 48,
          attack: 150,
          defence: 140,
          speed: 6,
          xp: 4000,
          gold: [2012, 3736],
          bonus: { itemId: 218, chance: 0.002 },
          drop: 252,
          dropChance: 0.5,
        },
        {
          id: 14,
          name: "Rock mite",
          level: 3,
          hp: 10,
          maxHit: 1,
          attack: 3,
          defence: 2,
          speed: 4,
          xp: 11,
          gold: [1, 2],
          bonus: { itemId: 201, chance: 0.0004 },
          drop: 240,
        },
        {
          id: 15,
          name: "Fen lurker",
          level: 5,
          hp: 13,
          maxHit: 2,
          attack: 5,
          defence: 4,
          speed: 4,
          xp: 15,
          gold: [1, 2],
          bonus: { itemId: 201, chance: 0.0005 },
          drop: 240,
        },
        {
          id: 16,
          name: "Grave beetle",
          level: 12,
          hp: 26,
          maxHit: 4,
          attack: 12,
          defence: 10,
          speed: 4,
          xp: 34,
          gold: [4, 9],
          bonus: { itemId: 202, chance: 0.0006 },
          drop: 241,
        },
        {
          id: 17,
          name: "Sump crawler",
          level: 16,
          hp: 33,
          maxHit: 5,
          attack: 16,
          defence: 14,
          speed: 4,
          xp: 46,
          gold: [9, 18],
          bonus: { itemId: 202, chance: 0.0007 },
          drop: 241,
        },
        {
          id: 18,
          name: "Stone eater",
          level: 22,
          hp: 44,
          maxHit: 6,
          attack: 22,
          defence: 20,
          speed: 4,
          xp: 70,
          gold: [22, 41],
          bonus: { itemId: 203, chance: 0.0008 },
          drop: 242,
        },
        {
          id: 19,
          name: "Barrow hound",
          level: 26,
          hp: 51,
          maxHit: 7,
          attack: 26,
          defence: 24,
          speed: 4,
          xp: 91,
          gold: [35, 65],
          bonus: { itemId: 203, chance: 0.0009 },
          drop: 242,
        },
        {
          id: 20,
          name: "Chalk wight",
          level: 32,
          hp: 61,
          maxHit: 8,
          attack: 32,
          defence: 30,
          speed: 4,
          xp: 122,
          gold: [62, 116],
          bonus: { itemId: 203, chance: 0.001 },
          drop: 242,
        },
      ],
      petChance: 0.000002,
      pets: {
        1: 280,
        2: 281,
        3: 282,
        4: 283,
        5: 284,
        6: 285,
        7: 286,
        8: 287,
        9: 288,
        10: 289,
        11: 290,
        12: 291,
        13: 292,
        14: 316,
        15: 317,
        16: 318,
        17: 319,
        18: 320,
        19: 321,
        20: 322,
      },
      abyssalCoins: 0.25,
      shardId: 208,
    },
    masteries: [
      {
        id: "xp",
        name: "XP gain",
        blurb: "More XP from every skill.",
        lane: "efficiency",
        perRank: 0.005,
        unit: "percent",
      },
      {
        id: "gather",
        name: "Gather speed",
        blurb: "Mine, fish, chop, farm and steal faster.",
        lane: "efficiency",
        perRank: 0.005,
        unit: "percent",
      },
      {
        id: "craft",
        name: "Craft speed",
        blurb: "Smith, cook, fletch, brew and craft faster.",
        lane: "efficiency",
        perRank: 0.005,
        unit: "percent",
      },
      {
        id: "offline",
        name: "Offline hours",
        blurb: "Bank more progress while you are away.",
        lane: "efficiency",
        perRank: 0.005,
        unit: "hours",
      },
      {
        id: "move",
        name: "Move speed",
        blurb: "Walk between rocks, trees and foes faster.",
        lane: "efficiency",
        perRank: 0.005,
        unit: "percent",
      },
      {
        id: "hp",
        name: "Max HP",
        blurb: "More maximum health.",
        lane: "efficiency",
        perRank: 0.005,
        unit: "percent",
      },
      {
        id: "maxhit",
        name: "Max hit",
        blurb: "Hit harder with every style.",
        lane: "power",
        perRank: 0.005,
        unit: "percent",
      },
      {
        id: "accuracy",
        name: "Accuracy",
        blurb: "Land more of your swings.",
        lane: "power",
        perRank: 0.005,
        unit: "percent",
      },
      {
        id: "rare",
        name: "Rare-find",
        blurb: "Better odds of a rarer drop.",
        lane: "power",
        perRank: 0.005,
        unit: "percent",
      },
      {
        id: "enhance",
        name: "Enhance odds",
        blurb: "Better odds when enhancing gear.",
        lane: "power",
        perRank: 0.0025,
        unit: "percent",
      },
    ],
    xpTable: [
      0, 0, 100, 212, 337, 478, 635, 812, 1009, 1230, 1478, 1755, 2065, 2413, 2803, 3239, 3728,
      4275, 4888, 5575, 6344, 7205, 8170, 9250, 10460, 11816, 13333, 15033, 16937, 19070, 21458,
      24133, 27129, 30485, 34243, 38452, 43166, 48446, 54360, 60983, 68401, 76709, 86014, 96436,
      108108, 121181, 135823, 152222, 170588, 191159, 214198, 240002, 268902, 301270, 337523,
      378125, 423601, 474533, 531576, 595466, 667022, 747164, 836924, 937455, 1050049, 1176155,
      1317394, 1475581, 1652751, 1851181, 2073422, 2322333, 2601113, 2913347, 3263048, 3654714,
      4093380, 4584685, 5134948, 5751241, 6441490, 7214569, 8080418, 9050168, 10136288, 11352742,
      12715171, 14241092, 15950123, 17864238, 20008046, 22409112, 25098305, 28110202, 31483526,
      35261649, 39493147, 44232425, 49540416, 55485366, 61033903, 67386977, 74661247, 82990287,
      92527037, 103446616, 115949533, 130265374, 146657012, 165425437, 186915284, 211521159,
      239694885, 271953802, 308890262, 351182509, 399607131, 455053324, 518539214, 591230559,
      674462148, 769762318, 878881013, 1003821918, 1146879255, 1310679905, 1498231650, 1712978398,
      1958863424, 2240401779, 2562763195, 2931867017, 3354490893, 3838395231, 4392465698,
      5026876383, 5753276617, 6585004885, 7537333752, 8627750305, 9876277257, 11305840618,
      12942690666, 14816883972, 16962835306, 19419949584, 22233345432, 25454683678, 29143115970,
      33366370944, 38201997890, 43738790742, 50078418559, 57337292408, 65648702966, 75165268054,
      86061735081, 98538189826, 112823730510, 129180674592, 147909375566, 169353738182,
      193907533377, 222021628875, 254212268220, 291070550271, 333273283219, 381595412444,
      436924250407, 500275769874, 572813259665, 655868685475, 750967148027, 859854887649,
      984531349517, 1127285898355, 1290739856776, 1477894639167, 1692186865004, 1937551463588,
      2218493928967, 2540173051826, 2908495647499, 3330225019545, 3813105150538, 4366002900524,
      4999070824259, 5723933596935, 6553901471649, 7504214688197, 8592323321144, 9838207705868,
      11264745326378, 12898130901861, 14768357385789, 16909766709887, 19361680385979,
      22169121545105, 25383641672304, 29064267217946, 33278583467707, 38103975573683,
      43629049535026, 49955259220763, 57198769310932, 65492588364176, 74989011180140,
      85862415304418, 98312463026718, 112567767668750, 128890091483878, 147579152252198,
      168978126831926, 193479952725713, 221534543374100, 253657049666503, 290437319371305,
      332550728183303, 380770581273040, 435982313060789, 499199745957762, 571583706624797,
      654463341588551, 749360523622049, 858017797050405, 982430375125872, 1124882777022282,
      1287990777193671, 1474749437389912, 1688588103314608, 1933433375798384, 2213781212792309,
      2534779486150352, 2902322509145312, 3323159270474540, 3805017362196507, 4356744877218159,
      4988472881917951, 5711801447299213, 6540012654660758, 7488314487089727, 8574120085220896,
    ],
    rarityEligible: [
      1, 2, 3, 4, 5, 6, 7, 8, 20, 21, 22, 23, 24, 25, 26, 27, 10, 11, 12, 13, 14, 15, 170, 171, 172,
      173, 174, 175, 40, 41, 42, 43, 44, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 360, 361, 362, 363,
      364, 365, 366, 367, 368, 369, 370, 371, 372, 373, 374, 375, 376, 377, 378, 379, 380, 381, 382,
      383, 384, 385, 386, 387, 388, 389, 90, 91, 92, 93, 94, 60, 61, 62, 63, 64, 65, 66, 67, 110,
      111, 112, 113, 114, 390, 391, 392, 393, 394, 395, 115, 116, 117, 118, 119, 120, 121, 122, 123,
      124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 350, 351, 352, 353, 354, 140, 141, 142,
      143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 193, 194, 195, 220,
      225, 226, 227, 221, 222, 223, 224, 180, 181, 182, 183, 358, 184, 185, 186, 357, 260, 262, 261,
      263, 265, 264, 266, 268, 267, 269, 271, 270, 272, 274, 273, 338, 340, 339, 341, 343, 342, 200,
      300, 301, 302, 303, 304, 306, 305, 307, 309, 308, 310, 312, 311, 313, 315, 314, 344, 346, 345,
      323, 324, 325, 326, 329, 330, 331, 332, 333, 347, 348, 334, 335, 336, 337, 349, 327, 240, 241,
      242, 243, 245, 247, 249, 244, 246, 248, 250, 251, 252, 100, 328, 160, 161, 162, 163, 164, 165,
      190, 191, 192,
    ],
    seedIds: [160, 161, 162, 163, 164, 165, 190, 191, 192],
    potions: [
      { id: 220, itemId: 220, kind: "gatherer", effect: "+10% xp from gathering", tier: 0 },
      { id: 221, itemId: 221, kind: "hunter", effect: "+25% odds of a rare find", tier: 0 },
      { id: 222, itemId: 222, kind: "warrior", effect: "+10 accuracy and +10% max hit", tier: 0 },
      { id: 223, itemId: 223, kind: "elixir", effect: "+10% xp from everything", tier: 0 },
      { id: 224, itemId: 224, kind: "abyssal", effect: "+25% coins from monsters", tier: 0 },
      { id: 225, itemId: 225, kind: "swift", effect: "+20% movement speed", tier: 0 },
      { id: 226, itemId: 226, kind: "nourish", effect: "+25% healing from food", tier: 0 },
      { id: 227, itemId: 227, kind: "haste", effect: "+20% attack speed", tier: 0 },
      { id: 1220, itemId: 220, kind: "gatherer", effect: "+10% xp from gathering", tier: 1 },
      { id: 2220, itemId: 220, kind: "gatherer", effect: "+10% xp from gathering", tier: 2 },
      { id: 3220, itemId: 220, kind: "gatherer", effect: "+10% xp from gathering", tier: 3 },
      { id: 4220, itemId: 220, kind: "gatherer", effect: "+10% xp from gathering", tier: 4 },
      { id: 1221, itemId: 221, kind: "hunter", effect: "+25% odds of a rare find", tier: 1 },
      { id: 2221, itemId: 221, kind: "hunter", effect: "+25% odds of a rare find", tier: 2 },
      { id: 3221, itemId: 221, kind: "hunter", effect: "+25% odds of a rare find", tier: 3 },
      { id: 4221, itemId: 221, kind: "hunter", effect: "+25% odds of a rare find", tier: 4 },
      { id: 1222, itemId: 222, kind: "warrior", effect: "+10 accuracy and +10% max hit", tier: 1 },
      { id: 2222, itemId: 222, kind: "warrior", effect: "+10 accuracy and +10% max hit", tier: 2 },
      { id: 3222, itemId: 222, kind: "warrior", effect: "+10 accuracy and +10% max hit", tier: 3 },
      { id: 4222, itemId: 222, kind: "warrior", effect: "+10 accuracy and +10% max hit", tier: 4 },
      { id: 1223, itemId: 223, kind: "elixir", effect: "+10% xp from everything", tier: 1 },
      { id: 2223, itemId: 223, kind: "elixir", effect: "+10% xp from everything", tier: 2 },
      { id: 3223, itemId: 223, kind: "elixir", effect: "+10% xp from everything", tier: 3 },
      { id: 4223, itemId: 223, kind: "elixir", effect: "+10% xp from everything", tier: 4 },
      { id: 1224, itemId: 224, kind: "abyssal", effect: "+25% coins from monsters", tier: 1 },
      { id: 2224, itemId: 224, kind: "abyssal", effect: "+25% coins from monsters", tier: 2 },
      { id: 3224, itemId: 224, kind: "abyssal", effect: "+25% coins from monsters", tier: 3 },
      { id: 4224, itemId: 224, kind: "abyssal", effect: "+25% coins from monsters", tier: 4 },
      { id: 1225, itemId: 225, kind: "swift", effect: "+20% movement speed", tier: 1 },
      { id: 2225, itemId: 225, kind: "swift", effect: "+20% movement speed", tier: 2 },
      { id: 3225, itemId: 225, kind: "swift", effect: "+20% movement speed", tier: 3 },
      { id: 4225, itemId: 225, kind: "swift", effect: "+20% movement speed", tier: 4 },
      { id: 1226, itemId: 226, kind: "nourish", effect: "+25% healing from food", tier: 1 },
      { id: 2226, itemId: 226, kind: "nourish", effect: "+25% healing from food", tier: 2 },
      { id: 3226, itemId: 226, kind: "nourish", effect: "+25% healing from food", tier: 3 },
      { id: 4226, itemId: 226, kind: "nourish", effect: "+25% healing from food", tier: 4 },
      { id: 1227, itemId: 227, kind: "haste", effect: "+20% attack speed", tier: 1 },
      { id: 2227, itemId: 227, kind: "haste", effect: "+20% attack speed", tier: 2 },
      { id: 3227, itemId: 227, kind: "haste", effect: "+20% attack speed", tier: 3 },
      { id: 4227, itemId: 227, kind: "haste", effect: "+20% attack speed", tier: 4 },
    ],
    vendorPrices: {
      1: 1,
      2: 1,
      3: 4,
      4: 16,
      5: 22,
      6: 56,
      7: 152,
      8: 360,
      10: 1,
      11: 6,
      12: 18,
      13: 40,
      14: 96,
      15: 240,
      20: 1,
      21: 3,
      22: 10,
      23: 19,
      24: 36,
      25: 70,
      26: 132,
      27: 312,
      40: 4,
      41: 8,
      42: 62,
      43: 264,
      44: 610,
      60: 3,
      61: 6,
      62: 17,
      63: 32,
      64: 60,
      65: 116,
      66: 220,
      67: 512,
      70: 1,
      80: 11,
      81: 21,
      82: 138,
      83: 574,
      84: 1384,
      85: 8,
      86: 18,
      87: 94,
      88: 406,
      89: 1013,
      90: 11,
      91: 21,
      92: 138,
      93: 574,
      94: 1384,
      100: 1000,
      110: 6,
      111: 12,
      112: 76,
      113: 310,
      114: 773,
      115: 16,
      116: 30,
      117: 200,
      118: 838,
      119: 1995,
      120: 11,
      121: 21,
      122: 138,
      123: 574,
      124: 1384,
      125: 26,
      126: 48,
      127: 325,
      128: 1366,
      129: 3216,
      130: 21,
      131: 39,
      132: 263,
      133: 1102,
      134: 2606,
      140: 3,
      141: 10,
      142: 31,
      143: 63,
      144: 142,
      145: 328,
      146: 4,
      147: 16,
      148: 49,
      149: 103,
      150: 238,
      151: 568,
      152: 4,
      153: 16,
      154: 49,
      155: 103,
      156: 238,
      157: 568,
      160: 1,
      161: 2,
      162: 5,
      163: 12,
      164: 24,
      165: 44,
      170: 2,
      171: 8,
      172: 22,
      173: 48,
      174: 104,
      175: 208,
      180: 1002,
      181: 1025,
      182: 1081,
      183: 2702,
      184: 1031,
      185: 1096,
      186: 2777,
      190: 2,
      191: 16,
      192: 88,
      193: 7,
      194: 44,
      195: 208,
      200: null,
      201: 600,
      202: 1600,
      203: 4800,
      204: 16000,
      205: 48000,
      206: 140000,
      207: 360000,
      208: 600,
      209: 100000,
      210: 400000,
      211: 1600000,
      212: 6000000,
      213: 6000,
      214: 12000,
      215: 20000,
      216: 48000,
      217: 100000,
      218: 200000,
      220: 11,
      221: 108,
      222: 334,
      223: 657,
      224: 841,
      225: 38,
      226: 154,
      227: 482,
      240: 2,
      241: 4,
      242: 24,
      243: 48,
      244: 80,
      245: 200,
      246: 280,
      247: 480,
      248: 320,
      249: 400,
      250: 600,
      251: 800,
      252: 1200,
      260: 6,
      261: 12,
      262: 8,
      263: 13,
      264: 28,
      265: 18,
      266: 61,
      267: 133,
      268: 85,
      269: 446,
      270: 1046,
      271: 646,
      272: 1122,
      273: 2562,
      274: 1602,
      280: null,
      281: null,
      282: null,
      283: null,
      284: null,
      285: null,
      286: null,
      287: null,
      288: null,
      289: null,
      290: null,
      291: null,
      292: null,
      293: 4,
      294: null,
      295: null,
      296: null,
      297: null,
      300: 4,
      301: 28,
      302: 104,
      303: 360,
      304: 11,
      305: 26,
      306: 16,
      307: 66,
      308: 150,
      309: 94,
      310: 238,
      311: 550,
      312: 342,
      313: 808,
      314: 1888,
      315: 1168,
      316: null,
      317: null,
      318: null,
      319: null,
      320: null,
      321: null,
      322: null,
      323: 30,
      324: 1600,
      325: 4800,
      326: 16000,
      327: 140000,
      328: 4000,
      329: 7,
      330: 19,
      331: 79,
      332: 486,
      333: 1218,
      334: 16,
      335: 99,
      336: 422,
      337: 1728,
      338: 873,
      339: 1833,
      340: 1193,
      341: 1860,
      342: 4260,
      343: 2660,
      344: 1520,
      345: 3800,
      346: 2480,
      347: 1113,
      348: 2340,
      349: 2480,
      350: 4492,
      351: 4492,
      352: 2681,
      353: 6914,
      354: 5103,
      355: 8000,
      356: 8000,
      357: 10237,
      358: 10237,
      359: 4,
      360: 6,
      361: 12,
      362: 76,
      363: 310,
      364: 773,
      365: 11,
      366: 21,
      367: 138,
      368: 574,
      369: 1384,
      370: 6,
      371: 12,
      372: 76,
      373: 310,
      374: 773,
      375: 6,
      376: 12,
      377: 76,
      378: 310,
      379: 773,
      380: 11,
      381: 21,
      382: 138,
      383: 574,
      384: 1384,
      385: 9,
      386: 24,
      387: 112,
      388: 502,
      389: 1253,
      390: 11,
      391: 21,
      392: 138,
      393: 574,
      394: 1384,
      395: 5081,
      396: 10,
      400: null,
      401: null,
      402: null,
      403: null,
      404: null,
      405: null,
      406: null,
      407: null,
      408: null,
      409: null,
      410: null,
      1001: 1,
      1002: 1,
      1003: 4,
      1004: 16,
      1005: 22,
      1006: 56,
      1007: 152,
      1008: 360,
      1010: 1,
      1011: 6,
      1012: 18,
      1013: 40,
      1014: 96,
      1015: 240,
      1020: 1,
      1021: 3,
      1022: 10,
      1023: 19,
      1024: 36,
      1025: 70,
      1026: 132,
      1027: 312,
      1040: 4,
      1041: 8,
      1042: 62,
      1043: 264,
      1044: 610,
      1060: 3,
      1061: 6,
      1062: 17,
      1063: 32,
      1064: 60,
      1065: 116,
      1066: 220,
      1067: 512,
      1080: 11,
      1081: 21,
      1082: 138,
      1083: 574,
      1084: 1384,
      1085: 8,
      1086: 18,
      1087: 94,
      1088: 406,
      1089: 1013,
      1090: 11,
      1091: 21,
      1092: 138,
      1093: 574,
      1094: 1384,
      1100: 1000,
      1110: 6,
      1111: 12,
      1112: 76,
      1113: 310,
      1114: 773,
      1115: 16,
      1116: 30,
      1117: 200,
      1118: 838,
      1119: 1995,
      1120: 11,
      1121: 21,
      1122: 138,
      1123: 574,
      1124: 1384,
      1125: 26,
      1126: 48,
      1127: 325,
      1128: 1366,
      1129: 3216,
      1130: 21,
      1131: 39,
      1132: 263,
      1133: 1102,
      1134: 2606,
      1140: 3,
      1141: 10,
      1142: 31,
      1143: 63,
      1144: 142,
      1145: 328,
      1146: 4,
      1147: 16,
      1148: 49,
      1149: 103,
      1150: 238,
      1151: 568,
      1152: 4,
      1153: 16,
      1154: 49,
      1155: 103,
      1156: 238,
      1157: 568,
      1160: 1,
      1161: 2,
      1162: 5,
      1163: 12,
      1164: 24,
      1165: 44,
      1170: 2,
      1171: 8,
      1172: 22,
      1173: 48,
      1174: 104,
      1175: 208,
      1180: 1002,
      1181: 1025,
      1182: 1081,
      1183: 2702,
      1184: 1031,
      1185: 1096,
      1186: 2777,
      1190: 2,
      1191: 16,
      1192: 88,
      1193: 7,
      1194: 44,
      1195: 208,
      1220: 11,
      1221: 108,
      1222: 334,
      1223: 657,
      1224: 841,
      1225: 38,
      1226: 154,
      1227: 482,
      1240: 2,
      1241: 4,
      1242: 24,
      1243: 48,
      1244: 80,
      1245: 200,
      1246: 280,
      1247: 480,
      1248: 320,
      1249: 400,
      1250: 600,
      1251: 800,
      1252: 1200,
      1260: 6,
      1261: 12,
      1262: 8,
      1263: 13,
      1264: 28,
      1265: 18,
      1266: 61,
      1267: 133,
      1268: 85,
      1269: 446,
      1270: 1046,
      1271: 646,
      1272: 1122,
      1273: 2562,
      1274: 1602,
      1300: 4,
      1301: 28,
      1302: 104,
      1303: 360,
      1304: 11,
      1305: 26,
      1306: 16,
      1307: 66,
      1308: 150,
      1309: 94,
      1310: 238,
      1311: 550,
      1312: 342,
      1313: 808,
      1314: 1888,
      1315: 1168,
      1323: 30,
      1324: 1600,
      1325: 4800,
      1326: 16000,
      1327: 140000,
      1328: 4000,
      1329: 7,
      1330: 19,
      1331: 79,
      1332: 486,
      1333: 1218,
      1334: 16,
      1335: 99,
      1336: 422,
      1337: 1728,
      1338: 873,
      1339: 1833,
      1340: 1193,
      1341: 1860,
      1342: 4260,
      1343: 2660,
      1344: 1520,
      1345: 3800,
      1346: 2480,
      1347: 1113,
      1348: 2340,
      1349: 2480,
      1350: 4492,
      1351: 4492,
      1352: 2681,
      1353: 6914,
      1354: 5103,
      1357: 10237,
      1358: 10237,
      1360: 6,
      1361: 12,
      1362: 76,
      1363: 310,
      1364: 773,
      1365: 11,
      1366: 21,
      1367: 138,
      1368: 574,
      1369: 1384,
      1370: 6,
      1371: 12,
      1372: 76,
      1373: 310,
      1374: 773,
      1375: 6,
      1376: 12,
      1377: 76,
      1378: 310,
      1379: 773,
      1380: 11,
      1381: 21,
      1382: 138,
      1383: 574,
      1384: 1384,
      1385: 9,
      1386: 24,
      1387: 112,
      1388: 502,
      1389: 1253,
      1390: 11,
      1391: 21,
      1392: 138,
      1393: 574,
      1394: 1384,
      1395: 5081,
      2001: 1,
      2002: 1,
      2003: 4,
      2004: 16,
      2005: 22,
      2006: 56,
      2007: 152,
      2008: 360,
      2010: 1,
      2011: 6,
      2012: 18,
      2013: 40,
      2014: 96,
      2015: 240,
      2020: 1,
      2021: 3,
      2022: 10,
      2023: 19,
      2024: 36,
      2025: 70,
      2026: 132,
      2027: 312,
      2040: 4,
      2041: 8,
      2042: 62,
      2043: 264,
      2044: 610,
      2060: 3,
      2061: 6,
      2062: 17,
      2063: 32,
      2064: 60,
      2065: 116,
      2066: 220,
      2067: 512,
      2080: 11,
      2081: 21,
      2082: 138,
      2083: 574,
      2084: 1384,
      2085: 8,
      2086: 18,
      2087: 94,
      2088: 406,
      2089: 1013,
      2090: 11,
      2091: 21,
      2092: 138,
      2093: 574,
      2094: 1384,
      2100: 1000,
      2110: 6,
      2111: 12,
      2112: 76,
      2113: 310,
      2114: 773,
      2115: 16,
      2116: 30,
      2117: 200,
      2118: 838,
      2119: 1995,
      2120: 11,
      2121: 21,
      2122: 138,
      2123: 574,
      2124: 1384,
      2125: 26,
      2126: 48,
      2127: 325,
      2128: 1366,
      2129: 3216,
      2130: 21,
      2131: 39,
      2132: 263,
      2133: 1102,
      2134: 2606,
      2140: 3,
      2141: 10,
      2142: 31,
      2143: 63,
      2144: 142,
      2145: 328,
      2146: 4,
      2147: 16,
      2148: 49,
      2149: 103,
      2150: 238,
      2151: 568,
      2152: 4,
      2153: 16,
      2154: 49,
      2155: 103,
      2156: 238,
      2157: 568,
      2160: 1,
      2161: 2,
      2162: 5,
      2163: 12,
      2164: 24,
      2165: 44,
      2170: 2,
      2171: 8,
      2172: 22,
      2173: 48,
      2174: 104,
      2175: 208,
      2180: 1002,
      2181: 1025,
      2182: 1081,
      2183: 2702,
      2184: 1031,
      2185: 1096,
      2186: 2777,
      2190: 2,
      2191: 16,
      2192: 88,
      2193: 7,
      2194: 44,
      2195: 208,
      2220: 11,
      2221: 108,
      2222: 334,
      2223: 657,
      2224: 841,
      2225: 38,
      2226: 154,
      2227: 482,
      2240: 2,
      2241: 4,
      2242: 24,
      2243: 48,
      2244: 80,
      2245: 200,
      2246: 280,
      2247: 480,
      2248: 320,
      2249: 400,
      2250: 600,
      2251: 800,
      2252: 1200,
      2260: 6,
      2261: 12,
      2262: 8,
      2263: 13,
      2264: 28,
      2265: 18,
      2266: 61,
      2267: 133,
      2268: 85,
      2269: 446,
      2270: 1046,
      2271: 646,
      2272: 1122,
      2273: 2562,
      2274: 1602,
      2300: 4,
      2301: 28,
      2302: 104,
      2303: 360,
      2304: 11,
      2305: 26,
      2306: 16,
      2307: 66,
      2308: 150,
      2309: 94,
      2310: 238,
      2311: 550,
      2312: 342,
      2313: 808,
      2314: 1888,
      2315: 1168,
      2323: 30,
      2324: 1600,
      2325: 4800,
      2326: 16000,
      2327: 140000,
      2328: 4000,
      2329: 7,
      2330: 19,
      2331: 79,
      2332: 486,
      2333: 1218,
      2334: 16,
      2335: 99,
      2336: 422,
      2337: 1728,
      2338: 873,
      2339: 1833,
      2340: 1193,
      2341: 1860,
      2342: 4260,
      2343: 2660,
      2344: 1520,
      2345: 3800,
      2346: 2480,
      2347: 1113,
      2348: 2340,
      2349: 2480,
      2350: 4492,
      2351: 4492,
      2352: 2681,
      2353: 6914,
      2354: 5103,
      2357: 10237,
      2358: 10237,
      2360: 6,
      2361: 12,
      2362: 76,
      2363: 310,
      2364: 773,
      2365: 11,
      2366: 21,
      2367: 138,
      2368: 574,
      2369: 1384,
      2370: 6,
      2371: 12,
      2372: 76,
      2373: 310,
      2374: 773,
      2375: 6,
      2376: 12,
      2377: 76,
      2378: 310,
      2379: 773,
      2380: 11,
      2381: 21,
      2382: 138,
      2383: 574,
      2384: 1384,
      2385: 9,
      2386: 24,
      2387: 112,
      2388: 502,
      2389: 1253,
      2390: 11,
      2391: 21,
      2392: 138,
      2393: 574,
      2394: 1384,
      2395: 5081,
      3001: 1,
      3002: 1,
      3003: 4,
      3004: 16,
      3005: 22,
      3006: 56,
      3007: 152,
      3008: 360,
      3010: 1,
      3011: 6,
      3012: 18,
      3013: 40,
      3014: 96,
      3015: 240,
      3020: 1,
      3021: 3,
      3022: 10,
      3023: 19,
      3024: 36,
      3025: 70,
      3026: 132,
      3027: 312,
      3040: 4,
      3041: 8,
      3042: 62,
      3043: 264,
      3044: 610,
      3060: 3,
      3061: 6,
      3062: 17,
      3063: 32,
      3064: 60,
      3065: 116,
      3066: 220,
      3067: 512,
      3080: 11,
      3081: 21,
      3082: 138,
      3083: 574,
      3084: 1384,
      3085: 8,
      3086: 18,
      3087: 94,
      3088: 406,
      3089: 1013,
      3090: 11,
      3091: 21,
      3092: 138,
      3093: 574,
      3094: 1384,
      3100: 1000,
      3110: 6,
      3111: 12,
      3112: 76,
      3113: 310,
      3114: 773,
      3115: 16,
      3116: 30,
      3117: 200,
      3118: 838,
      3119: 1995,
      3120: 11,
      3121: 21,
      3122: 138,
      3123: 574,
      3124: 1384,
      3125: 26,
      3126: 48,
      3127: 325,
      3128: 1366,
      3129: 3216,
      3130: 21,
      3131: 39,
      3132: 263,
      3133: 1102,
      3134: 2606,
      3140: 3,
      3141: 10,
      3142: 31,
      3143: 63,
      3144: 142,
      3145: 328,
      3146: 4,
      3147: 16,
      3148: 49,
      3149: 103,
      3150: 238,
      3151: 568,
      3152: 4,
      3153: 16,
      3154: 49,
      3155: 103,
      3156: 238,
      3157: 568,
      3160: 1,
      3161: 2,
      3162: 5,
      3163: 12,
      3164: 24,
      3165: 44,
      3170: 2,
      3171: 8,
      3172: 22,
      3173: 48,
      3174: 104,
      3175: 208,
      3180: 1002,
      3181: 1025,
      3182: 1081,
      3183: 2702,
      3184: 1031,
      3185: 1096,
      3186: 2777,
      3190: 2,
      3191: 16,
      3192: 88,
      3193: 7,
      3194: 44,
      3195: 208,
      3220: 11,
      3221: 108,
      3222: 334,
      3223: 657,
      3224: 841,
      3225: 38,
      3226: 154,
      3227: 482,
      3240: 2,
      3241: 4,
      3242: 24,
      3243: 48,
      3244: 80,
      3245: 200,
      3246: 280,
      3247: 480,
      3248: 320,
      3249: 400,
      3250: 600,
      3251: 800,
      3252: 1200,
      3260: 6,
      3261: 12,
      3262: 8,
      3263: 13,
      3264: 28,
      3265: 18,
      3266: 61,
      3267: 133,
      3268: 85,
      3269: 446,
      3270: 1046,
      3271: 646,
      3272: 1122,
      3273: 2562,
      3274: 1602,
      3300: 4,
      3301: 28,
      3302: 104,
      3303: 360,
      3304: 11,
      3305: 26,
      3306: 16,
      3307: 66,
      3308: 150,
      3309: 94,
      3310: 238,
      3311: 550,
      3312: 342,
      3313: 808,
      3314: 1888,
      3315: 1168,
      3323: 30,
      3324: 1600,
      3325: 4800,
      3326: 16000,
      3327: 140000,
      3328: 4000,
      3329: 7,
      3330: 19,
      3331: 79,
      3332: 486,
      3333: 1218,
      3334: 16,
      3335: 99,
      3336: 422,
      3337: 1728,
      3338: 873,
      3339: 1833,
      3340: 1193,
      3341: 1860,
      3342: 4260,
      3343: 2660,
      3344: 1520,
      3345: 3800,
      3346: 2480,
      3347: 1113,
      3348: 2340,
      3349: 2480,
      3350: 4492,
      3351: 4492,
      3352: 2681,
      3353: 6914,
      3354: 5103,
      3357: 10237,
      3358: 10237,
      3360: 6,
      3361: 12,
      3362: 76,
      3363: 310,
      3364: 773,
      3365: 11,
      3366: 21,
      3367: 138,
      3368: 574,
      3369: 1384,
      3370: 6,
      3371: 12,
      3372: 76,
      3373: 310,
      3374: 773,
      3375: 6,
      3376: 12,
      3377: 76,
      3378: 310,
      3379: 773,
      3380: 11,
      3381: 21,
      3382: 138,
      3383: 574,
      3384: 1384,
      3385: 9,
      3386: 24,
      3387: 112,
      3388: 502,
      3389: 1253,
      3390: 11,
      3391: 21,
      3392: 138,
      3393: 574,
      3394: 1384,
      3395: 5081,
      4001: 1,
      4002: 1,
      4003: 4,
      4004: 16,
      4005: 22,
      4006: 56,
      4007: 152,
      4008: 360,
      4010: 1,
      4011: 6,
      4012: 18,
      4013: 40,
      4014: 96,
      4015: 240,
      4020: 1,
      4021: 3,
      4022: 10,
      4023: 19,
      4024: 36,
      4025: 70,
      4026: 132,
      4027: 312,
      4040: 4,
      4041: 8,
      4042: 62,
      4043: 264,
      4044: 610,
      4060: 3,
      4061: 6,
      4062: 17,
      4063: 32,
      4064: 60,
      4065: 116,
      4066: 220,
      4067: 512,
      4080: 11,
      4081: 21,
      4082: 138,
      4083: 574,
      4084: 1384,
      4085: 8,
      4086: 18,
      4087: 94,
      4088: 406,
      4089: 1013,
      4090: 11,
      4091: 21,
      4092: 138,
      4093: 574,
      4094: 1384,
      4100: 1000,
      4110: 6,
      4111: 12,
      4112: 76,
      4113: 310,
      4114: 773,
      4115: 16,
      4116: 30,
      4117: 200,
      4118: 838,
      4119: 1995,
      4120: 11,
      4121: 21,
      4122: 138,
      4123: 574,
      4124: 1384,
      4125: 26,
      4126: 48,
      4127: 325,
      4128: 1366,
      4129: 3216,
      4130: 21,
      4131: 39,
      4132: 263,
      4133: 1102,
      4134: 2606,
      4140: 3,
      4141: 10,
      4142: 31,
      4143: 63,
      4144: 142,
      4145: 328,
      4146: 4,
      4147: 16,
      4148: 49,
      4149: 103,
      4150: 238,
      4151: 568,
      4152: 4,
      4153: 16,
      4154: 49,
      4155: 103,
      4156: 238,
      4157: 568,
      4160: 1,
      4161: 2,
      4162: 5,
      4163: 12,
      4164: 24,
      4165: 44,
      4170: 2,
      4171: 8,
      4172: 22,
      4173: 48,
      4174: 104,
      4175: 208,
      4180: 1002,
      4181: 1025,
      4182: 1081,
      4183: 2702,
      4184: 1031,
      4185: 1096,
      4186: 2777,
      4190: 2,
      4191: 16,
      4192: 88,
      4193: 7,
      4194: 44,
      4195: 208,
      4220: 11,
      4221: 108,
      4222: 334,
      4223: 657,
      4224: 841,
      4225: 38,
      4226: 154,
      4227: 482,
      4240: 2,
      4241: 4,
      4242: 24,
      4243: 48,
      4244: 80,
      4245: 200,
      4246: 280,
      4247: 480,
      4248: 320,
      4249: 400,
      4250: 600,
      4251: 800,
      4252: 1200,
      4260: 6,
      4261: 12,
      4262: 8,
      4263: 13,
      4264: 28,
      4265: 18,
      4266: 61,
      4267: 133,
      4268: 85,
      4269: 446,
      4270: 1046,
      4271: 646,
      4272: 1122,
      4273: 2562,
      4274: 1602,
      4300: 4,
      4301: 28,
      4302: 104,
      4303: 360,
      4304: 11,
      4305: 26,
      4306: 16,
      4307: 66,
      4308: 150,
      4309: 94,
      4310: 238,
      4311: 550,
      4312: 342,
      4313: 808,
      4314: 1888,
      4315: 1168,
      4323: 30,
      4324: 1600,
      4325: 4800,
      4326: 16000,
      4327: 140000,
      4328: 4000,
      4329: 7,
      4330: 19,
      4331: 79,
      4332: 486,
      4333: 1218,
      4334: 16,
      4335: 99,
      4336: 422,
      4337: 1728,
      4338: 873,
      4339: 1833,
      4340: 1193,
      4341: 1860,
      4342: 4260,
      4343: 2660,
      4344: 1520,
      4345: 3800,
      4346: 2480,
      4347: 1113,
      4348: 2340,
      4349: 2480,
      4350: 4492,
      4351: 4492,
      4352: 2681,
      4353: 6914,
      4354: 5103,
      4357: 10237,
      4358: 10237,
      4360: 6,
      4361: 12,
      4362: 76,
      4363: 310,
      4364: 773,
      4365: 11,
      4366: 21,
      4367: 138,
      4368: 574,
      4369: 1384,
      4370: 6,
      4371: 12,
      4372: 76,
      4373: 310,
      4374: 773,
      4375: 6,
      4376: 12,
      4377: 76,
      4378: 310,
      4379: 773,
      4380: 11,
      4381: 21,
      4382: 138,
      4383: 574,
      4384: 1384,
      4385: 9,
      4386: 24,
      4387: 112,
      4388: 502,
      4389: 1253,
      4390: 11,
      4391: 21,
      4392: 138,
      4393: 574,
      4394: 1384,
      4395: 5081,
    },
    vendorBuys: { 60: 18, 80: 58, 85: 40, 90: 58, 160: 8, 161: 24, 162: 56, 190: 24, 328: 20000 },
    farming: {
      unlockLevels: [1, 1, 15, 30, 45, 60],
      waterEvery: 100,
      waterTrim: 20,
      waterXp: 0.1,
      harvestMin: 3,
      harvestMax: 5,
    },
    world: {
      width: 288,
      height: 256,
      collision: [
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
        1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        1, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 1, 1, 0,
        0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
        1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1,
        1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1,
        1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1,
        1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 1,
        1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0,
        1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0,
        0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
        1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1,
        1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1,
        1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 0, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1,
        0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1,
        1, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
        1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0,
        0, 1, 0, 1, 1, 1, 1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0,
        0, 0, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1,
        1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0,
        1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0,
        0, 0, 0, 0, 1, 1, 1, 0, 0, 1, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0,
        0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0,
        0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0,
        0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1,
        1, 1, 1, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0,
        0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0,
        0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 1, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0,
        0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1,
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0,
        1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1,
        1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 1,
        1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 0,
        1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0,
        1, 1, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0,
        1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 0, 1, 1, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0,
        0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0,
        0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 0,
        0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1,
        0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0,
        0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
        1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1,
        1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 1, 0, 0, 0,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0,
        0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0,
        1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        1, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0,
        1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1,
        1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1,
        1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0,
        0, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1,
        1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
        1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0,
        0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0,
        0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1,
        1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0,
        0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0,
        0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1,
        1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 1, 1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0,
        0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 0,
        1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1,
        1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 0, 1,
        1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0,
        1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0,
        0, 0, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1,
        0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 1, 1, 1, 1,
        1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0,
        0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1,
        0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0,
        0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1,
        1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1,
        1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1,
        1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 0, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0,
        0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1,
        1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1,
        1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1,
        1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 0, 0,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0,
        0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 0, 0, 0,
        0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0,
        0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
        0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0,
        1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1,
        0, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1,
        1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
        0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 1, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 0, 0, 1, 0, 1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1,
        0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0,
        1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0,
        0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 0, 1,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 0, 1, 0, 0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1,
        1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1,
        0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1,
        0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 1, 0,
        0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1,
        1, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1,
        1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 0,
        0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1,
        1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0,
        1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 1, 1, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0,
        0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
        1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 1,
        1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1,
        1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1,
        1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1,
        1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0,
        0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1,
        1, 1, 0, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1,
        1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0,
        0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0,
        0, 1, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1,
        1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0,
        1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
        1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0,
        0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1,
        1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1,
        1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0,
        0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0,
        0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 1, 1, 0, 0, 1,
        1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1,
        1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1,
        0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0,
        0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0,
        1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0,
        0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1,
        1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0,
        0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1,
        1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0,
        0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1,
        1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 1, 1, 1, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0,
        0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
        1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1,
        1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1,
        1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1,
        1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0,
        1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 1, 0, 1, 1, 1, 1,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1,
        1, 1, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0,
        0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1,
        1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0,
        0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0,
        1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0,
        1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0,
        0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0,
        0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0,
        0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1,
        1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1,
        1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1,
        1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0,
        0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1,
        1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0,
        0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0,
        0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0,
        1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 0, 1, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1,
        1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        1, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0,
        0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1,
        1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
        1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
        1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1,
        1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1,
        1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1,
        1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0, 1,
        1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1,
        1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1,
        0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        1, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0,
        1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0,
        0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 1, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
        1, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
        1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
        0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0,
        0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
        1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1,
        1, 1, 0, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1,
        1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1,
        1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
        0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
      ],
      sites: [
        { id: 1, x: 187, y: 78, kind: "rock", jobIds: [1] },
        { id: 2, x: 194, y: 91, kind: "rock", jobIds: [2] },
        { id: 3, x: 200, y: 60, kind: "rock", jobIds: [1] },
        { id: 4, x: 196, y: 62, kind: "rock", jobIds: [1] },
        { id: 5, x: 200, y: 56, kind: "rock", jobIds: [2] },
        { id: 6, x: 192, y: 63, kind: "rock", jobIds: [2] },
        { id: 7, x: 196, y: 57, kind: "rock", jobIds: [3] },
        { id: 8, x: 200, y: 52, kind: "rock", jobIds: [3] },
        { id: 9, x: 204, y: 55, kind: "rock", jobIds: [3] },
        { id: 10, x: 200, y: 45, kind: "rock", jobIds: [4] },
        { id: 11, x: 196, y: 49, kind: "rock", jobIds: [4] },
        { id: 12, x: 204, y: 49, kind: "rock", jobIds: [4] },
        { id: 13, x: 198, y: 37, kind: "rock", jobIds: [5] },
        { id: 14, x: 202, y: 40, kind: "rock", jobIds: [5] },
        { id: 15, x: 197, y: 41, kind: "rock", jobIds: [5] },
        { id: 16, x: 194, y: 37, kind: "rock", jobIds: [6] },
        { id: 17, x: 190, y: 41, kind: "rock", jobIds: [6] },
        { id: 18, x: 186, y: 45, kind: "rock", jobIds: [6] },
        { id: 19, x: 190, y: 33, kind: "rock", jobIds: [7] },
        { id: 20, x: 186, y: 37, kind: "rock", jobIds: [7] },
        { id: 21, x: 182, y: 41, kind: "rock", jobIds: [7] },
        { id: 22, x: 181, y: 35, kind: "rock", jobIds: [8] },
        { id: 23, x: 177, y: 39, kind: "rock", jobIds: [8] },
        { id: 24, x: 185, y: 33, kind: "rock", jobIds: [8] },
        { id: 25, x: 214, y: 83, kind: "fishing", jobIds: [21] },
        { id: 26, x: 216, y: 79, kind: "fishing", jobIds: [21] },
        { id: 27, x: 214, y: 89, kind: "fishing", jobIds: [22] },
        { id: 28, x: 208, y: 65, kind: "fishing", jobIds: [22] },
        { id: 29, x: 218, y: 75, kind: "fishing", jobIds: [23] },
        { id: 30, x: 205, y: 60, kind: "fishing", jobIds: [23] },
        { id: 31, x: 212, y: 67, kind: "fishing", jobIds: [24] },
        { id: 32, x: 217, y: 93, kind: "fishing", jobIds: [24] },
        { id: 33, x: 216, y: 69, kind: "fishing", jobIds: [25] },
        { id: 34, x: 230, y: 82, kind: "fishing", jobIds: [25] },
        { id: 35, x: 220, y: 71, kind: "fishing", jobIds: [26] },
        { id: 36, x: 205, y: 54, kind: "fishing", jobIds: [26] },
        { id: 37, x: 168, y: 80, kind: "fishing", jobIds: [27] },
        { id: 38, x: 171, y: 87, kind: "fishing", jobIds: [27] },
        { id: 39, x: 221, y: 95, kind: "fishing", jobIds: [28] },
        { id: 40, x: 173, y: 91, kind: "fishing", jobIds: [28] },
        { id: 41, x: 204, y: 77, kind: "fountain", jobIds: [] },
        { id: 42, x: 197, y: 85, kind: "furnace", jobIds: [41, 42, 43, 44, 45] },
        {
          id: 43,
          x: 204,
          y: 86,
          kind: "anvil",
          jobIds: [
            51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 308, 309, 310, 311, 312, 313, 314, 315, 316,
            317, 318, 319, 320, 321, 322, 323, 324, 325, 326, 327, 328, 329, 330, 331, 332, 333,
            334, 335, 336, 337, 46, 47, 48, 49, 50, 110, 111, 112, 113, 114, 338, 339, 340, 341,
            342, 343, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129,
            130, 131, 132, 133, 134, 301, 302, 303, 304, 305, 140, 141, 142, 143, 144, 145, 146,
            147, 148, 149, 150, 151, 200, 201, 202, 203, 204, 205, 230, 231, 232, 233, 307, 234,
            235, 236, 306, 260, 261, 262, 263, 264, 265, 266, 267, 268, 269, 270, 271, 272, 273,
            274, 289, 290, 291, 292, 293, 294, 248, 249, 250, 251, 252, 253, 254, 255, 256, 257,
            258, 259, 295, 296, 297, 275, 276, 277, 278, 280, 281, 282, 283, 284, 298, 299, 285,
            286, 287, 288, 300, 279,
          ],
        },
        {
          id: 44,
          x: 202,
          y: 83,
          kind: "fire",
          jobIds: [61, 62, 63, 64, 65, 66, 67, 68, 220, 225, 226, 227, 221, 222, 223, 224],
        },
        { id: 45, x: 110, y: 181, kind: "fountain", jobIds: [] },
        { id: 46, x: 113, y: 177, kind: "furnace", jobIds: [41, 42, 43, 44, 45] },
        {
          id: 47,
          x: 113,
          y: 180,
          kind: "anvil",
          jobIds: [
            51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 308, 309, 310, 311, 312, 313, 314, 315, 316,
            317, 318, 319, 320, 321, 322, 323, 324, 325, 326, 327, 328, 329, 330, 331, 332, 333,
            334, 335, 336, 337, 46, 47, 48, 49, 50, 110, 111, 112, 113, 114, 338, 339, 340, 341,
            342, 343, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129,
            130, 131, 132, 133, 134, 301, 302, 303, 304, 305, 140, 141, 142, 143, 144, 145, 146,
            147, 148, 149, 150, 151, 200, 201, 202, 203, 204, 205, 230, 231, 232, 233, 307, 234,
            235, 236, 306, 260, 261, 262, 263, 264, 265, 266, 267, 268, 269, 270, 271, 272, 273,
            274, 289, 290, 291, 292, 293, 294, 248, 249, 250, 251, 252, 253, 254, 255, 256, 257,
            258, 259, 295, 296, 297, 275, 276, 277, 278, 280, 281, 282, 283, 284, 298, 299, 285,
            286, 287, 288, 300, 279,
          ],
        },
        {
          id: 48,
          x: 110,
          y: 179,
          kind: "fire",
          jobIds: [61, 62, 63, 64, 65, 66, 67, 68, 220, 225, 226, 227, 221, 222, 223, 224],
        },
        { id: 49, x: 205, y: 126, kind: "fountain", jobIds: [] },
        { id: 50, x: 222, y: 144, kind: "fountain", jobIds: [] },
        { id: 51, x: 241, y: 77, kind: "fountain", jobIds: [] },
        { id: 52, x: 130, y: 181, kind: "fountain", jobIds: [] },
        { id: 53, x: 220, y: 169, kind: "fountain", jobIds: [] },
        { id: 54, x: 93, y: 41, kind: "fountain", jobIds: [] },
        { id: 55, x: 86, y: 7, kind: "fountain", jobIds: [] },
        { id: 56, x: 172, y: 39, kind: "tree", jobIds: [30] },
        { id: 57, x: 167, y: 43, kind: "tree", jobIds: [30] },
        { id: 58, x: 174, y: 34, kind: "tree", jobIds: [30] },
        { id: 59, x: 174, y: 29, kind: "tree", jobIds: [31] },
        { id: 60, x: 169, y: 34, kind: "tree", jobIds: [31] },
        { id: 61, x: 162, y: 41, kind: "tree", jobIds: [31] },
        { id: 62, x: 171, y: 23, kind: "tree", jobIds: [32] },
        { id: 63, x: 166, y: 28, kind: "tree", jobIds: [32] },
        { id: 64, x: 161, y: 33, kind: "tree", jobIds: [32] },
        { id: 65, x: 168, y: 18, kind: "tree", jobIds: [33] },
        { id: 66, x: 163, y: 23, kind: "tree", jobIds: [33] },
        { id: 67, x: 158, y: 28, kind: "tree", jobIds: [33] },
        { id: 68, x: 161, y: 16, kind: "tree", jobIds: [34] },
        { id: 69, x: 156, y: 21, kind: "tree", jobIds: [34] },
        { id: 70, x: 151, y: 26, kind: "tree", jobIds: [34] },
        { id: 71, x: 151, y: 18, kind: "tree", jobIds: [35] },
        { id: 72, x: 146, y: 25, kind: "tree", jobIds: [35] },
        { id: 73, x: 156, y: 16, kind: "tree", jobIds: [35] },
        {
          id: 74,
          x: 207,
          y: 93,
          kind: "field",
          jobIds: [160, 161, 162, 163, 164, 165, 210, 211, 212],
        },
        {
          id: 75,
          x: 209,
          y: 93,
          kind: "field",
          jobIds: [160, 161, 162, 163, 164, 165, 210, 211, 212],
        },
        {
          id: 76,
          x: 211,
          y: 93,
          kind: "field",
          jobIds: [160, 161, 162, 163, 164, 165, 210, 211, 212],
        },
        {
          id: 77,
          x: 207,
          y: 97,
          kind: "field",
          jobIds: [160, 161, 162, 163, 164, 165, 210, 211, 212],
        },
        {
          id: 78,
          x: 209,
          y: 97,
          kind: "field",
          jobIds: [160, 161, 162, 163, 164, 165, 210, 211, 212],
        },
        {
          id: 79,
          x: 211,
          y: 97,
          kind: "field",
          jobIds: [160, 161, 162, 163, 164, 165, 210, 211, 212],
        },
        { id: 80, x: 196, y: 77, kind: "stall", jobIds: [240] },
        { id: 81, x: 198, y: 77, kind: "stall", jobIds: [241] },
        { id: 82, x: 200, y: 77, kind: "stall", jobIds: [242] },
        { id: 83, x: 202, y: 77, kind: "stall", jobIds: [243] },
        { id: 84, x: 115, y: 179, kind: "stall", jobIds: [240] },
        { id: 85, x: 115, y: 181, kind: "stall", jobIds: [241] },
        { id: 86, x: 112, y: 182, kind: "stall", jobIds: [242] },
        { id: 87, x: 116, y: 171, kind: "stall", jobIds: [243] },
        { id: 88, x: 198, y: 79, kind: "scenery", jobIds: [], look: "depot-wing" },
        { id: 89, x: 199, y: 79, kind: "scenery", jobIds: [], look: "depot-wing" },
        { id: 90, x: 200, y: 79, kind: "scenery", jobIds: [], look: "depot-wing" },
        { id: 91, x: 201, y: 79, kind: "scenery", jobIds: [], look: "depot-wing" },
        { id: 92, x: 202, y: 79, kind: "scenery", jobIds: [], look: "depot-wing" },
        { id: 93, x: 198, y: 80, kind: "scenery", jobIds: [], look: "depot-wing" },
        { id: 94, x: 199, y: 80, kind: "scenery", jobIds: [], look: "depot-wing" },
        { id: 95, x: 200, y: 80, kind: "scenery", jobIds: [], look: "depot-wing" },
        { id: 96, x: 201, y: 80, kind: "scenery", jobIds: [], look: "depot-wing" },
        { id: 97, x: 202, y: 80, kind: "scenery", jobIds: [], look: "depot-wing" },
        { id: 98, x: 198, y: 81, kind: "scenery", jobIds: [], look: "depot-wing" },
        { id: 99, x: 199, y: 81, kind: "scenery", jobIds: [], look: "depot-wing" },
        { id: 100, x: 200, y: 81, kind: "scenery", jobIds: [], look: "depot-wing" },
        { id: 101, x: 201, y: 81, kind: "scenery", jobIds: [], look: "depot-wing" },
        { id: 102, x: 202, y: 81, kind: "scenery", jobIds: [], look: "depot-wing" },
        { id: 103, x: 196, y: 79, kind: "scenery", jobIds: [], look: "well" },
        { id: 104, x: 204, y: 79, kind: "scenery", jobIds: [], look: "board" },
        { id: 105, x: 194, y: 79, kind: "scenery", jobIds: [], look: "lantern" },
        { id: 106, x: 206, y: 79, kind: "scenery", jobIds: [], look: "lantern" },
        { id: 107, x: 195, y: 86, kind: "scenery", jobIds: [], look: "lantern" },
        { id: 108, x: 203, y: 88, kind: "scenery", jobIds: [], look: "lantern" },
        { id: 109, x: 197, y: 83, kind: "scenery", jobIds: [], look: "bench" },
        { id: 110, x: 204, y: 82, kind: "scenery", jobIds: [], look: "bench" },
        { id: 111, x: 200, y: 84, kind: "scenery", jobIds: [], look: "crates" },
        { id: 112, x: 196, y: 81, kind: "scenery", jobIds: [], look: "barrel" },
        { id: 113, x: 194, y: 81, kind: "scenery", jobIds: [], look: "planter" },
        { id: 114, x: 206, y: 81, kind: "scenery", jobIds: [], look: "planter" },
        { id: 115, x: 197, y: 87, kind: "scenery", jobIds: [], look: "town-tree" },
        { id: 116, x: 193, y: 72, kind: "scenery", jobIds: [], look: "house-a" },
        { id: 117, x: 192, y: 71, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 118, x: 193, y: 71, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 119, x: 194, y: 71, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 120, x: 192, y: 72, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 121, x: 194, y: 72, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 122, x: 198, y: 72, kind: "scenery", jobIds: [], look: "house-b" },
        { id: 123, x: 198, y: 71, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 124, x: 199, y: 71, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 125, x: 199, y: 72, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 126, x: 203, y: 72, kind: "scenery", jobIds: [], look: "house-c" },
        { id: 127, x: 202, y: 71, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 128, x: 203, y: 71, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 129, x: 204, y: 71, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 130, x: 205, y: 71, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 131, x: 202, y: 72, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 132, x: 204, y: 72, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 133, x: 205, y: 72, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 134, x: 208, y: 72, kind: "scenery", jobIds: [], look: "house-g" },
        { id: 135, x: 208, y: 71, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 136, x: 209, y: 71, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 137, x: 209, y: 72, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 138, x: 192, y: 77, kind: "scenery", jobIds: [], look: "house-d" },
        { id: 139, x: 192, y: 75, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 140, x: 193, y: 75, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 141, x: 192, y: 76, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 142, x: 193, y: 76, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 143, x: 193, y: 77, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 144, x: 190, y: 86, kind: "scenery", jobIds: [], look: "house-f" },
        { id: 145, x: 189, y: 85, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 146, x: 190, y: 85, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 147, x: 191, y: 85, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 148, x: 189, y: 86, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 149, x: 191, y: 86, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 150, x: 209, y: 87, kind: "scenery", jobIds: [], look: "house-h" },
        { id: 151, x: 208, y: 86, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 152, x: 209, y: 86, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 153, x: 210, y: 86, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 154, x: 208, y: 87, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 155, x: 210, y: 87, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 156, x: 185, y: 95, kind: "scenery", jobIds: [], look: "house-e" },
        { id: 157, x: 184, y: 93, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 158, x: 185, y: 93, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 159, x: 186, y: 93, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 160, x: 184, y: 94, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 161, x: 185, y: 94, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 162, x: 186, y: 94, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 163, x: 184, y: 95, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 164, x: 186, y: 95, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 165, x: 192, y: 95, kind: "scenery", jobIds: [], look: "house-i" },
        { id: 166, x: 192, y: 93, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 167, x: 193, y: 93, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 168, x: 192, y: 94, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 169, x: 193, y: 94, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 170, x: 193, y: 95, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 171, x: 185, y: 102, kind: "scenery", jobIds: [], look: "house-j" },
        { id: 172, x: 184, y: 100, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 173, x: 185, y: 100, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 174, x: 186, y: 100, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 175, x: 184, y: 101, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 176, x: 185, y: 101, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 177, x: 186, y: 101, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 178, x: 184, y: 102, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 179, x: 186, y: 102, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 180, x: 192, y: 102, kind: "scenery", jobIds: [], look: "house-b" },
        { id: 181, x: 192, y: 101, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 182, x: 193, y: 101, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 183, x: 193, y: 102, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 184, x: 188, y: 98, kind: "scenery", jobIds: [], look: "well" },
        { id: 185, x: 190, y: 98, kind: "scenery", jobIds: [], look: "lantern" },
        { id: 186, x: 181, y: 98, kind: "scenery", jobIds: [], look: "town-tree" },
        { id: 187, x: 212, y: 81, kind: "scenery", jobIds: [], look: "hut-fisher" },
        { id: 188, x: 212, y: 80, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 189, x: 213, y: 80, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 190, x: 213, y: 81, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 191, x: 209, y: 69, kind: "scenery", jobIds: [], look: "hut-fisher" },
        { id: 192, x: 209, y: 68, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 193, x: 210, y: 68, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 194, x: 210, y: 69, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 195, x: 214, y: 96, kind: "scenery", jobIds: [], look: "hut-fisher" },
        { id: 196, x: 214, y: 95, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 197, x: 215, y: 95, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 198, x: 215, y: 96, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 199, x: 174, y: 89, kind: "scenery", jobIds: [], look: "hut-fisher" },
        { id: 200, x: 174, y: 88, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 201, x: 175, y: 88, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 202, x: 175, y: 89, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 203, x: 208, y: 49, kind: "scenery", jobIds: [], look: "hut-fisher" },
        { id: 204, x: 208, y: 48, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 205, x: 209, y: 48, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 206, x: 209, y: 49, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 207, x: 232, y: 80, kind: "scenery", jobIds: [], look: "hut-fisher" },
        { id: 208, x: 232, y: 79, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 209, x: 233, y: 79, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 210, x: 233, y: 80, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 211, x: 170, y: 45, kind: "scenery", jobIds: [], look: "hut-lumber" },
        { id: 212, x: 169, y: 44, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 213, x: 170, y: 44, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 214, x: 171, y: 44, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 215, x: 169, y: 45, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 216, x: 171, y: 45, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 217, x: 177, y: 25, kind: "scenery", jobIds: [], look: "hut-lumber" },
        { id: 218, x: 176, y: 24, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 219, x: 177, y: 24, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 220, x: 178, y: 24, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 221, x: 176, y: 25, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 222, x: 178, y: 25, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 223, x: 202, y: 62, kind: "scenery", jobIds: [], look: "hut-miner" },
        { id: 224, x: 202, y: 61, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 225, x: 203, y: 61, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 226, x: 203, y: 62, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 227, x: 192, y: 80, kind: "scenery", jobIds: [], look: "signpost:quarry" },
        { id: 228, x: 190, y: 83, kind: "scenery", jobIds: [], look: "signpost:forest" },
        { id: 229, x: 208, y: 80, kind: "scenery", jobIds: [], look: "signpost:shore" },
        { id: 230, x: 200, y: 90, kind: "scenery", jobIds: [], look: "signpost:second depot" },
        { id: 231, x: 203, y: 90, kind: "scenery", jobIds: [], look: "signpost:The Warrens" },
        { id: 232, x: 210, y: 80, kind: "scenery", jobIds: [], look: "signpost:Mirefen" },
        { id: 233, x: 207, y: 84, kind: "scenery", jobIds: [], look: "signpost:Dust Hollow" },
        { id: 234, x: 207, y: 89, kind: "scenery", jobIds: [], look: "signpost:farm" },
        { id: 235, x: 179, y: 101, kind: "scenery", jobIds: [], look: "ruin-wall" },
        { id: 236, x: 181, y: 101, kind: "scenery", jobIds: [], look: "ruin-wall" },
        { id: 237, x: 181, y: 106, kind: "scenery", jobIds: [], look: "ruin-pillar" },
        { id: 238, x: 222, y: 102, kind: "scenery", jobIds: [], look: "standing-stone" },
        { id: 239, x: 224, y: 104, kind: "scenery", jobIds: [], look: "standing-stone" },
        { id: 240, x: 222, y: 106, kind: "scenery", jobIds: [], look: "standing-stone" },
        { id: 241, x: 219, y: 103, kind: "scenery", jobIds: [], look: "standing-stone" },
        { id: 242, x: 224, y: 102, kind: "scenery", jobIds: [], look: "standing-stone" },
        { id: 243, x: 219, y: 105, kind: "scenery", jobIds: [], look: "standing-stone" },
        { id: 244, x: 198, y: 54, kind: "scenery", jobIds: [], look: "cart" },
        { id: 245, x: 175, y: 37, kind: "scenery", jobIds: [], look: "hut" },
        { id: 246, x: 209, y: 95, kind: "scenery", jobIds: [], look: "windmill" },
        { id: 247, x: 215, y: 100, kind: "scenery", jobIds: [], look: "barn" },
        { id: 248, x: 207, y: 95, kind: "scenery", jobIds: [], look: "haystack" },
        { id: 249, x: 211, y: 95, kind: "scenery", jobIds: [], look: "scarecrow" },
        { id: 250, x: 205, y: 99, kind: "scenery", jobIds: [], look: "fence" },
        { id: 251, x: 213, y: 99, kind: "scenery", jobIds: [], look: "fence" },
        { id: 252, x: 209, y: 84, kind: "scenery", jobIds: [], look: "barrels" },
        { id: 253, x: 215, y: 77, kind: "scenery", jobIds: [], look: "boat" },
        { id: 254, x: 212, y: 69, kind: "scenery", jobIds: [], look: "net-rack" },
        { id: 255, x: 206, y: 69, kind: "scenery", jobIds: [], look: "barrels" },
        { id: 256, x: 214, y: 67, kind: "scenery", jobIds: [], look: "boat" },
        { id: 257, x: 217, y: 96, kind: "scenery", jobIds: [], look: "net-rack" },
        { id: 258, x: 210, y: 99, kind: "scenery", jobIds: [], look: "barrels" },
        { id: 259, x: 177, y: 88, kind: "scenery", jobIds: [], look: "net-rack" },
        { id: 260, x: 176, y: 93, kind: "scenery", jobIds: [], look: "boat" },
        { id: 261, x: 178, y: 95, kind: "scenery", jobIds: [], look: "gull" },
        { id: 262, x: 211, y: 48, kind: "scenery", jobIds: [], look: "net-rack" },
        { id: 263, x: 211, y: 50, kind: "scenery", jobIds: [], look: "boat" },
        { id: 264, x: 213, y: 50, kind: "scenery", jobIds: [], look: "gull" },
        { id: 265, x: 235, y: 79, kind: "scenery", jobIds: [], look: "net-rack" },
        { id: 266, x: 232, y: 82, kind: "scenery", jobIds: [], look: "barrels" },
        { id: 267, x: 233, y: 77, kind: "scenery", jobIds: [], look: "boat" },
        { id: 268, x: 235, y: 85, kind: "scenery", jobIds: [], look: "gull" },
        { id: 269, x: 173, y: 43, kind: "scenery", jobIds: [], look: "woodpile" },
        { id: 270, x: 167, y: 45, kind: "scenery", jobIds: [], look: "sawbuck" },
        { id: 271, x: 171, y: 47, kind: "scenery", jobIds: [], look: "stump-axe" },
        { id: 272, x: 180, y: 25, kind: "scenery", jobIds: [], look: "woodpile" },
        { id: 273, x: 177, y: 27, kind: "scenery", jobIds: [], look: "sawbuck" },
        { id: 274, x: 179, y: 27, kind: "scenery", jobIds: [], look: "stump-axe" },
        { id: 275, x: 205, y: 62, kind: "scenery", jobIds: [], look: "minecart" },
        { id: 276, x: 204, y: 84, kind: "scenery", jobIds: [], look: "forge-shed" },
        { id: 277, x: 202, y: 85, kind: "scenery", jobIds: [], look: "trade-wagon" },
        { id: 278, x: 189, y: 90, kind: "scenery", jobIds: [], look: "house-inn" },
        { id: 279, x: 188, y: 88, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 280, x: 189, y: 88, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 281, x: 190, y: 88, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 282, x: 191, y: 88, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 283, x: 188, y: 89, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 284, x: 189, y: 89, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 285, x: 190, y: 89, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 286, x: 191, y: 89, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 287, x: 188, y: 90, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 288, x: 190, y: 90, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 289, x: 191, y: 90, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 290, x: 193, y: 89, kind: "scenery", jobIds: [], look: "inn-sign" },
        { id: 291, x: 186, y: 91, kind: "scenery", jobIds: [], look: "table-bench" },
        { id: 292, x: 190, y: 92, kind: "scenery", jobIds: [], look: "table-bench" },
        { id: 293, x: 178, y: 99, kind: "scenery", jobIds: [], look: "house-herb" },
        { id: 294, x: 178, y: 98, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 295, x: 179, y: 98, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 296, x: 179, y: 99, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 297, x: 212, y: 89, kind: "scenery", jobIds: [], look: "coop" },
        { id: 298, x: 213, y: 92, kind: "scenery", jobIds: [], look: "hen" },
        { id: 299, x: 211, y: 91, kind: "scenery", jobIds: [], look: "hen" },
        { id: 300, x: 183, y: 104, kind: "scenery", jobIds: [], look: "cow" },
        { id: 301, x: 186, y: 106, kind: "scenery", jobIds: [], look: "cow" },
        { id: 302, x: 189, y: 105, kind: "scenery", jobIds: [], look: "cow" },
        { id: 303, x: 207, y: 78, kind: "scenery", jobIds: [], look: "tower" },
        { id: 304, x: 207, y: 76, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 305, x: 208, y: 76, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 306, x: 207, y: 77, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 307, x: 208, y: 77, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 308, x: 208, y: 78, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 309, x: 203, y: 94, kind: "scenery", jobIds: [], look: "tower" },
        { id: 310, x: 203, y: 92, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 311, x: 204, y: 92, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 312, x: 203, y: 93, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 313, x: 204, y: 93, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 314, x: 204, y: 94, kind: "scenery", jobIds: [], look: "house-wing" },
        { id: 315, x: 189, y: 72, kind: "scenery", jobIds: [], look: "milestone" },
        { id: 316, x: 181, y: 80, kind: "scenery", jobIds: [], look: "campfire" },
        { id: 317, x: 183, y: 79, kind: "scenery", jobIds: [], look: "tent" },
        { id: 318, x: 180, y: 83, kind: "scenery", jobIds: [], look: "pack" },
        { id: 319, x: 173, y: 70, kind: "scenery", jobIds: [], look: "milestone" },
        { id: 320, x: 159, y: 62, kind: "scenery", jobIds: [], look: "wagon-wreck" },
        { id: 321, x: 162, y: 45, kind: "scenery", jobIds: [], look: "milestone" },
        { id: 322, x: 200, y: 101, kind: "scenery", jobIds: [], look: "milestone" },
        { id: 323, x: 200, y: 121, kind: "scenery", jobIds: [], look: "campfire" },
        { id: 324, x: 203, y: 120, kind: "scenery", jobIds: [], look: "tent" },
        { id: 325, x: 200, y: 123, kind: "scenery", jobIds: [], look: "pack" },
        { id: 326, x: 189, y: 130, kind: "scenery", jobIds: [], look: "milestone" },
        { id: 327, x: 169, y: 130, kind: "scenery", jobIds: [], look: "wagon-wreck" },
        { id: 328, x: 149, y: 130, kind: "scenery", jobIds: [], look: "milestone" },
        { id: 329, x: 129, y: 130, kind: "scenery", jobIds: [], look: "milestone" },
        { id: 330, x: 114, y: 135, kind: "scenery", jobIds: [], look: "campfire" },
        { id: 331, x: 117, y: 134, kind: "scenery", jobIds: [], look: "tent" },
        { id: 332, x: 114, y: 137, kind: "scenery", jobIds: [], look: "pack" },
        { id: 333, x: 114, y: 155, kind: "scenery", jobIds: [], look: "milestone" },
        { id: 334, x: 115, y: 177, kind: "scenery", jobIds: [], look: "wagon-wreck" },
        { id: 335, x: 200, y: 103, kind: "scenery", jobIds: [], look: "milestone" },
        { id: 336, x: 203, y: 122, kind: "scenery", jobIds: [], look: "milestone" },
        { id: 337, x: 210, y: 89, kind: "scenery", jobIds: [], look: "campfire" },
        { id: 338, x: 209, y: 91, kind: "scenery", jobIds: [], look: "tent" },
        { id: 339, x: 218, y: 101, kind: "scenery", jobIds: [], look: "milestone" },
        { id: 340, x: 221, y: 123, kind: "scenery", jobIds: [], look: "wagon-wreck" },
        { id: 341, x: 213, y: 136, kind: "scenery", jobIds: [], look: "milestone" },
        { id: 342, x: 223, y: 100, kind: "scenery", jobIds: [], look: "campfire" },
        { id: 343, x: 222, y: 98, kind: "scenery", jobIds: [], look: "tent" },
        { id: 344, x: 226, y: 102, kind: "scenery", jobIds: [], look: "pack" },
        { id: 345, x: 241, y: 100, kind: "scenery", jobIds: [], look: "milestone" },
        { id: 346, x: 247, y: 86, kind: "scenery", jobIds: [], look: "wagon-wreck" },
        { id: 347, x: 158, y: 47, kind: "scenery", jobIds: [], look: "crossroads" },
        { id: 348, x: 180, y: 108, kind: "scenery", jobIds: [], look: "gravestone" },
        { id: 349, x: 183, y: 107, kind: "scenery", jobIds: [], look: "gravestone" },
        { id: 350, x: 182, y: 109, kind: "scenery", jobIds: [], look: "gravestone" },
        { id: 351, x: 183, y: 98, kind: "scenery", jobIds: [], look: "crow" },
        { id: 352, x: 150, y: 70, kind: "scenery", jobIds: [], look: "boulder" },
        { id: 353, x: 230, y: 120, kind: "scenery", jobIds: [], look: "boulder" },
        { id: 354, x: 120, y: 120, kind: "scenery", jobIds: [], look: "boulder" },
        { id: 355, x: 170, y: 150, kind: "scenery", jobIds: [], look: "boulder" },
        { id: 356, x: 137, y: 104, kind: "scenery", jobIds: [], look: "boulder" },
        { id: 357, x: 135, y: 140, kind: "scenery", jobIds: [], look: "dead-tree" },
        { id: 358, x: 239, y: 99, kind: "scenery", jobIds: [], look: "dead-tree" },
        { id: 359, x: 199, y: 86, kind: "stall", jobIds: [244] },
        { id: 360, x: 195, y: 83, kind: "stall", jobIds: [245] },
        { id: 361, x: 201, y: 87, kind: "stall", jobIds: [246] },
        { id: 362, x: 195, y: 88, kind: "stall", jobIds: [247] },
        { id: 363, x: 104, y: 180, kind: "stall", jobIds: [244] },
        { id: 364, x: 114, y: 170, kind: "stall", jobIds: [245] },
        { id: 365, x: 117, y: 173, kind: "stall", jobIds: [246] },
        { id: 366, x: 117, y: 181, kind: "stall", jobIds: [247] },
        { id: 367, x: 167, y: 218, kind: "fountain", jobIds: [] },
        { id: 368, x: 112, y: 54, kind: "fountain", jobIds: [] },
        { id: 369, x: 4, y: 137, kind: "fountain", jobIds: [] },
        { id: 370, x: 23, y: 92, kind: "fountain", jobIds: [] },
        { id: 371, x: 65, y: 35, kind: "fountain", jobIds: [] },
        { id: 372, x: 44, y: 27, kind: "fountain", jobIds: [] },
        { id: 373, x: 243, y: 116, kind: "fountain", jobIds: [] },
        { id: 374, x: 146, y: 190, kind: "fountain", jobIds: [] },
        { id: 375, x: 53, y: 157, kind: "fountain", jobIds: [] },
        { id: 376, x: 165, y: 178, kind: "fountain", jobIds: [] },
        { id: 377, x: 69, y: 196, kind: "fountain", jobIds: [] },
        { id: 378, x: 79, y: 107, kind: "fountain", jobIds: [] },
        { id: 379, x: 208, y: 17, kind: "fountain", jobIds: [] },
        { id: 380, x: 272, y: 15, kind: "scenery", jobIds: [], look: "house-board" },
        { id: 381, x: 272, y: 17, kind: "scenery", jobIds: [], look: "portal-out" },
        { id: 382, x: 211, y: 76, kind: "scenery", jobIds: [], look: "portal:1" },
        { id: 383, x: 113, y: 178, kind: "scenery", jobIds: [], look: "portal:2" },
      ],
      banks: [
        { id: 1, x: 200, y: 82 },
        { id: 2, x: 110, y: 177 },
      ],
      regions: [{ name: "Home", x: 256, y: 0, width: 32, height: 32 }],
      zones: [
        {
          id: 1,
          name: "The Warrens",
          monsterId: 1,
          population: 10,
          x: 191,
          y: 133,
          width: 12,
          height: 12,
        },
        {
          id: 2,
          name: "Mirefen",
          monsterId: 2,
          population: 10,
          x: 204,
          y: 147,
          width: 12,
          height: 12,
        },
        {
          id: 3,
          name: "Dust Hollow",
          monsterId: 3,
          population: 10,
          x: 242,
          y: 58,
          width: 12,
          height: 12,
        },
        {
          id: 4,
          name: "The Cairns",
          monsterId: 4,
          population: 12,
          x: 128,
          y: 185,
          width: 13,
          height: 13,
        },
        {
          id: 5,
          name: "Frostmarch",
          monsterId: 5,
          population: 10,
          x: 224,
          y: 167,
          width: 12,
          height: 12,
        },
        {
          id: 6,
          name: "Cinder Reach",
          monsterId: 6,
          population: 12,
          x: 80,
          y: 22,
          width: 13,
          height: 13,
        },
        {
          id: 7,
          name: "The Deep",
          monsterId: 7,
          population: 10,
          x: 67,
          y: 9,
          width: 12,
          height: 12,
        },
        {
          id: 8,
          name: "Sunscar Dunes",
          monsterId: 8,
          population: 10,
          x: 175,
          y: 209,
          width: 11,
          height: 11,
        },
        {
          id: 9,
          name: "The Glass Flats",
          monsterId: 9,
          population: 12,
          x: 92,
          y: 51,
          width: 12,
          height: 12,
        },
        {
          id: 10,
          name: "Frostwild Hollow",
          monsterId: 10,
          population: 12,
          x: 12,
          y: 128,
          width: 12,
          height: 12,
        },
        {
          id: 11,
          name: "Rimeholt",
          monsterId: 11,
          population: 12,
          x: 14,
          y: 100,
          width: 12,
          height: 12,
        },
        {
          id: 12,
          name: "Ashfall",
          monsterId: 12,
          population: 12,
          x: 61,
          y: 38,
          width: 12,
          height: 12,
        },
        {
          id: 13,
          name: "The Cinder Throne",
          monsterId: 13,
          population: 12,
          x: 47,
          y: 23,
          width: 12,
          height: 12,
        },
        {
          id: 14,
          name: "The Scree",
          monsterId: 14,
          population: 12,
          x: 229,
          y: 104,
          width: 12,
          height: 12,
        },
        {
          id: 15,
          name: "Sallow Reach",
          monsterId: 15,
          population: 14,
          x: 148,
          y: 185,
          width: 13,
          height: 13,
        },
        {
          id: 16,
          name: "The Boneyard",
          monsterId: 16,
          population: 10,
          x: 49,
          y: 160,
          width: 11,
          height: 11,
        },
        {
          id: 17,
          name: "Sunken Row",
          monsterId: 17,
          population: 12,
          x: 168,
          y: 174,
          width: 12,
          height: 12,
        },
        {
          id: 18,
          name: "Gritmaw",
          monsterId: 18,
          population: 14,
          x: 64,
          y: 198,
          width: 13,
          height: 13,
        },
        {
          id: 19,
          name: "Hollowbarrow",
          monsterId: 19,
          population: 12,
          x: 81,
          y: 106,
          width: 12,
          height: 12,
        },
        {
          id: 20,
          name: "The Chalk Steps",
          monsterId: 20,
          population: 14,
          x: 214,
          y: 11,
          width: 13,
          height: 13,
        },
      ],
    },
    constants: {
      tickMs: 600,
      epoch: 1767225600000,
      coins: 200,
      xpRarity: [1, 1.5, 3, 8, 25],
      brewStrength: [1, 1.3, 1.6, 2.2, 3],
      potionTicks: 6000,
      toolLuck: [0, 0.25, 0.75, 2, 5],
      toolEnhance: 0.06,
      mountEnhance: 0.15,
      packSlots: 28,
      rareThresholds: {
        legendary: 0.000006666666666666667,
        epic: 0.000125,
        rare: 0.0025,
        uncommon: 0.025,
      },
    },
    version: {
      version: "1.0.2136",
      env: "live",
      commit: "31abf69b",
      branch: "professions",
      subject: "Merge branch 'night-fixes' into professions",
      committedAt: "2026-10-09T12:15:52+02:00",
      dirty: true,
      builtAt: "2026-10-09T10:21:29.571Z",
    },
    clientAsset: "index-C4GJOowi.js",
    labels: {
      Copper: "铜矿",
      Tin: "锡矿",
      Iron: "铁矿",
      Silver: "银矿",
      Coal: "煤炭",
      Gold: "金矿",
      Cobalt: "钴矿",
      Meteoric: "陨铁矿",
      Shrimp: "虾",
      Sardine: "沙丁鱼",
      Trout: "鳟鱼",
      Salmon: "三文鱼",
      Tuna: "金枪鱼",
      Lobster: "龙虾",
      Swordfish: "剑鱼",
      Shark: "鲨鱼",
      Potato: "土豆",
      Glowcap: "荧光菇",
      "Cave turnip": "洞穴芜菁",
      Bitterroot: "苦根",
      Voidmelon: "虚空瓜",
      "Ember pepper": "余烬辣椒",
      "Bronze bar": "青铜锭",
      "Iron bar": "铁锭",
      "Steel bar": "钢锭",
      "Cobalt bar": "钴锭",
      "Meteoric bar": "陨铁锭",
      "Bronze pickaxe": "青铜镐",
      "Iron pickaxe": "铁镐",
      "Steel pickaxe": "钢镐",
      "Cobalt pickaxe": "钴镐",
      "Meteoric pickaxe": "陨铁镐",
      "Bronze rod": "青铜钓竿",
      "Iron rod": "铁钓竿",
      "Steel rod": "钢钓竿",
      "Cobalt rod": "钴钓竿",
      "Meteoric rod": "陨铁钓竿",
      "Bronze pan": "青铜平底锅",
      "Iron pan": "铁平底锅",
      "Steel pan": "钢平底锅",
      "Cobalt pan": "钴平底锅",
      "Meteoric pan": "陨铁平底锅",
      "Bronze hammer": "青铜锤",
      "Iron hammer": "铁锤",
      "Steel hammer": "钢锤",
      "Cobalt hammer": "钴锤",
      "Meteoric hammer": "陨铁锤",
      "Bronze knife": "青铜刀",
      "Iron knife": "铁刀",
      "Steel knife": "钢刀",
      "Cobalt knife": "钴刀",
      "Meteoric knife": "陨铁刀",
      "Bronze needle": "青铜针",
      "Iron needle": "铁针",
      "Steel needle": "钢针",
      "Cobalt needle": "钴针",
      "Meteoric needle": "陨铁针",
      "Bronze mortar": "青铜研钵",
      "Iron mortar": "铁研钵",
      "Steel mortar": "钢研钵",
      "Cobalt mortar": "钴研钵",
      "Meteoric mortar": "陨铁研钵",
      "Bronze hoe": "青铜锄",
      "Iron hoe": "铁锄",
      "Steel hoe": "钢锄",
      "Cobalt hoe": "钴锄",
      "Meteoric hoe": "陨铁锄",
      "Bronze axe": "青铜斧",
      "Iron axe": "铁斧",
      "Steel axe": "钢斧",
      "Cobalt axe": "钴斧",
      "Meteoric axe": "陨铁斧",
      "Bronze blade": "青铜剑",
      "Iron blade": "铁剑",
      "Steel blade": "钢剑",
      "Cobalt blade": "钴剑",
      "Meteoric blade": "陨铁剑",
      "Bronze greatsword": "青铜大剑",
      "Iron greatsword": "铁大剑",
      "Steel greatsword": "钢大剑",
      "Cobalt greatsword": "钴大剑",
      "Meteoric greatsword": "陨铁大剑",
      "Colossus greatsword": "巨像大剑",
      "Bronze shield": "青铜盾",
      "Iron shield": "铁盾",
      "Steel shield": "钢盾",
      "Cobalt shield": "钴盾",
      "Meteoric shield": "陨铁盾",
      "Bronze helm": "青铜头盔",
      "Iron helm": "铁头盔",
      "Steel helm": "钢头盔",
      "Cobalt helm": "钴头盔",
      "Meteoric helm": "陨铁头盔",
      "Bronze plate": "青铜铠甲",
      "Iron plate": "铁铠甲",
      "Steel plate": "钢铠甲",
      "Cobalt plate": "钴铠甲",
      "Meteoric plate": "陨铁铠甲",
      "Bronze greaves": "青铜护腿",
      "Iron greaves": "铁护腿",
      "Steel greaves": "钢护腿",
      "Cobalt greaves": "钴护腿",
      "Meteoric greaves": "陨铁护腿",
      "Colossus blade": "巨像之剑",
      "Colossus shield": "巨像之盾",
      "Colossus helm": "巨像头盔",
      "Colossus plate": "巨像铠甲",
      "Colossus greaves": "巨像护腿",
      Shortbow: "短弓",
      "Oak shortbow": "橡木短弓",
      "Willow shortbow": "柳木短弓",
      "Maple shortbow": "枫木短弓",
      "Yew shortbow": "紫杉短弓",
      "Magic shortbow": "魔法短弓",
      Longbow: "长弓",
      "Oak longbow": "橡木长弓",
      "Willow longbow": "柳木长弓",
      "Maple longbow": "枫木长弓",
      "Yew longbow": "紫杉长弓",
      "Magic longbow": "魔法长弓",
      Staff: "法杖",
      "Oak staff": "橡木法杖",
      "Willow staff": "柳木法杖",
      "Maple staff": "枫木法杖",
      "Yew staff": "紫杉法杖",
      "Magic staff": "魔法法杖",
      Sage: "鼠尾草",
      Nightshade: "颠茄",
      Dragonleaf: "龙叶",
      "Swift draught": "疾行药剂",
      "Nourishing draught": "滋养药剂",
      "Haste draught": "急速药剂",
      "Elixir of the vein": "矿脉灵药",
      "Abyssal tonic": "深渊补剂",
      "Cut gem": "切割宝石",
      "Silver ring": "白银戒指",
      "Gold ring": "黄金戒指",
      "Meteoric ring": "陨铁戒指",
      "Wyrm ring": "巨龙戒指",
      "Silver amulet": "白银护符",
      "Gold amulet": "黄金护符",
      "Meteoric amulet": "陨铁护符",
      "Leviathan amulet": "利维坦护符",
      "Pelt coif": "兽皮头巾",
      "Pelt chaps": "兽皮护腿",
      "Pelt jerkin": "兽皮上衣",
      "Bogskin coif": "沼皮头巾",
      "Bogskin chaps": "沼皮护腿",
      "Bogskin jerkin": "沼皮上衣",
      "Chitin coif": "甲壳头巾",
      "Chitin chaps": "甲壳护腿",
      "Chitin jerkin": "甲壳上衣",
      "Fur coif": "毛皮头巾",
      "Fur chaps": "毛皮护腿",
      "Fur jerkin": "毛皮上衣",
      "Scale coif": "鳞片头巾",
      "Scale chaps": "鳞片护腿",
      "Scale jerkin": "鳞片上衣",
      "Troll coif": "巨魔头巾",
      "Troll chaps": "巨魔护腿",
      "Troll jerkin": "巨魔上衣",
      "Drake coif": "幼龙头巾",
      "Drake chaps": "幼龙护腿",
      "Drake jerkin": "幼龙上衣",
      "Homespun hood": "粗布兜帽",
      "Homespun skirt": "粗布裙",
      "Homespun robe": "粗布长袍",
      "Silk hood": "丝绸兜帽",
      "Silk skirt": "丝绸裙",
      "Silk robe": "丝绸长袍",
      "Gilded hood": "镀金兜帽",
      "Gilded skirt": "镀金裙",
      "Gilded robe": "镀金长袍",
      "Voidweave hood": "虚织兜帽",
      "Voidweave skirt": "虚织裙",
      "Voidweave robe": "虚织长袍",
      "Wightweave hood": "尸织兜帽",
      "Wightweave skirt": "尸织裙",
      "Wightweave robe": "尸织长袍",
      "Pelt gloves": "兽皮手套",
      "Bogskin gloves": "沼皮手套",
      "Chitin gloves": "甲壳手套",
      "Bone gloves": "骨手套",
      "Pelt quiver": "兽皮箭袋",
      "Bogskin quiver": "沼皮箭袋",
      "Chitin quiver": "甲壳箭袋",
      "Fur quiver": "毛皮箭袋",
      "Scale quiver": "鳞片箭袋",
      "Troll quiver": "巨魔箭袋",
      "Drake quiver": "幼龙箭袋",
      "Linen grimoire": "亚麻魔典",
      "Silk grimoire": "丝绸魔典",
      "Gilded grimoire": "镀金魔典",
      "Voidweave grimoire": "虚织魔典",
      "Wightweave grimoire": "尸织魔典",
      "Scale gloves": "鳞片手套",
      Logs: "原木",
      "Oak logs": "橡木",
      "Willow logs": "柳木",
      "Maple logs": "枫木",
      "Yew logs": "紫杉木",
      "Magic logs": "魔法原木",
      "Cooked shrimp": "熟虾",
      "Cooked sardine": "熟沙丁鱼",
      "Cooked trout": "熟鳟鱼",
      "Cooked salmon": "熟三文鱼",
      "Cooked tuna": "熟金枪鱼",
      "Cooked lobster": "熟龙虾",
      "Cooked swordfish": "熟剑鱼",
      "Cooked shark": "熟鲨鱼",
      "Burnt food": "烧焦的食物",
      "Rough gem": "粗糙宝石",
      Coins: "金币",
      "Gnawed charm": "啃噬护符",
      "Bog pearl": "沼泽珍珠",
      "Dry sigil": "干枯符印",
      "Cairn token": "石冢徽记",
      "Rime fang": "寒霜之牙",
      "Ember heart": "余烬之心",
      "Abyssal eye": "深渊之眼",
      Voidshard: "虚空碎片",
      "Potato seed": "土豆种子",
      "Glowcap spore": "荧光菇孢子",
      "Turnip seed": "芜菁种子",
      "Bitterroot seed": "苦根种子",
      "Voidmelon seed": "虚空瓜种子",
      "Pepper seed": "辣椒种子",
      "Sage seed": "鼠尾草种子",
      "Nightshade seed": "颠茄种子",
      "Dragonleaf seed": "龙叶种子",
      "Gravemaw skull": "墓噬者头骨",
      "Hollow crown": "空心王冠",
      "Riftborne heart": "裂生之心",
      "Colossus core": "巨像核心",
      "Wraith ash": "怨灵之烬",
      "Stalker fang": "潜袭者之牙",
      "Troll tusk": "巨魔獠牙",
      "Wight crown": "尸灵王冠",
      "Drake scale": "幼龙鳞",
      "Colossus ember": "巨像余烬",
      "Gnawer pelt": "啃噬者毛皮",
      "Bogling skin": "沼灵皮",
      "Husk chitin": "空壳甲壳",
      "Cairn bone": "石冢骨",
      "Wraith dust": "怨灵之尘",
      "Rimewolf fur": "霜狼毛皮",
      "Stalker claw": "潜袭者之爪",
      "Ember scale": "余烬之鳞",
      "Troll hide": "巨魔皮",
      "Horror ichor": "恐魔脓液",
      "Ice wight shard": "冰尸碎片",
      "Drake hide": "幼龙皮",
      "Colossus chip": "巨像碎片",
      "Homespun bolt": "粗布匹",
      "Silk bolt": "丝绸布匹",
      "Gilded bolt": "镀金布匹",
      "Voidweave bolt": "虚织布匹",
      "Rock mite nymph": "岩螨若虫",
      "Fen lurker spawn": "沼潜者幼体",
      "Grave beetle grub": "墓甲虫幼虫",
      "Sump crawler hatchling": "污水爬行者幼体",
      "Stone eater pebble": "食石者卵石",
      "Barrow pup": "冢穴幼兽",
      "Chalk wightling": "白垩尸灵",
      Horse: "马",
      "Leviathan scale": "利维坦之鳞",
      "Wyrm ember": "巨龙余烬",
      "Protection scroll": "保护卷轴",
      "Golden Week gift box": "金秋礼盒",
      "Pebble golem": "小石魔像",
      "Baby kraken": "小海妖",
      "Acorn squirrel": "橡果松鼠",
      "Queen bee": "蜂后",
      Raccoon: "浣熊",
      "Chef rat": "厨师鼠",
      "Ember salamander": "余烬蝾螈",
      "Fletch falcon": "箭羽隼",
      Toadstool: "毒蘑菇人",
      "Yarn kitten": "毛线小猫",
      "Star fairy": "星辰小仙",
      "Gnawer pup": "啃噬者幼崽",
      "Bogling tadpole": "沼灵蝌蚪",
      "Husk grub": "空壳幼虫",
      "Cairn wisp": "石冢幽光",
      "Rimewolf cub": "霜狼幼崽",
      "Emberkin spark": "余烬灵火花",
      "Horror spawn": "恐魔幼体",
      "Wraith mote": "怨灵微粒",
      "Stalker kit": "潜袭者幼崽",
      "Frost troll whelp": "霜巨魔幼崽",
      "Ice wight shard-child": "冰尸幼体",
      "Ash drake hatchling": "灰龙幼崽",
      "Cinder ember": "灰烬余火",
      "Gem pack": "宝石包",
      "Pouch of gems": "宝石袋",
      "Chest of gems": "宝石箱",
      "Vein of gems": "宝石矿脉",
      "Hoard of gems": "宝石堆",
    },
    sourceSha256: "b31f4ac969b2c0edf1b3036ae6b25954bd31c8b91ad7fcab1a8fea645fc8dbe9",
  };

  // ---- Local forecast worker ----
  function runForecastWorker() {
    /* Independent calculator. No browser, game requests or game-state writes. */
    (function (root, factory) {
      if (typeof module === "object" && module.exports) module.exports = factory();
      else root.DVIPlannerCore = factory();
    })(typeof globalThis !== "undefined" ? globalThis : this, function () {
      "use strict";
      const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
      const sum = (xs) => xs.reduce((a, b) => a + b, 0);
      const add = (obj, key, value) => {
        obj[key] = (obj[key] || 0) + value;
      };
      const clone = (x) => JSON.parse(JSON.stringify(x));
      const neighbors = [
        [0, 1],
        [1, 0],
        [0, -1],
        [-1, 0],
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1],
      ];
      const skillSlots = {
        mining: "pickaxe",
        fishing: "rod",
        woodcutting: "axe",
        thieving: "gloves",
        cooking: "pan",
        smithing: "hammer",
        fletching: "knife",
        crafting: "needle",
        herblore: "mortar",
        farming: "hoe",
      };
      const gathers = new Set(["mining", "fishing", "woodcutting", "thieving", "farming"]);
      function hash(a, b, c) {
        let x = (a ^ 2654435769) >>> 0;
        x = Math.imul(x ^ (b >>> 0), 2246822507) >>> 0;
        x = (x ^ (x >>> 13)) >>> 0;
        x = Math.imul(x ^ (c >>> 0), 3266489909) >>> 0;
        return (x ^ (x >>> 16)) >>> 0;
      }
      function rng(seed) {
        let x = seed >>> 0;
        return () => {
          x += 0x6d2b79f5;
          let t = Math.imul(x ^ (x >>> 15), 1 | x);
          t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      }
      class Heap {
        constructor(compare) {
          this.q = [];
          this.compare = compare;
        }
        push(v) {
          const q = this.q;
          let i = q.length;
          q.push(v);
          while (i) {
            const p = (i - 1) >> 1;
            if (this.compare(q[p], v) <= 0) break;
            q[i] = q[p];
            i = p;
          }
          q[i] = v;
        }
        pop() {
          const q = this.q,
            v = q[0],
            last = q.pop();
          if (q.length) {
            let i = 0;
            while (i * 2 + 1 < q.length) {
              let j = i * 2 + 1;
              if (j + 1 < q.length && this.compare(q[j + 1], q[j]) < 0) j++;
              if (this.compare(last, q[j]) <= 0) break;
              q[i] = q[j];
              i = j;
            }
            q[i] = last;
          }
          return v;
        }
      }
      const octile = (ax, ay, bx, by) => {
        const x = Math.abs(ax - bx),
          y = Math.abs(ay - by);
        return Math.max(x, y) + (Math.SQRT2 - 1) * Math.min(x, y);
      };
      function create(data) {
        const jobs = new Map(data.jobs.map((x) => [x.id, x])),
          items = new Map(data.items.map((x) => [x.id, x]));
        const tools = new Map(data.tools.map((x) => [x.itemId, x])),
          gear = new Map(data.gear.map((x) => [x.itemId, x]));
        const mastery = new Map(data.masteries.map((x) => [x.id, x.perRank]));
        const eligible = new Set(data.rarityEligible),
          seeds = new Set(data.seedIds),
          map = data.world;
        const c = data.constants,
          paths = new Map(),
          bankFields = new Map(),
          rotations = [];
        function level(xp) {
          let lo = 1,
            hi = data.xpTable.length - 1;
          while (lo < hi) {
            const mid = Math.ceil((lo + hi) / 2);
            if (data.xpTable[mid] <= xp) lo = mid;
            else hi = mid - 1;
          }
          return lo;
        }
        const base = (id) => (id % 10000) % 1000,
          tier = (id) => Math.floor((id % 10000) / 1000);
        const identity = (id, t) => id + t * 1000;
        const item = (id) => items.get(id % 10000) || items.get(base(id));
        function tool(id) {
          if (id == null) return null;
          const t = tools.get(id % 10000);
          return t
            ? {
                ...t,
                bonus:
                  t.bonus *
                  (1 +
                    (t.slot === "mount" ? c.mountEnhance : c.toolEnhance) * Math.floor(id / 10000)),
              }
            : null;
        }
        const bonus = (id) => tool(id)?.bonus || 0;
        function luck(p) {
          const id = p.equipment?.amulet;
          if (id == null) return 0;
          return (gear.get(id % 10000)?.luck || 0) * (1 + c.toolEnhance * Math.floor(id / 10000));
        }
        const master = (p, k) => 1 + (p.masteries?.[k] || 0) * (mastery.get(k) || 0);
        function brewTier(p, k, tick) {
          const buckets = p.brewBuckets?.[k];
          if (buckets?.length) {
            const elapsed = Math.max(0, tick - ((p.brews?.[k] || 0) - sum(buckets)));
            let used = 0;
            for (let i = buckets.length - 1; i >= 0; i--) {
              used += buckets[i];
              if (elapsed < used) return clamp(i, 0, 4);
            }
          }
          return clamp(p.brewTier?.[k] || 0, 0, 4);
        }
        const brew = (p, k, tick) =>
          (p.brews?.[k] || 0) > tick ? c.brewStrength[brewTier(p, k, tick)] : 0;
        const active = (p, k, tick) => (p.brews?.[k] || 0) > tick;
        function home(p, kind, skill) {
          let n = 0;
          for (const r of data.rooms)
            if (
              p.houseFurniture?.[r.id] !== undefined &&
              r.bonus.kind === kind &&
              (!skill || r.bonus.skill === skill)
            )
              n += (p.house?.[r.id] || 0) * 0.01 * (r.rate ?? 1);
          return n;
        }
        function rotation(tick) {
          const kinds = [
            "mining",
            "fishing",
            "woodcutting",
            "farming",
            "thieving",
            "cooking",
            "smithing",
            "fletching",
            "herblore",
            "crafting",
            "enhancing",
            "combat",
          ];
          const index = Math.floor(tick / 3000);
          for (let i = rotations.length; i <= index; i++) {
            let k = hash(i, 1, 1213158433) % kinds.length;
            if (i && k === rotations[i - 1]) k = (k + 1) % kinds.length;
            rotations.push(k);
          }
          const skill = kinds[rotations[index]],
            rare =
              ["mining", "fishing", "woodcutting", "farming", "combat"].includes(skill) &&
              hash(index, 2, 1213158433) % 3 === 0;
          return {
            skill,
            kind: rare ? "rarity" : "xp",
            mult: rare ? 1.25 : 1.2,
            until: (index + 1) * 3000,
          };
        }
        function world(windows, tick, key) {
          let value = 1;
          for (const w of windows || [])
            if (tick >= w.fromTick && tick <= w.toTick) value += (w[key] ?? 1) - 1;
          return value;
        }
        function xpMultiplier(p, job, tick, windows, watering = false) {
          const gathering = job.inputs.length === 0 || job.grow !== undefined;
          const r = rotation(tick);
          return (
            world(windows, tick, "xpMult") +
            0.1 * brew(p, "elixir", tick) +
            (gathering ? 0.1 * brew(p, "gatherer", tick) : 0) +
            (active(p, "blessing", tick) ? 0.05 : 0) +
            (p.guildBonus || 0) +
            (master(p, "xp") - 1) +
            (!watering && r.skill === job.skill && r.kind === "xp" ? r.mult - 1 : 0)
          );
        }
        const xp = (p, j, t, windows, rarity) =>
          Math.round(j.xp * c.xpRarity[rarity] * xpMultiplier(p, j, t, windows));
        function rarityProbabilities(p, j, t, windows, seedReturn = false) {
          const r = rotation(t),
            toolId = p.equipment?.[skillSlots[j.skill]],
            toolLuck = seedReturn ? 0 : c.toolLuck[tier(toolId || 0)] || 0;
          const multiplier =
            world(windows, t, "rarityMult") +
            0.25 * brew(p, "hunter", t) +
            (active(p, "blessing", t) ? 0.1 : 0) +
            (r.skill === j.skill && r.kind === "rarity" ? r.mult - 1 : 0) +
            home(p, "rareChance") +
            master(p, "rare") -
            1;
          const factor = (1 + luck(p) + toolLuck) * multiplier;
          const thresholds = [
            c.rareThresholds.uncommon,
            c.rareThresholds.rare,
            c.rareThresholds.epic,
            c.rareThresholds.legendary,
          ].map((x) => clamp(x * factor, 0, 1));
          return [
            1 - thresholds[0],
            thresholds[0] - thresholds[1],
            thresholds[1] - thresholds[2],
            thresholds[2] - thresholds[3],
            thresholds[3],
          ];
        }
        function draw(probs, random) {
          let u = random();
          for (let i = 0; i < probs.length; i++) {
            u -= probs[i];
            if (u < 0) return i;
          }
          return probs.length - 1;
        }
        function chance(p, j) {
          const lev = level(p.skills[j.skill]);
          const equipped = tool(p.equipment?.[skillSlots[j.skill]]);
          return Math.min(
            1,
            ((1 + Math.max(0, lev - j.levelReq) * 0.005) *
              (1 + (equipped?.slot === skillSlots[j.skill] ? equipped.bonus : 0)) *
              (1 +
                0.005 * (p.perks?.quick || 0) +
                home(p, gathers.has(j.skill) ? "gatherSpeed" : "craftSpeed", j.skill)) *
              master(p, gathers.has(j.skill) ? "gather" : "craft")) /
              j.baseTicks,
          );
        }
        function failure(p, j) {
          const f = j.burn || j.caught;
          return f
            ? clamp(
                f.chanceAtReq *
                  (1 - (level(p.skills[j.skill]) - j.levelReq) / (f.safeAtLevel - j.levelReq)) *
                  (1 - 0.03 * (p.perks?.hands || 0)),
                0,
                1,
              )
            : 0;
        }
        function inputs(j, rarity) {
          return j.inputs.map((x) => ({
            ...x,
            itemId:
              rarity &&
              eligible.has(x.itemId) &&
              x.itemId !== 5 &&
              !(x.itemId >= 201 && x.itemId <= 207)
                ? identity(x.itemId, rarity)
                : x.itemId,
          }));
        }
        const walkable = (x, y) =>
          x >= 0 &&
          y >= 0 &&
          x < map.width &&
          y < map.height &&
          map.collision[y * map.width + x] === 0;
        function canStep(x, y, nx, ny) {
          return walkable(nx, ny) && (x === nx || y === ny || (walkable(nx, y) && walkable(x, ny)));
        }
        function adjacent(site, id = 0) {
          const points = neighbors
            .map(([dx, dy]) => ({ x: site.x + dx, y: site.y + dy }))
            .filter((p) => walkable(p.x, p.y));
          return points[id === 0 ? 0 : hash(id, site.x, site.y) % points.length] || null;
        }
        function path(ax, ay, bx, by) {
          const key = [ax, ay, bx, by].join(",");
          if (paths.has(key)) return paths.get(key);
          if (!walkable(ax, ay) || !walkable(bx, by)) return null;
          const width = map.width,
            start = ay * width + ax,
            goal = by * width + bx,
            n = width * map.height;
          const g = new Float64Array(n).fill(Infinity),
            prev = new Int32Array(n).fill(-1);
          const heap = new Heap((a, b) => a.f - b.f || b.g - a.g || a.id - b.id);
          g[start] = 0;
          heap.push({ id: start, g: 0, f: octile(ax, ay, bx, by) });
          while (heap.q.length) {
            const u = heap.pop();
            if (u.g !== g[u.id]) continue;
            if (u.id === goal) {
              const out = [];
              for (let v = goal; v !== start; v = prev[v])
                out.push({ x: v % width, y: Math.floor(v / width) });
              out.reverse();
              if (paths.size > 2048) paths.clear();
              paths.set(key, out);
              return out;
            }
            const x = u.id % width,
              y = Math.floor(u.id / width);
            for (const [dx, dy] of neighbors) {
              const nx = x + dx,
                ny = y + dy;
              if (!canStep(x, y, nx, ny)) continue;
              const id = ny * width + nx,
                ng = u.g + (dx && dy ? Math.SQRT2 : 1);
              if (ng < g[id]) {
                g[id] = ng;
                prev[id] = u.id;
                heap.push({ id, g: ng, f: ng + octile(nx, ny, bx, by) });
              }
            }
          }
          paths.set(key, null);
          return null;
        }
        function bankDistance(bank, x, y) {
          let distances = bankFields.get(bank.id);
          if (!distances) {
            distances = new Int32Array(map.width * map.height).fill(-1);
            const queue = [];
            for (const [dx, dy] of neighbors)
              if (walkable(bank.x + dx, bank.y + dy)) {
                const i = (bank.y + dy) * map.width + bank.x + dx;
                distances[i] = 0;
                queue.push(i);
              }
            for (let at = 0; at < queue.length; at++) {
              const i = queue[at],
                cx = i % map.width,
                cy = Math.floor(i / map.width);
              for (const [dx, dy] of neighbors) {
                const nx = cx + dx,
                  ny = cy + dy;
                if (!canStep(cx, cy, nx, ny)) continue;
                const ni = ny * map.width + nx;
                if (distances[ni] < 0) {
                  distances[ni] = distances[i] + 1;
                  queue.push(ni);
                }
              }
            }
            bankFields.set(bank.id, distances);
          }
          const d = distances[y * map.width + x];
          return d >= 0 ? d : Infinity;
        }
        function nearestBank(p) {
          const homeBank = map.banks.find((b) => b.id === p.homeBank);
          if (homeBank && Number.isFinite(bankDistance(homeBank, p.x, p.y))) return homeBank;
          return (
            [...map.banks]
              .sort((a, b) => bankDistance(a, p.x, p.y) - bankDistance(b, p.x, p.y) || a.id - b.id)
              .find((b) => Number.isFinite(bankDistance(b, p.x, p.y))) || null
          );
        }
        function nearestSite(j, p) {
          return map.sites
            .filter((s) => s.jobIds?.includes(j.id))
            .sort(
              (a, b) => octile(a.x, a.y, p.x, p.y) - octile(b.x, b.y, p.x, p.y) || a.id - b.id,
            )[0];
        }
        function farmingStatus(p) {
          const fields = map.sites
            .filter((s) => s.kind === "field")
            .sort((a, b) => a.id - b.id)
            .slice(
              0,
              (data.farming?.unlockLevels || [1]).filter((n) => level(p.skills.farming) >= n)
                .length,
            );
          const matureAt = (plot) => {
            const job = data.jobs.find(
              (j) => j.grow !== undefined && j.inputs[0]?.itemId === base(plot.seedItemId),
            );
            if (!job) return null;
            const grow = Math.round(job.grow / (plot.sowSpeed ?? 1)),
              trim =
                plot.trim ??
                Math.min(plot.watered ?? 0, Math.floor(job.grow / 40)) *
                  (data.farming?.waterTrim ?? 20);
            return plot.plantedAt + grow - Math.min(trim, Math.floor(grow / 2));
          };
          const ready = fields.filter(
            (s) => p.plots?.[s.id] && matureAt(p.plots[s.id]) <= p.lastTick,
          );
          const distance = (s) => Math.max(Math.abs(s.x - p.x), Math.abs(s.y - p.y));
          const next =
            [...ready].sort(
              (a, b) =>
                (distance(a) <= 1 ? 0 : distance(a)) - (distance(b) <= 1 ? 0 : distance(b)) ||
                a.id - b.id,
            )[0] ||
            fields.find((s) => !p.plots?.[s.id]) ||
            null;
          let stand = null;
          if (next)
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++) {
                if (!dx && !dy) continue;
                const x = next.x + dx,
                  y = next.y + dy;
                if (!walkable(x, y)) continue;
                const score = ready.filter(
                    (s) => Math.max(Math.abs(s.x - x), Math.abs(s.y - y)) <= 1,
                  ).length,
                  dist = Math.max(Math.abs(p.x - x), Math.abs(p.y - y));
                if (!stand || score > stand.score || (score === stand.score && dist < stand.dist))
                  stand = { x, y, score, dist };
              }
          return {
            fields: fields.map((s, i) => ({
              id: s.id,
              number: i + 1,
              x: s.x,
              y: s.y,
              plot: p.plots?.[s.id] || null,
              matureAt: p.plots?.[s.id] ? matureAt(p.plots[s.id]) : null,
              current: s.id === p.workSiteId,
            })),
            nextId: next?.id ?? null,
            stand,
            currentId: p.workSiteId ?? null,
            errand: !!p.route?.errand,
          };
        }
        const capacity = (p) => c.packSlots + (p.perks?.pockets || 0);
        const held = (p, id) => sum(p.pack.filter((x) => x.itemId === id).map((x) => x.qty));
        function put(p, id, qty) {
          if (qty <= 0) return true;
          if (item(id)?.stackable) {
            const entry = p.pack.find((x) => x.itemId === id);
            if (entry) {
              entry.qty += qty;
              return true;
            }
            if (p.pack.length >= capacity(p)) return false;
            p.pack.push({ itemId: id, qty });
            return true;
          }
          if (p.pack.length + qty > capacity(p)) return false;
          for (let i = 0; i < qty; i++) p.pack.push({ itemId: id, qty: 1 });
          return true;
        }
        function remove(p, id, qty) {
          for (let i = p.pack.length - 1; i >= 0 && qty > 0; i--) {
            if (p.pack[i].itemId !== id) continue;
            const take = Math.min(qty, p.pack[i].qty);
            p.pack[i].qty -= take;
            qty -= take;
            if (!p.pack[i].qty) p.pack.splice(i, 1);
          }
        }
        function canWork(p, j, rarity) {
          const ins = inputs(j, rarity);
          if (ins.some((x) => held(p, x.itemId) < x.qty)) return false;
          if (!ins.length) return p.pack.length < capacity(p);
          const output = identity(j.output.itemId, rarity);
          if (j.output.itemId === c.coins || (item(output)?.stackable && held(p, output) > 0))
            return true;
          let freed = 0;
          for (const x of ins)
            freed += item(x.itemId)?.stackable ? (held(p, x.itemId) === x.qty ? 1 : 0) : x.qty;
          return p.pack.length - freed < capacity(p);
        }
        function withdraw(p, j, rarity) {
          const ins = inputs(j, rarity),
            free = capacity(p) - p.pack.length;
          const nonstack = sum(ins.filter((x) => !item(x.itemId)?.stackable).map((x) => x.qty)),
            stack = ins.filter((x) => item(x.itemId)?.stackable).length,
            outStack = !!item(j.output.itemId)?.stackable;
          const max = nonstack
            ? Math.floor((free - stack - (outStack ? 1 : 0)) / nonstack)
            : outStack
              ? free - stack - 1 >= 0
                ? 1e9
                : 0
              : free - stack;
          const n = Math.max(
            0,
            Math.min(
              max,
              ...ins.map((x) => Math.floor(((p.bank[x.itemId] || 0) + held(p, x.itemId)) / x.qty)),
            ),
          );
          for (const x of ins) {
            const q = n * x.qty;
            add(p.bank, x.itemId, -q);
            put(p, x.itemId, q);
          }
          return n;
        }
        function run(options, random, mode) {
          const j = jobs.get(Number(options.jobId));
          if (!j) throw new Error("未知工作");
          if (j.grow !== undefined) return runFarm(options, random, mode);
          const p = clone(options.player),
            rarity = Number(options.rarity || 0),
            startTick = p.lastTick;
          if (level(p.skills[j.skill]) < j.levelReq) throw new Error("当前等级尚未解锁这个工作");
          p.pack = p.pack || [];
          p.bank = p.bank || {};
          p.skills = p.skills || {};
          const site =
            (p.route?.jobId === j.id && p.workRarity === rarity
              ? map.sites.find((s) => s.id === p.route.siteId)
              : null) || nearestSite(j, p);
          if (!site) throw new Error("没有找到可用工作地点");
          const ins = inputs(j, rarity);
          for (const x of ins) p.bank[x.itemId] = Math.max(p.bank[x.itemId] || 0, 1e9);
          const target = data.xpTable[options.targetLevel],
            deadline = mode === "hour" ? startTick + 6000 : Infinity;
          const r = {
            attempts: 0,
            successes: 0,
            burnt: 0,
            caught: 0,
            ticks: 0,
            workTicks: 0,
            walkTicks: 0,
            bankTicks: 0,
            stunTicks: 0,
            inputs: {},
            outputs: {},
            xp: 0,
            trips: 0,
          };
          const matching = p.route?.jobId === j.id && p.workRarity === rarity;
          if (mode !== "hour" && p.skills[j.skill] >= target) return r;
          let phase = matching ? p.route.phase : canWork(p, j, rarity) ? "toWork" : "toBank";
          let alreadyWorking = matching && p.activity === "working" && phase === "working";
          const near = (s) => Math.abs(p.x - s.x) <= 1 && Math.abs(p.y - s.y) <= 1;
          function advance(ticks, kind) {
            const used = Math.min(ticks, deadline - p.lastTick);
            p.lastTick += used;
            r[kind] += used;
            return used === ticks;
          }
          function travel(destination, id) {
            if (near(destination)) return true;
            const end = adjacent(destination, id);
            if (!end) throw new Error("目标地点不可达");
            const route = path(p.x, p.y, end.x, end.y);
            if (!route) throw new Error("无法寻路；请在主地图上再计算");
            if (!advance(1, "bankTicks")) return false;
            const speed = Math.round(
              (1000 + Math.round(bonus(p.equipment?.mount) * 1000)) *
                (1 + 0.2 * brew(p, "swift", p.lastTick)) *
                master(p, "move"),
            );
            if (!advance(Math.ceil((route.length * 1000) / speed), "walkTicks")) return false;
            p.x = end.x;
            p.y = end.y;
            return true;
          }
          // Resume the game's already planned walk, with its recorded speed/stride.
          if (matching && p.activity === "walking" && p.path?.length) {
            const remaining = p.path.length - (p.pathIndex || 0),
              ticks = Math.max(
                0,
                Math.ceil((remaining * 1000 - (p.stride || 0)) / (p.strideSpeed || 1000)),
              );
            if (advance(ticks, "walkTicks")) Object.assign(p, p.path.at(-1));
          }
          while (p.lastTick < deadline && (mode === "hour" || p.skills[j.skill] < target)) {
            if (r.attempts >= (options.maxAttempts || 150000))
              throw new Error("目标需要过多工作次数；请缩小目标等级或选择更高经验的工作");
            if (phase === "toWork") {
              if (!travel(site, p.id)) break;
              if (!advance(1, "bankTicks")) break;
              phase = "working";
              alreadyWorking = false;
              continue;
            }
            if (phase === "toBank") {
              const bank = nearestBank(p);
              if (!bank) throw new Error("找不到可达仓库");
              if (!travel(bank, 0)) break;
              if (!advance(1, "bankTicks")) break;
              phase = "banking";
              continue;
            }
            if (phase === "banking") {
              if (!advance(1, "bankTicks")) break;
              for (const x of p.pack) add(p.bank, x.itemId, x.qty);
              p.pack = [];
              if (ins.length && !withdraw(p, j, rarity)) throw new Error("背包无法容纳这份配方");
              r.trips++;
              if (!advance(1, "bankTicks")) break;
              phase = "toWork";
              continue;
            }
            if (!canWork(p, j, rarity)) {
              if (!advance(1, "bankTicks")) break;
              phase = "toBank";
              alreadyWorking = false;
              continue;
            }
            if (!alreadyWorking) {
              if (!advance(1, "bankTicks")) break;
              alreadyWorking = true;
            }
            if (
              (p.stunUntil || 0) > p.lastTick + 1 &&
              !advance(p.stunUntil - p.lastTick - 1, "stunTicks")
            )
              break;
            const probability = j.inputs.length === 0 && p.skills[j.skill] === 0 ? 1 : chance(p, j);
            const wait =
              probability === 1
                ? 1
                : Math.floor(Math.log(1 - random()) / Math.log(1 - probability)) + 1;
            if (!advance(wait, "workTicks")) break;
            r.attempts++;
            for (const x of ins) {
              remove(p, x.itemId, x.qty);
              add(r.inputs, x.itemId, x.qty);
            }
            if (random() < failure(p, j)) {
              if (j.burn) {
                r.burnt++;
                put(p, j.burn.itemId, 1);
                add(r.outputs, j.burn.itemId, 1);
              } else {
                r.caught++;
                p.stunUntil = p.lastTick + j.caught.stunTicks;
              }
              continue;
            }
            r.successes++;
            const gathering = !ins.length && j.output.itemId !== c.coins;
            const outputProbs = gathering
              ? rarityProbabilities(p, j, p.lastTick, options.windows)
              : null;
            const rt = gathering ? draw(outputProbs, random) : rarity;
            const output = j.output.itemId === c.coins ? c.coins : identity(j.output.itemId, rt),
              gain = xp(p, j, p.lastTick, options.windows, rt);
            p.skills[j.skill] += gain;
            r.xp += gain;
            // Price every rarity by its conditional expectation, including very rare tiers
            // which a small timing simulation may never actually draw.
            if (outputProbs)
              for (let t = 0; t < 5; t++)
                add(r.outputs, identity(j.output.itemId, t), outputProbs[t] * j.output.qty);
            else add(r.outputs, output, j.output.qty);
            if (output !== c.coins && !put(p, output, j.output.qty))
              add(p.bank, output, j.output.qty);
            if (j.bonus) {
              const probs = eligible.has(j.bonus.itemId)
                ? rarityProbabilities(p, j, p.lastTick, options.windows)
                : [1, 0, 0, 0, 0];
              const bonusTier = draw(probs, random);
              // Expected auxiliary loot is priced separately, avoiding rare-drop sample noise.
              const id = identity(
                j.bonus.itemId,
                seeds.has(j.bonus.itemId) ? Math.max(1, bonusTier) : bonusTier,
              );
              for (let t = 0; t < 5; t++)
                if (probs[t] > 0)
                  add(
                    r.outputs,
                    identity(j.bonus.itemId, seeds.has(j.bonus.itemId) ? Math.max(1, t) : t),
                    probs[t] * j.bonus.chance,
                  );
              if (random() < j.bonus.chance) put(p, id, 1);
            }
          }
          r.ticks = p.lastTick - startTick;
          return r;
        }
        function runFarm(options, random, mode) {
          // A single selected field: explicitly labelled in the UI. Other plots remain untouched.
          const j = jobs.get(Number(options.jobId)),
            p = clone(options.player),
            rarity = Number(options.rarity || 0),
            start = p.lastTick,
            target = data.xpTable[options.targetLevel];
          if (level(p.skills.farming) < j.levelReq) throw new Error("当前等级尚未解锁这项种植");
          const end = mode === "hour" ? start + 6000 : Infinity;
          const r = {
            attempts: 0,
            successes: 0,
            burnt: 0,
            caught: 0,
            ticks: 0,
            workTicks: 0,
            walkTicks: 0,
            bankTicks: 0,
            stunTicks: 0,
            inputs: {},
            outputs: {},
            xp: 0,
            trips: 0,
          };
          let seedStock = 0;
          function advance(ticks) {
            const n = Math.min(ticks, end - p.lastTick);
            p.lastTick += n;
            r.workTicks += n;
            return n === ticks;
          }
          while (p.lastTick < end && (mode === "hour" || p.skills.farming < target)) {
            if (r.attempts >= (options.maxAttempts || 150000)) throw new Error("种植目标过大");
            const seed = identity(j.inputs[0].itemId, rarity),
              cost = j.inputs[0].qty;
            if (seedStock < cost) {
              add(r.inputs, seed, cost - seedStock);
              seedStock = cost;
            }
            seedStock -= cost;
            const planted = p.lastTick;
            if (!advance(1)) break;
            const grow = Math.round(j.grow / (1 + home(p, "gatherSpeed", "farming"))),
              maxWater = Math.floor(j.grow / 40),
              trimEach = Math.round(20 * (1 + bonus(p.equipment?.hoe)));
            let trim = 0,
              watered = 0;
            while (p.lastTick < planted + grow - Math.min(trim, Math.floor(grow / 2))) {
              const mature = planted + grow - Math.min(trim, Math.floor(grow / 2)),
                next = (Math.floor(p.lastTick / 100) + 1) * 100;
              if (watered < maxWater && next < mature) {
                if (!advance(next - p.lastTick)) break;
                watered++;
                trim += trimEach;
                const gain = Math.max(
                  1,
                  Math.round(j.xp * 0.1 * xpMultiplier(p, j, p.lastTick, options.windows, true)),
                );
                p.skills.farming += gain;
                r.xp += gain;
                if (mode !== "hour" && p.skills.farming >= target) break;
              } else {
                advance(mature - p.lastTick);
                break;
              }
            }
            if (p.lastTick >= end || (mode !== "hour" && p.skills.farming >= target)) break;
            if (!advance(1)) break;
            r.attempts++;
            r.successes++;
            const lev = level(p.skills.farming),
              count =
                3 +
                Math.floor(random() * 3) +
                Math.floor(lev / 100) +
                (random() < (lev / 100) % 1 ? 1 : 0);
            add(r.outputs, identity(j.output.itemId, rarity), count);
            const gain = xp(p, j, p.lastTick, options.windows, rarity);
            p.skills.farming += gain;
            r.xp += gain;
            for (let k = 0; k < cost; k++) {
              const rt = draw(rarityProbabilities(p, j, p.lastTick, options.windows, true), random);
              const id = identity(j.inputs[0].itemId, rt);
              if (rt === rarity) seedStock++;
              else add(r.outputs, id, 1);
            }
          }
          r.ticks = p.lastTick - start;
          return r;
        }
        const quantile = (values, q) => {
          const xs = [...values].sort((a, b) => a - b);
          return xs[Math.min(xs.length - 1, Math.ceil(q * xs.length) - 1)] || 0;
        };
        function summarize(runs) {
          const result = {};
          for (const k of [
            "attempts",
            "successes",
            "burnt",
            "caught",
            "ticks",
            "workTicks",
            "walkTicks",
            "bankTicks",
            "stunTicks",
            "xp",
            "trips",
          ])
            result[k] = sum(runs.map((x) => x[k])) / runs.length;
          for (const k of ["inputs", "outputs"]) {
            result[k] = {};
            for (const r of runs)
              for (const [id, n] of Object.entries(r[k])) add(result[k], id, n / runs.length);
          }
          result.seconds = (result.ticks * c.tickMs) / 1000;
          result.secondsP05 = quantile(
            runs.map((r) => (r.ticks * c.tickMs) / 1000),
            0.05,
          );
          result.secondsP95 = quantile(
            runs.map((r) => (r.ticks * c.tickMs) / 1000),
            0.95,
          );
          result.attemptsP95 = quantile(
            runs.map((r) => r.attempts),
            0.95,
          );
          result.materialsP95 = {};
          for (const id of Object.keys(result.inputs))
            result.materialsP95[id] = quantile(
              runs.map((r) => r.inputs[id] || 0),
              0.95,
            );
          return result;
        }
        function forecast(options) {
          if (
            !Number.isSafeInteger(options.player?.lastTick) ||
            !Number.isFinite(options.player?.skills?.[jobs.get(Number(options.jobId))?.skill])
          )
            throw new Error("等待有效角色快照");
          if (
            jobs.get(Number(options.jobId)).grow === undefined &&
            map.regions?.some(
              (r) =>
                r.name === "Home" &&
                options.player.x >= r.x &&
                options.player.y >= r.y &&
                options.player.x < r.x + r.width &&
                options.player.y < r.y + r.height,
            )
          )
            throw new Error("动态家园路线尚未校准；请返回主地图后计算完整时间");
          const current = level(options.player.skills[jobs.get(Number(options.jobId)).skill]);
          if (
            !Number.isInteger(options.targetLevel) ||
            options.targetLevel < 1 ||
            options.targetLevel >= data.xpTable.length
          )
            throw new Error(`目标等级须为 1–${data.xpTable.length - 1} 的整数`);
          const count = clamp(options.samples || 32, 8, 128),
            planRuns = [],
            hourRuns = [];
          for (let i = 0; i < count; i++) {
            planRuns.push(run(options, rng(7919 * (i + 1)), "target"));
            hourRuns.push(run(options, rng(104729 * (i + 1)), "hour"));
          }
          const plan = summarize(planRuns),
            hour = summarize(hourRuns);
          const materials = Object.entries(plan.inputs).map(([id, mean]) => {
            id = Number(id);
            const owned =
              (options.player.bank?.[id] || 0) +
              held({ ...options.player, pack: options.player.pack || [] }, id);
            return {
              id,
              mean,
              p95: plan.materialsP95[id],
              owned,
              shortage: Math.max(0, Math.ceil(mean) - owned),
              shortageP95: Math.max(0, Math.ceil(plan.materialsP95[id]) - owned),
            };
          });
          return {
            jobId: Number(options.jobId),
            currentLevel: current,
            targetLevel: options.targetLevel,
            xpLeft: Math.max(
              0,
              data.xpTable[options.targetLevel] -
                options.player.skills[jobs.get(Number(options.jobId)).skill],
            ),
            samples: count,
            plan,
            hour,
            materials,
            farming: jobs.get(Number(options.jobId)).grow !== undefined,
            build: data.version.version,
          };
        }
        function forecastHour(options) {
          const j = jobs.get(Number(options.jobId));
          if (
            !j ||
            !Number.isSafeInteger(options.player?.lastTick) ||
            !Number.isFinite(options.player.skills?.[j.skill])
          )
            throw new Error("等待有效角色快照");
          if (
            j.grow === undefined &&
            map.regions?.some(
              (r) =>
                r.name === "Home" &&
                options.player.x >= r.x &&
                options.player.y >= r.y &&
                options.player.x < r.x + r.width &&
                options.player.y < r.y + r.height,
            )
          )
            throw new Error("家园路线尚未校准");
          const count = clamp(options.samples || 8, 8, 128),
            runs = [];
          for (let i = 0; i < count; i++) runs.push(run(options, rng(104729 * (i + 1)), "hour"));
          return {
            jobId: j.id,
            hour: summarize(runs),
            samples: count,
            farming: j.grow !== undefined,
          };
        }
        return {
          data,
          jobs,
          item,
          level,
          base,
          tier,
          inputs,
          tool,
          brew,
          brewTier,
          master,
          home,
          rotation,
          xpMultiplier,
          xp,
          rarityProbabilities,
          chance,
          failure,
          path,
          adjacent,
          nearestBank,
          nearestSite,
          farmingStatus,
          forecast,
          forecastHour,
          run,
          summarize,
          rng,
        };
      }
      function fillBook(levels, qty, side, taxBp = 0) {
        let left = qty,
          gross = 0;
        const fills = [];
        for (const l of [...levels]
          .filter((l) => l.price > 0 && l.qty > 0)
          .sort((a, b) => (side === "buy" ? a.price - b.price : b.price - a.price))) {
          const n = Math.min(left, l.qty);
          if (n <= 0) break;
          left -= n;
          gross += n * l.price;
          fills.push({ price: l.price, qty: n });
        }
        return {
          gross,
          net: side === "sell" ? gross * (1 - taxBp / 10000) : gross,
          filled: qty - left,
          left,
          fills,
        };
      }
      function vendorPrice(id, books, pricing = {}) {
        // Enhancements do not change buyback value; received server floors take precedence.
        const plain = id % 10000,
          price = books[id]?.floor ?? pricing.vendorPrices?.[plain];
        return price > 0 ? price : null;
      }
      function valueFlows(flow, books, mode, taxBp, now = Date.now(), pricing = {}) {
        const missing = [],
          stale = [],
          partial = [],
          details = [],
          estimated = [];
        let total = 0,
          unknownTax = false;
        const put = (id, qty, price, source, extra = {}) => {
          if (qty <= 1e-9) return;
          const taxed = source === "market" && mode !== "buy";
          if (taxed && taxBp == null) unknownTax = true;
          const value = qty * price * (taxed ? 1 - (taxBp ?? 0) / 10000 : 1);
          total += value;
          details.push({ id, qty, value, price, source, ...extra });
        };
        for (const [key, qty] of Object.entries(flow)) {
          const id = Number(key);
          if (!(qty > 0)) continue;
          if (id === 200) {
            put(id, qty, 1, "coins");
            continue;
          }
          const b = books[id] || {},
            sell = mode !== "buy",
            vendor = sell ? vendorPrice(id, books, pricing) : pricing.vendorBuys?.[id],
            factor = sell ? 1 - (taxBp ?? 0) / 10000 : 1;
          const quote =
            mode === "buy" ? b.ask : mode === "sell" ? b.bid : mode === "list" ? b.ask : null;
          const side = mode === "sell" ? "bid" : "ask",
            quoteAt = b[side + "At"] ?? b.at,
            depthAt = b[side + "DepthAt"] ?? b.depthAt;
          if (mode !== "vendor" && quote > 0 && now - (quoteAt || 0) > 300000) stale.push(id);
          const levels = mode === "buy" ? b.asks : mode === "sell" ? b.bids : null;
          let left = qty;
          if (mode !== "vendor" && Array.isArray(levels)) {
            const old = now - (depthAt || 0) > 300000;
            const useful = levels.filter(
              (x) => !(vendor > 0) || (sell ? x.price * factor > vendor : x.price < vendor),
            );
            const fill = fillBook(useful, qty, mode, taxBp ?? 0);
            for (const f of fill.fills)
              put(id, f.qty, f.price, "market", { depth: !old, estimated: old, quoteAt: depthAt });
            if (old && fill.filled > 0) estimated.push(id);
            left = fill.left;
          } else if (
            mode !== "vendor" &&
            quote > 0 &&
            (!(vendor > 0) || (sell ? quote * factor > vendor : quote < vendor))
          ) {
            const old = now - (quoteAt || 0) > 300000,
              available =
                mode === "list"
                  ? qty
                  : Number.isFinite(b[side + "Qty"])
                    ? Math.max(0, b[side + "Qty"])
                    : qty,
              filled = Math.min(qty, available);
            put(id, filled, quote, "market", { depth: false, estimated: old, quoteAt });
            if (old && filled > 0) estimated.push(id);
            left = qty - filled;
          }
          if (left > 1e-9 && vendor > 0) {
            put(id, left, vendor, "vendor");
            left = 0;
          }
          // Restored asks are short-lived cost estimates, never executable orders.
          // Prefer more recent trade history when it supersedes the cached ask.
          const history =
            mode === "buy" &&
            b.history?.price > 0 &&
            Number.isFinite(b.history.tradeAt) &&
            b.history.tradeAt <= now &&
            now - b.history.tradeAt <= 7 * 86400000
              ? b.history
              : null;
          const cached =
            mode === "buy" &&
            Number.isFinite(b.purchaseCache?.price) &&
            b.purchaseCache.price > 0 &&
            Number.isFinite(b.purchaseCache.at) &&
            b.purchaseCache.at <= now &&
            now - b.purchaseCache.at <= 86400000
              ? b.purchaseCache
              : null;
          if (left > 1e-9 && (cached || history)) {
            if (cached && (!history || cached.at > history.tradeAt))
              put(id, left, cached.price, "cached", { estimated: true, cachedAt: cached.at });
            else
              put(id, left, history.price, "history", {
                estimated: true,
                tradeAt: history.tradeAt,
              });
            estimated.push(id);
            left = 0;
          }
          // Known nontradable outputs have no cash resale value, rather than an unknown price.
          if (
            left > 1e-9 &&
            sell &&
            Object.hasOwn(pricing.vendorPrices || {}, id % 10000) &&
            pricing.vendorPrices[id % 10000] === null
          ) {
            put(id, left, 0, "nontradable");
            left = 0;
          }
          if (left > 1e-9) {
            if (left < qty) partial.push({ id, unfilled: left, filled: qty - left });
            else missing.push(id);
            details.push({ id, qty: left, value: null, source: "missing" });
          }
        }
        return {
          total: missing.length || partial.length || unknownTax ? null : total,
          pricedSubtotal: total,
          missing,
          stale,
          partial,
          details,
          estimated,
          unknownTax,
          vendorSubtotal: sum(details.filter((x) => x.source === "vendor").map((x) => x.value)),
          coinSubtotal: sum(details.filter((x) => x.source === "coins").map((x) => x.value)),
        };
      }
      function profits(hour, books, taxBp, now, pricing = {}) {
        const cost = valueFlows(hour.inputs, books, "buy", taxBp, now, pricing),
          immediate = valueFlows(hour.outputs, books, "sell", taxBp, now, pricing),
          listing = valueFlows(hour.outputs, books, "list", taxBp, now, pricing),
          vendor = valueFlows(hour.outputs, books, "vendor", taxBp, now, pricing);
        const net = (revenue) =>
          revenue.total !== null && cost.total !== null ? revenue.total - cost.total : null;
        return {
          cost,
          immediate,
          listing,
          vendor,
          immediateProfit: net(immediate),
          listingProfit: net(listing),
          vendorProfit: net(vendor),
          immediateKnownNet: immediate.pricedSubtotal - cost.pricedSubtotal,
          listingKnownNet: listing.pricedSubtotal - cost.pricedSubtotal,
          vendorKnownNet: vendor.pricedSubtotal - cost.pricedSubtotal,
        };
      }
      function dailyProfits(hour, books, taxBp, now, pricing) {
        const daily = { inputs: {}, outputs: {} };
        for (const kind of ["inputs", "outputs"])
          for (const [id, n] of Object.entries(hour[kind] || {})) daily[kind][id] = n * 24;
        // Quote depth is consumed once across the whole projected day.
        return profits(daily, books, taxBp, now, pricing);
      }
      function formatNumber(n, d = 0) {
        if (!Number.isFinite(n)) return "—";
        const units = ["", "K", "M", "B"];
        let i = Math.min(3, Math.max(0, Math.floor(Math.log10(Math.max(1, Math.abs(n))) / 3)));
        let scaled = n / 1000 ** i;
        if (i && Math.abs(Number(scaled.toFixed(2))) >= 1000 && i < 3) {
          i++;
          scaled = n / 1000 ** i;
        }
        const text = scaled.toLocaleString("en-US", { maximumFractionDigits: i ? 2 : d });
        return (text === "-0" ? "0" : text) + units[i];
      }
      return {
        create,
        hash,
        rng,
        fillBook,
        vendorPrice,
        valueFlows,
        profits,
        dailyProfits,
        formatNumber,
      };
    });

    let model;
    self.onmessage = function (e) {
      try {
        model = model || self.DVIPlannerCore.create(e.data.data);
        const result = e.data.options.hourOnly
          ? model.forecastHour(e.data.options)
          : model.forecast(e.data.options);
        self.postMessage({ result });
      } catch (error) {
        self.postMessage({ error: error.message });
      }
    };
  }
  const WORKER_SOURCE = "(" + runForecastWorker.toString() + ")();";
  // ---- End local forecast worker ----

  // ---- src/ui.js ----
  ("use strict");
  const model = globalThis.DVIPlannerCore.create(GAME_DATA);
  const i18n = globalThis.DVIInsightsI18n.create({
    storage: { getItem: (key) => localStorage.getItem(key) },
    document,
    navigator,
  });
  const t = (key, values) => i18n.t(key, values);
  const errorText = (message) => i18n.error(message);
  let historicalCache = {};
  try {
    historicalCache = JSON.parse(localStorage.getItem("dvi-assistant.price-history.v1") || "{}");
    if (!historicalCache || typeof historicalCache !== "object" || Array.isArray(historicalCache))
      historicalCache = {};
  } catch {}
  let purchaseCache = {};
  try {
    purchaseCache = JSON.parse(localStorage.getItem("dvi-insights.purchase-prices.v1") || "{}");
  } catch {}
  const store = globalThis.DVIPlannerObserver.createStore(
    () => Date.now(),
    historicalCache,
    purchaseCache,
  );
  let historicalSaveTimer = null;
  function saveHistory() {
    historicalSaveTimer = null;
    try {
      localStorage.setItem("dvi-assistant.price-history.v1", JSON.stringify(store.exportHistory()));
      localStorage.setItem(
        "dvi-insights.purchase-prices.v1",
        JSON.stringify(store.exportPurchases()),
      );
    } catch {}
  }
  store.subscribe(() => {
    if (!historicalSaveTimer) historicalSaveTimer = setTimeout(saveHistory, 30000);
  });
  const restoreParser = globalThis.DVIPlannerObserver.install(window, store);
  const LABELS = {
    mining: "采矿",
    fishing: "钓鱼",
    woodcutting: "伐木",
    farming: "种植",
    thieving: "偷窃",
    cooking: "烹饪",
    smithing: "锻造",
    fletching: "箭矢制作",
    herblore: "炼药",
    crafting: "制作",
  };
  const TIERS = ["普通", "罕见", "稀有", "史诗", "传说"];
  const fmt = globalThis.DVIPlannerCore.formatNumber;
  const duration = (s) => i18n.duration(s);
  const escape = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  const nameOf = (name) =>
    i18n.language === "en"
      ? name
      : GAME_DATA.labels?.[name] ||
        (name?.startsWith("Cook ") ? `烹饪${nameOf(name[5].toUpperCase() + name.slice(6))}` : name);
  const itemName = (id) =>
    id === GAME_DATA.constants.coins
      ? t("金币")
      : (i18n.language === "en"
          ? model.item(id)?.name || t("物品 {id}", { id })
          : `${TIERS[model.tier(id)]} ${nameOf(model.item(model.base(id))?.name || t("物品 {id}", { id }))}`) +
        (Math.floor(id / 10000) ? ` +${Math.floor(id / 10000)}` : "");
  let preferences = { targets: {}, potionCost: true };
  try {
    const saved = JSON.parse(localStorage.getItem("dvi-planner.preferences.v1") || "{}");
    preferences.targets = saved.targets && typeof saved.targets === "object" ? saved.targets : {};
    preferences.potionCost = saved.potionCost !== false;
  } catch {}
  function save() {
    try {
      localStorage.setItem("dvi-planner.preferences.v1", JSON.stringify(preferences));
    } catch {}
  }
  window.addEventListener("pagehide", (e) => {
    if (!e.persisted) {
      clearTimeout(historicalSaveTimer);
      saveHistory();
      restoreParser();
    }
  });
  function playerCopy(p) {
    // Allow-list computational fields. Never serializes chat, credentials or account identity.
    const keys = [
      "id",
      "lastTick",
      "skills",
      "equipment",
      "perks",
      "masteries",
      "house",
      "houseFurniture",
      "brews",
      "brewTier",
      "brewBuckets",
      "guildBonus",
      "x",
      "y",
      "homeBank",
      "pack",
      "bank",
      "route",
      "workJobId",
      "workSiteId",
      "workRarity",
      "activity",
      "path",
      "pathIndex",
      "stride",
      "strideSpeed",
      "stunUntil",
      "plots",
      "plantPlainest",
    ];
    const out = {};
    for (const k of keys) if (p[k] !== undefined) out[k] = p[k];
    return JSON.parse(JSON.stringify(out));
  }
  function potionFlow(ticks, options) {
    const p = options.player,
      start = p.lastTick,
      end = start + ticks,
      flow = {};
    for (const kind of ["elixir", "gatherer", "hunter", "swift"]) {
      if (
        kind === "gatherer" &&
        model.jobs.get(options.jobId).inputs.length &&
        model.jobs.get(options.jobId).grow === undefined
      )
        continue;
      let time = start;
      while (time < end && (p.brews?.[kind] || 0) > time) {
        const rarity = model.brewTier(p, kind, time),
          buckets = p.brewBuckets?.[kind];
        let until = p.brews[kind];
        if (buckets?.length) {
          let consumed = 0;
          for (let i = buckets.length - 1; i >= rarity; i--) consumed += buckets[i];
          until = Math.min(until, p.brews[kind] - buckets.reduce((a, b) => a + b, 0) + consumed);
        }
        until = Math.min(end, until);
        if (until <= time) break;
        const potion = GAME_DATA.potions.find((x) => x.kind === kind && x.tier === rarity);
        if (potion) flow[potion.id] = (flow[potion.id] || 0) + (until - time) / 6000;
        time = until;
      }
    }
    return flow;
  }
  function hourProfit(result, options) {
    const hour = { ...result.hour, inputs: { ...result.hour.inputs } };
    if (preferences.potionCost)
      for (const [id, n] of Object.entries(potionFlow(hour.ticks, options)))
        hour.inputs[id] = (hour.inputs[id] || 0) + n;
    return globalThis.DVIPlannerCore.dailyProfits(
      hour,
      store.state.books,
      store.state.taxBp,
      Date.now(),
      GAME_DATA,
    );
  }
  function profitText(profit, kind = "immediate") {
    const net = profit[kind + "Profit"];
    if (!Number.isFinite(net)) return "—";
    return `${profit.cost.estimated?.length || profit[kind].estimated?.length ? "≈ " : ""}${fmt(net)} ${t("金币/d")}`;
  }
  function costText(amount, missing, estimated = false) {
    return missing ? t("待报价") : `${estimated ? "≈ " : ""}${fmt(amount)} ${t("金币/d")}`;
  }
  const missingPriceIds = (value) => [
    ...new Set([...value.missing, ...value.partial.map((x) => x.id)]),
  ];
  function profitHint(profit, kind = "immediate") {
    const income = profit[kind],
      parts = [`${t("产值")} ${fmt(income.pricedSubtotal)} ${t("金币/d")}`];
    const missing = missingPriceIds(profit.cost);
    if (missing.length) {
      parts.push(
        t("缺价：{items}", {
          items: missing
            .map((id) => itemName(Number(id)))
            .join(i18n.language === "en" ? ", " : "、"),
        }),
      );
      if (profit.cost.pricedSubtotal > 0)
        parts.push(`${t("部分成本")} ${fmt(profit.cost.pricedSubtotal)} ${t("金币/d")}`);
    } else parts.push(`${t("成本")} ${fmt(profit.cost.pricedSubtotal)} ${t("金币/d")}`);
    if (income.missing.length || income.partial.length) parts.push(t("产物缺价"));
    if (income.unknownTax) parts.push(t("税率待接收"));
    const details = [...profit.cost.details, ...income.details],
      age = (stamp) => {
        const minutes = Math.max(0, Math.floor((Date.now() - stamp) / 60000));
        return minutes < 1
          ? t("刚更新")
          : minutes < 60
            ? t("{n}分钟前", { n: minutes })
            : minutes < 1440
              ? t("{n}小时前", { n: Math.floor(minutes / 60) })
              : t("{n}天前", { n: Math.floor(minutes / 1440) });
      };
    const quotes = details.map((x) => x.quoteAt).filter((x) => Number.isFinite(x) && x > 0);
    if (quotes.length) parts.push(t("报价 {age}", { age: age(Math.min(...quotes)) }));
    const history = details
      .filter((x) => x.source === "history")
      .map((x) => x.tradeAt)
      .filter(Number.isFinite);
    if (history.length) parts.push(t("历史价 {age}", { age: age(Math.min(...history)) }));
    const cached = details
      .filter((x) => x.source === "cached")
      .map((x) => x.cachedAt)
      .filter(Number.isFinite);
    if (cached.length) parts.push(t("缓存价 {age}", { age: age(Math.min(...cached)) }));
    return parts.join(" · ");
  }
  function rarityTable(options, job) {
    if (job.inputs.length || job.output.itemId === 200 || job.grow !== undefined) return "";
    const probabilities = model.rarityProbabilities(
      options.player,
      job,
      options.player.lastTick,
      options.windows,
    );
    return `<table><thead><tr>${["稀有度", "当前概率", "求购", "挂售", "商人"].map((x) => `<th>${t(x)}</th>`).join("")}</tr></thead><tbody>${probabilities
      .map((p, tier) => {
        const id = job.output.itemId + tier * 1000,
          b = store.state.books[id];
        return `<tr><td>${t(TIERS[tier])}</td><td>${fmt(p * 100, 6)}%</td><td>${fmt(b?.bid, 2)}</td><td>${fmt(b?.ask, 2)}</td><td>${fmt(globalThis.DVIPlannerCore.vendorPrice(id, store.state.books, GAME_DATA), 2)}</td></tr>`;
      })
      .join(
        "",
      )}</tbody></table><p class="dvi-note">${t("当前单次概率；预测会计算已知加成到期。每个稀有度分别计价，包括极低概率掉落。")}</p>`;
  }
  function modelContext(options, job) {
    const p = options.player,
      tick = p.lastTick,
      r = model.rotation(tick),
      slot = {
        mining: "pickaxe",
        fishing: "rod",
        woodcutting: "axe",
        thieving: "gloves",
        cooking: "pan",
        smithing: "hammer",
        fletching: "knife",
        crafting: "needle",
        herblore: "mortar",
        farming: "hoe",
      }[job.skill];
    const working = model.tool(p.equipment?.[slot]),
      mount = model.tool(p.equipment?.mount),
      gather = !job.inputs.length || job.grow !== undefined;
    const lines = [
      t("当前 {skill} {level} 级；经验合计 +{xp}%", {
        skill: t(LABELS[job.skill]),
        level: model.level(p.skills[job.skill]),
        xp: fmt((model.xpMultiplier(p, job, tick, options.windows) - 1) * 100, 2),
      }),
      t("工具速度 +{tool}%；任务速度 perk +{perk}%；已摆放房屋 +{house}%；{kind}精通 +{master}%", {
        tool: fmt((working?.bonus || 0) * 100, 2),
        perk: fmt((p.perks?.quick || 0) * 0.5, 2),
        house: fmt(model.home(p, gather ? "gatherSpeed" : "craftSpeed", job.skill) * 100, 2),
        kind: t(gather ? "采集" : "制作"),
        master: fmt((model.master(p, gather ? "gather" : "craft") - 1) * 100, 2),
      }),
      t("坐骑速度 +{mount}%；当前疾行 +{swift}%；移动精通 +{move}%", {
        mount: fmt((mount?.bonus || 0) * 100, 2),
        swift: fmt(model.brew(p, "swift", tick) * 20, 2),
        move: fmt((model.master(p, "move") - 1) * 100, 2),
      }),
      t("轮换：{skill} {kind} +{bonus}%，{time}后切换；后续轮换也参与预测", {
        skill: t(LABELS[r.skill] || { combat: "战斗", enhancing: "强化" }[r.skill] || r.skill),
        kind: t(r.kind === "xp" ? "经验" : "稀有发现"),
        bonus: fmt((r.mult - 1) * 100),
        time: duration((r.until - tick) * 0.6),
      }),
      t(
        "已生效的经验/稀有精通、世界窗口、公会、祝福和剩余药水参与计算。未来房屋升级与领取任务奖励未预测。",
      ),
    ];
    return lines.map((line) => `<p class="dvi-note">${escape(line)}</p>`).join("");
  }

  // ---- src/combat-ui.js ----
  ("use strict");
  const combatMonitor = globalThis.DVICombat.create(model);
  const BREW_NAMES = {
    warrior: "战士",
    haste: "急速",
    abyssal: "深渊",
    nourish: "滋养",
    hunter: "猎人",
    elixir: "经验",
    swift: "疾行",
  };
  const brewName = (kind) =>
    i18n.language === "en" && kind === "elixir" ? t("经验药水") : t(BREW_NAMES[kind]);
  let combatBox = null;
  let combatLastRendered = 0,
    combatLastKey = "";

  function renderCombat(actual) {
    const p = store.state.player,
      report = p ? combatMonitor.sample(p, store.state.windows) : null;
    const host = document.querySelector("[data-plan]");
    if (!host || !report) {
      combatBox?.remove();
      combatBox = null;
      combatLastRendered = 0;
      return;
    }
    const displayKey = `${i18n.language}:${report.zone}:${report.ready}`;
    if (
      combatBox?.isConnected &&
      displayKey === combatLastKey &&
      Date.now() - combatLastRendered < 5000
    )
      return;
    combatLastRendered = Date.now();
    combatLastKey = displayKey;
    if (!combatBox?.isConnected) {
      combatBox = document.createElement("div");
      combatBox.className = "dvi-native-work dvi-native-combat";
      combatBox.dataset.noI18n = "";
      combatBox.innerHTML =
        '<details><summary><span class="dvi-native-summary" data-combat-profit></span><span class="dvi-native-action">明细</span></summary><div data-combat-details></div></details><div class="dvi-native-secondary" data-combat-real></div><div class="dvi-native-secondary" data-combat-sustain></div><div class="dvi-native-brews" data-combat-brews></div>';
      const progress = host.querySelector("[data-plan-progress]");
      if (progress) progress.insertAdjacentElement("afterend", combatBox);
      else host.append(combatBox);
      for (const event of ["click", "pointerdown", "keydown"])
        combatBox.addEventListener(event, (e) => e.stopPropagation());
    }
    setNativeText(combatBox.querySelector(".dvi-native-action"), t("明细"));
    const core = globalThis.DVIPlannerCore,
      profit = core.dailyProfits(
        report.hour,
        store.state.books,
        store.state.taxBp,
        Date.now(),
        GAME_DATA,
      );
    if (report.unknownFood)
      for (const key of ["immediateProfit", "listingProfit", "vendorProfit"]) profit[key] = null;
    const foodInputs = Object.fromEntries(
      Object.entries(report.hour.food).map(([id, n]) => [id, n * 24]),
    );
    const food = core.valueFlows(foodInputs, store.state.books, "buy", 0, Date.now(), GAME_DATA);
    const potionInputs = { ...report.hour.inputs };
    for (const [id, n] of Object.entries(report.hour.food)) {
      potionInputs[id] -= n;
      if (Math.abs(potionInputs[id]) < 1e-12) delete potionInputs[id];
    }
    for (const id of Object.keys(potionInputs)) potionInputs[id] *= 24;
    const potions = core.valueFlows(
      potionInputs,
      store.state.books,
      "buy",
      0,
      Date.now(),
      GAME_DATA,
    );
    let text = report.ready
      ? t("期望日利 {value}", { value: profitText(profit) })
      : t("观测中 · {time} / 1 分", { time: duration(report.seconds) });
    if (report.ready && report.unknownFood) text += " · " + t("食物成本待核实");
    const summary = combatBox.querySelector("[data-combat-profit]");
    if (summary.textContent !== text) summary.textContent = text;
    summary.title = profitHint(profit);
    const rows = [
      ["收入", profit.immediate.pricedSubtotal, false],
      ["食物成本", -food.pricedSubtotal, food.total === null || report.unknownFood > 0],
      ["药水成本", -potions.pricedSubtotal, potions.total === null],
    ];
    const xpRows = Object.entries(report.hour.xp)
      .filter(([, n]) => n > 0)
      .map(
        ([skill, n]) =>
          `<span>${t("{skill}经验", { skill: t({ melee: "近战", ranged: "远程", magic: "魔法", defence: "防御", hitpoints: "生命" }[skill]) })}</span><span>${fmt(n)} XP/h</span>`,
      )
      .join("");
    const missing = missingPriceIds(profit.cost);
    const html = `<div class="dvi-native-breakdown">${rows.map(([label, n, missing], i) => `<span title="${missing ? t("缺买价") : (i === 1 && food.estimated.length) || (i === 2 && potions.estimated.length) ? t("估价") : ""}">${t(label)}</span><span class="${missing ? "" : n < 0 ? "dvi-native-negative" : "dvi-native-positive"}">${!report.ready ? t("观测中") : costText(n, missing, !!((i === 1 && food.estimated.length) || (i === 2 && potions.estimated.length)))}</span>`).join("")}${xpRows}</div>
    ${missing.length ? `<p class="dvi-warning" title="${escape(missing.map((id) => itemName(Number(id))).join(i18n.language === "en" ? ", " : "、"))}">${t("部分成本缺价")}</p>` : ""}
    ${report.unknownFood ? `<p class="dvi-warning">${t("部分食物成本待确认")}</p>` : ""}
    <p class="dvi-note" title="${t("挂售需等待买家")}">${t("商人")} ${report.ready ? profitText(profit, "vendor") : t("观测中")}<br>${t("挂售")} ${report.ready ? profitText(profit, "listing") : t("观测中")}</p>`;
    const details = combatBox.querySelector("[data-combat-details]");
    if (details.innerHTML !== html) details.innerHTML = html;
    const real = combatBox.querySelector("[data-combat-real]"),
      realHtml =
        actualIncomeHtml(actual) +
        (report.ready
          ? `<span title="${t("近五分钟遭遇数/小时，含死亡")}">EPH: ${fmt(report.encountersPerHour)}</span>`
          : "");
    if (real.innerHTML !== realHtml) real.innerHTML = realHtml;
    const foodTime =
      report.foodQty === 0
        ? t("无食物")
        : !report.ready || report.foodSeconds === null
          ? t("续航观测中")
          : t("约 {time}", { time: duration(report.foodSeconds) });
    const totalXp = Object.values(report.hour.xp).reduce((n, x) => n + x, 0);
    const sustain = `<span>${report.ready ? fmt(totalXp) + " XP/h" : t("经验观测中")}</span><span title="${escape(report.foodId !== null ? itemName(report.foodId) : t("无可用食物"))}">${t("食物 {qty} · {time}", { qty: fmt(report.foodQty), time: foodTime })}</span>`;
    const line = combatBox.querySelector("[data-combat-sustain]");
    if (line.innerHTML !== sustain) line.innerHTML = sustain;
    const brewHtml = report.potions
      .map(
        (b) =>
          `<span title="${escape(t("{tier} {name}；整组耗尽 {time}", { tier: t(TIERS[b.tier]), name: brewName(b.kind), time: duration(b.seconds) }) + (b.seconds > b.currentTierSeconds + 1 ? t("；当前强度结束后降为较低稀有度") : ""))}">${brewName(b.kind)} ${duration(b.currentTierSeconds).replace(/ 0 (?:秒|s)$| 0s$/, "")}</span>`,
      )
      .join("");
    const brewLine = combatBox.querySelector("[data-combat-brews]");
    if (brewLine.innerHTML !== brewHtml) brewLine.innerHTML = brewHtml;
  }

  // ---- src/activity-ui.js ----
  const activityMonitor = globalThis.DVIActivity.create(model);
  let currentWorkBox = null,
    currentWorkEstimate = null,
    currentWorkWorker = null,
    currentWorkTimeout = null;
  store.subscribeBatches((batch) => {
    activityMonitor.events(store.state.player, batch);
    scheduleNative();
  });
  function actualIncomeHtml(actual) {
    if (!actual) return "";
    if (!actual.ready) return `<span>${t("每天收入 {value}", { value: t("观测中") })}</span>`;
    if (store.state.player?.route?.onFull === "drop" && actual.jobId != null)
      return `<span title="${t("当前设置：丢弃产物")}">${t("每天收入 {value}", { value: t("暂不计") })}</span>`;
    const v = globalThis.DVIActivity.income(
      globalThis.DVIPlannerCore,
      actual.outputs,
      actual.seconds,
      store.state.books,
      store.state.taxBp,
      Date.now(),
      GAME_DATA,
    );
    const prefix = v.value.estimated.length ? "≈ " : "";
    const text = v.total === null ? "—" : `${prefix}${fmt(v.perDay)} ${t("金币/d")}`;
    return `<span title="${escape(t("累计 {value} {unit} · {time} · 未扣成本", { value: prefix + fmt(v.known), unit: t("金币"), time: duration(actual.seconds) }) + (v.total === null ? " · " + t("产物或税率缺价") : ""))}">${t("每天收入 {value}", { value: text })}</span>`;
  }
  function requestCurrentWork(actual) {
    if (
      currentWorkEstimate?.key === actual.key &&
      (currentWorkEstimate.busy || Date.now() - currentWorkEstimate.at < 30000)
    )
      return;
    currentWorkWorker?.terminate();
    clearTimeout(currentWorkTimeout);
    const options = {
      player: playerCopy(store.state.player),
      windows: JSON.parse(JSON.stringify(store.state.windows)),
      jobId: actual.jobId,
      rarity: store.state.player.workRarity || 0,
      samples: 8,
      hourOnly: true,
    };
    const entry = { key: actual.key, at: Date.now(), busy: true, options };
    currentWorkEstimate = entry;
    const finish = (message) => {
      if (currentWorkEstimate !== entry) return;
      clearTimeout(currentWorkTimeout);
      currentWorkWorker?.terminate();
      currentWorkWorker = null;
      entry.busy = false;
      entry.result = message.result;
      entry.error = message.error;
      scheduleNative();
    };
    try {
      const url = URL.createObjectURL(
        new Blob([WORKER_SOURCE], { type: "application/javascript" }),
      );
      try {
        currentWorkWorker = new Worker(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      currentWorkWorker.onmessage = (e) => finish(e.data);
      currentWorkWorker.onerror = () => finish({ error: "预测进程不可用" });
      currentWorkTimeout = setTimeout(() => finish({ error: "预测耗时过长" }), 15000);
      currentWorkWorker.postMessage({ data: GAME_DATA, options });
    } catch {
      finish({ error: "浏览器未允许本地计算" });
    }
  }
  function renderCurrentWork(actual) {
    const host = document.querySelector("[data-plan]");
    if (!host || actual?.jobId == null || !model.jobs.has(actual.jobId)) {
      currentWorkBox?.remove();
      currentWorkBox = null;
      return;
    }
    if (!currentWorkBox?.isConnected) {
      currentWorkBox = document.createElement("div");
      currentWorkBox.className = "dvi-native-work dvi-native-combat dvi-native-current-work";
      currentWorkBox.dataset.noI18n = "";
      currentWorkBox.innerHTML =
        '<details><summary><span class="dvi-native-summary" data-current-expect></span><span class="dvi-native-action">明细</span></summary><div data-current-details></div></details><div class="dvi-native-secondary" data-current-real></div><div class="dvi-native-secondary" data-current-xp></div>';
      const progress = host.querySelector("[data-plan-progress]");
      if (progress) progress.insertAdjacentElement("afterend", currentWorkBox);
      else host.append(currentWorkBox);
      for (const event of ["click", "pointerdown", "keydown"])
        currentWorkBox.addEventListener(event, (e) => e.stopPropagation());
    }
    setNativeText(currentWorkBox.querySelector(".dvi-native-action"), t("明细"));
    requestCurrentWork(actual);
    const entry = currentWorkEstimate;
    const profit =
        entry?.key === actual.key && entry.result ? hourProfit(entry.result, entry.options) : null,
      summary = currentWorkBox.querySelector("[data-current-expect]");
    let text = profit
      ? t("期望日利 {value}", { value: profitText(profit) })
      : entry.error
        ? t("预测暂不可用")
        : t("期望日利 {value}", { value: t("计算中…") });
    if (entry.result?.farming)
      text = profit ? t("单田预估 {value}", { value: profitText(profit) }) : text;
    if (store.state.player.route.onFull === "drop") text = t("丢弃产物 · 暂不估算日利");
    if (summary.textContent !== text) summary.textContent = text;
    summary.title = profit ? profitHint(profit) : errorText(entry.error) || "";
    const detail = currentWorkBox.querySelector("[data-current-details]"),
      html = profit ? nativeProfitHtml(profit, entry.result.hour, entry.options) : "";
    if (detail.innerHTML !== html) detail.innerHTML = html;
    const real = currentWorkBox.querySelector("[data-current-real]"),
      realHtml = actualIncomeHtml(actual);
    if (real.innerHTML !== realHtml) real.innerHTML = realHtml;
    const xp = currentWorkBox.querySelector("[data-current-xp]"),
      xpHtml = `<span title="${t("本次观测实际经验除以总时长")}">${actual.ready ? fmt(actual.xpPerHour) + " XP/h" : t("经验观测中")}</span>`;
    if (xp.innerHTML !== xpHtml) xp.innerHTML = xpHtml;
  }
  let offlineBaseline = null,
    gameSeenBaseline = null,
    offlineResumeAt = Date.now(),
    offlineSavedAt = 0;
  try {
    offlineBaseline = JSON.parse(localStorage.getItem("dvi-insights.offline-before.v1") || "null");
    gameSeenBaseline = JSON.parse(localStorage.getItem("deepvein-seen") || "null");
  } catch {}
  const offlineViews = new WeakMap();
  function saveOfflineBaseline() {
    if (!offlineBaseline) return;
    try {
      localStorage.setItem("dvi-insights.offline-before.v1", JSON.stringify(offlineBaseline));
      offlineSavedAt = Date.now();
    } catch {}
  }
  function captureOfflineBaseline(force = false) {
    if (
      !store.state.player ||
      (!force &&
        (document.hidden ||
          document.querySelector(".away-veil .away") ||
          Date.now() - offlineResumeAt < 10000))
    )
      return;
    offlineBaseline = globalThis.DVIActivity.offlineSnapshot(store.state.player);
    if (force || Date.now() - offlineSavedAt > 60000) saveOfflineBaseline();
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) captureOfflineBaseline(true);
    else offlineResumeAt = Date.now();
  });
  window.addEventListener("pagehide", () => captureOfflineBaseline(true));
  function renderOfflineIncome() {
    const host = document.querySelector(".away-veil .away");
    if (!host) {
      captureOfflineBaseline();
      return;
    }
    let flow = offlineViews.get(host);
    if (!flow) {
      const after = globalThis.DVIActivity.offlineSnapshot(store.state.player);
      if (!after) return;
      let before = offlineBaseline?.id === after.id ? offlineBaseline : null;
      const seen = store.state.seen || gameSeenBaseline;
      if (
        seen?.id === after.id &&
        seen.tick < after.tick &&
        (!before || seen.tick - before.tick > 100)
      )
        before = seen;
      const raw = store.state.offline,
        currentRaw = raw?.ticksApplied > 0 && Math.abs(raw.endTick - after.tick) <= 100;
      const start = currentRaw ? after.tick - raw.ticksApplied : before?.tick;
      const potionKinds = [...new Set(GAME_DATA.potions.map((x) => x.kind))];
      const potions = before?.buffsKnown
        ? globalThis.DVICombat.potionFlow(
            model,
            { ...before, lastTick: before.tick },
            start,
            after.tick,
            potionKinds,
          )
        : {};
      const trades =
        before &&
        before.tick < store.state.marketAwayTick &&
        store.state.marketAwayTick <= after.tick
          ? [...store.state.marketAway]
          : [];
      if (before) {
        trades.push(
          ...store.state.settlements.filter((x) => x.tick > before.tick && x.tick <= after.tick),
        );
        after.observedDrop =
          store.state.lastDropTick > before.tick && store.state.lastDropTick <= after.tick;
        after.tradeRecordGap = store.state.settlementFloorTick > before.tick;
      }
      flow = globalThis.DVIActivity.offlineAccounting(raw, before, after, trades, potions);
      if (!flow) return;
      offlineViews.set(host, flow);
    }
    let box = host.querySelector(".dvi-native-offline");
    if (!box) {
      box = document.createElement("div");
      box.className = "dvi-native-work dvi-native-combat dvi-native-offline";
      box.dataset.noI18n = "";
      const head = host.querySelector(".away-head");
      if (head) head.insertAdjacentElement("afterend", box);
      else host.prepend(box);
    }
    const p = globalThis.DVIPlannerCore.profits(
      flow,
      store.state.books,
      store.state.taxBp,
      Date.now(),
      GAME_DATA,
    );
    const net = flow.complete ? p.immediateProfit : null,
      estimated = flow.estimated || p.cost.estimated.length || p.immediate.estimated.length,
      prefix = estimated ? "≈ " : "";
    const label = net !== null ? "离线净收益" : "离线产值",
      value = net !== null ? net : p.immediate.total;
    const drops = p.immediate.pricedSubtotal - Math.max(0, flow.cash || 0),
      cost = p.cost.pricedSubtotal - Math.max(0, -(flow.cash || 0));
    const unknown = !flow.complete || p.cost.total === null;
    const rows = [
      ["掉落产值", p.immediate.total === null ? t("待报价") : fmt(drops) + " " + t("金币")],
      ["金币变化", Number.isFinite(flow.cash) ? fmt(flow.cash) + " " + t("金币") : "—"],
      [
        "素材 / 食物 / 药水",
        unknown
          ? cost > 0
            ? "≥ " + fmt(cost) + " " + t("金币")
            : "—"
          : (p.cost.estimated.length ? "≈ " : "") + fmt(cost) + " " + t("金币"),
      ],
      ["净收益", net === null ? "—" : prefix + fmt(net) + " " + t("金币")],
    ];
    const title = `${duration(flow.seconds)}${
      missingPriceIds(p.cost).length
        ? " · " +
          t("缺价：{items}", {
            items: missingPriceIds(p.cost)
              .map((id) => itemName(Number(id)))
              .join(i18n.language === "en" ? ", " : "、"),
          })
        : !flow.complete
          ? " · " + t("消耗记录不全")
          : ""
    }`;
    if (!box.querySelector("details"))
      box.innerHTML =
        '<details><summary><span class="dvi-native-summary" data-offline-profit></span><span class="dvi-native-action">明细</span></summary><div class="dvi-native-breakdown" data-offline-details></div></details>';
    const summary = box.querySelector("[data-offline-profit]");
    setNativeText(box.querySelector(".dvi-native-action"), t("明细"));
    summary.textContent = `${t(label)} ${value === null ? "—" : prefix + fmt(value) + " " + t("金币")}`;
    summary.title = title;
    const details = box.querySelector("[data-offline-details]"),
      html = rows.map(([name, value]) => `<span>${t(name)}</span><span>${value}</span>`).join("");
    if (details.innerHTML !== html) details.innerHTML = html;
  }
  function renderCurrentActivity() {
    const actual = activityMonitor.sample(store.state.player);
    renderCombat(actual);
    renderCurrentWork(actual);
    renderOfflineIncome();
  }
  window.addEventListener("pagehide", (e) => {
    if (e.persisted) return;
    currentWorkWorker?.terminate();
    clearTimeout(currentWorkTimeout);
  });

  // ---- src/links-ui.js ----
  /* User-requested link to Alice's public simulator. No automatic navigation or data export. */
  const SIMULATOR_URL = "https://dvi-lab.pages.dev/";
  function mountSimulatorLinks() {
    for (const nav of document.querySelectorAll(".nav-strip")) {
      let link = nav.querySelector("[data-dvi-simulator]");
      if (!link) {
        link = document.createElement("a");
        link.className = "nav-icon dvi-native-simulator";
        link.dataset.dviSimulator = "";
        link.dataset.noI18n = "";
        link.href = SIMULATOR_URL;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.referrerPolicy = "no-referrer";
        link.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 3l3 1 10 10-3 3L4 7zM3 21l4-4m-2-2 4 4M20 3l-3 1-5 5m3 3 5-5zM17 17l4 4m-6-2 4-4"/></svg>';
        nav.insertBefore(link, nav.querySelector(".nav-more-menu"));
      }
      const label = t("Alice战斗模拟器");
      if (link.title !== label) link.title = label;
      if (link.getAttribute("aria-label") !== label) link.setAttribute("aria-label", label);
    }
  }

  // ---- src/integrated-ui.js ----
  /* Native UI attachments. Reads stable DOM data attributes, never clicks game controls. */
  const nativeRecords = new Map(),
    nativeQueue = [],
    nativeCache = new Map();
  const nativeLists = new WeakMap();
  const nativeListIds = (list) =>
    Array.from(list.querySelectorAll(".route[data-job]"), (row) => row.dataset.job).join(",");
  const nativeItemNames = new Map();
  for (const item of GAME_DATA.items) {
    nativeItemNames.set(item.name, item.id);
    const baseItem = model.item(model.base(item.id)),
      translated = GAME_DATA.labels[baseItem?.name];
    const name =
      GAME_DATA.labels[item.name] ||
      (translated ? (model.tier(item.id) ? TIERS[model.tier(item.id)] : "") + translated : null);
    if (name) nativeItemNames.set(name, item.id);
  }
  function nativeMenuId(menu) {
    const text =
      menu
        .querySelector(".item-menu-name")
        ?.textContent.replace(/\s*×\s*[\d,.\s]+$/, "")
        .trim() || "";
    const plus = text.match(/\s+\+(\d+)$/),
      name = plus ? text.slice(0, plus.index) : text,
      id = nativeItemNames.get(name);
    return id === undefined ? null : id + (plus ? Number(plus[1]) * 10000 : 0);
  }
  let nativeWorker = null,
    nativeActive = null,
    nativeTimeout = null,
    nativeTimer = null,
    hoveredItem = null;
  const nativeStyle = document.createElement("style");
  nativeStyle.textContent = `
.dvi-native-simulator {
  flex-shrink: 0;
  text-decoration: none;
}
.dvi-native-simulator svg {
  width: 22px;
  height: 22px;
}
.dvi-native-simulator:focus-visible {
  outline: 2px solid var(--brass, #9a6212);
  outline-offset: 2px;
}
.dvi-native-work {
  box-sizing: border-box;
  flex-shrink: 0;
  grid-column: 1/-1;
  margin: 0;
  padding: 0 10px 6px 26px;
  border: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--edge, #b89763) 35%, transparent);
  border-radius: 0;
  background: transparent;
  color: var(--ink-muted, #6b4826);
  font-size: var(--fs-xs, 11px);
  line-height: 1.5;
  font-family: var(--sans, inherit);
  text-align: left;
  min-width: 0;
}
.dvi-native-work[hidden] {
  display: none !important;
}
.dvi-native-work details {
  margin: 0;
}
.dvi-native-work summary {
  cursor: pointer;
  color: var(--ink-muted, #6b4826);
  list-style: none;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
  padding: 2px 0;
  min-height: 22px;
}
.dvi-native-work summary::-webkit-details-marker {
  display: none;
}
.dvi-native-work summary:hover {
  color: var(--ink, #3d2612);
}
.dvi-native-work summary {
  -webkit-user-select: none;
  user-select: none;
}
.dvi-native-combat {
  padding: 0 10px 5px;
  border-top: 1px solid var(--edge, #b89763);
  margin-top: 3px;
}
.dvi-native-secondary {
  display: flex;
  justify-content: space-between;
  gap: 4px 10px;
  flex-wrap: wrap;
  color: var(--ink-faint, #876640);
  font-variant-numeric: tabular-nums;
  margin: 3px 0;
}
.dvi-native-brews {
  display: flex;
  gap: 3px 10px;
  flex-wrap: wrap;
  color: var(--ink-faint, #876640);
  font-size: var(--fs-2xs, 10px);
  margin: 3px 0;
}
.dvi-native-more > summary {
  justify-content: flex-end;
  color: var(--brass, #9a6212);
  font-size: var(--fs-2xs, 10px);
}
.dvi-native-more > summary:after {
  content: " ▸";
}
.dvi-native-more[open] > summary:after {
  content: " ▾";
}
.dvi-native-summary {
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
  min-width: 0;
}
.dvi-native-action {
  white-space: nowrap;
  color: var(--brass, #9a6212);
  font-size: var(--fs-2xs, 10px);
}
.dvi-native-action:after {
  content: " ▸";
}
.dvi-native-work details[open] > summary > .dvi-native-action:after {
  content: " ▾";
}
.dvi-native-work summary:focus-visible,
.dvi-native-controls input:focus-visible,
.dvi-native-controls button:focus-visible {
  outline: 2px solid var(--brass, #9a6212);
  outline-offset: 2px;
}
.dvi-native-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin: 8px 0;
}
.dvi-native-controls label {
  display: flex;
  align-items: center;
  gap: 4px;
}
.dvi-native-controls input {
  box-sizing: border-box;
  width: 58px;
  background: var(--panel-raised, #f8eed6);
  color: var(--ink, #3d2612);
  border: 1px solid var(--edge, #b89763);
  border-radius: 2px;
  padding: 3px 4px;
  font: inherit;
  min-width: 0;
}
.dvi-native-work .dvi-native-controls button {
  appearance: none;
  background: transparent !important;
  background-image: none !important;
  color: var(--ink-muted, #6b4826) !important;
  border: 1px solid var(--edge, #b89763) !important;
  border-radius: 4px !important;
  padding: 3px 9px !important;
  min-height: 25px;
  font: inherit !important;
  font-weight: 600 !important;
  line-height: 1.4 !important;
  box-shadow: none !important;
  text-shadow: none !important;
  transform: none !important;
  cursor: pointer;
}
.dvi-native-work .dvi-native-controls button:hover {
  background: var(--panel-raised, #f8eed6) !important;
  border-color: var(--brass, #9a6212) !important;
  color: var(--brass, #9a6212) !important;
}
.dvi-native-controls button:disabled {
  opacity: 0.5;
  cursor: wait;
}
.dvi-native-work table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-xs, 11px);
  table-layout: auto;
}
.dvi-native-work td,
.dvi-native-work th {
  padding: 4px 2px;
  text-align: right;
  border-bottom: 1px solid color-mix(in srgb, var(--edge, #b89763) 50%, transparent);
  font-variant-numeric: tabular-nums;
  font-weight: 400;
}
.dvi-native-work th {
  color: var(--ink-faint, #876640);
}
.dvi-native-work td:first-child,
.dvi-native-work th:first-child {
  text-align: left;
  overflow-wrap: anywhere;
}
.dvi-native-work td small {
  display: block;
  color: var(--ink-faint, #876640);
  font-size: 10px;
}
.dvi-native-work .dvi-note {
  font-size: var(--fs-2xs, 10px);
  line-height: 1.5;
  color: var(--ink-faint, #876640);
  margin: 5px 0;
  overflow-wrap: anywhere;
}
.dvi-native-work .dvi-note strong {
  color: var(--rust, #a8391f);
  font-weight: 500;
}
.dvi-native-work .dvi-plan-result {
  margin: 8px 0 5px;
  color: var(--ink, #3d2612);
  font-size: var(--fs-sm, 12px);
  font-weight: 600;
}
.dvi-native-work .dvi-warning {
  color: var(--rust, #a8391f);
  font-size: var(--fs-xs, 11px);
  margin: 6px 0;
}
.dvi-native-breakdown {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 3px 8px;
  margin: 8px 0;
  font-variant-numeric: tabular-nums;
}
.dvi-native-breakdown span:nth-child(even) {
  text-align: right;
}
.dvi-native-positive {
  color: var(--moss, #3b7326);
}
.dvi-native-negative {
  color: var(--rust, #a8391f);
}
.dvi-native-settings {
  padding: 4px 10px;
  border-bottom: 1px solid var(--edge, #b89763);
  font: var(--fs-xs, 11px) / 1.5 var(--sans, inherit);
  color: var(--ink-faint, #876640);
}
.dvi-native-settings > summary {
  cursor: pointer;
  list-style: none;
  text-align: right;
  color: var(--ink-faint, #876640);
}
.dvi-native-settings > summary::-webkit-details-marker {
  display: none;
}
.dvi-native-settings > summary:after {
  content: " ⚙";
}
.dvi-native-settings label {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 0;
}
.dvi-native-settings input {
  accent-color: var(--brass, #9a6212);
}
.dvi-native-prices {
  display: block;
  border-top: 1px solid var(--edge, #b89763);
  padding: 5px 6px 2px;
  margin-top: 3px;
  color: var(--ink-muted, #6b4826);
  font-size: var(--fs-xs, 11px);
  line-height: 1.5;
  font-family: var(--sans, inherit);
  white-space: normal;
  overflow-wrap: anywhere;
}
.dvi-native-prices span {
  display: block;
}
.dvi-native-prices small {
  display: block;
  color: var(--ink-faint, #876640);
  font-size: var(--fs-2xs, 10px);
  line-height: 1.4;
  margin-top: 3px;
}
`;
  function nativeRarity(job) {
    if (!job.inputs.length) return 0;
    const selected = document.querySelector(
      '[data-rarity-choices] [data-rarity][aria-pressed="true"]',
    );
    const n = selected ? Number(selected.dataset.rarity) : store.state.player?.workRarity || 0;
    return Number.isInteger(n) && n >= 0 && n <= 4 ? n : 0;
  }
  function nativeKey(record) {
    return `${record.job.id}:${nativeRarity(record.job)}`;
  }
  function visible(element) {
    const r = element.getBoundingClientRect();
    return !!(r.width && r.height) && r.bottom > 0 && r.top < innerHeight;
  }
  function nativeOptions(record, full) {
    const p = store.state.player;
    return {
      player: playerCopy(p),
      windows: JSON.parse(JSON.stringify(store.state.windows)),
      jobId: record.job.id,
      rarity: nativeRarity(record.job),
      targetLevel: Number(record.box.querySelector("input").value),
      samples: full ? 32 : 8,
      hourOnly: !full,
    };
  }
  function queueNative(record, full = false) {
    if (!store.state.player || record.row.disabled) return;
    const key = nativeKey(record),
      pending =
        nativeQueue.some((t) => t.key === key && t.full === full) ||
        (nativeActive?.key === key && nativeActive.full === full);
    if (pending) return;
    const task = { record, key, full };
    if (full) nativeQueue.unshift(task);
    else nativeQueue.push(task);
    if (full) {
      record.box.querySelector("[data-native-result]").textContent = t("计算中…");
      record.box.querySelector("button").disabled = true;
    }
    pumpNative();
  }
  function pumpNative() {
    if (nativeActive || !nativeQueue.length) return;
    const task = nativeQueue.shift();
    if (!task.record.row.isConnected || !store.state.player) {
      pumpNative();
      return;
    }
    task.options = nativeOptions(task.record, task.full);
    task.key = `${task.options.jobId}:${task.options.rarity}`;
    nativeActive = task;
    try {
      if (!nativeWorker) {
        const url = URL.createObjectURL(
          new Blob([WORKER_SOURCE], { type: "application/javascript" }),
        );
        try {
          nativeWorker = new Worker(url);
        } finally {
          URL.revokeObjectURL(url);
        }
        nativeWorker.onmessage = (e) => finishNative(e.data);
        nativeWorker.onerror = () => {
          nativeWorker?.terminate();
          nativeWorker = null;
          finishNative({ error: "本地计算进程发生错误" });
        };
      }
      nativeTimeout = setTimeout(
        () => {
          nativeWorker?.terminate();
          nativeWorker = null;
          finishNative({ error: "计算耗时过长，请缩小等级目标" });
        },
        task.full ? 45000 : 15000,
      );
      nativeWorker.postMessage({ data: GAME_DATA, options: task.options });
    } catch {
      finishNative({ error: "浏览器未允许本地计算 Worker" });
    }
  }
  function finishNative(message) {
    clearTimeout(nativeTimeout);
    const task = nativeActive;
    if (!task) return;
    const old = nativeCache.get(task.key) || {};
    nativeCache.set(task.key, {
      ...old,
      at: Date.now(),
      options: task.options,
      ...(message.error
        ? task.full
          ? { planError: message.error }
          : { error: message.error }
        : {
            result: message.result,
            error: null,
            ...(task.full
              ? { plan: message.result, planOptions: task.options, planError: null }
              : {}),
          }),
    });
    task.record.box.querySelector("button").disabled = false;
    nativeActive = null;
    renderNative(task.record);
    pumpNative();
  }
  function nativePlanHtml(result, options) {
    const r = result,
      profit = hourProfit(r, options);
    const timing = t(
      "工作 {work}；跑路 {walk}；存取 {bank}；被抓 {stun}；95% 尝试预算 {attempts} 次",
      {
        work: duration(r.plan.workTicks * 0.6),
        walk: duration(r.plan.walkTicks * 0.6),
        bank: duration(r.plan.bankTicks * 0.6),
        stun: duration(r.plan.stunTicks * 0.6),
        attempts: fmt(Math.ceil(r.plan.attemptsP95)),
      },
    );
    return `${r.farming ? `<p class="dvi-warning">${t("单田估算，未计多田与跑路")}</p>` : ""}<p class="dvi-plan-result" title="${escape(timing)}">${t("约 {count} 次 · {time}", { count: fmt(Math.ceil(r.plan.attempts)), time: duration(r.plan.seconds) })}</p>
  ${r.materials.length ? `<table><thead><tr>${["材料", "总需", "需补"].map((x) => `<th>${t(x)}</th>`).join("")}</tr></thead><tbody>${r.materials.map((m) => `<tr title="${escape(t("已有 {owned}；95% 需补 {missing}", { owned: fmt(m.owned), missing: fmt(m.shortageP95) }))}"><td>${escape(itemName(m.id))}</td><td>${fmt(Math.ceil(m.mean))}</td><td>${fmt(m.shortage)}</td></tr>`).join("")}</tbody></table>` : `<p class="dvi-note">${t("无需材料")}</p>`}
  <details class="dvi-native-more"><summary>${t("收益明细")}</summary>${nativeProfitHtml(profit, r.hour, options)}</details>${r.farming ? nativeFarmHtml() : ""}`;
  }
  function nativeProfitHtml(profit, hour, options) {
    const flow = preferences.potionCost ? potionFlow(hour.ticks, options) : {};
    const potionCost = profit.cost.details.reduce(
      (n, d) => n + (d.value || 0) * Math.min(1, ((flow[d.id] || 0) * 24) / (d.qty || 1)),
      0,
    );
    const unknown = missingPriceIds(profit.cost);
    const rows = [
      ["产物收入", profit.immediate.pricedSubtotal, false, profit.immediate.estimated.length > 0],
      [
        "材料成本",
        -(profit.cost.pricedSubtotal - potionCost),
        unknown.some((id) => (hour.inputs[id] || 0) > 0),
        profit.cost.estimated.some((id) => (hour.inputs[id] || 0) > 0),
      ],
      [
        "药水成本",
        -potionCost,
        unknown.some((id) => (flow[id] || 0) > 0),
        profit.cost.estimated.some((id) => (flow[id] || 0) > 0),
      ],
    ];
    return `<div class="dvi-native-breakdown" title="${escape(profitHint(profit))}">${rows.map(([label, n, missing, estimated]) => `<span title="${missing ? t("缺买价") : ""}">${t(label)}</span><span class="${missing ? "" : n < 0 ? "dvi-native-negative" : "dvi-native-positive"}">${costText(n, missing, estimated)}</span>`).join("")}</div><p class="dvi-note" title="${t("挂售需等待买家")}">${t("商人")} ${profitText(profit, "vendor")}<br>${t("挂售")} ${profitText(profit, "listing")}</p>`;
  }
  function nativeFarmHtml() {
    const p = store.state.player;
    if (!p) return "";
    const status = model.farmingStatus(p);
    return `<details><summary>${t("当前农田")}</summary><p class="dvi-note">${t("浇水只作用于当前工作田。换田时优先成熟田；相邻成熟田同优先级，按编号选取。已有相邻站位会保留，重新寻路才挑落脚点。「收获并补种」不浇水。")}</p><table><thead><tr>${["田地", "状态", "浇水"].map((x) => `<th>${t(x)}</th>`).join("")}</tr></thead><tbody>${status.fields.map((f) => `<tr><td>${fmt(f.number)}${f.current ? " · " + t("当前") : ""}</td><td>${!f.plot ? t("空田") : f.matureAt <= p.lastTick ? t("已成熟") : duration((f.matureAt - p.lastTick) * 0.6)}</td><td>${f.plot ? fmt(f.plot.watered || 0) : "—"}</td></tr>`).join("")}</tbody></table></details>`;
  }
  function renderNative(record) {
    const cached = nativeCache.get(nativeKey(record)),
      summary = record.box.querySelector("[data-native-summary]");
    let text;
    if (record.row.disabled) text = t("未解锁或当前位置无可用工作地点");
    else if (!store.state.player) text = t("等待角色数据");
    else if (cached?.result) {
      const p = hourProfit(cached.result, cached.options);
      text = `${p.immediateProfit === null ? t("日利") + " " : ""}${profitText(p)}${cached.result.farming ? " · " + t("单田参考") : ""}`;
      summary.title = profitHint(p);
      const rate = record.row.querySelector(".route-meta");
      if (rate && !cached.result.farming) {
        const value = `≈ ${fmt(cached.result.hour.xp)} XP/h`;
        if (rate.textContent !== value) rate.textContent = value;
        rate.title = t("未来一小时平均经验");
      }
    } else text = cached?.error ? errorText(cached.error) : t("正在估算经验与收益…");
    const asset = Array.from(document.scripts)
      .map((s) => s.src.match(/index-[A-Za-z0-9_-]+\.js/)?.[0])
      .find(Boolean);
    if (asset && asset !== GAME_DATA.clientAsset) text += " · " + t("客户端已更新，规则待校验");
    if (summary.textContent !== text) summary.textContent = text;
    record.box.hidden = !!record.row.disabled;
    setNativeText(record.box.querySelector(".dvi-native-action"), t("等级 / 材料"));
    setNativeText(record.box.querySelector("[data-native-target-label]"), t("升到"));
    setNativeText(record.box.querySelector("[data-native-level-unit]"), t("级"));
    setNativeText(record.box.querySelector("button"), t("计算"));
    record.box
      .querySelector("input")
      .setAttribute("aria-label", t("{name}目标等级", { name: nameOf(record.job.name) }));
    const container = record.box.querySelector("[data-native-result]");
    if (
      cached?.plan &&
      cached.plan.targetLevel === Number(record.box.querySelector("input").value)
    ) {
      const html = nativePlanHtml(cached.plan, cached.planOptions);
      if (container.innerHTML !== html) {
        const open = Array.from(container.querySelectorAll("details")).map((x) => x.open);
        container.innerHTML = html;
        container.querySelectorAll("details").forEach((x, i) => (x.open = !!open[i]));
      }
    } else if (cached?.planError) {
      if (container.textContent !== errorText(cached.planError))
        container.textContent = errorText(cached.planError);
    } else if (
      nativeActive?.record !== record &&
      !nativeQueue.some((t) => t.record === record && t.full) &&
      container.textContent
    )
      container.replaceChildren();
  }
  function attachNativeRow(row) {
    const job = model.jobs.get(Number(row.dataset.job));
    if (!job) return;
    let record = nativeRecords.get(row);
    if (!record) {
      const box = document.createElement("div");
      box.className = "dvi-native-work";
      box.dataset.noI18n = "";
      const current = store.state.player
        ? model.level(store.state.player.skills[job.skill] || 0)
        : 1;
      const saved = Number(preferences.targets[job.id]),
        target =
          Number.isInteger(saved) && saved >= 1 && saved < GAME_DATA.xpTable.length
            ? saved
            : Math.min(current + 1, GAME_DATA.xpTable.length - 1);
      box.innerHTML = `<details><summary><span class="dvi-native-summary" data-native-summary></span><span class="dvi-native-action">${t("等级 / 材料")}</span></summary><div class="dvi-native-controls"><label><span data-native-target-label>${t("升到")}</span> <input aria-label="${escape(t("{name}目标等级", { name: nameOf(job.name) }))}" type="number" min="1" max="${GAME_DATA.xpTable.length - 1}" step="1" value="${target}"> <span data-native-level-unit>${t("级")}</span></label><button type="button">${t("计算")}</button><small data-native-rarity></small></div><div data-native-result></div></details>`;
      record = { row, box, job, list: row.closest("[data-routes]") };
      nativeRecords.set(row, record);
      row.insertAdjacentElement("afterend", box);
      // A sibling, not a nested button: local planning cannot invoke pickJob/start.
      box.addEventListener("click", (e) => e.stopPropagation());
      box.addEventListener("pointerdown", (e) => e.stopPropagation());
      box.addEventListener("keydown", (e) => e.stopPropagation());
      const request = () => {
        preferences.targets[job.id] = Number(box.querySelector("input").value);
        save();
        queueNative(record, true);
      };
      box.querySelector("button").onclick = request;
      box.querySelector("input").addEventListener("input", () => renderNative(record));
      box.querySelector("input").addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          request();
        }
      });
    }
    const rarity = record.box.querySelector("[data-native-rarity]"),
      text = job.inputs.length
        ? t("{tier}材料", { tier: t(TIERS[nativeRarity(job)]) })
        : t("概率产出");
    if (rarity.textContent !== text) rarity.textContent = text;
    renderNative(record);
    const cached = nativeCache.get(nativeKey(record));
    if (
      !row.disabled &&
      store.state.player &&
      visible(row) &&
      (!cached || Date.now() - cached.at > 30000)
    )
      queueNative(record);
  }
  function itemPriceHtml(id) {
    const b = store.state.books[id] || {},
      floor = globalThis.DVIPlannerCore.vendorPrice(id, store.state.books, GAME_DATA),
      tax = store.state.taxBp;
    const knownNontrade =
      Object.hasOwn(GAME_DATA.vendorPrices, id % 10000) &&
      GAME_DATA.vendorPrices[id % 10000] === null;
    if (id === 200) return `<span>${t("金币按面值计价")}</span>`;
    return `<span title="${tax == null ? t("税率待接收") : t("税前 {value}", { value: fmt(b.bid, 2) })}">${t("求购")}${tax != null ? t("（税后）") : ""}: ${b.bid > 0 ? fmt(b.bid * (tax != null ? 1 - tax / 10000 : 1), 2) : "—"}</span><span title="${t("需等待买家")}">${t("挂售")}: ${b.ask > 0 ? fmt(b.ask) : "—"}</span><span title="${t("稀有度和强化不抬高商人回收价")}">${t("商人")}: ${floor ? fmt(floor) : knownNontrade ? t("不可出售") : "—"}</span>${!(b.ask > 0) && b.purchaseCache?.price > 0 && Date.now() - b.purchaseCache.at <= 86400000 ? `<span>${t("缓存买价")}: ≈ ${fmt(b.purchaseCache.price)}</span>` : ""}${GAME_DATA.vendorBuys[id] ? `<span>${t("商人买价")}: ${fmt(GAME_DATA.vendorBuys[id])}</span>` : ""}${b.at && Date.now() - b.at > 300000 ? `<small>${t("报价已过期")}</small>` : ""}`;
  }
  function injectItemPrices(root, id) {
    if (!root || !Number.isSafeInteger(id) || !model.item(model.base(id))) return;
    let box = root.querySelector(".dvi-native-prices");
    if (!box) {
      box = document.createElement("div");
      box.className = "dvi-native-prices";
      box.dataset.noI18n = "";
      root.append(box);
    }
    const html = itemPriceHtml(id);
    if (box.innerHTML !== html) box.innerHTML = html;
    const rect = root.getBoundingClientRect();
    if (rect.bottom > innerHeight - 8 && getComputedStyle(root).position === "fixed")
      root.style.top = Math.max(8, innerHeight - rect.height - 8) + "px";
  }
  function syncNativeTip() {
    const tip = document.querySelector(".tip[data-tip]:not([hidden])");
    if (tip && hoveredItem !== null) injectItemPrices(tip, hoveredItem);
  }
  function scanNative() {
    nativeTimer = null;
    if (!document.documentElement) return;
    i18n.refresh();
    if (!nativeStyle.isConnected) document.documentElement.append(nativeStyle);
    mountSimulatorLinks();
    for (const [row, record] of nativeRecords)
      if (!row.isConnected) {
        record.box.remove();
        nativeRecords.delete(row);
      }
    for (const row of document.querySelectorAll(".route[data-job]")) attachNativeRow(row);
    for (const list of document.querySelectorAll("[data-routes]"))
      if (!list.querySelector(".dvi-native-settings") && list.querySelector(".route[data-job]")) {
        const settings = document.createElement("details");
        settings.className = "dvi-native-settings";
        settings.dataset.noI18n = "";
        settings.innerHTML = `<summary>${t("DVI信息增强")}</summary><label><input type="checkbox" ${preferences.potionCost ? "checked" : ""}> <span data-native-potion-label>${t("工作收益扣除药水成本")}</span></label><span data-native-settings-note>${t("战斗始终扣除食物与有效药水成本。")}</span>`;
        settings.addEventListener("click", (e) => e.stopPropagation());
        settings.querySelector("input").onchange = (e) => {
          preferences.potionCost = e.target.checked;
          save();
          for (const record of nativeRecords.values()) renderNative(record);
        };
        list.prepend(settings);
      }
    for (const settings of document.querySelectorAll(".dvi-native-settings")) {
      setNativeText(settings.querySelector("summary"), t("DVI信息增强"));
      setNativeText(
        settings.querySelector("[data-native-potion-label]"),
        t("工作收益扣除药水成本"),
      );
      setNativeText(
        settings.querySelector("[data-native-settings-note]"),
        t("战斗始终扣除食物与有效药水成本。"),
      );
    }
    for (const list of document.querySelectorAll("[data-routes]"))
      nativeLists.set(list, {
        ids: nativeListIds(list),
        scrollTop: list.scrollTop,
        settings: list.querySelector(".dvi-native-settings"),
      });
    renderCurrentActivity();
    syncNativeTip();
    const menu = document.querySelector("[data-item-menu]:not([hidden])");
    if (menu?.querySelector(".item-menu-icon")) {
      const id = nativeMenuId(menu);
      if (id !== null) injectItemPrices(menu, id);
    }
    const sheet = document.querySelector("[data-market-sheet]:not([hidden])"),
      icon = sheet?.querySelector("[data-sheet-icon][data-item]");
    if (icon)
      injectItemPrices(sheet.querySelector(".sheet-title") || sheet, Number(icon.dataset.item));
  }
  function remountNativeRows() {
    const restores = [],
      replaced = new Set();
    for (const [row, record] of nativeRecords) {
      if (row.isConnected) continue;
      const list = record.list;
      if (!list?.isConnected) continue;
      const next = list.querySelector(`.route[data-job="${record.job.id}"]`);
      if (!next || nativeRecords.has(next)) continue;
      nativeRecords.delete(row);
      record.row = next;
      nativeRecords.set(next, record);
      next.insertAdjacentElement("afterend", record.box);
      replaced.add(list);
    }
    for (const list of replaced) {
      const old = nativeLists.get(list);
      if (old?.ids !== nativeListIds(list)) continue;
      if (old.settings && !old.settings.isConnected) list.prepend(old.settings);
      restores.push([list, old.scrollTop]);
    }
    return restores;
  }
  function trackNativeScroll(e) {
    const list = e.target;
    if (!list.matches?.("[data-routes]")) return;
    const old = nativeLists.get(list);
    if (
      old?.ids === nativeListIds(list) &&
      Array.from(list.querySelectorAll(".route[data-job]")).every(
        (row) => nativeRecords.get(row)?.box.isConnected,
      )
    )
      old.scrollTop = list.scrollTop;
  }
  function rememberNativeSelection(e) {
    const list = e.target.closest?.(".route[data-job]")?.closest("[data-routes]");
    const old = list && nativeLists.get(list);
    if (list && old?.ids === nativeListIds(list)) old.scrollTop = list.scrollTop;
  }
  function setNativeText(element, text) {
    if (element && element.textContent !== text) element.textContent = text;
  }
  function localeStorageChanged(e) {
    if (e.key === "deepvein.locale") scheduleNative();
  }
  window.addEventListener("storage", localeStorageChanged);
  function scheduleNative() {
    if (!nativeTimer) nativeTimer = setTimeout(scanNative, 80);
  }
  const nativeMutations = new MutationObserver((changes) => {
    // The game's pointermove handler replaces the tooltip contents on every move.
    // Restore prices in this microtask, before paint, instead of the 80ms scan.
    if (changes.some((change) => change.target.matches?.(".tip[data-tip]"))) syncNativeTip();
    // The client replaces all list children on selection. Reattach before the next
    // paint, keeping our existing disclosure/input nodes instead of collapsing them.
    if (
      changes.some(
        (change) => change.type === "childList" && change.target.matches?.("[data-routes]"),
      )
    ) {
      const restores = remountNativeRows();
      if (nativeTimer) {
        clearTimeout(nativeTimer);
        nativeTimer = null;
      }
      scanNative();
      for (const [list, top] of restores) {
        list.scrollTop = top;
        const saved = nativeLists.get(list);
        if (saved) saved.scrollTop = list.scrollTop;
      }
      return;
    }
    if (
      changes.some(
        (change) =>
          !change.target.closest?.(".dvi-native-work,.dvi-native-prices,.tip[data-tip]") &&
          !(change.type === "attributes" && change.attributeName === "style"),
      )
    )
      scheduleNative();
  });
  function trackHover(e) {
    const element = e.target.closest?.("[data-item]"),
      id = element && !e.target.closest?.("[data-tip-name]") ? Number(element.dataset.item) : null;
    if (hoveredItem !== id) {
      hoveredItem = id;
      scheduleNative();
    }
  }
  document.addEventListener("pointermove", trackHover, { capture: true, passive: true });
  document.addEventListener("focusin", trackHover, { capture: true, passive: true });
  document.addEventListener("scroll", trackNativeScroll, { capture: true, passive: true });
  document.addEventListener("pointerdown", rememberNativeSelection, {
    capture: true,
    passive: true,
  });
  document.addEventListener("keydown", rememberNativeSelection, { capture: true, passive: true });
  nativeMutations.observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["hidden", "aria-pressed", "data-item", "disabled", "lang"],
  });
  let nativePlayerId = null;
  store.subscribe(() => {
    const id = store.state.player?.id;
    if (id !== undefined && id !== nativePlayerId) {
      nativePlayerId = id;
      nativeWorker?.terminate();
      nativeWorker = null;
      clearTimeout(nativeTimeout);
      nativeActive = null;
      nativeQueue.length = 0;
      nativeCache.clear();
      for (const record of nativeRecords.values())
        record.box.querySelector("button").disabled = false;
    }
    scheduleNative();
  });
  scheduleNative();
  const nativeInterval = setInterval(scheduleNative, 5000);
  window.addEventListener("pagehide", (e) => {
    if (e.persisted) return;
    window.removeEventListener("storage", localeStorageChanged);
    nativeMutations.disconnect();
    nativeWorker?.terminate();
    clearTimeout(nativeTimeout);
    clearTimeout(nativeTimer);
    clearInterval(nativeInterval);
    document.removeEventListener("pointermove", trackHover, true);
    document.removeEventListener("focusin", trackHover, true);
    document.removeEventListener("scroll", trackNativeScroll, true);
    document.removeEventListener("pointerdown", rememberNativeSelection, true);
    document.removeEventListener("keydown", rememberNativeSelection, true);
  });
})();
