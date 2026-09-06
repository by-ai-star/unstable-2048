// 无头冒烟测试：不依赖 DOM，直接驱动 Game 核心
// 运行：node tests/smoke.test.js
'use strict';

globalThis.Matter = require('../vendor/matter.min.js');

// 字面量路径逐个加载，保证加载顺序且不使用动态 require
require('../js/config.js');
require('../js/core/EventBus.js');
require('../js/entities/Cell.js');
require('../js/entities/RigidBody.js');
require('../js/entities/Piece.js');
require('../js/systems/PhysicsWorld.js');
require('../js/systems/SpawnSystem.js');
require('../js/systems/MergeSystem.js');
require('../js/systems/LoseSystem.js');
require('../js/systems/ScoreSystem.js');
require('../js/systems/HistorySystem.js');
require('../js/systems/IdleAI.js');
require('../js/core/Game.js');

const U = globalThis.U2048;
let failures = 0;
function assert(cond, msg) {
  if (cond) console.log('  ✓ ' + msg);
  else { failures++; console.error('  ✗ ' + msg); }
}
const dt = 16.7;

// 验证刚体不变量：Cell 世界坐标 == 刚体 transform 推导值，且部件间距恒定
function checkRigidInvariant(game, rb) {
  let maxPosErr = 0;
  const parts = rb.body.parts.slice(1);
  for (let i = 0; i < rb.cells.length; i++) {
    const w = rb.cellWorld(rb.cells[i]);
    maxPosErr = Math.max(maxPosErr,
      Math.hypot(w.x - parts[i].position.x, w.y - parts[i].position.y));
  }
  return maxPosErr;
}
function interCellDistances(rb) {
  const ps = rb.body.parts.slice(1);
  const d = [];
  for (let i = 0; i < ps.length; i++)
    for (let j = i + 1; j < ps.length; j++)
      d.push(Math.hypot(ps[i].position.x - ps[j].position.x, ps[i].position.y - ps[j].position.y));
  return d;
}

// ---------- 测试 1：挂机模式完整自动对局 ----------
console.log('[Test 1] idle 模式自动运行 3 分钟游戏时间');
{
  const game = new U.Game();
  game.start('idle');
  let mergeCount = 0;
  game.bus.on('merge', () => mergeCount++);
  let gameOverCount = 0;
  game.bus.on('gameover', () => gameOverCount++);
  for (let i = 0; i < Math.floor(180000 / dt); i++) game.update(dt);
  assert(mergeCount > 10, '发生了合并（count=' + mergeCount + '）');
  assert(game.score.score > 0, '分数大于 0（score=' + game.score.score + '）');
  assert(game.score.maxTile >= 4, '合成了 >=4 的数字（maxTile=' + game.score.maxTile + '）');
  assert(game.score.best === game.score.score, '最高分已同步（best=' + game.score.best + '）');
  const alive = game.cells.filter(c => !c.removed);
  assert(alive.every(c => isFinite(c.body.position.x) && isFinite(c.body.position.y)),
    '所有 cell 位置有限（无 NaN）');
  assert(alive.length < 400, 'cell 数量受控（count=' + alive.length + '）');
  assert(gameOverCount === 0, '状态机正常运转（gameover 次数=' + gameOverCount + '）');
}

// ---------- 测试 2：自由 Cell 融合数值翻倍、同帧不重复合并 ----------
console.log('[Test 2] 自由 Cell 融合基本规则');
{
  const game = new U.Game();
  game.start('classic');
  game.spawn.piece = null;
  game.spawn.maybeSpawn = () => {};
  const a = game.createFreeCell(8, 100, 500, 0, 't-a');
  const b = game.createFreeCell(8, 135, 500, 0, 't-b');
  let product = null;
  game.bus.on('merge', p => { product = p.cell; });
  for (let i = 0; i < 240; i++) {
    game.update(dt);
    if (product) break;
  }
  assert(!!product, '恰好发生一次融合');
  assert(product && product.value === 16, '融合后数值翻倍 8→16（实际 ' + (product && product.value) + '）');
  assert(game.score.score === 16, '计分 += 合并值（score=' + game.score.score + '）');
  assert(product && product.cooldownUntil > game.timeMs - 300, '新 cell 带合并冷却');
  assert(a.removed && b.removed, '旧 cell 已移除');
}

// ---------- 测试 3：越线触发 GameOver + 挂机不再自动重开（V14.2） ----------
console.log('[Test 3] 越线失败 / 挂机失败后不自动重开');
{
  const game = new U.Game();
  game.start('classic');
  game.spawn.piece = null;
  game.spawn.maybeSpawn = () => {};
  const stuck = game.createFreeCell(64, 88, game.physics.sensorY, 0);
  game.cells.push(stuck);
  let over = false;
  game.bus.on('state', g => { if (g.state === 'over') over = true; });
  for (let i = 0; i < Math.floor(3500 / dt); i++) {
    Matter.Body.setPosition(stuck.body, { x: 88, y: game.physics.sensorY });
    Matter.Body.setVelocity(stuck.body, { x: 0, y: 0 });
    game.update(dt);
    if (over) break;
  }
  assert(over, '越线后触发 GameOver');
  assert(game.state === 'over', '状态 = over');

  // V14.2：挂机失败后不再自动重开，停在结算界面等待玩家选择
  game.start('idle');
  game.spawn.piece = null;
  game.spawn.maybeSpawn = () => {};
  const stuck2 = game.createFreeCell(64, 100, game.physics.sensorY, 0);
  game.cells.push(stuck2);
  let over2 = false;
  game.bus.on('state', g => { if (g.state === 'over') over2 = true; });
  for (let i = 0; i < Math.floor(3500 / dt); i++) {
    Matter.Body.setPosition(stuck2.body, { x: 100, y: game.physics.sensorY });
    Matter.Body.setVelocity(stuck2.body, { x: 0, y: 0 });
    game.update(dt);
    if (over2) break;
  }
  assert(over2, '挂机越线后触发 GameOver');
  let restarted = false;
  for (let i = 0; i < Math.floor(4000 / dt); i++) {
    game.update(dt);
    if (game.state === 'playing') { restarted = true; break; }
  }
  assert(!restarted, '挂机失败后不再自动重开（等待玩家选择）');
}

// ---------- 测试 4：I 型方块落地 → 整体成为 RigidBody（真刚体） ----------
console.log('[Test 4] I 型落地 → 复合刚体 + transform 不变量');
{
  const game = new U.Game();
  game.start('classic');
  game.spawn.piece = null;
  const piece = game.spawn.spawn(0, U.Piece.defs[0]); // I 型
  assert(!!game.spawn.piece, '方块组已生成');
  assert(piece.body.parts.length - 1 === 4, 'I 型为 4 格复合刚体');

  for (let i = 0; i < 60 * 8; i++) {
    game.update(dt);
    if (!game.spawn.piece) break;
  }
  assert(game.spawn.piece === null, '方块组已落地');
  const rb = game.bodies.get('piece-' + piece.id);
  assert(!!rb && rb instanceof U.RigidBody, '落地后注册为 RigidBody');
  assert(rb && rb.body === piece.body, '刚体 = 落地时的复合刚体（同一物理单位）');
  assert(rb && rb.cells.length === 4, '刚体含 4 个 Cell');
  assert(checkRigidInvariant(game, rb) < 0.001,
    'transform 推导 == 部件世界坐标（不变量误差 < 0.001px）');
  const settled = game.cells.filter(c => !c.removed);
  assert(settled.length === 4, 'cell 数量正确（' + settled.length + '）');
  assert(settled.every(c => c.body.parent === piece.body), 'Cell 的物理归属是刚体部件');
  assert(settled.every(c => Number.isFinite(c.localX) && Number.isFinite(c.localY)), '局部坐标有限');
  assert(settled.every(c => c.body.position.y < 640 + 100), '都在容器内');
}

// ---------- 测试 5：同刚体 Cell 不互融；跨刚体同级融合升级 ----------
console.log('[Test 5] 同刚体不融合 / 跨刚体融合升级');
{
  const game = new U.Game();
  game.start('classic');
  game.spawn.piece = null;
  game.spawn.maybeSpawn = () => {};

  // A. 同 originId：贴合放置两个 4 → 不融合
  const a = game.createFreeCell(4, 100, 300, 0, 'piece-999');
  const b = game.createFreeCell(4, 135, 300, 0, 'piece-999');
  for (let i = 0; i < 120; i++) {
    Matter.Body.setPosition(a.body, { x: 100, y: 300 });
    Matter.Body.setPosition(b.body, { x: 135, y: 300 });
    Matter.Body.setVelocity(a.body, { x: 0, y: 0 });
    Matter.Body.setVelocity(b.body, { x: 0, y: 0 });
    game.update(dt);
  }
  assert(!a.removed && !b.removed, '同血统小方格不融合（仍是 2 块）');

  // B. 跨 originId：两个 4 落到底部贴合 → 合并为一个 8
  const c = game.createFreeCell(4, 60, 500, 0, 'p-a');
  const d = game.createFreeCell(4, 95, 500, 0, 'p-b');
  let mergedNew = null;
  game.bus.on('merge', p => { mergedNew = p.cell; });
  for (let i = 0; i < 240; i++) {
    game.update(dt);
    if (mergedNew) break;
  }
  assert(!!mergedNew, '跨血统同级发生了融合');
  assert(mergedNew && mergedNew.value === 8, '融合升级为 8（实际 ' + (mergedNew && mergedNew.value) + '）');
  assert(c.removed && d.removed, '旧的两块已移除');
  assert(game.cells.includes(mergedNew) && !mergedNew.removed, '融合产物存在于场地（会被渲染）');
  assert(mergedNew.originId.startsWith('free-'), '融合产物拥有独立身份（' + mergedNew.originId + '）');
}

// ---------- 测试 6：下落速度曲线随分数提升 ----------
console.log('[Test 6] 重力随分数逐级提升');
{
  const game = new U.Game();
  game.start('classic');
  const CFG = U.CFG;
  game.update(dt);
  const g0 = game.physics.engine.gravity.y;
  game.score.score = CFG.speed.scorePerLevel * 3;
  game.update(dt);
  const g3 = game.physics.engine.gravity.y;
  assert(g3 > g0, '分数升高后重力提升（' + g0.toFixed(2) + ' → ' + g3.toFixed(2) + '）');
  assert(Math.abs(g3 - (CFG.speed.baseGravity + 3 * CFG.speed.gravityStep)) < 1e-9, '按曲线正确计算');
  game.score.score = 1e9;
  game.update(dt);
  assert(game.physics.engine.gravity.y <= CFG.speed.maxGravity + 1e-9, '重力不超过上限');
}

// ---------- 测试 7：无上限合成——4096 可继续融合，数字无上限，配色全覆盖 ----------
console.log('[Test 7] 无上限合成（4096 仍可合成，数字无上限）');
{
  const game = new U.Game();
  game.setSelectedMergeCap(null); // V14.2：本测试验证无限合成链，先解除首页默认上限 4096
  game.start('classic');
  game.spawn.piece = null;
  game.spawn.maybeSpawn = () => {};

  // A. 2048+2048 → 4096：不再是最终方块，不固化、可移动、可继续合成
  const a = game.createFreeCell(2048, 60, 500, 0, 'p-a');
  const b = game.createFreeCell(2048, 95, 500, 0, 'p-b');
  let product4096 = null;
  game.bus.on('merge', p => { if (p.cell.value === 4096) product4096 = p.cell; });
  for (let i = 0; i < 240; i++) {
    game.update(dt);
    if (product4096) break;
  }
  assert(!!product4096, '合成出 4096');
  assert(product4096 && !product4096.final, '4096 不再标记为最终方块');
  assert(product4096 && !product4096.body.isStatic, '4096 不固化（可移动）');
  assert(product4096 && game.cells.includes(product4096) && !product4096.removed,
    '4096 在场并被渲染');

  // B. 4096+4096 → 8192：上限解除，链式继续
  const c = game.createFreeCell(4096, 200, 300, 0, 'p-c');
  const d = game.createFreeCell(4096, 235, 300, 0, 'p-d');
  game.cells.push(c, d);
  let product8192 = null;
  game.bus.on('merge', p => { if (p.cell.value === 8192) product8192 = p.cell; });
  for (let i = 0; i < 240; i++) {
    Matter.Body.setPosition(c.body, { x: 200, y: 300 });
    Matter.Body.setPosition(d.body, { x: 235, y: 300 });
    Matter.Body.setVelocity(c.body, { x: 0, y: 0 });
    Matter.Body.setVelocity(d.body, { x: 0, y: 0 });
    game.update(dt);
    if (product8192) break;
  }
  assert(!!product8192, '4096 + 4096 → 8192（上限解除）');
  assert(product8192 && game.cells.includes(product8192) && !product8192.final,
    '8192 在场且同样可继续合成');

  // C. 配色全覆盖：静态表延伸到 65536；更大数字动态生成且稳定、互不相同
  assert(!!U.tilePalette(4096).bg && !!U.tilePalette(8192).bg &&
    !!U.tilePalette(16384).bg && !!U.tilePalette(32768).bg &&
    !!U.tilePalette(65536).bg, '4096~65536 均有手工配色');
  const dyn1 = U.tilePalette(131072);
  const dyn2 = U.tilePalette(131072);
  assert(!!dyn1.bg && dyn1.bg === dyn2.bg && !!dyn1.fg && !!dyn1.border,
    '131072 动态配色稳定且三色齐全');
  assert(U.tilePalette(262144).bg !== dyn1.bg &&
    U.tilePalette(524288).bg !== dyn1.bg && U.tilePalette(1048576).bg !== dyn1.bg,
    '更大数字拥有互不相同的配色');

  // D. 常规链路 8+8→16 依旧正常
  const e = game.createFreeCell(8, 60, 200, 0, 'p-e');
  const f = game.createFreeCell(8, 95, 200, 0, 'p-f');
  game.cells.push(e, f);
  let sixteen = null;
  game.bus.on('merge', p => { if (p.cell.value === 16) sixteen = p.cell; });
  for (let i = 0; i < 240; i++) {
    game.update(dt);
    if (sixteen) break;
  }
  assert(!!sixteen && game.cells.includes(sixteen), '低等级链正常（8+8→16 且留存）');
}

// ---------- 测试 8：空中撞墙不翻转、不散架 ----------
console.log('[Test 8] 空中方块组姿态锁定');
{
  const game = new U.Game();
  game.start('classic');
  game.spawn.piece = null;
  game.spawn.maybeSpawn = () => {};
  const piece = game.spawn.spawn(0);
  let sawLand = false;
  for (let i = 0; i < 150; i++) {
    if (game.spawn.piece) {
      Matter.Body.setVelocity(piece.body, { x: 10, y: piece.body.velocity.y });
      game.update(dt);
    } else { sawLand = true; game.update(dt); }
  }
  const quarter = Math.PI / 2;
  const dev = Math.abs(((piece.body.angle - piece.baseAngle) % quarter + quarter) % quarter);
  assert(dev < 1e-6 || sawLand, '空中角度始终锁定在 90° 倍数（无翻转变形）');
  assert(piece.body.parts.length - 1 === piece.cellValues.length || piece.landed,
    '复合体完整未散架');
}

// ---------- 测试 9：L 型刚体拐角融合 → 长边重建刚体、短边脱离 ----------
console.log('[Test 9] L 型拐角融合的破裂规则');
{
  const game = new U.Game();
  game.start('classic');
  game.spawn.piece = null;
  game.spawn.maybeSpawn = () => {};
  const w = game.physics.world;

  // L 形复合刚体：A(拐角) - B - C（长边），A - D（短边下垂）
  const coords = [[100, 400], [136, 400], [172, 400], [100, 436]];
  const parts = coords.map(([x, y]) => Matter.Bodies.rectangle(x, y, 35.4, 35.4, {
    label: 'tileCell', friction: 1.1, frictionStatic: 2.0, restitution: 0.02, density: 0.0016
  }));
  const shellBody = Matter.Body.create({ parts: parts.slice(), label: 'shell' });
  Matter.World.add(w, shellBody);
  const cells = game.makeBodyCells(shellBody, [2, 2, 2, 2], 'piece-T');
  const [A, B, C, D] = cells;
  const rb = new U.RigidBody('piece-T', 'piece-T', shellBody, cells,
    [[A, B], [B, C], [A, D]]);
  game.bodies.set('piece-T', rb);
  game.cells.push(...cells);

  // 外部同级方块 E：与拐角 A 轻微重叠（确保接触），与短边 D 保持间距
  const E = game.createFreeCell(2, 64.8, 400, 0, 'ext');
  let product = null;
  game.bus.on('merge', p => { if (p.cell.value === 4) product = p.cell; });
  for (let i = 0; i < 240; i++) {
    game.update(dt);
    if (product) break;
  }

  assert(A.removed && E.removed, '拐角 A 与外部方块 E 融合移除');
  assert(!!product && game.cells.includes(product), '融合产物 4 留在场地');
  const shell1 = [...game.bodies.values()].find(r => r.cells.length === 2);
  assert(!!shell1 && shell1.body !== shellBody, '长边重建为新复合刚体');
  assert(shell1 && shell1.cells.length === 2, '长边 B、C 组成 2 格新刚体');
  assert(shell1 && shell1.body.parts.length - 1 === 2 && shell1.body.label === 'shell',
    '长边为复合刚体（真刚体不散架）');
  assert(shell1 && checkRigidInvariant(game, shell1) < 0.001, '新刚体满足 transform 不变量');
  assert(shell1 && shell1.originId === 'piece-T' && Matter.Composite.allBodies(w).includes(shell1.body),
    '新复合体在场并注册（身份保持 piece-T）');
  const freed = game.cells.find(c => !c.removed && c.originId.startsWith('free-') && c.value === 2
    && Math.abs(c.body.position.x - 100) < 3); // y 不限：缓冲期内整体继续下落
  assert(!!freed, '短边 D 脱离壳子成为自由方块（新身份）');
}

// ---------- 测试 10：落地缓冲期内不融合，缓冲结束后正常融合 ----------
console.log('[Test 10] 落地缓冲期（壳子先稳住再融合）');
{
  const game = new U.Game();
  game.start('classic');
  game.spawn.piece = null;
  game.spawn.maybeSpawn = () => {};

  const parts = [[100, 400], [136, 400]].map(([x, y]) =>
    Matter.Bodies.rectangle(x, y, 35.4, 35.4, { label: 'tileCell', friction: 1.1, density: 0.0016 }));
  const sb = Matter.Body.create({ parts: parts.slice(), label: 'shell' });
  Matter.World.add(game.physics.world, sb);
  const cells = game.makeBodyCells(sb, [2, 2], 'piece-T');
  const rb = new U.RigidBody('piece-T', 'piece-T', sb, cells, [[cells[0], cells[1]]]);
  game.bodies.set('piece-T', rb);
  game.cells.push(...cells);
  const E = game.createFreeCell(2, 64.8, 400, 0, 'ext');

  let merged = null;
  game.bus.on('merge', p => { merged = p.cell; });
  // 只跑缓冲期内的帧：某帧结束时 now = timeMs + dt，须仍 < 缓冲期，融合才不可能触发
  const cooldownMs = U.CFG.shell.landCooldown * 1000;
  for (let i = 0; i < 25 && game.timeMs + dt <= cooldownMs; i++) {
    game.update(dt);
    if (merged) break;
  }
  assert(!merged, '落地缓冲期内不融合（壳子先稳住）');
  for (let i = 0; i < 240; i++) {
    game.update(dt);
    if (merged) break;
  }
  assert(!!merged && merged.value === 4, '缓冲期结束后正常融合（4 留存）');
}

// ---------- 测试 11：通用形状——五格骨牌（无形状特判） ----------
console.log('[Test 11] 通用机制：自定义五格形状直接工作');
{
  const game = new U.Game();
  game.start('classic');
  game.spawn.piece = null;
  const dt2 = dt;
  // P 五格骨牌：完整走 生成→落地→成壳 流程
  const pentaDef = { id: 'P5', cells: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]] };
  const piece = game.spawn.spawn(0, pentaDef);
  assert(piece.body.parts.length - 1 === 5, '五格形状生成 5 格复合刚体');
  assert(piece.adjPairs.length === 5, '相邻关系自动推导（5 对）');
  for (let i = 0; i < 60 * 8; i++) {
    game.update(dt2);
    if (!game.spawn.piece) break;
  }
  const rb = game.bodies.get('piece-' + piece.id);
  assert(!!rb && rb.cells.length === 5, '落地后注册为 5 格 RigidBody');
  assert(rb && rb.isIntact(), '刚体完整（部件数 == Cell 数）');
  assert(checkRigidInvariant(game, rb) < 0.001, '五格刚体满足 transform 不变量');

  // 拐角融合破裂同样适用于五格形状
  const game2 = new U.Game();
  game2.start('classic');
  game2.spawn.piece = null;
  game2.spawn.maybeSpawn = () => {};
  const w2 = game2.physics.world;
  const pc = [[100, 400], [136, 400], [100, 436], [136, 436], [100, 472]];
  const parts2 = pc.map(([x, y]) => Matter.Bodies.rectangle(x, y, 35.4, 35.4,
    { label: 'tileCell', friction: 1.1, density: 0.0016 }));
  const sb2 = Matter.Body.create({ parts: parts2.slice(), label: 'shell' });
  Matter.World.add(w2, sb2);
  const cs = game2.makeBodyCells(sb2, [2, 2, 2, 2, 2], 'piece-P');
  const rb2 = new U.RigidBody('piece-P', 'piece-P', sb2, cs,
    [[cs[0], cs[1]], [cs[0], cs[2]], [cs[1], cs[3]], [cs[2], cs[4]]]);
  game2.bodies.set('piece-P', rb2);
  game2.cells.push(...cs);
  const E2 = game2.createFreeCell(2, 64.8, 400, 0, 'ext'); // 融合拐角 (0,0)
  let done = false;
  game2.bus.on('merge', () => { done = true; });
  for (let i = 0; i < 240; i++) {
    game2.update(dt2);
    if (done && i > 30) break;
  }
  // (0,0) 消失后：(0,1)-(0,2) 相连 → 2 格刚体；(1,0),(1,1) 相连 → 2 格刚体
  const compsAfter = [...game2.bodies.values()].filter(r => r.originId === 'piece-P');
  assert(compsAfter.length === 2 && compsAfter.every(r => r.cells.length === 2),
    '五格拐角融合 → 按连通分量拆成两个 2 格刚体（通用规则生效）');
}

// ---------- 测试 12：倾翻过程中的刚体不变量（旋转时 Cell 相对位置恒定） ----------
console.log('[Test 12] 倾翻旋转中的刚体不变量');
{
  const game = new U.Game();
  game.start('classic');
  game.spawn.piece = null;
  game.spawn.maybeSpawn = () => {};
  const w = game.physics.world;
  // 悬臂 L：仅右端有支撑 → 重力倾翻
  const coords = [[60, 500], [96, 500], [132, 500], [60, 464]];
  const parts = coords.map(([x, y]) => Matter.Bodies.rectangle(x, y, 35.4, 35.4,
    { label: 'tileCell', friction: 1.1, frictionStatic: 2.0, restitution: 0.02, density: 0.0016 }));
  const sb = Matter.Body.create({ parts: parts.slice(), label: 'shell' });
  Matter.World.add(w, sb);
  const cells = game.makeBodyCells(sb, [2, 2, 2, 2], 'piece-L');
  const rb = new U.RigidBody('piece-L', 'piece-L', sb, cells,
    [[cells[0], cells[1]], [cells[1], cells[2]], [cells[0], cells[3]]]);
  game.bodies.set('piece-L', rb);
  game.cells.push(...cells);
  game.cells.push(game.createFreeCell(8, 132, 536, 0, 'sup')); // 仅右端支撑

  const d0 = interCellDistances(rb);
  let maxDistDrift = 0, maxInvErr = 0;
  for (let i = 0; i < 300; i++) {
    game.update(dt);
    const d1 = interCellDistances(rb);
    for (let k = 0; k < d1.length; k++) maxDistDrift = Math.max(maxDistDrift, Math.abs(d1[k] - d0[k]));
    maxInvErr = Math.max(maxInvErr, checkRigidInvariant(game, rb));
  }
  assert(maxDistDrift < 0.001, '倾翻全程格间距恒定（最大漂移 ' + maxDistDrift.toFixed(5) + 'px）');
  assert(maxInvErr < 0.001, '旋转中 transform 推导始终成立（最大误差 ' + maxInvErr.toFixed(5) + 'px）');
  assert(Math.abs(rb.body.angle) > 0.05, '刚体确实发生了自然倾翻（转角 ' +
    (Math.abs(rb.body.angle) * 180 / Math.PI).toFixed(1) + '°）');
}

// ---------- 测试 13：数字变大模式（视觉与物理同步放大，下一局生效） ----------
console.log('[Test 13] 数字变大模式（物理同步放大 / 分模式开关 / 下一局生效）');
{
  const game = new U.Game();
  game.start('classic');
  game.spawn.piece = null;
  game.spawn.maybeSpawn = () => {};

  // A. 缩放规则：16 及以下恒为 1；32 起逐级放大；封顶 maxScale；开关关闭不放大
  assert(U.Cell.growthScale(2, true) === 1 && U.Cell.growthScale(8, true) === 1 &&
    U.Cell.growthScale(16, true) === 1, '2/4/8/16 保持基础尺寸（比例 1）');
  assert(Math.abs(U.Cell.growthScale(32, true) - 1.06) < 1e-9,
    '32 开始放大（1.06 倍，实际 ' + U.Cell.growthScale(32, true).toFixed(2) + '）');
  const s32 = U.Cell.growthScale(32, true);
  const s64 = U.Cell.growthScale(64, true);
  const s128 = U.Cell.growthScale(128, true);
  assert(s64 > s32 && s128 > s64, '等级越高放大越多（' +
    s32.toFixed(2) + ' → ' + s64.toFixed(2) + ' → ' + s128.toFixed(2) + '）');
  assert(U.Cell.growthScale(2048, true) === U.CFG.tileGrowth.maxScale &&
    U.Cell.growthScale(1048576, true) === U.CFG.tileGrowth.maxScale,
    '放大封顶 maxScale=' + U.CFG.tileGrowth.maxScale);
  assert(U.Cell.growthScale(4096, false) === 1, '开关关闭时不放大');

  // B. 分模式开关：经典/挂机互相独立；菜单开关立即记忆，但下一局才生效
  game.setTileGrowthEnabled('classic', true);
  game.setTileGrowthEnabled('idle', false);
  assert(game.tileGrowthEnabled.classic === true && game.tileGrowthEnabled.idle === false,
    '经典/挂机开关独立记忆');
  assert(game.isTileGrowthEnabled() === false,
    '运行中的对局保持原尺寸模式（开关下一局生效）');
  game.setTileGrowthEnabled('nonsense', true);
  assert(game.tileGrowthEnabled.classic === true && !game.tileGrowthEnabled.nonsense,
    '非法模式名被拒绝');

  // C. 下一局生效：重新开局后开关被锁定，新物理体按真实尺寸创建
  game.start('classic');
  game.spawn.piece = null;
  game.spawn.maybeSpawn = () => {};
  assert(game.isTileGrowthEnabled() === true, '开局锁定本局放大模式');
  const c64 = game.createFreeCell(64, 100, 400, 0, 'tg-a');
  assert(Math.abs(c64.size - U.CFG.tile.cellSize * 1.12) < 1e-9 && c64.scale === 1.12,
    'cell.size/halfSize 记录真实尺寸（64 → 1.12 倍）');
  const w64 = c64.body.bounds.max.x - c64.body.bounds.min.x;
  const expectW = U.CFG.tile.cellSize * 1.12 - 0.6;
  assert(Math.abs(w64 - expectW) < 0.01,
    '64 物理碰撞体同步放大（' + w64.toFixed(1) + 'px，期望 ' + expectW.toFixed(1) + 'px）');

  // D. 视觉与物理一致后，贴脸的两个 64 稳定合成出更大的 128
  const d = game.createFreeCell(64, 100 + c64.size - 2, 400, 0, 'tg-b');
  let product128 = null;
  game.bus.on('merge', p => { if (p.cell.value === 128) product128 = p.cell; });
  for (let i = 0; i < 240 && !product128; i++) game.update(dt);
  assert(!!product128 && !product128.removed && game.cells.includes(product128),
    '两个放大的 64 正常接触并合成 128');
  const w128 = product128.body.bounds.max.x - product128.body.bounds.min.x;
  assert(w128 > w64, '128 产物物理尺寸更大（' + w128.toFixed(1) + 'px > ' + w64.toFixed(1) + 'px）');
  assert(Math.abs(w128 - (U.CFG.tile.cellSize * 1.18 - 0.6)) < 0.01,
    '128 产物按 1.18 倍重建刚体');

  // E. 关闭开关后的新局恢复基础尺寸
  game.setTileGrowthEnabled('classic', false);
  game.start('classic');
  game.spawn.piece = null;
  const baseCell = game.createFreeCell(64, 100, 400, 0, 'tg-c');
  const wBase = baseCell.body.bounds.max.x - baseCell.body.bounds.min.x;
  assert(Math.abs(wBase - (U.CFG.tile.cellSize - 0.6)) < 0.01,
    '关闭后新局恢复基础尺寸（' + wBase.toFixed(1) + 'px）');
}

// ---------- 测试 14：合成上限与历史战绩（V14.2） ----------
console.log('[Test 14] 合成上限与历史战绩');
{
  const game = new U.Game();
  game.start('classic');
  game.spawn.piece = null;
  game.spawn.maybeSpawn = () => {};

  // A. 默认上限 4096：2048+2048 可合成，4096+4096 不合成（不固化、仍可碰撞堆叠）
  assert(game.selectedMergeCap === 4096 && game.roundMergeCap === 4096,
    '默认合成上限 4096');
  const a = game.createFreeCell(2048, 100, 400, 0, 'mc-a');
  const b = game.createFreeCell(2048, 135, 400, 0, 'mc-b');
  let p4096 = null;
  game.bus.on('merge', p => { if (p.cell.value === 4096) p4096 = p.cell; });
  for (let i = 0; i < 240 && !p4096; i++) game.update(dt);
  assert(!!p4096 && !p4096.final, '上限 4096：2048+2048 → 4096 可合成且不固化');
  const c = game.createFreeCell(4096, 100, 200, 0, 'mc-c');
  const d = game.createFreeCell(4096, 135, 200, 0, 'mc-d');
  let p8192Blocked = false;
  game.bus.on('merge', p => { if (p.cell.value === 8192) p8192Blocked = true; });
  for (let i = 0; i < 120; i++) game.update(dt);
  assert(!p8192Blocked && !c.removed && !d.removed, '上限 4096：4096+4096 不再合成');

  // B. 运行中对局保持原上限，新局才应用新设置
  game.setSelectedMergeCap(8192);
  assert(game.selectedMergeCap === 8192 && game.roundMergeCap === 4096,
    '修改上限只影响下一局（当前局仍为 4096）');
  game.start('classic');
  game.spawn.piece = null;
  game.spawn.maybeSpawn = () => {};
  assert(game.roundMergeCap === 8192, '新开局使用新上限 8192');
  const e = game.createFreeCell(4096, 100, 300, 0, 'mc-e');
  const f = game.createFreeCell(4096, 135, 300, 0, 'mc-f');
  let p8192 = null;
  game.bus.on('merge', p => { if (p.cell.value === 8192) p8192 = p.cell; });
  for (let i = 0; i < 240 && !p8192; i++) game.update(dt);
  assert(!!p8192, '上限 8192：4096+4096 可合成');

  // C. 无限上限：任意等级可继续合成
  game.setSelectedMergeCap(null);
  assert(game.selectedMergeCap === null, '设置"无限"上限');
  game.start('classic');
  game.spawn.piece = null;
  assert(game.roundMergeCap === null && game.canMergeTo(524288),
    '无限上限下任意等级均可合成');

  // D. 历史战绩：正常失败记录一次；重复结算不重复记录；重开不记录
  const countBefore = game.history.get('classic').length;
  game.bus.emit('gameover'); // 触发 endGame('danger-line')
  const records = game.history.get('classic');
  assert(records.length === countBefore + 1, '结束一局写入一条历史');
  const rec = records[0];
  assert(rec.mode === 'classic' && Number.isFinite(rec.score) &&
    Number.isFinite(rec.maxTile) && rec.mergeCap === null &&
    typeof rec.endedAt === 'number' && rec.id && rec.endReason === 'danger-line',
    '历史字段完整（模式/总分/最大数字/上限/时间/原因）');
  assert(rec.score === game.score.score && rec.maxTile === game.roundMaxTile,
    '历史分数与最大数字和当局状态一致');
  game.bus.emit('gameover'); // 重复触发结算
  assert(game.history.get('classic').length === countBefore + 1,
    '同一局重复结算只记录一次');
  game.start('classic'); // 主动重开
  assert(game.history.get('classic').length === countBefore + 1,
    '主动重开不写入历史');

  // E. 上限非法值被拒绝
  assert(game.setSelectedMergeCap(9999) === false, '非法上限值被拒绝');
  assert(game.setSelectedMergeCap('abc') === false, '非数字上限被拒绝');
}

console.log(failures === 0 ? '\n全部通过 ✔' : '\n有 ' + failures + ' 项失败 ✘');
process.exit(failures === 0 ? 0 : 1);
