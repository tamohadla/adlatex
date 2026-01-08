/* Yarn Master Data (V1) */
import { supabase } from "../shared/supabaseClient.js";

const LOGIN_URL = "../index.html";

const TABS = [
  { key: "suppliers", table: "suppliers", columns: ["name", "is_active"] },
  { key: "factories", table: "factories", columns: ["name", "is_active"] },
  { key: "yarn_types", table: "yarn_types", columns: ["name", "is_active"] },
  { key: "yarn_brands", table: "yarn_brands", columns: ["name", "yarn_type_id", "is_active"] },
];

const $ = (s, r=document) => r.querySelector(s);

const tabsEl = document.querySelector(".tabs");
const thead = $("#thead");
const tbody = $("#tbody");
const count = $("#count");
const q = $("#q");
const showInactive = $("#showInactive");
const btnRefresh = $("#btnRefresh");
const btnAdd = $("#btnAdd");

const whoami = $("#whoami");

/* Modal */
const modalEdit = $("#modalEdit");
const modalTitle = $("#modalTitle");
const msg = $("#msg");
const nameInput = $("#name");
const isActive = $("#isActive");
const brandTypeWrap = $("#brandTypeWrap");
const brandType = $("#brandType");
const btnSave = $("#btnSave");

/* Confirm */
const modalConfirm = $("#modalConfirm");
const confirmText = $("#confirmText");
const btnConfirm = $("#btnConfirm");

let currentTab = TABS[0];
let rows = [];
let isManager = false;

let editId = null; // uuid
let confirmAction = null;

function openModal(m){ m.classList.add("open"); m.setAttribute("aria-hidden","false"); }
function closeModal(m){ m.classList.remove("open"); m.setAttribute("aria-hidden","true"); }

document.addEventListener("click", (e) => {
  const closeBtn = e.target.closest("[data-close]");
  if (closeBtn) {
    const modal = closeBtn.closest(".modal");
    if (modal) closeModal(modal);
  }
  if (e.target.classList.contains("modal")) closeModal(e.target);
});

async function requireSession(){
  const { data } = await supabase.auth.getSession();
  if (!data?.session) { window.location.href = LOGIN_URL; return null; }
  return data.session;
}

function showMsg(text, type="ok"){
  msg.style.display="block";
  msg.textContent=text;
  msg.className = "status " + (type==="ok"?"ok":"err");
}

function clearMsg(){
  msg.style.display="none";
  msg.textContent="";
  msg.className="status";
}

async function loadIsManager(){
  // Prefer is_manager()
  try{
    const r = await supabase.rpc("is_manager");
    if (!r.error && typeof r.data === "boolean") {
      isManager = r.data;
      return;
    }
  }catch(_){}
  // Fallback: profiles.base_role
  const { data: u } = await supabase.auth.getUser();
  const userId = u?.user?.id;
  if (!userId) return;
  const p = await supabase.from("profiles").select("base_role,is_active").eq("user_id", userId).maybeSingle();
  if (!p.error && p.data) {
    isManager = (p.data.is_active !== false) && (p.data.base_role === "manager");
  }
}

function setWhoAmI(){
  if (!isManager) {
    whoami.style.display="block";
    whoami.textContent="Note: You are not a manager. You may be blocked by RLS from editing master data.";
  } else {
    whoami.style.display="none";
  }
}

async function refreshBrandTypes(){
  const r = await supabase.from("yarn_types").select("id,name,is_active").order("name");
  if (r.error) throw r.error;
  brandType.innerHTML = `<option value="">— Select —</option>`;
  for (const x of (r.data||[]).filter(z => z.is_active !== false)) {
    brandType.insertAdjacentHTML("beforeend", `<option value="${x.id}">${x.name}</option>`);
  }
}

function renderTable(){
  const query = (q.value||"").trim().toLowerCase();
  const showInact = !!showInactive.checked;

  let filtered = rows;
  if (query) filtered = filtered.filter(r => String(r.name||"").toLowerCase().includes(query));
  if (!showInact) filtered = filtered.filter(r => r.is_active !== false);

  // Head
  if (currentTab.key === "yarn_brands") {
    thead.innerHTML = `
      <tr>
        <th>Name</th>
        <th>Yarn Type</th>
        <th>Status</th>
        <th>Actions</th>
      </tr>`;
  } else {
    thead.innerHTML = `
      <tr>
        <th>Name</th>
        <th>Status</th>
        <th>Actions</th>
      </tr>`;
  }

  tbody.innerHTML = "";
  for (const r of filtered) {
    const tr = document.createElement("tr");

    const statusBadge = r.is_active === false
      ? `<span class="badge">Inactive</span>`
      : `<span class="badge">Active</span>`;

    let typeCell = "";
    if (currentTab.key === "yarn_brands") {
      typeCell = `<td>${r.yarn_type_name || r.yarn_type_id || "—"}</td>`;
    }

    tr.innerHTML = `
      <td>${r.name || "—"}</td>
      ${typeCell}
      <td>${statusBadge}</td>
      <td></td>
    `;

    const actionsTd = tr.lastElementChild;
    const btnE = document.createElement("button");
    btnE.className = "btn";
    btnE.textContent = "Edit";
    btnE.addEventListener("click", () => openEdit(r));
    actionsTd.appendChild(btnE);

    const btnT = document.createElement("button");
    btnT.className = "btn danger";
    btnT.textContent = r.is_active === false ? "Activate" : "Deactivate";
    btnT.style.marginLeft = "8px";
    btnT.addEventListener("click", () => openConfirmToggle(r));
    actionsTd.appendChild(btnT);

    tbody.appendChild(tr);
  }

  count.textContent = `Rows: ${filtered.length} (total ${rows.length})`;
}

async function loadRows(){
  if (currentTab.key === "yarn_brands") {
    const r = await supabase
      .from("yarn_brands")
      .select("id,name,yarn_type_id,is_active, yarn_types(name)")
      .order("name");
    if (r.error) throw r.error;
    rows = (r.data||[]).map(x => ({
      id: x.id,
      name: x.name,
      yarn_type_id: x.yarn_type_id,
      yarn_type_name: x.yarn_types?.name || null,
      is_active: x.is_active
    }));
    return;
  }

  const r = await supabase.from(currentTab.table).select("id,name,is_active").order("name");
  if (r.error) throw r.error;
  rows = r.data || [];
}

function openAdd(){
  editId = null;
  modalTitle.textContent = "Add";
  nameInput.value = "";
  isActive.checked = true;

  brandTypeWrap.style.display = currentTab.key === "yarn_brands" ? "block" : "none";
  if (currentTab.key === "yarn_brands") brandType.value = "";

  clearMsg();
  openModal(modalEdit);
}

function openEdit(r){
  editId = r.id;
  modalTitle.textContent = "Edit";
  nameInput.value = r.name || "";
  isActive.checked = r.is_active !== false;

  brandTypeWrap.style.display = currentTab.key === "yarn_brands" ? "block" : "none";
  if (currentTab.key === "yarn_brands") brandType.value = r.yarn_type_id || "";

  clearMsg();
  openModal(modalEdit);
}

function openConfirmToggle(r){
  confirmAction = async () => {
    const next = !(r.is_active !== false);
    const upd = await supabase.from(currentTab.table).update({ is_active: next }).eq("id", r.id);
    if (upd.error) throw upd.error;
  };
  confirmText.textContent = `Are you sure you want to ${r.is_active === false ? "activate" : "deactivate"} "${r.name}"?`;
  openModal(modalConfirm);
}

btnConfirm.addEventListener("click", async () => {
  if (!confirmAction) return;
  btnConfirm.disabled = true;
  try{
    await confirmAction();
    await refreshAll();
    closeModal(modalConfirm);
  }catch(e){
    confirmText.textContent = "Failed: " + (e?.message || e);
  }finally{
    btnConfirm.disabled = false;
    confirmAction = null;
  }
});

btnSave.addEventListener("click", async () => {
  clearMsg();

  const name = (nameInput.value||"").trim();
  if (!name) { showMsg("Name is required.", "err"); return; }

  const payload = { name, is_active: !!isActive.checked };

  if (currentTab.key === "yarn_brands") {
    const yt = brandType.value;
    if (!yt) { showMsg("Yarn Type is required for Yarn Brands.", "err"); return; }
    payload.yarn_type_id = yt;
  }

  btnSave.disabled = true;
  try{
    if (!editId) {
      const r = await supabase.from(currentTab.table).insert(payload);
      if (r.error) throw r.error;
      showMsg("Created.", "ok");
    } else {
      const r = await supabase.from(currentTab.table).update(payload).eq("id", editId);
      if (r.error) throw r.error;
      showMsg("Saved.", "ok");
    }
    await refreshAll();
    closeModal(modalEdit);
  }catch(e){
    showMsg("Failed: " + (e?.message || e), "err");
  }finally{
    btnSave.disabled = false;
  }
});

/* Tabs */
tabsEl.addEventListener("click", async (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  const key = btn.dataset.tab;
  const tab = TABS.find(t => t.key === key);
  if (!tab) return;

  [...tabsEl.querySelectorAll(".tab")].forEach(x => x.classList.toggle("active", x === btn));
  currentTab = tab;
  q.value = "";
  showInactive.checked = false;

  await refreshAll();
});

[q, showInactive].forEach(el => el.addEventListener("input", renderTable));
btnRefresh.addEventListener("click", refreshAll);
btnAdd.addEventListener("click", openAdd);

async function refreshAll(){
  try{
    if (currentTab.key === "yarn_brands") await refreshBrandTypes();
    await loadRows();
    renderTable();
  }catch(e){
    count.textContent = "Failed to load: " + (e?.message || e);
  }
}

(async function init(){
  await requireSession();
  await loadIsManager();
  setWhoAmI();
  await refreshAll();
})();
