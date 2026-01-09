import { supabase, toAsciiDigits, safeNumber } from "../shared/supabaseClient.js";
import { requireSession, logout, isManager } from "../shared/auth.js";

// ---------- UI helpers ----------
function qs(sel, root=document){ return root.querySelector(sel); }
function qsa(sel, root=document){ return [...root.querySelectorAll(sel)]; }

function openModal(id){
  const m = qs(`#${id}`);
  if (!m) return;
  m.setAttribute('aria-hidden','false');
  m.classList.add('open');
}
function closeModal(id){
  const m = qs(`#${id}`);
  if (!m) return;
  m.setAttribute('aria-hidden','true');
  m.classList.remove('open');
}
function wireModalClose(){
  qsa('[data-close]').forEach(btn=>{
    btn.addEventListener('click', ()=> closeModal(btn.getAttribute('data-close')));
  });
  qsa('.modal-backdrop').forEach(bg=>{
    const id = bg.getAttribute('data-close');
    if (id) bg.addEventListener('click', ()=> closeModal(id));
  });
}

function setStatus(msg, ok=false){
  const box = qs('#statusBox');
  box.textContent = msg || '';
  box.className = 'status ' + (ok ? 'ok' : '');
}

function todayISO(){
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}

// ---------- State ----------
let SESSION = null;
let IS_MANAGER = false;

let factories = [];
let dyeHouses = [];
let greigeTypes = [];
let greigeTypeComponents = new Map(); // greige_type_id -> [{yarn_type_id,pct,yarn_type_name}]
let yarnTypes = [];
let yarnBrandsByType = new Map(); // yarn_type_id -> [{id,name}]

let itemCounter = 0;

// ---------- Data loaders ----------
async function loadFactories(){
  const { data, error } = await supabase
    .from('factories')
    .select('id,name,is_active')
    .order('name');
  if (error) throw error;
  factories = (data || []).filter(r => r.is_active !== false);
}

async function loadDyeHouses(){
  const { data, error } = await supabase
    .from('dye_houses')
    .select('id,name,is_active')
    .order('name');
  if (error) throw error;
  dyeHouses = (data || []).filter(r => r.is_active !== false);
}

async function loadYarnTypes(){
  const { data, error } = await supabase
    .from('yarn_types')
    .select('id,name,is_active')
    .order('name');
  if (error) throw error;
  yarnTypes = (data || []).filter(r => r.is_active !== false);
}

async function loadGreigeTypes(){
  const { data, error } = await supabase
    .from('greige_types')
    .select('id,name,is_active')
    .order('name');
  if (error) throw error;
  greigeTypes = (data || []).filter(r => r.is_active !== false);

  const { data: comps, error: e2 } = await supabase
    .from('greige_type_components')
    .select('greige_type_id,yarn_type_id,pct,yarn_types(name)')
    .order('created_at');
  if (e2) throw e2;
  greigeTypeComponents.clear();
  (comps || []).forEach(r=>{
    const arr = greigeTypeComponents.get(r.greige_type_id) || [];
    arr.push({
      yarn_type_id: r.yarn_type_id,
      pct: Number(r.pct),
      yarn_type_name: r.yarn_types?.name || ''
    });
    greigeTypeComponents.set(r.greige_type_id, arr);
  });
}

async function loadYarnBrandsForType(yarnTypeId){
  if (yarnBrandsByType.has(yarnTypeId)) return;
  const { data, error } = await supabase
    .from('yarn_brands')
    .select('id,name,yarn_type_id,is_active')
    .eq('yarn_type_id', yarnTypeId)
    .order('name');
  if (error) throw error;
  yarnBrandsByType.set(yarnTypeId, (data || []).filter(r => r.is_active !== false));
}

// ---------- Rendering ----------
function fillSelect(selectEl, rows, valueKey='id', labelKey='name', placeholder='— اختر —'){
  selectEl.innerHTML = '';
  const opt0 = document.createElement('option');
  opt0.value = '';
  opt0.textContent = placeholder;
  selectEl.appendChild(opt0);
  rows.forEach(r=>{
    const o = document.createElement('option');
    o.value = r[valueKey];
    o.textContent = r[labelKey];
    selectEl.appendChild(o);
  });
}

function addItem(prefill=null){
  itemCounter++;
  const wrap = qs('#itemsWrap');
  const itemId = `item_${itemCounter}`;

  const el = document.createElement('div');
  el.className = 'item-card';
  el.dataset.itemId = itemId;
  el.innerHTML = `
    <div class="row-between" style="margin-bottom:10px">
      <div style="font-weight:700">بند #${itemCounter}</div>
      <div class="row">
        <button class="btn btn-light js-add-greige" type="button" title="تعريف خام جديد">+ خام</button>
        <button class="btn btn-danger js-remove" type="button">حذف</button>
      </div>
    </div>

    <div class="item-grid">
      <div class="field">
        <label>نوع الخام</label>
        <select class="js-greige-type"></select>
      </div>
      <div class="field">
        <label>الكمية (كغ)</label>
        <input class="js-qty" type="text" placeholder="مثال: 2000" />
      </div>
      <div class="field">
        <label>عدد الأتياب</label>
        <input class="js-rolls" type="text" placeholder="مثال: 100" />
      </div>
      <div class="field">
        <label>المواصفات</label>
        <input class="js-specs" type="text" placeholder="عرض / GSM / ملاحظات" />
      </div>
    </div>

    <div class="alloc-box">
      <div class="alloc-title">استهلاك الخيوط (حسب التركيبة)</div>
      <div class="components js-components muted">اختر نوع الخام ثم أدخل الكمية</div>
    </div>
  `;

  wrap.appendChild(el);

  const sel = qs('.js-greige-type', el);
  fillSelect(sel, greigeTypes, 'id', 'name', '— اختر نوع الخام —');

  // prefill
  if (prefill?.greige_type_id) sel.value = prefill.greige_type_id;
  if (prefill?.qty_kg) qs('.js-qty', el).value = String(prefill.qty_kg);
  if (prefill?.rolls) qs('.js-rolls', el).value = String(prefill.rolls);
  if (prefill?.specs) qs('.js-specs', el).value = prefill.specs;

  qs('.js-remove', el).addEventListener('click', ()=> el.remove());
  qs('.js-add-greige', el).addEventListener('click', ()=> {
    if (!IS_MANAGER){
      setStatus('غير مسموح: تعريف خام جديد للمدير فقط.');
      return;
    }
    openGreigeTypeModal();
  });

  // recompute on change
  const recompute = ()=> renderComponentsForItem(el);
  sel.addEventListener('change', recompute);
  qs('.js-qty', el).addEventListener('input', recompute);

  // initial
  renderComponentsForItem(el);
}

async function renderComponentsForItem(itemEl){
  const greigeTypeId = qs('.js-greige-type', itemEl).value;
  const qty = safeNumber(qs('.js-qty', itemEl).value);
  const box = qs('.js-components', itemEl);

  if (!greigeTypeId || !qty || qty <= 0){
    box.classList.add('muted');
    box.innerHTML = 'اختر نوع الخام ثم أدخل الكمية';
    return;
  }

  const comps = greigeTypeComponents.get(greigeTypeId) || [];
  if (!comps.length){
    box.classList.add('muted');
    box.innerHTML = 'لا توجد تركيبة مسجلة لهذا النوع.';
    return;
  }

  box.classList.remove('muted');
  box.innerHTML = '';

  for (const c of comps){
    const required = Math.round((qty * (Number(c.pct) || 0) / 100) * 1000) / 1000;

    await loadYarnBrandsForType(c.yarn_type_id);
    const brands = yarnBrandsByType.get(c.yarn_type_id) || [];

    const row = document.createElement('div');
    row.className = 'alloc-row';
    row.dataset.yarnTypeId = c.yarn_type_id;
    row.innerHTML = `
      <div class="field">
        <label>نوع الخيط</label>
        <input type="text" value="${escapeHtml(c.yarn_type_name)}" disabled />
      </div>
      <div class="field">
        <label>الكمية المطلوبة (كغ)</label>
        <input type="text" value="${required.toFixed(3)}" disabled />
      </div>
      <div class="field">
        <label>ماركة الخيط</label>
        <select class="js-brand"></select>
      </div>
      <div class="field">
        <label>رقم اللوط (اختياري)</label>
        <input class="js-lot" type="text" placeholder="مثال: L-1" />
      </div>
    `;

    const brandSel = qs('.js-brand', row);
    fillSelect(brandSel, brands, 'id', 'name', '— اختر الماركة —');
    if (brands.length === 1) brandSel.value = brands[0].id;

    box.appendChild(row);
  }
}

function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#039;'}[c]));
}

// ---------- Greige Type modal (create) ----------
function compTotal(){
  let sum = 0;
  qsa('#compRows .comp-row').forEach(r=>{
    const pct = safeNumber(qs('.js-pct', r).value);
    if (pct != null) sum += pct;
  });
  return Math.round(sum * 100) / 100;
}

function updateCompSum(){
  const sum = compTotal();
  qs('#compSum').textContent = `${sum}%`;
  qs('#compWarn').textContent = (sum === 100) ? '' : 'يجب أن يكون الإجمالي 100%';
}

function addCompRow(prefill=null){
  const wrap = qs('#compRows');
  const row = document.createElement('div');
  row.className = 'comp-row';
  row.innerHTML = `
    <div class="field">
      <label>نوع الخيط</label>
      <select class="js-yarn-type"></select>
    </div>
    <div class="field">
      <label>النسبة %</label>
      <input class="js-pct" type="text" placeholder="مثال: 96" />
    </div>
    <div class="field">
      <button class="btn btn-danger js-del" type="button" style="width:100%">حذف</button>
    </div>
    <div></div>
  `;
  wrap.appendChild(row);

  const sel = qs('.js-yarn-type', row);
  fillSelect(sel, yarnTypes, 'id', 'name', '— اختر نوع الخيط —');
  if (prefill?.yarn_type_id) sel.value = prefill.yarn_type_id;
  if (prefill?.pct != null) qs('.js-pct', row).value = String(prefill.pct);

  qs('.js-pct', row).addEventListener('input', updateCompSum);
  sel.addEventListener('change', updateCompSum);
  qs('.js-del', row).addEventListener('click', ()=>{ row.remove(); updateCompSum(); });

  updateCompSum();
}

function openGreigeTypeModal(){
  qs('#greigeTypeName').value = '';
  qs('#greigeTypeMsg').textContent = '';
  qs('#compRows').innerHTML = '';
  addCompRow();
  openModal('greigeTypeModal');
}

async function saveGreigeType(){
  const name = qs('#greigeTypeName').value.trim();
  if (!name){
    qs('#greigeTypeMsg').textContent = 'الاسم مطلوب.';
    return;
  }
  const total = compTotal();
  if (total !== 100){
    qs('#greigeTypeMsg').textContent = 'الإجمالي يجب أن يكون 100%.';
    return;
  }

  const comps = [];
  for (const row of qsa('#compRows .comp-row')){
    const yarn_type_id = qs('.js-yarn-type', row).value;
    const pct = safeNumber(qs('.js-pct', row).value);
    if (!yarn_type_id || pct == null || pct <= 0){
      qs('#greigeTypeMsg').textContent = 'تحقق من نوع الخيط والنسبة.';
      return;
    }
    comps.push({ yarn_type_id, pct });
  }

  try{
    const { data: gt, error } = await supabase
      .from('greige_types')
      .insert({ name, is_active: true })
      .select('id')
      .single();
    if (error) throw error;

    const rows = comps.map(c => ({ greige_type_id: gt.id, yarn_type_id: c.yarn_type_id, pct: c.pct }));
    const { error: e2 } = await supabase.from('greige_type_components').insert(rows);
    if (e2) throw e2;

    qs('#greigeTypeMsg').textContent = 'تم الحفظ.';
    await loadGreigeTypes();
    // refresh all item selects
    qsa('.js-greige-type').forEach(s => fillSelect(s, greigeTypes, 'id', 'name', '— اختر نوع الخام —'));
    closeModal('greigeTypeModal');
  }catch(err){
    console.error(err);
    qs('#greigeTypeMsg').textContent = err.message || 'فشل الحفظ.';
  }
}

// ---------- Import ----------
function parseImportLines(text){
  const lines = text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const rows = [];
  for (const line of lines){
    const parts = line.split('|').map(p=>p.trim());
    if (parts.length < 3){
      rows.push({ _error: `صيغة غير صحيحة: ${line}` });
      continue;
    }
    const name = parts[0];
    const qty = safeNumber(parts[1]);
    const rolls = safeNumber(parts[2]);
    const specs = parts.slice(3).join(' | ') || '';

    const gt = greigeTypes.find(g=>g.name.toLowerCase() === name.toLowerCase())
           || greigeTypes.find(g=>g.name === name);
    if (!gt){
      rows.push({ _error: `نوع خام غير موجود: ${name}` });
      continue;
    }
    if (!qty){
      rows.push({ _error: `كمية غير صحيحة: ${line}` });
      continue;
    }
    rows.push({ greige_type_id: gt.id, qty_kg: qty, rolls: rolls ?? null, specs });
  }
  return rows;
}

function applyImport(){
  const text = qs('#importText').value || '';
  const parsed = parseImportLines(text);
  const errors = parsed.filter(r => r._error);
  if (errors.length){
    qs('#importMsg').textContent = errors.slice(0,6).map(e=>e._error).join(' | ');
    return;
  }

  parsed.forEach(r => addItem(r));
  qs('#importText').value = '';
  qs('#importMsg').textContent = `تم إضافة ${parsed.length} بند.`;
  closeModal('importModal');
}

// ---------- Submit ----------
async function submitReceipt(){
  try{
    setStatus('جارٍ الإرسال...');

    const receipt_no = toAsciiDigits(qs('#receiptNo').value).trim();
    const receipt_date = qs('#receiptDate').value;
    const factory_id = qs('#factorySelect').value;
    const dye_house_id = qs('#dyeHouseSelect').value;

    if (!receipt_no) return setStatus('رقم الإذن مطلوب.');
    if (!receipt_date) return setStatus('تاريخ الإذن مطلوب.');
    if (!factory_id) return setStatus('اختر المصنع.');
    if (!dye_house_id) return setStatus('اختر المستلم.');

    const itemEls = qsa('#itemsWrap .item-card');
    if (!itemEls.length) return setStatus('أضف بند واحد على الأقل.');

    const items = [];
    for (const el of itemEls){
      const greige_type_id = qs('.js-greige-type', el).value;
      const qty_kg = safeNumber(qs('.js-qty', el).value);
      const rolls = safeNumber(qs('.js-rolls', el).value);
      const specs = qs('.js-specs', el).value.trim();

      if (!greige_type_id) return setStatus('اختر نوع الخام لكل بند.');
      if (!qty_kg || qty_kg <= 0) return setStatus('الكمية يجب أن تكون رقمًا > 0.');

      const allocations = [];
      qsa('.alloc-row', el).forEach(r=>{
        const yarn_type_id = r.dataset.yarnTypeId;
        const yarn_brand_id = qs('.js-brand', r).value;
        const lot_no = toAsciiDigits(qs('.js-lot', r).value).trim();
        if (!yarn_brand_id) throw new Error('اختر الماركة لكل خيط داخل البند.');
        allocations.push({ yarn_type_id, yarn_brand_id, lot_no: lot_no || null });
      });

      items.push({
        greige_type_id,
        qty_kg,
        rolls: rolls ?? null,
        specs: specs || null,
        allocations
      });
    }

    const payload = { receipt_no, receipt_date, factory_id, dye_house_id, items };

    const { data, error } = await supabase.rpc('submit_greige_receipt_request', { p_data: payload });
    if (error) throw error;

    const msg = IS_MANAGER
      ? `تم حفظ الإذن واعتماده. رقم: ${receipt_no}`
      : `تم إرسال الإذن للمراجعة. رقم: ${receipt_no}`;

    setStatus(msg, true);

    // reset
    qs('#receiptNo').value = '';
    qs('#itemsWrap').innerHTML = '';
    addItem();
  }catch(err){
    console.error(err);
    setStatus(err.message || 'فشل الإرسال.');
  }
}

// ---------- Dye house modal ----------
async function saveDyeHouse(){
  const name = qs('#dyeHouseName').value.trim();
  if (!name){ qs('#dyeHouseMsg').textContent = 'الاسم مطلوب.'; return; }
  if (!IS_MANAGER){ qs('#dyeHouseMsg').textContent = 'غير مسموح (للمدير فقط).'; return; }

  try{
    const { error } = await supabase.from('dye_houses').insert({ name, is_active: true });
    if (error) throw error;
    qs('#dyeHouseMsg').textContent = 'تم الحفظ.';
    await loadDyeHouses();
    fillSelect(qs('#dyeHouseSelect'), dyeHouses, 'id', 'name', '— اختر —');
    closeModal('dyeHouseModal');
  }catch(err){
    console.error(err);
    qs('#dyeHouseMsg').textContent = err.message || 'فشل الحفظ.';
  }
}

// ---------- Init ----------
async function init(){
  wireModalClose();

  SESSION = await requireSession('../auth/login.html');
  if (!SESSION) return;

  IS_MANAGER = await isManager();
  qs('#userInfo').textContent = `${SESSION.user.email} • ${IS_MANAGER ? 'Manager' : 'Data Entry'}`;

  qs('#logoutBtn').addEventListener('click', ()=> logout('../auth/login.html'));

  qs('#receiptDate').value = todayISO();

  await Promise.all([loadFactories(), loadDyeHouses(), loadYarnTypes(), loadGreigeTypes()]);

  fillSelect(qs('#factorySelect'), factories, 'id', 'name', '— اختر المصنع —');
  fillSelect(qs('#dyeHouseSelect'), dyeHouses, 'id', 'name', '— اختر المستلم —');

  // buttons
  qs('#addItemBtn').addEventListener('click', ()=> addItem());
  qs('#submitBtn').addEventListener('click', submitReceipt);

  qs('#addDyeHouseBtn').addEventListener('click', ()=>{
    qs('#dyeHouseName').value = '';
    qs('#dyeHouseMsg').textContent = '';
    openModal('dyeHouseModal');
  });
  qs('#saveDyeHouseBtn').addEventListener('click', saveDyeHouse);

  qs('#addCompRowBtn').addEventListener('click', ()=> addCompRow());
  qs('#saveGreigeTypeBtn').addEventListener('click', saveGreigeType);

  qs('#openImportBtn').addEventListener('click', ()=>{ qs('#importMsg').textContent=''; openModal('importModal'); });
  qs('#applyImportBtn').addEventListener('click', applyImport);

  // numeric normalization
  qs('#receiptNo').addEventListener('input', e => e.target.value = toAsciiDigits(e.target.value));

  // initial item
  addItem();

  // disable manager-only add if needed
  if (!IS_MANAGER){
    qs('#addDyeHouseBtn').disabled = true;
  }
}

init();
