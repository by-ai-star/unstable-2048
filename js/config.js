(function (root) {
  'use strict';
  // ============================================================
  // 全部可调参数。凡标记 ASSUMPTION 的为推测默认值，可在调参时直接修改。
  // ============================================================
  const CFG = {
    world: { width: 360, height: 640 },
    container: {
      topOffset: 70,      // 容器顶部（警戒线所在高度）
      wallThickness: 8,
      floorHeight: 10
    },
    tile: {
      cellSize: 36,
      density: 0.0016,
      friction: 1.1,          // 调参：方块间/方块与底板的高摩擦，减少滑动
      frictionStatic: 2.0,
      restitution: 0.02,
      frictionAir: 0.008
    },
    piece: {
      spawnDelay: 0.5,    // ASSUMPTION：落地后到下一组生成的间隔（秒）
      spawnY: 34,
      fallBoost: 0.0016   // 快速下落时的额外力系数
    },
    speed: {
      // ASSUMPTION：速度曲线——下落速度随分数逐级提升（类俄罗斯方块）
      baseGravity: 0.38,  // 初始重力（Matter 默认 1 明显偏快）
      scorePerLevel: 400, // 每 400 分提升一级
      gravityStep: 0.12,  // 每级增加的重力
      maxGravity: 1.1     // 重力上限
    },
    spawn: {
      // ASSUMPTION：生成数字权重；随最大数字解锁更大基础数字
      base: [
        { value: 2, weight: 0.72 },
        { value: 4, weight: 0.28 }
      ],
      unlock: [
        { minTile: 256,  value: 8,  weight: 0.12 },
        { minTile: 1024, value: 16, weight: 0.06 }
      ]
    },
    floor: {
      // 底板高摩擦：方块落到地面后不滑动
      friction: 1.4,
      frictionStatic: 2.0
    },
    shell: {
      maxAngVel: 0.15,    // rad/step：允许自然倾翻，抑制乱转
      landCooldown: 0.05  // ASSUMPTION：落地缓冲期（秒），期内壳子格不参与融合
    },
    merge: {
      cooldown: 0.25,      // ASSUMPTION：合并后的冷却（秒），防同帧连锁失控
      popVelocityY: -2.2,  // ASSUMPTION：新块向上弹出的速度（柔和不冲撞堆体）
      popVelocityX: 1.0
    },
    // V14.2 首页可选合成上限：达到上限的数字不再与同值合成，游戏仍按死亡线规则结束。
    // 旧版固化机制（final/static）已由本设置取代；null 代表无限（JSON 不支持 Infinity）
    mergeCap: {
      options: [4096, 8192, 16384, 32768, 65536, 131072, 262144, null],
      defaultValue: 4096,
      storageKey: 'u2048_merge_cap_v1'
    },
    storage: {
      historyKey: 'u2048_round_history_v1' // V14.2 历史战绩存储键
    },
    lose: {
      graceTime: 2.5      // ASSUMPTION：方块越线持续该时长即失败（秒）
    },
    input: {
      tapMaxMs: 250,      // 短于该时长且几乎未移动 → 判定为点击（旋转）
      tapMaxDist: 14,     // 超过该像素位移 → 判定为拖动
      dragLerp: 0.16,     // 横向跟随插值：越小越平滑
      dragMaxSpeed: 5,    // 拖动水平速度上限（px/step），避免拖动"突进"感
      keySpeed: 4
    },
    idle: {
      moveSpeed: 3,
      thinkMin: 0.4,
      thinkMax: 1.2,
      // 挂机倍速：只作用于"主动方块生命周期"（下落力/旋转节奏/生成间隔），
      // 不影响横向移动、合并冷却、落地缓冲、失败判定与动画计时
      speedLevels: [1, 2, 3, 5, 10],
      speedDefault: 1,
      speedStorageKey: 'u2048_idle_speed'
    },
    // 2048 离散调色板：每个数值独立指定 bg/fg/border，层级间换色相而非只调明度。
    // 原则：低值浅色深字、中段换色相、高值深底白字；只用细边框，不做 glow/渐变/描边特效
    colors: {
      2:    { bg: '#ece5d8', fg: '#6f6558', border: '#d8cebd' }, // 很浅暖灰
      4:    { bg: '#e2e6ee', fg: '#566072', border: '#c9cfdd' }, // 很浅蓝灰
      8:    { bg: '#cde4c6', fg: '#3d6637', border: '#b0d1a6' }, // 浅绿
      16:   { bg: '#f6d3ae', fg: '#8a5522', border: '#e6ba88' }, // 浅橙
      32:   { bg: '#d9c8ee', fg: '#65438f', border: '#c1acdd' }, // 浅紫
      64:   { bg: '#f2e5a4', fg: '#7c6a1e', border: '#dccf7e' }, // 浅黄
      128:  { bg: '#b7d7ee', fg: '#2e5c81', border: '#99c0e0' }, // 浅蓝
      256:  { bg: '#f1c3d3', fg: '#8e395b', border: '#e0a2ba' }, // 浅粉
      512:  { bg: '#3e8f8a', fg: '#f5f3ee', border: '#2e716d' }, // 深青，白字
      1024: { bg: '#8c3450', fg: '#f9f1f3', border: '#6e2539' }, // 深酒红，白字
      2048: { bg: '#bd7d22', fg: '#fdf6e8', border: '#96611a' }, // 深金橙，白字
      4096: { bg: '#3a3552', fg: '#f4f2ff', border: '#d4a017' }, // 墨紫 + 金色细边框
      // V13 数字无限大：手工调色延伸到 65536，更大数字由 tilePalette() 动态生成
      8192:  { bg: '#1f6e43', fg: '#f2f8f4', border: '#14502f' }, // 深翠绿，白字
      16384: { bg: '#2b4a9e', fg: '#f1f3fa', border: '#1d3473' }, // 深宝蓝，白字
      32768: { bg: '#7c2a6e', fg: '#f9f2f7', border: '#5c1d51' }, // 深紫红，白字
      65536: { bg: '#39424e', fg: '#f5f6f8', border: '#232a33' }  // 深石板灰蓝，白字
    },
    colorFallback: { bg: '#3c3a32', fg: '#f9f6f2', border: '#262420' },
    fx: {
      popDuration: 0.18,        // 合并产物"弹一下"时长（秒），建议 160~220ms
      popScale: 1.18,           // 弹入初始缩放
      shrinkDuration: 0.13,     // 被合并方块退出动画时长（秒），建议 120~140ms
      shrinkScale: 0.65,        // 退出动画最终缩放
      particleLife: 0.15,       // 粒子寿命（秒），建议 120~180ms
      particleBase: 6,          // 粒子数量基数（下限）
      particlePerLevel: 0.7,    // 每级合并等级（log2）增加的粒子数
      particleMax: 14,          // 粒子数量上限
      particleSpeed: 70,        // 粒子基础初速（px/秒）
      particleSpeedPerLevel: 12 // 每级合并等级增加的初速（px/秒）
    },
    // V14.1 数字变大模式：视觉与物理碰撞尺寸同步放大——
    // 合并产物按新数值重建更大刚体，"看着碰到就能合成、看着挡住就真挡住"。
    // 壳子（俄罗斯方块）内格子数值恒为 2~16（低于 startValue）且永不改变，
    // 因此壳内恒为基础尺寸，无需运行中缩放复合刚体。
    // 开关在主菜单，经典/挂机分别记忆；按 applyOnNextRound 规则下一局生效
    tileGrowth: {
      enabledByMode: {
        classic: false,         // 经典模式默认关闭
        idle: false             // 挂机模式默认关闭
      },
      startValue: 32,           // 从该数值开始变大（2/4/8/16 固定尺寸）
      step: 0.06,               // 每升一个数字等级增长的物理/视觉比例
      maxScale: 1.4,            // 放大上限（物理同步后不宜过大，防止场地拥挤）
      gap: 1.5,                 // 预留：相邻 Cell 物理安全间隙（当前壳内恒为基础尺寸，暂未用到）
      applyOnNextRound: true    // 开关在下一局生效，运行中的对局保持原尺寸模式
    }
  };
  root.U2048 = root.U2048 || {};
  root.U2048.CFG = CFG;

  // 统一取色入口：静态调色板优先，更大的数字动态生成专属配色。
  // 动态规则：按合成等级（log2）每级旋转色相 47°，深底白字保证对比度；
  // 纯函数生成 → 同一数值颜色永远稳定，不同数值颜色互不相同
  function tilePalette(value) {
    const c = CFG.colors[value];
    if (c) return c;

    const level = Math.max(1, Math.round(Math.log2(value || 2)));
    const hue = (level * 47) % 360;
    return {
      bg: 'hsl(' + hue + ', 42%, 34%)',
      fg: '#f7f5f0',
      border: 'hsl(' + hue + ', 42%, 24%)'
    };
  }
  root.U2048.tilePalette = tilePalette;
})(typeof window !== 'undefined' ? window : globalThis);
