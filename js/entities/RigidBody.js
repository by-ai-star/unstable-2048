(function (root) {
  'use strict';
  const U = root.U2048;

  // RigidBody = 物理计算的基本单位。
  // 重力/碰撞/速度/旋转都以刚体为单位计算（由 Matter 复合刚体承担），
  // 内部 Cell 的世界坐标由刚体 transform 推导：
  //   world = body.position + rotate(local, body.angle)
  // 融合导致拓扑断裂时，按邻接图的连通分量拆成多个新 RigidBody（见 Game.rebuildBody）。
  class RigidBody {
    constructor(id, originId, body, cells, adjPairs) {
      this.id = id;             // 刚体记录 id（每代唯一）
      this.originId = originId; // 血统 id：同一原始方块的 Cell 互相不融合
      this.body = body;         // Matter 刚体（复合体或单格独立体）
      this.cells = cells;       // Cell[]
      this.adjPairs = adjPairs || [];  // 相邻关系图 [[Cell, Cell], ...]
      this.isRigid = true;
      for (const c of cells) c.shellId = id;
    }

    // 规范核心推导：Cell 世界坐标 = 刚体 transform × 局部坐标
    cellWorld(cell) {
      const b = this.body;
      const cos = Math.cos(b.angle), sin = Math.sin(b.angle);
      return {
        x: b.position.x + cell.localX * cos - cell.localY * sin,
        y: b.position.y + cell.localX * sin + cell.localY * cos,
        angle: b.angle + cell.localAngle
      };
    }

    // 刚体是否完整：物理部件数与 Cell 数一致
    isIntact() {
      return this.body.parts.length - 1 === this.cells.length;
    }
  }
  U.RigidBody = RigidBody;
})(typeof window !== 'undefined' ? window : globalThis);
