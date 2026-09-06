(function (root) {
  'use strict';
  const U = root.U2048;
  const CFG = U.CFG;
  const Matter = root.Matter;

  // 俄罗斯方块式形状定义（格子坐标 [col, row]）
  // 结构化定义而非写死，方便后续增删形状
  const PIECES = [
    { id: 'I', cells: [[0, 0], [1, 0], [2, 0], [3, 0]] },
    { id: 'O', cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
    { id: 'T', cells: [[0, 0], [1, 0], [2, 0], [1, 1]] },
    { id: 'L', cells: [[0, 0], [1, 0], [2, 0], [0, 1]] },
    { id: 'J', cells: [[0, 0], [1, 0], [2, 0], [2, 1]] },
    { id: 'S', cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
    { id: 'Z', cells: [[0, 0], [1, 0], [1, 1], [2, 1]] }
  ];

  // 下落中的方块组：整体为一个复合刚体；落地后打散为独立 Tile
  class Piece {
    constructor(world, def, x, y, cellValues) {
      this.id = ++Piece._nextId;
      this.def = def;
      this.cellValues = cellValues;   // 与 parts 顺序一一对应
      this.landed = false;
      this.baseAngle = 0;             // 姿态角（90° 倍数），空中锁定防翻转

      const s = CFG.tile.cellSize;
      const maxC = Math.max(...def.cells.map(c => c[0]));
      const minC = Math.min(...def.cells.map(c => c[0]));
      const minR = Math.min(...def.cells.map(c => c[1]));
      const wCells = maxC - minC + 1;

      // 相邻关系（曼哈顿距离 1 的格子对）：壳子连通性判定依据
      this.adjPairs = [];
      for (let i = 0; i < def.cells.length; i++) {
        for (let j = i + 1; j < def.cells.length; j++) {
          const [c1, r1] = def.cells[i];
          const [c2, r2] = def.cells[j];
          if (Math.abs(c1 - c2) + Math.abs(r1 - r2) === 1) this.adjPairs.push([i, j]);
        }
      }

      const parts = def.cells.map(([c, r]) =>
        Matter.Bodies.rectangle(
          x + (c - (minC + wCells) / 2 + 0.5) * s,
          y + (r - minR + 0.5) * s,
          s - 0.6, s - 0.6,
          {
            label: 'pieceCell',
            // 部件级物理参数必须与 Tile 一致（碰撞对使用部件属性）
            friction: CFG.tile.friction,
            frictionStatic: CFG.tile.frictionStatic,
            restitution: CFG.tile.restitution,
            density: CFG.tile.density
          }
        )
      );

      this.body = Matter.Body.create({
        parts: parts.slice(), // 传副本：Body.create 会就地改写传入数组
        label: 'piece',
        friction: CFG.tile.friction,
        frictionStatic: CFG.tile.frictionStatic,
        restitution: CFG.tile.restitution,
        frictionAir: 0.004
      });
      this.body.plugin.pieceRef = this;
      Matter.World.add(world, this.body);
      this.halfWidth = (wCells * s) / 2;
    }

    rotate(world) {
      if (this.landed) return;
      this.baseAngle += Math.PI / 2;
      Matter.Body.setAngle(this.body, this.baseAngle);
      Matter.Body.setAngularVelocity(this.body, 0);
    }

    static randomDef(rand) {
      return PIECES[Math.floor((rand || Math.random)() * PIECES.length)];
    }
  }
  Piece._nextId = 0;
  Piece.defs = PIECES;
  U.Piece = Piece;
})(typeof window !== 'undefined' ? window : globalThis);
