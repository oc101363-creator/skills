# Product Info Spec

Agent 手写的产品信息标准格式。所有 A+ 和主图的文字内容来源。

## 文件位置

`{product_dir}/product_info.json`

## 字段规范

```json
{
  "product_info": {
    "name": "产品名称（英文）",
    "category": "品类（如 Starter Motor / Ignition Coil / Oxygen Sensor）"
  },
  "hero": {
    "headline": "01 主标题（大写，如 STARTER MOTOR）",
    "subheadline": "01 副标题（简短描述）"
  },
  "features": {
    "feature_1": { "title": "卖点标题", "description": "卖点描述" },
    "feature_2": { "title": "...", "description": "..." },
    "feature_3": { "title": "...", "description": "..." },
    "feature_4": { "title": "...", "description": "..." }
  },
  "vehicle_fitment": {
    "rows": [
      ["Year", "Make", "Model", "Notes"],
      ["2013-2017", "Honda", "Accord 2.4L", ""]
    ]
  },
  "oe_part_numbers": ["31200-5A2-A51", "31200-5A2-A52"],
  "specifications": [
    { "label": "Voltage", "value": "12V" },
    { "label": "Power", "value": "1.6kW" }
  ],
  "detail_callouts": {
    "left_top": "左上面板标签",
    "left_middle": "左中面板标签",
    "left_bottom": "左下面板标签"
  }
}
```

## A+ 字段映射（硬编码）

| 输出图 | 数据字段 | 说明 |
|--------|---------|------|
| 01 Hero headline | `hero.headline` | 主标题 |
| 01 Hero subheadline | `hero.subheadline` | 副标题 |
| 01 Hero features | `features.feature_1~4` | 四格卖点 |
| 01 Hero vehicle scene | `vehicle_fitment.rows[0][1]` | 品牌推断车型背景 |
| 02 Fitment rows | `vehicle_fitment.rows` | 适配车型表 |
| 02 OE numbers | `oe_part_numbers` | OE 替换号 |
| 02 Specs | `specifications` | 技术参数 |
| 04 Detail labels | `detail_callouts` | 三面板标签 |

## 主图字段映射（硬编码）

| 输出图 | 数据字段 |
|--------|---------|
| 02 产品介绍 | `hero.headline` + `features` |
| 03 兼容性 | `vehicle_fitment` + `oe_part_numbers` |
| 04 技术规格 | `specifications` |
| 06 对比图 | `features` |

## 字符限制（Mobile 1024×768 可读性约束）

所有字段在写入时必须控制长度，否则 Mobile 端文字会过小（< 12px）。

| 字段 | 最大字符数 | 说明 |
|------|-----------|------|
| `hero.headline` | 30 | 大标题，太长会挤压布局 |
| `hero.subheadline` | 50 | 副标题 |
| `features.feature_X.title` | 20 | 卖点标题，超长会换行或缩小 |
| `features.feature_X.description` | 40 | 卖点描述，严格限制 |
| `vehicle_fitment.rows` 每格 | 25 | 表格列宽有限 |
| `specifications.label` | 20 | 参数标签 |
| `specifications.value` | 20 | 参数值 |
| `detail_callouts.*` | 15 | 04 三面板标签 |

超限内容必须截断或改写，不可原样写入。

## 注意事项

- **所有文字必须是英文**，不可出现中文（Amazon 面向英语市场）
- 所有文字 verbatim 写入，不可编造（在字符限制内）
- `vehicle_fitment.rows` 第一列是年份范围，第二列是品牌（用于推断车型背景）
- `features` 至少 4 条，最多 4 条（A+ 01 固定四格）
- `specifications` 至少包含 Voltage，其他按需补充
