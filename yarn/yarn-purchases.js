/* =========================
   مشتريات الخيط (DB + Review)
   - Entry page (Item-level receipt)
========================= */

import { supabase } from "../shared/supabaseClient.js";

/* ====== Config (عدلها إذا لزم) ====== */
const LOGIN_URL = "../index.html";           // صفحة تسجيل الدخول (إذا لا يوجد Session)
const RECEIPT_BUCKET = "receipts";           // Supabase Storage bucket
const RECEIPT_PREFIX = "yarn-receipts";      // prefix داخل البكت

// أسماء الجداول (في حال اختلفت عندك عدلها)
const T = {
  suppliers: "suppliers",
  factories: "factories",
  yarnTypes: "yarn_types",
  yarnBrands: "yarn_brands",
};

// أسماء الـ RPC (نحاول أكثر من اسم لتقليل الأخطاء)
const RPC_CREATE_CANDIDATES = ["submit_yarn_purchase_request"];
const RPC_APPROVE_CANDIDATES = [
  "confirm_change_request",
  "approve_change_request",
];


/* ====== Helpers ====== */
const $ = (sel, root = document) => root.querySelector(sel);

function showStatus(msg, type = "ok") {
  const box = $("#statusBox");
  box.textContent = msg;
  box.className = "status " + (type === "err" ? "err" : "ok");
  box.style.display = "block";
}

function clearStatus() {
  const box = $("#statusBox");
  box.style.display = "none";
  box.textContent = "";
}

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

/** تحويل الأرقام الهندية/الفارسية إلى 0-9 + توحيد الفاصلة العشرية */
function normalizeDigits(str) {
  if (str == null) return "";
  const map = {
    "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
    "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
    "٫": ".", "،": ".", ",": "."
  };
  return String(str).replace(/[٠-٩۰-۹٫،,]/g, ch => map[ch] ?? ch).trim();
}

function toNumberSafe(str) {
  const v = normalizeDigits(str);
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function fmt3(n) {
  if (n == null || !Number.isFinite(n)) return "";
  return (Math.round(n * 1000) / 1000).toFixed(3);
}

function option(sel, value, label) {
  const opt = document.createElement("option");
  opt.value = value;
  opt.textContent = label;
  sel.appendChild(opt);
}

async function requireSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    showStatus("خطأ في التحقق من الجلسة: " + error.message, "err");
    return null;
  }
  if (!data?.session) {
    window.location.href = LOGIN_URL;
    return null;
  }
  return data.session;
}

/* ====== State ====== */
let masters = {
  suppliers: [],
  factories: [],
  yarnTypes: [],
  yarnBrands: [], // {id,name,yarn_type_id}
};
let maps = {
  supplierByName: new Map(),
  factoryByName: new Map(),
  yarnTypeByName: new Map(),
  yarnBrandByKey: new Map(), // key=typeId|brandName
};

let currentImage = { file: null, previewUrl: null };

/* ====== Elements ====== */
const elSupplierId = $("#supplierId");
const elSupplierNoteNo = $("#supplierNoteNo");
const elSupplierNoteDate = $("#supplierNoteDate");
const elFactoryId = $("#factoryId");

const elItemsWrap = $("#itemsWrap");
const elItemTpl = $("#itemTpl");
const elGrandTotal = $("#grandTotal");

const btnNew = $("#btnNew");
const btnSubmit = $("#btnSubmit");
const btnAddItem = $("#btnAddItem");

const btnPickImage = $("#btnPickImage");
const btnRemoveImage = $("#btnRemoveImage");
const fileInput = $("#fileInput");
const imgEl = $("#receiptImage");
const imgPlaceholder = $("#imagePlaceholder");

const btnImport = $("#btnImport");
const modalImport = $("#modalImport");
const importText = $("#importText");
const importProgress = $("#importProgress");
const btnRunImport = $("#btnRunImport");

/* add master modals */
const modalSupplier = $("#modalSupplier");
const modalFactory = $("#modalFactory");
const modalYarnType = $("#modalYarnType");
const modalYarnBrand = $("#modalYarnBrand");

let pendingBrandAddForItemEl = null;

/* ====== Load masters ====== */
async function loadMasters() {
  const [sup, fac, yt, yb] = await Promise.all([
    supabase.from(T.suppliers).select("id,name").eq("is_active", true).order("name"),
    supabase.from(T.factories).select("id,name").eq("is_active", true).order("name"),
    supabase.from(T.yarnTypes).select("id,name").eq("is_active", true).order("name"),
    supabase.from(T.yarnBrands).select("id,name,yarn_type_id").eq("is_active", true).order("name"),
  ]);

  if (sup.error) throw sup.error;
  if (fac.error) throw fac.error;
  if (yt.error) throw yt.error;
  if (yb.error) throw yb.error;

  masters.suppliers = sup.data || [];
  masters.factories = fac.data || [];
  masters.yarnTypes = yt.data || [];
  masters.yarnBrands = yb.data || [];

  rebuildMaps();
  fillHeaderSelects();
}

function rebuildMaps() {
  maps.supplierByName = new Map(masters.suppliers.map(x => [normKey(x.name), x]));
  maps.factoryByName = new Map(masters.factories.map(x => [normKey(x.name), x]));
  maps.yarnTypeByName = new Map(masters.yarnTypes.map(x => [normKey(x.name), x]));
  maps.yarnBrandByKey = new Map();
  masters.yarnBrands.forEach(b => {
    maps.yarnBrandByKey.set(`${b.yarn_type_id}|${normKey(b.name)}`, b);
  });
}

function normKey(s) {
  return String(s || "").trim().toLowerCase();
}

function fillHeaderSelects() {
  // supplier
  elSupplierId.innerHTML = "";
  option(elSupplierId, "", "اختر المورد");
  masters.suppliers.forEach(s => option(elSupplierId, s.id, s.name));

  // factory
  elFactoryId.innerHTML = "";
  option(elFactoryId, "", "اختر مصنع الخام");
  masters.factories.forEach(f => option(elFactoryId, f.id, f.name));
}

function fillYarnTypeSelect(sel) {
  sel.innerHTML = "";
  option(sel, "", "اختر نوع الخيط");
  masters.yarnTypes.forEach(t => option(sel, t.id, t.name));
}

function fillYarnBrandSelect(sel, typeId) {
  sel.innerHTML = "";
  option(sel, "", "اختر الماركة");
  const list = masters.yarnBrands.filter(b => b.yarn_type_id === typeId);
  list.forEach(b => option(sel, b.id, b.name));
}

/* ====== Item UI ====== */
function renumberItems() {
  [...elItemsWrap.querySelectorAll(".item")].forEach((it, idx) => {
    $(".item-title", it).textContent = `بند ${idx + 1}`;
  });
}

function recomputeLine(itemEl) {
  const qty = toNumberSafe($(".qty", itemEl).value);
  const price = toNumberSafe($(".price", itemEl).value);
  const totalInput = $(".lineTotal", itemEl);

  if (qty == null || price == null) {
    totalInput.value = "";
    return null;
  }
  const total = qty * price;
  totalInput.value = fmt3(total);
  return total;
}

function recomputeGrand() {
  let sum = 0;
  [...elItemsWrap.querySelectorAll(".item")].forEach(it => {
    const lt = toNumberSafe($(".lineTotal", it).value);
    if (lt != null) sum += lt;
  });
  elGrandTotal.textContent = fmt3(sum || 0);
}

function addItem(prefill) {
  const node = elItemTpl.content.firstElementChild.cloneNode(true);

  const yarnTypeSel = $(".yarnTypeId", node);
  const yarnBrandSel = $(".yarnBrandId", node);
  const lotInput = $(".lotNo", node);
  const qtyInput = $(".qty", node);
  const priceInput = $(".price", node);

  fillYarnTypeSelect(yarnTypeSel);

  yarnTypeSel.addEventListener("change", () => {
    const typeId = yarnTypeSel.value;
    yarnBrandSel.disabled = !typeId;
    fillYarnBrandSelect(yarnBrandSel, typeId);
    yarnBrandSel.value = "";
  });

  // normalize digits on blur
  [lotInput, qtyInput, priceInput].forEach(inp => {
    inp.addEventListener("blur", () => {
      inp.value = normalizeDigits(inp.value);
      recomputeLine(node);
      recomputeGrand();
    });
  });

  [qtyInput, priceInput].forEach(inp => {
    inp.addEventListener("input", () => {
      recomputeLine(node);
      recomputeGrand();
    });
  });

  $(".btnRemoveItem", node).addEventListener("click", () => {
    node.remove();
    renumberItems();
    recomputeGrand();
  });

  $(".addYarnTypeBtn", node).addEventListener("click", () => {
    openModal(modalYarnType);
    $("#newYarnTypeName").focus();
  });

  $(".addYarnBrandBtn", node).addEventListener("click", () => {
    pendingBrandAddForItemEl = node;
    refreshBrandTypeSelect();
    const typeId = yarnTypeSel.value;
    $("#brandTypeId").value = typeId || "";
    openModal(modalYarnBrand);
    $("#newYarnBrandName").focus();
  });

  if (prefill) {
    yarnTypeSel.value = prefill.typeId || "";
    if (prefill.typeId) {
      yarnBrandSel.disabled = false;
      fillYarnBrandSelect(yarnBrandSel, prefill.typeId);
      yarnBrandSel.value = prefill.brandId || "";
    }
    lotInput.value = prefill.lotNo || "";
    qtyInput.value = prefill.qty ?? "";
    priceInput.value = prefill.price ?? "";
    recomputeLine(node);
  }

  elItemsWrap.appendChild(node);
  renumberItems();
  recomputeGrand();
}

/* ====== Receipt image (resize to 1200px) ====== */
function setReceiptImagePreview(url) {
  if (url) {
    imgEl.src = url;
    imgEl.style.display = "block";
    imgPlaceholder.style.display = "none";
  } else {
    imgEl.removeAttribute("src");
    imgEl.style.display = "none";
    imgPlaceholder.style.display = "block";
  }
}

async function resizeImageTo1200(file) {
  const img = await loadImage(file);
  const maxW = 1200;

  const ratio = img.width > maxW ? (maxW / img.width) : 1;
  const w = Math.round(img.width * ratio);
  const h = Math.round(img.height * ratio);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
  return blob;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

function keyForReceiptImage() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const rand = crypto.randomUUID();
  return `${RECEIPT_PREFIX}/${yyyy}/${mm}/${rand}.jpg`;
}

async function uploadReceiptImage(file) {
  const blob = await resizeImageTo1200(file);
  const path = keyForReceiptImage();

  const up = await supabase.storage.from(RECEIPT_BUCKET).upload(path, blob, {
    contentType: "image/jpeg",
    upsert: true,
  });

  if (up.error) throw up.error;
  return path;
}

/* ====== Create supplier/factory/type/brand ====== */
async function createSupplier(name) {
  const clean = String(name || "").trim();
  if (!clean) throw new Error("اسم المورد مطلوب.");
  const ins = await supabase.from(T.suppliers).insert({ name: clean }).select("id,name").single();
  if (ins.error) throw ins.error;
  masters.suppliers.push(ins.data);
  masters.suppliers.sort((a, b) => a.name.localeCompare(b.name, "ar"));
  rebuildMaps();
  fillHeaderSelects();
  return ins.data;
}

async function createFactory(name) {
  const clean = String(name || "").trim();
  if (!clean) throw new Error("اسم المصنع مطلوب.");
  const ins = await supabase.from(T.factories).insert({ name: clean }).select("id,name").single();
  if (ins.error) throw ins.error;
  masters.factories.push(ins.data);
  masters.factories.sort((a, b) => a.name.localeCompare(b.name, "ar"));
  rebuildMaps();
  fillHeaderSelects();
  return ins.data;
}

async function createYarnType(name) {
  const clean = String(name || "").trim();
  if (!clean) throw new Error("اسم نوع الغزل مطلوب.");
  const ins = await supabase.from(T.yarnTypes).insert({ name: clean }).select("id,name").single();
  if (ins.error) throw ins.error;
  masters.yarnTypes.push(ins.data);
  masters.yarnTypes.sort((a, b) => a.name.localeCompare(b.name, "ar"));
  rebuildMaps();
  // update all type selects
  [...document.querySelectorAll("select.yarnTypeId")].forEach(sel => fillYarnTypeSelect(sel));
  refreshBrandTypeSelect();
  return ins.data;
}

async function createYarnBrand(typeId, name) {
  const clean = String(name || "").trim();
  if (!typeId) throw new Error("حدد نوع الغزل للماركة.");
  if (!clean) throw new Error("اسم الماركة مطلوب.");

  const ins = await supabase.from(T.yarnBrands)
    .insert({ yarn_type_id: typeId, name: clean })
    .select("id,name,yarn_type_id")
    .single();

  if (ins.error) throw ins.error;

  masters.yarnBrands.push(ins.data);
  masters.yarnBrands.sort((a, b) => a.name.localeCompare(b.name, "ar"));
  rebuildMaps();

  // refresh brands for all items of same type
  [...document.querySelectorAll(".item")].forEach(item => {
    const tSel = $(".yarnTypeId", item);
    const bSel = $(".yarnBrandId", item);
    if (tSel.value === typeId) {
      bSel.disabled = false;
      fillYarnBrandSelect(bSel, typeId);
    }
  });

  refreshBrandTypeSelect();
  return ins.data;
}

function refreshBrandTypeSelect() {
  const sel = $("#brandTypeId");
  sel.innerHTML = "";
  option(sel, "", "اختر نوع الخيط");
  masters.yarnTypes.forEach(t => option(sel, t.id, t.name));
}

/* ====== Validate + Submit ====== */
function readReceiptFromUI() {
  const supplier_id = elSupplierId.value || null;
  const factory_id = elFactoryId.value || null;
  const supplier_note_no = normalizeDigits(elSupplierNoteNo.value);
  const supplier_note_date = elSupplierNoteDate.value || null;

  if (!supplier_id) return { error: "اختر مورد الغزل." };
  if (!factory_id) return { error: "اختر مصنع الخام." };
  if (!supplier_note_date) return { error: "حدد تاريخ رسالة المورد." };

  const itemsEls = [...elItemsWrap.querySelectorAll(".item")];
  if (itemsEls.length === 0) return { error: "أضف بندًا واحدًا على الأقل." };

  const items = [];
  let grand = 0;

  for (const it of itemsEls) {
    const yarn_type_id = $(".yarnTypeId", it).value || null;
    const yarn_brand_id = $(".yarnBrandId", it).value || null;
    const lot_no = normalizeDigits($(".lotNo", it).value) || null;
    const qty = toNumberSafe($(".qty", it).value);
    const price = toNumberSafe($(".price", it).value);

    if (!yarn_type_id) return { error: "يوجد بند بدون نوع خيط." };
    if (qty == null) return { error: "يوجد بند بدون كمية صحيحة." };

    const line_total = (qty != null && price != null) ? Math.round(qty * price * 1000) / 1000 : null;
    if (line_total != null) grand += line_total;

    items.push({
      yarn_type_id,
      yarn_brand_id,
      lot_no,
      qty,
      price,
      line_total,
    });
  }

  return {
    error: null,
    receipt: {
      supplier_id,
      factory_id,
      supplier_note_no: supplier_note_no || null,
      supplier_note_date,
      grand_total: Math.round(grand * 1000) / 1000,
      items,
    }
  };
}

async function callAnyRpc(candidates, args) {
  let lastErr = null;
  for (const fn of candidates) {
    const r = await supabase.rpc(fn, args);
    if (!r.error) return { fn, data: r.data };
    lastErr = r.error;
    // If function doesn't exist, try next. Otherwise stop and return.
    if (!/function .* does not exist/i.test(r.error.message || "")) {
      return { fn, error: r.error };
    }
  }
  return { error: lastErr || new Error("لا يوجد RPC مناسب.") };
}

async function callAnyRpcWithArgVariants(candidates, argVariants) {
  let last = null;
  for (const args of argVariants) {
    const res = await callAnyRpc(candidates, args);
    if (!res?.error) return res;
    last = res;
    // if error is "function does not exist" keep trying other args because it might exist but args mismatch
    // otherwise: keep going anyway; we'll show last error at end.
  }
  return last || { error: new Error("RPC failed.") };
}

async function submitReceipt() {
  clearStatus();

  const { error, receipt } = readReceiptFromUI();
  if (error) {
    showStatus(error, "err");
    return;
  }

  try {
    btnSubmit.disabled = true;

    let receipt_image_path = null;
    if (currentImage.file) {
      showStatus("جاري رفع صورة الأذن...", "ok");
      receipt_image_path = await uploadReceiptImage(currentImage.file);
    }

    const payload = { ...receipt, receipt_image_path };

    showStatus(isManager ? "جاري إنشاء الطلب..." : "جاري إرسال الطلب للمراجعة...", "ok");

    // Try few common arg styles
    const res = await callAnyRpcWithArgVariants(RPC_CREATE_CANDIDATES, [
      { payload },
      { p_payload: payload },
      { data: payload },
      { p_data: payload },
    ]);

    if (res?.error) {
      showStatus("فشل إرسال الطلب: " + res.error.messag// extract id for user message
    const ret = res.data;
    const id =
      (typeof ret === "string" && ret) ||
      ret?.change_request_id ||
      ret?.id ||
      ret?.request_id ||
      null;

    if (isManager && id) {
      showStatus(`تم إنشاء الطلب. جاري الاعتماد... رقم الطلب: ${id}`, "ok");
      const appr = await callAnyRpcWithArgVariants(RPC_APPROVE_CANDIDATES, [
        { p_id: id },
        { id },
        { p_change_request_id: id },
        { change_request_id: id },
      ]);
      if (appr?.error) {
        // If auto-approve fails, leave it pending but show clear message
        showStatus(`تم إنشاء الطلب لكنه ما زال بحاجة لاعتماد. رقم الطلب: ${id}`, "ok");
      } else {
        showStatus(`تم إنشاء الطلب واعتماده مباشرة. رقم الطلب: ${id}`, "ok");
      }
    } else {
      showStatus(id
        ? `تم إرسال الطلب للمراجعة. رقم الطلب: ${id}`
        : "تم إرسال الطلب للمراجعة.", "ok");
    }

إرسال الطلب للمراجعة.", "ok");

    resetForm();
  } catch (e) {
    showStatus("خطأ: " + (e?.message || e), "err");
  } finally {
    btnSubmit.disabled = false;
  }
}

/* ====== Reset form ====== */
function resetForm() {
  elSupplierId.value = "";
  elFactoryId.value = "";
  elSupplierNoteNo.value = "";
  elSupplierNoteDate.value = todayISO();

  elItemsWrap.innerHTML = "";
  addItem();
  setReceiptImagePreview(null);
  currentImage = { file: null, previewUrl: null };
  recomputeGrand();
}

/* ====== Import (Option A) ====== */
function splitLine(line) {
  // prefer tab if present
  const delim = line.includes("\t") ? "\t" : ",";
  return line.split(delim).map(x => String(x ?? "").trim());
}

function headerKey(h) {
  return normKey(h)
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");
}

function mapRowByHeader(headers, cells) {
  const obj = {};
  headers.forEach((h, i) => obj[h] = cells[i] ?? "");
  return obj;
}

function detectHasHeader(firstLineCells) {
  // crude: if contains any letters
  return firstLineCells.some(c => /[A-Za-z\u0600-\u06FF]/.test(c));
}

function normalizeImportRow(r) {
  // accept many header variants (english/ar)
  const g = (kList) => {
    for (const k of kList) {
      const v = r[k];
      if (v != null && String(v).trim() !== "") return String(v).trim();
    }
    return "";
  };

  return {
    supplier_name: g(["supplier_name", "supplier", "المورد", "مورد", "اسم_المورد", "اسم المورد"]),
    factory_name: g(["factory_name", "factory", "مصنع", "المصنع", "مصنع_الخام", "اسم_المصنع", "اسم المصنع"]),
    supplier_note_no: normalizeDigits(g(["supplier_note_no", "note_no", "receipt_no", "رقم_الأذن", "رقم الاذن", "رقم رسالة المورد", "supplier_note_number"])),
    supplier_note_date: g(["supplier_note_date", "note_date", "receipt_date", "التاريخ", "تاريخ", "تاريخ رسالة المورد"]),
    yarn_type: g(["yarn_type", "type", "نوع_الخيط", "نوع الخيط", "نوع الغزل"]),
    yarn_brand: g(["yarn_brand", "brand", "ماركة_الخيط", "ماركة الخيط", "ماركة الغزل"]),
    lot_no: normalizeDigits(g(["lot_no", "lot", "لوط", "رقم_اللوط", "رقم اللوط"])),
    qty: normalizeDigits(g(["qty", "quantity", "الكمية", "كمية"])),
    price: normalizeDigits(g(["price", "السعر", "سعر"])),
  };
}

async function getOrCreateSupplierByName(name) {
  const key = normKey(name);
  if (!key) throw new Error("supplier_name مطلوب في الاستيراد.");
  const cached = maps.supplierByName.get(key);
  if (cached) return cached.id;

  // try DB lookup (in case masters not updated)
  const q = await supabase.from(T.suppliers).select("id,name").ilike("name", name).limit(5);
  if (!q.error && q.data?.length) {
    const exact = q.data.find(x => normKey(x.name) === key) || q.data[0];
    masters.suppliers.push(exact);
    rebuildMaps();
    fillHeaderSelects();
    return exact.id;
  }

  const created = await createSupplier(name);
  return created.id;
}

async function getOrCreateFactoryByName(name) {
  const key = normKey(name);
  if (!key) throw new Error("factory_name مطلوب في الاستيراد.");
  const cached = maps.factoryByName.get(key);
  if (cached) return cached.id;

  const q = await supabase.from(T.factories).select("id,name").ilike("name", name).limit(5);
  if (!q.error && q.data?.length) {
    const exact = q.data.find(x => normKey(x.name) === key) || q.data[0];
    masters.factories.push(exact);
    rebuildMaps();
    fillHeaderSelects();
    return exact.id;
  }

  const created = await createFactory(name);
  return created.id;
}

async function getOrCreateYarnTypeByName(name) {
  const key = normKey(name);
  if (!key) throw new Error("yarn_type مطلوب في الاستيراد.");
  const cached = maps.yarnTypeByName.get(key);
  if (cached) return cached.id;

  const q = await supabase.from(T.yarnTypes).select("id,name").ilike("name", name).limit(5);
  if (!q.error && q.data?.length) {
    const exact = q.data.find(x => normKey(x.name) === key) || q.data[0];
    masters.yarnTypes.push(exact);
    rebuildMaps();
    [...document.querySelectorAll("select.yarnTypeId")].forEach(sel => fillYarnTypeSelect(sel));
    refreshBrandTypeSelect();
    return exact.id;
  }

  const created = await createYarnType(name);
  return created.id;
}

async function getOrCreateYarnBrandByName(typeId, name) {
  const key = `${typeId}|${normKey(name)}`;
  if (!typeId) throw new Error("typeId مفقود للموديل.");
  if (!normKey(name)) return null; // brand optional
  const cached = maps.yarnBrandByKey.get(key);
  if (cached) return cached.id;

  // Try DB lookup
  const q = await supabase.from(T.yarnBrands).select("id,name,yarn_type_id")
    .eq("yarn_type_id", typeId)
    .ilike("name", name)
    .limit(10);

  if (!q.error && q.data?.length) {
    const exact = q.data.find(x => normKey(x.name) === normKey(name)) || q.data[0];
    masters.yarnBrands.push(exact);
    rebuildMaps();
    return exact.id;
  }

  const created = await createYarnBrand(typeId, name);
  return created.id;
}

function parseImportText(raw) {
  const lines = String(raw || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return { rows: [], error: "لا توجد بيانات." };

  const first = splitLine(lines[0]);
  let headers = null;
  let startIdx = 0;

  if (detectHasHeader(first)) {
    headers = first.map(headerKey);
    startIdx = 1;
  }

  const rows = [];
  for (let i = startIdx; i < lines.length; i++) {
    const cells = splitLine(lines[i]);
    if (!cells.some(x => x.trim() !== "")) continue;

    let obj;
    if (headers) {
      obj = mapRowByHeader(headers, cells);
    } else {
      // fixed order:
      const fixed = [
        "supplier_name", "factory_name", "supplier_note_no", "supplier_note_date",
        "yarn_type", "yarn_brand", "lot_no", "qty", "price"
      ];
      obj = mapRowByHeader(fixed, cells);
    }
    rows.push(normalizeImportRow(obj));
  }

  return { rows, error: null };
}

function groupKey(r) {
  // group by supplier + factory + note + date
  const d = (r.supplier_note_date || "").trim();
  return `${normKey(r.supplier_name)}|${normKey(r.factory_name)}|${normalizeDigits(r.supplier_note_no)}|${d}`;
}

async function runImport() {
  clearStatus();
  importProgress.textContent = "";

  const { rows, error } = parseImportText(importText.value);
  if (error) {
    importProgress.textContent = error;
    return;
  }

  // group rows into receipts
  const groups = new Map();
  for (const r of rows) {
    const k = groupKey(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }

  const groupList = [...groups.values()];
  if (groupList.length === 0) {
    importProgress.textContent = "لا توجد صفوف صالحة.";
    return;
  }

  btnRunImport.disabled = true;

  try {
    let done = 0;
    for (const rowsOfReceipt of groupList) {
      done += 1;
      importProgress.textContent = `جاري الاستيراد: ${done} / ${groupList.length}`;

      const h = rowsOfReceipt[0];

      const supplier_id = await getOrCreateSupplierByName(h.supplier_name);
      const factory_id = await getOrCreateFactoryByName(h.factory_name);
      const supplier_note_no = h.supplier_note_no || null;
      const supplier_note_date = h.supplier_note_date || null;
      if (!supplier_note_date) throw new Error("supplier_note_date مطلوب في الاستيراد.");

      const items = [];
      let grand = 0;

      for (const rr of rowsOfReceipt) {
        const yarn_type_id = await getOrCreateYarnTypeByName(rr.yarn_type);
        const yarn_brand_id = await getOrCreateYarnBrandByName(yarn_type_id, rr.yarn_brand);
        const qty = toNumberSafe(rr.qty);
        if (qty == null) throw new Error("qty مطلوب وصحيح في الاستيراد.");
        const price = toNumberSafe(rr.price);

        const line_total = (qty != null && price != null) ? Math.round(qty * price * 1000) / 1000 : null;
        if (line_total != null) grand += line_total;

        items.push({
          yarn_type_id,
          yarn_brand_id,
          lot_no: rr.lot_no || null,
          qty,
          price,
          line_total,
        });
      }

      const payload = {
        supplier_id,
        factory_id,
        supplier_note_no,
        supplier_note_date,
        receipt_image_path: null,
        grand_total: Math.round(grand * 1000) / 1000,
        items,
      };

      const res = await callAnyRpcWithArgVariants(RPC_CREATE_CANDIDATES, [
        { payload },
        { p_payload: payload },
        { data: payload },
        { p_data: payload },
      ]);

      if (res?.error) throw new Error(res.error.message);
    }

    importProgress.textContent = `تم الاستيراد بنجاح: ${groupList.length} أذونات (جميعها قيد المراجعة).`;
    showStatus("تم تنفيذ الاستيراد.", "ok");
    closeModal(modalImport);
  } catch (e) {
    importProgress.textContent = "فشل: " + (e?.message || e);
    showStatus("فشل الاستيراد: " + (e?.message || e), "err");
  } finally {
    btnRunImport.disabled = false;
  }
}

/* ====== Events ====== */
btnNew.addEventListener("click", () => resetForm());

btnAddItem.addEventListener("click", () => addItem());

btnSubmit.addEventListener("click", submitReceipt);

elSupplierNoteNo.addEventListener("blur", () => elSupplierNoteNo.value = normalizeDigits(elSupplierNoteNo.value));
["blur"].forEach(ev => {
  elSupplierNoteNo.addEventListener(ev, () => elSupplierNoteNo.value = normalizeDigits(elSupplierNoteNo.value));
});

btnPickImage.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  if (currentImage.previewUrl) URL.revokeObjectURL(currentImage.previewUrl);
  currentImage.file = file;
  currentImage.previewUrl = URL.createObjectURL(file);
  setReceiptImagePreview(currentImage.previewUrl);
});

btnRemoveImage.addEventListener("click", () => {
  if (currentImage.previewUrl) URL.revokeObjectURL(currentImage.previewUrl);
  currentImage = { file: null, previewUrl: null };
  fileInput.value = "";
  setReceiptImagePreview(null);
});

btnImport.addEventListener("click", () => {
  importText.value = "";
  importProgress.textContent = "";
  openModal(modalImport);
  importText.focus();
});

btnRunImport.addEventListener("click", runImport);

/* supplier modal */
$("#addSupplierBtn").addEventListener("click", () => {
  $("#newSupplierName").value = "";
  openModal(modalSupplier);
  $("#newSupplierName").focus();
});

$("#saveSupplier").addEventListener("click", async () => {
  try {
    const name = $("#newSupplierName").value;
    const created = await createSupplier(name);
    elSupplierId.value = created.id;
    closeModal(modalSupplier);
  } catch (e) {
    alert(e?.message || e);
  }
});

/* factory modal */
$("#addFactoryBtn").addEventListener("click", () => {
  $("#newFactoryName").value = "";
  openModal(modalFactory);
  $("#newFactoryName").focus();
});

$("#saveFactory").addEventListener("click", async () => {
  try {
    const name = $("#newFactoryName").value;
    const created = await createFactory(name);
    elFactoryId.value = created.id;
    closeModal(modalFactory);
  } catch (e) {
    alert(e?.message || e);
  }
});

/* yarn type modal */
$("#saveYarnType").addEventListener("click", async () => {
  try {
    const name = $("#newYarnTypeName").value;
    const created = await createYarnType(name);

    // if there is an active item that requested modal, set it
    const lastItem = elItemsWrap.querySelector(".item:last-child");
    if (lastItem) {
      const sel = $(".yarnTypeId", lastItem);
      sel.value = created.id;
      const bSel = $(".yarnBrandId", lastItem);
      bSel.disabled = false;
      fillYarnBrandSelect(bSel, created.id);
    }

    closeModal(modalYarnType);
  } catch (e) {
    alert(e?.message || e);
  }
});

/* yarn brand modal */
$("#saveYarnBrand").addEventListener("click", async () => {
  try {
    const typeId = $("#brandTypeId").value;
    const name = $("#newYarnBrandName").value;
    const created = await createYarnBrand(typeId, name);

    // assign to the item which opened modal (if any)
    if (pendingBrandAddForItemEl) {
      const tSel = $(".yarnTypeId", pendingBrandAddForItemEl);
      const bSel = $(".yarnBrandId", pendingBrandAddForItemEl);

      if (tSel.value !== typeId) {
        tSel.value = typeId;
      }
      bSel.disabled = false;
      fillYarnBrandSelect(bSel, typeId);
      bSel.value = created.id;

      pendingBrandAddForItemEl = null;
    }

    closeModal(modalYarnBrand);
  } catch (e) {
    alert(e?.message || e);
  }
});

/* ====== Init ====== */
(async function init() {
  await requireSession();
  await loadIsManager();
  elSupplierNoteDate.value = todayISO();
  try {
    await loadMasters();
    addItem();
  } catch (e) {
    showStatus("تعذر تحميل القوائم من قاعدة البيانات: " + (e?.message || e), "err");
  }
})();let isManager = false;

async function loadIsManager() {
  try {
    const r = await supabase.rpc('is_manager');
    if (!r.error && typeof r.data === 'boolean') isManager = r.data;
  } catch (_) {}
}


