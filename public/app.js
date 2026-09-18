const API = '/api';
const root = document.documentElement;

// ---------------- theme ----------------
document.getElementById('themeToggle').addEventListener('click', () => {
  const isDark = root.getAttribute('data-theme') === 'dark' || (!root.getAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.setAttribute('data-theme', isDark ? 'light' : 'dark');
});

// ---------------- nav / tabs / mobile menu ----------------
let currentTab = 'market';
const app = document.getElementById('app');
const tabsEl = document.getElementById('tabs');
document.getElementById('hamburger').addEventListener('click', () => tabsEl.classList.toggle('open'));
tabsEl.addEventListener('click', e => {
  const b = e.target.closest('.tab-btn'); if (!b) return;
  currentTab = b.dataset.tab; tabsEl.classList.remove('open'); render();
});
function setActiveTab() { [...document.querySelectorAll('.tab-btn')].forEach(b => b.classList.toggle('active', b.dataset.tab === currentTab)); }

// ---------------- helpers ----------------
function fmt(n) { return 'UGX ' + Number(n).toLocaleString(); }
function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }
function stars(n) { const r = Math.round(n || 0); return '★'.repeat(r) + '☆'.repeat(5 - r); }

async function api(path, opts = {}, token) {
  const headers = Object.assign({}, opts.headers || {});
  let body = opts.body;
  if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; }
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(API + path, Object.assign({}, opts, { headers, body }));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ---------------- sessions ----------------
let customerToken = localStorage.getItem('sm_customer_token');
let bizToken = localStorage.getItem('sm_biz_token');
let currentCustomer = null;

async function refreshCustomer() {
  if (!customerToken) { currentCustomer = null; return; }
  try { currentCustomer = (await api('/auth/customer/me', {}, customerToken)).customer; }
  catch (e) { customerToken = null; localStorage.removeItem('sm_customer_token'); currentCustomer = null; }
}

const accountBtn = document.getElementById('accountBtn');
accountBtn.addEventListener('click', () => { currentCustomer ? openAccountMenu() : openCustomerAuth(); });
function updateAccountBtn() { accountBtn.textContent = currentCustomer ? currentCustomer.name.split(' ')[0] : 'Sign in'; }

// ---------------- render loop ----------------
function render() {
  setActiveTab();
  app.classList.remove('fade-in'); void app.offsetWidth; app.classList.add('fade-in');
  if (currentTab === 'market') renderMarket();
  else renderSell();
}
function afterRenderReveal() {
  document.querySelectorAll('.reveal:not(.observed)').forEach(el => { el.classList.add('observed'); revealObserver.observe(el); });
}
const revealObserver = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
}, { threshold: 0.12 });

// ================= COOKIE / CONSENT =================
const consentBar = document.getElementById('consentBar');
if (!localStorage.getItem('sm_consent')) consentBar.style.display = 'flex';
window.setConsent = function(accepted) {
  localStorage.setItem('sm_consent', accepted ? 'accepted' : 'essential');
  consentBar.style.display = 'none';
};
window.showPolicy = function() {
  openModal(`<h3 style="font-size:1.05rem;margin-bottom:12px;">Privacy &amp; Data Notice</h3>
    <p style="font-size:0.85rem;margin-bottom:10px;">Swift Market collects the details you give us when you register (name, email, phone, photos) and records of listings, orders, chats, and reviews so the marketplace can function.</p>
    <p style="font-size:0.85rem;margin-bottom:10px;">If you accept cookies beyond the essential ones, we may also share aggregated buying-interest insights with the businesses you interact with, to help them serve customers better. You can withdraw this at any time by clearing the consent banner choice in your browser.</p>
    <p style="font-size:0.85rem;margin-bottom:10px;">Payments are processed by Flutterwave and MTN Mobile Money directly — Swift Market never stores your card number or mobile money PIN.</p>
    <p style="font-size:0.85rem;">This is a plain-language summary, not a substitute for a full legal privacy policy, which should be reviewed by a lawyer before real launch.</p>`);
};

// ================= MODAL =================
function openModal(innerHtml) {
  closeModal();
  const div = document.createElement('div');
  div.className = 'modal-bg'; div.id = 'genericModal';
  div.innerHTML = `<div class="modal"><button class="close-x" onclick="closeModal()">✕</button>${innerHtml}</div>`;
  div.addEventListener('click', e => { if (e.target === div) closeModal(); });
  document.body.appendChild(div);
}
window.closeModal = function() { const m = document.getElementById('genericModal'); if (m) m.remove(); if (window._chatPoll) clearInterval(window._chatPoll); };

// ================= CUSTOMER AUTH =================
function openCustomerAuth() {
  openModal(`
    <h3 style="font-size:1.1rem;margin-bottom:14px;">Sign in to Swift Market</h3>
    <div class="tabs" style="margin-bottom:16px;width:fit-content;">
      <button class="tab-btn active" id="authTabLogin" onclick="showAuthPane('login')">Log in</button>
      <button class="tab-btn" id="authTabRegister" onclick="showAuthPane('register')">Create account</button>
    </div>
    <div id="authPaneLogin">
      <div class="field"><label>Email</label><input id="custLoginEmail" type="email"></div>
      <div class="field"><label>Password</label><input id="custLoginPassword" type="password"></div>
      <button class="btn btn-primary" style="width:100%;" onclick="customerLogin()">Log in</button>
      <p class="muted" style="margin-top:12px;"><a href="#" onclick="openForgot('customer');return false;">Forgot password?</a></p>
    </div>
    <div id="authPaneRegister" style="display:none;">
      <div class="field"><label>Full name</label><input id="custRegName"></div>
      <div class="field"><label>Email</label><input id="custRegEmail" type="email"></div>
      <div class="field"><label>Phone</label><input id="custRegPhone"></div>
      <div class="field"><label>Password</label><input id="custRegPassword" type="password" placeholder="6+ characters"></div>
      <div class="checkbox-row"><input type="checkbox" id="custConsent"><label for="custConsent">I accept the cookie use and data-processing agreement (<a href="#" onclick="showPolicy();return false;">read it</a>). Buying on Swift Market requires this.</label></div>
      <div class="checkbox-row"><input type="checkbox" id="custMarketing"><label for="custMarketing">I'd also like relevant offers from businesses I interact with (optional).</label></div>
      <button class="btn btn-primary" style="width:100%;" onclick="customerRegister()">Create account</button>
    </div>
  `);
}
window.showAuthPane = function(which) {
  document.getElementById('authPaneLogin').style.display = which === 'login' ? 'block' : 'none';
  document.getElementById('authPaneRegister').style.display = which === 'register' ? 'block' : 'none';
  document.getElementById('authTabLogin').classList.toggle('active', which === 'login');
  document.getElementById('authTabRegister').classList.toggle('active', which === 'register');
};
window.customerLogin = async function() {
  try {
    const body = { email: document.getElementById('custLoginEmail').value.trim(), password: document.getElementById('custLoginPassword').value };
    const { token, customer } = await api('/auth/customer/login', { method: 'POST', body: JSON.stringify(body) });
    customerToken = token; localStorage.setItem('sm_customer_token', token); currentCustomer = customer;
    updateAccountBtn(); closeModal(); render();
  } catch (e) { alert(e.message); }
};
window.customerRegister = async function() {
  try {
    const body = {
      name: document.getElementById('custRegName').value.trim(),
      email: document.getElementById('custRegEmail').value.trim(),
      phone: document.getElementById('custRegPhone').value.trim(),
      password: document.getElementById('custRegPassword').value,
      consentAccepted: document.getElementById('custConsent').checked,
      marketingOptIn: document.getElementById('custMarketing').checked,
    };
    const { token, customer } = await api('/auth/customer/register', { method: 'POST', body: JSON.stringify(body) });
    customerToken = token; localStorage.setItem('sm_customer_token', token); currentCustomer = customer;
    updateAccountBtn(); closeModal(); render();
  } catch (e) { alert(e.message); }
};

function openAccountMenu() {
  openModal(`
    <h3 style="font-size:1.05rem;margin-bottom:14px;">${esc(currentCustomer.name)}</h3>
    <p class="muted" style="margin-bottom:14px;">${esc(currentCustomer.email)}</p>
    <div class="field"><label>Update profile photo</label><input type="file" id="custPhotoInput" accept="image/*"></div>
    <button class="btn btn-ghost btn-sm" onclick="uploadCustomerPhoto()">Upload photo</button>
    <div class="divider"></div>
    <button class="btn btn-ghost" style="width:100%;" onclick="customerLogout()">Log out</button>
  `);
}
window.uploadCustomerPhoto = async function() {
  const input = document.getElementById('custPhotoInput');
  if (!input.files[0]) return;
  const fd = new FormData(); fd.append('photo', input.files[0]);
  try { await api('/auth/customer/photo', { method: 'POST', body: fd }, customerToken); alert('Photo updated.'); closeModal(); }
  catch (e) { alert(e.message); }
};
window.customerLogout = function() { customerToken = null; localStorage.removeItem('sm_customer_token'); currentCustomer = null; updateAccountBtn(); closeModal(); render(); };

function openForgot(kind) {
  if (kind === 'customer') {
    openModal(`
      <h3 style="font-size:1.05rem;margin-bottom:14px;">Reset your password</h3>
      <div id="forgotStep1">
        <div class="field"><label>Email</label><input id="forgotEmail" type="email"></div>
        <button class="btn btn-primary" style="width:100%;" onclick="requestCustomerCode()">Send recovery code</button>
      </div>
      <div id="forgotStep2" style="display:none;">
        <div class="field"><label>Recovery code</label><input id="forgotCode"></div>
        <div class="field"><label>New password</label><input id="forgotNewPass" type="password"></div>
        <button class="btn btn-primary" style="width:100%;" onclick="submitCustomerReset()">Set new password</button>
      </div>
    `);
  } else {
    openModal(`
      <h3 style="font-size:1.05rem;margin-bottom:14px;">Business password reset</h3>
      <p class="muted" style="margin-bottom:14px;">Enter the last 8 characters of your Business ID and the recovery email you gave at registration.</p>
      <div id="bizForgotStep1">
        <div class="field"><label>Last 8 characters of Business ID</label><input id="bizIdLast8" maxlength="8"></div>
        <div class="field"><label>Recovery email</label><input id="bizRecoveryEmail" type="email"></div>
        <button class="btn btn-primary" style="width:100%;" onclick="requestBizCode()">Send recovery code</button>
      </div>
      <div id="bizForgotStep2" style="display:none;">
        <div class="field"><label>Recovery code</label><input id="bizForgotCode"></div>
        <div class="field"><label>New password</label><input id="bizForgotNewPass" type="password"></div>
        <button class="btn btn-primary" style="width:100%;" onclick="submitBizReset()">Set new password</button>
      </div>
    `);
  }
}
window.openForgot = openForgot;
window.requestCustomerCode = async function() {
  const email = document.getElementById('forgotEmail').value.trim();
  try { const r = await api('/auth/customer/forgot', { method: 'POST', body: JSON.stringify({ email }) }); alert(r.message);
    window._forgotEmail = email;
    document.getElementById('forgotStep1').style.display = 'none';
    document.getElementById('forgotStep2').style.display = 'block';
  } catch (e) { alert(e.message); }
};
window.submitCustomerReset = async function() {
  try {
    await api('/auth/customer/reset', { method: 'POST', body: JSON.stringify({
      email: window._forgotEmail, code: document.getElementById('forgotCode').value.trim(), newPassword: document.getElementById('forgotNewPass').value }) });
    alert('Password updated — please log in.'); closeModal(); openCustomerAuth();
  } catch (e) { alert(e.message); }
};
window.requestBizCode = async function() {
  const idLast8 = document.getElementById('bizIdLast8').value.trim();
  const recoveryEmail = document.getElementById('bizRecoveryEmail').value.trim();
  try { const r = await api('/auth/business/forgot', { method: 'POST', body: JSON.stringify({ idLast8, recoveryEmail }) }); alert(r.message);
    window._bizForgot = { idLast8, recoveryEmail };
    document.getElementById('bizForgotStep1').style.display = 'none';
    document.getElementById('bizForgotStep2').style.display = 'block';
  } catch (e) { alert(e.message); }
};
window.submitBizReset = async function() {
  try {
    await api('/auth/business/reset', { method: 'POST', body: JSON.stringify({
      idLast8: window._bizForgot.idLast8, recoveryEmail: window._bizForgot.recoveryEmail,
      code: document.getElementById('bizForgotCode').value.trim(), newPassword: document.getElementById('bizForgotNewPass').value }) });
    alert('Password updated — please log in.'); closeModal(); render();
  } catch (e) { alert(e.message); }
};

// ================= MARKETPLACE =================
async function renderMarket() {
  app.innerHTML = '<p class="muted">Loading listings…</p>';
  try {
    const { listings } = await api('/listings');
    if (listings.length === 0) {
      app.innerHTML = `<div class="empty reveal">No listings yet. Be the first business to register from the <strong>Register Business</strong> tab.</div>`;
      afterRenderReveal(); return;
    }
    app.innerHTML = `<div class="grid">` + listings.map((l, i) => `
      <div class="card reveal" style="transition-delay:${Math.min(i, 6) * 60}ms;">
        <div class="listing-photo" style="${l.photo_url ? `background-image:url('${esc(l.photo_url)}')` : ''}"></div>
        <h3 style="font-size:1.02rem;margin-bottom:6px;">${esc(l.title)}</h3>
        <p style="font-size:0.88rem;margin-bottom:8px;">${esc(l.description || '')}</p>
        <div class="row" style="margin-bottom:8px;">
          <div class="price">${fmt(l.price)}</div>
          <span class="badge ${l.stock_qty > 0 ? 'badge-active' : 'badge-out'}">${l.stock_qty > 0 ? l.stock_qty + ' in stock' : 'Out of stock'}</span>
        </div>
        <div class="muted" style="padding-top:8px;border-top:1px dashed var(--border);">
          Dealer: ${esc(l.business_name)} · ${esc(l.business_contact)}<br>
          ${l.business_review_count > 0 ? `<span class="stars">${stars(l.business_rating)}</span> ${l.business_rating} (${l.business_review_count})` : 'No reviews yet'}
          — <a href="#" onclick="openReviews('${l.business_id}','${esc(l.business_name).replace(/'/g,"\\'")}');return false;">see reviews</a>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;">
          <button class="btn btn-sky btn-sm" style="flex:1;" onclick="openChatbot('${l.id}')" ${l.stock_qty === 0 ? 'disabled' : ''}>Ask the assistant</button>
          <button class="btn btn-gold btn-sm" style="flex:1;" onclick="buyNow('${l.id}', ${l.price})" ${l.stock_qty === 0 ? 'disabled' : ''}>Buy now</button>
        </div>
      </div>`).join('') + `</div>`;
    afterRenderReveal();
  } catch (e) {
    app.innerHTML = `<div class="banner warn">Could not load listings: ${esc(e.message)}</div>`;
  }
}

// ---- shopping assistant (bot) ----
window.openChatbot = async function(listingId) {
  if (!customerToken) { openCustomerAuth(); return; }
  openModal(`
    <h3 style="font-size:1.05rem;">Shopping assistant</h3>
    <p class="muted" style="margin:4px 0 10px;">Ask about this product — stock, price, or say you'd like to book it.</p>
    <div class="chat-log" id="botLog"><div class="muted">Loading…</div></div>
    <div class="field"><textarea id="botText" rows="2" placeholder="e.g. Is this still available?"></textarea></div>
    <button class="btn btn-sky" style="width:100%;" onclick="sendBotMessage('${listingId}')">Send</button>
    <div id="bookConfirm" style="margin-top:12px;"></div>
  `);
  await loadBotLog(listingId);
};
async function loadBotLog(listingId) {
  const log = document.getElementById('botLog'); if (!log) return;
  try {
    const { messages } = await api(`/listings/${listingId}/messages`, {}, customerToken);
    log.innerHTML = messages.length ? messages.map(m => `<div class="bubble ${m.sender === 'customer' ? 'mine' : 'bot'}"><strong style="font-size:0.75rem;opacity:0.8;">${m.sender === 'customer' ? 'You' : 'Assistant'}</strong><br>${esc(m.text)}</div>`).join('') : '<div class="muted">Ask a question to get started.</div>';
    log.scrollTop = log.scrollHeight;
  } catch (e) { log.innerHTML = `<div class="muted">${esc(e.message)}</div>`; }
}
window.sendBotMessage = async function(listingId) {
  const text = document.getElementById('botText').value.trim();
  if (!text) return;
  document.getElementById('botText').value = '';
  try {
    const result = await api(`/listings/${listingId}/chat`, { method: 'POST', body: JSON.stringify({ text }) }, customerToken);
    await loadBotLog(listingId);
    const bookDiv = document.getElementById('bookConfirm');
    if (result.wantsToBook) {
      bookDiv.innerHTML = `<button class="btn btn-gold" style="width:100%;" onclick="buyNow('${listingId}', null, ${result.quantity})">Confirm booking &amp; pay</button>`;
    }
  } catch (e) { alert(e.message); }
};

// ---- checkout ----
window.buyNow = async function(listingId, price, quantity) {
  if (!customerToken) { openCustomerAuth(); return; }
  let qty = quantity;
  if (!qty) {
    qty = Number(prompt('How many would you like to order?', '1') || 0);
    if (!qty || qty < 1) return;
  }
  try {
    const { checkoutUrl } = await api('/orders', { method: 'POST', body: JSON.stringify({ listingId, quantity: qty }) }, customerToken);
    closeModal();
    window.location.href = checkoutUrl; // Flutterwave's hosted, secure checkout page
  } catch (e) { alert(e.message); }
};

// ---- reviews ----
window.openReviews = async function(businessId, businessName) {
  openModal(`<h3 style="font-size:1.05rem;">${esc(businessName)} — reviews</h3><div id="reviewList" style="margin:14px 0;"><p class="muted">Loading…</p></div>
    ${customerToken ? `
    <div class="field"><label>Your rating</label>
      <select id="reviewRating"><option value="5">★★★★★</option><option value="4">★★★★</option><option value="3">★★★</option><option value="2">★★</option><option value="1">★</option></select>
    </div>
    <div class="field"><label>Comment (optional)</label><textarea id="reviewComment" rows="2"></textarea></div>
    <button class="btn btn-primary" style="width:100%;" onclick="submitReview('${businessId}')">Submit review</button>
    ` : `<p class="muted">Sign in to leave a review.</p>`}
  `);
  try {
    const { reviews, average, count } = await api(`/businesses/${businessId}/reviews`);
    document.getElementById('reviewList').innerHTML = count === 0 ? '<p class="muted">No reviews yet — be the first.</p>' :
      `<p class="muted" style="margin-bottom:10px;"><span class="stars">${stars(average)}</span> ${average} average from ${count} review${count === 1 ? '' : 's'}</p>` +
      reviews.map(r => `<div style="margin-bottom:10px;"><strong style="font-size:0.85rem;">${esc(r.customer_name)}</strong> <span class="stars">${stars(r.rating)}</span><p style="font-size:0.85rem;margin-top:2px;">${esc(r.comment || '')}</p></div>`).join('');
  } catch (e) { document.getElementById('reviewList').innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
};
window.submitReview = async function(businessId) {
  try {
    const rating = document.getElementById('reviewRating').value;
    const comment = document.getElementById('reviewComment').value.trim();
    await api(`/businesses/${businessId}/reviews`, { method: 'POST', body: JSON.stringify({ rating, comment }) }, customerToken);
    openReviews(businessId, '');
  } catch (e) { alert(e.message); }
};

// ================= REGISTER BUSINESS =================
async function renderSell() {
  if (!bizToken) return renderSellAuth();
  try {
    const { business } = await api('/auth/business/me', {}, bizToken);
    renderDashboard(business);
  } catch (e) { bizToken = null; localStorage.removeItem('sm_biz_token'); renderSellAuth(); }
}
function renderSellAuth() {
  app.innerHTML = `
    <h2 class="reveal">Register your business</h2>
    <p class="reveal" style="margin:8px 0 20px;">Subscribe, then manage your listings, stock, and orders from your dashboard.</p>
    <div class="grid reveal" style="grid-template-columns:1fr 1fr;">
      <div class="card">
        <h3 style="font-size:1rem;margin-bottom:14px;">New business</h3>
        <div class="field"><label>Business name</label><input id="regName"></div>
        <div class="field"><label>Dealer contact (phone)</label><input id="regContact" placeholder="07XXXXXXXX"></div>
        <div class="field"><label>Login email</label><input id="regEmail" type="email"></div>
        <div class="field"><label>Recovery email (used only if you forget your password)</label><input id="regRecoveryEmail" type="email"></div>
        <div class="field"><label>Password</label><input id="regPassword" type="password" placeholder="6+ characters"></div>
        <div class="checkbox-row"><input type="checkbox" id="regAutoRenew" checked><label for="regAutoRenew">Automatically renew my weekly subscription</label></div>
        <button class="btn btn-primary" style="width:100%;" onclick="doRegister()">Create account</button>
      </div>
      <div class="card">
        <h3 style="font-size:1rem;margin-bottom:14px;">Already registered? Log in</h3>
        <div class="field"><label>Email</label><input id="loginEmail" type="email"></div>
        <div class="field"><label>Password</label><input id="loginPassword" type="password"></div>
        <button class="btn btn-sky" style="width:100%;" onclick="doLogin()">Open my dashboard</button>
        <p class="muted" style="margin-top:12px;"><a href="#" onclick="openForgot('business');return false;">Forgot password?</a></p>
      </div>
    </div>`;
  afterRenderReveal();
}
window.doRegister = async function() {
  try {
    const body = {
      name: document.getElementById('regName').value.trim(),
      contact: document.getElementById('regContact').value.trim(),
      email: document.getElementById('regEmail').value.trim(),
      recoveryEmail: document.getElementById('regRecoveryEmail').value.trim(),
      password: document.getElementById('regPassword').value,
      autoRenew: document.getElementById('regAutoRenew').checked,
    };
    const { token } = await api('/auth/business/register', { method: 'POST', body: JSON.stringify(body) });
    bizToken = token; localStorage.setItem('sm_biz_token', token);
    render();
  } catch (e) { alert(e.message); }
};
window.doLogin = async function() {
  try {
    const body = { email: document.getElementById('loginEmail').value.trim(), password: document.getElementById('loginPassword').value };
    const { token } = await api('/auth/business/login', { method: 'POST', body: JSON.stringify(body) });
    bizToken = token; localStorage.setItem('sm_biz_token', token);
    render();
  } catch (e) { alert(e.message); }
};
window.logoutBiz = function() { bizToken = null; localStorage.removeItem('sm_biz_token'); render(); };

async function renderDashboard(biz) {
  let listings = [];
  try { listings = (await api('/my/listings', {}, bizToken)).listings; } catch (e) {}
  const idLast8 = biz.id.slice(-8);
  app.innerHTML = `
    <div class="row reveal" style="margin-bottom:8px;">
      <h2>${esc(biz.name)}'s dashboard</h2>
      <button class="btn btn-ghost btn-sm" onclick="logoutBiz()">Log out</button>
    </div>
    <p class="muted reveal" style="margin-bottom:18px;">Business ID: <code>${esc(biz.id)}</code> — the last 8 characters (<strong>${esc(idLast8)}</strong>) are what you'll need if you ever have to reset your password.</p>
    <div class="row reveal" style="margin-bottom:22px;">
      <span class="badge ${biz.status === 'active' ? 'badge-active' : 'badge-pending'}">${biz.status === 'active' ? 'Active' : biz.status === 'suspended' ? 'Suspended' : 'Pending payment'}</span>
      ${biz.freeSlot ? '<span class="badge badge-free">Free launch spot</span>' : ''}
      <span class="badge ${biz.chatEnabled ? 'badge-active' : 'badge-pending'}">Assistant chat: ${biz.chatEnabled ? 'On' : 'Off'}</span>
      <button class="btn btn-ghost btn-sm" onclick="toggleChat(${!biz.chatEnabled})">${biz.chatEnabled ? 'Turn off' : 'Turn on'}</button>
      <span class="badge ${biz.autoRenew ? 'badge-active' : 'badge-pending'}">Auto-renew: ${biz.autoRenew ? 'On' : 'Off'}</span>
      ${biz.autoRenew ? `<button class="btn btn-ghost btn-sm" onclick="toggleAutoRenew(false)">Turn off</button>` : `<button class="btn btn-ghost btn-sm" onclick="promptAutoRenewPhone()">Turn on</button>`}
    </div>
    <div class="card reveal" style="margin-bottom:22px;">
      <h3 style="font-size:1rem;margin-bottom:12px;">Profile photo</h3>
      <div style="display:flex;align-items:center;gap:14px;">
        ${biz.profilePhotoUrl ? `<img src="${esc(biz.profilePhotoUrl)}" class="avatar" style="width:56px;height:56px;">` : `<div class="avatar" style="width:56px;height:56px;"></div>`}
        <input type="file" id="bizPhotoInput" accept="image/*">
        <button class="btn btn-ghost btn-sm" onclick="uploadBizPhoto()">Upload</button>
      </div>
    </div>
    ${biz.status !== 'active' && !biz.freeSlot ? `
    <div class="card reveal" style="margin-bottom:22px;">
      <h3 style="font-size:1rem;margin-bottom:12px;">Pay your weekly subscription — MTN Mobile Money</h3>
      <div class="field"><label>Phone to charge (format 2567XXXXXXXX)</label><input id="momoPhone" placeholder="2567XXXXXXXX"></div>
      <button class="btn btn-sky" onclick="paySubscription()">Request payment on my phone</button>
      <p class="muted" id="payStatus" style="margin-top:10px;"></p>
    </div>` : biz.status !== 'active' ? `<div class="banner gold reveal">You have a free launch spot — the admin will activate your account shortly.</div>` : ''}
    <div class="card reveal" style="margin-bottom:24px;">
      <h3 style="font-size:1rem;margin-bottom:14px;">Add a listing</h3>
      <div class="field"><label>Good name</label><input id="listTitle"></div>
      <div class="field"><label>Price (UGX)</label><input id="listPrice" type="number"></div>
      <div class="field"><label>Stock quantity</label><input id="listStock" type="number" value="1"></div>
      <div class="field"><label>Description</label><textarea id="listDesc" rows="2"></textarea></div>
      <button class="btn btn-primary" onclick="addListing()">Add listing</button>
    </div>
    <h3 class="reveal" style="font-size:1rem;margin-bottom:14px;">Your listings (${listings.length})</h3>
    ${listings.length === 0 ? '<div class="empty">No listings yet — add one above.</div>' : `<div class="grid">` + listings.map(l => `
      <div class="card reveal">
        ${l.photo_url ? `<div class="listing-photo" style="background-image:url('${esc(l.photo_url)}')"></div>` : ''}
        <h3 style="font-size:1rem;margin-bottom:6px;">${esc(l.title)}</h3>
        <div class="price">${fmt(l.price)}</div>
        <p style="font-size:0.85rem;margin:8px 0;">${esc(l.description || '')}</p>
        <div class="field"><label>Stock</label><input type="number" value="${l.stock_qty}" onchange="updateStock('${l.id}', this.value)"></div>
        <input type="file" accept="image/*" onchange="uploadListingPhoto('${l.id}', this)" style="margin-bottom:10px;">
        <div class="row">
          <span class="badge ${l.active ? 'badge-active' : 'badge-pending'}">${l.active ? 'Visible' : 'Hidden'}</span>
          <button class="btn btn-ghost btn-sm" onclick="toggleListing('${l.id}', ${l.active ? 0 : 1})">${l.active ? 'Hide' : 'Show'}</button>
        </div>
      </div>`).join('') + `</div>`}
  `;
  afterRenderReveal();
}
window.uploadBizPhoto = async function() {
  const input = document.getElementById('bizPhotoInput'); if (!input.files[0]) return;
  const fd = new FormData(); fd.append('photo', input.files[0]);
  try { await api('/auth/business/photo', { method: 'POST', body: fd }, bizToken); render(); } catch (e) { alert(e.message); }
};
window.uploadListingPhoto = async function(id, input) {
  if (!input.files[0]) return;
  const fd = new FormData(); fd.append('photo', input.files[0]);
  try { await api(`/my/listings/${id}/photo`, { method: 'POST', body: fd }, bizToken); render(); } catch (e) { alert(e.message); }
};
window.addListing = async function() {
  try {
    const body = { title: document.getElementById('listTitle').value.trim(), price: document.getElementById('listPrice').value, stockQty: document.getElementById('listStock').value, description: document.getElementById('listDesc').value.trim() };
    await api('/my/listings', { method: 'POST', body: JSON.stringify(body) }, bizToken);
    render();
  } catch (e) { alert(e.message); }
};
window.updateStock = async function(id, value) {
  try { await api(`/my/listings/${id}`, { method: 'PATCH', body: JSON.stringify({ stockQty: Number(value) }) }, bizToken); } catch (e) { alert(e.message); }
};
window.toggleListing = async function(id, active) {
  try { await api(`/my/listings/${id}`, { method: 'PATCH', body: JSON.stringify({ active }) }, bizToken); render(); } catch (e) { alert(e.message); }
};
window.toggleChat = async function(on) {
  try { await api('/my/chat/toggle', { method: 'POST', body: JSON.stringify({ on }) }, bizToken); render(); } catch (e) { alert(e.message); }
};
window.toggleAutoRenew = async function(on, phone) {
  try { await api('/my/auto-renew', { method: 'POST', body: JSON.stringify({ on, phone }) }, bizToken); render(); } catch (e) { alert(e.message); }
};
window.promptAutoRenewPhone = function() {
  const phone = prompt('Mobile Money number to charge automatically for renewals (e.g. 2567XXXXXXXX):');
  if (!phone) return;
  toggleAutoRenew(true, phone);
};
window.paySubscription = async function() {
  const phone = document.getElementById('momoPhone').value.trim();
  const status = document.getElementById('payStatus');
  try {
    const { referenceId, message } = await api('/payments/subscribe', { method: 'POST', body: JSON.stringify({ phone }) }, bizToken);
    status.textContent = message;
    const poll = setInterval(async () => {
      try {
        const { status: s } = await api(`/payments/status/${referenceId}`, {}, bizToken);
        status.textContent = 'Payment status: ' + s;
        if (s === 'SUCCESSFUL' || s === 'FAILED') { clearInterval(poll); render(); }
      } catch (e) { clearInterval(poll); status.textContent = e.message; }
    }, 4000);
  } catch (e) { status.textContent = e.message; }
};

// ---------------- boot ----------------
(async function boot() {
  await refreshCustomer();
  updateAccountBtn();
  render();
})();
