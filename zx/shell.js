/* ============================================================
 * ZXShell · 统一界面骨架（顶栏 + 侧导航 + 移动端底部标签栏）
 * 无依赖，各系统用一份配置接入：
 *
 * ZXShell.init({
 *   brand:   { name: '泽曦书画', logo: 'logo.svg' | null },
 *   systems: [{ id, name, domain, color, url }],        // 系统切换器
 *   currentSystem: 'yj',
 *   nav: [{ group: '登记', items: [{ id, icon, label, href|onClick, badge, roles }] }],
 *   tabbar: ['workbench','records','audit','finance','logs'], // 移动端 ≤5 项（可选，默认取各组首项凑满5个）
 *   user: { name, role, roleType: 'admin'|'master'|'teacher' },
 *   notices: 3,
 *   activeNav: 'workbench'
 * })
 * 角色显隐：nav item 上 roles 缺省=全部可见；否则按 user.roleType 过滤。
 * ============================================================ */
(function () {
  'use strict';

  /* ---- 内联 SVG 图标库（线性、墨色，贴合纸墨气质） ---- */
  const I = (p) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="display:block">${p}</svg>`;
  const ICONS = {
    home: I('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-6h6v6"/>'),
    clock: I('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    coins: I('<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>'),
    box: I('<path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/>'),
    audit: I('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="m9 12 2 2 4-4"/>'),
    chart: I('<path d="M4 20V4"/><path d="M4 20h16"/><path d="M8 16v-5M12 16V8M16 16v-3"/>'),
    calendar: I('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>'),
    users: I('<circle cx="9" cy="8" r="3.5"/><path d="M3.5 20c.5-3.5 2.8-5.5 5.5-5.5S14 16.5 14.5 20"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.7c2.6.2 4.5 2 5 5.3"/>'),
    settings: I('<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.14-1.4l2-1.55-2-3.46-2.35.95A7 7 0 0 0 14.1 5L13.8 2.5h-3.6L9.9 5a7 7 0 0 0-2.42 1.4l-2.35-.94-2 3.46 2 1.55a7 7 0 0 0 0 2.8l-2 1.55 2 3.46 2.35-.95a7 7 0 0 0 2.42 1.4l.3 2.55h3.6l.3-2.5a7 7 0 0 0 2.42-1.42l2.35.95 2-3.46-2-1.55c.09-.45.14-.92.14-1.4Z"/>'),
    log: I('<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>'),
    scan: I('<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M4 12h16"/>'),
    ticket: I('<path d="M4 7h16v4a2 2 0 0 0 0 6v4H4v-4a2 2 0 0 0 0-6V7Z"/><path d="M14 7v14" stroke-dasharray="2.5 3"/>'),
    report: I('<path d="M6 3h9l4 4v14H6V3Z"/><path d="M14 3v5h5"/><path d="M9 13h7M9 17h7"/>'),
    bell: I('<path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 19a2 2 0 0 0 4 0"/>'),
    logout: I('<path d="M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5"/><path d="m10 8-4 4 4 4"/><path d="M6 12h10"/>'),
    phone: I('<path d="M5 4h4l1.5 5L8 10.5a12 12 0 0 0 5.5 5.5L15 13.5l5 1.5v4a1.5 1.5 0 0 1-1.6 1.5C10 20 4 14 3.5 5.6A1.5 1.5 0 0 1 5 4Z"/>'),
    plus: I('<path d="M12 5v14M5 12h14"/>'),
    more: I('<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>'),
    card: I('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/>'),
    teacher: I('<path d="M3 9.5 12 5l9 4.5-9 4.5-9-4.5Z"/><path d="M7 11.5V16c0 1.5 2.2 3 5 3s5-1.5 5-3v-4.5"/>'),
    asset: I('<rect x="4" y="7" width="16" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M4 12h16"/>'),
    me: I('<circle cx="12" cy="8" r="4"/><path d="M5 20c.8-3.8 3.6-6 7-6s6.2 2.2 7 6"/>'),
  };

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function icon(name) { return ICONS[name] || ICONS.more; }

  function visibleItems(cfg) {
    const role = cfg.user && cfg.user.roleType;
    return cfg.nav.map((g) => ({
      group: g.group,
      items: g.items.filter((it) => !it.roles || !role || it.roles.includes(role)),
    })).filter((g) => g.items.length);
  }

  /** 用户头像（圆形）：有头像图则显示图片，失败回退到名字首字 */
  function avatarHtml(user) {
    const style = `background:var(--zx-role-${esc(user.roleType || 'admin')}, var(--zx-seal))`;
    const img = user.avatarUrl
      ? `<img src="${esc(user.avatarUrl)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
      : '';
    return `<span class="zx-user__avatar" style="${style}">${img}<span class="zx-user__avatar-txt">${esc((user.name || '?')[0])}</span></span>`;
  }

  function renderTopbar(cfg) {
    const bar = document.createElement('header');
    bar.className = 'zx-topbar';
    const cur = (cfg.systems || []).find((s) => s.id === cfg.currentSystem);
    bar.innerHTML = `
      <a class="zx-topbar__brand" href="#">${cfg.brand.logo ? `<img src="${esc(cfg.brand.logo)}" alt="">` : ''}<span>${esc(cfg.brand.name)}</span></a>
      <span class="zx-topbar__spacer"></span>
      ${cfg.systems ? `
      <div class="zx-sys-switch" id="zxSysSwitch">
        <button class="zx-sys-switch__btn" type="button" aria-haspopup="true">
          ${cur ? `<span class="zx-sys-dot" style="background:${esc(cur.color)}"></span>` : ''}
          <span>${esc(cur ? cur.name : '选择系统')}</span><span class="zx-caret">▾</span>
        </button>
        <div class="zx-sys-switch__menu" role="menu">
          ${cfg.systems.map((s) => `
            <a class="zx-sys-switch__item ${s.id === cfg.currentSystem ? 'is-current' : ''}" href="${esc(s.url || '#')}">
              <span class="zx-sys-dot" style="background:${esc(s.color)}"></span>
              <span>${esc(s.name)}</span><small>${esc(s.domain || '')}</small>
            </a>`).join('')}
        </div>
      </div>` : ''}
      <button class="zx-icon-btn" type="button" aria-label="通知">${icon('bell')}${cfg.notices ? `<span class="zx-icon-btn__badge">${cfg.notices}</span>` : ''}</button>
      <button class="zx-user" type="button"${cfg.user.href ? ` onclick="location.hash='${esc(cfg.user.href)}'"` : ''}>
        ${avatarHtml(cfg.user)}
        <span class="zx-user__name">${esc(cfg.user.name)}</span>
        <span class="zx-user__role">· ${esc(cfg.user.role)}</span>
      </button>`;
    return bar;
  }

  function renderSidebar(cfg, groups) {
    const aside = document.createElement('aside');
    aside.className = 'zx-sidebar';
    aside.innerHTML = groups.map((g) => `
      <nav class="zx-nav-group">
        ${g.group ? `<div class="zx-nav-group__label">${esc(g.group)}</div>` : ''}
        ${g.items.map((it) => `
          <a class="zx-nav-item ${it.id === cfg.activeNav ? 'is-active' : ''}" href="${esc(it.href || '#')}" data-nav="${esc(it.id)}">
            <span class="zx-nav-item__icon">${icon(it.icon)}</span>
            <span>${esc(it.label)}</span>
            ${it.badge ? `<span class="zx-nav-item__badge">${esc(it.badge)}</span>` : ''}
          </a>`).join('')}
      </nav>`).join('') + `
      <div class="zx-sidebar__user">
        ${avatarHtml(cfg.user)}
        <span><span class="zx-sidebar__user-name">${esc(cfg.user.name)}</span><br><span class="zx-sidebar__user-role">${esc(cfg.user.role)}</span></span>
        <button class="zx-sidebar__logout" type="button" title="退出登录" data-zx-logout>${icon('logout')}</button>
      </div>`;
    return aside;
  }

  function renderTabbar(cfg, groups) {
    const bar = document.createElement('nav');
    bar.className = 'zx-tabbar';
    const all = groups.flatMap((g) => g.items);
    let picks = cfg.tabbar
      ? cfg.tabbar.map((id) => all.find((i) => i.id === id)).filter(Boolean)
      : groups.map((g) => g.items[0]).filter(Boolean).slice(0, 5);
    picks = picks.slice(0, 5);
    bar.innerHTML = picks.map((it) => `
      <a class="zx-tabbar__item ${it.id === cfg.activeNav ? 'is-active' : ''}" href="${esc(it.href || '#')}" data-nav="${esc(it.id)}">
        <span class="zx-tabbar__icon">${icon(it.icon)}${it.badge ? `<span class="zx-tabbar__badge">${esc(it.badge)}</span>` : ''}</span>
        <span>${esc(it.label)}</span>
      </a>`).join('');
    return bar;
  }

  const ZXShell = {
    init(cfg) {
      const groups = visibleItems(cfg);
      const frag = document.createDocumentFragment();
      frag.appendChild(renderTopbar(cfg));
      const sidebar = renderSidebar(cfg, groups);
      frag.appendChild(sidebar);
      frag.appendChild(renderTabbar(cfg, groups));

      const main = document.createElement('div');
      main.className = 'zx-main';
      // 已有内容搬进 zx-main > zx-page
      const page = document.createElement('div');
      page.className = 'zx-page';
      while (document.body.firstChild) page.appendChild(document.body.firstChild);
      main.appendChild(page);
      frag.appendChild(main);
      document.body.appendChild(frag);
      document.body.style.margin = '0';

      // 系统切换器开合
      const sw = document.getElementById('zxSysSwitch');
      if (sw) {
        sw.querySelector('.zx-sys-switch__btn').addEventListener('click', (e) => {
          e.stopPropagation();
          sw.classList.toggle('zx-sys-switch--open');
        });
        document.addEventListener('click', () => sw.classList.remove('zx-sys-switch--open'));
      }

      // 导航回调
      document.querySelectorAll('[data-nav]').forEach((a) => {
        a.addEventListener('click', (e) => {
          const id = a.getAttribute('data-nav');
          if (cfg.onNavigate && cfg.onNavigate(id, a) === false) e.preventDefault();
        });
      });
      const out = document.querySelector('[data-zx-logout]');
      if (out && cfg.onLogout) out.addEventListener('click', cfg.onLogout);

      return { sidebar, main };
    },

    /* 更新顶栏/侧栏用户信息（头像、姓名、角色） */
    setUser(user) {
      const name = user && user.name ? user.name : '?';
      const roleType = (user && user.roleType) || 'admin';
      const style = `background:var(--zx-role-${roleType}, var(--zx-seal))`;
      const img = user && user.avatarUrl
        ? `<img src="${esc(user.avatarUrl)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
        : '';
      const html = `<span class="zx-user__avatar" style="${style}">${img}<span class="zx-user__avatar-txt">${esc(name[0])}</span></span>`;
      document.querySelectorAll('.zx-topbar .zx-user__avatar, .zx-sidebar__user .zx-user__avatar').forEach((el) => {
        el.outerHTML = html;
      });
      const nm = document.querySelector('.zx-topbar .zx-user__name');
      if (nm && user) nm.textContent = name;
      const rl = document.querySelector('.zx-topbar .zx-user__role');
      if (rl && user && user.role) rl.textContent = '· ' + user.role;
    },

    /* 徽标动态更新 */
    setBadge(navId, n) {
      document.querySelectorAll(`[data-nav="${navId}"] .zx-nav-item__badge, [data-nav="${navId}"] .zx-tabbar__badge`).forEach((b) => {
        b.textContent = n;
        b.style.display = n ? '' : 'none';
      });
    },
  };

  ZXShell.icons = ICONS;
  ZXShell.icon = icon;
  window.ZXShell = ZXShell;
})();
