(function (root) {
  'use strict';
  const U = root.U2048;
  const { CFG } = U;
  const Matter = root.Matter;

  // 生成系统：按权重掷数字、随机形状、在容器顶部随机水平位置生成方块组
  class SpawnSystem {
    constructor(physics, bus, getMaxTile) {
      this.physics = physics;
      this.bus = bus;
      this.getMaxTile = getMaxTile;
      this.piece = null;
      this.lastLandTime = 0;
    }

    rollValue() {
      const pool = CFG.spawn.base.slice();
      const maxTile = this.getMaxTile();
      for (const u of CFG.spawn.unlock) {
        if (maxTile >= u.minTile) pool.push({ value: u.value, weight: u.weight });
      }
      const total = pool.reduce((s, p) => s + p.weight, 0);
      let r = Math.random() * total;
      for (const p of pool) {
        r -= p.weight;
        if (r <= 0) return p.value;
      }
      return pool[0].value;
    }

    maybeSpawn(nowSec, speedMultiplier = 1) {
      if (this.piece) return;

      const parsed = Number(speedMultiplier);
      const multiplier = Number.isFinite(parsed) && parsed > 0
        ? parsed
        : 1;

      // 挂机倍速只缩短生成间隔（1x/2x/3x/5x → delay/1/2/3/5），经典模式传 1 不变
      const delay = CFG.piece.spawnDelay / multiplier;

      if (nowSec - this.lastLandTime < delay) return;

      this.spawn(nowSec);
    }

    // 可选 defOverride：供测试/扩展注入自定义形状（如五格骨牌），通用机制无需特判
    spawn(nowSec, defOverride) {
      const def = defOverride || U.Piece.randomDef(Math.random);
      const values = def.cells.map(() => this.rollValue());
      const half = (Math.max(...def.cells.map(c => c[0])) -
                    Math.min(...def.cells.map(c => c[0])) + 1) * CFG.tile.cellSize / 2;
      const lo = this.physics.innerLeft + half + 2;
      const hi = this.physics.innerRight - half - 2;
      const x = lo + Math.random() * Math.max(1, hi - lo);
      this.piece = new U.Piece(this.physics.world, def, x, CFG.piece.spawnY, values);
      // V14.1：按真实包围盒钳制生成位置（方块尺寸放大后依然安全）
      const bounds = this.piece.body.bounds;
      const halfW = (bounds.max.x - bounds.min.x) / 2;
      const clampedX = Math.max(this.physics.innerLeft + halfW + 2,
        Math.min(this.physics.innerRight - halfW - 2, this.piece.body.position.x));
      if (clampedX !== this.piece.body.position.x) {
        Matter.Body.setPosition(this.piece.body, { x: clampedX, y: CFG.piece.spawnY });
      }
      this.bus.emit('spawn', this.piece);
      return this.piece;
    }

    reset() {
      this.piece = null;
      this.lastLandTime = 0;
    }
  }
  U.SpawnSystem = SpawnSystem;
})(typeof window !== 'undefined' ? window : globalThis);
