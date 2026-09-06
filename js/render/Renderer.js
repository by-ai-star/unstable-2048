(function (root) {
  'use strict';
  const U = root.U2048;
  const { CFG } = U;

  // Canvas 2D 渲染：只读游戏状态绘制，不包含任何游戏逻辑
  class Renderer {
    constructor(canvas, game) {
      this.canvas = canvas;
      this.game = game;
      this.ctx = canvas.getContext('2d');
      this.W = CFG.world.width;
      this.H = CFG.world.height;
      const dpr = root.devicePixelRatio || 1;
      canvas.width = this.W * dpr;
      canvas.height = this.H * dpr;
      this.ctx.scale(dpr, dpr);
    }

    draw() {
      const ctx = this.ctx, g = this.game;
      ctx.clearRect(0, 0, this.W, this.H);

      // 背景（容器外区域）
      ctx.fillStyle = '#f3ecdf';
      ctx.fillRect(0, 0, this.W, this.H);

      // 容器内部（加深，与浅色方块拉开对比）
      const t = CFG.container.wallThickness;
      const top = CFG.container.topOffset;
      ctx.fillStyle = '#c9b9a2';
      ctx.fillRect(t, top, this.W - t * 2, this.H - top - CFG.container.floorHeight);

      // 墙与底
      ctx.fillStyle = '#8a7a66';
      ctx.fillRect(0, 0, t, this.H);
      ctx.fillRect(this.W - t, 0, t, this.H);
      ctx.fillRect(0, this.H - CFG.container.floorHeight, this.W, CFG.container.floorHeight);

      // 警戒线
      const ratio = g.lose.dangerRatio;
      const y = g.physics.sensorY;
      ctx.save();
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = ratio > 0.02
        ? 'rgba(220, 40, 40, ' + (0.5 + 0.5 * Math.sin(g.timeSec * 12)) + ')'
        : 'rgba(180, 120, 120, 0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(t, y - CFG.tile.cellSize * 0.25);
      ctx.lineTo(this.W - t, y - CFG.tile.cellSize * 0.25);
      ctx.stroke();
      ctx.restore();

      // 危险倒计时
      if (ratio > 0.02) {
        ctx.fillStyle = 'rgba(220, 40, 40, 0.75)';
        ctx.fillRect(t, top - 6, (this.W - t * 2) * ratio, 4);
      }

      // 壳子外圈轮廓（深色底）：让保持整体的刚体看起来"套了一个壳子"
      ctx.fillStyle = 'rgba(52, 61, 70, 0.95)';
      this.drawShellBodies(g);

      // Cells（自由方块 + 刚体成员）
      for (const cell of g.cells) {
        if (!cell.removed) this.drawCell(cell);
      }

      // 下落方块组（按复合体部件绘制）
      const piece = g.spawn.piece;
      if (piece && !piece.landed) {
        for (let i = 1; i < piece.body.parts.length; i++) {
          const part = piece.body.parts[i];
          this.drawBodyShape(part, piece.cellValues[i - 1], 0.96);
        }
      }

      // 合并反馈：被合并方块缩掉 + 小方点粒子（最上层）
      for (const f of g.fx.flashes) this.drawFlash(f);
      for (const pt of g.fx.particles) this.drawParticle(pt);
    }

    // 为每个壳子（含下落中的方块组）画一圈深色底：先画所有格子放大的深色圆角矩形，
    // 再由后续绘制的彩色方块覆盖中间，留下外圈 2px 深色轮廓与内部细分隔线
    drawShellBodies(g) {
      const ctx = this.ctx;
      const pad = 2;
      const drawDark = (x, y, angle, value) => {
        // V14：壳子外圈随数字变大同步缩放
        const growth = this.getTileScale(value);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        const s = (CFG.tile.cellSize + pad * 2) * growth;
        roundRect(ctx, -s / 2, -s / 2, s, s, 7 * growth);
        ctx.fill();
        ctx.restore();
      };
      for (const rb of g.bodies.values()) {
        for (const cell of rb.cells) {
          if (cell.removed) continue;

          const transform = rb.cellWorld(cell);

          drawDark(
            transform.x,
            transform.y,
            transform.angle,
            cell.value
          );
        }
      }
      const piece = g.spawn.piece;
      if (piece && !piece.landed) {
        for (let i = 1; i < piece.body.parts.length; i++) {
          drawDark(piece.body.parts[i].position.x, piece.body.parts[i].position.y,
            piece.body.angle, piece.cellValues[i - 1]);
        }
      }
    }

    drawCell(cell) {
      const rb = cell.shellId
        ? this.game.bodies.get(cell.shellId)
        : null;

      // 复合刚体的 Cell 不直接读 part.angle，用刚体 transform 推导世界姿态
      const transform = rb
        ? rb.cellWorld(cell)
        : {
            x: cell.body.position.x,
            y: cell.body.position.y,
            angle: cell.body.angle
          };

      this.drawBodyShape(
        cell.body,
        cell.value,
        1,
        cell.final,
        transform,
        this.popScale(cell)
      );
    }

    // 新合成方块"弹一下"入场：scale 1.18 → 1，easeOutBack（约 180ms）
    popScale(cell) {
      const fx = CFG.fx;
      if (cell.popAt == null) return 1;
      const t = (this.game.timeMs - cell.popAt) / (fx.popDuration * 1000);
      if (t >= 1 || t < 0) return 1;
      return fx.popScale + (1 - fx.popScale) * easeOutBack(t);
    }

    drawBodyShape(body, value, alpha, isFinal, transform, scale) {
      const position = transform || body.position;
      const angle = transform ? transform.angle : body.angle;
      this.drawShape(position.x, position.y, angle, value, isFinal, scale, alpha);
    }

    // V14：当前模式下某数值方块的视觉放大比例（1 = 基础尺寸）
    getTileScale(value) {
      return U.Cell.growthScale(value, this.game.isTileGrowthEnabled());
    }

    // 统一方块绘制：背景填充 + 细边框 + 数字（tilePalette 统一取色，
    // 无发光、无渐变、无高光层）。
    // 注意：视觉尺寸含数字变大缩放，物理碰撞体恒为基础尺寸（方案 A）
    drawShape(x, y, angle, value, isFinal, scale, alpha) {
      const ctx = this.ctx;
      const c = U.tilePalette(value);
      const k = scale || 1;
      const growth = this.getTileScale(value);
      const s = (CFG.tile.cellSize - 2) * growth * k;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x, y);
      ctx.rotate(angle);

      ctx.fillStyle = c.bg;
      roundRect(ctx, -s / 2, -s / 2, s, s, 5 * growth * k);
      ctx.fill();

      // 配色驱动的细边框；上限模式下的固化方块（final）用 2px 更明确
      ctx.strokeStyle = c.border;
      ctx.lineWidth = isFinal ? 2 : 1;
      roundRect(ctx, -s / 2, -s / 2, s, s, 5 * growth * k);
      ctx.stroke();

      ctx.fillStyle = c.fg;
      const text = String(value);
      const fontSize = this.getTileFontSize(text, s);
      ctx.font = 'bold ' + fontSize + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 0, 1);
      ctx.restore();
    }

    // 数字字号：按位数取基准并随方块放大，再按实际像素宽度收缩，保证不出界
    getTileFontSize(text, tileSize) {
      const len = Math.min(text.length, 9);
      const base = { 1: 18, 2: 18, 3: 16, 4: 14, 5: 11, 6: 9, 7: 8, 8: 7, 9: 6 }[len];
      let size = Math.round(base * tileSize / (CFG.tile.cellSize - 2));

      const maxWidth = tileSize * 0.82;
      while (size > 6) {
        this.ctx.font = 'bold ' + size + 'px sans-serif';
        if (this.ctx.measureText(text).width <= maxWidth) break;
        size--;
      }
      return Math.max(6, size);
    }

    // 被合并方块的退出动画：scale 1 → 0.65、alpha 1 → 0（约 130ms，easeOutCubic）
    drawFlash(f) {
      const t = Math.min(1, f.t / f.life);
      const scale = 1 + (CFG.fx.shrinkScale - 1) * easeOutCubic(t);
      this.drawShape(f.x, f.y, f.angle, f.value, f.final, scale, 1 - t);
    }

    // 合并粒子：小方点，透明度线性衰减，无发光
    drawParticle(pt) {
      const ctx = this.ctx;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - pt.t / pt.life);
      ctx.translate(pt.x, pt.y);
      ctx.rotate(pt.rot);
      ctx.fillStyle = pt.color;
      ctx.fillRect(-pt.size / 2, -pt.size / 2, pt.size, pt.size);
      ctx.restore();
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // 只保留两条缓动曲线（入场用 back、退场用 cubic），避免曲线过多难调
  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function easeOutBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  U.Renderer = Renderer;
})(typeof window !== 'undefined' ? window : globalThis);
