# Agent Task: Generate product_info.json

## 任务
读取 `{product_dir}/processed/info.json`，基于产品信息**改写**生成 `{product_dir}/product_info.json`。

**不是复制，不是截断，是改写（rewriting）** —— 用更精炼的语言表达相同的核心信息。

## 输入格式（processed/info.json）

```json
{
  "product_info": { "name": "...", "sku": "...", "category": "...", "brand": "VEXRIM" },
  "title": { "full": "完整标题", "product_type": "..." },
  "compatibility": { "vehicles": [{"year_start": 2013, "year_end": 2017, "make": "Honda", "model": "Accord", "engine": "2.4L"}] },
  "oe_numbers": ["OE号1", "OE号2"],
  "specifications": [{"label": "Voltage", "value": "12V"}],
  "features": [{"title": "卖点标题", "description": "卖点描述", "icon": "..."}],
  "warranty": "..."
}
```

## 输出格式（product_info.json）

```json
{
  "product_info": { "name": "产品名称（英文）", "category": "品类" },
  "hero": { "headline": "大标题（全大写）", "subheadline": "副标题" },
  "features": {
    "feature_1": { "title": "...", "description": "..." },
    "feature_2": { "title": "...", "description": "..." },
    "feature_3": { "title": "...", "description": "..." },
    "feature_4": { "title": "...", "description": "..." }
  },
  "vehicle_fitment": { "rows": [["Year", "Make", "Model", "Engine"]] },
  "oe_part_numbers": ["..."],
  "specifications": [{"label": "...", "value": "..."}],
  "detail_callouts": { "left_top": "...", "left_middle": "...", "left_bottom": "..." }
}
```

## 字符限制（绝对不能超）

| 字段 | 最大字符数 | 超限后果 |
|------|-----------|---------|
| `hero.headline` | **30** | 会导致 01 Hero 标题换行或溢出 |
| `hero.subheadline` | **50** | 会导致副标题被挤压 |
| `features.feature_X.title` | **20** | 4格特性块标题必须短，否则整体缩小 |
| `features.feature_X.description` | **40** | 特性块描述，超了会导致 AI 缩小字体到 <12px |
| `vehicle_fitment.rows` 每格 | **25** | 表格列宽有限 |
| `specifications.label` | **20** | 参数标签 |
| `specifications.value` | **20** | 参数值 |
| `detail_callouts.*` | **15** | 04 三面板标签 |

## 核心规则

**所有内容必须是英文** — Amazon 面向英语市场，禁止出现中文。包括但不限于：表头、标签、描述、标题。

## 改写规则（Rewriting Rules）

**不要复制长句，要重写短句。保留核心信息，删除冗余修饰。**

### Headline（≤30 字符）
- 从 `title.full` 提取核心产品名
- 去掉 SKU、OE号、"Compatible with"、"Fits" 等前缀
- 全大写，简洁有力
- **例子**：
  - `Oxygen Sensors Upstream Downstream O2 Sensor 4-Piece Set – Fits...` → `OXYGEN SENSOR`
  - `Tilt Steering Column Upper Bearing Kit Compatible with Chevy...` → `STEERING BEARING KIT`
  - `New Starter Compatible with Honda Accord & CRV Starter, Fits...` → `STARTER MOTOR`

### Subheadline（≤50 字符）
- 一句话价值主张，不是功能罗列
- **例子**：
  - `This VEXRIM oxygen sensor set is precision-engineered to fit 2013 Infiniti JX35...` → `Optimize Engine Performance and Fuel Efficiency.`
  - `Built for Reliable Starts. Engineered to Last.`（好的例子）

### Feature Title（≤20 字符）
- 2-4 个词，全大写
- 用名词短语，不用完整句
- **例子**：
  - `Direct Vehicle Compatibility – 4-Piece` → `DIRECT FIT`
  - `Durable & Heat-Resistant Construction` → `HEAT RESISTANT`
  - `Hassle-Free Plug-and-Play Installation` → `EASY INSTALL`

### Feature Description（≤40 字符）
- 一个短句，说清楚核心利益
- 删除"This VEXRIM..."、"is designed to..."等冗余开头
- **例子**：
  - `This VEXRIM oxygen sensor set is precision-engineered to fit` → `Precision fit for direct replacement.`
  - `Crafted from premium-grade, heat-resistant and corrosion-proof materials. Built to withstand extreme temperatures...` → `Heat-resistant materials for durability.`
  - `Featuring a direct fit design with factory-matched connectors and mounting styles, these Oxygen Sensors require no modifications...` → `Plug-and-play with OEM connectors.`

### Vehicle Fitment
- 从 `compatibility.vehicles` 提取年份、品牌、车型、引擎
- 去重，最多 6 行
- 年份格式：`2013-2017` 或 `2013`

### OE Part Numbers
- 从 `oe_numbers` 取前 8 个
- 只保留真正的零件号（排除品牌名、年份）

### Specifications
- 保留核心参数：Voltage、Power、Rotation、Teeth、Condition 等
- label 和 value 都要 ≤20 字符

### Detail Callouts（≤15 字符）
- 按品类使用固定映射：
  - starter_motor: `MOUNTING EAR`, `DRIVE GEAR`, `SOLENOID`
  - alternator: `REGULATOR`, `ROTOR`, `STATOR`
  - oxygen_sensor: `SENSOR BODY`, `THREAD`, `CONNECTOR`
  - ignition_coil: `SPARK TOWER`, `COIL`, `CONNECTOR`
  - 其他: `BODY`, `CONNECTOR`, `MOUNTING`

## 检查清单

生成后逐条检查：
- [ ] `hero.headline` ≤30 字符，全大写
- [ ] `hero.subheadline` ≤50 字符
- [ ] `features` 恰好 4 条
- [ ] 每个 `feature.title` ≤20 字符，全大写
- [ ] 每个 `feature.description` ≤40 字符
- [ ] `vehicle_fitment.rows` 去重，年份正确
- [ ] `oe_part_numbers` 无品牌名混入
- [ ] `specifications` label/value 各 ≤20 字符
- [ ] `detail_callouts` 各 ≤15 字符
- [ ] 所有文字真实，不可编造零件号/年份
