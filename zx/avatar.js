/* ============================================================
 * 泽曦统一头像工具（2026-11-04）
 * 各系统（yj / quan / zc）共用的头像处理与渲染逻辑：
 *   1. ZXAvatar.pickFile()   选图 → 居中裁正方形 → 缩放 256px → PNG
 *   2. ZXAvatar.upload(app)  上传（返回头像 URL）
 *   3. ZXAvatar.url(app,id)  头像图片地址（带版本号避免缓存）
 *   4. ZXAvatar.html(app,id,name,size) 圆形头像 HTML（下方带名字）
 *
 * 圆形由 CSS border-radius:50% + overflow:hidden 实现（各系统样式统一）。
 * 上传前在浏览器端完成裁剪压缩，服务端只存 base64 PNG，无需图像处理依赖。
 * ============================================================ */
(function (global) {
  'use strict';

  var SIZE = 256;          // 输出边长
  var MAX_INPUT = 12 * 1024 * 1024;  // 选图上限 12MB

  /** 居中裁正方形 → 缩放 → PNG blob */
  function process(file) {
    return new Promise(function (resolve, reject) {
      if (!file) return reject(new Error('请选择图片'));
      if (!/^image\//.test(file.type || '')) return reject(new Error('请选择图片文件'));
      if (file.size > MAX_INPUT) return reject(new Error('图片太大，请选择 12MB 以内的图片'));
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var side = Math.min(img.width, img.height);
          var sx = Math.floor((img.width - side) / 2);
          var sy = Math.floor((img.height - side) / 2);
          var canvas = document.createElement('canvas');
          canvas.width = SIZE; canvas.height = SIZE;
          var ctx = canvas.getContext('2d');
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE);
          canvas.toBlob(function (blob) {
            URL.revokeObjectURL(url);
            if (!blob) return reject(new Error('图片处理失败，请换一张试试'));
            resolve(blob);
          }, 'image/png');
        } catch (e) {
          URL.revokeObjectURL(url);
          reject(new Error('图片处理失败，请换一张试试'));
        }
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('图片无法读取，请换一张试试'));
      };
      img.src = url;
    });
  }

  /** 读取用户当前头像（各系统接口一致：GET /api/{app}/auth/profile） */
  function fetchProfile(app, token) {
    return fetch('/api/' + app + '/auth/profile', {
      headers: { Authorization: 'Bearer ' + token }
    }).then(function (r) { return r.json(); });
  }

  /** 上传头像（multipart，字段名 file） */
  function upload(app, token, blob) {
    var fd = new FormData();
    fd.append('file', blob, 'avatar.png');
    return fetch('/api/' + app + '/auth/avatar', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      body: fd
    }).then(function (r) { return r.json().then(function (d) {
      if (!r.ok) throw new Error((d && d.error && d.error.message) || '头像上传失败');
      return d;
    }); });
  }

  /** 头像图片地址（带 v 版本号，改头像后自动破缓存） */
  function url(app, userId, version) {
    if (!userId) return '';
    return '/api/' + app + '/avatars/' + encodeURIComponent(userId) + (version ? '?v=' + version : '');
  }

  /**
   * 圆形头像 HTML（可选在下方显示名字）
   * @param {string} app     应用标识 yj/quan
   * @param {string} userId  用户 id
   * @param {string} name    名字（无头像时取首字）
   * @param {number} size    尺寸 px
   * @param {boolean} withName 头像下方是否显示名字
   */
  function html(app, userId, name, size, withName) {
    size = size || 40;
    var inner = userId
      ? '<img src="' + url(app, userId) + '" alt="" onerror="ZXAvatar.fallback(this)">'
      : '';
    var avatar = '<span class="zx-avatar" style="width:' + size + 'px;height:' + size + 'px;font-size:' +
      Math.round(size * 0.42) + 'px">' + inner + '<span class="zx-avatar__txt">' +
      esc((name || '?').slice(0, 1)) + '</span></span>';
    if (!withName) return avatar;
    return '<span class="zx-avatar-wrap">' + avatar +
      '<span class="zx-avatar-name">' + esc(name || '') + '</span></span>';
  }

  /** 图片加载失败时显示文字首字 */
  function fallback(imgEl) {
    var wrap = imgEl && imgEl.parentElement;
    if (wrap) wrap.classList.add('is-fallback');
    if (imgEl) imgEl.style.display = 'none';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  global.ZXAvatar = {
    process: process,
    fetchProfile: fetchProfile,
    upload: upload,
    url: url,
    html: html,
    fallback: fallback,
    esc: esc,
  };
})(typeof window !== 'undefined' ? window : this);
