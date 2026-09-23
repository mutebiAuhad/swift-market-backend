const API = '/api';
const TOKEN = localStorage.getItem('sm_token');

function $(sel) { return document.querySelector(sel); }

async function api(path, opts = {}) {
  const headers = Object.assign({}, opts.headers);
  if (!(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (TOKEN) headers['Authorization'] = 'Bearer ' + TOKEN;
  const res = await fetch(API + path, Object.assign({}, opts, { headers }));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function statusBanner(status, isActive, expiresAt) {
  if (isActive) {
    return `<div class="alert alert-success">Active — renews/expires ${new Date(expiresAt).toLocaleDateString()}.</div>`;
  }
  if (status === 'pending_payment') return `<div class="alert alert-info">No active subscription yet. Choose a payment method below.</div>`;
  if (status === 'expired') return `<div class="alert alert-error">Your subscription has expired. Renew below to regain access.</div>`;
  return '';
}

(async function init() {
  if (!TOKEN) { $('#loggedOutBox').classList.remove('hidden'); return; }

  let me;
  try {
    me = await api('/auth/me');
  } catch (e) {
    $('#loggedOutBox').classList.remove('hidden');
    return;
  }

  $('#accountBox').classList.remove('hidden');
  $('#statusBanner').innerHTML = statusBanner(me.user.status, me.isActive, me.user.subscriptionExpiresAt);
  if (me.isActive) $('#subscribeSection').style.display = 'none';

  const params = new URLSearchParams(window.location.search);
  if (params.get('checkout') === 'success') {
    $('#statusBanner').innerHTML = `<div class="alert alert-success">Payment received! It may take a few seconds to reflect — refresh if needed.</div>` + $('#statusBanner').innerHTML;
  }

  const bank = await api('/subscription/bank-details');
  $('#bankDetails').innerHTML = bank.bankName
    ? `<table>
        <tr><td>Bank</td><td>${bank.bankName}</td></tr>
        <tr><td>Account name</td><td>${bank.accountName || '-'}</td></tr>
        <tr><td>Account number</td><td>${bank.accountNumber || '-'}</td></tr>
        ${bank.swiftCode ? `<tr><td>SWIFT/BIC</td><td>${bank.swiftCode}</td></tr>` : ''}
        <tr><td>Amount</td><td>$${bank.amountUsd}</td></tr>
       </table>
       ${bank.instructions ? `<p class="muted">${bank.instructions}</p>` : ''}`
    : `<p class="muted">Bank transfer details haven't been set up yet — please use the card option above.</p>`;

  $('#stripeBtn').addEventListener('click', async () => {
    try {
      const data = await api('/subscription/checkout', { method: 'POST' });
      window.location.href = data.url;
    } catch (err) { alert(err.message); }
  });

  $('#proofForm').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const data = await api('/subscription/bank-transfer', { method: 'POST', body: fd });
      $('#statusBanner').innerHTML = `<div class="alert alert-success">${data.message}</div>`;
      e.target.reset();
    } catch (err) { alert(err.message); }
  });
})();
