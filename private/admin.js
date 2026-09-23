const API = '/api';
let TOKEN = sessionStorage.getItem('sm_admin_token') || null; // sessionStorage: cleared when the browser tab closes

function $(sel) { return document.querySelector(sel); }
function $all(sel) { return document.querySelectorAll(sel); }
function esc(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

async function api(path, opts = {}) {
  const headers = Object.assign({}, opts.headers);
  if (!(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (TOKEN) headers['Authorization'] = 'Bearer ' + TOKEN;
  const res = await fetch(API + path, Object.assign({}, opts, { headers }));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function showDashboard() {
  $('#loginBox').classList.add('hidden');
  $('#dashBox').classList.remove('hidden');
  $('#logoutBtn').classList.remove('hidden');
  loadStats();
  loadPayments();
}

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('#loginError').classList.add('hidden');
  const fd = new FormData(e.target);
  try {
    const data = await api('/admin/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(fd)) });
    TOKEN = data.token; sessionStorage.setItem('sm_admin_token', TOKEN);
    showDashboard();
  } catch (err) {
    $('#loginError').textContent = err.message; $('#loginError').classList.remove('hidden');
  }
});

$('#logoutBtn').addEventListener('click', () => {
  TOKEN = null; sessionStorage.removeItem('sm_admin_token');
  location.reload();
});

$all('.tab-btn').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

function switchTab(tab) {
  $all('.tab-panel').forEach(p => p.classList.add('hidden'));
  $('#tab-' + tab).classList.remove('hidden');
  if (tab === 'payments') loadPayments();
  if (tab === 'settings') loadSettings();
  if (tab === 'users') loadUsers();
  if (tab === 'media') loadMedia();
  if (tab === 'security') loadSecurity();
}

/* ---------------- stats ---------------- */

async function loadStats() {
  const s = await api('/admin/stats');
  $('#statsGrid').innerHTML = [
    ['Total users', s.totalUsers],
    ['Active subscribers', s.activeUsers],
    ['Pending payments', s.pendingPayments],
    ['Total media', s.totalMedia],
    ['Revenue (USD)', '$' + s.revenueUsd]
  ].map(([label, val]) => `<div class="card" style="padding:14px; text-align:center;">
      <div style="font-size:1.6rem; font-weight:700; color:var(--brown-dark);">${val}</div>
      <div class="muted">${label}</div>
    </div>`).join('');
}

/* ---------------- payments ---------------- */

async function loadPayments() {
  const data = await api('/admin/payments?status=pending');
  const el = $('#tab-payments');
  if (!data.payments.length) { el.innerHTML = '<p class="muted">No pending payments.</p>'; return; }
  el.innerHTML = `<table><thead><tr><th>User</th><th>Method</th><th>Amount</th><th>Proof</th><th>Note</th><th>Submitted</th><th></th></tr></thead><tbody>
    ${data.payments.map(p => `<tr>
      <td>${esc(p.display_name)}<br><span class="muted">${esc(p.email)}</span></td>
      <td>${p.method}</td>
      <td>$${p.amount_usd}</td>
      <td>${p.proof_file_url ? `<a href="${p.proof_file_url}" target="_blank">View</a>` : '-'}</td>
      <td>${esc(p.reference_note || '-')}</td>
      <td>${new Date(p.created_at).toLocaleString()}</td>
      <td style="white-space:nowrap;">
        <button class="btn btn-primary" style="padding:6px 10px;" onclick="approvePayment('${p.id}')">Approve</button>
        <button class="btn btn-danger" style="padding:6px 10px;" onclick="rejectPayment('${p.id}')">Reject</button>
      </td>
    </tr>`).join('')}
  </tbody></table>`;
}

async function approvePayment(id) {
  await api(`/admin/payments/${id}/approve`, { method: 'POST' });
  loadPayments(); loadStats();
}
async function rejectPayment(id) {
  if (!confirm('Reject this payment?')) return;
  await api(`/admin/payments/${id}/reject`, { method: 'POST' });
  loadPayments(); loadStats();
}

/* ---------------- bank settings ---------------- */

async function loadSettings() {
  const data = await api('/admin/settings');
  const s = data.settings;
  $('#tab-settings').innerHTML = `
    <form id="settingsForm" class="card" style="padding:18px; max-width:480px;">
      <div class="form-group"><label>Bank name</label><input name="bank_name" value="${esc(s.bank_name)}"></div>
      <div class="form-group"><label>Account name</label><input name="bank_account_name" value="${esc(s.bank_account_name)}"></div>
      <div class="form-group"><label>Account number</label><input name="bank_account_number" value="${esc(s.bank_account_number)}"></div>
      <div class="form-group"><label>SWIFT/BIC (optional)</label><input name="bank_swift" value="${esc(s.bank_swift)}"></div>
      <div class="form-group"><label>Extra instructions (optional)</label><textarea name="bank_instructions" rows="3">${esc(s.bank_instructions)}</textarea></div>
      <button class="btn btn-primary" type="submit">Save bank details</button>
    </form>`;
  $('#settingsForm').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await api('/admin/settings', { method: 'PUT', body: JSON.stringify(Object.fromEntries(fd)) });
    alert('Saved.');
  });
}

/* ---------------- users ---------------- */

async function loadUsers() {
  const data = await api('/admin/users');
  $('#tab-users').innerHTML = `<table><thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Expires</th><th></th></tr></thead><tbody>
    ${data.users.map(u => `<tr>
      <td>${esc(u.displayName)}</td>
      <td>${esc(u.email)}</td>
      <td><span class="tag-${u.isBanned ? 'banned' : u.status}">${u.isBanned ? 'banned' : u.status}</span></td>
      <td>${u.subscriptionExpiresAt ? new Date(u.subscriptionExpiresAt).toLocaleDateString() : '-'}</td>
      <td>${u.isBanned
        ? `<button class="btn btn-outline" style="padding:6px 10px;" onclick="unbanUser('${u.id}')">Unban</button>`
        : `<button class="btn btn-danger" style="padding:6px 10px;" onclick="banUser('${u.id}')">Ban</button>`}</td>
    </tr>`).join('')}
  </tbody></table>`;
}
async function banUser(id) { if (confirm('Suspend this user?')) { await api(`/admin/users/${id}/ban`, { method: 'POST' }); loadUsers(); } }
async function unbanUser(id) { await api(`/admin/users/${id}/unban`, { method: 'POST' }); loadUsers(); }

/* ---------------- media moderation ---------------- */

async function loadMedia() {
  const data = await api('/admin/media');
  $('#tab-media').innerHTML = `<table><thead><tr><th>Title</th><th>Type</th><th>Uploader</th><th>Views</th><th></th></tr></thead><tbody>
    ${data.media.map(m => `<tr>
      <td><a href="${m.file_url}" target="_blank">${esc(m.title)}</a></td>
      <td>${m.type}</td>
      <td>${esc(m.uploader_name)}<br><span class="muted">${esc(m.uploader_email)}</span></td>
      <td>${m.views_count}</td>
      <td><button class="btn btn-danger" style="padding:6px 10px;" onclick="deleteMedia('${m.id}')">Delete</button></td>
    </tr>`).join('')}
  </tbody></table>`;
}
async function deleteMedia(id) {
  if (!confirm('Permanently delete this upload?')) return;
  await api(`/admin/media/${id}`, { method: 'DELETE' });
  loadMedia(); loadStats();
}

/* ---------------- security / 2FA ---------------- */

async function loadSecurity() {
  $('#tab-security').innerHTML = `
    <div class="card" style="padding:18px; max-width:480px;">
      <h3 style="margin-top:0;">Two-factor authentication</h3>
      <p class="muted">If ADMIN_TOTP_SECRET is not yet set in your environment variables, 2FA is optional on login. Generate a secret below, scan it into an authenticator app, then set ADMIN_TOTP_SECRET in your hosting environment and redeploy to make it mandatory.</p>
      <button class="btn btn-outline" id="genTotpBtn">Generate 2FA secret</button>
      <div id="totpResult" style="margin-top:14px;"></div>
    </div>`;
  $('#genTotpBtn').addEventListener('click', async () => {
    const data = await api('/admin/totp/setup');
    $('#totpResult').innerHTML = `
      <img src="${data.qr}" style="max-width:200px; display:block; margin-bottom:10px;">
      <p class="muted">Secret (only shown once): <code>${data.base32}</code></p>
      <p class="muted">Scan the QR in Google Authenticator or Authy, then set <code>ADMIN_TOTP_SECRET=${data.base32}</code> in your environment and redeploy.</p>`;
  });
}

if (TOKEN) {
  api('/admin/me').then(showDashboard).catch(() => { TOKEN = null; sessionStorage.removeItem('sm_admin_token'); });
}
