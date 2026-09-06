(function (root) {
  'use strict';
  const U = root.U2048;
  const CFG = U.CFG;
  const Matter = root.Matter;

  // 合并系统：用 collisionActive 持续检测接触中的同数值 Cell 对
  // （而非仅 collisionStart，使冷却结束后的"贴脸连锁"也能触发）。
  // Cell 引用来自部件级挂载（pair 中的 body 可能是复合刚体的部件）。
  class MergeSystem {
    constructor(physics, bus, nowFn, makeProduct, canMergeFn) {
      this.physics = physics;
      this.bus = bus;
      this.nowFn = nowFn;
      this.makeProduct = makeProduct; // (value, x, y) => 自由 Cell（Game 提供）
      this.canMergeFn = canMergeFn || null; // V14.2：(nextValue) => boolean，首页合成上限
      this.queue = [];
    }

    detect(e) {
      const now = this.nowFn();
      for (const pair of e.pairs) {
        const ta = pair.bodyA.plugin && pair.bodyA.plugin.cellRef;
        const tb = pair.bodyB.plugin && pair.bodyB.plugin.cellRef;

        if (!ta || !tb) continue;
        if (ta.removed || tb.removed || ta.merging || tb.merging) continue;

        const ownerA = ta.body.parent || ta.body;
        const ownerB = tb.body.parent || tb.body;

        // 同一个复合刚体内部永远不能融合（不依赖 originId 状态）
        if (ownerA === ownerB) continue;

        // 同一个原始俄罗斯方块的 Cell 也不能融合
        if (ta.originId === tb.originId) continue;

        if (ta.value !== tb.value) continue;
        // 最终等级（4096）不参与任何融合
        if (ta.final || tb.final) continue;
        // V14.2：首页合成上限——禁止"会超过上限"的这次合成（null = 无限）
        if (this.canMergeFn && !this.canMergeFn(ta.value * 2)) continue;
        if (now < ta.cooldownUntil ||
            now < tb.cooldownUntil) continue;

        ta.merging = tb.merging = true;
        this.queue.push([ta, tb]);
      }
    }

    flush() {
      if (!this.queue.length) return;
      const now = this.nowFn();
      const q = this.queue.splice(0);
      for (const [ta, tb] of q) {
        if (ta.removed || tb.removed) { ta.merging = tb.merging = false; continue; }
        this.execute(ta, tb, now);
      }
    }

    execute(ta, tb, now) {
      const world = this.physics.world;
      const mx = (ta.body.position.x + tb.body.position.x) / 2;
      const my = (ta.body.position.y + tb.body.position.y) / 2;
      const value = ta.value * 2;
      ta.remove(world);
      tb.remove(world);
      // 产物是自由 Cell（1 格刚体），由 Game 统一创建
      const cell = this.makeProduct(value, mx, my);
      cell.cooldownUntil = now + CFG.merge.cooldown * 1000;
      // V14.2：达到合成上限的数字不固化，仍按普通物理方块碰撞、堆叠
      Matter.Body.setVelocity(cell.body, {
        x: (Math.random() - 0.5) * 2 * CFG.merge.popVelocityX,
        y: CFG.merge.popVelocityY
      });
      // 事件载荷带全反馈所需信息：合并点、新数值、合并等级（log2），
      // 供 Game.onMerge 生成粒子 / 弹入 / 缩退动画
      this.bus.emit('merge', {
        cell,
        removed: [ta, tb],
        x: mx,
        y: my,
        value,
        impact: Math.log2(value)
      });
    }
  }

  U.MergeSystem = MergeSystem;
})(typeof window !== 'undefined' ? window : globalThis);
