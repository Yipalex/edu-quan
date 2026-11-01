/* ============================================================
 * sdk-adapter.js — WorkBuddy Cloud SDK 的自托管适配层（同形 API）
 * 替换 CDN 上的 @tencent-ai/workbuddy-cloud-sdk，调用签名保持不变。
 * 后端为自建 Node 统一后端，路由前缀 /api/:app（app 由 createWorkBuddyCloud 配置传入）。
 * 认证方式：手机号 + 密码（JWT，localStorage 键 zb_token）。
 * ============================================================ */
window.WorkBuddyCloud = (() => {
  'use strict';

  function createWorkBuddyCloud(cfg) {
    const base = (cfg && cfg.endpoint) || '';   // 同源部署传 '' 即可
    const app = (cfg && cfg.app) || '';
    const TOKEN_KEY = 'zb_token';
    const listeners = [];

    function getToken() { try { return localStorage.getItem(TOKEN_KEY); } catch (_) { return null; } }
    function setToken(t) { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (_) {} }

    function normalizeError(e) {
      if (!e) return { message: '请求失败' };
      if (typeof e === 'string') return { message: e };
      return { message: e.message || e.msg || String(e), code: e.code, raw: e };
    }

    /* 统一请求：后端既可返回「裸值」（数组/对象/标量），也可返回 {data,error} 信封，
       适配层统一解包为 {data, error} 返回。HTTP 非 2xx 或 body 含 error 字段时
       返回 {data:null, error}。 */
    async function api(path, opts) {
      opts = opts || {};
      const headers = Object.assign({}, opts.headers || {});
      const token = getToken();
      if (token) headers.Authorization = 'Bearer ' + token;
      const init = { method: opts.method || 'GET', headers };
      if (opts.json !== undefined) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(opts.json);
      } else if (opts.body !== undefined) {
        init.body = opts.body;
      }
      let res;
      try {
        res = await fetch(base + '/api/' + app + path, init);
      } catch (e) {
        return { data: null, error: { message: '网络异常：' + (e.message || '无法连接服务器') } };
      }
      const body = res.status === 204 ? null : await res.json().catch(() => null);
      if (!res.ok) {
        const err = body && body.error ? body.error : { message: (body && body.message) || ('HTTP ' + res.status) };
        return { data: null, error: normalizeError(err) };
      }
      if (body && typeof body === 'object' && !Array.isArray(body) && 'error' in body) {
        if (body.error) return { data: null, error: normalizeError(body.error) };
        if ('data' in body) return { data: body.data, error: null };
      }
      return { data: body, error: null };
    }

    /* ---- auth ---- */
    function currentSessionFromUser(user) { return user ? { user } : null; }

    const auth = {
      /* 手机号+密码登录（email 形参仅为兼容旧调用，统一按手机号传） */
      async signInWithPassword(creds) {
        const phone = (creds.phone || creds.email || '').trim();
        const r = await api('/auth/login', { method: 'POST', json: { phone, password: creds.password } });
        if (r.data && r.data.token) {
          setToken(r.data.token);
          emit('SIGNED_IN', currentSessionFromUser(r.data.user));
          return { data: { session: currentSessionFromUser(r.data.user), user: r.data.user }, error: null };
        }
        return { data: { session: null, user: null }, error: r.error };
      },
      /* 注册（替代原 OTP 自动注册）；成功后若响应带 token 则直接登录 */
      async signUp(creds) {
        const r = await api('/auth/register', {
          method: 'POST',
          json: { phone: (creds.phone || '').trim(), password: creds.password, name: creds.name },
        });
        if (r.data && r.data.token) {
          setToken(r.data.token);
          emit('SIGNED_IN', currentSessionFromUser(r.data.user));
        }
        return r;
      },
      async getSession() {
        if (!getToken()) return { data: { session: null }, error: null };
        const r = await api('/auth/session');
        if (r.error || !r.data || !r.data.user) {
          setToken(null);
          return { data: { session: null }, error: null };
        }
        return { data: { session: { user: r.data.user } }, error: null };
      },
      async getUser() {
        const s = await auth.getSession();
        return { data: { user: s.data.session ? s.data.session.user : null }, error: s.error };
      },
      async signOut() {
        setToken(null);
        emit('SIGNED_OUT', null);
        return { error: null };
      },
      /* 回调签名与原 SDK 一致：cb(event, session)；注册后立即以当前会话回调一次 */
      onAuthStateChange(cb) {
        listeners.push(cb);
        auth.getSession().then(({ data }) => {
          try { cb('INITIAL_SESSION', data.session); } catch (_) {}
        });
        return {
          data: {
            subscription: {
              unsubscribe() {
                const i = listeners.indexOf(cb);
                if (i >= 0) listeners.splice(i, 1);
              },
            },
          },
        };
      },
    };

    function emit(event, session) {
      listeners.slice().forEach((f) => { try { f(event, session); } catch (_) {} });
    }

    /* ---- database（PostgREST 风格链式构造器，thenable 可直接 await） ---- */
    function queryBuilder(table) {
      const q = { table, op: 'select', selectCols: '*', filters: [], order: [], limit: null, payload: null, returning: false };
      const self = {
        select(cols) {
          if (q.op === 'select') q.selectCols = cols || '*';
          else q.returning = true;          // insert/update/delete 后接 .select() → 返回写入的行
          return self;
        },
        insert(obj) { q.op = 'insert'; q.payload = Array.isArray(obj) ? obj : [obj]; return self; },
        update(obj) { q.op = 'update'; q.payload = obj; return self; },
        delete() { q.op = 'delete'; return self; },
        eq(col, val) { q.filters.push({ col, op: 'eq', val }); return self; },
        in(col, arr) { q.filters.push({ col, op: 'in', val: arr }); return self; },
        order(col, opts) { q.order.push({ col, ascending: !opts || opts.ascending !== false }); return self; },
        limit(n) { q.limit = n; return self; },
        then(resolve, reject) {
          let path, body;
          if (q.op === 'select') {
            path = '/db/query';
            body = { table: q.table, select: q.selectCols, filters: q.filters, order: q.order, limit: q.limit };
          } else if (q.op === 'insert') {
            path = '/db/insert';
            body = { table: q.table, rows: q.payload, returning: q.returning };
          } else if (q.op === 'update') {
            path = '/db/update';
            body = { table: q.table, set: q.payload, filters: q.filters, returning: q.returning };
          } else {
            path = '/db/delete';
            body = { table: q.table, filters: q.filters, returning: q.returning };
          }
          return api(path, { method: 'POST', json: body }).then(resolve, reject);
        },
      };
      return self;
    }
    const database = {
      from: (t) => queryBuilder(t),
      /* 后端直接返回函数值（对象/数组/标量），统一包装为 {data, error} */
      rpc: (name, params) => api('/rpc/' + name, { method: 'POST', json: params || {} }),
    };

    /* ---- storage（仅 yj 使用） ---- */
    const storage = {
      userPath: (uid, p) => uid + '/' + p,
      async upload(path, file, opts) {
        const fd = new FormData();
        fd.append('path', path);
        fd.append('file', file, path.split('/').pop());
        const headers = {};
        const token = getToken();
        if (token) headers.Authorization = 'Bearer ' + token;
        let res;
        try {
          res = await fetch(base + '/api/' + app + '/storage/upload', { method: 'POST', headers, body: fd });
        } catch (e) {
          return { data: null, error: { message: '网络异常：' + (e.message || '上传失败') } };
        }
        const body = await res.json().catch(() => null);
        if (!res.ok) return { data: null, error: normalizeError(body && body.error ? body.error : { message: (body && body.message) || '上传失败' }) };
        return { data: body, error: null };
      },
      async createSignedUrl(path, _ttlSeconds) {
        const r = await api('/storage/sign?path=' + encodeURIComponent(path));
        if (r.error) return r;
        return { data: { url: base + r.data.url }, error: null };
      },
    };

    /* ---- llm（SSE 流 → 异步迭代器） ---- */
    const llm = {
      models: {
        async list() {
          const r = await api('/llm/models');
          return (r && r.data) || [];
        },
      },
      chat: {
        completions: {
          /* stream:true 时直接返回异步迭代器（可 for await），否则返回 Promise<JSON> */
          create(params) {
            const req = fetch(base + '/api/' + app + '/llm/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(getToken() ? { Authorization: 'Bearer ' + getToken() } : {}),
              },
              body: JSON.stringify({
                model: params.model,
                messages: params.messages,
                stream: !!params.stream,
                response_format: params.response_format,
              }),
            });
            if (!params.stream) {
              return req.then(async (res) => {
                if (!res.ok) throw new Error('LLM 调用失败 HTTP ' + res.status);
                return res.json();
              });
            }
            return sseIterator(req);
          },
        },
      },
    };

    /* ReadableStream(SSE) → 异步生成器：
       按行解析，仅处理 'data: ' 前缀的行；'[DONE]' 结束；每行 JSON.parse 后 yield；
       缓冲区跨 chunk 拼接，直到遇到换行才切行。 */
    async function* sseIterator(fetchPromise) {
      const res = await fetchPromise;
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error('LLM 调用失败 HTTP ' + res.status + (text ? '：' + text.slice(0, 200) : ''));
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buf = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf('\n')) >= 0) {
            let line = buf.slice(0, idx);
            buf = buf.slice(idx + 1);
            if (line.endsWith('\r')) line = line.slice(0, -1);
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (!data) continue;
            if (data === '[DONE]') return;
            try { yield JSON.parse(data); } catch (_) { /* 跳过无法解析的行 */ }
          }
        }
        /* 流末尾无换行的残余数据 */
        buf += decoder.decode();
        const tail = buf.trim();
        if (tail.startsWith('data:')) {
          const data = tail.slice(5).trim();
          if (data && data !== '[DONE]') {
            try { yield JSON.parse(data); } catch (_) {}
          }
        }
      } finally {
        try { reader.releaseLock(); } catch (_) {}
      }
    }

    return { auth, database, storage, llm };
  }

  return { createWorkBuddyCloud };
})();
