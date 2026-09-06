(function (root) {
  'use strict';
  const U = root.U2048;
  const { CFG } = U;

  // 失败判定：tile 与警戒线传感器持续接触超过 graceTime → GameOver
  class LoseSystem {
    constructor(physics, bus) {
      this.physics = physics;
      this.bus = bus;
      this.touching = new Set();  // 接触传感器的 tile body id
      this.timer = 0;
      this.fired = false;
      this.onCollision = e => this.track(e);
    }

    track(e) {
      // pair 中的 body 可能是复合刚体部件：直接看部件 label
      for (const pair of e.pairs) {
        let tileBody = null, isDanger = false;
        if (pair.bodyA.label === 'danger') { isDanger = true; tileBody = pair.bodyB; }
        else if (pair.bodyB.label === 'danger') { isDanger = true; tileBody = pair.bodyA; }
        if (!isDanger || !tileBody || tileBody.label !== 'tile') continue;
        if (e.type === 'collisionStart' || e.type === 'collisionActive') {
          this.touching.add(tileBody.id);
        } else if (e.type === 'collisionEnd') {
          this.touching.delete(tileBody.id);
        }
      }
    }

    removeTile(body) { this.touching.delete(body.id); }

    tick(dtSec) {
      if (this.fired) return;
      if (this.touching.size > 0) {
        this.timer += dtSec;
        if (this.timer >= CFG.lose.graceTime) {
          this.fired = true;
          this.bus.emit('gameover');
        }
      } else {
        this.timer = Math.max(0, this.timer - dtSec * 2);
      }
    }

    get dangerRatio() { return Math.min(1, this.timer / CFG.lose.graceTime); }

    reset() {
      this.touching.clear();
      this.timer = 0;
      this.fired = false;
    }
  }
  U.LoseSystem = LoseSystem;
})(typeof window !== 'undefined' ? window : globalThis);
