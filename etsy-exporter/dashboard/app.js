// app.js

let ORDERS = [];
let TEMPLATE_FIELDS = [];
let SELECTED_ORDER_IDS = new Set(); // 当前勾选的订单 ID

document.addEventListener("DOMContentLoaded", () => {
  initMenu();
  loadTemplateFromStorage(() => {
    loadOrdersFromStorage();
    setupTemplateUI();
    document
      .getElementById("btnExportCsv")
      .addEventListener("click", exportCsv);
  });
});

/* ========== 菜单切换 ========== */

function initMenu() {
  const items = document.querySelectorAll(".menu-item");
  items.forEach((item) => {
    item.addEventListener("click", () => {
      items.forEach((i) => i.classList.remove("active"));
      item.classList.add("active");
      switchPage(item.dataset.page);
    });
  });
}

function switchPage(pageName) {
  document
    .querySelectorAll(".page")
    .forEach((p) => p.classList.remove("page-active"));
  document
    .getElementById("page-" + pageName)
    .classList.add("page-active");
}

/* ========== 订单加载 & 渲染 ========== */

function loadOrdersFromStorage() {
  const infoEl = document.getElementById("orders-info");
  chrome.storage.local.get(["latestOrders", "latestOrdersTime"], (data) => {
    ORDERS = data.latestOrders || [];
    if (!ORDERS.length) {
      infoEl.textContent =
        "未找到订单数据，请先在 Etsy 订单页面点击右上角 “E 导出” 按钮。";
      return;
    }
    const timeStr = data.latestOrdersTime
      ? new Date(data.latestOrdersTime).toLocaleString()
      : "";
    infoEl.textContent = `当前共 ${ORDERS.length} 个订单（采集时间：${timeStr}）。`;

    // 默认全部选中
    SELECTED_ORDER_IDS = new Set(
      ORDERS.map((o) => String(o.order_id ?? ""))
    );

    renderOrdersTable();
  });
}

/**
 * 读取模板时，按保存的 keys 顺序生成 TEMPLATE_FIELDS
 */
function loadTemplateFromStorage(cb) {
  chrome.storage.sync.get(
    { selectedFields: window.DEFAULT_FIELD_KEYS || [] },
    (data) => {
      const keys = data.selectedFields || window.DEFAULT_FIELD_KEYS || [];
      const all = window.ALL_FIELDS || [];

      // ⭐ 用 keys 的顺序来排，而不是 ALL_FIELDS 的顺序
      TEMPLATE_FIELDS = keys
        .map((k) => all.find((f) => f.key === k))
        .filter(Boolean);

      if (cb) cb();
    }
  );
}

/**
 * 渲染订单表格（带勾选 & 全选）
 */
function renderOrdersTable() {
  const thead = document.getElementById("orders-thead");
  const tbody = document.getElementById("orders-tbody");
  thead.innerHTML = "";
  tbody.innerHTML = "";

  if (!ORDERS.length || !TEMPLATE_FIELDS.length) return;

  // 表头
  const trHead = document.createElement("tr");

  const thSelect = document.createElement("th");
  const chkAll = document.createElement("input");
  chkAll.type = "checkbox";
  chkAll.id = "orders-select-all";
  chkAll.title = "全选 / 全不选";
  chkAll.checked = areAllOrdersSelected();
  chkAll.addEventListener("change", () => {
    if (chkAll.checked) {
      SELECTED_ORDER_IDS = new Set(
        ORDERS.map((o) => String(o.order_id ?? ""))
      );
    } else {
      SELECTED_ORDER_IDS.clear();
    }
    updateRowCheckboxes();
  });
  thSelect.appendChild(chkAll);
  trHead.appendChild(thSelect);

  TEMPLATE_FIELDS.forEach((f) => {
    const th = document.createElement("th");
    th.textContent = f.label;
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);

  // 表体
  ORDERS.forEach((o) => {
    const tr = document.createElement("tr");
    const orderId = String(o.order_id ?? "");

    // 勾选列
    const tdSelect = document.createElement("td");
    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.className = "order-select-checkbox";
    chk.dataset.orderId = orderId;
    chk.checked = SELECTED_ORDER_IDS.has(orderId);
    chk.addEventListener("change", () => {
      if (chk.checked) {
        SELECTED_ORDER_IDS.add(orderId);
      } else {
        SELECTED_ORDER_IDS.delete(orderId);
      }
      const headChk = document.getElementById("orders-select-all");
      if (headChk) headChk.checked = areAllOrdersSelected();
    });
    tdSelect.appendChild(chk);
    tr.appendChild(tdSelect);

    // 数据列
    TEMPLATE_FIELDS.forEach((f) => {
      const td = document.createElement("td");
      td.textContent = (o[f.key] ?? "").toString();
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });
}

function areAllOrdersSelected() {
  if (!ORDERS.length) return false;
  let count = 0;
  ORDERS.forEach((o) => {
    const id = String(o.order_id ?? "");
    if (SELECTED_ORDER_IDS.has(id)) count++;
  });
  return count === ORDERS.length;
}

function updateRowCheckboxes() {
  const checkboxes = document.querySelectorAll("input.order-select-checkbox");
  checkboxes.forEach((chk) => {
    const id = chk.dataset.orderId || "";
    chk.checked = SELECTED_ORDER_IDS.has(id);
  });
}

/* ========== 模板设置：左侧 select + 右侧拖拽列表 ========== */

function setupTemplateUI() {
  const allFields = window.ALL_FIELDS || [];
  // TEMPLATE_FIELDS 里的顺序就是当前导出顺序
  const selectedKeys = TEMPLATE_FIELDS.map((f) => f.key);

  // ⭐ 按 selectedKeys 的顺序取字段，而不是用 filter 打乱顺序
  const selectedFields = selectedKeys
    .map((k) => allFields.find((f) => f.key === k))
    .filter(Boolean);

  const availableFields = allFields.filter(
    (f) => !selectedKeys.includes(f.key)
  );

  const selAvail = document.getElementById("tmpl-available");
  const listSel = document.getElementById("tmpl-selected");

  renderSelectOptions(selAvail, availableFields);
  renderSelectedList(listSel, selectedFields);

  document.getElementById("tmpl-add").onclick = () =>
    moveLeftToRight(selAvail, listSel);
  document.getElementById("tmpl-remove").onclick = () =>
    moveRightToLeft(selAvail, listSel);
  document.getElementById("tmpl-reset").onclick = () =>
    resetTemplate(selAvail, listSel);
  document.getElementById("tmpl-save").onclick = () =>
    saveTemplate(selAvail, listSel);

  enableDragSort(listSel);
}

/* 左侧 select 渲染 */
function renderSelectOptions(selectEl, fields) {
  selectEl.innerHTML = "";
  fields.forEach((f) => {
    const opt = document.createElement("option");
    opt.value = f.key;
    opt.textContent = `${f.label} (${f.key})`;
    selectEl.appendChild(opt);
  });
}

/* 右侧 ul 渲染 */
function renderSelectedList(listEl, fields) {
  listEl.innerHTML = "";
  fields.forEach((f) => {
    const li = document.createElement("li");
    li.textContent = `${f.label} (${f.key})`;
    li.dataset.key = f.key;
    li.draggable = true;

    li.addEventListener("click", (e) => {
      const isMulti = e.ctrlKey || e.metaKey;

      if (!isMulti) {
        // 普通点击：只保留当前一个选中
        listEl.querySelectorAll("li.selected").forEach((el) => {
          if (el !== li) el.classList.remove("selected");
        });
        // 当前这个 toggle 一下（允许全部取消）
        li.classList.toggle("selected");
      } else {
        // 按住 Ctrl / Command：真正的多选
        li.classList.toggle("selected");
      }
    });

    listEl.appendChild(li);
  });
}

/* 右侧 ul 启用拖拽排序 */
function enableDragSort(listEl) {
  let dragged = null;

  listEl.addEventListener("dragstart", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    dragged = li;
    li.style.opacity = 0.5;
  });

  listEl.addEventListener("dragend", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    li.style.opacity = "";
    dragged = null;
  });

  listEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (!dragged) return;
    const li = e.target.closest("li");
    if (!li || li === dragged) return;

    const rect = li.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    listEl.insertBefore(dragged, before ? li : li.nextSibling);
  });
}

/* 左 -> 右：从左侧 select 移到右侧 ul */
function moveLeftToRight(selAvail, listSel) {
  const selectedOpts = Array.from(selAvail.selectedOptions);
  if (!selectedOpts.length) return;

  const all = window.ALL_FIELDS || [];
  const addKeys = selectedOpts.map((o) => o.value);

  // 右侧当前 keys
  const currentRightKeys = Array.from(listSel.children).map(
    (li) => li.dataset.key
  );
  const finalRightKeys = [...currentRightKeys, ...addKeys];

  // 右侧字段按“当前顺序 + 新增顺序”排列
  const rightFields = finalRightKeys
    .map((k) => all.find((f) => f.key === k))
    .filter(Boolean);

  // 左侧字段：始终按 ALL_FIELDS 的原始顺序过滤掉“右侧已选”
  const leftFields = all.filter((f) => !finalRightKeys.includes(f.key));

  renderSelectedList(listSel, rightFields);
  renderSelectOptions(selAvail, leftFields);
  enableDragSort(listSel);
}

/* 右 -> 左：从右侧 ul 移回左侧 select */
function moveRightToLeft(selAvail, listSel) {
  const all = window.ALL_FIELDS || [];

  const selectedLis = Array.from(
    listSel.querySelectorAll("li.selected")
  );
  if (!selectedLis.length) return;

  const removeKeys = selectedLis.map((li) => li.dataset.key);

  // 右侧剩余 keys
  const remainingRightKeys = Array.from(listSel.children)
    .map((li) => li.dataset.key)
    .filter((k) => !removeKeys.includes(k));

  const rightFields = remainingRightKeys
    .map((k) => all.find((f) => f.key === k))
    .filter(Boolean);

  // 左侧字段：仍然按 ALL_FIELDS 原始顺序，只要不在 remainingRightKeys 就放左边
  const leftFields = all.filter((f) => !remainingRightKeys.includes(f.key));

  renderSelectOptions(selAvail, leftFields);
  renderSelectedList(listSel, rightFields);
  enableDragSort(listSel);
}

/* 恢复默认模板 */
function resetTemplate(selAvail, listSel) {
  const all = window.ALL_FIELDS || [];
  const selected = (window.DEFAULT_FIELD_KEYS || [])
    .map((k) => all.find((f) => f.key === k))
    .filter(Boolean);
  const available = all.filter(
    (f) => !(window.DEFAULT_FIELD_KEYS || []).includes(f.key)
  );

  renderSelectOptions(selAvail, available);
  renderSelectedList(listSel, selected);
  enableDragSort(listSel);

  document.getElementById("tmpl-status").textContent =
    "已恢复默认模板（请点击保存）。";
}

/* 保存模板：按右侧 ul 的顺序保存 key 列表，并按该顺序更新 TEMPLATE_FIELDS */
function saveTemplate(selAvail, listSel) {
  const keys = Array.from(listSel.children).map((li) => li.dataset.key);

  chrome.storage.sync.set({ selectedFields: keys }, () => {
    document.getElementById("tmpl-status").textContent = "模板已保存。";

    const all = window.ALL_FIELDS || [];
    TEMPLATE_FIELDS = keys
      .map((k) => all.find((f) => f.key === k))
      .filter(Boolean);

    renderOrdersTable();

    setTimeout(() => {
      document.getElementById("tmpl-status").textContent = "";
    }, 1500);
  });
}

/* ========== 导出 CSV（只导出勾选订单，UTF-8 BOM + Excel 兼容） ========== */

function exportCsv() {
  if (!ORDERS.length) {
    alert("没有订单数据。请先在 Etsy 订单页面点击 E 导出按钮。");
    return;
  }
  if (!TEMPLATE_FIELDS.length) {
    alert("模板中没有字段，请先在模板设置中选择。");
    return;
  }

  const ordersToExport = ORDERS.filter((o) =>
    SELECTED_ORDER_IDS.has(String(o.order_id ?? ""))
  );

  if (!ordersToExport.length) {
    alert("没有选择任何订单，请勾选后再导出。");
    return;
  }

  const lines = [];
  const header = TEMPLATE_FIELDS.map((f) => csvEscape(f.label));
  lines.push(header.join(","));

  ordersToExport.forEach((o) => {
    const row = TEMPLATE_FIELDS.map((f) => {
      const raw = o[f.key] == null ? "" : String(o[f.key]);
      return csvEscape(excelSafeValue(f.key, raw));
    });
    lines.push(row.join(","));
  });

  // 先拼好主体
  const csvBody = lines.join("\r\n");
  // 在开头加 BOM，让 Excel 识别为 UTF-8，中文表头不乱码
  const csv = "\uFEFF" + csvBody;

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  a.href = url;
  a.download = `etsy-orders-${ts}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Excel 兼容处理：
 * - 订单号 / 电话 / 邮编 / SKU 等字段，强制按“文本”导出，避免 6.42102E+11
 * - 任意纯数字且位数 >= 8 的内容，也强制文本
 */
function excelSafeValue(fieldKey, value) {
  if (!value) return "";

  const TEXT_FIELDS = new Set([
    "order_id",
    "order_state_id",
    "shipping_phone",
    "shipping_zip",
    "items_sku_list",
    "items_qty_list",
    "private_note_1",
    "private_note_2",
    "private_note_3",
    "private_note_4",
    "private_note_5"
  ]);

  // 去掉非数字后长度>=8，也当成长数字
  const numericPart = value.replace(/\D/g, "");
  const isLongNumber = /^\d{8,}$/.test(numericPart);

  if (TEXT_FIELDS.has(fieldKey) || isLongNumber) {
    return `="${value}"`; // Excel 里显示为文本
  }
  return value;
}

function csvEscape(str) {
  const s = str == null ? "" : String(str);
  const noNL = s.replace(/\r?\n/g, " ");
  if (/[",]/.test(noNL)) {
    return '"' + noNL.replace(/"/g, '""') + '"';
  }
  return noNL;
}
