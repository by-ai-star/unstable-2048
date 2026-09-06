(function (root) {
  'use strict';
  const U = root.U2048;

  // 挂机倍速分段按钮：只在挂机模式（非菜单/非结算）可见，高亮当前档位
  function bindIdleSpeedControl(game) {
    const control = document.getElementById('idle-speed-control');
    if (!control) return;

    const buttons = Array.from(
      control.querySelectorAll('[data-idle-speed]')
    );

    function render() {
      const visible =
        game.mode === 'idle' &&
        game.state !== 'menu' &&
        game.state !== 'over';

      control.classList.toggle('hidden', !visible);

      for (const button of buttons) {
        const speed = Number(button.dataset.idleSpeed);
        const active = speed === game.idleSpeed;

        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
        button.disabled = !visible;
      }
    }

    for (const button of buttons) {
      button.addEventListener('click', event => {
        event.preventDefault();

        const speed = Number(button.dataset.idleSpeed);
        game.setIdleSpeed(speed);
      });
    }

    game.bus.on('state', render);
    game.bus.on('idleSpeed', render);

    render();
  }

  // 注册 Service Worker（PWA 离线缓存）。
  // 仅在 https 或 localhost 环境生效；本地 file:// 直接打开会静默跳过
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('./sw.js')
      .catch(error => {
        console.warn('Service Worker registration failed:', error);
      });
  }

  // V14 数字变大模式开关：经典/挂机各一个，状态由 Game 持久化
  function bindTileGrowthSettings(game) {
    const classicToggle = document.getElementById('classic-growth-toggle');
    const idleToggle = document.getElementById('idle-growth-toggle');

    if (!classicToggle || !idleToggle) return;

    classicToggle.checked = !!game.tileGrowthEnabled.classic;
    idleToggle.checked = !!game.tileGrowthEnabled.idle;

    classicToggle.addEventListener('change', () => {
      game.setTileGrowthEnabled('classic', classicToggle.checked);
    });

    idleToggle.addEventListener('change', () => {
      game.setTileGrowthEnabled('idle', idleToggle.checked);
    });
  }

  // V14.2 最大合成数字下拉框（首页选择，下一局生效）
  function bindMergeCapSetting(game) {
    const select = document.getElementById('merge-cap-select');
    if (!select) return;

    function render() {
      select.value = game.selectedMergeCap === null
        ? 'infinite'
        : String(game.selectedMergeCap);
    }

    select.addEventListener('change', () => {
      game.setSelectedMergeCap(
        select.value === 'infinite' ? null : Number(select.value)
      );
    });
    game.bus.on('mergeCapChanged', render);
    render();
  }

  // V14.2 历史战绩面板：经典/挂机两个页签，各显示最近 20 局
  function bindHistoryPanel(game) {
    const overlay = document.getElementById('history-overlay');
    const listEl = document.getElementById('history-list');
    const tabs = {
      classic: document.getElementById('hist-tab-classic'),
      idle: document.getElementById('hist-tab-idle')
    };
    if (!overlay || !listEl || !tabs.classic || !tabs.idle) return;

    let activeMode = 'classic';

    function formatTime(ms) {
      const d = new Date(ms);
      const pad = n => String(n).padStart(2, '0');
      return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
        pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    function render() {
      tabs.classic.classList.toggle('active', activeMode === 'classic');
      tabs.idle.classList.toggle('active', activeMode === 'idle');

      const records = game.history.get(activeMode);
      if (!records.length) {
        listEl.innerHTML = '<p class="history-empty">暂无记录，去打一局吧</p>';
        return;
      }

      listEl.innerHTML = records.map(r => {
        const cap = r.mergeCap === null ? '无限' : r.mergeCap;
        return '<div class="history-item">' +
          '<div class="h-time">' + formatTime(r.endedAt) + '</div>' +
          '<div class="h-main"><span>总分 ' + r.score + '</span>' +
          '<span>最大 ' + r.maxTile + '</span></div>' +
          '<div class="h-cap">合成上限 ' + cap + '</div>' +
          '</div>';
      }).join('');
    }

    tabs.classic.addEventListener('click', () => { activeMode = 'classic'; render(); });
    tabs.idle.addEventListener('click', () => { activeMode = 'idle'; render(); });

    document.getElementById('btn-history').addEventListener('click', () => {
      overlay.classList.remove('hidden');
      render();
    });
    document.getElementById('btn-history-close').addEventListener('click', () => {
      overlay.classList.add('hidden');
    });
    document.getElementById('btn-history-clear').addEventListener('click', () => {
      const modeName = activeMode === 'classic' ? '经典模式' : '挂机模式';
      if (root.confirm('确定清空「' + modeName + '」的全部历史记录吗？')) {
        game.history.clear(activeMode);
        render();
      }
    });

    game.bus.on('historyChanged', render);
  }

  function boot() {
    const canvas = document.getElementById('game-canvas');
    const game = new U.Game();
    const renderer = new U.Renderer(canvas, game);
    new U.InputSystem(canvas, game);
    U.initUI(game);
    bindIdleSpeedControl(game);
    bindTileGrowthSettings(game);
    bindMergeCapSetting(game);
    bindHistoryPanel(game);

    // 竖屏适配：画布等比缩放至视口
    const CFG_WORLD = U.CFG.world;
    function resize() {
      const vw = root.innerWidth, vh = root.innerHeight;
      const scale = Math.min(vw / CFG_WORLD.width, vh / CFG_WORLD.height);
      canvas.style.width = (CFG_WORLD.width * scale) + 'px';
      canvas.style.height = (CFG_WORLD.height * scale) + 'px';
    }
    root.addEventListener('resize', resize);
    resize();

    // 主循环
    let last = performance.now();
    function frame(now) {
      const dt = Math.min(100, now - last);
      last = now;
      game.update(dt);
      if (game.state !== 'menu') renderer.draw();
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    // 阻止页面滚动/双指缩放
    document.body.addEventListener('touchmove', e => e.preventDefault(), { passive: false });

    root.__game = game; // 调试/测试句柄
    registerServiceWorker();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : globalThis);
