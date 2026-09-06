(function (root) {
  'use strict';
  const U = root.U2048;
  const { CFG } = U;

  // 挂机模式 AI：与玩家输入走同一套 Game 接口（drivePiece / rotatePiece）
  // 每组生成时随机决定旋转次数与目标落点，然后缓慢挪过去
  class IdleAI {
    constructor(game) {
      this.game = game;
      this.targetX = null;
      this.pendingRotations = 0;
      this.nextThink = 0;
      this.nextRotate = 0;
      game.bus.on('spawn', piece => this.onSpawn());
    }

    // 挂机倍速只缩短旋转等待：横向移动速度与换目标节奏保持原样
    rotationDelay(seconds) {
      const g = this.game;

      const speed = g.mode === 'idle'
        ? Math.max(1, Number(g.idleSpeed) || 1)
        : 1;

      return seconds / speed;
    }

    onSpawn() {
      const g = this.game;
      const lo = g.physics.innerLeft + (g.spawn.piece ? g.spawn.piece.halfWidth : 40) + 4;
      const hi = g.physics.innerRight - (g.spawn.piece ? g.spawn.piece.halfWidth : 40) - 4;
      this.targetX = lo + Math.random() * Math.max(1, hi - lo);
      this.pendingRotations = Math.floor(Math.random() * 3); // 0~2 次
      // 旋转动作按挂机倍速缩短
      this.nextRotate = g.timeSec + this.rotationDelay(0.25);
      // AI 改变横向目标的节奏保持不变
      this.nextThink = g.timeSec + CFG.idle.thinkMin + Math.random() * (CFG.idle.thinkMax - CFG.idle.thinkMin);
    }

    // 运行中切换倍速：把当前等待中的旋转按新倍率立即重算（无需等下一组方块）
    onSpeedChange(oldSpeed, newSpeed) {
      const g = this.game;
      const piece = g.spawn.piece;

      if (!piece || piece.landed || this.pendingRotations <= 0) {
        return;
      }

      const oldMultiplier = Math.max(1, Number(oldSpeed) || 1);
      const newMultiplier = Math.max(1, Number(newSpeed) || 1);
      const now = g.timeSec;

      if (this.nextRotate > now) {
        this.nextRotate = now +
          (this.nextRotate - now) *
          oldMultiplier / newMultiplier;
      }
    }

    update() {
      const g = this.game;
      const piece = g.spawn.piece;
      if (!piece) { this.targetX = null; return; }

      if (this.pendingRotations > 0 && g.timeSec >= this.nextRotate) {
        g.rotatePiece();
        this.pendingRotations--;
        this.nextRotate = g.timeSec +
          this.rotationDelay(0.2 + Math.random() * 0.3);
      }

      // 偶尔改主意
      if (g.timeSec >= this.nextThink) {
        const lo = g.physics.innerLeft + piece.halfWidth + 4;
        const hi = g.physics.innerRight - piece.halfWidth - 4;
        this.targetX = lo + Math.random() * Math.max(1, hi - lo);
        this.nextThink = g.timeSec + CFG.idle.thinkMin + Math.random() * (CFG.idle.thinkMax - CFG.idle.thinkMin);
      }

      if (this.targetX != null) {
        g.drivePiece(this.targetX, CFG.idle.moveSpeed);
      }
    }
  }
  U.IdleAI = IdleAI;
})(typeof window !== 'undefined' ? window : globalThis);
