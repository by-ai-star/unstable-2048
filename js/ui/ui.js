(function (root) {
  'use strict';
  const U = root.U2048;

  // DOM UI 层：菜单 / HUD / 暂停 / 结算，只通过 bus 与 Game 交互
  function initUI(game) {
    const $ = id => document.getElementById(id);
    const menu = $('menu'), hud = $('hud'), pauseOverlay = $('pause-overlay'), overOverlay = $('gameover');
    const scoreEl = $('score'), bestEl = $('best'), maxEl = $('max-tile');
    const overScore = $('over-score'), overBest = $('over-best'), overMax = $('over-max-tile');
    const menuBest = $('menu-best');

    function refreshScore(s) {
      scoreEl.textContent = s.score;
      bestEl.textContent = s.best;
      // V14.2：与历史记录同源——本局生成过的最大数字（含生成值与合成值）
      maxEl.textContent = game.roundMaxTile || 2;
    }
    game.bus.on('score', refreshScore);

    game.bus.on('state', g => {
      menu.classList.toggle('hidden', g.state !== 'menu');
      hud.classList.toggle('hidden', g.state === 'menu');
      pauseOverlay.classList.toggle('hidden', g.state !== 'paused');
      overOverlay.classList.toggle('hidden', g.state !== 'over');
      if (g.state === 'menu') {
        menuBest.textContent = g.score.best;
      }
      if (g.state === 'over') {
        overScore.textContent = g.score.score;
        overBest.textContent = g.score.best;
        overMax.textContent = g.roundMaxTile || 2;
      }
    });

    $('btn-classic').addEventListener('click', () => game.start('classic'));
    $('btn-idle').addEventListener('click', () => game.start('idle'));
    $('btn-pause').addEventListener('click', () => game.pause());
    $('btn-resume').addEventListener('click', () => game.resume());
    $('btn-quit-pause').addEventListener('click', () => game.toMenu());
    $('btn-restart').addEventListener('click', () => game.start(game.mode || 'classic'));
    $('btn-to-menu').addEventListener('click', () => game.toMenu());
  }

  U.initUI = initUI;
})(typeof window !== 'undefined' ? window : globalThis);
