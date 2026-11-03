// JKids — Яндекс Метрика. Включается, только когда в config.js указан номер счётчика (metrikaId).
// app.js ничего не знает о Метрике: он шлёт события 'jkids:event', а этот файл передаёт их в Метрику как цели.
// Вебвизор выключен намеренно: он записывает ввод в поля формы, то есть телефоны родителей.
(() => {
  'use strict';
  const config = window.JKIDS_CONFIG || {};
  const id = Number(config.metrikaId);
  // Счётчик не настроен или сайт открыт с диска — ничего не делаем
  if (!id || location.protocol === 'file:') return;

  /* ── Код счётчика (официальный, из кабинета Метрики) ── */
  (function (m, e, t, r, i, k, a) {
    m[i] = m[i] || function () { (m[i].a = m[i].a || []).push(arguments); };
    m[i].l = 1 * new Date();
    for (let j = 0; j < document.scripts.length; j++) { if (document.scripts[j].src === r) return; }
    k = e.createElement(t); a = e.getElementsByTagName(t)[0]; k.async = 1; k.src = r; a.parentNode.insertBefore(k, a);
  })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js?id=' + id, 'ym');
  window.ym(id, 'init', { ssr: true, clickmap: true, trackLinks: true, accurateTrackBounce: true, referrer: document.referrer, url: location.href, webvisor: false });

  /* ── События сайта → цели Метрики (тип цели в кабинете: «JavaScript-событие», идентификатор = имя события) ── */
  window.addEventListener('jkids:event', (e) => {
    const { name, ...params } = e.detail || {};
    if (name) window.ym(id, 'reachGoal', name, params);
  });

  /* ── Уведомление о cookie: показываем один раз, пока посетитель не нажмёт «Понятно» ── */
  const SEEN = 'jkids_cookie_notice';
  try { if (localStorage.getItem(SEEN)) return; } catch {}

  // Компьютер: компактная плашка справа внизу. Телефон: во всю ширину над плашкой «Забронировать».
  const style = document.createElement('style');
  style.textContent = '.cookie-note{position:fixed;z-index:60;right:16px;bottom:16px;max-width:420px;display:flex;align-items:center;gap:12px;padding:10px 10px 10px 14px;border:1px solid #a78aff55;border-radius:14px;background:#0e1128f2;color:#e4def8;font:12px/1.4 Onest,Arial,sans-serif;box-shadow:0 8px 30px #0008}'
    + '.cookie-note[hidden]{display:none}'
    + '.cookie-note a{color:#ffb52d;text-decoration:underline}'
    + '.cookie-note button{flex:0 0 auto;min-height:34px;padding:0 14px;border:0;border-radius:10px;background:#ffb52d;color:#16111f;font:700 13px/1 Onest,Arial,sans-serif;cursor:pointer}'
    + '.cookie-note button:focus-visible{outline:3px solid #fff;outline-offset:3px}'
    + '@media(max-width:820px){.cookie-note{left:10px;right:10px;bottom:84px;max-width:none;gap:14px;padding:14px 14px 14px 18px;border-radius:18px;font-size:13px;line-height:1.45}'
    + '.cookie-note button{min-height:40px;padding:0 16px;border-radius:12px;font-size:14px}'
    + '.cookie-note.no-sticky{bottom:10px}}'; // над плашкой «Забронировать»; где её нет (страница «спасибо») — у самого края
  document.head.append(style);

  const note = document.createElement('div');
  note.className = document.getElementById('sticky') ? 'cookie-note' : 'cookie-note no-sticky';
  note.setAttribute('role', 'region');
  note.setAttribute('aria-label', 'Уведомление о cookie');
  note.innerHTML = '<span>Сайт использует cookie и Яндекс Метрику, чтобы понимать, какие страницы полезны. Подробнее — в <a href="privacy.html">политике</a>.</span><button type="button">Понятно</button>';
  note.querySelector('button').addEventListener('click', () => {
    try { localStorage.setItem(SEEN, '1'); } catch {}
    note.remove();
  });
  document.body.append(note);

  // На компьютере в нижних углах первого экрана стоят кнопки — пока первый экран виден, плашку прячем.
  // Следим постоянно: посетитель может вернуться наверх или повернуть планшет.
  const hero = document.getElementById('start');
  if (hero && 'IntersectionObserver' in window) {
    const desktop = matchMedia('(min-width:821px)');
    let heroVisible = true;
    const update = () => { note.hidden = desktop.matches && heroVisible; };
    new IntersectionObserver(([entry]) => { heroVisible = entry.isIntersecting; update(); }).observe(hero);
    desktop.addEventListener?.('change', update);
    update();
  }
})();
