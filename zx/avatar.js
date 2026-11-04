/* ============================================================
 * 泽曦统一头像工具（2026-11-04）
 * 各系统（yj / quan / zc）共用的头像处理与渲染逻辑：
 *   1. ZXAvatar.crop(file)   选图 → 弹窗圆形选区（拖动+缩放）→ 256px PNG
 *   2. ZXAvatar.process(file)选图 → 居中裁正方形 → 256px PNG（无交互，兜底）
 *   3. ZXAvatar.upload(app)  上传（返回头像 URL）
 *   4. ZXAvatar.url(app,id)  头像图片地址（带版本号避免缓存）
 *   5. ZXAvatar.html(app,id,name,size) 圆形头像 HTML（下方带名字）
 *
 * 圆形由 CSS border-radius:50% + overflow:hidden 实现（各系统样式统一）。
 * 上传前在浏览器端完成裁剪压缩，服务端只存 base64 PNG，无需图像处理依赖。
 * ============================================================ */
(function (global) {
  'use strict';

  var SIZE = 256;          // 输出边长
  var MAX_INPUT = 12 * 1024 * 1024;  // 选图上限 12MB
  var SEAL = '#A34332';    // 泽曦朱砂（主按钮）

  /** 居中裁正方形 → 缩放 → PNG blob（无交互兜底） */
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

  /* ------------------------------------------------------------
   * 圆形选区裁剪弹窗
   * 选框固定为内切圆，拖动图片调整取景位置，滚轮 / ± 按钮缩放。
   * resolve(Blob) 确认；resolve(null) 取消。
   * ------------------------------------------------------------ */
  var cssInjected = false;
  function injectCropCss() {
    if (cssInjected || !document.head) return;
    cssInjected = true;
    var st = document.createElement('style');
    st.id = 'zx-crop-style';
    st.textContent = [
      '.zx-crop-mask{position:fixed;inset:0;z-index:9999;background:rgba(21,18,16,.62);display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;-webkit-tap-highlight-color:transparent}',
      '.zx-crop-dialog{background:#fff;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.35);max-width:calc(100vw - 40px);overflow:hidden}',
      '.zx-crop-title{padding:14px 18px 4px;font-size:16px;font-weight:600;color:#26231F}',
      '.zx-crop-sub{padding:0 18px 10px;font-size:12px;color:#8a8378}',
      '.zx-crop-stage{position:relative;overflow:hidden;background:#3a352f;touch-action:none;cursor:grab;user-select:none;-webkit-user-select:none}',
      '.zx-crop-stage:active{cursor:grabbing}',
      '.zx-crop-stage img{position:absolute;display:block;max-width:none;pointer-events:none}',
      '.zx-crop-circle{position:absolute;pointer-events:none;border-radius:50%;border:2px solid #fff;box-sizing:border-box;box-shadow:0 0 0 1px rgba(0,0,0,.35),0 0 0 9999px rgba(21,18,16,.6);transform:translate(-50%,-50%)}',
      '.zx-crop-bar{display:flex;align-items:center;gap:10px;padding:10px 18px 0}',
      '.zx-crop-zoom{width:32px;height:32px;border:1px solid #d8d2c8;border-radius:8px;background:#fff;color:#26231F;font-size:18px;line-height:1;cursor:pointer}',
      '.zx-crop-zoom:hover{border-color:' + SEAL + ';color:' + SEAL + '}',
      '.zx-crop-tip{font-size:12px;color:#8a8378;flex:1;text-align:right}',
      '.zx-crop-actions{display:flex;justify-content:flex-end;gap:10px;padding:12px 18px 16px}',
      '.zx-crop-btn{min-width:84px;height:36px;padding:0 18px;border-radius:8px;font-size:14px;cursor:pointer;border:1px solid #d8d2c8;background:#fff;color:#26231F}',
      '.zx-crop-btn:hover{border-color:' + SEAL + ';color:' + SEAL + '}',
      '.zx-crop-btn--primary{background:' + SEAL + ';border-color:' + SEAL + ';color:#fff}',
      '.zx-crop-btn--primary:hover{opacity:.9;color:#fff}',
    ].join('\n');
    document.head.appendChild(st);
  }

  function crop(file) {
    return new Promise(function (resolve, reject) {
      if (!file) return reject(new Error('请选择图片'));
      if (!/^image\//.test(file.type || '')) return reject(new Error('请选择图片文件'));
      if (file.size > MAX_INPUT) return reject(new Error('图片太大，请选择 12MB 以内的图片'));
      injectCropCss();
      var objUrl = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          openCropper(img, objUrl, resolve);
        } catch (e) {
          URL.revokeObjectURL(objUrl);
          reject(new Error('图片处理失败，请换一张试试'));
        }
      };
      img.onerror = function () {
        URL.revokeObjectURL(objUrl);
        reject(new Error('图片无法读取，请换一张试试'));
      };
      img.src = objUrl;
    });
  }

  function openCropper(img, objUrl, resolve) {
    var MAX_W = Math.min(560, global.innerWidth - 48);
    var MAX_H = Math.min(480, global.innerHeight - 240);
    var fit = Math.min(MAX_W / img.width, MAX_H / img.height, 1);
    var stageW = Math.max(200, img.width * fit);
    var stageH = Math.max(200, img.height * fit);
    fit = Math.min(stageW / img.width, stageH / img.height);
    var D = Math.min(stageW, stageH);          // 圆形选框直径
    var cx = stageW / 2, cy = stageH / 2;      // 选框中心（stage 坐标）
    var z = 1;                                  // 缩放倍数（1 = 适配充满）
    var dispW = img.width * fit * z, dispH = img.height * fit * z;
    var ox = (stageW - dispW) / 2, oy = (stageH - dispH) / 2; // 图片左上角

    var mask = document.createElement('div');
    mask.className = 'zx-crop-mask';
    mask.innerHTML =
      '<div class="zx-crop-dialog" role="dialog" aria-label="裁剪头像">' +
      '  <div class="zx-crop-title">裁剪头像</div>' +
      '  <div class="zx-crop-sub">圆形区域内即为头像。拖动图片调整位置，滚动或按钮缩放。</div>' +
      '  <div class="zx-crop-stage">' +
      '    <img alt="" draggable="false">' +
      '    <div class="zx-crop-circle"></div>' +
      '  </div>' +
      '  <div class="zx-crop-bar">' +
      '    <button type="button" class="zx-crop-zoom" data-z="-1" aria-label="缩小">−</button>' +
      '    <button type="button" class="zx-crop-zoom" data-z="1" aria-label="放大">＋</button>' +
      '    <span class="zx-crop-tip">支持鼠标拖动 / 触屏拖动 / 滚轮缩放</span>' +
      '  </div>' +
      '  <div class="zx-crop-actions">' +
      '    <button type="button" class="zx-crop-btn" data-act="cancel">取消</button>' +
      '    <button type="button" class="zx-crop-btn zx-crop-btn--primary" data-act="ok">确定</button>' +
      '  </div>' +
      '</div>';

    var stage = mask.querySelector('.zx-crop-stage');
    var imgEl = mask.querySelector('img');
    var circle = mask.querySelector('.zx-crop-circle');
    imgEl.src = objUrl;
    stage.style.width = stageW + 'px';
    stage.style.height = stageH + 'px';
    circle.style.width = D + 'px';
    circle.style.height = D + 'px';
    circle.style.left = cx + 'px';
    circle.style.top = cy + 'px';

    function clampPan() {
      dispW = img.width * fit * z;
      dispH = img.height * fit * z;
      var minX = cx + D / 2 - dispW, maxX = cx - D / 2;
      var minY = cy + D / 2 - dispH, maxY = cy - D / 2;
      ox = Math.min(maxX, Math.max(minX, ox));
      oy = Math.min(maxY, Math.max(minY, oy));
    }
    function render() {
      imgEl.style.left = ox + 'px';
      imgEl.style.top = oy + 'px';
      imgEl.style.width = dispW + 'px';
      imgEl.style.height = dispH + 'px';
    }
    function zoom(next) {
      next = Math.min(5, Math.max(1, next));
      if (next === z) return;
      // 以选框中心为基准缩放：保持中心点下的自然坐标不动
      ox = cx - (cx - ox) * (next / z);
      oy = cy - (cy - oy) * (next / z);
      z = next;
      clampPan();
      render();
    }

    // 拖动
    var dragging = false, startX = 0, startY = 0, startOx = 0, startOy = 0;
    stage.addEventListener('pointerdown', function (e) {
      dragging = true; startX = e.clientX; startY = e.clientY; startOx = ox; startOy = oy;
      try { stage.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    stage.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      ox = startOx + (e.clientX - startX);
      oy = startOy + (e.clientY - startY);
      clampPan();
      render();
    });
    function endDrag() { dragging = false; }
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);

    // 滚轮缩放
    stage.addEventListener('wheel', function (e) {
      e.preventDefault();
      zoom(z * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
    }, { passive: false });

    // 按钮
    mask.querySelectorAll('.zx-crop-zoom').forEach(function (btn) {
      btn.addEventListener('click', function () { zoom(z * (btn.getAttribute('data-z') === '1' ? 1.25 : 1 / 1.25)); });
    });

    function cleanup() {
      document.removeEventListener('keydown', onKey, true);
      if (mask.parentNode) mask.parentNode.removeChild(mask);
      URL.revokeObjectURL(objUrl);
    }
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); cancel(); } }

    function cancel() { cleanup(); resolve(null); }
    function confirm() {
      var scale = fit * z; // 显示像素 / 自然像素
      var sx = (cx - D / 2 - ox) / scale;
      var sy = (cy - D / 2 - oy) / scale;
      var side = D / scale;
      var canvas = document.createElement('canvas');
      canvas.width = SIZE; canvas.height = SIZE;
      var ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE);
      canvas.toBlob(function (blob) {
        cleanup();
        if (!blob) return resolve(null);
        resolve(blob);
      }, 'image/png');
    }

    mask.querySelector('[data-act="cancel"]').addEventListener('click', cancel);
    mask.querySelector('[data-act="ok"]').addEventListener('click', confirm);
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(mask);
    clampPan();
    render();
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
    crop: crop,
    process: process,
    fetchProfile: fetchProfile,
    upload: upload,
    url: url,
    html: html,
    fallback: fallback,
    esc: esc,
  };
})(typeof window !== 'undefined' ? window : this);
