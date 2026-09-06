(function (root) {
  'use strict';
  const U = root.U2048;
  const CFG = U.CFG;
  const Matter = root.Matter;

  // Cell = 刚体的组成部分（融合/渲染/计分单元）。
  // 注意：Cell 不是物理对象——壳内 Cell 的物理由其所属 RigidBody（复合刚体）承担，
  // Cell 的世界坐标永远由刚体 transform 推导（见 RigidBody.cellWorld）。
  class Cell {
    constructor(value, originId) {
      this.id = ++Cell._nextId;
      this.value = value;
      // 血统 id：同一原始俄罗斯方块的 Cell 互相不融合；自由方块自动获得唯一身份
      this.originId = originId !== undefined ? originId : ('free-' + this.id);
      this.shellId = null;        // 所属 RigidBody 记录 id（自由方块为 null）
      this.localX = 0;            // 相对刚体 transform 的局部坐标（规范 §11）
      this.localY = 0;
      this.localAngle = 0;
      this.body = null;           // 物理归属：复合体部件（壳内）或独立刚体（自由）
      this.merging = false;       // 本帧已进入合并队列
      this.cooldownUntil = 0;     // 合并冷却截止（游戏时间 ms）
      this.removed = false;
      this.final = false;         // 最终方块（4096）：固化在场，不再参与任何融合
      this.popAt = null;          // 合并入场动画起点（游戏时间 ms），null = 无动画
      // V14.1：真实尺寸——视觉与物理的唯一来源（updateSize 按开关与数值更新）
      this.scale = 1;
      this.size = CFG.tile.cellSize;
      this.halfSize = CFG.tile.cellSize / 2;
    }
    remove(world) {
      if (this.removed) return;
      this.removed = true;
      // 复合体的部件不单独从世界移除（随复合体重建一起处理）
      const b = this.body;
      const isPart = b.parent && b.parent !== b;
      if (!isPart) Matter.World.remove(world, b);
    }

    // V14 数字变大模式：视觉放大比例（纯函数，物理尺寸不使用此值）。
    // 32 以下恒为 1；32 起每升一级 +step，封顶 maxScale
    static growthScale(value, enabled) {
      const growth = U.CFG.tileGrowth;

      if (!enabled || value < growth.startValue) {
        return 1;
      }

      const valueLevel = Math.log2(value);
      const startLevel = Math.log2(growth.startValue);
      const levelCount = valueLevel - startLevel + 1;

      return Math.min(
        growth.maxScale,
        1 + levelCount * growth.step
      );
    }

    // V14.1：按当前数值与开关更新真实尺寸。
    // 创建自由方块 / 壳内包装时调用；壳内格子值恒 < startValue，结果恒为基础尺寸
    updateSize(growthEnabled) {
      this.scale = Cell.growthScale(this.value, growthEnabled);
      this.size = CFG.tile.cellSize * this.scale;
      this.halfSize = this.size / 2;
      return this;
    }
  }
  Cell._nextId = 0;
  U.Cell = Cell;
})(typeof window !== 'undefined' ? window : globalThis);
