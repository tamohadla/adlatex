import { supabase } from "../shared/supabaseClient.js";
import { requireSession, logout, isManager } from "../shared/auth.js";

function qs(sel, root=document){ return root.querySelector(sel); }
function qsa(sel, root=document){ return [...root.querySelectorAll(sel)]; }

function openModal(id){ const m=qs(`#${id}`); if(!m) return; m.classList.add('open'); m.setAttribute('aria-hidden','false'); }
function closeModal(id){ const m=qs(`#${id}`); if(!m) return; m.classList.remove('open'); m.setAttribute('aria-hidden','true'); }
function wireModalClose(){
  qsa('[data-close]').forEach(b=> b.addEventListener('click', ()=> closeModal(b.getAttribute('data-close'))));
  qsa('.modal-backdrop').forEach(bg=>{
    const id = bg.getAttribute('data-close');
    if(id) bg.addEventListener('click', ()=> closeModal(id));
  });
}

function setMsg(text){ qs('#msg').textContent = text || ''; }

let SESSION=null;
let IS_MANAGER=false;
let rows=[];

function fmtNum(n){
  const v = Number(n);
  if(!Number.isFinite(v)) return '';
  return v.toFixed(3);
}

function render(){
  const tbody = qs('#dataTable tbody');
  tbody.innerHTML='';

  const q = (qs('#searchInput').value || '').trim().toLowerCase();
  const st = qs('#statusFilter').value;

  const filtered = rows.filter(r=>{
    if(st && r.status !== st) return false;
    if(!q) return true;
    return (
      String(r.receipt_no||'').toLowerCase().includes(q) ||
      String(r.factory_name||'').toLowerCase().includes(q) ||
      String(r.dye_house_name||'').toLowerCase().includes(q) ||
      String(r.greige_type_name||'').toLowerCase().includes(q)
    );
  });

  if(!filtered.length){
    const tr=document.createElement('tr');
    tr.innerHTML='<td colspan="10" class="muted">No rows</td>';
    tbody.appendChild(tr);
    return;
  }

  for(const r of filtered){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.receipt_date||''}</td>
      <td>${escapeHtml(r.receipt_no||'')}</td>
      <td>${escapeHtml(r.factory_name||'')}</td>
      <td>${escapeHtml(r.dye_house_name||'')}</td>
      <td>${escapeHtml(r.greige_type_name||'')}</td>
      <td>${fmtNum(r.qty_kg)}</td>
      <td>${r.rolls ?? ''}</td>
      <td>${escapeHtml(r.specs||'')}</td>
      <td><span class="tag">${escapeHtml(r.status_text||r.status||'')}</span></td>
      <td>
        <div class="btn-col">
          <button class="btn btn-light" data-act="preview" data-item="${r.item_id}">معاينة</button>
          ${IS_MANAGER && r.status==='pending' ? `<button class="btn btn-primary" data-act="approve" data-receipt="${r.receipt_id}">اعتماد</button>` : ''}
          ${IS_MANAGER && r.status==='pending' ? `<button class="btn btn-danger" data-act="reject" data-receipt="${r.receipt_id}">رفض</button>` : ''}
          ${!IS_MANAGER ? `<button class="btn btn-danger" data-act="reqdel" data-receipt="${r.receipt_id}">طلب حذف</button>` : `<button class="btn btn-danger" data-act="reqdel" data-receipt="${r.receipt_id}">حذف</button>`}
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  }

  // wire actions
  qsa('[data-act="preview"]', tbody).forEach(b=> b.addEventListener('click', ()=> openPreview(b.dataset.item)));
  qsa('[data-act="approve"]', tbody).forEach(b=> b.addEventListener('click', ()=> approveReceipt(b.dataset.receipt)));
  qsa('[data-act="reject"]', tbody).forEach(b=> b.addEventListener('click', ()=> rejectReceipt(b.dataset.receipt)));
  qsa('[data-act="reqdel"]', tbody).forEach(b=> b.addEventListener('click', ()=> requestDelete(b.dataset.receipt)));
}

function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#039;'}[c]));
}

async function fetchRows(){
  setMsg('Loading...');
  const { data, error } = await supabase.from('greige_item_lines_view').select('*').order('created_at',{ascending:false});
  if(error){ setMsg(error.message); return; }
  rows = data || [];
  setMsg('');
  render();
}

async function openPreview(itemId){
  const { data, error } = await supabase.from('greige_item_allocations_view').select('*').eq('item_id', itemId);
  if(error){ setMsg(error.message); return; }

  const body = qs('#previewBody');
  const alloc = data || [];
  body.innerHTML = `
    <div class="card" style="padding:12px">
      <div style="font-weight:700;margin-bottom:8px">Yarn Allocations</div>
      ${alloc.length ? `
        <table class="table">
          <thead><tr><th>Yarn Type</th><th>Brand</th><th>Lot</th><th>Required (kg)</th></tr></thead>
          <tbody>
            ${alloc.map(a=>`<tr><td>${escapeHtml(a.yarn_type_name)}</td><td>${escapeHtml(a.yarn_brand_name)}</td><td>${escapeHtml(a.lot_no||'')}</td><td>${fmtNum(a.required_qty)}</td></tr>`).join('')}
          </tbody>
        </table>
      ` : `<div class="muted">No allocations</div>`}
    </div>
  `;

  openModal('previewModal');
}

async function approveReceipt(receiptId){
  if(!confirm('اعتماد الطلب؟')) return;
  const { error } = await supabase.rpc('approve_greige_receipt_request', { p_id: receiptId });
  if(error){ setMsg(error.message); return; }
  await fetchRows();
}

async function rejectReceipt(receiptId){
  const reason = prompt('سبب الرفض (اختياري):') || null;
  const { error } = await supabase.rpc('reject_greige_receipt_request', { p_id: receiptId, p_reason: reason });
  if(error){ setMsg(error.message); return; }
  await fetchRows();
}

async function requestDelete(receiptId){
  if(!confirm(IS_MANAGER ? 'حذف الإذن؟' : 'إرسال طلب حذف للمراجعة؟')) return;
  const { error } = await supabase.rpc('request_delete_greige_receipt', { p_id: receiptId });
  if(error){ setMsg(error.message); return; }
  await fetchRows();
}

async function init(){
  wireModalClose();

  SESSION = await requireSession('../auth/login.html');
  if(!SESSION) return;
  IS_MANAGER = await isManager();
  qs('#roleInfo').textContent = `${SESSION.user.email} • ${IS_MANAGER ? 'Manager' : 'Data Entry'}`;

  qs('#logoutBtn').addEventListener('click', ()=> logout('../auth/login.html'));
  qs('#refreshBtn').addEventListener('click', fetchRows);
  qs('#searchInput').addEventListener('input', render);
  qs('#statusFilter').addEventListener('change', render);

  await fetchRows();
}

init();
