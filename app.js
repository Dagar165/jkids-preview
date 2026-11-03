// JKids — поведение обеих страниц.
// Каждый блок — отдельная функция init…(). Она сама проверяет, есть ли её разметка на странице,
// поэтому один и тот же файл подключён и к index.html, и к parents.html.
(() => {
  'use strict';

  /* ── Общие помощники ── */
  const config = window.JKIDS_CONFIG || {};
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Ссылки из config.js пропускаем, только если это обычный адрес (или локальный файл при просмотре с компьютера).
  const safeUrl = (value) => {
    try {
      const url = new URL(value, location.href);
      return ['https:', 'http:', 'file:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
  };

  // Событие для аналитики: слушать можно через window 'jkids:event' или dataLayer, если он появится.
  const track = (name, data = {}) => {
    window.dispatchEvent(new CustomEvent('jkids:event', { detail: { name, ...data } }));
    if (Array.isArray(window.dataLayer)) window.dataLayer.push({ event: name, ...data });
  };

  /* ── UTM-метки: запоминаем на время сессии и прикладываем к заявке ── */
  const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  const UTM_STORAGE = 'jkids_utm';

  function readUtm() {
    const params = new URLSearchParams(location.search);
    let utm = {};
    try { utm = JSON.parse(sessionStorage.getItem(UTM_STORAGE) || '{}'); } catch {}
    for (const key of UTM_KEYS) if (params.has(key)) utm[key] = params.get(key).slice(0, 300);
    try { sessionStorage.setItem(UTM_STORAGE, JSON.stringify(utm)); } catch {}
    return utm;
  }

  /* ── Форма предзаписи (только на странице для родителей) ── */
  // Телефон → «+79131234567» или '' если номер не похож на настоящий.
  // Россия и Казахстан: +7 / 8 / без кода, после кода 10 цифр, первая — 3, 4, 7, 8 или 9.
  // Другие страны — только с «+» и кодом страны, 10–15 цифр.
  function normalizePhone(value) {
    const raw = value.trim();
    let digits = raw.replace(/\D/g, '');
    if (!raw.startsWith('+')) {
      if (digits.length === 11 && digits[0] === '8') digits = '7' + digits.slice(1);
      else if (digits.length === 10) digits = '7' + digits;
      else if (!(digits.length === 11 && digits[0] === '7')) return '';
    }
    if (digits[0] === '7') {
      if (digits.length !== 11 || !'34789'.includes(digits[1])) return '';
      if (/^(\d)\1+$/.test(digits.slice(1))) return ''; // 0000000000, 9999999999
      return '+' + digits;
    }
    return digits.length >= 10 && digits.length <= 15 ? '+' + digits : '';
  }

  // «+79131234567» → «+7 913 123-45-67»; номера других стран оставляем как есть
  const formatPhone = (phone) => (/^\+7\d{10}$/.test(phone)
    ? phone.replace(/^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/, '+7 $1 $2-$3-$4')
    : phone);

  // Ник в Telegram → «@nickname» или '' если так ник выглядеть не может (правила Telegram: 5–32 символа, латиница, цифры, «_»)
  function normalizeNick(value) {
    const nick = value.trim().replace(/^(https?:\/\/)?(t\.me|telegram\.me)\//i, '').replace(/^@/, '');
    return /^[A-Za-z][A-Za-z0-9_]{3,30}[A-Za-z0-9]$/.test(nick) ? '@' + nick : '';
  }

  // Коды ошибок из api/lead.php → понятный родителю текст
  const SERVER_ERRORS = {
    name: 'Напишите, как к вам обращаться.',
    phone: 'Проверьте номер телефона, например +7 913 123-45-67.',
    contact: 'Выберите, где вам удобнее общаться: Telegram, MAX или звонок.',
    telegram: 'Проверьте ник в Telegram или оставьте поле пустым.',
    email: 'Почтовый адрес не найден. Проверьте email или оставьте поле пустым.',
    age: 'Укажите, сколько лет ребёнку.',
    consent: 'Отметьте оба пункта под формой.',
  };

  function initForm(utm) {
    const form = $('#waitlist');
    if (!form) return;
    const status = $('#form-status');
    const submit = $('#submit-button');

    // Заявки принимает скрипт на нашем же сервере. Страница, открытая с диска (file:), ничего не отправляет:
    // кнопка только проверяет, правильно ли заполнены поля.
    const endpoint = config.formEndpoint && safeUrl(config.formEndpoint);
    const endpointReady = Boolean(endpoint) && location.protocol !== 'file:';
    if (!endpointReady) submit.textContent = 'Проверить форму →';

    // Поля «по условию»: data-show-when="contact=Telegram" — видно, только когда в поле contact выбрано Telegram.
    // Скрытое поле в заявку не попадает.
    const conditional = $$('[data-show-when]', form).map((el) => {
      const [field, value] = el.dataset.showWhen.split('=');
      return { el, field, value };
    });
    const updateConditional = () => {
      for (const { el, field, value } of conditional) {
        el.hidden = new FormData(form).get(field) !== value;
        // Скрытое поле отключаем: иначе оставшаяся на нём ошибка молча блокирует отправку
        $$('input,select,textarea', el).forEach((input) => { input.disabled = el.hidden; });
      }
    };
    form.addEventListener('change', updateConditional);
    form.addEventListener('reset', () => setTimeout(updateConditional)); // значения сбрасываются после события
    updateConditional();
    const visibleValue = (data, name) => {
      const input = form.elements[name];
      return input && !input.closest('[hidden]') ? String(data.get(name) || '').trim() : '';
    };

    // Проверки полей сверх встроенных в браузер. Те же правила повторяет api/lead.php.
    // Пустое необязательное поле проходит; сообщение показывает сам браузер у поля.
    const rules = {
      name: (v) => (/^[\p{L}][\p{L}\s'’-]*$/u.test(v) && v.replace(/[^\p{L}]/gu, '').length >= 2 ? '' : 'Напишите имя буквами, например Анна.'),
      phone: (v) => (normalizePhone(v) ? '' : 'Номер в формате +7 913 123-45-67. Номер другой страны — с «+» и кодом страны.'),
      telegram: (v) => (!v || normalizeNick(v) ? '' : 'Ник в Telegram: латиница, цифры и «_», от 5 символов, например @anna_ivanova.'),
      email: (v) => (!v || /^[^\s@]+@[^\s@]+\.[\p{L}]{2,}$/u.test(v) ? '' : 'Проверьте email, например name@yandex.ru.'),
      age_other: (v) => (/^\d{1,2}$/.test(v) && +v >= 3 && +v <= 18 ? '' : 'Напишите возраст числом, например 9.'),
    };
    const validate = () => {
      for (const [name, rule] of Object.entries(rules)) {
        const input = form.elements[name];
        if (!input) continue;
        input.setCustomValidity(input.closest('[hidden]') ? '' : rule(input.value.trim()));
      }
    };
    form.addEventListener('input', (e) => e.target.setCustomValidity?.('')); // ошибка уходит, как только человек начал исправлять
    form.noValidate = true; // браузер не проверяет форму сам до нашего validate() — проверяем всё разом в обработчике отправки
    form.elements.phone.addEventListener('blur', (e) => {
      const phone = normalizePhone(e.target.value);
      if (phone) e.target.value = formatPhone(phone);
    });

    const say = (text, ok = false, title = '') => {
      status.replaceChildren();
      status.classList.toggle('ok', ok);
      status.classList.toggle('error', Boolean(text) && !ok);
      status.setAttribute('role', ok ? 'status' : 'alert');
      status.setAttribute('aria-live', ok ? 'polite' : 'assertive');
      if (!text) return;
      const heading = document.createElement('strong');
      heading.textContent = title || (ok ? '✓ Заявка отправлена!' : 'Заявка не отправлена');
      const message = document.createElement('span');
      message.textContent = text;
      status.append(heading, message);
      status.setAttribute('tabindex', '-1');
      status.focus({ preventScroll: true });
      status.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
    };

    let started = false;
    form.addEventListener('focusin', () => {
      if (started) return;
      started = true;
      track('form_start');
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (form.dataset.submitted === 'true' || submit.disabled) return;
      validate();
      if (!form.reportValidity()) return;
      if (!endpointReady) {
        say('Поля заполнены правильно. Это просмотр с компьютера, поэтому заявка никуда не ушла — отправка работает только на сайте.', true, '✓ Проверка пройдена');
        return;
      }
      submit.disabled = true;
      submit.textContent = 'Отправляем…';
      say('');
      const data = new FormData(form);
      const ageOther = visibleValue(data, 'age_other');
      const payload = {
        name: String(data.get('name') || '').trim(),
        phone: normalizePhone(String(data.get('phone') || '')),
        contact: data.get('contact'),
        telegram: normalizeNick(visibleValue(data, 'telegram')),
        email: String(data.get('email') || '').trim(),
        age: ageOther ? `${data.get('age')}: ${Number(ageOther)}` : data.get('age'), // «09» → «9»
        parent: data.get('parent') === 'on',
        consent: data.get('consent') === 'on',
        website: data.get('website') || '', // поле-ловушка для ботов
        utm,
        page: location.origin + location.pathname
      };
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload)
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || !result || result.ok !== true) throw new Error(result?.error || 'request failed');
        track('prereg_submit_success', { ...utm });
        form.reset();
        form.dataset.submitted = 'true';
        form.closest('.form-card').classList.add('submitted');
        say('Контакты получены. Сергей свяжется с вами удобным для вас способом и расскажет детали набора.', true);
        location.replace(new URL('thanks.html', location.href).href);
      } catch (err) {
        say(SERVER_ERRORS[err.message] || 'Не удалось отправить заявку. Попробуйте ещё раз. Запись пока не подтверждена.');
      } finally {
        const sent = form.dataset.submitted === 'true';
        submit.disabled = sent;
        submit.textContent = sent ? 'Заявка принята ✓' : 'Попробовать ещё раз →';
      }
    });
  }

  function initCtaTracking() {
    $$('a[href="#signup"]').forEach((a) => a.addEventListener('click', () => track('prereg_cta_click')));
  }

  /* ── «Показать родителям»: делимся ссылкой на parents.html ──
     Телефон — системное меню «Поделиться». Компьютер — сразу копируем ссылку: меню Windows
     часто не открывается или пустое, и ребёнок не понимает, что произошло. */
  function initShareButtons() {
    const isTouch = matchMedia('(pointer: coarse)').matches;
    $$('.share').forEach((button) => button.addEventListener('click', async () => {
      const label = button.textContent;
      const flash = (text, ms) => {
        button.textContent = text;
        setTimeout(() => { button.textContent = label; }, ms);
      };
      const base = config.publicUrl ? safeUrl(config.publicUrl) : location.href;
      if (!base || base.startsWith('file:')) { flash('Ссылка появится после публикации', 3000); return; }
      const url = new URL('parents.html', base).href;
      if (navigator.share && isTouch) {
        try {
          await navigator.share({ title: 'JKids: хочу на эту программу', url });
          track('share_parent');
          return;
        } catch (err) {
          if (err.name === 'AbortError') return; // сам закрыл меню — ничего не делаем
        }
      }
      if (await copyText(url)) flash('Ссылка скопирована ✓', 2500);
      else location.href = url; // скопировать нельзя совсем — просто открываем страницу
      track('share_parent');
    }));
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard) { await navigator.clipboard.writeText(text); return true; }
    } catch {}
    // Старый браузер или сайт без https: копируем без всплывающих окон.
    const field = Object.assign(document.createElement('textarea'), { value: text, readOnly: true });
    field.style.cssText = 'position:fixed;opacity:0';
    document.body.append(field);
    field.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch {}
    field.remove();
    return copied;
  }

  /* ── Плашка внизу на телефоне: прячем на первом экране и там, где та же кнопка уже видна ── */
  function initSticky() {
    const sticky = $('#sticky');
    const visible = new Set();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target.id); else visible.delete(entry.target.id);
        if (entry.target.id === 'program' && entry.isIntersecting) track('program_view');
      }
      if (sticky) sticky.classList.toggle('hidden', ['start', 'signup', 'final'].some((id) => visible.has(id)));
    }, { threshold: 0.1 });
    for (const id of ['start', 'signup', 'program', 'final']) {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    }
  }

  /* ── Меню получает фон после прокрутки ── */
  function initNavBackground() {
    const nav = $('#nav');
    const update = () => nav.classList.toggle('scrolled', scrollY > 40);
    addEventListener('scroll', update, { passive: true });
    update();
  }

  /* ── Появление блоков при прокрутке ── */
  function initReveal() {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('in');
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    $$('.reveal').forEach((el) => observer.observe(el));
  }

  /* ── Карусель рендеров окружения: обложка есть в HTML, остальные кадры добавляем здесь ── */
  const BUNKER_RENDERS = [
    ['bunker-1', 'зал бункера с пультами, ящиками и синими воротами'],
    ['bunker-2', 'молот в подсвеченной витрине, на столе монитор'],
    ['bunker-4', 'стол у кирпичной стены и стенд на перфорированной панели'],
    ['bunker-5', 'стол на фоне синих ворот'],
    ['bunker-6', 'стол крупным планом'],
  ];

  function initCarousels() {
    $$('[data-carousel="bunker"]').forEach((box) => {
      const strip = $('.carousel-track', box);
      for (const [name, alt] of BUNKER_RENDERS) {
        const img = document.createElement('img');
        Object.assign(img, { src: `assets/bunker/${name}.webp`, width: 1600, height: 900, loading: 'lazy', alt: 'Рендер окружения курса: ' + alt });
        strip.append(img);
      }
      const total = strip.children.length;
      const count = Object.assign(document.createElement('span'), { className: 'carousel-count' });
      // Пока карусель не разложена (ширина 0), считаем, что открыт первый кадр — иначе выйдет «NaN / 6»
      const current = () => (strip.clientWidth ? Math.round(strip.scrollLeft / strip.clientWidth) : 0);
      const showCount = () => { count.textContent = `${current() + 1} / ${total}`; };
      const go = (step) => strip.scrollTo({ left: ((current() + step + total) % total) * strip.clientWidth, behavior: 'smooth' });
      for (const [cls, step, label, sign] of [['prev', -1, 'Предыдущий рендер', '←'], ['next', 1, 'Следующий рендер', '→']]) {
        const button = Object.assign(document.createElement('button'), { type: 'button', className: 'carousel-btn ' + cls, textContent: sign });
        button.setAttribute('aria-label', label);
        button.addEventListener('click', () => go(step));
        box.append(button);
      }
      box.append(count);
      strip.addEventListener('scroll', showCount, { passive: true });
      if ('ResizeObserver' in window) new ResizeObserver(showCount).observe(strip); // поворот экрана, догрузка стилей
      showCount();
    });
  }

  /* ── Просмотр картинки во весь экран ──
     Телефон: щипок — увеличить, палец — двигать, свайп — следующая, двойное касание — зум.
     Компьютер: колесо, стрелки, Esc. Фоновые картинки (.world) не открываются. */
  const ZOOMABLE = '.pipe-media img, .project-media img, .work img, .shot img, .teacher-shot img';
  const ZOOM_GROUP = '.carousel-track, .works, .reviews, .pipeline'; // внутри группы листаем стрелками
  const MAX_SCALE = 5;
  const SWIPE_PX = 60;
  const DOUBLE_TAP_MS = 320;

  function initLightbox() {
    const zoomables = $$(ZOOMABLE);
    if (!zoomables.length) return;

    const box = document.createElement('div');
    box.className = 'lightbox';
    box.hidden = true;
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Просмотр изображения');
    box.innerHTML = '<img alt=""><button type="button" class="lb-close" aria-label="Закрыть">✕</button>'
      + '<button type="button" class="lb-prev" aria-label="Предыдущее">←</button><button type="button" class="lb-next" aria-label="Следующее">→</button><span class="lb-count"></span>';
    document.body.append(box);
    const view = $('img', box);
    const counter = $('.lb-count', box);
    const closeButton = $('.lb-close', box);
    const prev = $('.lb-prev', box);
    const next = $('.lb-next', box);
    let group = [], index = 0, scale = 1, x = 0, y = 0;
    let returnFocus = null; // после закрытия фокус возвращается на картинку, с которой открыли

    const clampScale = (value) => Math.min(MAX_SCALE, Math.max(1, value));
    const apply = () => {
      const maxX = Math.max(0, (view.offsetWidth * scale - innerWidth) / 2 + 20);
      const maxY = Math.max(0, (view.offsetHeight * scale - innerHeight) / 2 + 20);
      x = Math.min(maxX, Math.max(-maxX, x));
      y = Math.min(maxY, Math.max(-maxY, y));
      view.style.transform = `translate(${x}px,${y}px) scale(${scale})`;
    };
    const reset = () => { scale = 1; x = 0; y = 0; apply(); };
    const show = (i) => {
      index = (i + group.length) % group.length;
      const source = group[index];
      view.src = source.currentSrc || source.src;
      view.alt = source.alt;
      view.classList.toggle('small', source.naturalWidth > 0 && source.naturalWidth < 700); // скриншоты отзывов — на белой подложке
      counter.textContent = group.length > 1 ? `${index + 1} / ${group.length}` : '';
      prev.hidden = next.hidden = group.length < 2;
      reset();
    };
    const open = (img) => {
      const scope = img.closest(ZOOM_GROUP) || img.parentElement;
      group = $$('img', scope);
      returnFocus = img;
      box.hidden = false;
      document.documentElement.style.overflow = 'hidden';
      show(group.indexOf(img));
      closeButton.focus();
    };
    const close = () => {
      box.hidden = true;
      document.documentElement.style.overflow = '';
      view.removeAttribute('src');
      returnFocus?.focus();
    };

    for (const img of zoomables) {
      img.classList.add('zoomable');
      img.tabIndex = 0; // открывается и с клавиатуры
      img.addEventListener('click', () => open(img));
      img.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        open(img);
      });
    }

    closeButton.addEventListener('click', close);
    prev.addEventListener('click', () => show(index - 1));
    next.addEventListener('click', () => show(index + 1));
    addEventListener('keydown', (e) => {
      if (box.hidden) return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') show(index - 1);
      if (e.key === 'ArrowRight') show(index + 1);
      if (e.key === 'Tab') { // фокус не уходит со страницы под окном
        const buttons = $$('button', box).filter((b) => !b.hidden && b.offsetParent);
        const at = buttons.indexOf(document.activeElement);
        e.preventDefault();
        buttons[(at + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
      }
    });
    box.addEventListener('wheel', (e) => {
      e.preventDefault();
      scale = clampScale(scale * (e.deltaY < 0 ? 1.2 : 1 / 1.2));
      if (scale === 1) { x = 0; y = 0; }
      apply();
    }, { passive: false });

    // Жесты пальцами и мышью
    const pointers = new Map();
    let start = null, lastTap = 0;
    const spread = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };

    box.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      box.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      start = { x, y, scale, px: e.clientX, py: e.clientY, dist: pointers.size === 2 ? spread() : 0, moved: false, onImage: e.target === view };
    });
    box.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId) || !start) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2 && start.dist) { // щипок
        scale = clampScale(start.scale * spread() / start.dist);
        start.moved = true;
      } else if (pointers.size === 1) { // сдвиг увеличенной картинки или свайп
        const dx = e.clientX - start.px, dy = e.clientY - start.py;
        if (Math.abs(dx) + Math.abs(dy) > 8) start.moved = true;
        if (scale > 1) { x = start.x + dx; y = start.y + dy; } else { x = dx; y = 0; }
      }
      apply();
    });
    const release = (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (pointers.size || !start) {
        // из щипка остался один палец — продолжаем двигать от его положения
        if (pointers.size === 1) { const p = [...pointers.values()][0]; start = { ...start, x, y, scale, px: p.x, py: p.y, dist: 0 }; }
        return;
      }
      const dx = e.clientX - start.px;
      if (scale === 1) {
        if (start.moved && Math.abs(dx) > SWIPE_PX && group.length > 1) show(index + (dx < 0 ? 1 : -1));
        else if (!start.moved && !start.onImage) close(); // касание по фону закрывает
        else { x = 0; apply(); }
      }
      if (!start.moved && start.onImage) { // двойное касание — увеличить или вернуть
        const now = Date.now();
        if (now - lastTap < DOUBLE_TAP_MS) {
          if (scale > 1) reset(); else { scale = 2.5; apply(); }
          lastTap = 0;
        } else lastTap = now;
      }
      start = null;
    };
    box.addEventListener('pointerup', release);
    box.addEventListener('pointercancel', release);
  }

  /* ── Соцсети педагога из config.js ── */
  function initSocials() {
    const links = [['YouTube', config.youtube], ['Telegram', config.telegram], ['ВКонтакте', config.vk]]
      .map(([label, url]) => [label, url && safeUrl(url)])
      .filter(([, url]) => url && url.startsWith('https:'));
    if (!links.length) return;
    $$('[data-socials]').forEach((box) => {
      for (const [label, url] of links) {
        box.append(Object.assign(document.createElement('a'), { href: url, target: '_blank', rel: 'noopener', textContent: label + ' ↗' }));
      }
      box.hidden = false;
    });
  }

  /* ── Прямой контакт из config.js ── */
  function initContacts() {
    const telegram = config.contactTelegram && safeUrl(config.contactTelegram);
    const nick = telegram && new URL(telegram).pathname.replace(/^\/+/, '');
    const email = config.contactEmail && /^[^\s@]+@[^\s@]+$/.test(config.contactEmail) ? config.contactEmail : '';
    const links = [
      telegram && ['Telegram' + (nick ? ' @' + nick : ''), telegram, true],
      email && [email, 'mailto:' + email, false],
    ].filter(Boolean);
    $$('[data-contacts]').forEach((box) => {
      links.forEach(([label, href, external], i) => {
        if (i && box.classList.contains('footer-contacts')) box.append(' · ');
        const a = Object.assign(document.createElement('a'), { href, textContent: label });
        if (external) Object.assign(a, { target: '_blank', rel: 'noopener' });
        box.append(a);
      });
      if (!links.length) box.closest('.ask')?.remove(); // нечего показать — блок не нужен
    });
  }

  /* ── Настоящие видео и фото из config.js ── */
  function createVideo(path, poster, className) {
    const url = path && safeUrl(path);
    if (!url) return null;
    const video = document.createElement('video');
    Object.assign(video, { src: url, poster, controls: true, muted: true, playsInline: true, preload: 'none', className });
    return video;
  }

  const canAutoplay = () => 'IntersectionObserver' in window && !prefersReducedMotion();

  // Видео играет, только пока его видно; файл начинает грузиться при первом появлении на экране
  function playWhenVisible(video) {
    new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) { video.pause(); return; }
      if (video.dataset.src && !video.getAttribute('src')) video.src = video.dataset.src;
      video.play().catch(() => { video.controls = true; });
    }, { threshold: 0.25 }).observe(video);
  }

  function initMedia() {
    // Запись из Blender заменяет рендер молота
    const blenderBox = $('#blender-media');
    const blenderVideo = blenderBox && createVideo(config.blenderVideo, 'assets/real-hammer.webp', '');
    if (blenderVideo) blenderBox.replaceChildren(blenderVideo);

    // Ролик из игры крутится как гифка: без звука, по кругу, и грузится только когда до него долистали
    const gameplayBox = $('#gameplay-media');
    const gameplayVideo = gameplayBox && createVideo(config.gameplayVideo, 'assets/gameplay-poster.webp', 'hero-video');
    if (gameplayVideo) {
      gameplayBox.append(gameplayVideo);
      if (canAutoplay()) {
        Object.assign(gameplayVideo, { controls: false, loop: true });
        gameplayVideo.setAttribute('aria-label', 'Персонаж бежит по бункеру в Roblox и берёт молот');
        playWhenVisible(gameplayVideo);
      }
    }

    // Ролики из разметки с data-play-visible: адрес лежит в data-src и подставляется при первом показе
    $$('video[data-play-visible]').forEach((video) => {
      if (canAutoplay()) playWhenVisible(video);
    });

    const person = $('#teacher-person');
    const photoUrl = config.teacherPhoto && safeUrl(config.teacherPhoto);
    if (person && photoUrl) {
      person.prepend(Object.assign(document.createElement('img'), { src: photoUrl, alt: 'Сергей Фенчин', className: 'teacher-photo', loading: 'lazy' }));
    }
  }

  /* ── Запуск ── */
  const utm = readUtm();
  initForm(utm);
  initCtaTracking();
  initShareButtons();
  initSticky();
  initNavBackground();
  initReveal();
  initCarousels();
  initLightbox();
  initSocials();
  initContacts();
  initMedia();
})();
