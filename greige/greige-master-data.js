import { supabase, safeNumber } from "../shared/supabaseClient.js";
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

function fillSelect(selectEl, rows, placeholder='— Select —'){
  selectEl.innerHTML='';
  const o0=document.createElement('option'); o0.value=''; o0.textContent=placeholder; selectEl.appendChild(o0);
  rows.forEach(r=>{ const o=document.createElement('option'); o.value=r.id; o.textContent=r.name; selectEl.appendChild(o); });
}

let SESSION=null;
let IS_MANAGER=false;
let yarnTypes=[];

let editingDyeHouseId=null;
let editingGreigeTypeId=null;

async function loadYarnTypes(){
  const { data, error } = await supabase.from('yarn_types').select('id,name,is_active').order('name');
  if (error) throw error;
  yarnTypes = (data||[]).filter(r=> r.is_active !== false);
}

async function refreshLists(){
  qs('#msg').textContent='';

  const { data: dh, error: e1 } = await supabase.from('dye_houses').select('id,name,is_active').order('name');
  if (e1) throw e1;

  const { data: gt, error: e2 } = await supabase.from('greige_types').select('id,name,is_active').order('name');
  if (e2) throw e2;

  const { data: comps, error: e3 } = await supabase
    .from('greige_type_components')
    .select('greige_type_id,yarn_type_id,pct,yarn_types(name)')
    .order('created_at');
  if (e3) throw e3;

  const compMap = new Map();
  (comps||[]).forEach(r=>{
    const arr = compMap.get(r.greige_type_id) || [];
    arr.push({ yarn_type_id: r.yarn_type_id, yarn_type_name: r.yarn_types?.name || '', pct: Number(r.pct) });
    compMap.set(r.greige_type_id, arr);
  });

  renderDyeHouses(dh||[]);
  renderGreigeTypes(gt||[], compMap);
}

function renderDyeHouses(rows){
  const wrap = qs('#dyeHousesList');
  wrap.innerHTML='';
  if (!rows.length){ wrap.innerHTML='<div class="muted">No dye houses.</div>'; return; }

  rows.forEach(r=>{
    const el = document.createElement('div');
    el.className='list-item';
    el.innerHTML=`
      <div class="list-row">
        <div><strong>${escapeHtml(r.name)}</strong> <span class="tag">${r.is_active ? 'Active' : 'Inactive'}</span></div>
        <div class="small-actions">
          <button class="btn btn-light" data-act="edit" data-id="${r.id}">Edit</button>
          <button class="btn btn-danger" data-act="del" data-id="${r.id}">Delete</button>
        </div>
      </div>
    `;
    wrap.appendChild(el);
  });

  qsa('[data-act="edit"]', wrap).forEach(b=> b.addEventListener('click', ()=> openEditDyeHouse(b.dataset.id)));
  qsa('[data-act="del"]', wrap).forEach(b=> b.addEventListener('click', ()=> deleteDyeHouse(b.dataset.id)));
}

function renderGreigeTypes(types, compMap){
  const wrap = qs('#greigeTypesList');
  wrap.innerHTML='';
  if (!types.length){ wrap.innerHTML='<div class="muted">No greige types.</div>'; return; }

  types.forEach(t=>{
    const comps = compMap.get(t.id) || [];
    const compText = comps.map(c=> `${c.yarn_type_name} ${Number(c.pct).toFixed(2)}%`).join(' • ');

    const el = document.createElement('div');
    el.className='list-item';
    el.innerHTML=`
      <div class="list-row">
        <div>
          <div><strong>${escapeHtml(t.name)}</strong> <span class="tag">${t.is_active ? 'Active' : 'Inactive'}</span></div>
          <div class="muted" style="margin-top:6px">${escapeHtml(compText || 'No composition')}</div>
        </div>
        <div class="small-actions">
          <button class="btn btn-light" data-act="editgt" data-id="${t.id}">Edit</button>
          <button class="btn btn-danger" data-act="delgt" data-id="${t.id}">Delete</button>
        </div>
      </div>
    `;
    wrap.appendChild(el);
  });

  qsa('[data-act="editgt"]', wrap).forEach(b=> b.addEventListener('click', ()=> openEditGreigeType(b.dataset.id)));
  qsa('[data-act="delgt"]', wrap).forEach(b=> b.addEventListener('click', ()=> deleteGreigeType(b.dataset.id)));
}

function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#039;'}[c]));
}

// -------- Dye Houses modal --------
function openAddDyeHouse(){
  editingDyeHouseId = null;
  qs('#dyeHouseModalTitle').textContent = 'Add Dye House';
  qs('#dyeHouseName').value='';
  qs('#dyeHouseActive').checked=true;
  qs('#dyeHouseModalMsg').textContent='';
  openModal('dyeHouseModal');
}

async function openEditDyeHouse(id){
  editingDyeHouseId = id;
  qs('#dyeHouseModalTitle').textContent = 'Edit Dye House';
  qs('#dyeHouseModalMsg').textContent='';
  const { data, error } = await supabase.from('dye_houses').select('id,name,is_active').eq('id', id).single();
  if (error) return (qs('#msg').textContent = error.message);
  qs('#dyeHouseName').value = data.name || '';
  qs('#dyeHouseActive').checked = data.is_active !== false;
  openModal('dyeHouseModal');
}

async function saveDyeHouse(){
  if (!IS_MANAGER){ qs('#msg').textContent='Manager only.'; return; }
  const name = (qs('#dyeHouseName').value || '').trim();
  const is_active = !!qs('#dyeHouseActive').checked;
  if (!name){ qs('#dyeHouseModalMsg').textContent='Name required.'; return; }

  try{
    if (!editingDyeHouseId){
      const { error } = await supabase.from('dye_houses').insert({ name, is_active });
      if (error) throw error;
    }else{
      const { error } = await supabase.from('dye_houses').update({ name, is_active }).eq('id', editingDyeHouseId);
      if (error) throw error;
    }
    closeModal('dyeHouseModal');
    await refreshLists();
  }catch(err){
    qs('#dyeHouseModalMsg').textContent = err.message || 'Failed.';
  }
}

async function deleteDyeHouse(id){
  if (!IS_MANAGER){ qs('#msg').textContent='Manager only.'; return; }
  if (!confirm('Delete dye house?')) return;
  const { error } = await supabase.from('dye_houses').delete().eq('id', id);
  if (error) return (qs('#msg').textContent = error.message);
  await refreshLists();
}

// -------- Greige types modal --------
function compTotal(){
  let sum=0;
  qsa('#compRows .comp-row').forEach(r=>{ const pct=safeNumber(qs('.js-pct', r).value); if (pct!=null) sum += pct; });
  return Math.round(sum*100)/100;
}
function updateCompSum(){
  const sum = compTotal();
  qs('#compSum').textContent = `${sum}%`;
  qs('#compWarn').textContent = (sum===100) ? '' : 'Must equal 100%';
}

function addCompRow(prefill=null){
  const wrap = qs('#compRows');
  const row = document.createElement('div');
  row.className='comp-row';
  row.innerHTML = `
    <div class="field">
      <label>Yarn Type</label>
      <select class="js-yarn"></select>
    </div>
    <div class="field">
      <label>%</label>
      <input class="js-pct" type="text" placeholder="96" />
    </div>
    <div class="field">
      <button class="btn btn-danger js-del" type="button" style="width:100%">Remove</button>
    </div>
    <div></div>
  `;
  wrap.appendChild(row);

  const sel = qs('.js-yarn', row);
  fillSelect(sel, yarnTypes, '— Yarn type —');
  if (prefill?.yarn_type_id) sel.value = prefill.yarn_type_id;
  if (prefill?.pct != null) qs('.js-pct', row).value = String(prefill.pct);

  sel.addEventListener('change', updateCompSum);
  qs('.js-pct', row).addEventListener('input', updateCompSum);
  qs('.js-del', row).addEventListener('click', ()=>{ row.remove(); updateCompSum(); });

  updateCompSum();
}

function openAddGreigeType(){
  editingGreigeTypeId = null;
  qs('#greigeTypeModalTitle').textContent='Add Greige Type';
  qs('#greigeTypeName').value='';
  qs('#greigeTypeActive').checked=true;
  qs('#greigeTypeModalMsg').textContent='';
  qs('#compRows').innerHTML='';
  addCompRow();
  openModal('greigeTypeModal');
}

async function openEditGreigeType(id){
  editingGreigeTypeId = id;
  qs('#greigeTypeModalTitle').textContent='Edit Greige Type';
  qs('#greigeTypeModalMsg').textContent='';

  const { data: t, error: e1 } = await supabase.from('greige_types').select('id,name,is_active').eq('id', id).single();
  if (e1) return (qs('#msg').textContent = e1.message);

  const { data: comps, error: e2 } = await supabase
    .from('greige_type_components')
    .select('yarn_type_id,pct')
    .eq('greige_type_id', id)
    .order('created_at');
  if (e2) return (qs('#msg').textContent = e2.message);

  qs('#greigeTypeName').value = t.name || '';
  qs('#greigeTypeActive').checked = t.is_active !== false;

  qs('#compRows').innerHTML='';
  (comps||[]).forEach(c=> addCompRow({ yarn_type_id: c.yarn_type_id, pct: c.pct }));
  if (!(comps||[]).length) addCompRow();
  updateCompSum();
  openModal('greigeTypeModal');
}

async function saveGreigeType(){
  if (!IS_MANAGER){ qs('#msg').textContent='Manager only.'; return; }

  const name = (qs('#greigeTypeName').value || '').trim();
  const is_active = !!qs('#greigeTypeActive').checked;
  if (!name){ qs('#greigeTypeModalMsg').textContent='Name required.'; return; }
  if (compTotal() !== 100){ qs('#greigeTypeModalMsg').textContent='Composition must equal 100%.'; return; }

  const compRows = [];
  for (const row of qsa('#compRows .comp-row')){
    const yarn_type_id = qs('.js-yarn', row).value;
    const pct = safeNumber(qs('.js-pct', row).value);
    if (!yarn_type_id || pct==null || pct<=0){
      qs('#greigeTypeModalMsg').textContent='Check yarn type and pct.';
      return;
    }
    compRows.push({ yarn_type_id, pct });
  }

  try{
    let gtId = editingGreigeTypeId;
    if (!gtId){
      const { data, error } = await supabase.from('greige_types').insert({ name, is_active }).select('id').single();
      if (error) throw error;
      gtId = data.id;
    } else {
      const { error } = await supabase.from('greige_types').update({ name, is_active }).eq('id', gtId);
      if (error) throw error;
      // reset components
      const { error: ed } = await supabase.from('greige_type_components').delete().eq('greige_type_id', gtId);
      if (ed) throw ed;
    }

    const toInsert = compRows.map(c=>({ greige_type_id: gtId, yarn_type_id: c.yarn_type_id, pct: c.pct }));
    const { error: ei } = await supabase.from('greige_type_components').insert(toInsert);
    if (ei) throw ei;

    closeModal('greigeTypeModal');
    await refreshLists();
  }catch(err){
    qs('#greigeTypeModalMsg').textContent = err.message || 'Failed.';
  }
}

async function deleteGreigeType(id){
  if (!IS_MANAGER){ qs('#msg').textContent='Manager only.'; return; }
  if (!confirm('Delete greige type?')) return;
  const { error } = await supabase.from('greige_types').delete().eq('id', id);
  if (error) return (qs('#msg').textContent = error.message);
  await refreshLists();
}

// -------- Init --------
async function init(){
  wireModalClose();

  SESSION = await requireSession('../auth/login.html');
  if (!SESSION) return;
  IS_MANAGER = await isManager();
  qs('#roleInfo').textContent = `${SESSION.user.email} • ${IS_MANAGER ? 'Manager' : 'Data Entry'}`;

  qs('#logoutBtn').addEventListener('click', ()=> logout('../auth/login.html'));

  await loadYarnTypes();
  await refreshLists();

  // buttons
  qs('#addDyeHouseBtn').addEventListener('click', openAddDyeHouse);
  qs('#saveDyeHouseBtn').addEventListener('click', saveDyeHouse);

  qs('#addGreigeTypeBtn').addEventListener('click', openAddGreigeType);
  qs('#addCompRowBtn').addEventListener('click', ()=> addCompRow());
  qs('#saveGreigeTypeBtn').addEventListener('click', saveGreigeType);

  if (!IS_MANAGER){
    qs('#msg').textContent = 'Read-only: Manager only can edit master data.';
  }
}

init();
