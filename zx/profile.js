/* ============================================================
 * 个人资料页（2026-11-04）—— yj / quan / zc 共用
 * 功能：圆形头像（下方显示名字）+ 上传/更换头像 + 修改姓名 + 修改手机号 + 修改密码
 *
 * 用法：
 *   ZXProfile.render(root, {
 *     app: 'yj',                   // 应用标识（决定默认 API 前缀）
 *     token: () => state.token,    // 取 token 的函数
 *     userId: () => state.user.id,
 *     name: () => state.profile.name,
 *     phone: () => state.user.phone,
 *     roleLabel: () => ROLE_NAMES[state.user.role],
 *     onSaved: (user) => { ... }   // 保存成功回调（更新本地用户态）
 *     onAvatar: (url) => { ... }   // 头像更新回调
 *   })
 *
 * 各系统差异用可选配置覆盖（不传则按 yj/quan 约定）：
 *   apiPrefix   API 前缀，默认 '/api/' + app；zc 用 '/api/auth'
 *   phoneField  手机号字段名，默认 'phone'；zc 用 'username'
 *   toast       提示函数，默认用 window.toast / alert
 *   uploadAvatar(blob) / saveProfile(payload) / changePassword(payload)
 *                完全自定义请求（zc 用 JSON base64 上传，与 yj/quan 的 multipart 不同）
 * ============================================================ */
(function (global) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    });
  }

  function say(cfg, msg, kind) {
    if (cfg && typeof cfg.toast === 'function') return cfg.toast(msg, kind);
    if (global.toast) return global.toast(msg, kind);
    global.alert(msg);
  }

  function apiPrefix(cfg) {
    return cfg.apiPrefix || ('/api/' + cfg.app);
  }

  function doUpload(cfg, blob) {
    if (typeof cfg.uploadAvatar === 'function') return cfg.uploadAvatar(blob);
    var fd = new FormData();
    fd.append('file', blob, 'avatar.png');
    return fetch(apiPrefix(cfg) + '/auth/avatar', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + cfg.token() },
      body: fd,
    }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error((d && d.error && d.error.message) || '头像上传失败');
        return d;
      });
    });
  }

  function doSave(cfg, payload) {
    if (typeof cfg.saveProfile === 'function') return cfg.saveProfile(payload);
    return fetch(apiPrefix(cfg) + '/auth/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.token() },
      body: JSON.stringify(payload),
    }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error((d && d.error && d.error.message) || '保存失败');
        return d;
      });
    });
  }

  function doChangePwd(cfg, payload) {
    if (typeof cfg.changePassword === 'function') return cfg.changePassword(payload);
    return fetch(apiPrefix(cfg) + '/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.token() },
      body: JSON.stringify(payload),
    }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error((d && d.error && d.error.message) || '修改失败');
        return d;
      });
    });
  }

  function avatarSrc(cfg, userId, version) {
    if (typeof cfg.avatarUrl === 'function') return cfg.avatarUrl(userId, version);
    if (!userId) return '';
    var base = cfg.apiPrefix || ('/api/' + cfg.app);
    return base + '/avatars/' + encodeURIComponent(userId) + (version ? '?v=' + version : '');
  }

  /** 渲染个人资料页 HTML 到容器 */
  function render(root, cfg) {
    var name = cfg.name() || '';
    var phone = cfg.phone() || '';
    var userId = cfg.userId();
    var src = avatarSrc(cfg, userId, cfg.avatarVersion || '');

    root.innerHTML = [
      '<div class="zx-profile">',
      '  <div class="zx-profile-hero">',
      '    <span class="zx-avatar" id="zxProfAvatar" style="width:96px;height:96px;font-size:38px">',
      src ? '<img src="' + esc(src) + '" alt="" onerror="ZXAvatar.fallback(this)">' : '',
      '      <span class="zx-avatar__txt">' + esc(name.slice(0, 1) || '?') + '</span>',
      '    </span>',
      '    <span class="zx-avatar-name">' + esc(name) + '</span>',
      '    <span class="zx-profile-role">' + esc(cfg.roleLabel()) + '</span>',
      '    <div class="zx-profile-avatar-actions">',
      '      <button class="zx-profile-btn" id="zxProfPick">更换头像</button>',
      '      <input type="file" id="zxProfFile" accept="image/*" hidden>',
      '    </div>',
      '  </div>',

      '  <div class="zx-profile-card">',
      '    <h3>基本资料</h3>',
      '    <div class="zx-profile-field">',
      '      <label>姓名</label>',
      '      <input id="zxProfName" maxlength="30" value="' + esc(name) + '" placeholder="请输入姓名">',
      '    </div>',
      '    <div class="zx-profile-field">',
      '      <label>手机号（登录账号）</label>',
      '      <input id="zxProfPhone" maxlength="11" inputmode="numeric" value="' + esc(phone) + '" placeholder="请输入 11 位手机号">',
      '      <div class="zx-profile-hint">手机号是登录账号。修改后需用新手机号登录，各业务系统同步生效。</div>',
      '    </div>',
      '    <div class="zx-profile-field">',
      '      <label>确认密码（修改手机号时需验证）</label>',
      '      <input id="zxProfOldPwd" type="password" maxlength="200" placeholder="仅修改手机号时需要填写">',
      '    </div>',
      '    <div class="zx-profile-actions">',
      '      <button class="zx-profile-btn zx-profile-btn--primary" id="zxProfSave">保存资料</button>',
      '    </div>',
      '  </div>',

      '  <div class="zx-profile-card">',
      '    <h3>修改密码</h3>',
      '    <div class="zx-profile-field">',
      '      <label>原密码</label>',
      '      <input id="zxPwdOld" type="password" maxlength="200" placeholder="请输入原密码">',
      '    </div>',
      '    <div class="zx-profile-field">',
      '      <label>新密码</label>',
      '      <input id="zxPwdNew" type="password" maxlength="200" placeholder="至少 6 位">',
      '    </div>',
      '    <div class="zx-profile-field">',
      '      <label>确认新密码</label>',
      '      <input id="zxPwdNew2" type="password" maxlength="200" placeholder="再次输入新密码">',
      '    </div>',
      '    <div class="zx-profile-actions">',
      '      <button class="zx-profile-btn zx-profile-btn--primary" id="zxPwdSave">修改密码</button>',
      '    </div>',
      '  </div>',
      '</div>',
    ].join('');

    bind(root, cfg);
  }

  function bind(root, cfg) {
    var pick = root.querySelector('#zxProfPick');
    var file = root.querySelector('#zxProfFile');
    var avatarBox = root.querySelector('#zxProfAvatar');

    // ---- 更换头像 ----
    if (pick && file) {
      pick.onclick = function () { file.click(); };
      file.onchange = function () {
        var f = file.files && file.files[0];
        if (!f) return;
        ZXAvatar.process(f).then(function (blob) {
          pick.disabled = true;
          pick.textContent = '上传中…';
          return doUpload(cfg, blob).then(function (res) {
            var url = (res && res.avatar_url) || avatarSrc(cfg, cfg.userId(), Date.now());
            var img = avatarBox.querySelector('img');
            if (img) img.src = url;
            else avatarBox.innerHTML = '<img src="' + esc(url) + '" alt="" onerror="ZXAvatar.fallback(this)"><span class="zx-avatar__txt">' + esc((cfg.name() || '?').slice(0, 1)) + '</span>';
            avatarBox.classList.remove('is-fallback');
            say(cfg, '头像已更新', 'ok');
            if (cfg.onAvatar) cfg.onAvatar(url);
          });
        }).catch(function (e) {
          say(cfg, e.message || '头像上传失败');
        }).then(function () {
          pick.disabled = false;
          pick.textContent = '更换头像';
          file.value = '';
        });
      };
    }

    // ---- 保存基本资料 ----
    var save = root.querySelector('#zxProfSave');
    if (save) {
      save.onclick = function () {
        var name = (root.querySelector('#zxProfName').value || '').trim();
        var phone = (root.querySelector('#zxProfPhone').value || '').trim();
        var oldPwd = root.querySelector('#zxProfOldPwd').value || '';
        var cur = cfg.phone() || '';
        if (!name) return say(cfg, '请填写姓名');
        if (phone && phone !== cur && !/^1\d{10}$/.test(phone)) return say(cfg, '请输入正确的 11 位手机号');
        if (phone && phone !== cur && !oldPwd) return say(cfg, '修改手机号需要验证原密码');
        save.disabled = true;
        var payload = { name: name };
        if (phone && phone !== cur) {
          payload[cfg.phoneField || 'phone'] = phone;
          payload.oldPassword = oldPwd;
        }
        doSave(cfg, payload).then(function (d) {
          say(cfg, '资料已保存', 'ok');
          var u = (d && d.user) || {};
          if (cfg.onSaved) cfg.onSaved(u);
          var oldPwd2 = root.querySelector('#zxProfOldPwd');
          if (oldPwd2) oldPwd2.value = '';
          if (u.phone && u.phone !== cur) {
            say(cfg, '手机号已更新，请重新登录', 'ok');
            setTimeout(function () { location.reload(); }, 1200);
          }
        }).catch(function (e) {
          say(cfg, e.message || '保存失败');
        }).then(function () { save.disabled = false; });
      };
    }

    // ---- 修改密码 ----
    var pwdSave = root.querySelector('#zxPwdSave');
    if (pwdSave) {
      pwdSave.onclick = function () {
        var oldP = root.querySelector('#zxPwdOld').value || '';
        var n1 = root.querySelector('#zxPwdNew').value || '';
        var n2 = root.querySelector('#zxPwdNew2').value || '';
        if (!oldP) return say(cfg, '请输入原密码');
        if (n1.length < 6) return say(cfg, '新密码至少 6 位');
        if (n1 !== n2) return say(cfg, '两次输入的新密码不一致');
        pwdSave.disabled = true;
        doChangePwd(cfg, { oldPassword: oldP, newPassword: n1 }).then(function () {
          say(cfg, '密码已修改，请牢记新密码', 'ok');
          root.querySelector('#zxPwdOld').value = '';
          root.querySelector('#zxPwdNew').value = '';
          root.querySelector('#zxPwdNew2').value = '';
        }).catch(function (e) {
          say(cfg, e.message || '修改失败');
        }).then(function () { pwdSave.disabled = false; });
      };
    }
  }

  global.ZXProfile = { render: render };
})(typeof window !== 'undefined' ? window : this);
