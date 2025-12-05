// content.js

console.log("[Etsy Exporter] content script loaded.");

(function injectButton() {
  if (document.getElementById("etsy-exporter-btn")) return;

  const btn = document.createElement("button");
  btn.id = "etsy-exporter-btn";
  btn.textContent = "E 导出";
  btn.style.cssText = `
    position: fixed;
    top: 88px;
    right: 40px;
    z-index: 9999;
    padding: 6px 14px;
    background: #1677ff;
    color: #fff;
    border: none;
    border-radius: 24px;
    font-size: 13px;
    cursor: pointer;
    box-shadow: 0 2px 6px rgba(0,0,0,.2);
  `;

  btn.addEventListener("mouseenter", () => {
    btn.style.background = "#4096ff";
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.background = "#1677ff";
  });

  btn.addEventListener("click", onExportClick);
  document.body.appendChild(btn);
})();

function onExportClick() {
  try {
    const orders = extractOrdersFromEtsyContext();
    console.log("[Etsy Exporter] extract result:", orders);

    if (!orders || !orders.length) {
      alert("没有读取到订单数据，请确认当前页面为 Etsy 订单列表。");
      return;
    }

    chrome.storage.local.set(
      {
        latestOrders: orders,
        latestOrdersTime: Date.now()
      },
      () => {
        const url = chrome.runtime.getURL("dashboard/index.html");
        window.open(url, "_blank");
      }
    );
  } catch (e) {
    console.error("[Etsy Exporter] extract error:", e);
    alert("读取订单数据出错，请查看控制台日志。");
  }
}

// -------------------------
//      读取 Etsy.Context
// -------------------------
function extractOrdersFromEtsyContext() {
  let ctx = null;

  if (window.Etsy && window.Etsy.Context) {
    const c = window.Etsy.Context;
    if (c.data?.initial_data?.orders) {
      ctx = c;
    } else if (c.initial_data?.orders) {
      ctx = c;
    }
  }

  if (!ctx) ctx = parseEtsyContextFromScripts();
  if (!ctx) return [];

  const rootData = ctx.data || {};
  const initial = rootData.initial_data || ctx.initial_data || {};
  const ordersSearch = initial.orders?.orders_search;

  if (!ordersSearch) return [];

  const buyers = ordersSearch.buyers || [];
  const buyerMap = new Map(buyers.map((b) => [b.buyer_id, b]));

  const rawOrders = ordersSearch.orders || [];

  const normalized = rawOrders.map((o) => normalizeOrder(o, buyerMap));

  attachPrivateNotesFromDom(normalized);
  attachIossNumberFromDom(normalized);

  return normalized;
}

function parseEtsyContextFromScripts() {
  const scripts = document.getElementsByTagName("script");
  const marker = "Etsy.Context=";

  for (const s of scripts) {
    const text = s.textContent || "";
    const idx = text.indexOf(marker);

    if (idx !== -1) {
      let jsonText = text.slice(idx + marker.length).trim();
      if (jsonText.endsWith(";")) jsonText = jsonText.slice(0, -1);

      try {
        return JSON.parse(jsonText);
      } catch (err) {
        console.error("parse Etsy.Context error:", err);
      }
    }
  }

  return null;
}

// -------------------------
//   抓取卖家备注（多条）
// -------------------------
function attachPrivateNotesFromDom(orders) {
  const map = new Map(orders.map((o) => [String(o.order_id), o]));

  const rows = document.querySelectorAll(
    'section[aria-label="orders"] .panel-body-row, section[aria-label="Orders"] .panel-body-row'
  );

  rows.forEach((row) => {
    const chk =
      row.querySelector('input[id^="order-checkbox-"]') ||
      row.querySelector("input[name][value]");
    if (!chk) return;

    const orderId = chk.value || chk.name;
    const order = map.get(String(orderId));
    if (!order) return;

    const icons = row.querySelectorAll('[data-tooltip^="Private note"]');
    icons.forEach((icon) => {
      const flag = icon.closest(".flag");
      if (!flag) return;

      const spans = flag.querySelectorAll(
        '.flag-body span[data-test-id="unsanitize"]'
      );

      spans.forEach((s) => {
        const text = s.textContent.trim();
        if (text) order.private_notes.push(text);
      });
    });
  });

  // 展开到 private_note_1~5
  orders.forEach((o) => {
    const arr = o.private_notes;
    o.private_note_1 = arr[0] || "";
    o.private_note_2 = arr[1] || "";
    o.private_note_3 = arr[2] || "";
    o.private_note_4 = arr[3] || "";
    o.private_note_5 = arr[4] || "";
  });
}

// -------------------------
//     VAT / IOSS（按行匹配）
// -------------------------
function attachIossNumberFromDom(orders) {
  const map = new Map(orders.map((o) => [String(o.order_id), o]));

  const rows = document.querySelectorAll(
    'section[aria-label="orders"] .panel-body-row, section[aria-label="Orders"] .panel-body-row'
  );

  rows.forEach((row) => {
    const chk =
      row.querySelector('input[id^="order-checkbox-"]') ||
      row.querySelector("input[name][value]");
    if (!chk) return;

    const orderId = chk.value || chk.name;
    const order = map.get(String(orderId));
    if (!order) return;

    const vat = extractIossNumberFromContainer(row);
    if (vat) order.etsy_ioss_number = vat;
  });
}

// 在订单单行中抓 VAT 文本
function extractIossNumberFromContainer(root) {
  const strongEls = root.querySelectorAll("strong");

  for (const el of strongEls) {
    const txt = el.textContent.trim();

    // EU IOSS
    if (/IOSS number/i.test(txt)) {
      const m = txt.match(/(Etsy['’]s IOSS number,\s*IM[0-9]+)/i);
      if (m) return m[1];
    }

    // UK VAT
    if (/UK VAT number/i.test(txt)) {
      const m = txt.match(/(Etsy['’]s UK VAT number,\s*[\d ]+)/i);
      if (m) return m[1].trim();
    }
  }

  return "";
}

// -------------------------
//      订单标准化
// -------------------------
function normalizeOrder(order, buyerMap) {
  const buyer = buyerMap.get(order.buyer_id) || {};
  const fulfillment = order.fulfillment || {};
  const toAddr = fulfillment.to_address || {};
  const notes = order.notes || {};
  const payment = order.payment || {};
  const cost = payment.cost_breakdown || {};

  const transactions = order.transactions || [];

  const titles = [];
  const skus = [];
  const qtys = [];
  const pers = [];

  transactions.forEach((tx) => {
    const product = tx.product || {};
    const title = htmlDecode(product.title || "");
    const qty = tx.quantity ?? "";
    titles.push(`${title} x${qty}`);

    if (product.product_identifier) skus.push(product.product_identifier);
    qtys.push(qty);

    const vars = tx.variations || [];
    vars.forEach((v) => {
      const val = htmlDecode(v.value || "");
      if (/personal/i.test(v.property || v.value || "")) pers.push(val);
    });
  });

  const addressParts = [
    htmlDecode(toAddr.first_line || ""),
    htmlDecode(toAddr.second_line || ""),
    htmlDecode(toAddr.city || ""),
    htmlDecode(toAddr.state || ""),
    toAddr.zip || "",
    htmlDecode(toAddr.country || "")
  ].filter(Boolean);

  return {
    order_id: order.order_id || "",
    order_date: formatDate(order.order_date),

    buyer_name: htmlDecode(buyer.name || ""),
    buyer_username: buyer.username || "",
    buyer_email: buyer.email || "",

    shipping_name: htmlDecode(toAddr.name || ""),
    shipping_country: htmlDecode(toAddr.country || ""),
    shipping_state: htmlDecode(toAddr.state || ""),
    shipping_city: htmlDecode(toAddr.city || ""),
    shipping_zip: toAddr.zip || "",
    shipping_phone: toAddr.phone || "",
    address_full: addressParts.join(", "),

    is_gift: order.is_gift ? "YES" : "NO",
    gift_message: htmlDecode(order.gift_message || ""),

    items_text: titles.join(" || "),
    items_sku_list: skus.join(" || "),
    items_qty_list: qtys.join(" || "),
    personalization_list: pers.join(" || "),

    note_from_buyer: htmlDecode(notes.note_from_buyer || ""),

    private_notes: [],
    private_note_1: "",
    private_note_2: "",
    private_note_3: "",
    private_note_4: "",
    private_note_5: "",

    order_url: order.order_url || "",

    total_price:
      cost.total_cost?.formatted_value ||
      moneyFromCents(cost.total_cost?.value, cost.total_cost?.currency_code),

    shipping_price:
      cost.shipping_cost?.formatted_value ||
      moneyFromCents(cost.shipping_cost?.value, cost.shipping_cost?.currency_code),

    tax_price:
      cost.tax_cost?.formatted_value ||
      moneyFromCents(cost.tax_cost?.value, cost.tax_cost?.currency_code),

    discount_price:
      cost.discount?.formatted_value ||
      moneyFromCents(cost.discount?.value, cost.discount?.currency_code),

    etsy_ioss_number: ""  // VAT/IOSS 稍后填
  };
}

function formatDate(ts) {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function moneyFromCents(value, currency) {
  if (typeof value !== "number") return "";
  const v = (value / 100).toFixed(2);
  return currency ? `${currency} ${v}` : v;
}

function htmlDecode(str) {
  const div = document.createElement("div");
  div.innerHTML = str || "";
  return div.textContent || "";
}
