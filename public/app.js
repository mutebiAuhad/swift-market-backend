const API = '/api';
let TOKEN = localStorage.getItem('sm_token') || null;
let ME = null; // { user, isActive }
let offset = 0;
const LIMIT = 24;
let currentType = '';

function $(sel) { return document.querySelector(sel); }
function $all(sel) { return document.querySelectorAll(sel); }
function show(id) { $('#' + id).classList.remove('hidden'); }
function hide(id) { $('#' + id).classList.add('hidden'); }

async function api(path, opts = {}) {
  const headers = Object.assign({}, opts.headers);
  if (!(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (TOKEN) headers['Authorization'] = 'Bearer ' + TOKEN;
  const res = await fetch(API + path, Object.assign({}, opts, { headers }));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function setAlert(msg, type = 'info') {
  const box = $('#alertBox');
  if (!box) return;
  box.innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
  setTimeout(() => { box.innerHTML = ''; }, 6000);
}

document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => hide(btn.dataset.close));
});
document.querySelectorAll('.modal-backdrop').forEach(bd => {
  bd.addEventListener('click', e => { if (e.target === bd) bd.classList.add('hidden'); });
});

/* ---------------- auth state ---------------- */

async function refreshMe() {
  if (!TOKEN) { ME = null; updateNav(); return; }
  try {
    ME = await api('/auth/me');
  } catch (e) {
    TOKEN = null; localStorage.removeItem('sm_token'); ME = null;
  }
  updateNav();
}

function updateNav() {
  if (ME) {
    hide('navLogin'); hide('navRegister');
    show('navLogout');
    $('#navAccount').textContent = ME.isActive ? 'Account' : 'Account (subscribe)';
  } else {
    show('navLogin'); show('navRegister');
    hide('navLogout');
  }
}

$('#navLogout').addEventListener('click', () => {
  TOKEN = null; localStorage.removeItem('sm_token'); ME = null; updateNav();
  setAlert('Logged out.', 'info');
});
$('#navLogin').addEventListener('click', () => show('loginModal'));
$('#navRegister').addEventListener('click', () => show('registerModal'));

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  hide('loginError');
  const fd = new FormData(e.target);
  try {
    const data = await api('/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(fd)) });
    TOKEN = data.token; localStorage.setItem('sm_token', TOKEN);
    await refreshMe();
    hide('loginModal'); e.target.reset();
    setAlert('Welcome back!', 'success');
  } catch (err) {
    $('#loginError').textContent = err.message; show('loginError');
  }
});

$('#registerForm').addEventListener('submit', async e => {
  e.preventDefault();
  hide('registerError');
  const fd = new FormData(e.target);
  try {
    const data = await api('/auth/register', { method: 'POST', body: JSON.stringify(Object.fromEntries(fd)) });
    TOKEN = data.token; localStorage.setItem('sm_token', TOKEN);
    await refreshMe();
    hide('registerModal'); e.target.reset();
    setAlert('Account created! Head to Account to subscribe and unlock uploads, downloads and comments.', 'success');
  } catch (err) {
    $('#registerError').textContent = err.message; show('registerError');
  }
});

$('#forgotLink').addEventListener('click', e => { e.preventDefault(); hide('loginModal'); show('forgotModal'); });

$('#forgotRequestForm').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const data = await api('/auth/forgot', { method: 'POST', body: JSON.stringify(Object.fromEntries(fd)) });
  $('#forgotMsg').textContent = data.message; show('forgotMsg');
});

$('#forgotResetForm').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api('/auth/reset', { method: 'POST', body: JSON.stringify(Object.fromEntries(fd)) });
    $('#forgotMsg').textContent = 'Password updated — you can log in now.'; show('forgotMsg');
    e.target.reset();
  } catch (err) {
    $('#forgotMsg').textContent = err.message; show('forgotMsg');
  }
});

/* ---------------- media grid ---------------- */

function mediaCard(item) {
  const isVideo = item.type === 'video';
  return `<div class="card" data-id="${item.id}" style="cursor:pointer;">
    ${isVideo
      ? `<video class="thumb" src="${item.file_url}" muted></video>`
      : `<img class="thumb" src="${item.file_url}" loading="lazy">`}
    <div class="body">
      <span class="badge ${isVideo ? 'video' : ''}">${item.type}</span>
      <h3>${escapeHtml(item.title || 'Untitled')}</h3>
      <div class="meta">by ${escapeHtml(item.uploader_name)} &middot; ${item.views_count} views</div>
    </div>
  </div>`;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function loadMedia(reset = false) {
  if (reset) { offset = 0; $('#mediaGrid').innerHTML = ''; }
  const q = new URLSearchParams({ limit: LIMIT, offset });
  if (currentType) q.set('type', currentType);
  const data = await api('/media?' + q.toString());
  $('#mediaGrid').insertAdjacentHTML('beforeend', data.media.map(mediaCard).join(''));
  offset += data.media.length;
  $('#loadMoreBtn').classList.toggle('hidden', data.media.length < LIMIT);
  $all('#mediaGrid .card').forEach(card => {
    card.onclick = () => openDetail(card.dataset.id);
  });
}

$('#typeFilter').addEventListener('change', e => { currentType = e.target.value; loadMedia(true); });
$('#loadMoreBtn').addEventListener('click', () => loadMedia(false));

/* ---------------- media detail + comments ---------------- */

async function openDetail(id) {
  const data = await api('/media/' + id);
  const item = data.media;
  const isVideo = item.type === 'video';
  const canInteract = ME && ME.isActive;
  $('#detailContent').innerHTML = `
    <span class="badge ${isVideo ? 'video' : ''}">${item.type}</span>
    <h2 style="margin:8px 0;">${escapeHtml(item.title)}</h2>
    ${isVideo
      ? `<video src="${item.file_url}" controls style="width:100%; border-radius:8px; background:#000;"></video>`
      : `<img src="${item.file_url}" style="width:100%; border-radius:8px;">`}
    <p class="muted">by ${escapeHtml(item.uploader_name)} &middot; ${item.views_count} views &middot; ${item.downloads_count} downloads</p>
    ${item.description ? `<p>${escapeHtml(item.description)}</p>` : ''}
    <button class="btn btn-outline" id="downloadBtn">Download original</button>
    <h3 class="section-title" style="font-size:1.05rem;">Comments</h3>
    <div id="commentsList">${data.comments.map(commentHtml).join('') || '<p class="muted">No comments yet.</p>'}</div>
    ${canInteract
      ? `<form id="commentForm" style="margin-top:10px;">
           <textarea name="content" rows="2" placeholder="Add a comment..." required></textarea>
           <button class="btn btn-dark" style="margin-top:8px;" type="submit">Comment</button>
         </form>`
      : `<p class="muted">Subscribe (see Account) to comment.</p>`}
  `;
  $('#downloadBtn').onclick = () => handleDownload(item.id);
  const cf = $('#commentForm');
  if (cf) cf.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api(`/media/${item.id}/comments`, { method: 'POST', body: JSON.stringify(Object.fromEntries(fd)) });
      openDetail(item.id);
    } catch (err) { alert(err.message); }
  });
  show('detailModal');
}

function commentHtml(c) {
  return `<div class="comment"><div class="author">${escapeHtml(c.author_name)}</div><div class="content">${escapeHtml(c.content)}</div></div>`;
}

async function handleDownload(id) {
  if (!ME) { hide('detailModal'); show('loginModal'); return; }
  if (!ME.isActive) { window.location.href = '/account.html'; return; }
  try {
    const data = await api(`/media/${id}/download`);
    window.open(data.url, '_blank');
  } catch (err) { alert(err.message); }
}

/* ---------------- upload ---------------- */

$('#navUpload').addEventListener('click', () => {
  if (!ME) { show('loginModal'); return; }
  if (!ME.isActive) { window.location.href = '/account.html'; return; }
  show('uploadModal');
});

$('#uploadForm').addEventListener('submit', async e => {
  e.preventDefault();
  hide('uploadError');
  const fd = new FormData(e.target);
  try {
    await api('/media', { method: 'POST', body: fd });
    hide('uploadModal'); e.target.reset();
    setAlert('Uploaded!', 'success');
    loadMedia(true);
  } catch (err) {
    $('#uploadError').textContent = err.message; show('uploadError');
  }
});

/* ---------------- init ---------------- */

(async function init() {
  await refreshMe();
  await loadMedia(true);
})();
