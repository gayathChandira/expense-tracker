/**
 * Expense Tracker - Main Core Logic
 */

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
let allData = JSON.parse(localStorage.getItem('expense_db')) || {};
let selectedCat = '';
let selectedPaid = '';
let editCat = '';
let editPaid = '';
let currentBrowseFilter = 'All';

// Configuration check display
function verifyConfig() {
  const banner = document.getElementById('configBanner');
  if (!CONFIG.SCRIPT_URL || CONFIG.SCRIPT_URL.includes('YOUR_DEPLOYMENT_ID')) {
    if (banner) banner.style.display = 'block';
    return false;
  }
  if (banner) banner.style.display = 'none';
  return true;
}

// ── Network Engine ───────────────────────────────────────────────────────────
/**
 * Sends request safely via POST using x-www-form-urlencoded params
 */
// ── Network Engine (JSONP Implementation) ───────────────────────────────────
function requestSecureData(queryString) {
  if (!CONFIG.SCRIPT_URL || CONFIG.SCRIPT_URL.includes('YOUR_DEPLOYMENT_ID')) {
    throw new Error("Google Apps Script URL is not configured in config.js");
  }

  return new Promise((resolve, reject) => {
    const callbackName = 'jsonp_' + Math.random().toString(36).substr(2, 9);
    
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error("Connection timeout from Google Sheets."));
    }, 15000);

    window[callbackName] = function(data) {
      cleanup();
      resolve(data);
    };

    function cleanup() {
      clearTimeout(timeoutId);
      const scriptNode = document.getElementById(callbackName);
      if (scriptNode) scriptNode.remove();
      delete window[callbackName];
    }

    const separator = CONFIG.SCRIPT_URL.indexOf('?') === -1 ? '?' : '&';
    const fullUrl = `${CONFIG.SCRIPT_URL}${separator}${queryString}&callback=${callbackName}`;

    const script = document.createElement('script');
    script.id = callbackName;
    script.src = fullUrl;
    script.onerror = () => {
      cleanup();
      reject(new Error("Network connection breakdown."));
    };

    document.body.appendChild(script);
  });
}

// ── Document Event Initialization ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Update App Personalizations from configuration setup
  if (document.getElementById('topbar-subtitle')) {
    document.getElementById('topbar-subtitle').textContent = CONFIG.SUBTITLE;
  }

  // Set Default date picker value to today
  const dateInput = document.getElementById('inp-date');
  if (dateInput) dateInput.value = today();

  // Setup Interaction Pills
  setupPills('cat-pills', (v) => { selectedCat = v; });
  setupPills('paid-pills', (v) => { selectedPaid = v; });
  setupPills('edit-cat-pills', (v) => { editCat = v; });
  setupPills('edit-paid-pills', (v) => { editPaid = v; });

  // Filter chips interaction listener
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentBrowseFilter = chip.dataset.filter;
      renderBrowse();
    });
  });

  // Verify URL and start sync routine
  verifyConfig();
  syncData();
});

function today() { 
  return new Date().toISOString().split('T')[0]; 
}

// ── Navigation ───────────────────────────────────────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  
  const targetScreen = document.getElementById('screen-' + name);
  const targetNav = document.getElementById('nav-' + name);
  
  if (targetScreen) targetScreen.classList.add('active');
  if (targetNav) targetNav.classList.add('active');
  
  if (name === 'browse') renderBrowse();
  if (name === 'summary') renderSummary();
}

// ── Pill selector helpers ────────────────────────────────────────────────────
function setupPills(containerId, callback) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('.pill, .paid-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      container.querySelectorAll('.pill, .paid-pill').forEach(p => p.classList.remove('selected'));
      pill.classList.add('selected');
      callback(pill.dataset.val);
    });
  });
}

function selectPill(containerId, value) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('.pill, .paid-pill').forEach(p => {
    p.classList.toggle('selected', p.dataset.val === value);
  });
}

// ── Month helpers ────────────────────────────────────────────────────────────
function monthFromDate(dateStr) {
  if (!dateStr) return MONTHS[new Date().getMonth()];
  const d = new Date(dateStr + 'T00:00:00');
  return MONTHS[d.getMonth()];
}

function buildMonthSelector() {
  const container = document.getElementById('browse-months');
  if (!container) return;
  
  // Find current working selected month if it exists, otherwise use current calendar month
  let currentSel = container.querySelector('.month-chip.active')?.dataset.month || MONTHS[new Date().getMonth()];
  container.innerHTML = '';
  
  MONTHS.forEach(m => {
    const chip = document.createElement('div');
    chip.className = `month-chip ${m === currentSel ? 'active' : ''}`;
    chip.dataset.month = m;
    chip.textContent = m;
    chip.addEventListener('click', () => {
      container.querySelectorAll('.month-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      renderBrowse();
    });
    container.appendChild(chip);
  });
}

function showLoading(show) {
  const btn = document.getElementById('syncBtn');
  if (btn) btn.classList.toggle('spinning', show);
}

// ── Sync Database ────────────────────────────────────────────────────────────
// ── Fixed Form Submissions & Mutations Functions ─────────────────────────────
async function syncData() {
  showLoading(true);
  try {
    // Calls out request logic using clean GET parameter syntax
    const json = await requestSecureData('action=fetch');
    if (json.status === 'ok') {
      allData = json.expenses || {};
      localStorage.setItem('expense_db', JSON.stringify(allData));
      
      if (json.dashboard) {
        renderDashboardData(json.dashboard);
      }
      initApp();
      showToast('Synced with Google Sheets ✓', 'success');
    } else {
      showToast('Sync failed: ' + json.message, 'error');
    }
  } catch(e) {
    console.error(e);
    showToast('Connection error', 'error');
  } finally {
    showLoading(false);
  }
}

// ── Add Expense ──────────────────────────────────────────────────────────────
async function addExpense() {
  const date = document.getElementById('inp-date').value;
  const amount = parseFloat(document.getElementById('inp-amount').value);
  const notes = document.getElementById('inp-notes').value.trim();

  if (!date) return showToast('Pick a date', 'error');
  if (!selectedCat) return showToast('Select a category', 'error');
  if (!selectedPaid) return showToast('Select who paid', 'error');
  if (!amount || amount <= 0) return showToast('Enter a valid amount', 'error');

  const btn = document.getElementById('addBtn');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  const month = monthFromDate(date);

  try {
    const params = `action=add&month=${encodeURIComponent(month)}&date=${encodeURIComponent(date)}&category=${encodeURIComponent(selectedCat)}&paidBy=${encodeURIComponent(selectedPaid)}&amount=${encodeURIComponent(amount)}&notes=${encodeURIComponent(notes)}`;
    const json = await requestSecureData(params);
    
    if (json.status === 'ok') {
      showToast('Expense added! 🎉', 'success');
      // Reset forms
      document.getElementById('inp-amount').value = '';
      document.getElementById('inp-notes').value = '';
      document.getElementById('inp-date').value = today();
      selectedCat = ''; selectedPaid = '';
      document.querySelectorAll('#cat-pills .pill, #paid-pills .paid-pill').forEach(p => p.classList.remove('selected'));
      
      await syncData();
    } else {
      showToast('Error adding expense', 'error');
    }
  } catch(e) {
    console.error(e);
    showToast('Connection error', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Expense';
  }
}

// ── Browse screen renderer ───────────────────────────────────────────────────
function renderBrowse() {
  buildMonthSelector();
  const monthChipsContainer = document.getElementById('browse-months');
  const activeMonthChip = monthChipsContainer ? monthChipsContainer.querySelector('.month-chip.active') : null;
  const selectedMonth = activeMonthChip ? activeMonthChip.dataset.month : MONTHS[new Date().getMonth()];
  
  const list = document.getElementById('expense-list');
  if (!list) return;
  list.innerHTML = '';

  let arr = allData[selectedMonth] || [];

  // Sort descending dates
  arr.sort((a, b) => new Date(b.date) - new Date(a.date));

  // Category filter criteria mapping
  if (currentBrowseFilter !== 'All') {
    arr = arr.filter(e => e.category === currentBrowseFilter);
  }

  if (arr.length === 0) {
    list.innerHTML = `<div style="text-align:center; color:var(--text-light); padding:40px 20px; font-size:14px;">No transactions logged under ${selectedMonth} (${currentBrowseFilter})</div>`;
    return;
  }

  const paidMeta = {
    'Gayath':  { icon: '👤', color: '#1D4ED8' },
    'Dharani': { icon: '👤', color: '#7C3AED' },
    'Both':    { icon: '👥', color: '#059669' }
  };
  const catIcons = { 'Food': '🍽️', 'Transport': '🚗', 'Bills': '💡', 'Groceries': '🛒', 'Entertainment': '🎬', 'Medicine': '💊', 'Other': '📦' };

  let html = '';
  arr.forEach(e => {
    const icon = catIcons[e.category] || '📦';
    const pm = paidMeta[e.paidBy] || { icon: '💰', color: 'var(--text-mid)' };
    html += `
    <div class="expense-item" onclick="openEditModal(${JSON.stringify(e).replace(/"/g, '&quot;')})">
      <div class="expense-icon" style="background:var(--cream-dark)">${icon}</div>
      <div class="expense-info">
        <div class="expense-title">${e.notes || e.category}</div>
        <div class="expense-meta">
          <span class="cat-badge">${e.category}</span> &nbsp;${formatDate(e.date)}
        </div>
      </div>
      <div class="expense-right">
        <div class="expense-amount">LKR ${fmt(e.amount)}</div>
        <div class="expense-paid" style="color:${pm.color}">${e.paidBy}</div>
      </div>
    </div>`;
  });
  list.innerHTML = html;
}

// ── Summary Render calculations ──────────────────────────────────────────────────────────────
function renderSummary() {
  const monthSelect = document.getElementById('summary-month-select');
  if (!monthSelect) return;
  const month = monthSelect.value;
  const data = allData[month] || [];

  const total = data.reduce((s, e) => s + parseFloat(e.amount || 0), 0);
  const gayath = data.filter(e => e.paidBy === 'Gayath').reduce((s, e) => s + parseFloat(e.amount || 0), 0);
  const dharani = data.filter(e => e.paidBy === 'Dharani').reduce((s, e) => s + parseFloat(e.amount || 0), 0);
  const both = data.filter(e => e.paidBy === 'Both').reduce((s, e) => s + parseFloat(e.amount || 0), 0);

  document.getElementById('hero-total').textContent = 'LKR ' + fmt(total);
  document.getElementById('hero-month').textContent = month;
  document.getElementById('breakdown-gayath').textContent = 'LKR ' + fmt(gayath);
  document.getElementById('breakdown-dharani').textContent = 'LKR ' + fmt(dharani);
  document.getElementById('breakdown-both').textContent = 'LKR ' + fmt(both);

  // Group by category totals calculations
  const cats = { 'Food': 0, 'Transport': 0, 'Bills': 0, 'Groceries': 0, 'Entertainment': 0, 'Medicine': 0, 'Other': 0 };
  data.forEach(e => { if (cats[e.category] !== undefined) cats[e.category] += parseFloat(e.amount || 0); });

  // Update DOM category bars
  for (const [c, val] of Object.entries(cats)) {
    const lower = c.toLowerCase();
    const txtEl = document.getElementById(`sum-txt-${lower}`);
    const barEl = document.getElementById(`sum-bar-${lower}`);
    
    if (txtEl) txtEl.textContent = 'LKR ' + fmt(val);
    if (barEl) {
      const pct = total > 0 ? (val / total) * 100 : 0;
      barEl.style.width = `${pct}%`;
    }
  }
}

// ── Edit/Delete Modal Controls ─────────────────────────────────────────────────
function openEditModal(expense) {
  const rowValue = expense.rowIndex || expense.row || '';
  document.getElementById('edit-row-index').value = rowValue;
  document.getElementById('edit-date').value = expense.date;
  document.getElementById('edit-amount').value = expense.amount;
  document.getElementById('edit-notes').value = expense.notes || '';
  
  editCat = expense.category;
  editPaid = expense.paidBy;
  
  selectPill('edit-cat-pills', editCat);
  selectPill('edit-paid-pills', editPaid);
  
  document.getElementById('editModal').classList.add('show');
}

function closeModal() {
  document.getElementById('editModal').classList.remove('show');
}

async function updateExpense() {
  const row = document.getElementById('edit-row-index').value;
  const date = document.getElementById('edit-date').value;
  const amount = document.getElementById('edit-amount').value;
  const notes = document.getElementById('edit-notes').value;

  if (!date || !editCat || !editPaid || !amount) {
    showToast('Fields cannot be empty', 'error');
    return;
  }

  if (!row) {
    showToast('Unable to locate row index', 'error');
    return;
  }

  const month = MONTHS[new Date(date + 'T00:00:00').getMonth()];
  showLoading(true);

  try {
    const params = `action=update&rowIndex=${row}&month=${encodeURIComponent(month)}&date=${date}&category=${encodeURIComponent(editCat)}&paidBy=${encodeURIComponent(editPaid)}&amount=${amount}&notes=${encodeURIComponent(notes)}`;
    console.debug('updateExpense params', params);
    const json = await requestSecureData(params);

    if (json.status === 'ok') {
      showToast('Updated ✓', 'success');
      closeModal();
      await syncData();
    } else {
      showToast('Error updating', 'error');
    }
  } catch(e) {
    console.error(e);
    showToast('Connection error', 'error');
  } finally {
    showLoading(false);
  }
}

async function deleteExpense() {
  if (!confirm('Delete this expense?')) return;
  const row = document.getElementById('edit-row-index').value;
  const date = document.getElementById('edit-date').value;
  if (!row) {
    showToast('Unable to locate row index', 'error');
    return;
  }

  const month = MONTHS[new Date(date + 'T00:00:00').getMonth()];
  
  showLoading(true);
  try {
    const params = `action=delete&rowIndex=${row}&month=${encodeURIComponent(month)}`;
    console.debug('deleteExpense params', params);
    const json = await requestSecureData(params);
    
    if (json.status === 'ok') {
      showToast('Deleted ✓', 'success');
      closeModal();
      await syncData();
    } else {
      showToast('Error deleting', 'error');
    }
  } catch(e) {
    console.error(e);
    showToast('Connection error', 'error');
  } finally {
    showLoading(false);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n) {
  return Number(n || 0).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(d) {
  if (!d) return '';
  if (!isNaN(d) || typeof d === 'number') {
    return `Day ${d}`;
  }
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show ' + type;
  clearTimeout(window.toastTimeout);
  window.toastTimeout = setTimeout(() => { t.classList.remove('show'); }, 3000);
}
