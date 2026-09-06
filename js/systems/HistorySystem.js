(function (root) {
  'use strict';
  const U = root.U2048;
  const CFG = U.CFG;

  // V14.2 历史战绩：经典/挂机各保留最近 limit 局，只负责读写，不包含游戏逻辑。
  // 存储格式：{ classic: [...], idle: [...] }；localStorage 不可用时退化为内存记录
  class HistorySystem {
    constructor(storageKey, limit) {
      this.storageKey = storageKey ||
        (CFG.storage && CFG.storage.historyKey) || 'u2048_round_history_v1';
      this.limit = limit || 20;
      this.data = this.read();
    }

    read() {
      const empty = { classic: [], idle: [] };
      try {
        const raw = root.localStorage && root.localStorage.getItem(this.storageKey);
        if (!raw) return empty;

        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return empty;

        const out = { classic: [], idle: [] };
        for (const mode of ['classic', 'idle']) {
          if (Array.isArray(parsed[mode])) {
            out[mode] = parsed[mode]
              .filter(r => r && typeof r === 'object' &&
                Number.isFinite(r.score) && Number.isFinite(r.maxTile))
              .slice(0, this.limit);
          }
        }
        return out;
      } catch (e) {
        // 当前环境不支持 localStorage（如 Node 无头测试）时使用内存记录
        return empty;
      }
    }

    get(mode) {
      return this.data[mode] || [];
    }

    add(record) {
      if (!this.data[record.mode]) return;

      const records = this.get(record.mode);
      records.unshift(record);
      this.data[record.mode] = records.slice(0, this.limit);
      this.write();
    }

    clear(mode) {
      if (!this.data[mode]) return;
      this.data[mode] = [];
      this.write();
    }

    write() {
      try {
        if (root.localStorage) {
          root.localStorage.setItem(this.storageKey, JSON.stringify(this.data));
        }
      } catch (e) {
        // 忽略本地存储错误
      }
    }
  }
  U.HistorySystem = HistorySystem;
})(typeof window !== 'undefined' ? window : globalThis);
