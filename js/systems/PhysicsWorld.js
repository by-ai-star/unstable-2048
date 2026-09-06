(function (root) {
  'use strict';
  const U = root.U2048;
  const CFG = U.CFG;
  const Matter = root.Matter;

  // 物理世界：容器（左右壁 + 底）+ 顶部警戒线传感器
  class PhysicsWorld {
    constructor() {
      this.engine = Matter.Engine.create({ enableSleeping: false });
      this.world = this.engine.world;
      this.buildContainer();
      this.handlers = [];
      // 注意：Matter 0.19 的事件对象不含 type 字段，派发时手动标注
      Matter.Events.on(this.engine, 'collisionStart', e => this.dispatch('collisionStart', e));
      Matter.Events.on(this.engine, 'collisionActive', e => this.dispatch('collisionActive', e));
      Matter.Events.on(this.engine, 'collisionEnd', e => this.dispatch('collisionEnd', e));
    }

    buildContainer() {
      const W = CFG.world.width, H = CFG.world.height;
      const t = CFG.container.wallThickness;
      const top = CFG.container.topOffset;
      const innerW = W - t * 2;
      this.innerLeft = t;
      this.innerRight = W - t;
      this.innerWidth = innerW;
      this.sensorY = top + CFG.tile.cellSize * 0.5;

      const opts = { isStatic: true, label: 'wall', friction: 0, frictionStatic: 0, restitution: 0 };
      // 墙面零摩擦：方块贴墙下落时不会被摩擦力拖慢
      this.walls = [
        // 左壁（从画布顶延伸到底，防止方块组被拖出）
        Matter.Bodies.rectangle(t / 2, H / 2, t, H, opts),
        Matter.Bodies.rectangle(W - t / 2, H / 2, t, H, opts),
        Matter.Bodies.rectangle(W / 2, H - CFG.container.floorHeight / 2, W, CFG.container.floorHeight,
          { isStatic: true, label: 'floor', friction: 0.6, restitution: 0 })
      ];
      // 警戒线传感器：tile 持续接触即计越线时间
      this.dangerSensor = Matter.Bodies.rectangle(
        W / 2, this.sensorY, innerW, CFG.tile.cellSize * 0.5,
        { isStatic: true, isSensor: true, label: 'danger' }
      );
      Matter.World.add(this.world, [...this.walls, this.dangerSensor]);
      // Matter 0.19 的 setStatic 会把静态体摩擦硬编码为 1，必须显式覆写：
      // 左右墙零摩擦（贴墙下落不被拖慢）；底板高摩擦（堆底不滑动）
      this.walls[0].friction = 0;
      this.walls[0].frictionStatic = 0;
      this.walls[1].friction = 0;
      this.walls[1].frictionStatic = 0;
      this.walls[2].friction = CFG.floor.friction;
      this.walls[2].frictionStatic = CFG.floor.frictionStatic;
    }

    onCollision(fn) { this.handlers.push(fn); }
    dispatch(type, e) {
      e.type = type;
      for (const fn of this.handlers) fn(e);
    }

    add(bodies) { Matter.World.add(this.world, bodies); }
    remove(body) { Matter.World.remove(this.world, body); }

    update(dtMs) { Matter.Engine.update(this.engine, dtMs); }

    reset() {
      // 清除所有约束（壳子绑定）与动态刚体（tile / piece），保留静态容器
      const world = this.world;
      for (const c of Matter.Composite.allConstraints(world)) {
        Matter.World.remove(world, c);
      }
      const dynamic = Matter.Composite.allBodies(world).filter(b => !b.isStatic);
      for (const b of dynamic) Matter.World.remove(world, b);

      // 防止重开后残留旧 collision pair
      Matter.Engine.clear(this.engine);
    }
  }
  U.PhysicsWorld = PhysicsWorld;
})(typeof window !== 'undefined' ? window : globalThis);
