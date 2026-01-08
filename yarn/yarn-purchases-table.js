/* =========================
   Yarn Purchases (Item-level Table) - V2
   - Preview + Separate Image Modal
   - Edit / Delete actions
   - Approve + Reject for managers
========================= */

import { supabase } from "../shared/supabaseClient.js";

/* ====== Config ====== */
const LOGIN_URL = "../index.html";

const T = {
  suppliers: "suppliers",
  factories: "factories",
  yarnTypes: "yarn_types",
  yarnBrands: "yarn_brands",
  orders: "yarn_purchase_orders",
  items: "yarn_purchase_items",
  viewItems: "v_yarn_purchase_items_table", // must contain: source,status,supplier_note_date,supplier_note_no,supplier_id,factory_id,yarn_type_id,yarn_brand_id,lot_no,qty,price,line_total,order_id,change_request_id,receipt_image_path
};

const RECEIPT_BUCKET = "receipts";

/* ====== RPC candidates (DB wrappers may differ by name) ====== */
const RPC_APPROVE_CANDIDATES = [
  "confirm_change_request",
  "approve_change_request",
  "approve_yarn_purchase_request",
  "approve_yarn_purchase_change_request",
];

const RPC_REJECT_CANDIDATES = [
  "reject_change_request",
  "reject_yarn_purchase_request",
  "reject_yarn_purchase_change_request",
];

const RPC_EDIT_CANDIDATES = [
  "submit_yarn_purchase_edit",
  "submit_yarn_purchase_edit_request",
  "submit_yarn_purchase_update",
  "request_yarn_purchase_edit",
];

const RPC_DELETE_CANDIDATES = [
  "submit_yarn_purchase_delete",
  "submit_yarn_purchase_delete_request",
  "request_yarn_purchase_delete",
];

/* ====== DOM ====== */
const tbody = document.querySelector("#tbody");
const countBox = document.querySelector("#countBox");

const search = document.querySelector("#search");
const sourceFilter = document.querySelector("#sourceFilter");
const statusFilter = document.querySelector("#statusFilter");
const btnRefresh = document.querySelector("#btnRefresh");

/* Preview Modal */
const modalPreview = document.querySelector("#modalPreview");
const previewTitle = document.querySelector("#previewTitle");
const previewStatus = document.querySelector("#previewStatus");
const previewSource = document.querySelector("#previewSource");
const previewNo = document.querySelector("#previewNo");
const previewDate = document.querySelector("#previewDate");
const previewSupplier = document.querySelector("#previewSupplier");
const previewFactory = document.querySelector("#previewFactory");
const previewItems = document.querySelector("#previewItems");
const previewGrand = document.querySelector("#previewGrand");
const previewMsg = document.querySelector("#previewMsg");
const btnApprove = document.querySelector("#btnApprove");
const btnReject = document.querySelector("#btnReject");
const btnOpenImage = document.querySelector("#btnOpenImage");
const previewNoImg = document.querySelector("#previewNoImg");

/* Image Modal */
const modalImage = document.querySelector("#modalImage");
const imgReceipt = document.querySelector("#imgReceipt");
const imgNoReceipt = document.querySelector("#imgNoReceipt");

/* Edit Modal */
const modalEdit = document.querySelector("#modalEdit");
const editMsg = document.querySelector("#editMsg");
const edit_supplierId = document.querySelector("#edit_supplierId");
const edit_factoryId = document.querySelector("#edit_factoryId");
const edit_supplierNoteDate = document.querySelector("#edit_supplierNoteDate");
const edit_supplierNoteNo = document.querySelector("#edit_supplierNoteNo");
const edit_note = document.querySelector("#edit_note");
const edit_itemsBody = document.querySelector("#edit_itemsBody");
const edit_grandTotal = document.querySelector("#edit_grandTotal");
const btnEditAddItem = document.querySelector("#btnEditAddItem");
const btnEditSubmit = document.querySelector("#btnEditSubmit");

/* Delete Modal */
const modalDelete = document.querySelector("#modalDelete");
const deleteMsg = document.querySelector("#deleteMsg");
const btnDeleteConfirm = document.querySelector("#btnDeleteConfirm");

/* ====== State ====== */
let rows = [];
let idToName = {
  suppliers: new Map(),
  factories: new Map(),
  yarnTypes: new Map(),
  yarnBrands: new Map(),
  yarnBrandToType: new Map(), // brand_id -> yarn_type_id
};
let currentUserId = null;
let isManager = false;

let currentPreview = null;
let currentEditOrderId = null;
let currentDeleteOrderId = null;

/* ====== Helpers ====== */
const $ = (sel, root = document) => root.querySelector(sel);

function openModal(m) { m.classList.add("open"); m.setAttribute("aria-hidden", "false"); }
function closeModal(m) { m.classList.remove("open"); m.setAttribute("aria-hidden", "true"); }

document.addEventListener("click", (e) => {
  const closeBtn = e.target.closest("[data-close]");
  if (closeBtn) {
    const modal = closeBtn.closest(".modal");
    if (modal) closeModal(modal);
  }
  if (e.target.classList.contains("modal")) {
    closeModal(e.target);
  }
});

function normalizeDigits(str) {
  const map = {
    "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
    "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
    "٫": ".", "،": ".", ",": "."
  };
  return String(str ?? "").replace(/[٠-٩۰-۹٫،,]/g, ch => map[ch] ?? ch).trim();
}

function fmt3(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const x = Number(n);
  return (Math.round(x * 1000) / 1000).toFixed(3);
}

function showInlineMsg(el, msg, type="ok") {
  el.style.display = "block";
  el.textContent = msg;
  el.className = "status " + (type === "ok" ? "ok" : "err");
}

async function requireSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) return null;
  if (!data?.session) {
    window.location.href = LOGIN_URL;
    return null;
  }
  return data.session;
}

async function callAnyRpc(candidates, argsVariants) {
  let lastErr = null;
  for (const fn of candidates) {
    for (const args of argsVariants) {
      const r = await supabase.rpc(fn, args);
      if (!r.error) return { fn, data: r.data };

      lastErr = r.error;
      const msg = String(r.error.message || "");
      const notFound = /function .* does not exist|could not find the function/i.test(msg);
      if (!notFound) {
        // For permission errors etc, stop early because it's real
        break;
      }
    }
  }
  throw lastErr || new Error("RPC failed");
}

function extractUuid(x) {
  if (!x) return null;
  if (typeof x === "string") return x;
  if (Array.isArray(x) && x.length) return extractUuid(x[0]);
  if (typeof x === "object") {
    return x.id || x.change_request_id || x.order_id || null;
  }
  return null;
}

async function loadCurrentUser() {
  const { data } = await supabase.auth.getUser();
  currentUserId = data?.user?.id || null;

  // 1) Prefer is_manager() RPC (recommended)
  try {
    const r = await supabase.rpc("is_manager");
    if (!r.error && typeof r.data === "boolean") {
      isManager = r.data;
      return;
    }
  } catch (_) {}

  // 2) Fallback: check profiles.base_role
  try {
    const q = await supabase.from("profiles").select("base_role,is_active").eq("user_id", currentUserId).maybeSingle();
    if (!q.error && q.data) {
      isManager = (q.data.is_active !== false) && (q.data.base_role === "manager");
    }
  } catch (_) {}
}

/* ====== Masters ====== */
async function refreshMasters() {
  const [sup, fac, yt, yb] = await Promise.all([
    supabase.from(T.suppliers).select("id,name,is_active").order("name"),
    supabase.from(T.factories).select("id,name,is_active").order("name"),
    supabase.from(T.yarnTypes).select("id,name,is_active").order("name"),
    supabase.from(T.yarnBrands).select("id,name,yarn_type_id,is_active").order("name"),
  ]);

  if (sup.error) throw sup.error;
  if (fac.error) throw fac.error;
  if (yt.error) throw yt.error;
  if (yb.error) throw yb.error;

  idToName.suppliers = new Map((sup.data||[]).map(x => [x.id, x.name]));
  idToName.factories = new Map((fac.data||[]).map(x => [x.id, x.name]));
  idToName.yarnTypes = new Map((yt.data||[]).map(x => [x.id, x.name]));
  idToName.yarnBrands = new Map((yb.data||[]).map(x => [x.id, x.name]));
  idToName.yarnBrandToType = new Map((yb.data||[]).map(x => [x.id, x.yarn_type_id]));

  // Populate edit selects
  fillSelect(edit_supplierId, sup.data || []);
  fillSelect(edit_factoryId, fac.data || []);
}

function fillSelect(sel, list) {
  sel.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "— اختر —";
  sel.appendChild(opt0);

  for (const r of (list || []).filter(x => x.is_active !== false)) {
    const opt = document.createElement("option");
    opt.value = r.id;
    opt.textContent = r.name;
    sel.appendChild(opt);
  }
}

/* ====== Fetch & Render ====== */
async function refreshRows() {
  const q = await supabase.from(T.viewItems).select("*").order("supplier_note_date", { ascending: false }).limit(5000);
  if (q.error) throw q.error;
  rows = q.data || [];
}

function rowMatches(r, q, src, st) {
  if (src && r.source !== src) return false;
  if (st && r.status !== st) return false;

  if (!q) return true;
  q = normalizeDigits(q).toLowerCase();

  const supplierName = (idToName.suppliers.get(r.supplier_id) || "").toLowerCase();
  const factoryName = (idToName.factories.get(r.factory_id) || "").toLowerCase();
  const typeName = (idToName.yarnTypes.get(r.yarn_type_id) || "").toLowerCase();
  const brandName = (idToName.yarnBrands.get(r.yarn_brand_id) || "").toLowerCase();
  const noteNo = normalizeDigits(r.supplier_note_no || "").toLowerCase();
  const lot = normalizeDigits(r.lot_no || "").toLowerCase();

  return (
    supplierName.includes(q) ||
    factoryName.includes(q) ||
    typeName.includes(q) ||
    brandName.includes(q) ||
    noteNo.includes(q) ||
    lot.includes(q)
  );
}

function buildStatusBadge(status) {
  const el = document.createElement("span");
  el.className = "badge";
  el.textContent = status || "—";

  // Very light styling based on text
  if ((status||"").includes("قيد")) el.classList.add("warn");
  if ((status||"").includes("حذف")) el.classList.add("danger");
  if ((status||"").includes("تأكيده")) el.classList.add("ok");
  return el;
}

function buildImageBtn(r) {
  const btn = document.createElement("button");
  btn.className = "btn small";
  btn.textContent = "صورة";
  btn.addEventListener("click", () => openImageFromRow(r));
  return btn;
}

function buildActionsStack(r) {
  const box = document.createElement("div");
  box.className = "actions-stack";

  const btnPrev = document.createElement("button");
  btnPrev.className = "btn small primary";
  btnPrev.textContent = "معاينة";
  btnPrev.addEventListener("click", () => openPreview(r));
  box.appendChild(btnPrev);

  const btnEdit = document.createElement("button");
  btnEdit.className = "btn small";
  btnEdit.textContent = "تعديل";
  btnEdit.addEventListener("click", () => openEdit(r));
  box.appendChild(btnEdit);

  const btnDel = document.createElement("button");
  btnDel.className = "btn small danger";
  btnDel.textContent = "حذف";
  btnDel.addEventListener("click", () => openDelete(r));
  box.appendChild(btnDel);

  return box;
}

function render() {
  const q = search.value.trim();
  const src = sourceFilter.value;
  const st = statusFilter.value;

  const filtered = rows.filter(r => rowMatches(r, q, src, st));

  tbody.innerHTML = "";
  for (const r of filtered) {
    const tr = document.createElement("tr");

    const supplierName = idToName.suppliers.get(r.supplier_id) || r.supplier_id || "—";
    const factoryName = idToName.factories.get(r.factory_id) || r.factory_id || "—";
    const typeName = idToName.yarnTypes.get(r.yarn_type_id) || r.yarn_type_id || "—";
    const brandName = r.yarn_brand_id ? (idToName.yarnBrands.get(r.yarn_brand_id) || r.yarn_brand_id) : "—";

    tr.innerHTML = `
      <td>${r.supplier_note_date || "—"}</td>
      <td>${normalizeDigits(r.supplier_note_no || "") || "—"}</td>
      <td>${supplierName}</td>
      <td>${factoryName}</td>

      <td>${typeName}</td>
      <td>${brandName}</td>
      <td>${normalizeDigits(r.lot_no || "") || "—"}</td>
      <td>${fmt3(Number(r.qty))}</td>
      <td>${r.price == null ? "—" : fmt3(Number(r.price))}</td>
      <td>${r.line_total == null ? "—" : fmt3(Number(r.line_total))}</td>

      <td></td>
      <td></td>
      <td></td>
    `;

    tr.children[10].appendChild(buildStatusBadge(r.status));
    tr.children[11].appendChild(buildImageBtn(r));
    tr.children[12].appendChild(buildActionsStack(r));

    tbody.appendChild(tr);
  }

  countBox.textContent = `عدد الصفوف: ${filtered.length} (من أصل ${rows.length})`;
}

/* ====== Preview ====== */
async function fetchAllItemsForReceipt(r) {
  if (r.order_id) {
    const q = await supabase.from(T.viewItems).select("*").eq("order_id", r.order_id).order("created_at", { ascending: true });
    if (q.error) throw q.error;
    return q.data || [];
  }
  if (r.change_request_id) {
    const q = await supabase.from(T.viewItems).select("*").eq("change_request_id", r.change_request_id).order("created_at", { ascending: true });
    if (q.error) throw q.error;
    return q.data || [];
  }
  return [];
}

function computeGrand(items) {
  let sum = 0;
  for (const it of items) sum += Number(it.line_total || 0);
  return sum;
}

async function openPreview(r) {
  currentPreview = r;
  previewMsg.textContent = "";
  previewNoImg.style.display = "none";

  previewTitle.textContent = `معاينة الطلب`;
  previewStatus.textContent = r.status || "—";
  previewSource.textContent = r.source || "—";
  previewNo.textContent = normalizeDigits(r.supplier_note_no || "") || "—";
  previewDate.textContent = r.supplier_note_date || "—";
  previewSupplier.textContent = idToName.suppliers.get(r.supplier_id) || r.supplier_id || "—";
  previewFactory.textContent = idToName.factories.get(r.factory_id) || r.factory_id || "—";

  // Buttons visibility
  const isPending = (r.source === "pending") && !!r.change_request_id;
  btnApprove.style.display = (isManager && isPending) ? "inline-flex" : "none";
  btnReject.style.display = (isManager && isPending) ? "inline-flex" : "none";

  // Image button
  btnOpenImage.disabled = !r.receipt_image_path;
  previewNoImg.style.display = r.receipt_image_path ? "none" : "inline";

  previewItems.innerHTML = `<tr><td colspan="7" class="muted">جارٍ التحميل...</td></tr>`;

  openModal(modalPreview);

  try {
    const items = await fetchAllItemsForReceipt(r);
    previewItems.innerHTML = "";

    items.forEach((it, idx) => {
      const tr = document.createElement("tr");
      const typeName = idToName.yarnTypes.get(it.yarn_type_id) || it.yarn_type_id || "—";
      const brandName = it.yarn_brand_id ? (idToName.yarnBrands.get(it.yarn_brand_id) || it.yarn_brand_id) : "—";
      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td>${typeName}</td>
        <td>${brandName}</td>
        <td>${normalizeDigits(it.lot_no || "") || "—"}</td>
        <td>${fmt3(Number(it.qty))}</td>
        <td>${it.price == null ? "—" : fmt3(Number(it.price))}</td>
        <td>${it.line_total == null ? "—" : fmt3(Number(it.line_total))}</td>
      `;
      previewItems.appendChild(tr);
    });

    previewGrand.textContent = fmt3(computeGrand(items));
  } catch (e) {
    previewItems.innerHTML = `<tr><td colspan="7" class="muted">تعذر تحميل البنود.</td></tr>`;
    previewMsg.textContent = "خطأ: " + (e?.message || e);
  }
}

btnOpenImage?.addEventListener("click", () => {
  if (!currentPreview) return;
  openImageFromRow(currentPreview);
});

async function signedReceiptUrl(path) {
  if (!path) return null;
  const signed = await supabase.storage.from(RECEIPT_BUCKET).createSignedUrl(path, 60 * 15);
  if (signed.error) throw signed.error;
  return signed.data?.signedUrl || null;
}

async function openImageFromRow(r) {
  imgReceipt.src = "";
  imgReceipt.style.display = "none";
  imgNoReceipt.style.display = "none";

  openModal(modalImage);

  if (!r?.receipt_image_path) {
    imgNoReceipt.style.display = "block";
    return;
  }

  try {
    const url = await signedReceiptUrl(r.receipt_image_path);
    if (!url) {
      imgNoReceipt.style.display = "block";
      return;
    }
    imgReceipt.src = url;
    imgReceipt.style.display = "block";
  } catch (e) {
    imgNoReceipt.textContent = "تعذر تحميل الصورة.";
    imgNoReceipt.style.display = "block";
  }
}

/* ====== Approve / Reject ====== */
async function approveChangeRequest(changeRequestId) {
  const args = [
    { p_id: changeRequestId },
    { id: changeRequestId },
    { p_change_request_id: changeRequestId },
    { change_request_id: changeRequestId },
  ];
  const r = await callAnyRpc(RPC_APPROVE_CANDIDATES, args);
  return r.data;
}

async function rejectChangeRequest(changeRequestId) {
  const args = [
    { p_id: changeRequestId },
    { id: changeRequestId },
    { p_change_request_id: changeRequestId },
    { change_request_id: changeRequestId },
  ];
  const r = await callAnyRpc(RPC_REJECT_CANDIDATES, args);
  return r.data;
}

btnApprove?.addEventListener("click", async () => {
  if (!currentPreview?.change_request_id) return;
  btnApprove.disabled = true;
  btnReject.disabled = true;
  previewMsg.textContent = "جارٍ الاعتماد...";
  try {
    await approveChangeRequest(currentPreview.change_request_id);
    previewMsg.textContent = "تم الاعتماد.";
    await refreshAll();
    closeModal(modalPreview);
  } catch (e) {
    previewMsg.textContent = "فشل الاعتماد: " + (e?.message || e);
  } finally {
    btnApprove.disabled = false;
    btnReject.disabled = false;
  }
});

btnReject?.addEventListener("click", async () => {
  if (!currentPreview?.change_request_id) return;
  btnApprove.disabled = true;
  btnReject.disabled = true;
  previewMsg.textContent = "جارٍ الرفض...";
  try {
    await rejectChangeRequest(currentPreview.change_request_id);
    previewMsg.textContent = "تم الرفض.";
    await refreshAll();
    closeModal(modalPreview);
  } catch (e) {
    previewMsg.textContent = "فشل الرفض: " + (e?.message || e);
  } finally {
    btnApprove.disabled = false;
    btnReject.disabled = false;
  }
});

/* ====== Edit ====== */
function clearEditMsg() {
  editMsg.style.display = "none";
  editMsg.textContent = "";
  editMsg.className = "status";
}

function renderEditItems(items) {
  edit_itemsBody.innerHTML = "";
  items.forEach((it, idx) => {
    const tr = document.createElement("tr");
    tr.dataset.idx = String(idx);

    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td><select class="select" data-field="yarn_type_id"></select></td>
      <td><select class="select" data-field="yarn_brand_id"></select></td>
      <td><input class="input" data-field="lot_no" type="text" placeholder="اختياري" /></td>
      <td><input class="input" data-field="qty" type="number" step="0.001" min="0" /></td>
      <td><input class="input" data-field="price" type="number" step="0.001" min="0" placeholder="اختياري" /></td>
      <td><strong data-field="line_total">0.000</strong></td>
      <td><button class="btn small danger" type="button" data-remove>×</button></td>
    `;

    const selType = tr.querySelector('select[data-field="yarn_type_id"]');
    const selBrand = tr.querySelector('select[data-field="yarn_brand_id"]');
    const inpLot = tr.querySelector('input[data-field="lot_no"]');
    const inpQty = tr.querySelector('input[data-field="qty"]');
    const inpPrice = tr.querySelector('input[data-field="price"]');
    const cellTotal = tr.querySelector('strong[data-field="line_total"]');

    // Fill yarn types
    selType.innerHTML = `<option value="">— اختر —</option>`;
    for (const [id, name] of idToName.yarnTypes.entries()) {
      selType.insertAdjacentHTML("beforeend", `<option value="${id}">${name}</option>`);
    }

    function fillBrands(typeId, selectedBrandId) {
      selBrand.innerHTML = `<option value="">— اختر —</option>`;
      for (const [bid, bname] of idToName.yarnBrands.entries()) {
        const bt = idToName.yarnBrandToType.get(bid);
        if (typeId && bt !== typeId) continue;
        selBrand.insertAdjacentHTML("beforeend", `<option value="${bid}">${bname}</option>`);
      }
      if (selectedBrandId) selBrand.value = selectedBrandId;
    }

    selType.value = it.yarn_type_id || "";
    fillBrands(selType.value, it.yarn_brand_id || "");

    selType.addEventListener("change", () => {
      fillBrands(selType.value, "");
    });

    inpLot.value = normalizeDigits(it.lot_no || "");
    inpQty.value = it.qty == null ? "" : normalizeDigits(String(it.qty));
    inpPrice.value = it.price == null ? "" : normalizeDigits(String(it.price));

    function recalc() {
      const q = Number(normalizeDigits(inpQty.value) || 0);
      const p = Number(normalizeDigits(inpPrice.value) || 0);
      const total = (q && p) ? (q * p) : 0;
      cellTotal.textContent = fmt3(total);
      recalcEditGrand();
    }
    inpQty.addEventListener("input", recalc);
    inpPrice.addEventListener("input", recalc);
    recalc();

    tr.querySelector("[data-remove]").addEventListener("click", () => {
      tr.remove();
      renumberEditItems();
      recalcEditGrand();
    });

    edit_itemsBody.appendChild(tr);
  });

  recalcEditGrand();
}

function renumberEditItems() {
  [...edit_itemsBody.querySelectorAll("tr")].forEach((tr, i) => {
    tr.children[0].textContent = String(i + 1);
  });
}

function recalcEditGrand() {
  let sum = 0;
  for (const tr of edit_itemsBody.querySelectorAll("tr")) {
    const qty = Number(normalizeDigits(tr.querySelector('input[data-field="qty"]').value) || 0);
    const price = Number(normalizeDigits(tr.querySelector('input[data-field="price"]').value) || 0);
    sum += (qty && price) ? qty * price : 0;
  }
  edit_grandTotal.textContent = fmt3(sum);
}

btnEditAddItem?.addEventListener("click", () => {
  const items = collectEditItems();
  items.push({ yarn_type_id: "", yarn_brand_id: "", lot_no: "", qty: 0, price: null });
  renderEditItems(items);
});

function collectEditItems() {
  const items = [];
  for (const tr of edit_itemsBody.querySelectorAll("tr")) {
    const typeId = tr.querySelector('select[data-field="yarn_type_id"]').value || null;
    const brandId = tr.querySelector('select[data-field="yarn_brand_id"]').value || null;
    const lot = normalizeDigits(tr.querySelector('input[data-field="lot_no"]').value || "") || null;
    const qty = Number(normalizeDigits(tr.querySelector('input[data-field="qty"]').value) || 0);
    const priceRaw = normalizeDigits(tr.querySelector('input[data-field="price"]').value || "");
    const price = priceRaw === "" ? null : Number(priceRaw);

    items.push({
      yarn_type_id: typeId,
      yarn_brand_id: brandId,
      lot_no: lot,
      qty: qty,
      price: price,
    });
  }
  return items;
}

async function openEdit(r) {
  clearEditMsg();
  currentEditOrderId = r.order_id;
  edit_note.value = "";

  if (!currentEditOrderId) {
    showInlineMsg(editMsg, "لا يمكن التعديل: order_id غير متاح في هذا الصف.", "err");
    openModal(modalEdit);
    return;
  }

  openModal(modalEdit);
  showInlineMsg(editMsg, "جارٍ تحميل بيانات الطلب...", "ok");

  try {
    const [qo, qi] = await Promise.all([
      supabase.from(T.orders).select("*").eq("id", currentEditOrderId).single(),
      supabase.from(T.items).select("*").eq("order_id", currentEditOrderId).order("created_at", { ascending: true }),
    ]);
    if (qo.error) throw qo.error;
    if (qi.error) throw qi.error;

    const o = qo.data;
    const items = qi.data || [];

    edit_supplierId.value = o.supplier_id || "";
    edit_factoryId.value = o.factory_id || "";
    edit_supplierNoteDate.value = o.supplier_note_date || "";
    edit_supplierNoteNo.value = normalizeDigits(o.supplier_note_no || "");

    renderEditItems(items);

    clearEditMsg();
  } catch (e) {
    showInlineMsg(editMsg, "تعذر تحميل بيانات الطلب: " + (e?.message || e), "err");
  }
}

async function submitEdit(orderId, payload, note) {
  const args = [
    { p_order_id: orderId, p_data: payload, p_note: note },
    { order_id: orderId, p_data: payload, p_note: note },
    { p_id: orderId, p_data: payload, p_note: note },
    { p_order_id: orderId, p_after: payload, p_note: note },
    { order_id: orderId, p_after: payload, p_note: note },
    { p_id: orderId, p_after: payload, p_note: note },
  ];
  const r = await callAnyRpc(RPC_EDIT_CANDIDATES, args);
  return extractUuid(r.data);
}

btnEditSubmit?.addEventListener("click", async () => {
  clearEditMsg();

  if (!currentEditOrderId) {
    showInlineMsg(editMsg, "order_id غير موجود.", "err");
    return;
  }

  const supplier_id = edit_supplierId.value;
  const factory_id = edit_factoryId.value;
  const supplier_note_date = edit_supplierNoteDate.value;
  const supplier_note_no = normalizeDigits(edit_supplierNoteNo.value || "");
  const note = edit_note.value.trim();

  if (!supplier_id || !factory_id || !supplier_note_date) {
    showInlineMsg(editMsg, "الرجاء اختيار المورد + المصنع + التاريخ.", "err");
    return;
  }

  const items = collectEditItems().filter(it => it.yarn_type_id && it.qty > 0);
  if (!items.length) {
    showInlineMsg(editMsg, "أضف بند واحد على الأقل (نوع + كمية).", "err");
    return;
  }

  // keep receipt image path unchanged (server will keep existing)
  const payload = {
    supplier_id,
    factory_id,
    supplier_note_no,
    supplier_note_date,
    receipt_image_path: null,
    items: items.map(it => ({
      yarn_type_id: it.yarn_type_id,
      yarn_brand_id: it.yarn_brand_id,
      lot_no: it.lot_no,
      qty: it.qty,
      price: it.price,
    })),
  };

  btnEditSubmit.disabled = true;
  showInlineMsg(editMsg, "جارٍ إرسال التعديل...", "ok");

  try {
    const crId = await submitEdit(currentEditOrderId, payload, note || "تعديل");
    if (!crId) {
      showInlineMsg(editMsg, "تم الإرسال، لكن لم يتم استلام رقم الطلب (Change Request).", "ok");
    } else {
      if (isManager) {
        try {
          await approveChangeRequest(crId);
          showInlineMsg(editMsg, "تم حفظ التعديل واعتماده مباشرة (مدير).", "ok");
        } catch (e2) {
          showInlineMsg(editMsg, "تم إرسال التعديل. (تعذر الاعتماد التلقائي): " + (e2?.message || e2), "err");
        }
      } else {
        showInlineMsg(editMsg, "تم إرسال التعديل للمراجعة. رقم الطلب: " + crId, "ok");
      }
    }

    await refreshAll();
    closeModal(modalEdit);
  } catch (e) {
    showInlineMsg(editMsg, "فشل إرسال التعديل: " + (e?.message || e), "err");
  } finally {
    btnEditSubmit.disabled = false;
  }
});

/* ====== Delete ====== */
function openDelete(r) {
  deleteMsg.style.display = "none";
  deleteMsg.textContent = "";
  deleteMsg.className = "status";

  currentDeleteOrderId = r.order_id || null;
  if (!currentDeleteOrderId) {
    showInlineMsg(deleteMsg, "لا يمكن الحذف: order_id غير متاح في هذا الصف.", "err");
  }
  openModal(modalDelete);
}

async function submitDelete(orderId, note) {
  const args = [
    { p_order_id: orderId, p_note: note },
    { order_id: orderId, p_note: note },
    { p_id: orderId, p_note: note },
  ];
  const r = await callAnyRpc(RPC_DELETE_CANDIDATES, args);
  return extractUuid(r.data);
}

btnDeleteConfirm?.addEventListener("click", async () => {
  if (!currentDeleteOrderId) return;

  btnDeleteConfirm.disabled = true;
  showInlineMsg(deleteMsg, "جارٍ تنفيذ الحذف...", "ok");

  try {
    const crId = await submitDelete(currentDeleteOrderId, "حذف");
    if (isManager && crId) {
      try {
        await approveChangeRequest(crId);
        showInlineMsg(deleteMsg, "تم الحذف نهائيًا (مدير).", "ok");
      } catch (e2) {
        showInlineMsg(deleteMsg, "تم إرسال طلب الحذف، لكن فشل الاعتماد التلقائي: " + (e2?.message || e2), "err");
      }
    } else {
      showInlineMsg(deleteMsg, "تم إرسال طلب حذف للمراجعة. رقم الطلب: " + (crId || "—"), "ok");
    }

    await refreshAll();
    closeModal(modalDelete);
  } catch (e) {
    showInlineMsg(deleteMsg, "فشل الحذف: " + (e?.message || e), "err");
  } finally {
    btnDeleteConfirm.disabled = false;
  }
});

/* ====== Events ====== */
[search, sourceFilter, statusFilter].forEach(el => el?.addEventListener("input", render));
btnRefresh?.addEventListener("click", refreshAll);

/* ====== Init ====== */
async function refreshAll() {
  await refreshMasters();
  await refreshRows();
  render();
}

(async function init() {
  await requireSession();
  await loadCurrentUser();
  try {
    await refreshAll();
  } catch (e) {
    countBox.textContent = "تعذر تحميل البيانات: " + (e?.message || e);
  }
})();
