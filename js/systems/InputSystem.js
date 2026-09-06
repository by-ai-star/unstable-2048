(function (root) {
  'use strict';
  const U = root.U2048;
  const { CFG } = U;

  // 经典模式输入：Pointer 事件（触屏 + 鼠标统一）+ 键盘
  // - 点击（短、几乎无位移）→ 旋转
  // - 按住拖动 → 左右移动
  class InputSystem {
    constructor(canvas, game) {
      this.canvas = canvas;
      this.game = game;
      this.active = null; // {id, t0, x0, y0, dragging}

      canvas.addEventListener('pointerdown', e => this.onDown(e));
      canvas.addEventListener('pointermove', e => this.onMove(e));
      canvas.addEventListener('pointerup', e => this.onUp(e));
      canvas.addEventListener('pointercancel', e => this.onUp(e));
      root.addEventListener('keydown', e => this.onKey(e, true));
      root.addEventListener('keyup', e => this.onKey(e, false));
    }

    toWorldX(clientX) {
      const rect = this.canvas.getBoundingClientRect();
      return (clientX - rect.left) / rect.width * CFG.world.width;
    }

    onDown(e) {
      if (this.game.state !== 'playing' || this.game.mode !== 'classic') return;
      e.preventDefault();
      this.active = {
        id: e.pointerId,
        t0: performance.now(),
        x0: e.clientX,
        y0: e.clientY,
        dragging: false
      };
      try { this.canvas.setPointerCapture(e.pointerId); } catch (err) {}
    }

    onMove(e) {
      const a = this.active;
      if (!a || e.pointerId !== a.id) return;
      if (this.game.state !== 'playing' || this.game.mode !== 'classic') return;
      e.preventDefault();
      const dist = Math.hypot(e.clientX - a.x0, e.clientY - a.y0);
      if (!a.dragging && dist > CFG.input.tapMaxDist) a.dragging = true;
      if (a.dragging) {
        this.game.driveTargetX = this.toWorldX(e.clientX);
      }
    }

    onUp(e) {
      const a = this.active;
      if (!a || e.pointerId !== a.id) return;
      this.active = null;
      if (this.game.state !== 'playing' || this.game.mode !== 'classic') return;
      if (a.dragging) {
        this.game.driveTargetX = null; // 松手即停
      } else if (performance.now() - a.t0 < CFG.input.tapMaxMs) {
        this.game.rotatePiece(); // 点击 → 旋转
      }
    }

    onKey(e, down) {
      const g = this.game;
      if (g.state !== 'playing' || g.mode !== 'classic') return;
      switch (e.key) {
        case 'ArrowLeft':  g.keys.left = down;  e.preventDefault(); break;
        case 'ArrowRight': g.keys.right = down; e.preventDefault(); break;
        case 'ArrowDown':  g.keys.down = down;  e.preventDefault(); break;
        case 'ArrowUp':
        case ' ':
          if (down && !e.repeat) g.rotatePiece();
          e.preventDefault();
          break;
      }
    }
  }
  U.InputSystem = InputSystem;
})(typeof window !== 'undefined' ? window : globalThis);
