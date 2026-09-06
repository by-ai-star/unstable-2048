(function (root) {
  'use strict';
  const U = root.U2048;
  const CFG = U.CFG;
  const Matter = root.Matter;

  // 顶层协调器：不依赖 DOM，可在 Node 中做无头测试。
  //
  // 物理架构（规范：物理基本单位 = RigidBody，而不是 Cell）：
  //   - 每个 RigidBody 是一个 Matter 刚体（复合体或单格独立体），
  //     重力/碰撞/速度/旋转全部以刚体为单位计算；
  //   - Cell 是刚体的组成部分（融合/渲染/计分单元），世界坐标由刚体
  //     transform 推导（RigidBody.cellWorld），不是独立物理对象；
  //   - 自由 2048 方块 = 只含 1 个 Cell 的 RigidBody；
  //   - 融合导致拓扑断裂时，按邻接关系连通分量拆成多个新 RigidBody。
  class Game {
    constructor() {
      this.bus = new U.EventBus();
      this.physics = new U.PhysicsWorld();
      this.score = new U.ScoreSystem(this.bus);
      this.spawn = new U.SpawnSystem(this.physics, this.bus, () => this.score.maxTile);
      this.merge = new U.MergeSystem(this.physics, this.bus, () => this.timeMs,
        (value, x, y) => this.createFreeCell(value, x, y, 0),
        (nextValue) => this.canMergeTo(nextValue));
      this.lose = new U.LoseSystem(this.physics, this.bus);

      // 当前挂机倍速（1x/2x/3x/5x），从本地存储恢复用户上次选择
      this.idleSpeed = this.readIdleSpeed();

      // V14 数字变大模式：经典/挂机分别开关，从本地存储恢复
      this.tileGrowthEnabled = {
        classic: this.readTileGrowthSetting('classic'),
        idle: this.readTileGrowthSetting('idle')
      };

      this.idleAI = new U.IdleAI(this);

      // V14.2：历史战绩与首页合成上限
      this.history = new U.HistorySystem();
      this.selectedMergeCap = this.readMergeCapSetting();
      this.roundMergeCap = this.selectedMergeCap;
      this.roundMaxTile = 2;      // 本局生成过的最大数字（生成 + 合成统一计入）
      this.roundRecorded = false; // 同一局只记录一次历史
      this.roundStartedAt = 0;

      this.cells = [];            // 全部 Cell（渲染/融合单元视图）
      this.bodies = new Map();    // RigidBody 注册表：id -> RigidBody（仅多格复合体）
      this._bodySeq = 0;

      this.fx = { particles: [], flashes: [] }; // 合并反馈特效（轻量，直接挂 game 上）
      this.mode = null;           // 'classic' | 'idle'
      this.state = 'menu';        // menu | playing | paused | over
      this.timeMs = 0;
      this.timeSec = 0;
      this.keys = { left: false, right: false, down: false };
      this.driveTargetX = null;

      this.physics.onCollision(e => this.onCollision(e));
      this.bus.on('merge', p => this.onMerge(p));
      this.bus.on('gameover', () => this.onGameOver());
      this.bus.on('land', rb => {
        for (const c of rb.cells) this.cells.push(c);
        this.bodies.set(rb.id, rb);
      });
      // V14.2：本局最大数字统计包含新方块的生成值（不只是合成值）
      this.bus.on('spawn', piece => {
        for (const v of piece.cellValues) this.trackRoundMaxTile(v);
      });
    }

    // ---- 挂机倍速 ----
    // 读取持久化的倍速选择；缺失/非法时回退默认档位
    readIdleSpeed() {
      const idle = CFG.idle || {};
      const levels = Array.isArray(idle.speedLevels)
        ? idle.speedLevels
        : [1, 2, 3, 5];

      const fallback = levels.includes(idle.speedDefault)
        ? idle.speedDefault
        : levels[0];

      try {
        const key = idle.speedStorageKey || 'u2048_idle_speed';
        const raw = root.localStorage && root.localStorage.getItem(key);
        const saved = Number.parseInt(raw, 10);

        if (levels.includes(saved)) return saved;
      } catch (e) {
        // 当前环境不支持 localStorage 时使用默认值（如 Node 无头测试）
      }

      return fallback;
    }

    // 切换挂机倍速：校验档位 → 持久化 → 让等待中的旋转立即按新倍率重算 → 广播
    setIdleSpeed(multiplier) {
      const idle = CFG.idle || {};
      const levels = Array.isArray(idle.speedLevels)
        ? idle.speedLevels
        : [1, 2, 3, 5];

      const value = Number(multiplier);

      if (!Number.isFinite(value) || !levels.includes(value)) {
        return false;
      }

      const previous = this.idleSpeed;
      this.idleSpeed = value;

      try {
        const key = idle.speedStorageKey || 'u2048_idle_speed';
        if (root.localStorage) {
          root.localStorage.setItem(key, String(value));
        }
      } catch (e) {
        // 当前环境不支持 localStorage 时忽略持久化
      }

      // 如果当前方块正在下落，让新的旋转倍率立即生效
      if (previous !== value && this.idleAI &&
          typeof this.idleAI.onSpeedChange === 'function') {
        this.idleAI.onSpeedChange(previous, value);
      }

      this.bus.emit('idleSpeed', value);
      return true;
    }

    // ---- 数字变大模式（V14：视觉放大，物理不变）----
    // 读取某模式的开关（classic / idle 各自独立记忆）
    readTileGrowthSetting(mode) {
      const defaults = CFG.tileGrowth.enabledByMode || {};
      const defaultValue = !!defaults[mode];

      try {
        const key = 'u2048_tile_growth_' + mode;
        const saved = root.localStorage &&
          root.localStorage.getItem(key);

        if (saved === 'true') return true;
        if (saved === 'false') return false;
      } catch (e) {
        // localStorage 不可用时使用默认配置（如 Node 无头测试）
      }

      return defaultValue;
    }

    // 设置某模式的开关并持久化；开始一局后即按当前开关渲染
    setTileGrowthEnabled(mode, enabled) {
      if (mode !== 'classic' && mode !== 'idle') {
        return false;
      }

      const value = !!enabled;
      this.tileGrowthEnabled[mode] = value;

      try {
        const key = 'u2048_tile_growth_' + mode;
        if (root.localStorage) {
          root.localStorage.setItem(key, String(value));
        }
      } catch (e) {
        // 忽略本地存储错误
      }

      this.bus.emit('tileGrowthChange', {
        mode,
        enabled: value
      });

      return true;
    }

    // 当前模式是否启用数字变大（Renderer 只需调用这一个方法）。
    // 返回的是本局开局时锁定的值（applyOnNextRound），菜单开关修改在下一局生效
    isTileGrowthEnabled() {
      return !!this.roundGrowth;
    }

    // ---- V14.2 合成上限与历史战绩 ----

    // 首页合成上限：null 代表无限；禁止"会超过上限"的那次合成
    canMergeTo(nextValue) {
      return this.roundMergeCap === null ||
        nextValue <= this.roundMergeCap;
    }

    readMergeCapSetting() {
      const options = CFG.mergeCap.options;
      const fallback = CFG.mergeCap.defaultValue;

      try {
        const raw = root.localStorage &&
          root.localStorage.getItem(CFG.mergeCap.storageKey);

        if (raw === 'infinite') return null;

        const value = Number(raw);
        return options.includes(value) ? value : fallback;
      } catch (error) {
        return fallback;
      }
    }

    setSelectedMergeCap(cap) {
      const valid = cap === null ||
        CFG.mergeCap.options.includes(cap);

      if (!valid) return false;

      this.selectedMergeCap = cap;

      try {
        root.localStorage.setItem(
          CFG.mergeCap.storageKey,
          cap === null ? 'infinite' : String(cap)
        );
      } catch (error) {
        // 本地存储不可用时仍保留当前内存设置
      }

      this.bus.emit('mergeCapChanged', cap);
      return true;
    }

    // 本局生成过的最大数字（生成值 + 合成值统一计入，与历史记录同源）
    trackRoundMaxTile(value) {
      if (value > this.roundMaxTile) this.roundMaxTile = value;
    }

    // 统一结算入口：正常失败记录历史；同一局只记录一次
    endGame(reason) {
      if (this.state === 'over') return;

      this.state = 'over';
      this.recordRoundOnce(reason);
      this.bus.emit('state', this);
    }

    recordRoundOnce(endReason) {
      if (this.roundRecorded) return;

      this.roundRecorded = true;

      this.history.add({
        id: 'round_' + Date.now() + '_' + Math.floor(Math.random() * 10000).toString(36),
        mode: this.mode,
        endedAt: Date.now(),
        score: this.score.score,
        maxTile: this.roundMaxTile,
        mergeCap: this.roundMergeCap,
        durationMs: Date.now() - this.roundStartedAt,
        endReason
      });

      this.bus.emit('historyChanged');
    }

    start(mode) {
      this.physics.reset();
      this.spawn.reset();
      this.lose.reset();
      this.score.reset();
      this.cells = [];
      this.bodies = new Map();
      this.fx.particles = [];
      this.fx.flashes = [];
      this.timeMs = 0;
      this.timeSec = 0;
      this.keys = { left: false, right: false, down: false };
      this.driveTargetX = null;
      this.mode = mode;
      // V14.1：开关在下一局生效——开局时锁定本局的放大模式，运行中不变
      this.roundGrowth = !!this.tileGrowthEnabled[mode];
      // V14.2：本局规则锁定与历史记录状态
      this.roundMergeCap = this.selectedMergeCap;
      this.roundMaxTile = 2;
      this.roundRecorded = false;
      this.roundStartedAt = Date.now();
      this.spawn.lastLandTime = -CFG.piece.spawnDelay; // 立即生成第一组
      this.state = 'playing';
      this.bus.emit('state', this);
    }

    pause() { if (this.state === 'playing') { this.state = 'paused'; this.bus.emit('state', this); } }
    resume() { if (this.state === 'paused') { this.state = 'playing'; this.bus.emit('state', this); } }
    toMenu() { this.state = 'menu'; this.mode = null; this.bus.emit('state', this); }

    // ---- 玩家/AI 控制接口 ----
    rotatePiece() {
      const piece = this.spawn.piece;
      if (piece && !piece.landed) piece.rotate(this.physics.world);
    }

    drivePiece(targetX, maxSpeed) {
      const piece = this.spawn.piece;
      if (!piece || piece.landed) return;
      // 用实时包围盒半宽做钳制（旋转后宽度会变）
      const bounds = piece.body.bounds;
      const half = (bounds.max.x - bounds.min.x) / 2;
      const lo = this.physics.innerLeft + half + 1;
      const hi = this.physics.innerRight - half - 1;
      const tx = Math.max(lo, Math.min(hi, targetX));
      const dx = tx - piece.body.position.x;
      let vx = dx * CFG.input.dragLerp;
      vx = Math.max(-maxSpeed, Math.min(maxSpeed, vx));
      if (Math.abs(dx) < 1) vx = 0;
      // 只改水平速度，垂直速度保持物理结果，拖动不影响下落节奏
      Matter.Body.setVelocity(piece.body, { x: vx, y: piece.body.velocity.y });
    }

    fastDrop() {
      const piece = this.spawn.piece;
      if (!piece || piece.landed) return;
      Matter.Body.applyForce(piece.body, piece.body.position, {
        x: 0, y: piece.body.mass * CFG.piece.fallBoost
      });
    }

    // 挂机倍速的下落加速：只给当前下落中的方块补 (倍速-1) 份重力，
    // 不改全局重力，避免已落地的壳子/自由方块被一起加速
    applyIdleDropBoost(baseGravity) {
      if (this.mode !== 'idle') return;
      if (this.idleSpeed <= 1) return;

      const piece = this.spawn.piece;
      if (!piece || piece.landed || !piece.body) return;
      if (!Number.isFinite(piece.body.mass)) return;

      const gravity = this.physics.engine.gravity;
      const gravityScale = gravity.scale == null ? 0.001 : gravity.scale;

      // Matter 默认重力已提供 baseGravity，这里只补充 (倍速 - 1) 部分
      Matter.Body.applyForce(
        piece.body,
        piece.body.position,
        {
          x: 0,
          y: piece.body.mass *
            baseGravity *
            (this.idleSpeed - 1) *
            gravityScale
        }
      );
    }

    // ---- 碰撞路由 ----
    onCollision(e) {
      this.merge.detect(e);
      this.lose.track(e);
      if (e.type === 'collisionStart' || e.type === 'collisionActive') {
        this.checkLanding(e);
      }
    }

    checkLanding(e) {
      const piece = this.spawn.piece;
      if (!piece || piece.landed) return;
      for (const pair of e.pairs) {
        const pa = pair.bodyA, pb = pair.bodyB;
        let other = null;
        if (pa.parent === piece.body) other = pb;
        else if (pb.parent === piece.body) other = pa;
        else continue;
        if (other.label === 'floor' || other.label === 'tile') {
          // 落地：不拆散！下落复合体直接转正为 RigidBody（真刚体保持原状）
          piece.landed = true;
          this.spawn.piece = null;
          this.spawn.lastLandTime = this.timeSec;
          piece.body.label = 'shell';
          const originId = 'piece-' + piece.id;
          const cells = this.makeBodyCells(piece.body, piece.cellValues, originId);
          const rb = new U.RigidBody(originId, originId, piece.body, cells,
            piece.adjPairs.map(([i, j]) => [cells[i], cells[j]]));
          this.bus.emit('land', rb);
          return;
        }
      }
    }

    // 将 Cell 绑定到复合刚体的部件（挂载部件级引用 + 计算局部坐标）
    // 注意：只创建包装，入列由调用方负责（land 事件/rebuild），避免重复入列
    bindCellToPart(body, part, value, originId, source) {
      const cell = new U.Cell(value, originId);
      // V14.1：同步真实尺寸记录（壳内格子值恒 < startValue，结果恒为基础尺寸）
      cell.updateSize(this.isTileGrowthEnabled());

      // 局部坐标 = 逆旋转(部件世界位置 - 刚体重心)，满足
      // part.position == body.position + rotate(local, body.angle)
      const relX = part.position.x - body.position.x;
      const relY = part.position.y - body.position.y;
      const cos = Math.cos(-body.angle);
      const sin = Math.sin(-body.angle);

      cell.localX = relX * cos - relY * sin;
      cell.localY = relX * sin + relY * cos;
      cell.localAngle = part.angle - body.angle;
      cell.body = part;

      if (source) {
        cell.cooldownUntil = source.cooldownUntil;
        cell.final = !!source.final;
      } else {
        // 落地缓冲期：刚落地的壳子先稳住，缓冲期内不参与融合（防止落地即溶解）
        cell.cooldownUntil =
          this.timeMs + CFG.shell.landCooldown * 1000;
      }

      part.label = 'tile';
      part.plugin = part.plugin || {};
      part.plugin.cellRef = cell;

      return cell;
    }

    // 计算刚体上某个位置点的实际线速度：
    // vPoint = vCenter + angularVelocity x radius
    bodyVelocityAt(body, point) {
      const angularVelocity = body.angularVelocity || 0;

      return {
        x: body.velocity.x -
          angularVelocity * (point.y - body.position.y),
        y: body.velocity.y +
          angularVelocity * (point.x - body.position.x)
      };
    }

    makeBodyCells(body, values, originId) {
      return body.parts.slice(1).map((part, i) =>
        this.bindCellToPart(body, part, values[i], originId, null)
      );
    }

    // 创建自由 Cell（1 格 RigidBody）：融合产物 / 脱离的孤立格
    createFreeCell(value, x, y, angle, originId) {
      const cell = new U.Cell(value, originId);
      // V14.1：物理尺寸随数值同步放大（合并产物 = 按新数值重建刚体）
      cell.updateSize(this.isTileGrowthEnabled());
      const body = Matter.Bodies.rectangle(x, y, cell.size - 0.6, cell.size - 0.6, {
        angle: angle || 0,
        label: 'tile',
        friction: CFG.tile.friction,
        frictionStatic: CFG.tile.frictionStatic,
        restitution: CFG.tile.restitution,
        density: CFG.tile.density,
        frictionAir: CFG.tile.frictionAir
      });
      cell.body = body;
      body.plugin.cellRef = cell;
      Matter.World.add(this.physics.world, body);
      this.cells.push(cell);
      return cell;
    }

    // ---- 事件 ----
    onMerge(p) {
      this.score.onMerge(p.cell);
      this.trackRoundMaxTile(p.value); // V14.2：合成值计入本局最大数字

      // createFreeCell 已经会注册 cell，这里只作为兼容保护
      if (!this.cells.includes(p.cell)) this.cells.push(p.cell);

      for (const t of p.removed) {
        this.lose.removeTile(t.body);
      }

      // 合并反馈三件套（克制，无发光）：
      //   1) 先快照被合并方块的世界姿态（rebuildShells 会改壳子注册表，必须在前）
      this.recordMergeFlashes(p);
      this.rebuildShells(p.removed);
      //   2) 产物"弹一下"入场（Renderer 按 popAt 计算缩放）
      p.cell.popAt = this.timeMs;
      //   3) 合并点喷出一圈小方点粒子
      this.spawnMergeParticles(p);
    }

    // 合并粒子：小方点（与方块语言一致，不用圆点光斑），
    // 数量 6~14、寿命 120~180ms、初速随合并等级递增，透明度线性衰减
    spawnMergeParticles(p) {
      const fx = CFG.fx;
      const c = U.tilePalette(p.value); // 与方块同色，超上限数字也能取到配色
      const count = Math.round(Math.min(
        fx.particleMax,
        fx.particleBase + p.impact * fx.particlePerLevel
      ));
      const speed = fx.particleSpeed + p.impact * fx.particleSpeedPerLevel;

      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + Math.random() * 0.8;
        const v = speed * (0.6 + Math.random() * 0.6);
        this.fx.particles.push({
          x: p.x, y: p.y,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v,
          size: 2.5 + Math.random() * 2,
          rot: a,
          color: Math.random() < 0.7 ? c.bg : c.border,
          t: 0,
          life: fx.particleLife * (0.8 + Math.random() * 0.4)
        });
      }
    }

    // 被合并方块的退出动画快照：记录世界姿态 + 颜色信息（旧 Cell 随即退役）
    // 注意：t/life 单位是秒（与粒子一致），由 update(dtMs) 按 dtSec 推进
    recordMergeFlashes(p) {
      const life = CFG.fx.shrinkDuration;
      for (const t of p.removed) {
        const rb = t.shellId ? this.bodies.get(t.shellId) : null;
        const wp = rb ? rb.cellWorld(t)
          : { x: t.body.position.x, y: t.body.position.y, angle: t.body.angle };
        this.fx.flashes.push({
          x: wp.x, y: wp.y, angle: wp.angle,
          value: t.value, final: !!t.final,
          t: 0, life
        });
      }
    }

    // ---- 壳子重建（融合 → 局部破壳 → 连通分量 → 新刚体）----
    // 按壳子分组处理：同一次融合可能移除同一壳子的多个 Cell，必须一次性全部滤除
    rebuildShells(removedCells) {
      const removedByShell = new Map();

      for (const cell of removedCells) {
        const shellId = cell.shellId;
        cell.shellId = null;

        if (!shellId) continue; // 自由 Cell 不属于任何刚体

        if (!removedByShell.has(shellId)) {
          removedByShell.set(shellId, new Set());
        }

        removedByShell.get(shellId).add(cell);
      }

      for (const [shellId, removed] of removedByShell) {
        const rb = this.bodies.get(shellId);
        if (!rb) continue;

        this.bodies.delete(shellId);
        rb.cells = rb.cells.filter(cell => !removed.has(cell));

        this.rebuildBody(rb);
      }
    }

    rebuildBody(rb) {
      const world = this.physics.world;
      const oldBody = rb.body;
      const angularVelocity = oldBody.angularVelocity || 0;

      // 在删除旧刚体前保存所有剩余 Cell 的世界变换
      const worldTransforms = new Map();

      for (const cell of rb.cells) {
        worldTransforms.set(cell, rb.cellWorld(cell));
        this.lose.removeTile(cell.body);
      }

      Matter.World.remove(world, oldBody);

      if (rb.cells.length === 0) return;

      // 按相邻关系求连通分量：相连的格子保持为一个刚体，孤立的格子脱离
      const components = this.connectedComponents(
        rb.cells,
        rb.adjPairs
      );

      for (const component of components) {
        // 单格组件：脱离壳子，成为真正的自由方块
        if (component.length === 1) {
          const oldCell = component[0];
          const transform = worldTransforms.get(oldCell);

          oldCell.removed = true;
          oldCell.shellId = null;

          const freeCell = this.createFreeCell(
            oldCell.value,
            transform.x,
            transform.y,
            transform.angle
          );

          freeCell.cooldownUntil = oldCell.cooldownUntil;
          freeCell.final = !!oldCell.final;

          // 继承该位置处的真实线速度和角速度（不会突然停住或跳动）
          Matter.Body.setVelocity(
            freeCell.body,
            this.bodyVelocityAt(oldBody, transform)
          );

          Matter.Body.setAngularVelocity(
            freeCell.body,
            angularVelocity
          );

          if (freeCell.final) {
            Matter.Body.setStatic(freeCell.body, true);
          }

          continue;
        }

        // 多格分量：继续保持为一个新的复合刚体。
        // 壳内格子值恒 < startValue，物理尺寸恒为基础尺寸，无需插槽重布局
        const parts = component.map(cell => {
          const transform = worldTransforms.get(cell);

          return Matter.Bodies.rectangle(
            transform.x,
            transform.y,
            CFG.tile.cellSize - 0.6,
            CFG.tile.cellSize - 0.6,
            {
              angle: transform.angle,
              label: 'tileCell',
              friction: CFG.tile.friction,
              frictionStatic: CFG.tile.frictionStatic,
              restitution: CFG.tile.restitution,
              density: CFG.tile.density,
              frictionAir: CFG.tile.frictionAir
            }
          );
        });

        // 注意：Body.create 会就地改写传入的 parts 数组，必须传副本
        const body = Matter.Body.create({
          parts: parts.slice(),
          label: 'shell',
          friction: CFG.tile.friction,
          frictionStatic: CFG.tile.frictionStatic,
          restitution: CFG.tile.restitution,
          frictionAir: CFG.tile.frictionAir
        });

        // 新刚体的质心改变，需要继承质心位置处的线速度
        Matter.Body.setVelocity(
          body,
          this.bodyVelocityAt(oldBody, body.position)
        );

        Matter.Body.setAngularVelocity(
          body,
          angularVelocity
        );

        Matter.World.add(world, body);

        const newCells = parts.map((part, index) => {
          const oldCell = component[index];

          oldCell.removed = true; // 旧包装退役
          oldCell.shellId = null;

          return this.bindCellToPart(
            body,
            part,
            oldCell.value,
            rb.originId,
            oldCell
          );
        });

        for (const cell of newCells) {
          this.cells.push(cell);
        }

        // 相邻关系映射到新 Cell
        const pairMap = new Map(
          component.map((oldCell, index) => [
            oldCell,
            newCells[index]
          ])
        );

        const newAdjPairs = rb.adjPairs
          .filter(([a, b]) =>
            pairMap.has(a) && pairMap.has(b)
          )
          .map(([a, b]) => [
            pairMap.get(a),
            pairMap.get(b)
          ]);

        const id = 'body-' + (++this._bodySeq);

        this.bodies.set(
          id,
          new U.RigidBody(
            id,
            rb.originId,
            body,
            newCells,
            newAdjPairs
          )
        );
      }
    }

    // 用并查集按相邻关系（adjPairs）求连通分量（通用图算法，无形状特判）
    connectedComponents(cells, adjPairs) {
      const idx = new Map(cells.map((t, i) => [t, i]));
      const parent = cells.map((_, i) => i);
      const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
      for (const [a, b] of adjPairs) {
        const ia = idx.get(a), ib = idx.get(b);
        if (ia !== undefined && ib !== undefined) parent[find(ia)] = find(ib);
      }
      const groups = new Map();
      for (let i = 0; i < cells.length; i++) {
        const r = find(i);
        if (!groups.has(r)) groups.set(r, []);
        groups.get(r).push(cells[i]);
      }
      return [...groups.values()];
    }

    onGameOver() {
      // V14.2：挂机失败后不再自动重开，统一走结算入口，由玩家选择重开或回菜单
      this.endGame('danger-line');
    }

    // ---- 主循环 ----
    update(dtMs) {
      // 合并特效即使暂停/结束也继续衰减，避免残留
      const dtSec = dtMs / 1000;
      for (const pt of this.fx.particles) {
        pt.t += dtSec;
        pt.x += pt.vx * dtSec;
        pt.y += pt.vy * dtSec;
        const damp = Math.max(0, 1 - 5 * dtSec);
        pt.vx *= damp;
        pt.vy *= damp;
      }
      this.fx.particles = this.fx.particles.filter(pt => pt.t < pt.life);
      for (const f of this.fx.flashes) f.t += dtSec;
      this.fx.flashes = this.fx.flashes.filter(f => f.t < f.life);

      if (this.state !== 'playing') {
        // V14.2：挂机失败后不再自动重开，等待玩家在结算界面选择
        return;
      }

      const step = Math.min(dtMs, 33);
      this.timeMs += step;
      this.timeSec = this.timeMs / 1000;

      // 输入应用
      if (this.mode === 'idle') {
        this.idleAI.update();
      } else {
        if (this.driveTargetX != null) {
          this.drivePiece(this.driveTargetX, CFG.input.dragMaxSpeed);
        } else if (this.keys.left !== this.keys.right) {
          const piece = this.spawn.piece;
          if (piece && !piece.landed) {
            const vx = this.keys.left ? -CFG.input.keySpeed : CFG.input.keySpeed;
            Matter.Body.setVelocity(piece.body, { x: vx, y: piece.body.velocity.y });
          }
        }
        if (this.keys.down) this.fastDrop();
      }

      // 空中方块组保持刚体姿态：锁定角度、清零角速度（防止撞墙翻转/变形）
      const ap = this.spawn.piece;
      if (ap && !ap.landed) {
        Matter.Body.setAngle(ap.body, ap.baseAngle);
        Matter.Body.setAngularVelocity(ap.body, 0);
      }

      // 落地刚体：允许自然倾翻，但限幅角速度（抑制碰撞解算尖峰导致的乱转）
      for (const rb of this.bodies.values()) {
        const av = rb.body.angularVelocity;
        if (Math.abs(av) > CFG.shell.maxAngVel) {
          Matter.Body.setAngularVelocity(rb.body, Math.sign(av) * CFG.shell.maxAngVel);
        }
      }

      // 速度曲线：重力随分数逐级提升（类俄罗斯方块）
      const lvl = Math.floor(this.score.score / CFG.speed.scorePerLevel);
      const baseGravity = Math.min(
        CFG.speed.maxGravity,
        CFG.speed.baseGravity + lvl * CFG.speed.gravityStep
      );

      // 世界基础重力保持不变（已落地方块不受倍速影响）
      this.physics.engine.gravity.y = baseGravity;

      // 仅给挂机模式下正在下落的方块增加额外下落力
      this.applyIdleDropBoost(baseGravity);

      this.physics.update(step);
      this.merge.flush();
      this.lose.tick(step / 1000);
      this.spawn.maybeSpawn(
        this.timeSec,
        this.mode === 'idle' ? this.idleSpeed : 1
      );

      // 清理已融合移除的 cell（每秒一次足够）
      if ((this.timeMs | 0) % 1000 < step) {
        this.cells = this.cells.filter(c => !c.removed);
      }
    }
  }
  U.Game = Game;
})(typeof window !== 'undefined' ? window : globalThis);
