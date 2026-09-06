(function (root) {
  'use strict';
  // 轻量事件总线：只用于真正的广播事件（merge / land / gameover / spawn / score）
  class EventBus {
    constructor() { this.map = new Map(); }
    on(name, fn) {
      if (!this.map.has(name)) this.map.set(name, []);
      this.map.get(name).push(fn);
      return () => this.off(name, fn);
    }
    off(name, fn) {
      const arr = this.map.get(name);
      if (!arr) return;
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    }
    emit(name, payload) {
      const arr = this.map.get(name);
      if (!arr) return;
      for (const fn of arr.slice()) fn(payload);
    }
  }
  root.U2048 = root.U2048 || {};
  root.U2048.EventBus = EventBus;
})(typeof window !== 'undefined' ? window : globalThis);
