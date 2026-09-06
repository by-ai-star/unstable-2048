(function (root) {
  'use strict';
  const U = root.U2048;

  // 分数 / 最高数字 / 最高分持久化
  class ScoreSystem {
    constructor(bus) {
      this.bus = bus;
      this.score = 0;
      this.maxTile = 0;
      this.best = 0;
      try {
        this.best = parseInt(root.localStorage && root.localStorage.getItem('u2048_best'), 10) || 0;
      } catch (e) { /* 环境不支持 localStorage */ }
    }

    onMerge(tile) {
      this.score += tile.value;
      if (tile.value > this.maxTile) this.maxTile = tile.value;
      if (this.score > this.best) {
        this.best = this.score;
        try { root.localStorage && root.localStorage.setItem('u2048_best', String(this.best)); } catch (e) {}
      }
      this.bus.emit('score', this);
    }

    reset() {
      this.score = 0;
      this.maxTile = 0;
      this.bus.emit('score', this);
    }
  }
  U.ScoreSystem = ScoreSystem;
})(typeof window !== 'undefined' ? window : globalThis);
