// fields.js

// 所有可用字段（内部 key + 导出的列头）
const ALL_FIELDS = [
  { key: "order_id", label: "订单ID" },
  { key: "order_state_id", label: "订单号(展示)" },
  { key: "order_date", label: "下单日期" },

  { key: "buyer_name", label: "买家姓名" },
  { key: "buyer_username", label: "买家用户名" },
  { key: "buyer_email", label: "买家邮箱" },

  { key: "shipping_name", label: "收件人姓名" },
  { key: "shipping_country", label: "国家" },
  { key: "shipping_state", label: "州/省" },
  { key: "shipping_city", label: "城市" },
  { key: "shipping_zip", label: "邮编" },
  { key: "shipping_phone", label: "电话" },
  { key: "address_full", label: "完整地址" },

  { key: "is_gift", label: "是否礼物" },
  { key: "gift_message", label: "礼物留言" },

  { key: "items_text", label: "商品明细" },
  { key: "items_sku_list", label: "SKU列表" },
  { key: "items_qty_list", label: "数量列表" },
  { key: "personalization_list", label: "个性化内容列表" },

  { key: "note_from_buyer", label: "买家备注" },

  // 多条卖家备注展开字段（方案 A）
  { key: "private_note_1", label: "卖家备注1" },
  { key: "private_note_2", label: "卖家备注2" },
  { key: "private_note_3", label: "卖家备注3" },
  { key: "private_note_4", label: "卖家备注4" },
  { key: "private_note_5", label: "卖家备注5" },

  { key: "total_price", label: "订单总金额" },
  { key: "items_price", label: "商品金额" },
  { key: "shipping_price", label: "运费" },
  { key: "tax_price", label: "税费" },
  { key: "discount_price", label: "折扣" },

  { key: "order_url", label: "订单链接" }
];

// 默认导出字段顺序
const DEFAULT_FIELD_KEYS = [
  "order_id",
  "order_state_id",
  "order_date",
  "buyer_name",
  "buyer_email",
  "shipping_name",
  "address_full",
  "items_text",
  "note_from_buyer",
  "private_note_1", // 默认带第一条卖家备注
  "total_price"
];

// 浏览器环境挂到 window，方便 dashboard 调用
if (typeof window !== "undefined") {
  window.ALL_FIELDS = ALL_FIELDS;
  window.DEFAULT_FIELD_KEYS = DEFAULT_FIELD_KEYS;
}
