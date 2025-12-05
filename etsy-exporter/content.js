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

/**
 * 先从 window.Etsy.Context 读，不行则从 <script> 中解析 Etsy.Context JSON
 */
function extractOrdersFromEtsyContext() {
  let ctx = null;

  if (window.Etsy && window.Etsy.Context) {
    const c = window.Etsy.Context;
    if (c.data && c.data.initial_data && c.data.initial_data.orders) {
      console.log("[Etsy Exporter] use window.Etsy.Context.data.initial_data");
      ctx = c;
    } else if (c.initial_data && c.initial_data.orders) {
      console.log("[Etsy Exporter] use window.Etsy.Context.initial_data");
      ctx = c;
    }
  }

  if (!ctx) {
    console.log("[Etsy Exporter] fallback: parse Etsy.Context from <script>");
    ctx = parseEtsyContextFromScripts();
  }

  if (!ctx) {
    console.warn("[Etsy Exporter] 无法获取 Etsy.Context");
    return [];
  }

  const rootData = ctx.data || {};
  const initial = rootData.initial_data || ctx.initial_data || null;

  if (!initial || !initial.orders || !initial.orders.orders_search) {
    console.warn("[Etsy Exporter] initial_data.orders.orders_search 不存在");
    return [];
  }

  const ordersSearch = initial.orders.orders_search;
  console.log("[Etsy Exporter] orders_search:", ordersSearch);

  const buyers = ordersSearch.buyers || [];
  const buyerMap = new Map();
  buyers.forEach((b) => {
    if (b && typeof b.buyer_id !== "undefined") {
      buyerMap.set(b.buyer_id, b);
    }
  });

  const rawOrders = ordersSearch.orders || [];
  console.log("[Etsy Exporter] rawOrders length:", rawOrders.length);

  const normalized = rawOrders.map((o) => normalizeOrder(o, buyerMap));

  // ⭐ 额外再从 DOM 里把 Private notes 补充进去（支持多条，不合并）
  attachPrivateNotesFromDom(normalized);

  return normalized;
}

/**
 * 从页面 <script> 里解析 Etsy.Context JSON
 */
function parseEtsyContextFromScripts() {
  const scripts = document.getElementsByTagName("script");
  const marker = "Etsy.Context=";

  for (const s of scripts) {
    const text = s.textContent || "";
    const idx = text.indexOf(marker);
    if (idx === -1) continue;

    let jsonText = text.slice(idx + marker.length).trim();
    if (jsonText.endsWith(";")) {
      jsonText = jsonText.slice(0, -1);
    }

    try {
      const ctx = JSON.parse(jsonText);
      console.log("[Etsy Exporter] parsed Etsy.Context from <script>");
      return ctx;
    } catch (e) {
      console.error("[Etsy Exporter] 解析 Etsy.Context JSON 失败：", e);
    }
  }

  return null;
}

/**
 * 从 DOM 中读取每个订单的多个 Private note(s)：
 * - 支持 data-tooltip="Private note" / "Private notes"
 * - 不合并，存到 private_notes 数组
 * - 同时展开到 private_note_1 ~ private_note_5 字段
 */
function attachPrivateNotesFromDom(orders) {
  if (!orders || !orders.length) return;

  const map = new Map();
  orders.forEach((o) => {
    if (o.order_id != null) {
      const id = String(o.order_id);
      // 初始化多备注结构
      if (!Array.isArray(o.private_notes)) {
        o.private_notes = [];
      }
      o.private_note_1 = o.private_note_1 || "";
      o.private_note_2 = o.private_note_2 || "";
      o.private_note_3 = o.private_note_3 || "";
      o.private_note_4 = o.private_note_4 || "";
      o.private_note_5 = o.private_note_5 || "";
      map.set(id, o);
    }
  });

  // 每一行订单（兼容 aria-label="orders" / "Orders"）
  const rows = document.querySelectorAll(
    'section[aria-label="orders"] .panel-body-row, section[aria-label="Orders"] .panel-body-row'
  );

  rows.forEach((row) => {
    // 1) 找这一行的订单 ID（checkbox 的 value/name 就是 order_id）
    const chk =
      row.querySelector('input[id^="order-checkbox-"]') ||
      row.querySelector('input[name][value]');
    if (!chk) return;

    const orderId = chk.value || chk.name;
    if (!orderId) return;

    const order = map.get(String(orderId));
    if (!order) return;

    // 2) 找“卖家备注”图标：可能是 Private note 或 Private notes
    const icons = row.querySelectorAll('[data-tooltip^="Private note"]');
    if (!icons.length) return;

    icons.forEach((icon) => {
      const flag = icon.closest(".flag");
      if (!flag) return;

      // 3) 同一个 flag 中可能有多条备注
      const spans = flag.querySelectorAll(
        '.flag-body span[data-test-id="unsanitize"]'
      );
      spans.forEach((span) => {
        const t = span.textContent.trim();
        if (t) {
          order.private_notes.push(t);
        }
      });
    });
  });

  // 4) 统一展开到 private_note_1 ~ private_note_5
  map.forEach((order) => {
    const arr = order.private_notes || [];
    order.private_note_1 = arr[0] || "";
    order.private_note_2 = arr[1] || "";
    order.private_note_3 = arr[2] || "";
    order.private_note_4 = arr[3] || "";
    order.private_note_5 = arr[4] || "";
  });
}

function normalizeOrder(order, buyerMap) {
  const buyer = buyerMap.get(order.buyer_id) || {};
  const fulfillment = order.fulfillment || {};
  const toAddr = fulfillment.to_address || {};
  const notes = order.notes || {};
  const payment = order.payment || {};
  const cost = payment.cost_breakdown || {};
  const totalCost = cost.total_cost || {};
  const itemsCost = cost.items_cost || {};
  const shippingCost = cost.shipping_cost || {};
  const taxCost = cost.tax_cost || {};
  const discountCost = cost.discount || {};

  const transactions = order.transactions || [];

  const itemTitles = [];
  const itemSkus = [];
  const itemQtys = [];
  const personalizations = [];

  transactions.forEach((tx) => {
    const product = tx.product || {};
    const title = htmlDecode(product.title || "");
    const qty = tx.quantity != null ? tx.quantity : "";
    itemTitles.push(`${title} x${qty}`);

    if (product.product_identifier) {
      itemSkus.push(product.product_identifier);
    }
    itemQtys.push(qty);

    const vars = tx.variations || [];
    vars.forEach((v) => {
      const val = htmlDecode(v.value || "");
      if (
        (v.property && /personal/i.test(v.property)) ||
        (v.value && /personal/i.test(v.value))
      ) {
        personalizations.push(val);
      }
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
  const addressFull = addressParts.join(", ");

  return {
    order_id: order.order_id || "",
    order_state_id: order.state_id || order.order_state_id || "",
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
    address_full: addressFull,

    is_gift: order.is_gift ? "YES" : "NO",
    // 礼物留言解码，避免 y&#39;all 这种
    gift_message: htmlDecode(order.gift_message || ""),

    items_text: itemTitles.join(" || "),
    items_sku_list: itemSkus.join(" || "),
    items_qty_list: itemQtys.join(" || "),
    personalization_list: personalizations.join(" || "),

    // 买家备注也解码
    note_from_buyer: htmlDecode(notes.note_from_buyer || ""),

    // 多条卖家备注：数组 + 展开字段（先初始化，后面 attachPrivateNotesFromDom 再填）
    private_notes: [],
    private_note_1: "",
    private_note_2: "",
    private_note_3: "",
    private_note_4: "",
    private_note_5: "",

    order_url: order.order_url || "",

    total_price:
      totalCost.formatted_value ||
      moneyFromCents(totalCost.value, totalCost.currency_code),
    items_price:
      itemsCost.formatted_value ||
      moneyFromCents(itemsCost.value, itemsCost.currency_code),
    shipping_price:
      shippingCost.formatted_value ||
      moneyFromCents(shippingCost.value, shippingCost.currency_code),
    tax_price:
      taxCost.formatted_value ||
      moneyFromCents(taxCost.value, taxCost.currency_code),
    discount_price:
      discountCost.formatted_value ||
      moneyFromCents(discountCost.value, discountCost.currency_code)
  };
}

function formatDate(tsSeconds) {
  if (!tsSeconds) return "";
  const d = new Date(tsSeconds * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function moneyFromCents(value, currencyCode) {
  if (typeof value !== "number") return "";
  const amount = (value / 100).toFixed(2);
  return currencyCode ? `${currencyCode} ${amount}` : amount;
}

/**
 * HTML 实体解码：把 y&#39;all 之类还原成 y'all
 */
function htmlDecode(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.innerHTML = str;
  return div.textContent || div.innerText || "";
}
