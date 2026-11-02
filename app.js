/* SSO_TOKEN_CATCH：接收工作台「切换系统」跳转携带的令牌，写入本地登录态 */
try { const _ssoTk = new URLSearchParams(location.search).get('tk'); if (_ssoTk) { localStorage.setItem('zb_token', _ssoTk); history.replaceState(null, '', location.pathname + (location.hash || '')); } } catch (_) {}
/* ============================================================
   教培机构 · 券类管理系统 — 应用主逻辑
   角色：老师（核销） / 管理员=教务运营（全部） / 家长（只读查询）
   所有写操作通过 SECURITY DEFINER 安全函数收口，前端无法直接改账
   ============================================================ */
(() => {
  'use strict'

  const $app = document.getElementById('app')
  const cloud = WorkBuddyCloud.createWorkBuddyCloud({
    endpoint: PUBLIC_CONFIG.endpoint,
    app: PUBLIC_CONFIG.app,
  })

  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const CAMPUS = ['城东校区', '城西校区', '海东', '麻章', '开发区']

  /* ==================== 全局状态 ==================== */
  const state = {
    user: null,      // 登录用户
    staff: null,     // 员工档案（含角色）
    now: null,       // 服务器时间 { dateStr, dow, mins, timeStr }
    timers: [],      // 页面级定时器
    showInactive: false, // 班级列表是否显示已停用
  }

  /* ==================== 工具 ==================== */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
  const fmtMoney = (n) => {
    const v = Number(n ?? 0)
    return '¥' + (Number.isInteger(v) ? v : v.toFixed(2))
  }
  const toMins = (t) => { const m = /^(\d{2}):(\d{2})/.exec(String(t)); return m ? (+m[1]) * 60 + (+m[2]) : 0 }
  const fmtDT = (iso) => {
    if (!iso) return ''
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(iso))
    return m ? `${m[2]}-${m[3]} ${m[4]}:${m[5]}` : String(iso).slice(0, 16)
  }
  const fmtDate = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? `${m[1]}年${+m[2]}月${+m[3]}日` : (d || '') }
  const avatarColor = (id) => 'c' + ((Number(id) || 0) % 4 + 1)

  /* ---------- Toast ---------- */
  let toastRoot = null
  function toast(msg, type) {
    if (!toastRoot) { toastRoot = document.createElement('div'); toastRoot.id = 'toast-root'; document.body.appendChild(toastRoot) }
    const el = document.createElement('div')
    el.className = 'toast' + (type ? ' ' + type : '')
    el.textContent = msg
    toastRoot.appendChild(el)
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320) }, 2600)
  }

  /* ---------- 底部弹层 ---------- */
  function openSheet(html) {
    const mask = document.createElement('div')
    mask.className = 'sheet-mask'
    mask.innerHTML = `<div class="sheet"><div class="sheet-grip"></div>${html}</div>`
    document.body.appendChild(mask)
    const close = () => { mask.remove() }
    mask.addEventListener('click', (e) => { if (e.target === mask) close() })
    return { el: mask.querySelector('.sheet'), close }
  }

  function confirmSheet({ title, body, okText = '确认', danger = false }) {
    return new Promise((resolve) => {
      const s = openSheet(`
        <h3>${esc(title)}</h3>
        <div class="sheet-body">${body}</div>
        <div class="sheet-actions">
          <button class="btn btn-ghost" data-act="cancel">取消</button>
          <button class="btn ${danger ? 'btn-primary' : 'btn-dark'}" data-act="ok">${esc(okText)}</button>
        </div>`)
      s.el.querySelector('[data-act=cancel]').onclick = () => { s.close(); resolve(false) }
      s.el.querySelector('[data-act=ok]').onclick = () => { s.close(); resolve(true) }
    })
  }

  function showResult({ title, desc, balance }) {
    const mask = document.createElement('div')
    mask.className = 'result-overlay'
    mask.innerHTML = `
      <div class="result-card">
        <div class="result-check">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4.5 12.5l5 5L19.5 7" />
          </svg>
        </div>
        <h4>${esc(title)}</h4>
        <p>${esc(desc)}</p>
        ${balance != null ? `<div class="big-balance">${fmtMoney(balance)}</div><p>剩余专用余额</p>` : ''}
        <div class="sheet-actions"><button class="btn btn-dark btn-block" data-act="ok">好的</button></div>
      </div>`
    document.body.appendChild(mask)
    mask.querySelector('[data-act=ok]').onclick = () => mask.remove()
  }

  /* ---------- 云服务封装 ---------- */
  function rpcErrText(e) {
    let m = (e && (e.message || e.msg)) || '操作失败，请重试'
    try { const j = JSON.parse(m); if (j && j.message) m = j.message } catch (_) {}
    m = String(m).replace(/^ERROR:\s*/i, '').replace(/^[A-Z][A-Z0-9_]{2,}:\s*/, '')
    return m || '操作失败，请重试'
  }
  async function rpc(name, params) {
    const { data, error } = await cloud.database.rpc(name, params || {})
    if (error) { const err = new Error(rpcErrText(error)); err.raw = error; throw err }
    return data
  }
  async function select(queryFn) {
    const { data, error } = await queryFn(cloud.database.from.bind(cloud.database))
    if (error) { const err = new Error(rpcErrText(error)); err.raw = error; throw err }
    return data || []
  }

  /* ---------- 服务器时间 ---------- */
  async function syncServerNow() {
    const iso = await rpc('server_now')
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(iso))
    if (!m) throw new Error('时间同步失败')
    state.now = {
      dateStr: `${m[1]}-${m[2]}-${m[3]}`,
      dow: new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay(),
      mins: (+m[4]) * 60 + (+m[5]),
      timeStr: `${m[4]}:${m[5]}`,
      at: Date.now(),
    }
    return state.now
  }
  function currentMins() { // 本地推算（基于服务器时间+流逝秒数）
    if (!state.now) return 0
    return state.now.mins + Math.floor((Date.now() - state.now.at) / 60000)
  }
  function classState(cls) {
    if (!state.now || cls.weekday !== state.now.dow) return 'wait'
    const s = toMins(cls.start_time), e = toMins(cls.end_time), m = currentMins()
    if (m < s - 15) return 'wait'
    if (m < s) return 'soon'
    if (m <= e) return 'live'
    return 'done'
  }
  const STATE_LABEL = { wait: '未开始', soon: '即将开始', live: '上课中', done: '已结束' }

  /* ---------- 角色判断（admin=教务管理员，superadmin=超级管理员） ---------- */
  const isMgr = () => !!state.staff && (state.staff.role === 'admin' || state.staff.role === 'superadmin')
  const isSuper = () => !!state.staff && state.staff.role === 'superadmin'
  const ROLE_LABEL = { admin: '管理员', superadmin: '超级管理员', teacher: '教师' }
  const roleLabel = (r) => ROLE_LABEL[r] || r

  /* ---------- 员工加载与认领 ---------- */
  async function loadStaff() {
    const rows = await rpc('staff_me')
    state.staff = (rows && rows[0]) || null
    if (!state.staff && state.user) {
      try {
        const { data: u } = await cloud.auth.getUser()
        const phone = u && (u.phone || (u.user && u.user.phone))
        if (phone) {
          const claimed = await rpc('claim_staff', { p_email: phone })  /* 参数名沿用 p_email，值传手机号（见迁移设计 §3.2） */
          if (claimed) {
            const again = await rpc('staff_me')
            state.staff = (again && again[0]) || null
          }
        }
      } catch (_) { /* 无邀请则保持未授权 */ }
    }
    return state.staff
  }

  /* ==================== 统一骨架（墨·纸·印 shell） ==================== */
  const ZX_SYSTEMS = [
    { id: 'yj',   name: '业绩登记系统', domain: 'yj.example.com',   color: 'var(--zx-sys-yj)',   url: 'https://yj.example.com/' },
    { id: 'quan', name: '券类管理系统', domain: 'quan.example.com', color: 'var(--zx-sys-quan)', url: 'https://quan.example.com/' },
    { id: 'jz',   name: '教资报名系统', domain: 'jz.example.com',   color: 'var(--zx-sys-jz)',   url: 'https://jz.example.com/' },
    { id: 'sf',   name: '评测报告系统', domain: 'sf.example.com',   color: 'var(--zx-sys-sf)',   url: 'https://sf.example.com/' },
    { id: 'wms',  name: '仓库管理系统', domain: 'wms.example.com',  color: 'var(--zx-sys-wms)',  url: 'https://wms.example.com/' },
    { id: 'zc',   name: '固定资产管理', domain: 'zc.example.com',   color: 'var(--zx-sys-zc)',   url: 'https://zc.example.com/' },
  ]
  /* 角色显隐沿用现有逻辑：teacher 仅核销相关；admin/superadmin 全部可见 */
  const QUAN_NAV = [
    { group: '', items: [
      { id: 'admin', icon: 'home', label: '工作台', href: '#/admin', roles: ['admin', 'superadmin'] },
      { id: 'today', icon: 'scan', label: '今日核销', href: '#/today' },
      { id: 'voucher', icon: 'ticket', label: '课时券', href: '#/voucher' },
    ]},
    { group: '管理', items: [
      { id: 'logs', icon: 'log', label: '流水', href: '#/logs', roles: ['admin', 'superadmin'] },
      { id: 'students', icon: 'users', label: '学员', href: '#/students', roles: ['admin', 'superadmin'] },
      { id: 'classes', icon: 'calendar', label: '班级', href: '#/classes', roles: ['admin', 'superadmin'] },
      { id: 'mentors', icon: 'teacher', label: '师资', href: '#/mentors', roles: ['admin', 'superadmin'] },
    ]},
    { group: '', items: [
      { id: 'me', icon: 'me', label: '我的', href: '#/me' },
    ]},
  ]
  let zxShellReady = false
  function ensureShell() {
    if (zxShellReady || !state.staff) return
    zxShellReady = true
    ZXShell.init({
      brand: { name: '教培机构', logo: null },
      systems: ZX_SYSTEMS,
      currentSystem: 'quan',
      nav: QUAN_NAV,
      tabbar: ['today', 'voucher', 'admin', 'students', 'me'],
      user: { name: state.staff.name, role: roleLabel(state.staff.role), roleType: isMgr() ? 'admin' : 'teacher' },
      activeNav: '',
      onLogout: doLogout,
    })
  }
  function syncShellNav(active) {
    if (!zxShellReady) return
    document.querySelectorAll('[data-nav]').forEach((a) => {
      a.classList.toggle('is-active', a.getAttribute('data-nav') === active)
    })
  }

  /* ==================== 应用骨架 ==================== */
  function clearTimers() { state.timers.forEach(clearInterval); state.timers = [] }

  function mount(pageHTML, active) {
    ensureShell()
    syncShellNav(active)
    $app.innerHTML = pageHTML
  }

  /* ---------- 静默刷新（不闪屏、不丢滚动位置、不打断输入） ---------- */
  let refreshing = false
  function mountPage(pageHTML) {
    const y = window.scrollY
    $app.innerHTML = pageHTML
    window.scrollTo(0, y)
  }
  /* 轮询前置判断：任一条件不满足就跳过本次刷新，避免打断用户操作 */
  function canPoll() {
    if (refreshing) return false                                              // 防重入
    if (document.hidden) return false                                         // 页面切到后台
    if (document.querySelector('.sheet-mask, .result-overlay')) return false  // 弹层/结果框打开中
    const ae = document.activeElement
    if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return false      // 正在输入或选择
    return true
  }
  /* 统一的轮询回调包装：先校验路由仍在当前页，再静默刷新 */
  function pollRefresh(matchHash, fn) {
    return async () => {
      if (matchHash && !matchHash()) return
      if (!canPoll()) return
      refreshing = true
      try { await fn() } catch (_) { /* 静默失败，下一轮自动重试 */ }
      finally { refreshing = false }
    }
  }

  function skeletonRows(n) {
    return Array.from({ length: n }, () => '<div class="skeleton" style="height:76px;margin-bottom:12px"></div>').join('')
  }

  function pageError(e) {
    return `<div class="empty"><span class="glyph">!</span>${esc(e.message || '加载失败')}<br><br><button class="btn btn-ghost btn-sm" onclick="location.reload()">重新加载</button></div>`
  }

  /* ==================== 视图：登录 ==================== */
  function vLogin() {
    clearTimers()
    $app.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-hero">
          <div class="seal seal-lg">泽</div>
          <h1>教培机构</h1>
          <p>券 类 管 理 系 统</p>
        </div>
        <div class="card card-pad">
          <form id="login-form" autocomplete="off">
            <div class="field">
              <label>手机号</label>
              <input type="tel" name="phone" required maxlength="11" inputmode="numeric" placeholder="请输入 11 位手机号">
            </div>
            <div class="field">
              <label>密码</label>
              <input type="password" name="password" required placeholder="请输入密码">
            </div>
            <button class="btn btn-primary btn-block" type="submit">登 录</button>
          </form>
          <p class="hint" style="text-align:center;margin-top:14px;font-size:.82rem;color:var(--ink-faint)">首次使用请联系管理员在后台创建账号并告知初始密码，登录后可修改密码</p>
        </div>
        <div class="auth-foot"><a href="#/parent">家长查询余额（无需登录）</a></div>
      </div>`

    const form = document.getElementById('login-form')
    const submitBtn = form.querySelector('[type=submit]')

    form.onsubmit = async (e) => {
      e.preventDefault()
      const phone = form.phone.value.trim()
      if (!/^1\d{10}$/.test(phone)) { toast('请输入正确的 11 位手机号', 'err'); return }
      submitBtn.disabled = true
      try {
        const { error } = await cloud.auth.signInWithPassword({ phone, password: form.password.value })
        if (error) throw new Error(error.message || '账号或密码不正确')
        const sd = await cloud.auth.getSession()
        state.user = (sd && sd.data && sd.data.session) ? sd.data.session.user : null
        await loadStaff()
        toast('登录成功', 'ok')
        location.hash = '#/today'
        route()
      } catch (err) {
        toast(err.message, 'err')
      }
      submitBtn.disabled = false
    }
  }

  /* ==================== 视图：待授权 ==================== */
  async function vPending() {
    clearTimers()
    const { data: u } = await cloud.auth.getUser()
    const phone = (u && (u.phone || (u.user && u.user.phone))) || ''
    $app.innerHTML = `
      <div class="pending-box">
        <div class="seal seal-lg" style="margin:0 auto">泽</div>
        <h3 style="font-family:var(--ff-serif);margin:18px 0 8px;letter-spacing:.1em">账号已登录，等待授权</h3>
        <p style="color:var(--ink-faint);font-size:.88rem">您的手机号 <b>${esc(phone)}</b> 还没有系统角色。<br>请联系管理员在「员工与授权」中添加该手机号，然后重新进入系统。</p>
        <div class="code">${esc(state.user && state.user.id || '')}</div>
        <br>
        <button class="btn btn-ghost" id="btn-logout">退出登录</button>
      </div>`
    document.getElementById('btn-logout').onclick = doLogout
  }

  async function doLogout() {
    await cloud.auth.signOut()
    state.user = null; state.staff = null
    location.reload()
  }

  /* ==================== 视图：今日课表 ==================== */
  async function vToday(silent) {
    if (!silent) {
      clearTimers()
      mount(`<div class="date-hero" style="margin-bottom:16px"><div class="skeleton" style="height:64px;width:100%"></div></div>${skeletonRows(3)}`, 'today')
    }
    try {
      await syncServerNow()
      const [classes, elig, txns] = await Promise.all([
        select((t) => t('classes').select('*').eq('active', true)),
        select((t) => t('student_eligibility').select('*').eq('active', true)),
        select((t) => t('transactions').select('*').eq('class_date', state.now.dateStr).eq('type', 'deduct')),
      ])
      const todayClasses = classes
        .filter((c) => c.weekday === state.now.dow)
        .sort((a, b) => toMins(a.start_time) - toMins(b.start_time))
      const eligCount = {}
      elig.forEach((e) => { eligCount[e.class_id] = (eligCount[e.class_id] || 0) + 1 })
      const doneCount = {}
      txns.forEach((t) => { doneCount[t.class_id] = (doneCount[t.class_id] || 0) + 1 })

      const html = `
        <div class="date-hero" style="margin-bottom:16px">
          <div>
            <div class="day">${+state.now.dateStr.slice(8)}</div>
            <div class="ymd">${fmtDate(state.now.dateStr)}</div>
          </div>
          <div>
            <div class="week">${WEEK[state.now.dow]}</div>
            <div class="week" style="font-size:.72rem;margin-top:5px">服务器时间校准 · 窗口由服务端判定</div>
          </div>
          <div class="live"><div>当前时间</div><div class="clock" id="clock">${state.now.timeStr}</div></div>
        </div>
        ${todayClasses.length === 0 ? `
          <div class="empty card"><span class="glyph">静</span>今天（${WEEK[state.now.dow]}）没有安排名师班课程</div>` : ''}
        ${todayClasses.map((c) => {
          const st = classState(c)
          return `
          <div class="card class-card st-${st}" data-class="${c.id}">
            <div class="time-col">
              <div class="t">${String(c.start_time).slice(0, 5)}</div>
              <div class="e">至 ${String(c.end_time).slice(0, 5)}</div>
            </div>
            <div class="body">
              <div class="name">${esc(c.name)}</div>
              <div class="meta">
                <span>${esc(c.campus || '')}</span>
                <span>${esc(c.teacher_name || '')}</span>
                <span>单次 ${fmtMoney(c.price_per_session)}</span>
              </div>
              <div class="meta" style="margin-top:6px">
                <span class="chip ${st === 'live' ? 'chip-cinnabar' : 'chip-ink'}">${doneCount[c.id] || 0} / ${eligCount[c.id] || 0} 已核销</span>
              </div>
            </div>
            <div class="state">${STATE_LABEL[st]}</div>
          </div>`
        }).join('')}
        <p style="text-align:center;color:var(--ink-faint);font-size:.74rem;margin-top:18px;letter-spacing:.08em">课前 15 分钟至下课为核销窗口 · 每节课每学员仅可核销一次</p>`

      if (silent) {
        mountPage(html)
      } else {
        mount(html, 'today')
      }

      document.querySelectorAll('[data-class]').forEach((el) => {
        el.onclick = () => { location.hash = '#/class/' + el.dataset.class }
      })
      if (!silent) {
        // 时钟（本地推算，不打网络）
        state.timers.push(setInterval(() => {
          const clockEl = document.getElementById('clock')
          if (!clockEl || !state.now) return
          const total = state.now.mins * 60 + Math.floor((Date.now() - state.now.at) / 1000)
          const hh = String(Math.floor(total / 3600) % 24).padStart(2, '0')
          const mi = String(Math.floor(total / 60) % 60).padStart(2, '0')
          clockEl.textContent = `${hh}:${mi}`
        }, 1000))
        // 数据轮询：静默刷新，不打断用户操作
        state.timers.push(setInterval(
          pollRefresh(() => location.hash === '#/today', () => vToday(true)),
          60000))
      }
    } catch (e) {
      if (!silent) mount(pageError(e), 'today')
    }
  }

  /* ==================== 视图：班级核销 ==================== */
  async function vClass(id, silent) {
    if (!silent) {
      clearTimers()
      mount(skeletonRows(5), 'today')
    }
    try {
      await syncServerNow()
      const [clsRows, elig, students, wallets, txns] = await Promise.all([
        select((t) => t('classes').select('*').eq('id', id)),
        select((t) => t('student_eligibility').select('*').eq('class_id', id).eq('active', true)),
        select((t) => t('students').select('*').eq('active', true)),
        select((t) => t('wallets').select('*')),
        select((t) => t('transactions').select('*').eq('class_id', id).eq('class_date', state.now.dateStr)),
      ])
      const cls = clsRows[0]
      if (!cls) { mount('<div class="empty">班级不存在</div>', 'today'); return }
      const stuMap = Object.fromEntries(students.map((s) => [s.id, s]))
      const walMap = Object.fromEntries(wallets.map((w) => [w.student_id, w]))
      const dedRows = txns.filter((t) => t.type === 'deduct')
      const voidedIds = new Set(txns.filter((t) => t.type === 'void').map((t) => t.void_of))
      const dedMap = {}
      const voidMap = {}
      dedRows.forEach((t) => {
        if (voidedIds.has(t.id)) voidMap[t.student_id] = t
        else dedMap[t.student_id] = t
      })
      const list = elig.map((e) => stuMap[e.student_id]).filter(Boolean)
        .sort((a, b) => (dedMap[a.id] ? 1 : 0) - (dedMap[b.id] ? 1 : 0) || a.name.localeCompare(b.name, 'zh'))

      const st = classState(cls)

      const html = `
        <div class="section-title" style="margin-top:4px">
          <h3>${esc(cls.name)}</h3>
          <span class="chip ${st === 'live' ? 'chip-cinnabar' : st === 'done' ? 'chip-ink' : 'chip-gold'}">${STATE_LABEL[st]}</span>
          <span class="spacer"></span>
          <a class="link" href="#/today">返回课表</a>
        </div>
        <div class="card card-pad" style="margin-bottom:14px;display:flex;gap:16px;flex-wrap:wrap;font-size:.82rem;color:var(--ink-soft)">
          <span>${esc(cls.campus || '')}</span>
          <span>任课：${esc(cls.teacher_name || '—')}</span>
          <span>${String(cls.start_time).slice(0, 5)} – ${String(cls.end_time).slice(0, 5)}</span>
          <span>单次 <b class="money money-cinnabar">${fmtMoney(cls.price_per_session)}</b></span>
        </div>
        <div class="card list-card">
          ${list.length === 0 ? '<div class="empty"><span class="glyph">候</span>暂无具备本班核销资格的学员</div>' : ''}
          ${list.map((s) => {
            const bal = Number((walMap[s.id] || {}).balance || 0)
            const enough = bal >= Number(cls.price_per_session)
            const done = dedMap[s.id]
            const voided = voidMap[s.id]
            return `
            <div class="student-row" data-stu="${s.id}">
              <div class="avatar ${avatarColor(s.id)}">${esc((s.name || '?').slice(0, 1))}</div>
              <div class="info">
                <div class="name">${esc(s.name)}</div>
                <div class="sub">${esc(s.campus || '')} · 余额 <span class="money ${enough ? '' : 'money-cinnabar'}">${fmtMoney(bal)}</span></div>
              </div>
              <div class="side">
                ${done ? `<span class="done-tag">已核销 · ${fmtMoney(done.amount)}</span>` : ''}
                ${voided ? `<span class="chip chip-ink">已作废退回</span>` : ''}
                ${!done && !voided ? `
                  <button class="deduct-btn" data-deduct="${s.id}" ${enough ? '' : 'disabled'}>
                    ${enough ? `扣 ${fmtMoney(cls.price_per_session)}` : '余额不足'}
                  </button>` : ''}
              </div>
            </div>`
          }).join('')}
        </div>
        <p style="text-align:center;color:var(--ink-faint);font-size:.74rem;margin-top:14px">余额不足的学员请先由教务在「学员」页充值</p>`

      if (silent) mountPage(html)
      else mount(html, 'today')

      $app.querySelectorAll('[data-deduct]').forEach((btn) => {
        btn.onclick = async () => {
          const sid = +btn.dataset.deduct
          const s = stuMap[sid]
          const bal = Number((walMap[sid] || {}).balance || 0)
          const after = bal - Number(cls.price_per_session)
          const ok = await confirmSheet({
            title: '确认核销',
            body: `
              <p style="font-size:.92rem;line-height:2">
                学员：<b>${esc(s.name)}</b><br>
                班级：${esc(cls.name)}<br>
                本次扣减：<b class="money money-cinnabar">${fmtMoney(cls.price_per_session)}</b><br>
                余额：${fmtMoney(bal)} → <b class="money">${fmtMoney(after)}</b><br>
                操作人：${esc(state.staff.name)}
              </p>
              <p style="color:var(--ink-faint);font-size:.76rem;margin-top:10px">核销后立即生效并留痕，不可直接修改；如需撤销由管理员作废并退回。</p>`,
            okText: '确认核销',
            danger: true,
          })
          if (!ok) return
          btn.disabled = true
          try {
            const res = await rpc('deduct_session', { p_student_id: sid, p_class_id: +id })
            showResult({ title: '核销成功', desc: `${s.name} · ${cls.name}`, balance: res.balance })
            vClass(id)
          } catch (e) {
            toast(e.message, 'err')
            btn.disabled = false
          }
        }
      })

      if (!silent) {
        state.timers.push(setInterval(
          pollRefresh(() => location.hash.startsWith('#/class/'), () => vClass(id, true)),
          30000))
      }
    } catch (e) {
      if (!silent) mount(pageError(e), 'today')
    }
  }

  /* ==================== 视图：课时券核销（教师/教务） ==================== */
  async function vVoucherRedeem(silent) {
    if (!silent) {
      clearTimers()
      mount(skeletonRows(5), 'voucher')
    }
    try {
      await syncServerNow()
      const [students, vouchers] = await Promise.all([
        select((t) => t('students').select('*').eq('active', true)),
        select((t) => t('session_vouchers').select('*')),
      ])
      render(students, vouchers)

      function render(students, vouchers) {
        const unusedMap = {}, totalMap = {}
        vouchers.forEach((v) => {
          if (v.status === 'voided') return   // 已作废券不计入额度与可用数
          totalMap[v.student_id] = (totalMap[v.student_id] || 0) + 1
          if (v.status === 'unused') unusedMap[v.student_id] = (unusedMap[v.student_id] || 0) + 1
        })

        // 静默刷新时保留用户已输入的搜索关键词
        const prevKw = silent ? (document.getElementById('vk-kw') || {}).value || '' : ''

        const html = `
          <div class="section-title" style="margin-top:4px">
            <h3>课时券核销</h3>
            <span class="hint">任意课程可用 · 每学员累计限 4 张</span>
          </div>
          <div class="toolbar">
            <input id="vk-kw" placeholder="搜索学员姓名 / 手机号" value="${esc(prevKw)}">
          </div>
          <div class="card list-card" id="vk-list"></div>
          <p style="text-align:center;color:var(--ink-faint);font-size:.74rem;margin-top:14px">核销前请确认该课次已在易知鸟按 0 元消课</p>`

        if (silent) mountPage(html)
        else mount(html, 'voucher')

        function renderList() {
          const kw = (document.getElementById('vk-kw').value || '').trim().toLowerCase()
          const rows = students.filter((s) => !kw || s.name.toLowerCase().includes(kw) || (s.parent_phone || '').includes(kw))
          document.getElementById('vk-list').innerHTML = rows.length === 0
            ? '<div class="empty">没有匹配的学员</div>'
            : rows.map((s) => {
                const total = totalMap[s.id] || 0
                const unused = unusedMap[s.id] || 0
                return `
                <button class="row-item" data-stu="${s.id}">
                  <div class="avatar ${avatarColor(s.id)}">${esc((s.name || '?').slice(0, 1))}</div>
                  <div class="grow">
                    <div class="t1">${esc(s.name)}</div>
                    <div class="t2">${esc(s.campus || '')} · 累计 ${total}/4 张</div>
                  </div>
                  ${unused > 0
                    ? `<span class="chip chip-jade">剩余 ${unused} 张</span>`
                    : `<span class="chip chip-ink">${total > 0 ? '已用完' : '无课时券'}</span>`}
                  <span class="arrow">›</span>
                </button>`
              }).join('')
          $app.querySelectorAll('#vk-list [data-stu]').forEach((el) => { el.onclick = () => openRedeem(+el.dataset.stu) })
        }
        document.getElementById('vk-kw').oninput = renderList
        renderList()

        function openRedeem(sid) {
          const s = students.find((x) => x.id === sid)
          const unused = unusedMap[sid] || 0
          if (unused <= 0) { toast(totalMap[sid] ? '该学员课时券已用完' : '该学员没有课时券，请联系教务发放', 'err'); return }
          const sheet = openSheet(`
            <h3>课时券核销 · ${esc(s.name)}</h3>
            <p style="font-size:.86rem;color:var(--ink-soft);margin-bottom:14px">可用 <b class="voucher-count">${unused}</b> 张 · 系统取最早发放的一张</p>
            <div class="field"><label>上课日期</label><input id="v-date" type="date" value="${state.now.dateStr}"></div>
            <div class="field"><label>上课时间段</label>
              <input id="v-slot" list="slot-list" placeholder="例如：周六 10:00-12:00">
              <datalist id="slot-list">
                <option value="周六 08:30-10:00"></option>
                <option value="周六 10:00-12:00"></option>
                <option value="周六 14:00-16:00"></option>
                <option value="周六 16:00-18:00"></option>
                <option value="周日 08:30-10:00"></option>
                <option value="周日 10:00-12:00"></option>
                <option value="周日 14:00-16:00"></option>
                <option value="周日 16:00-18:00"></option>
              </datalist>
            </div>
            <div class="field"><label>课程备注（选填）</label><input id="v-note" placeholder="例如：硬笔校长班"></div>
            <label style="display:flex;gap:8px;align-items:flex-start;font-size:.84rem;color:var(--ink-soft);margin:6px 0 4px">
              <input type="checkbox" id="v-confirm" style="margin-top:3px;width:16px;height:16px">
              <span>已核对<b>易知鸟</b>该课次消课金额为 0</span>
            </label>
            <div class="sheet-actions">
              <button class="btn btn-ghost" data-act="cancel">取消</button>
              <button class="btn btn-primary" data-act="ok">确认核销</button>
            </div>`)
          sheet.el.querySelector('[data-act=cancel]').onclick = sheet.close
          sheet.el.querySelector('[data-act=ok]').onclick = async () => {
            if (!sheet.el.querySelector('#v-confirm').checked) { toast('请先勾选「已核对易知鸟消课为 0」', 'err'); return }
            const useDate = sheet.el.querySelector('#v-date').value
            if (!useDate) { toast('请填写上课日期', 'err'); return }
            const slot = sheet.el.querySelector('#v-slot').value.trim()
            const note = sheet.el.querySelector('#v-note').value.trim()
            const ok = await confirmSheet({
              title: '确认课时券核销',
              body: `
                <p style="font-size:.92rem;line-height:2">
                  学员：<b>${esc(s.name)}</b><br>
                  上课日期：<b>${esc(fmtDate(useDate))}</b><br>
                  时间段：${esc(slot || '未填写')}<br>
                  课程备注：${esc(note || '—')}<br>
                  操作人：${esc(state.staff.name)}
                </p>
                <p style="color:var(--ink-faint);font-size:.76rem;margin-top:10px">系统将核销该学员最早发放的一张课时券，操作立即生效并留痕；误操作可由管理员作废退回。</p>`,
              okText: '确认核销',
              danger: true,
            })
            if (!ok) return
            const btn = sheet.el.querySelector('[data-act=ok]')
            btn.disabled = true
            try {
              const res = await rpc('redeem_voucher', { p_student_id: sid, p_use_date: useDate, p_time_slot: slot || null, p_note: note || null })
              sheet.close()
              showResult({ title: '核销成功', desc: `${s.name} · 券号 ${res.code} · 剩余 ${res.remaining} 张` })
              vVoucherRedeem()
            } catch (e) {
              toast(e.message, 'err')
              btn.disabled = false
            }
          }
        }
      }

      if (!silent) {
        state.timers.push(setInterval(
          pollRefresh(() => location.hash === '#/voucher', () => vVoucherRedeem(true)),
          30000))
      }
    } catch (e) {
      if (!silent) mount(pageError(e), 'voucher')
    }
  }

  /* ==================== 视图：课时券管理（管理员） ==================== */
  const vouFilter = { status: 'all', kw: '' }
  let vouLastReport = ''
  async function vVoucherAdmin(silent) {
    if (!silent) {
      clearTimers()
      mount(skeletonRows(5), 'voucher')
    }
    try {
      await syncServerNow()
      const [students, vouchers, voidUseEvents, voidVouEvents] = await Promise.all([
        select((t) => t('students').select('*')),
        select((t) => t('session_vouchers').select('*')),
        select((t) => t('voucher_events').select('*').eq('event', 'void_use')),
        select((t) => t('voucher_events').select('*').eq('event', 'void_voucher')),
      ])
      // 作废券的原因（留在 voucher_events 里，券行本身不存原因）
      const voidReason = {}
      voidVouEvents.forEach((e) => { voidReason[e.voucher_id] = (e.detail || {}).reason || '' })
      render(students, vouchers, voidUseEvents.length, voidReason)

      function render(students, vouchers, voidUseCount, voidReason) {
        const stuMap = Object.fromEntries(students.map((s) => [s.id, s]))
        const rows = [...vouchers].sort((a, b) => b.id - a.id)
        const used = vouchers.filter((v) => v.status === 'used').length
        const unused = vouchers.filter((v) => v.status === 'unused').length
        const voided = vouchers.filter((v) => v.status === 'voided').length
        const effective = vouchers.length - voided   // 有效发放（不含已作废）

        // 静默刷新时保留用户填了一半的发放名单/备注，避免输入内容被清掉
        const prevText = silent ? (document.getElementById('vb-text') || {}).value || '' : ''
        const prevNote = silent ? (document.getElementById('vb-note') || {}).value || '' : ''

        const html = `
          <div class="section-title" style="margin-top:4px">
            <h3>课时券管理</h3>
            <span class="hint">每学员累计限 4 张（含已用）</span>
            <span class="spacer"></span>
            <button class="btn btn-primary btn-sm" id="v-go-redeem">去核销</button>
          </div>
          <div class="stat-grid">
            <div class="card stat-card"><div class="label">有效发放</div><div class="value">${effective}<small>张</small></div><div class="foot">不含已作废</div></div>
            <div class="card stat-card"><div class="label">已使用</div><div class="value">${used}<small>张</small></div><div class="foot">按上课日期核销</div></div>
            <div class="card stat-card accent"><div class="label">剩余可用</div><div class="value">${unused}<small>张</small></div><div class="foot">全机构在库</div></div>
            <div class="card stat-card"><div class="label">已作废券</div><div class="value">${voided}<small>张</small></div><div class="foot">发重/发多已回收</div></div>
          </div>

          <div class="section-title"><h3>批量发放</h3><span class="hint">从 Excel 复制粘贴，每行：姓名,手机号,张数</span></div>
          <div class="card card-pad">
            <div class="field"><label>发放名单</label>
              <textarea id="vb-text" rows="6" placeholder="张三,13800000000,2&#10;李四,13800000000,1">${esc(prevText)}</textarea></div>
            <div class="field"><label>批次备注（选填，记录到每一张券）</label><input id="vb-note" placeholder="例如：春季活动奖励" value="${esc(prevNote)}"></div>
            <div class="sheet-actions" style="justify-content:flex-start">
              <button class="btn btn-ghost btn-sm" id="vb-preview">预览名单</button>
              <button class="btn btn-primary btn-sm" id="vb-issue">确认发放</button>
            </div>
            <div id="vb-report">${vouLastReport}</div>
          </div>

          <div class="section-title">
            <h3>券记录</h3><span class="hint">作废核销退回不占额度${isSuper() ? ' · 超管可作废发重/发多的券' : ''}</span><span class="spacer"></span>
            <button class="btn btn-dark btn-sm" id="v-add-one">单个发放</button>
          </div>
          <div class="toolbar">
            <input id="v-kw" placeholder="搜索学员姓名 / 券号" value="${esc(vouFilter.kw)}">
          </div>
          <div class="filter-bar">
            ${[['all', '全部'], ['unused', '未使用'], ['used', '已使用'], ...(isSuper() ? [['voided', '已作废']] : [])].map(([k, l]) => `<button class="fchip ${vouFilter.status === k ? 'on' : ''}" data-vs="${k}">${l}</button>`).join('')}
          </div>
          <div class="card list-card" id="v-list"></div>`

        if (silent) mountPage(html)
        else mount(html, 'voucher')

        document.getElementById('v-go-redeem').onclick = () => vVoucherRedeem()

        /* ---------- 券记录列表 ---------- */
        function renderList() {
          let list = rows
          if (vouFilter.status !== 'all') list = list.filter((v) => v.status === vouFilter.status)
          const kw = vouFilter.kw.toLowerCase()
          if (kw) {
            list = list.filter((v) => {
              const s = stuMap[v.student_id]
              return (s && s.name.toLowerCase().includes(kw)) || (v.code || '').toLowerCase().includes(kw)
            })
          }
          document.getElementById('v-list').innerHTML = list.length === 0
            ? '<div class="empty">没有符合条件的券</div>'
            : list.slice(0, 200).map((v) => {
                const s = stuMap[v.student_id]
                const isVoided = v.status === 'voided'
                const sub = isVoided
                  ? ['发放于 ' + fmtDT(v.issued_at), '发放：' + v.issued_by, voidReason[v.id] ? '作废原因：' + voidReason[v.id] : ''].filter(Boolean).join(' · ')
                  : v.status === 'used'
                  ? [v.use_date ? fmtDate(v.use_date) : '', v.time_slot, v.course_note, '操作：' + (v.used_by || '')].filter(Boolean).join(' · ')
                  : ['发放于 ' + fmtDT(v.issued_at), '操作：' + v.issued_by, v.issue_note].filter(Boolean).join(' · ')
                const icoCls = isVoided ? 'void' : (v.status === 'used' ? 'deduct' : 'recharge')
                const chipCls = isVoided ? 'chip-cinnabar' : (v.status === 'unused' ? 'chip-jade' : 'chip-ink')
                const chipTxt = isVoided ? '已作废' : (v.status === 'unused' ? '未使用' : '已使用')
                // 未使用券：仅超管可作废；已使用券：管理员及以上可作废核销
                let btns = ''
                if (v.status === 'used') {
                  btns = `<div style="margin-top:4px;text-align:right"><button class="btn btn-ghost btn-sm" data-vvoid="${v.id}">作废核销</button></div>`
                } else if (v.status === 'unused' && isSuper()) {
                  btns = `<div style="margin-top:4px;text-align:right"><button class="btn btn-ghost btn-sm" data-vvoid2="${v.id}">作废券</button></div>`
                }
                return `
                <div class="txn-row"${isVoided ? ' style="opacity:.62"' : ''}>
                  <div class="txn-ico ${icoCls}">券</div>
                  <div class="info">
                    <div class="t1">${isVoided ? '<s>' + esc(v.code) + '</s>' : esc(v.code)}${s ? ` <span style="font-weight:400;color:var(--ink-faint)">${esc(s.name)}</span>` : ''}</div>
                    <div class="t2">${esc(sub)}</div>
                  </div>
                  <div>
                    <span class="chip ${chipCls}">${chipTxt}</span>
                    ${btns}
                  </div>
                </div>`
              }).join('')
          $app.querySelectorAll('[data-vvoid]').forEach((btn) => { btn.onclick = () => openVoid(+btn.dataset.vvoid) })
          $app.querySelectorAll('[data-vvoid2]').forEach((btn) => { btn.onclick = () => openVoidVoucher(+btn.dataset.vvoid2) })
        }
        $app.querySelectorAll('[data-vs]').forEach((b) => { b.onclick = () => { vouFilter.status = b.dataset.vs; render(students, vouchers, voidUseCount, voidReason) } })
        const kwInput = document.getElementById('v-kw')
        let deb = null
        kwInput.oninput = () => {
          clearTimeout(deb)
          deb = setTimeout(() => { vouFilter.kw = kwInput.value.trim(); renderList() }, 300)
        }
        renderList()

        /* ---------- 作废 ---------- */
        function openVoid(vid) {
          const v = rows.find((x) => x.id === vid)
          const s = stuMap[v.student_id]
          const sh = openSheet(`
            <h3>作废课时券核销</h3>
            <p style="font-size:.86rem;color:var(--ink-soft);margin-bottom:12px">券号 <b>${esc(v.code)}</b>（${esc(s ? s.name : '')}）<br>原记录：${esc([v.use_date ? fmtDate(v.use_date) : '', v.time_slot].filter(Boolean).join(' · ') || '—')}</p>
            <div class="field"><label>作废原因（必填，将留痕）</label>
              <textarea id="vv-reason" rows="3" placeholder="例如：误核销，该课次实际使用专用余额扣费"></textarea></div>
            <div class="sheet-actions">
              <button class="btn btn-ghost" data-act="cancel">取消</button>
              <button class="btn btn-primary" data-act="ok">确认作废并退回</button>
            </div>`)
          sh.el.querySelector('[data-act=cancel]').onclick = sh.close
          sh.el.querySelector('[data-act=ok]').onclick = async () => {
            const reason = sh.el.querySelector('#vv-reason').value.trim()
            if (!reason) { toast('请填写作废原因', 'err'); return }
            try {
              const res = await rpc('void_voucher_use', { p_voucher_id: vid, p_reason: reason })
              sh.close()
              toast(`已作废，${res.code} 退回未使用（剩余 ${res.remaining} 张）`, 'ok')
              vVoucherAdmin()
            } catch (e) { toast(e.message, 'err') }
          }
        }

        /* ---------- 作废课时券（仅超管：发重/发多了） ---------- */
        function openVoidVoucher(vid) {
          const v = rows.find((x) => x.id === vid)
          if (!v) return
          const s = stuMap[v.student_id]
          const sh = openSheet(`
            <h3>作废课时券</h3>
            <p style="font-size:.86rem;color:var(--ink-soft);margin-bottom:10px">
              券号 <b>${esc(v.code)}</b><br>
              学员：${esc(s ? s.name : '—')}（${esc(s ? s.campus || '' : '')}）<br>
              发放：${esc(v.issued_by || '')} · ${fmtDT(v.issued_at)}${v.issue_note ? '<br>备注：' + esc(v.issue_note) : ''}
            </p>
            <div class="tip" style="background:var(--cinnabar-wash, #FBEDEA);border-radius:8px;padding:10px;font-size:.78rem;color:var(--cinnabar-deep, #A63A2A);line-height:1.7;margin-bottom:12px">
              适用于教务<b>发重了 / 发多了</b>的纠错。作废后该券立即失效、不可再核销，
              且<b>不再占用该学员 4 张额度</b>（可重新发放正确的券）。<br>
              券记录会永久保留以备查证，学员端不再显示这张券。
            </div>
            <div class="field"><label>作废原因（必填，将永久留痕）</label>
              <textarea id="vv2-reason" rows="3" placeholder="例如：教务误将 3 张发成 5 张，作废多发的 2 张"></textarea></div>
            <div class="sheet-actions">
              <button class="btn btn-ghost" data-act="cancel">取消</button>
              <button class="btn btn-primary" data-act="ok">确认作废该券</button>
            </div>`)
          sh.el.querySelector('[data-act=cancel]').onclick = sh.close
          sh.el.querySelector('[data-act=ok]').onclick = async () => {
            const btn = sh.el.querySelector('[data-act=ok]')
            const reason = sh.el.querySelector('#vv2-reason').value.trim()
            if (!reason) { toast('请填写作废原因', 'err'); return }
            const ok = await confirmSheet({
              title: '二次确认作废',
              body: `<p style="font-size:.9rem;line-height:1.9">即将作废券号 <b>${esc(v.code)}</b>（${esc(s ? s.name : '')}）<br>
                     <span style="color:var(--ink-faint);font-size:.8rem">作废后不可撤销，需重新发放</span></p>`,
              okText: '确认作废',
              danger: true,
            })
            if (!ok) return
            btn.disabled = true
            try {
              const res = await rpc('void_voucher', { p_voucher_id: vid, p_reason: reason })
              sh.close()
              toast(`券 ${res.code} 已作废（${res.student_name || ''} 剩余可用 ${res.remaining} 张，占用额度 ${res.quota_used}/4）`, 'ok')
              vVoucherAdmin()
            } catch (e) {
              toast(e.message, 'err')
              btn.disabled = false
            }
          }
        }

        /* ---------- 单个发放 ---------- */
        document.getElementById('v-add-one').onclick = () => {
          const actives = students.filter((s) => s.active)
          if (!actives.length) { toast('没有在职学员', 'err'); return }
          const sheet = openSheet(`
            <h3>单个发放课时券</h3>
            <div class="field"><label>学员</label>
              <select id="vo-stu">${actives.map((s) => `<option value="${s.id}">${esc(s.name)} · ${esc(s.campus || '')}</option>`).join('')}</select></div>
            <div class="field"><label>张数（每学员累计限 4 张）</label><input id="vo-count" type="number" min="1" max="4" step="1" value="1"></div>
            <div class="field"><label>备注（选填）</label><input id="vo-note" placeholder="例如：续费奖励"></div>
            <div class="sheet-actions">
              <button class="btn btn-ghost" data-act="cancel">取消</button>
              <button class="btn btn-primary" data-act="ok">确认发放</button>
            </div>`)
          sheet.el.querySelector('[data-act=cancel]').onclick = sheet.close
          sheet.el.querySelector('[data-act=ok]').onclick = async () => {
            const sid = +sheet.el.querySelector('#vo-stu').value
            const count = Number(sheet.el.querySelector('#vo-count').value)
            if (!count || count < 1 || count > 4) { toast('张数须为 1-4', 'err'); return }
            try {
              const res = await rpc('issue_vouchers', { p_student_id: sid, p_count: count, p_note: sheet.el.querySelector('#vo-note').value.trim() || null })
              vouLastReport = ''
              sheet.close()
              showResult({ title: '发放成功', desc: `${(stuMap[sid] || {}).name || ''} · 券号 ${(res.codes || []).join('、')} · 累计 ${res.total}/4 张` })
              vVoucherAdmin()
            } catch (e) { toast(e.message, 'err') }
          }
        }

        /* ---------- 批量发放 ---------- */
        function parseBatch() {
          const text = document.getElementById('vb-text').value
          return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l, i) => {
            const parts = l.split(/[,，\t]/).map((x) => x.trim())
            const name = parts[0] || '', phone = parts[1] || '', count = parts[2] || ''
            let err = ''
            if (parts.length < 3 || !name || !phone) err = '格式需为：姓名,手机号,张数'
            else if (!/^\d{1,2}$/.test(count) || +count < 1 || +count > 4) err = '张数须为 1-4'
            return { row: i + 1, name, phone, count, err }
          })
        }

        document.getElementById('vb-preview').onclick = () => {
          const items = parseBatch()
          if (!items.length) { toast('请先粘贴名单', 'err'); return }
          vouLastReport = `
            <div class="section-title" style="margin:16px 0 6px"><h3 style="font-size:.9rem">解析预览（${items.length} 行）</h3></div>
            <div class="card list-card">${items.map((it) => `
              <div class="batch-report-row">
                <span class="chip ${it.err ? 'chip-cinnabar' : 'chip-jade'}">行 ${it.row}</span>
                <div class="grow"><div class="t1">${esc(it.name) || '<span style="color:var(--ink-faint)">（空）</span>'}</div><div class="t2">${esc(it.phone)}</div></div>
                <span class="voucher-count">${esc(it.count) || '—'} 张</span>
                ${it.err ? `<span style="color:var(--cinnabar);font-size:.76rem;flex-shrink:0">${esc(it.err)}</span>` : ''}
              </div>`).join('')}</div>`
          document.getElementById('vb-report').innerHTML = vouLastReport
        }

        document.getElementById('vb-issue').onclick = async () => {
          const items = parseBatch()
          if (!items.length) { toast('请先粘贴名单', 'err'); return }
          const bad = items.filter((it) => it.err)
          if (bad.length) { toast('有 ' + bad.length + ' 行格式错误，请检查后重试', 'err'); return }
          const btn = document.getElementById('vb-issue')
          btn.disabled = true
          try {
            const res = await rpc('batch_issue_vouchers', {
              p_entries: items.map((it) => ({ name: it.name, phone: it.phone, count: +it.count })),
              p_note: document.getElementById('vb-note').value.trim() || null,
            })
            const out = res.rows || []
            const okRows = out.filter((r) => r.ok)
            const failRows = out.filter((r) => !r.ok)
            const issued = okRows.reduce((a, r) => a + ((r.codes && r.codes.length) || 0), 0)
            vouLastReport = `
              <div class="section-title" style="margin:16px 0 6px"><h3 style="font-size:.9rem">发放结果</h3><span class="hint">成功 ${okRows.length} 行 · 失败 ${failRows.length} 行 · 共发放 ${issued} 张</span></div>
              <div class="card list-card">${out.map((r) => `
                <div class="batch-report-row">
                  <span class="chip ${r.ok ? 'chip-jade' : 'chip-cinnabar'}">${r.ok ? '成功' : '失败'}</span>
                  <div class="grow"><div class="t1">${esc(r.name)}</div><div class="t2">${r.ok ? '券号：' + esc((r.codes || []).join('、')) + ' · 累计 ' + esc(String(r.total)) + '/4' : esc(r.error || '')}</div></div>
                  <span class="voucher-count">${esc(String(r.count))} 张</span>
                </div>`).join('')}</div>`
            toast('批量发放完成', 'ok')
            vVoucherAdmin()
          } catch (e) {
            toast(e.message, 'err')
          } finally {
            btn.disabled = false
          }
        }
      }

      if (!silent) {
        state.timers.push(setInterval(
          pollRefresh(() => location.hash === '#/voucher', () => vVoucherAdmin(true)),
          30000))
      }
    } catch (e) {
      if (!silent) mount(pageError(e), 'voucher')
    }
  }

  /* ==================== 视图：管理员工作台 ==================== */
  async function vAdmin() {
    clearTimers()
    mount(`${skeletonRows(2)}<div class="skeleton" style="height:160px"></div>`, 'admin')
    try {
      await syncServerNow()
      const [students, elig, wallets, txnsToday, allTxns, vouchers] = await Promise.all([
        select((t) => t('students').select('*').eq('active', true)),
        select((t) => t('student_eligibility').select('*').eq('active', true)),
        select((t) => t('wallets').select('*')),
        select((t) => t('transactions').select('*').eq('class_date', state.now.dateStr)),
        select((t) => t('transactions').select('*').order('created_at', { ascending: false }).limit(500)),
        select((t) => t('session_vouchers').select('*')),
      ])
      const vouUsed = vouchers.filter((v) => v.status === 'used').length
      const vouVoided = vouchers.filter((v) => v.status === 'voided').length
      const vouTotal = vouchers.length - vouVoided   // 有效发放（不含已作废）
      const stuMap = Object.fromEntries(students.map((s) => [s.id, s]))
      const walMap = Object.fromEntries(wallets.map((w) => [w.student_id, w]))
      const dedToday = txnsToday.filter((t) => t.type === 'deduct')
      const recToday = txnsToday.filter((t) => t.type === 'recharge')
      const dedSum = dedToday.reduce((a, t) => a + Number(t.amount), 0)
      const recSum = recToday.reduce((a, t) => a + Number(t.amount), 0)
      const pool = wallets.reduce((a, w) => a + Number(w.balance), 0)
      const lowStu = students
        .map((s) => ({ s, bal: Number((walMap[s.id] || {}).balance || 0) }))
        .filter((x) => x.bal < 15)
        .sort((a, b) => a.bal - b.bal)

      mount(`
        <div class="section-title" style="margin-top:4px">
          <h3>工作台</h3><span class="hint">${fmtDate(state.now.dateStr)} ${WEEK[state.now.dow]}</span>
        </div>
        <div class="stat-grid">
          <div class="card stat-card accent"><div class="label">今日核销</div><div class="value">${dedToday.length}<small>笔 · ${fmtMoney(dedSum)}</small></div><div class="foot">名师课专用余额扣减</div></div>
          <div class="card stat-card"><div class="label">今日充值</div><div class="value">${fmtMoney(recSum)}</div><div class="foot">${recToday.length} 笔兑换</div></div>
          <div class="card stat-card"><div class="label">余额总池</div><div class="value">${fmtMoney(pool)}</div><div class="foot">${students.length} 名在册学员</div></div>
          <div class="card stat-card"><div class="label">有效资格</div><div class="value">${elig.length}</div><div class="foot">学员 × 名师班绑定</div></div>
        </div>

        <div class="section-title"><h3>低余额提醒</h3><span class="hint">低于 ¥15，建议提醒续兑</span></div>
        ${lowStu.length === 0 ? '<div class="card"><div class="empty">暂无低余额学员</div></div>' : `
        <div class="card list-card">
          ${lowStu.slice(0, 8).map(({ s, bal }) => `
            <button class="row-item" data-stu="${s.id}">
              <div class="avatar ${avatarColor(s.id)}">${esc((s.name || '?').slice(0, 1))}</div>
              <div class="grow"><div class="t1">${esc(s.name)}</div><div class="t2">${esc(s.campus || '')}</div></div>
              <span class="money money-cinnabar">${fmtMoney(bal)}</span>
              <span class="arrow">›</span>
            </button>`).join('')}
        </div>`}

        <div class="section-title"><h3>课时券</h3><span class="hint">每学员累计限 4 张</span><span class="spacer"></span><a class="link" href="#/voucher">管理</a></div>
        <div class="card list-card" style="margin-bottom:16px">
          <button class="row-item" onclick="location.hash='#/voucher'">
            <div class="avatar c3">券</div>
            <div class="grow"><div class="t1">有效发放 ${vouTotal} · 已用 ${vouUsed} · 剩余 ${vouTotal - vouUsed}${vouVoided ? ' · 已作废 ' + vouVoided : ''}</div><div class="t2">纸质课时券已停用，统一线上发放与核销</div></div>
            <span class="arrow">›</span>
          </button>
        </div>

        <div class="section-title"><h3>最近流水</h3><span class="spacer"></span><a class="link" href="#/logs">全部流水</a></div>
        <div class="card list-card">
          ${allTxns.slice(0, 6).map((t) => txnRow(t, stuMap, null, false)).join('') || '<div class="empty">暂无流水记录</div>'}
        </div>
      `, 'admin')

      $app.querySelectorAll('[data-stu]').forEach((el) => { el.onclick = () => { location.hash = '#/students?focus=' + el.dataset.stu } })
    } catch (e) {
      mount(pageError(e), 'admin')
    }
  }

  /* ==================== 流水行组件 ==================== */
  function txnRow(t, stuMap, clsMap, canVoid) {
    const stu = stuMap && stuMap[t.student_id]
    const cls = clsMap && clsMap[t.class_id]
    const meta = [
      stu ? stu.name : ('学员#' + t.student_id),
      cls ? cls.name : (t.note || ''),
      t.type === 'deduct' && t.class_date ? fmtDate(t.class_date) : '',
      fmtDT(t.created_at),
      t.operator ? '操作：' + t.operator : '',
    ].filter(Boolean).join(' · ')
    const ico = t.type === 'recharge' ? ['recharge', '充'] : t.type === 'deduct' ? ['deduct', '销'] : ['void', '退']
    const amt = t.type === 'deduct'
      ? `<div class="amt neg">−${fmtMoney(t.amount)}</div>`
      : `<div class="amt pos">+${fmtMoney(t.amount)}</div>`
    const extra = t.type === 'void' && t.void_reason ? `<div class="t2">作废原因：${esc(t.void_reason)}</div>` : ''
    return `
      <div class="txn-row">
        <div class="txn-ico ${ico[0]}">${ico[1]}</div>
        <div class="info">
          <div class="t1">${t.type === 'recharge' ? '积分兑换充值' : t.type === 'deduct' ? '上课核销' : '作废退回'}</div>
          <div class="t2">${esc(meta)}</div>
          ${extra}
        </div>
        <div>
          ${amt}
          ${canVoid && t.type === 'deduct' ? `<div style="margin-top:4px"><button class="btn btn-ghost btn-sm" data-void="${t.id}">作废</button></div>` : ''}
        </div>
      </div>`
  }

  /* ==================== 视图：流水 ==================== */
  const logsFilter = { type: 'all', range: 'all', kw: '' }
  async function vLogs() {
    clearTimers()
    mount(skeletonRows(5), 'logs')
    try {
      const [txns, students, classes] = await Promise.all([
        select((t) => t('transactions').select('*').order('created_at', { ascending: false }).limit(800)),
        select((t) => t('students').select('*')),
        select((t) => t('classes').select('*')),
      ])
      const stuMap = Object.fromEntries(students.map((s) => [s.id, s]))
      const clsMap = Object.fromEntries(classes.map((c) => [c.id, c]))
      renderLogs(txns, stuMap, clsMap)
    } catch (e) {
      mount(pageError(e), 'logs')
    }

    function renderLogs(txns, stuMap, clsMap) {
      const isAdmin = isMgr()
      let rows = txns
      if (logsFilter.type !== 'all') rows = rows.filter((t) => t.type === logsFilter.type)
      if (logsFilter.range === 'today' && state.now) rows = rows.filter((t) => String(t.class_date || '').slice(0, 10) === state.now.dateStr || String(t.created_at).slice(0, 10) === state.now.dateStr)
      if (logsFilter.range === '7d' && state.now) {
        const since = new Date(new Date(state.now.dateStr).getTime() - 6 * 86400000).toISOString().slice(0, 10)
        rows = rows.filter((t) => String(t.created_at).slice(0, 10) >= since)
      }
      if (logsFilter.kw) {
        const kw = logsFilter.kw.toLowerCase()
        rows = rows.filter((t) => {
          const s = stuMap[t.student_id]
          return s && (s.name.toLowerCase().includes(kw) || (s.parent_phone || '').includes(kw))
        })
      }

      mount(`
        <div class="toolbar" style="margin-top:4px">
          <input id="log-kw" placeholder="搜索学员姓名 / 手机号" value="${esc(logsFilter.kw)}">
          <button class="btn btn-dark btn-sm" id="log-export" style="flex-shrink:0">导出 CSV</button>
        </div>
        <div class="filter-bar">
          ${[['all', '全部'], ['deduct', '核销'], ['recharge', '充值'], ['void', '作废']].map(([k, l]) => `<button class="fchip ${logsFilter.type === k ? 'on' : ''}" data-type="${k}">${l}</button>`).join('')}
          <span style="flex:1"></span>
          ${[['all', '全部时间'], ['today', '今天'], ['7d', '近 7 天']].map(([k, l]) => `<button class="fchip ${logsFilter.range === k ? 'on' : ''}" data-range="${k}">${l}</button>`).join('')}
        </div>
        <div class="card list-card">
          ${rows.length === 0 ? '<div class="empty">没有符合条件的流水</div>' : rows.slice(0, 200).map((t) => txnRow(t, stuMap, clsMap, isAdmin)).join('')}
        </div>
        ${rows.length > 200 ? `<p style="text-align:center;color:var(--ink-faint);font-size:.76rem;margin-top:12px">仅显示前 200 条，可用筛选或导出查看全部</p>` : ''}
      `, 'logs')

      $app.querySelectorAll('[data-type]').forEach((b) => { b.onclick = () => { logsFilter.type = b.dataset.type; renderLogs(txns, stuMap, clsMap) } })
      $app.querySelectorAll('[data-range]').forEach((b) => { b.onclick = () => { logsFilter.range = b.dataset.range; renderLogs(txns, stuMap, clsMap) } })
      const kwInput = document.getElementById('log-kw')
      kwInput.oninput = () => { logsFilter.kw = kwInput.value.trim(); renderLogsDebounced(txns, stuMap, clsMap) }
      let deb = null
      function renderLogsDebounced(a, b2, c) { clearTimeout(deb); deb = setTimeout(() => renderLogs(a, b2, c), 300) }

      document.getElementById('log-export').onclick = () => {
        const header = '流水号,类型,学员,班级,课次日期,金额,积分,操作人,时间,备注,作废原因\n'
        const line = rows.map((t) => [
          t.id, t.type, stuMap[t.student_id] ? stuMap[t.student_id].name : t.student_id,
          clsMap[t.class_id] ? clsMap[t.class_id].name : '', t.class_date || '', t.amount, t.points || '',
          t.operator || '', fmtDT(t.created_at), (t.note || '').replace(/,/g, '，'), (t.void_reason || '').replace(/,/g, '，'),
        ].join(',')).join('\n')
        const blob = new Blob(['﻿' + header + line], { type: 'text/csv;charset=utf-8' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `券类流水_${new Date().toISOString().slice(0, 10)}.csv`
        a.click()
        URL.revokeObjectURL(a.href)
        toast('已导出 ' + rows.length + ' 条流水', 'ok')
      }

      $app.querySelectorAll('[data-void]').forEach((btn) => {
        btn.onclick = async () => {
          const tid = +btn.dataset.void
          const s = openSheet(`
            <h3>作废核销记录</h3>
            <div class="field"><label>作废原因（必填，将留痕并自动退回余额）</label>
              <textarea id="void-reason" rows="3" placeholder="例如：误操作，学员实际上课账户扣费"></textarea></div>
            <div class="sheet-actions">
              <button class="btn btn-ghost" data-act="cancel">取消</button>
              <button class="btn btn-primary" data-act="ok">确认作废并退回</button>
            </div>`)
          s.el.querySelector('[data-act=cancel]').onclick = s.close
          s.el.querySelector('[data-act=ok]').onclick = async () => {
            const reason = s.el.querySelector('#void-reason').value.trim()
            if (!reason) { toast('请填写作废原因', 'err'); return }
            try {
              const res = await rpc('void_transaction', { p_txn_id: tid, p_reason: reason })
              s.close()
              toast('已作废并退回余额，当前余额 ' + fmtMoney(res.balance), 'ok')
              vLogs()
            } catch (e) { toast(e.message, 'err') }
          }
        }
      })
    }
  }

  /* ==================== 视图：学员管理 ==================== */
  async function vStudents(focusId) {
    clearTimers()
    mount(skeletonRows(5), 'students')
    try {
      const [students, wallets, elig, classes] = await Promise.all([
        select((t) => t('students').select('*').order('id', { ascending: false })),
        select((t) => t('wallets').select('*')),
        select((t) => t('student_eligibility').select('*')),
        select((t) => t('classes').select('*').eq('active', true)),
      ])
      const walMap = Object.fromEntries(wallets.map((w) => [w.student_id, w]))
      const eligByStu = {}
      elig.forEach((e) => { (eligByStu[e.student_id] = eligByStu[e.student_id] || []).push(e) })

      mount(`
        <div class="toolbar" style="margin-top:4px">
          <input id="stu-kw" placeholder="搜索学员姓名 / 手机号">
          <button class="btn btn-primary btn-sm" id="stu-add" style="flex-shrink:0">＋ 新增学员</button>
        </div>
        <div class="card list-card" id="stu-list"></div>
      `, 'students')

      function renderList() {
        const kw = (document.getElementById('stu-kw').value || '').trim().toLowerCase()
        const rows = students.filter((s) => !kw || s.name.toLowerCase().includes(kw) || (s.parent_phone || '').includes(kw))
        document.getElementById('stu-list').innerHTML = rows.length === 0
          ? '<div class="empty">没有匹配的学员</div>'
          : rows.map((s) => {
            const bal = Number((walMap[s.id] || {}).balance || 0)
            const activeElig = (eligByStu[s.id] || []).filter((e) => e.active).length
            return `
              <button class="row-item" data-stu="${s.id}" style="${s.active ? '' : 'opacity:.5'}">
                <div class="avatar ${avatarColor(s.id)}">${esc((s.name || '?').slice(0, 1))}</div>
                <div class="grow">
                  <div class="t1">${esc(s.name)} ${s.active ? '' : '<span class="chip chip-ink">已停用</span>'}</div>
                  <div class="t2">${esc(s.campus || '')} · ${activeElig} 个名师班资格</div>
                </div>
                <span class="money ${bal < 15 ? 'money-cinnabar' : ''}">${fmtMoney(bal)}</span>
                <span class="arrow">›</span>
              </button>`
          }).join('')
        $app.querySelectorAll('#stu-list [data-stu]').forEach((el) => { el.onclick = () => openStudent(+el.dataset.stu) })
      }
      document.getElementById('stu-kw').oninput = renderList
      renderList()
      if (focusId) openStudent(+focusId)

      document.getElementById('stu-add').onclick = () => openStudent(null)

      function openStudent(sid) {
        const s = sid ? students.find((x) => x.id === sid) : null
        const sheet = openSheet(`
          <h3>${s ? '学员详情' : '新增学员'}</h3>
          <div class="field"><label>姓名</label><input id="f-name" value="${esc(s ? s.name : '')}"></div>
          <div class="field-row">
            <div class="field"><label>校区</label>
              <select id="f-campus">${CAMPUS.map((c) => `<option ${s && s.campus === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
            </div>
            <div class="field"><label>家长手机号</label><input id="f-phone" inputmode="tel" value="${esc(s ? s.parent_phone || '' : '')}" placeholder="用于家长自助查询"></div>
          </div>
          <div class="field"><label>备注</label><input id="f-note" value="${esc(s ? s.note || '' : '')}" placeholder="选填"></div>
          ${s ? `
          <div class="field" style="display:flex;align-items:center;justify-content:space-between">
            <label style="margin:0">学员状态</label>
            <label class="switch"><input type="checkbox" id="f-active" ${s.active ? 'checked' : ''}><span class="track"></span></label>
          </div>
          <div class="section-title" style="margin:18px 0 8px"><h3 style="font-size:.95rem">名师班资格</h3><span class="hint">开启后出现在老师核销名单</span></div>
          <div id="f-elig">
            ${classes.map((c) => {
              const row = (eligByStu[s.id] || []).find((e) => e.class_id === c.id)
              const on = row ? row.active : false
              return `
                <div class="field" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
                  <span style="font-size:.86rem">${esc(c.name)} <span class="chip chip-gold">${fmtMoney(c.price_per_session)}/次</span></span>
                  <label class="switch"><input type="checkbox" data-elig="${c.id}" ${on ? 'checked' : ''}><span class="track"></span></label>
                </div>`
            }).join('')}
          </div>` : ''}
          <div class="sheet-actions">
            ${s ? '<button class="btn btn-jade" data-act="recharge" style="flex:1">兑换充值</button>' : ''}
            <button class="btn btn-dark" data-act="save" style="flex:${s ? 2 : 1}">${s ? '保存' : '创建学员'}</button>
          </div>
        `)

        sheet.el.querySelector('[data-act=save]').onclick = async () => {
          const name = sheet.el.querySelector('#f-name').value.trim()
          if (!name) { toast('请填写姓名', 'err'); return }
          try {
            const newId = await rpc('upsert_student', {
              p_id: s ? s.id : null,
              p_name: name,
              p_campus: sheet.el.querySelector('#f-campus').value,
              p_parent_phone: sheet.el.querySelector('#f-phone').value.trim(),
              p_note: sheet.el.querySelector('#f-note').value.trim(),
              p_active: s ? sheet.el.querySelector('#f-active').checked : true,
            })
            if (s) {
              for (const cb of sheet.el.querySelectorAll('[data-elig]')) {
                await rpc('set_eligibility', { p_student_id: s.id, p_class_id: +cb.dataset.elig, p_active: cb.checked })
              }
            }
            sheet.close()
            toast(s ? '已保存' : '已创建学员', 'ok')
            vStudents(s ? s.id : newId)
          } catch (e) { toast(e.message, 'err') }
        }

        const rbtn = sheet.el.querySelector('[data-act=recharge]')
        if (rbtn) rbtn.onclick = () => openRecharge(s)
      }

      function openRecharge(s) {
        const bal = Number((walMap[s.id] || {}).balance || 0)
        const sheet = openSheet(`
          <h3>兑换充值 · ${esc(s.name)}</h3>
          <p style="font-size:.86rem;color:var(--ink-soft);margin-bottom:14px">当前余额 <b class="money">${fmtMoney(bal)}</b>　<span style="color:var(--ink-faint)">前提：已在易知鸟完成积分扣减</span></p>
          <div class="field-row">
            <div class="field"><label>充值金额（元）</label><input id="r-amount" type="number" min="1" step="1" value="300"></div>
            <div class="field"><label>扣减积分</label><input id="r-points" type="number" min="0" step="1" value="300"></div>
          </div>
          <div class="field"><label>备注</label><input id="r-note" placeholder="例如：300积分兑换名师课额度"></div>
          <label style="display:flex;gap:8px;align-items:flex-start;font-size:.84rem;color:var(--ink-soft);margin:6px 0 4px">
            <input type="checkbox" id="r-confirm" style="margin-top:3px;width:16px;height:16px">
            <span>已确认该学员在<b>易知鸟</b>完成积分扣减，金额与积分一致</span>
          </label>
          <div class="sheet-actions">
            <button class="btn btn-ghost" data-act="cancel">取消</button>
            <button class="btn btn-jade" data-act="ok">确认充值</button>
          </div>`)
        sheet.el.querySelector('[data-act=cancel]').onclick = s.close
        sheet.el.querySelector('[data-act=ok]').onclick = async () => {
          if (!sheet.el.querySelector('#r-confirm').checked) { toast('请先勾选「已在易知鸟扣积分」', 'err'); return }
          const amount = Number(sheet.el.querySelector('#r-amount').value)
          if (!amount || amount <= 0) { toast('请输入正确的充值金额', 'err'); return }
          try {
            const res = await rpc('recharge_wallet', {
              p_student_id: s.id, p_amount: amount,
              p_points: Number(sheet.el.querySelector('#r-points').value) || null,
              p_note: sheet.el.querySelector('#r-note').value.trim() || null,
            })
            sheet.close()
            showResult({ title: '充值成功', desc: `${s.name} 专用余额已到账`, balance: res.balance })
            vStudents(s.id)
          } catch (e) { toast(e.message, 'err') }
        }
      }
    } catch (e) {
      mount(pageError(e), 'students')
    }
  }

  /* ==================== 视图：班级管理 ==================== */
  async function vClasses() {
    clearTimers()
    mount(skeletonRows(5), 'classes')
    try {
      const [classes, tiers, mentors] = await Promise.all([
        select((t) => t('classes').select('*').order('weekday').order('start_time')),
        select((t) => t('course_tiers').select('*').eq('active', true).order('sort_order')),
        select((t) => t('mentors').select('*').eq('active', true).order('created_at', { ascending: true })),
      ])
      const classRow = (c) => `
            <button class="row-item" data-cls="${c.id}" style="${c.active ? '' : 'opacity:.5'}">
              <div class="grow">
                <div class="t1">${esc(c.name)} ${c.tier_type === '校长班' ? '<span class="chip chip-gold">校长班</span>' : '<span class="chip chip-cinnabar">名师班</span>'} ${c.active ? '' : '<span class="chip chip-ink">已停用</span>'}</div>
                <div class="t2">${WEEK[c.weekday]} ${String(c.start_time).slice(0, 5)}–${String(c.end_time).slice(0, 5)} · ${esc(c.campus || '')} · ${esc(c.teacher_name || '未指定师资')}</div>
              </div>
              <span class="chip chip-cinnabar">${fmtMoney(c.price_per_session)}/次</span>
              <span class="arrow">›</span>
            </button>`
      const classSection = (cat, label) => {
        const all = classes.filter((c) => (c.category || '硬笔') === cat)
        const list = state.showInactive ? all : all.filter((c) => c.active)
        return `
        <div class="section-title" style="margin-top:18px"><h3>${label}</h3><span class="hint">${list.length} 个班级${state.showInactive && all.length !== list.length ? `（隐藏 ${all.length - list.length} 个已停用）` : ''}</span></div>
        <div class="card list-card">
          ${list.length === 0 ? `<div class="empty">暂无${label}，点右上角「新增班级」创建</div>` : list.map(classRow).join('')}
        </div>`
      }
      const tierSection = (cat, title, src) => `
        <details class="tier-details">
          <summary><span class="t1">${title}</span><span class="hint">${src}</span><span class="arrow">›</span></summary>
          <div class="card list-card tier-card">
            ${tiers.filter((r) => r.category === cat).map((r) => `
              <div class="row-item" style="cursor:default">
                <div class="grow">
                  <div class="t1">${esc(r.level_name)} ${r.stage ? `<span class="chip chip-ink">${esc(r.stage)}</span>` : ''}</div>
                  <div class="t2">${esc(r.professional_name || '')} · ${r.target_sessions ? r.target_sessions + ' 课次 · ' : ''}正价 ¥${fmtMoney(r.base_price)}${r.grade ? ' · ' + esc(r.grade) : ''}</div>
                </div>
                <span class="chip chip-gold">校长 +${fmtMoney(r.principal_extra)}</span>
                <span class="chip chip-cinnabar">名师 +${fmtMoney(r.master_extra)}</span>
              </div>`).join('')}
          </div>
        </details>`
      mount(`
        <div class="toolbar" style="margin-top:4px">
          <input placeholder="共 ${classes.length} 个班级" disabled style="color:var(--ink-faint)">
          <button class="btn btn-ghost btn-sm" id="cls-toggle-inactive" style="flex-shrink:0">${state.showInactive ? '隐藏已停用' : '显示已停用'}</button>
          <button class="btn btn-primary btn-sm" id="cls-add" style="flex-shrink:0">＋ 新增班级</button>
        </div>
        ${classSection('硬笔', '硬笔体系班级')}
        ${classSection('毛笔', '毛笔体系班级')}
        <div class="section-title" style="margin-top:26px"><h3>课程体系档位参考</h3><span class="hint">定价依据，建班时按档位带入</span></div>
        ${tierSection('硬笔', '硬笔课程体系 · 档位一览', '教培机构课程体系一览表（教材另扣费）')}
        ${tierSection('毛笔', '毛笔课程体系 · 档位一览', '毛笔课程体系校长名师收费表')}`, 'classes')

      document.getElementById('cls-add').onclick = () => openClass(null)
      document.getElementById('cls-toggle-inactive').onclick = () => { state.showInactive = !state.showInactive; vClasses() }
      $app.querySelectorAll('[data-cls]').forEach((el) => { el.onclick = () => openClass(+el.dataset.cls) })

      function openClass(cid) {
        const c = cid ? classes.find((x) => x.id === cid) : null
        const catSel = esc(c ? (c.category || '硬笔') : '硬笔')
        const typeSel = c ? (c.tier_type || '名师班') : '名师班'
        const sheet = openSheet(`
          <h3>${c ? '编辑班级' : '新增班级'}</h3>
          <div class="field-row">
            <div class="field"><label>书体体系</label>
              <select id="c-cat"><option ${catSel === '硬笔' ? 'selected' : ''}>硬笔</option><option ${catSel === '毛笔' ? 'selected' : ''}>毛笔</option></select>
            </div>
            <div class="field"><label>班型</label>
              <select id="c-type"><option ${typeSel === '名师班' ? 'selected' : ''}>名师班</option><option ${typeSel === '校长班' ? 'selected' : ''}>校长班</option></select>
            </div>
          </div>
          <div class="field"><label>从课程体系带入（选档位自动填名称和价格）</label>
            <select id="c-tier">
              <option value="">— 手动填写 —</option>
              ${tiers.filter((r) => r.category === catSel).map((r) => `<option value="${r.id}" data-name="${esc(r.level_name)}" data-pm="${r.master_extra}" data-pp="${r.principal_extra}">${esc(r.level_name)} · ${esc(r.professional_name || '')}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>班级名称</label><input id="c-name" value="${esc(c ? c.name : '')}" placeholder="例如：笔画进阶筑基班·名师班"></div>
          <div class="field-row">
            <div class="field"><label>校区</label><select id="c-campus">${CAMPUS.map((x) => `<option ${c && c.campus === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
            <div class="field"><label>任课师资（来自师资名册）</label>
              <select id="c-mentor">
                <option value="">— 未指定 —</option>
                ${mentors.map((m) => `<option value="${m.id}" ${c && c.mentor_id === m.id ? 'selected' : ''}>${esc(m.name)} · ${m.title}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="field-row">
            <div class="field"><label>上课日</label>
              <select id="c-weekday">${WEEK.map((w, i) => `<option value="${i}" ${c && c.weekday === i ? 'selected' : ''}>${w}</option>`).join('')}</select>
            </div>
            <div class="field"><label>开始</label><input id="c-start" type="time" value="${c ? String(c.start_time).slice(0, 5) : '16:30'}"></div>
            <div class="field"><label>结束</label><input id="c-end" type="time" value="${c ? String(c.end_time).slice(0, 5) : '18:00'}"></div>
          </div>
          <div class="field"><label>单次核销金额（元）</label><input id="c-price" type="number" min="0" step="1" value="${c ? c.price_per_session : 10}"></div>
          ${c ? `
          <div class="field" style="display:flex;align-items:center;justify-content:space-between">
            <label style="margin:0">班级启用</label>
            <label class="switch"><input type="checkbox" id="c-active" ${c.active ? 'checked' : ''}><span class="track"></span></label>
          </div>` : ''}
          <div class="sheet-actions">
            <button class="btn btn-ghost" data-act="cancel">取消</button>
            <button class="btn btn-dark" data-act="save">${c ? '保存' : '创建'}</button>
          </div>
          ${c ? '<button class="btn btn-danger-text btn-block" data-act="del" style="margin-top:4px">删除该班级</button>' : ''}`)
        sheet.el.querySelector('[data-act=cancel]').onclick = sheet.close
        const delBtn = sheet.el.querySelector('[data-act=del]')
        if (delBtn) delBtn.onclick = async () => {
          if (!window.confirm(`确定删除「${c.name}」？\n仅从未产生流水的班级可删除；删除后不可恢复。`)) return
          try {
            await rpc('delete_class', { p_id: c.id })
            sheet.close()
            toast('班级已删除', 'ok')
            vClasses()
          } catch (e) { toast(e.message, 'err') }
        }

        const applyTier = () => {
          const opt = sheet.el.querySelector('#c-tier').selectedOptions[0]
          if (!opt || !opt.dataset.name) return
          const type = sheet.el.querySelector('#c-type').value
          sheet.el.querySelector('#c-name').value = opt.dataset.name + '·' + type
          sheet.el.querySelector('#c-price').value = type === '校长班' ? opt.dataset.pp : opt.dataset.pm
        }
        sheet.el.querySelector('#c-tier').onchange = applyTier
        sheet.el.querySelector('#c-type').onchange = applyTier
        sheet.el.querySelector('#c-cat').onchange = () => {
          const cat = sheet.el.querySelector('#c-cat').value
          const sel = sheet.el.querySelector('#c-tier')
          sel.innerHTML = '<option value="">— 手动填写 —</option>' +
            tiers.filter((r) => r.category === cat).map((r) => `<option value="${r.id}" data-name="${esc(r.level_name)}" data-pm="${r.master_extra}" data-pp="${r.principal_extra}">${esc(r.level_name)} · ${esc(r.professional_name || '')}</option>`).join('')
          sel.onchange = applyTier
        }

        sheet.el.querySelector('[data-act=save]').onclick = async () => {
          const name = sheet.el.querySelector('#c-name').value.trim()
          const start = sheet.el.querySelector('#c-start').value
          const end = sheet.el.querySelector('#c-end').value
          if (!name) { toast('请填写班级名称', 'err'); return }
          if (!start || !end) { toast('请设置上课时间', 'err'); return }
          try {
            await rpc('upsert_class', {
              p_id: c ? c.id : null, p_name: name,
              p_campus: sheet.el.querySelector('#c-campus').value,
              p_mentor_id: sheet.el.querySelector('#c-mentor').value ? +sheet.el.querySelector('#c-mentor').value : null,
              p_weekday: +sheet.el.querySelector('#c-weekday').value,
              p_start: start + ':00', p_end: end + ':00',
              p_price: Number(sheet.el.querySelector('#c-price').value) || 0,
              p_active: c ? sheet.el.querySelector('#c-active').checked : true,
              p_category: sheet.el.querySelector('#c-cat').value,
              p_tier_type: sheet.el.querySelector('#c-type').value,
            })
            sheet.close()
            toast('已保存', 'ok')
            vClasses()
          } catch (e) { toast(e.message, 'err') }
        }
      }
    } catch (e) {
      mount(pageError(e), 'classes')
    }
  }

  /* ==================== 视图：师资管理（名师/校长名册） ==================== */
  async function vMentors() {
    clearTimers()
    mount(skeletonRows(4), 'mentors')
    try {
      const mentors = await select((t) => t('mentors').select('*').order('created_at', { ascending: true }))
      mount(`
        <div class="section-title" style="margin-top:4px"><h3>师资名册</h3><span class="hint">名师/校长在此维护，建班时直接选用；改名自动同步到所有班级</span></div>
        <div class="toolbar">
          <input placeholder="共 ${mentors.length} 位师资" disabled style="color:var(--ink-faint)">
          <button class="btn btn-primary btn-sm" id="m-add" style="flex-shrink:0">＋ 新增师资</button>
        </div>
        <div class="card list-card">
          ${mentors.length === 0 ? '<div class="empty">暂无师资，点击右上角新增</div>' : mentors.map((m) => `
            <button class="row-item" data-m="${m.id}" style="${m.active ? '' : 'opacity:.5'}">
              <div class="grow">
                <div class="t1">${esc(m.name)} ${m.title === '校长' ? '<span class="chip chip-gold">校长</span>' : '<span class="chip chip-cinnabar">名师</span>'} ${m.active ? '' : '<span class="chip chip-ink">已停用</span>'}</div>
                <div class="t2">${esc(m.phone || '未留电话')}</div>
              </div>
              <span class="arrow">›</span>
            </button>`).join('')}
        </div>`, 'mentors')

      document.getElementById('m-add').onclick = () => openMentor(null)
      $app.querySelectorAll('[data-m]').forEach((el) => { el.onclick = () => openMentor(+el.dataset.m) })

      function openMentor(mid) {
        const m = mid ? mentors.find((x) => x.id === mid) : null
        const sheet = openSheet(`
          <h3>${m ? '编辑师资' : '新增师资'}</h3>
          <div class="field"><label>姓名</label><input id="m-name" value="${esc(m ? m.name : '')}" placeholder="例如：陈老师"></div>
          <div class="field-row">
            <div class="field"><label>头衔</label>
              <select id="m-title"><option ${m && m.title === '名师' ? 'selected' : ''}>名师</option><option ${m && m.title === '校长' ? 'selected' : ''}>校长</option></select>
            </div>
            <div class="field"><label>联系电话（选填）</label><input id="m-phone" value="${esc(m ? m.phone || '' : '')}" placeholder="便于教务联系"></div>
          </div>
          ${m ? `
          <div class="field" style="display:flex;align-items:center;justify-content:space-between">
            <label style="margin:0">在职启用</label>
            <label class="switch"><input type="checkbox" id="m-active" ${m.active ? 'checked' : ''}><span class="track"></span></label>
          </div>` : ''}
          <div class="sheet-actions">
            <button class="btn btn-ghost" data-act="cancel">取消</button>
            <button class="btn btn-dark" data-act="save">${m ? '保存' : '创建'}</button>
          </div>`)
        sheet.el.querySelector('[data-act=cancel]').onclick = sheet.close
        sheet.el.querySelector('[data-act=save]').onclick = async () => {
          const name = sheet.el.querySelector('#m-name').value.trim()
          if (!name) { toast('请填写姓名', 'err'); return }
          try {
            await rpc('upsert_mentor', {
              p_id: m ? m.id : null, p_name: name,
              p_title: sheet.el.querySelector('#m-title').value,
              p_phone: sheet.el.querySelector('#m-phone').value.trim(),
              p_active: m ? sheet.el.querySelector('#m-active').checked : true,
            })
            sheet.close()
            toast('已保存', 'ok')
            vMentors()
          } catch (e) { toast(e.message, 'err') }
        }
      }
    } catch (e) {
      mount(pageError(e), 'mentors')
    }
  }

  /* ==================== 视图：员工与授权 ==================== */
  async function vStaff() {
    clearTimers()
    mount(skeletonRows(4), 'me')
    try {
      const [staff, claims] = await Promise.all([
        select((t) => t('staff').select('*').order('created_at', { ascending: true })),
        rpc('list_claims'),
      ])
      mount(`
        <div class="section-title" style="margin-top:4px"><h3>员工与授权</h3><span class="hint">管理员在此直接开通账号，无需他人注册</span></div>
        <div class="card card-pad" style="margin-bottom:14px">
          <div class="field"><label>姓名</label><input id="i-name" placeholder="例如：王老师"></div>
          <div class="field"><label>登录手机号</label><input id="i-phone" type="tel" maxlength="11" inputmode="numeric" placeholder="11 位手机号"></div>
          <div class="field"><label>角色</label>
            <select id="i-role">
              <option value="teacher">教师（仅可核销）</option>
              <option value="admin">管理员（教务/运营，全部权限）</option>
              ${isSuper() ? '<option value="superadmin">超级管理员（含员工授权）</option>' : ''}
            </select>
          </div>
          <div class="field"><label>初始密码</label><input id="i-pwd" type="text" placeholder="至少 6 位，建议 Zx@手机后6位"></div>
          <button class="btn btn-primary btn-block" id="i-add">开通账号</button>
          <p style="font-size:.75rem;color:var(--ink-faint);margin-top:8px">开通后账号立即可用；若手机号已注册，将直接为其授予所选角色</p>
        </div>
        ${claims && claims.length ? `
        <div class="section-title"><h3>待认领邀请（旧）</h3></div>
        <div class="card list-card" style="margin-bottom:14px">
          ${claims.map((c) => `<div class="txn-row"><div class="txn-ico recharge">邀</div><div class="info"><div class="t1">${esc(c.name)}</div><div class="t2">${esc(c.phone || c.email)} · ${roleLabel(c.role)}</div></div></div>`).join('')}
        </div>` : ''}
        <div class="section-title"><h3>在职员工</h3></div>
        <div class="card list-card">
          ${staff.map((m) => `
            <div class="txn-row">
              <div class="txn-ico ${(m.role === 'admin' || m.role === 'superadmin') ? 'deduct' : 'recharge'}">${esc((m.name || '?').slice(0, 1))}</div>
              <div class="info">
                <div class="t1">${esc(m.name)} <span class="chip ${(m.role === 'admin' || m.role === 'superadmin') ? 'chip-cinnabar' : 'chip-jade'}">${roleLabel(m.role)}</span>${m.active ? '' : ' <span class="chip">已停用</span>'}</div>
                <div class="t2">${esc(m.phone || m.email || '')}</div>
              </div>
              <label class="switch"><input type="checkbox" data-staff-active="${esc(m.owner_id)}" ${m.active ? 'checked' : ''}><span class="track"></span></label>
            </div>`).join('')}
        </div>
        <p style="text-align:center;margin-top:18px"><a class="link" href="#/me" style="font-size:.84rem">返回「我的」</a></p>
      `, 'me')

      document.getElementById('i-add').onclick = async () => {
        const btn = document.getElementById('i-add')
        const name = document.getElementById('i-name').value.trim()
        const phone = document.getElementById('i-phone').value.trim()
        const role = document.getElementById('i-role').value
        const pwd = document.getElementById('i-pwd').value
        if (!name || !/^1\d{10}$/.test(phone)) { toast('请填写姓名和正确的 11 位手机号', 'err'); return }
        if (pwd.length < 6) { toast('初始密码至少 6 位', 'err'); return }
        btn.disabled = true; btn.textContent = '开通中…'
        try {
          /* 先走注册接口（一步建号+授权）；已注册则走授权函数 */
          const token = (() => { try { return localStorage.getItem('zb_token') } catch (_) { return null } })()
          const res = await fetch('/api/quan/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
            body: JSON.stringify({ phone, password: pwd, name, role }),
          })
          const body = await res.json().catch(() => null)
          if (res.ok && body && body.user) {
            toast(`已开通「${roleLabel(role)}」账号：${phone}，可立即登录`, 'ok')
            vStaff()
            return
          }
          const msg = (body && body.error && body.error.message) || ('HTTP ' + res.status)
          if (res.status === 409) {
            /* 手机号已注册（如家长账号）→ 直接授予角色 */
            await rpc('grant_staff', { p_phone: phone, p_name: name, p_role: role })
            toast(`该手机号已注册，已直接授予「${roleLabel(role)}」角色`, 'ok')
            vStaff()
            return
          }
          toast(msg, 'err')
        } catch (e) {
          toast(e.message, 'err')
        } finally {
          btn.disabled = false; btn.textContent = '开通账号'
        }
      }
      $app.querySelectorAll('[data-staff-active]').forEach((cb) => {
        cb.onchange = async () => {
          try {
            await rpc('set_staff_active', { p_owner_id: cb.dataset.staffActive, p_active: cb.checked })
            toast(cb.checked ? '已启用' : '已停用', 'ok')
          } catch (e) { toast(e.message, 'err'); cb.checked = !cb.checked }
        }
      })
    } catch (e) {
      mount(pageError(e), 'me')
    }
  }

  /* ==================== 视图：我的 ==================== */
  function vMe() {
    clearTimers()
    const isAdmin = isMgr()
    mount(`
      <div class="card card-pad" style="margin-top:4px;display:flex;align-items:center;gap:14px">
        <div class="avatar ${avatarColor((state.staff.name || '').length)}">${esc((state.staff.name || '?').slice(0, 1))}</div>
        <div style="flex:1">
          <div style="font-weight:700;font-size:1.02rem">${esc(state.staff.name)}</div>
          <div style="font-size:.78rem;color:var(--ink-faint)">${esc(state.user && state.user.phone || '')}</div>
        </div>
        <span class="chip ${isAdmin ? 'chip-cinnabar' : 'chip-jade'}">${roleLabel(state.staff.role)}</span>
      </div>
      <div class="card list-card" style="margin-top:14px">
        ${isAdmin ? `<button class="row-item" onclick="location.hash='#/staff'"><div class="grow"><div class="t1">员工与授权</div><div class="t2">开通账号、授予角色、管理员工</div></div><span class="arrow">›</span></button>` : ''}
        <button class="row-item" onclick="location.hash='#/parent'"><div class="grow"><div class="t1">家长查询页</div><div class="t2">查看家长看到的余额与流水界面</div></div><span class="arrow">›</span></button>
      </div>
      <div class="card card-pad" style="margin-top:14px;font-size:.78rem;color:var(--ink-faint);line-height:1.8">
        <b style="color:var(--ink-soft)">核销规则</b><br>
        · 核销窗口：课前 15 分钟至下课（服务端时间判定）<br>
        · 同一学员同一节课每天仅可核销一次<br>
        · 所有流水只增不改；作废需填原因并自动退回余额<br>
        · 余额不足时无法核销，需先由教务兑换充值
      </div>
      <button class="btn btn-ghost btn-block" id="btn-logout" style="margin-top:16px">退出登录</button>
    `, 'me')
    document.getElementById('btn-logout').onclick = doLogout
  }

  /* ==================== 视图：家长查询 ==================== */
  function vParent() {
    clearTimers()
    $app.innerHTML = `
      <div class="auth-wrap" style="max-width:460px">
        <div class="parent-hero">
          <div class="seal seal-lg" style="margin:0 auto">泽</div>
          <h1 style="font-family:var(--ff-serif);font-size:1.35rem;letter-spacing:.2em;margin-top:16px">名师课余额查询</h1>
          <p style="color:var(--ink-faint);font-size:.8rem;margin-top:6px;letter-spacing:.1em">教培机构 · 券类管理系统</p>
        </div>
        <div class="card card-pad">
          <div class="field"><label>学员姓名</label><input id="p-name" placeholder="孩子报名时登记的姓名"></div>
          <div class="field"><label>家长手机号</label><input id="p-phone" inputmode="tel" placeholder="登记在教务处的手机号"></div>
          <button class="btn btn-dark btn-block" id="p-go">查询余额</button>
          <p style="font-size:.72rem;color:var(--ink-faint);margin-top:12px;text-align:center">信息仅用于核对学员身份，不会对外展示</p>
        </div>
        <div id="p-result" style="margin-top:16px"></div>
        <div class="auth-foot">
          ${state.staff ? '<a href="#/today">返回系统</a>' : '<a href="#/login">教职员工登录</a>'}
        </div>
      </div>`

    document.getElementById('p-go').onclick = doParentQuery
    document.getElementById('p-phone').onkeydown = (e) => { if (e.key === 'Enter') doParentQuery() }

    async function doParentQuery() {
      const name = document.getElementById('p-name').value.trim()
      const phone = document.getElementById('p-phone').value.trim()
      const box = document.getElementById('p-result')
      if (!name || !phone) { toast('请填写学员姓名和家长手机号', 'err'); return }
      box.innerHTML = '<div class="skeleton" style="height:120px"></div>'
      try {
        const r = await rpc('parent_lookup', { p_phone: phone, p_student_name: name })
        if (!r) {
          box.innerHTML = '<div class="card"><div class="empty"><span class="glyph">询</span>未找到匹配的学员，请核对姓名与手机号<br>或联系教务老师查询</div></div>'
          return
        }
        const txns = r.transactions || []
        const vou = r.vouchers || null
        box.innerHTML = `
          <div class="parent-result-balance">
            <div style="font-size:.86rem;color:rgba(243,239,230,.85)">${esc(r.name)} 的专用余额</div>
            <div class="num">${fmtMoney(r.balance)}</div>
            <div class="lab">名师课兑换额度</div>
          </div>
          ${vou && vou.total > 0 ? `
          <div class="parent-result-balance" style="margin-top:12px;background:linear-gradient(135deg,#31565E,#3E7C4F)">
            <div style="font-size:.86rem;color:rgba(243,239,230,.85)">课时券（每学员累计限 4 张）</div>
            <div class="num">${vou.remaining}<small style="font-size:.85rem;font-family:var(--ff-sans)"> / ${vou.total} 张可用</small></div>
            <div class="lab">已使用 ${vou.used} 张</div>
          </div>
          <div class="card list-card" style="margin-top:12px">
            <div class="section-title" style="padding:12px 14px 0"><h3 style="font-size:.9rem">课时券使用记录</h3></div>
            ${(vou.list || []).length === 0 ? '<div class="empty">尚未使用课时券</div>' : vou.list.map((v) => `
              <div class="txn-row">
                <div class="txn-ico deduct">券</div>
                <div class="info">
                  <div class="t1">课时券核销</div>
                  <div class="t2">${esc([v.used_date ? fmtDate(v.used_date) : '', v.time_slot, v.course_note].filter(Boolean).join(' · '))}</div>
                </div>
                <div class="amt" style="color:var(--ink-faint);font-size:.78rem">${esc(v.code)}</div>
              </div>`).join('')}
          </div>` : ''}
          <div class="card list-card" style="margin-top:${vou && vou.total > 0 ? 12 : 0}px">
            ${txns.length === 0 ? '<div class="empty">暂无使用记录</div>' : txns.map((t) => `
              <div class="txn-row">
                <div class="txn-ico ${t.type === 'recharge' ? 'recharge' : t.type === 'deduct' ? 'deduct' : 'void'}">${t.type === 'recharge' ? '充' : t.type === 'deduct' ? '销' : '退'}</div>
                <div class="info">
                  <div class="t1">${t.type === 'recharge' ? '兑换充值' : t.type === 'deduct' ? '上课核销' : '作废退回'}</div>
                  <div class="t2">${esc([t.class, t.class_date ? fmtDate(t.class_date) : '', fmtDT(t.created_at)].filter(Boolean).join(' · '))}</div>
                </div>
                <div class="amt ${t.type === 'deduct' ? 'neg' : 'pos'}">${t.type === 'deduct' ? '−' : '+'}${fmtMoney(t.amount)}</div>
              </div>`).join('')}
          </div>
          ${Number(r.balance) < 15 ? '<p style="text-align:center;color:var(--cinnabar);font-size:.82rem;margin-top:12px">余额偏低，如需继续使用请联系教务老师兑换积分</p>' : ''}
        `
      } catch (e) {
        box.innerHTML = ''
        toast(e.message, 'err')
      }
    }
  }

  /* ==================== 路由 ==================== */
  async function route() {
    const h = (location.hash || '').replace(/^#\//, '')
    const [path, query] = h.split('?')
    const seg = path.split('/')

    if (seg[0] === 'parent') return vParent()
    if (!state.user) {
      if (seg[0] !== 'login') location.hash = '#/login'
      return vLogin()
    }
    if (!state.staff) {
      if (seg[0] !== 'pending') location.hash = '#/pending'
      return vPending()
    }
    switch (seg[0]) {
      case '': case 'today': return vToday()
      case 'class': return vClass(seg[1])
      case 'admin': return isMgr() ? vAdmin() : vToday()
      case 'logs': return isMgr() ? vLogs() : vToday()
      case 'students': return isMgr() ? vStudents(new URLSearchParams(query || '').get('focus')) : vToday()
      case 'classes': return isMgr() ? vClasses() : vToday()
      case 'mentors': return isMgr() ? vMentors() : vToday()
      case 'voucher': return isMgr() ? vVoucherAdmin() : vVoucherRedeem()
      case 'staff': return isMgr() ? vStaff() : vToday()
      case 'me': return vMe()
      default: location.hash = '#/today'; return
    }
  }

  window.addEventListener('hashchange', route)
  cloud.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') { state.user = null; state.staff = null }
  })

  /* ==================== 启动 ==================== */
  ;(async function boot() {
    try {
      const sd = await cloud.auth.getSession()
      const session = (sd && sd.data && sd.data.session) || null
      if (session && session.user) {
        state.user = session.user
        await loadStaff()
      }
    } catch (_) { /* 未登录或会话失效时按未登录处理 */ }
    if (!location.hash) location.hash = state.user ? '#/today' : '#/login'
    route()
  })()
})()
