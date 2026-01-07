/* =========================
   جدول مشتريات الخيط (Item-level)
========================= */

import { supabase } from "../shared/supabaseClient.js";

/* ====== Config ====== */
const LOGIN_URL = "../index.html";

const T = {
  suppliers: "suppliers",
  factories: "factories",
  yarnTypes: "yarn_types",
  yarnBrands: "yarn_brands",
  viewItems: "v_yarn_purchase_items_table", // View يجب أن يحتوي على: source,status,supplier_note_date,supplier_note_no,...,order_id,change_request_id
};

// أسماء محتملة لاعتماد الطلب
const RPC_APPROVE_CANDIDATES = [
  "approve_change_request",
  "approve_yarn_purchase_request",
  "approve_yarn_purchase_change_request",
  "confirm_change_request",
];

/* ====== Helpers ====== */
const $ = (sel, root = document) => root.querySelector(sel);

function openModal(m) { m.classList.add("open"); m.setAttribute("aria-hidden", "false"); }
function closeModal(m) { m.classList.remove("open"); m.setAttribute("aria-hidden", "true"); }

document.addEventListener("click", (e) => {
  const closeBtn = e.target.closest("[data-close]");
  if (closeBtn) {
    const modal = e.target.closest(".modal");
    if (modal) closeModal(modal);
  }
  if (e.target.classList.contains("modal")) closeModal(e.target);
});

function normalizeDigits(str) {
  if (str == null) return "";
  const map = {
    "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
    "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
    "٫": ".", "،": ".", ",": "."
  };
  return String(str).replace(/[٠-٩۰-۹٫،,]/g, ch => map[ch] ?? ch).trim();
}

function fmt3(n) {
  if (n == null || !Number.isFinite(Number(n))) return "";
  const x = Number(n);
  return (Math.round(x * 1000) / 1000).toFixed(3);
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
      // continue trying other arg variants and other fn names
      // ignore "function does not exist" and "argument" mismatch
    }
  }
  return { error: lastErr || new Error("RPC failed") };
}

/* ====== State ====== */
let rows = [];
let masters = { suppliers: [], factories: [], yarnTypes: [], yarnBrands: [] };
let idToName = {
  suppliers: new Map(),
  factories: new Map(),
  yarnTypes: new Map(),
  yarnBrands: new Map(),
};

let currentPreview = null;

/* ====== Elements ====== */
const tbody = $("#tbody");
const search = $("#search");
const sourceFilter = $("#sourceFilter");
const statusFilter = $("#statusFilter");
const countBox = $("#countBox");
const btnRefresh = $("#btnRefresh");

/* modal */
const modalPreview = $("#modalPreview");
const previewTitle = $("#previewTitle");
const previewStatus = $("#previewStatus");
const previewSource = $("#previewSource");
const previewNo = $("#previewNo");
const previewDate = $("#previewDate");
const previewSupplier = $("#previewSupplier");
const previewFactory = $("#previewFactory");
const previewItems = $("#previewItems");
const previewGrand = $("#previewGrand");
const previewImg = $("#previewImg");
const previewNoImg = $("#previewNoImg");
const previewMsg = $("#previewMsg");
const btnApprove = $("#btnApprove");

/* ====== Load masters ====== */
async function loadMasters() {
  const [sup, fac, yt, yb] = await Promise.all([
    supabase.from(T.suppliers).select("id,name").order("name"),
    supabase.from(T.factories).select("id,name").order("name"),
    supabase.from(T.yarnTypes).select("id,name").order("name"),
    supabase.from(T.yarnBrands).select("id,name,yarn_type_id").order("name"),
  ]);

  if (sup.error) throw sup.error;
  if (fac.error) throw fac.error;
  if (yt.error) throw yt.error;
  if (yb.error) throw yb.error;

  masters.suppliers = sup.data || [];
  masters.factories = fac.data || [];
  masters.yarnTypes = yt.data || [];
  masters.yarnBrands = yb.data || [];

  idToName.suppliers = new Map(masters.suppliers.map(x => [x.id, x.name]));
  idToName.factories = new Map(masters.factories.map(x => [x.id, x.name]));
  idToName.yarnTypes = new Map(masters.yarnTypes.map(x => [x.id, x.name]));
  idToName.yarnBrands = new Map(masters.yarnBrands.map(x => [x.id, x.name]));
}

/* ====== Load rows ====== */
async function loadRows() {
  const q = await supabase.from(T.viewItems).select("*").order("supplier_note_date", { ascending: false }).limit(5000);
  if (q.error) throw q.error;
  rows = q.data || [];
  refreshStatusFilterOptions();
}

function refreshStatusFilterOptions() {
  const set = new Set(rows.map(r => r.status).filter(Boolean));
  const prev = statusFilter.value;
  statusFilter.innerHTML = `<option value="">كل الحالات</option>`;
  [...set].sort((a, b) => String(a).localeCompare(String(b), "ar")).forEach(s => {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    statusFilter.appendChild(opt);
  });
  if ([...statusFilter.options].some(o => o.value === prev)) statusFilter.value = prev;
}

function rowMatches(r, q, src, st) {
  if (src && r.source !== src) return false;
  if (st && r.status !== st) return false;

  if (!q) return true;
  const hay = [
    r.supplier_note_no,
    r.supplier_note_date,
    idToName.suppliers.get(r.supplier_id),
    idToName.factories.get(r.factory_id),
    idToName.yarnTypes.get(r.yarn_type_id),
    idToName.yarnBrands.get(r.yarn_brand_id),
    r.lot_no,
    r.status,
  ].filter(Boolean).join(" ").toLowerCase();

  return hay.includes(q.toLowerCase());
}

function buildStatusBadge(status) {
  const span = document.createElement("span");
  span.className = "badge";
  span.textContent = status || "—";
  return span;
}

function buildImageBtn(r) {
  const btn = document.createElement("button");
  btn.className = "btn small";
  btn.textContent = "عرض";
  btn.addEventListener("click", () => openPreview(r));
  return btn;
}

function buildActionsBtn(r) {
  const btn = document.createElement("button");
  btn.className = "btn small primary";
  btn.textContent = "معاينة";
  btn.addEventListener("click", () => openPreview(r));
  return btn;
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
      <td>${fmt3(r.qty)}</td>
      <td>${r.price == null ? "—" : fmt3(r.price)}</td>
      <td>${r.line_total == null ? "—" : fmt3(r.line_total)}</td>

      <td></td>
      <td></td>
      <td></td>
    `;

    tr.children[10].appendChild(buildStatusBadge(r.status));
    tr.children[11].appendChild(buildImageBtn(r));
    tr.children[12].appendChild(buildActionsBtn(r));

    tbody.appendChild(tr);
  }

  countBox.textContent = `عدد الصفوف: ${filtered.length} (من أصل ${rows.length})`;
}

/* ====== Preview ====== */
async function fetchAllItemsForReceipt(r) {
  // When item-level, we fetch all items sharing same order_id OR change_request_id
  if (r.order_id) {
    const q = await supabase.from(T.viewItems).select("*").eq("order_id", r.order_id).order("supplier_note_date", { ascending: false });
    if (q.error) throw q.error;
    return q.data || [];
  }
  if (r.change_request_id) {
    const q = await supabase.from(T.viewItems).select("*").eq("change_request_id", r.change_request_id).order("supplier_note_date", { ascending: false });
    if (q.error) throw q.error;
    return q.data || [];
  }
  return [r];
}

async function tryLoadReceiptImage(r) {
  // This will work only if your view contains receipt_image_path.
  // If not available, it will show "غير متاح" in UI.
  const path = r.receipt_image_path || null;
  if (!path) return null;

  // Try signed URL (works even if bucket is private)
  const signed = await supabase.storage.from("receipts").createSignedUrl(path, 60 * 15);
  if (signed.error) throw signed.error;
  return signed.data?.signedUrl || null;
}

async function openPreview(r) {
  currentPreview = r;
  previewMsg.textContent = "";
  previewNoImg.style.display = "block";
  previewImg.style.display = "none";
  previewImg.removeAttribute("src");

  const supplierName = idToName.suppliers.get(r.supplier_id) || r.supplier_id || "—";
  const factoryName = idToName.factories.get(r.factory_id) || r.factory_id || "—";

  previewTitle.textContent = "معاينة الأذن";
  previewStatus.textContent = r.status || "—";
  previewSource.textContent = r.source || "—";
  previewNo.textContent = normalizeDigits(r.supplier_note_no || "") || "—";
  previewDate.textContent = r.supplier_note_date || "—";
  previewSupplier.textContent = supplierName;
  previewFactory.textContent = factoryName;

  btnApprove.style.display = (r.source === "pending" && r.change_request_id) ? "inline-flex" : "none";

  openModal(modalPreview);

  try {
    const items = await fetchAllItemsForReceipt(r);

    previewItems.innerHTML = "";
    let grand = 0;

    items.forEach((it, idx) => {
      const typeName = idToName.yarnTypes.get(it.yarn_type_id) || it.yarn_type_id || "—";
      const brandName = it.yarn_brand_id ? (idToName.yarnBrands.get(it.yarn_brand_id) || it.yarn_brand_id) : "—";
      const lt = it.line_total == null ? null : Number(it.line_total);
      if (lt != null && Number.isFinite(lt)) grand += lt;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td>${typeName}</td>
        <td>${brandName}</td>
        <td>${normalizeDigits(it.lot_no || "") || "—"}</td>
        <td>${fmt3(it.qty)}</td>
        <td>${it.price == null ? "—" : fmt3(it.price)}</td>
        <td>${it.line_total == null ? "—" : fmt3(it.line_total)}</td>
      `;
      previewItems.appendChild(tr);
    });

    previewGrand.textContent = fmt3(grand || 0);

    // Image (if exists)
    const url = await tryLoadReceiptImage(r);
    if (url) {
      previewNoImg.style.display = "none";
      previewImg.style.display = "block";
      previewImg.src = url;
    } else {
      previewNoImg.style.display = "block";
      previewImg.style.display = "none";
    }
  } catch (e) {
    previewMsg.textContent = "تعذر تحميل تفاصيل المعاينة: " + (e?.message || e);
  }
}

/* ====== Approve ====== */
btnApprove.addEventListener("click", async () => {
  if (!currentPreview?.change_request_id) return;

  btnApprove.disabled = true;
  previewMsg.textContent = "جاري الاعتماد...";

  try {
    const id = currentPreview.change_request_id;

    const res = await callAnyRpc(RPC_APPROVE_CANDIDATES, [
      { change_request_id: id },
      { p_change_request_id: id },
      { id },
      { p_id: id },
    ]);

    if (res?.error) {
      previewMsg.textContent = "فشل الاعتماد: " + res.error.message;
      btnApprove.disabled = false;
      return;
    }

    previewMsg.textContent = "تم الاعتماد بنجاح.";
    await refreshAll();
  } catch (e) {
    previewMsg.textContent = "خطأ: " + (e?.message || e);
  } finally {
    btnApprove.disabled = false;
  }
});

/* ====== Refresh ====== */
async function refreshAll() {
  await loadMasters();
  await loadRows();
  render();
}

btnRefresh.addEventListener("click", refreshAll);

[search, sourceFilter, statusFilter].forEach(el => el.addEventListener("input", render));
[sourceFilter, statusFilter].forEach(el => el.addEventListener("change", render));

/* ====== Init ====== */
(async function init() {
  await requireSession();
  try {
    await refreshAll();
  } catch (e) {
    countBox.textContent = "تعذر تحميل البيانات: " + (e?.message || e);
  }
})();
