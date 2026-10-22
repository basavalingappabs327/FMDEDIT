/**
 * ============================================================
 *  CONFIG – put your Apps Script Web App URL here
 * ============================================================
 */
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxs0j2cpM6tzqE9oDasjsW7JawQFb_JUvxu6inGWILsDnhcL8JBHWBop2p9candbxmV/exec';

/** Sheet tab name. Leave '' to use the first tab. */
const SHEET_NAME = '';

/* ============================================================ */

let rows = [];          // {row, sl, name, aadhaar, mobile, tag, owner(name), ownerSl}
let editing = null;
let mode = 'edit';   // 'edit' | 'add'
let connected = false;

function $(id) { return document.getElementById(id); }

function toast(msg, isError) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  setTimeout(() => t.className = 'toast', 2800);
}

function setStatus(text, type) {
  $('statusText').textContent = text;
  $('liveDot').className = 'dot' + (type === 'ok' ? ' live' : type === 'err' ? ' err' : '');
}

function setLoading(on) { $('tableLoading').classList.toggle('show', on); }

function setConnected(yes) {
  connected = yes;
  $('btnRefresh').disabled = !yes;
  $('searchInput').disabled = !yes;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function callScript(action, payload, retried) {
  if (!SCRIPT_URL || SCRIPT_URL.startsWith('PASTE_')) {
    throw new Error('Open script.js and set your Web App URL in SCRIPT_URL');
  }
  const body = Object.assign({
    action: action,
    sheetName: SHEET_NAME,
    code: sessionStorage.getItem('fmdCode') || ''
  }, payload || {});
  const res = await fetch(SCRIPT_URL, {
    method: 'POST',
    mode: 'cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('Network error HTTP ' + res.status);
  const json = await res.json();
  if (json.error === 'AUTH') {
    if (retried) throw new Error('Wrong passcode');
    const code = prompt('Enter passcode');
    if (code === null) throw new Error('Passcode required');
    sessionStorage.setItem('fmdCode', code);
    return callScript(action, payload, true);
  }
  if (json.error) throw new Error(json.error);
  return json;
}

/** Animal rows inherit the owner above them (for display + search) */
function prepare(list) {
  let owner = '', ownerSl = '';
  return list.map(function (r) {
    if (r.name) { owner = r.name; ownerSl = r.sl; }
    return Object.assign({}, r, { isOwner: !!r.name, owner: owner, ownerSl: ownerSl });
  });
}

async function load(isRefresh) {
  setLoading(true);
  setStatus(isRefresh ? 'Refreshing…' : 'Loading…');
  try {
    const result = await callScript('list');
    rows = prepare(result.data || []);
    setConnected(true);
    const owners = rows.filter(r => r.isOwner).length;
    setStatus('Live · ' + owners + ' owners · ' + rows.filter(r => r.tag).length + ' ear tags', 'ok');
    render();
    if (isRefresh) toast('Refreshed');
  } catch (e) {
    if (!isRefresh) { setConnected(false); rows = []; render(); }
    setStatus('Error: ' + e.message, 'err');
    toast(e.message, true);
  } finally {
    setLoading(false);
  }
}
function refresh() { return load(true); }

function render() {
  const q = $('searchInput').value.trim().toLowerCase();
  const tbody = $('tableBody');
  const html = [];
  let shown = 0;
  rows.forEach(function (m, idx) {
    if (q) {
      const hay = (m.owner + ' ' + m.ownerSl + ' ' + m.aadhaar + ' ' + m.mobile + ' ' + m.tag).toLowerCase();
      if (!hay.includes(q)) return;
    }
    shown++;
    if (m.isOwner) {
      html.push('<tr class="owner-start"><td>' + escapeHtml(m.sl) + '</td>' +
        '<td class="name-cell">' + escapeHtml(m.name) + '</td>' +
        '<td class="num-cell">' + (escapeHtml(m.aadhaar) || '—') + '</td>' +
        '<td class="num-cell">' + (escapeHtml(m.mobile) || '—') + '</td>' +
        '<td class="tag-cell">' + (escapeHtml(m.tag) || '—') + '</td>');
    } else {
      // animal row: show owner name faintly only when searching, so results make sense
      html.push('<tr class="sub-row"><td></td>' +
        '<td class="muted">' + (q ? '↳ ' + escapeHtml(m.owner) : '') + '</td>' +
        '<td></td><td></td>' +
        '<td class="tag-cell">' + escapeHtml(m.tag) + '</td>');
    }
    html.push('<td class="actions"><button class="btn btn-outline btn-sm" onclick="openEditModal(' + idx + ')">Edit</button>' +
      (m.isOwner ? '<button class="btn btn-success btn-sm" title="Add ear tag" onclick="openAddTagModal(' + idx + ')">＋ Tag</button>' : '') +
      '</td></tr>');
  });
  tbody.innerHTML = html.join('');
  $('ownerCount').textContent = rows.filter(r => r.isOwner).length;
  $('tagCount').textContent = rows.filter(r => r.tag).length;
  $('showCount').textContent = shown;
  $('emptyState').style.display = shown === 0 ? 'block' : 'none';
}

function openAddTagModal(idx) {
  if (!connected) return;
  mode = 'add';
  editing = idx;
  const m = rows[idx];
  $('modalTitle').textContent = 'Add ear tag';
  $('modalOwner').textContent = (m.ownerSl ? m.ownerSl + '. ' : '') + m.owner + '  (sheet row ' + m.row + ')';
  $('gAadhaar').style.display = 'none';
  $('gMobile').style.display = 'none';
  $('gCopy').style.display = '';
  $('fTag').value = '';
  $('saveBtn').textContent = 'Add to Sheet';
  $('modal').classList.add('open');
  $('fTag').focus();
}

function openEditModal(idx) {
  if (!connected) return;
  mode = 'edit';
  $('gCopy').style.display = 'none';
  $('saveBtn').textContent = 'Update Sheet';
  editing = idx;
  const m = rows[idx];
  $('modalTitle').textContent = m.isOwner ? 'Edit details' : 'Edit ear tag';
  $('modalOwner').textContent = (m.ownerSl ? m.ownerSl + '. ' : '') + m.owner + '  (sheet row ' + m.row + ')';
  $('gAadhaar').style.display = m.isOwner ? '' : 'none';
  $('gMobile').style.display = m.isOwner ? '' : 'none';
  $('fAadhaar').value = m.aadhaar;
  $('fMobile').value = m.mobile;
  $('fTag').value = m.tag;
  $('modal').classList.add('open');
  (m.isOwner ? $('fAadhaar') : $('fTag')).focus();
}

function closeModal() { $('modal').classList.remove('open'); editing = null; }

async function addTag() {
  const m = rows[editing];
  const tag = $('fTag').value.trim();
  if (!/^\d{8,}$/.test(tag)) { toast('Ear tag must be at least 8 digits', true); return; }
  if (rows.some(r => r.tag === tag)) { toast('Ear tag already exists', true); return; }
  const btn = $('saveBtn');
  btn.disabled = true;
  const original = btn.textContent;
  btn.innerHTML = '<span class="spinner"></span> Adding…';
  try {
    await callScript('addTag', {
      ownerRow: m.row, ownerName: m.name, tag: tag, copyCounts: $('fCopy').checked
    });
    closeModal();
    await load(true);       // rows shift after an insert, so reload
    toast('Ear tag added');
  } catch (e) {
    toast(e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

async function saveItem() {
  if (!connected || editing === null) return;
  if (mode === 'add') return addTag();
  const m = rows[editing];
  const item = {
    aadhaar: $('fAadhaar').value.trim(),
    mobile: $('fMobile').value.trim(),
    tag: $('fTag').value.trim()
  };
  if (m.isOwner) {
    if (item.aadhaar && !/^\d{12}$/.test(item.aadhaar)) { toast('Aadhaar must be 12 digits', true); return; }
    if (item.mobile && !/^\d{10}$/.test(item.mobile)) { toast('Mobile must be 10 digits', true); return; }
  }
  if (item.tag && !/^\d+$/.test(item.tag)) { toast('Ear tag must be digits only', true); return; }

  const btn = $('saveBtn');
  btn.disabled = true;
  const original = btn.textContent;
  btn.innerHTML = '<span class="spinner"></span> Saving…';
  try {
    await callScript('update', {
      row: m.row,
      ownerRow: m.isOwner,
      item: item,
      old: { aadhaar: m.aadhaar, mobile: m.mobile, tag: m.tag }
    });
    // update locally (no full reload needed)
    if (m.isOwner) { m.aadhaar = item.aadhaar; m.mobile = item.mobile; }
    m.tag = item.tag;
    closeModal();
    render();
    toast('Sheet updated');
  } catch (e) {
    toast(e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

$('searchInput').addEventListener('input', render);
$('modal').addEventListener('click', function (e) { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

load(false);
