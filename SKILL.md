---
name: vexrim-amazon-workflow
description: |
  Use this skill whenever the user is working on Amazon product images for VEXRIM brand automotive parts (starter motors, alternators, wiper motors, oxygen sensors, etc.). Trigger when the user mentions: "主图" (main images), "A+" (A+ content), "精修" (photo refinement), "工厂图" (factory photos), "图片素材" (image materials), "亚马逊图片" (Amazon images), "白底图" (white background), "去背景" (remove background), "产品图制作" (product image creation), or any workflow involving numbered factory photos (1.jpg~7.jpg), template-based image generation, or batch image processing for e-commerce listings. Also trigger when the user asks about photo classification, template mapping specs, info.json normalization, or the directory structure for product image pipelines. Do NOT trigger for general image editing requests unrelated to Amazon/e-commerce product listings.
---

# VEXRIM Amazon 产品图片工作流 Skill

本 skill 指导 Claude 完成 VEXRIM 品牌 Amazon 汽配产品的完整图片制作流程，包括7张主图（1:1正方形）和5张A+海报（3:2横版）。

## 核心原则

1. **数据驱动**：`product_info.json` 是 A+ 的唯一文字来源，所有图片文字必须 verbatim 来自其中
2. **模板映射**：照片编号 → 输出图的映射关系由固定的 spec 文件定义，不硬编码在脚本中
3. **先 product_info 后图片**：先手写/审核 `product_info.json` 确认数据正确，再调用 API 生成图片
4. **ZERO HALLUCINATION**：零件号、车型年份、技术参数必须 verbatim 复制

## 目录结构规范

每个产品的标准目录结构：

```
{产品名}/
├── 图片素材/              ← 工厂原始图（1.jpg ~ N.jpg）+ 原始 info.json
├── processed/             ← 精修后的白底图（1.png/01.png ~ N.png）
├── product_info.json      ← Agent 手写（A+ 唯一文字来源）
└── A+/                    ← 5张 A+ 海报输出
    ├── pc/                ← PC 端（1464×600）
    │   ├── 01.png
    │   ├── 02.png
    │   ├── 03.png（条件）
    │   ├── 04.png
    │   └── 05.png
    └── mobile/            ← Mobile 端（1024×768）
        ├── 01.png
        ├── 02.png
        ├── 03.png（条件）
        ├── 04.png
        └── 05.png
```

## 工厂照片通用逻辑

所有品类共用一套编号规则，**不按起动机/传感器等品类区分固定拍摄角度**：

| 编号 | 类型 | 内容 | 主图用途 | A+用途 |
|------|------|------|---------|--------|
| 1.jpg | 全身照 | 产品整体外观（任意角度） | 01白底主图、02产品介绍、04技术规格、06对比图 | 01 Hero |
| 2.jpg | 全身照 | 另一角度整体外观 | 02辅助图 | — |
| 3.jpg | 全身照 | 第三个角度整体外观 | 02辅助图 | — |
| ≥4.jpg | 细节图 | 任意部位特写（不限部位、不限数量） | 05细节特写 | 04 细节图素材 |

**核心规则**：
- **1-3 号 = 全身照**：任意角度的产品整体图，用于展示外观和作为主图素材
- **≥4 号 = 细节图**：任意部位的特写图，数量不限，全部用于 04 细节展示和 05 细节特写
- **04 面板自动切换**：`processed/` 中名字 ≥4 的精修图 ≥4 张 → 四面板（`04_2.png`）；<4 张 → 三面板（`04.png`）
- **03 条件复制**：仅当细节图 ≥4 张（即使用四面板）时，才复制 03 固定模板；否则不放 03

> **Agent 不需要识别图片内容**，1~7 的命名已经是约定。直接按编号映射即可。

## 输出映射

### 主图 7张（1:1 正方形）

| 输出 | 名称 | 类型 | 素材来源 | 数据来源 |
|------|------|------|---------|---------|
| 01.jpg | 白底主图 | copy | processed/1.jpg | — |
| 02.jpg | 产品介绍 | API | 模板 + 1.jpg + 3.jpg | info.features |
| 03.jpg | 兼容性信息 | API | 模板 | info.compatibility + info.oe_numbers |
| 04.jpg | 技术规格 | API | 模板 + 1.jpg | info.specifications |
| 05.jpg | 细节特写 | API | 模板 + 4+5+6+7.jpg | — |
| 06.jpg | 对比图 | API | 模板 + 1.jpg | info.features |
| 07.jpg | 品牌服务 | copy | 固定模板 | — |

### A+ 5张（3:2 横版）

| 输出 | 名称 | 类型 | 素材来源 | 数据来源 |
|------|------|------|---------|---------|
| 01.png | Hero 主图 | API | 1.jpg | info.title + info.features |
| 02.png | Fitment & Specs | API | — | info.compatibility + info.oe_numbers + info.specifications |
| 03.png | Why Choose Us | copy（条件） | 固定模板（≥4 细节图时放） | — |
| 04.png | Detail Closeups | API | processed/ 中所有名字 ≥4 的图 | — |
| 05.png | Brand Endframe | copy | 固定模板 | — |

**04 面板自动切换规则（硬编码，不可改）**：
- `processed/` 中名字 ≥4 的精修图 ≥4 张 → 使用四面板模板 `04_2.png`，取前 4 张作为素材
- `processed/` 中名字 ≥4 的精修图 <4 张 → 使用三面板模板 `04.png`，取前 3 张作为素材
- 模板文件位于 `templates/A_Plus/PC/04_2.png` 和 `templates/A_Plus/moblie/04_2.png`

## 工作流程（Step by Step）

### Phase 0: 素材准备

1. 在飞书多维表格创建产品记录
2. 从飞书素材表下载工厂照片到 `图片素材/`（命名为 1.jpg ~ 7.jpg）
3. 从 Amazon 链接抓取原始 `info.json`

```bash
# 下载工厂素材图（从飞书多维表格产品素材表）
python3 scripts/download_material_images.py --output-dir ./products/xxx/图片素材

# 抓取 Amazon 产品信息（单链接 / 从 Bitable 批量）
python3 scripts/fetch_amazon_product_info.py --urls "https://www.amazon.com/dp/XXXXX" --output-dir ./products/xxx
python3 scripts/fetch_amazon_product_info.py --from-bitable --output-dir ./products/xxx

# 抓取竞品参考图（可选）
python3 scripts/fetch_amazon_images.py --from-bitable --output-dir ./competitors
```

> **环境变量**：以上 Python 脚本依赖 `lark-cli`，配置可通过环境变量覆盖：
> - `LARK_CLI_PATH` — lark-cli 二进制路径
> - `LARK_BASE_TOKEN` — 飞书多维表格 base token
> - `LARK_PROD_TABLE` / `LARK_MAT_TABLE` / `LARK_REF_TABLE` — 各表 ID

### Phase 1: 精修（Refinement）

```bash
# 单产品
node scripts/Refinement.mjs ./products/xxx/图片素材

# 批量（5并发）
node scripts/batch_refinement_parallel.mjs ./products
```

**输入**：`图片素材/1.jpg ~ 7.jpg`
**输出**：`processed/1.jpg ~ 7.jpg`（白底精修图）

### Phase 2: 标准化 + 手写 `product_info.json`

#### Step 2a: Agent 手写 `processed/info.json`

**输入**：`图片素材/info.json`（从 Amazon 抓取的原始信息）
**输出**：`processed/info.json`（标准化后的参考信息，Agent 手写）

Agent 读取原始 `图片素材/info.json`，人工整理后写入 `processed/info.json`：
- `product_info` — SKU、品类、品牌（品牌固定为 `"VEXRIM"`）
- `title.full` — 完整标题
- `compatibility.vehicles` — 车型适配数组
- `oe_numbers` — OE替换号数组（排除品牌名、车型名、年份）
- `specifications` — 技术参数数组
- `features` — 卖点数组（title + description + icon）
- `warranty` — 强制统一为 `"1 year"`（VEXRIM 只提供 12 个月保修）

原始信息保留在 `图片素材/info.json`，不额外备份。

#### Step 2b: 手写 `product_info.json`（A+ 唯一文字来源）

这是最关键的一步。所有 A+ 图片上的文字都硬编码读取自 `product_info.json`，必须手写并逐条检查。

**输入**：`processed/info.json`（标准化后的参考信息）
**输出**：`{产品名}/product_info.json`

**手写规范**（见 `references/product_info_spec.md`）：

```json
{
  "product_info": { "name": "...", "category": "..." },
  "hero": { "headline": "...", "subheadline": "..." },
  "features": { "feature_1": { "title": "...", "description": "..." }, ... },
  "vehicle_fitment": { "rows": [["年份", "品牌", "车型", "备注"], ...] },
  "oe_part_numbers": ["..."],
  "specifications": [{ "label": "...", "value": "..." }],
  "detail_callouts": { "left_top": "...", "left_middle": "...", "left_bottom": "..." }
}
```

**字符限制（Mobile 1024×768 可读性约束，超限会导致文字 < 12px）**：

| 字段 | 最大字符数 | 说明 |
|------|-----------|------|
| `hero.headline` | **30** | 大标题，太长会挤压布局 |
| `hero.subheadline` | **50** | 副标题 |
| `features.feature_X.title` | **20** | 卖点标题，超长会换行或缩小 |
| `features.feature_X.description` | **40** | 卖点描述，严格限制 |
| `vehicle_fitment.rows` 每格 | **25** | 表格列宽有限 |
| `specifications.label` | **20** | 参数标签 |
| `specifications.value` | **20** | 参数值 |
| `detail_callouts.*` | **15** | 04 三面板标签 |

超限内容必须截断或改写，不可原样写入。

**必须检查**：
- [ ] `features` 至少 4 条有效卖点
- [ ] `vehicle_fitment.rows` 不为空，年份正确
- [ ] `oe_part_numbers` 不为空，无品牌名混入
- [ ] `specifications` 包含 Voltage 等关键参数
- [ ] **所有字段字符数在限制范围内**
- [ ] 所有文字 verbatim 正确，不可编造

### Phase 3: 生成主图 Specs（关键检查步骤）

```bash
node scripts/generate_main_specs.mjs ./products/xxx
```

**必须检查**生成的 `主图_specs.json`：
- [ ] photo_refs 路径有效（非 null）
- [ ] 文字内容与 `product_info.json` 一致

### Phase 4: 生成 A+ 图片（API 调用）

```bash
# 单产品
node scripts/poster_a_plus_generator.mjs ./products/xxx

# 只跑某几张（比如只重跑 01 和 04）
node scripts/poster_a_plus_generator.mjs ./products/xxx --only=01,04

# 批量（5 并发）
node scripts/batch_a_plus.mjs ./products/batch_dir 5
```

**输入**：`product_info.json` + `processed/` 精修图
**输出**：`A+/pc/` 和 `A+/mobile/` 各 5 张图

| 输出图 | 数据来源 | 素材来源 | 类型 |
|--------|---------|---------|------|
| 01.png | `hero` + `features` + `vehicle_fitment` | `processed/01.png` | API 生成 |
| 02.png | `vehicle_fitment` + `oe_part_numbers` + `specifications` | — | API 生成（纯文字） |
| 03.png | — | 固定模板 | **条件复制**（仅细节图≥4时放） |
| 04.png | `detail_callouts` | `processed/` 中名字≥4的图 | API 生成 |
| 05.png | — | 固定模板 | 复制 |

> **04 面板自动切换**：`processed/` 中名字≥4的图 ≥4 张 → 四面板 `04_2.png`；<4 张 → 三面板 `04.png`

**主图**（读 `主图_specs.json`）：
```bash
node scripts/generate_main_images.mjs ./products/xxx
```

**A+**（读 `product_info.json`，硬编码字段映射）：
```bash
node scripts/poster_a_plus_generator.mjs ./products/xxx
```

A+ 字段映射（硬编码，不经过中间 spec）：
| 输出图 | 数据源字段 | 素材来源 | 备注 |
|--------|-----------|---------|------|
| 01 Hero | `hero.headline` / `hero.subheadline` / `features` / `vehicle_fitment.rows[0][1]` | `processed/` 中 1.jpg 或 01.jpg | — |
| 02 Fitment | `vehicle_fitment.rows` / `oe_part_numbers` / `specifications` | — | 纯文字图 |
| 03 Why Choose Us | — | 固定模板 | **仅当细节图 ≥4 张时复制，否则不放** |
| 04 Detail | `detail_callouts` | `processed/` 中所有名字 ≥4 的图 | ≥4 张 → 四面板 `04_2.png`；<4 张 → 三面板 `04.png` |
| 05 Brand Endframe | — | 固定模板 | — |

**批量 A+**（5 并发）：
```bash
node scripts/batch_a_plus.mjs ./products/batch_dir 5
```

## Skill 目录结构

本 skill 为自包含目录，可直接供其他 agent 调用：

```
vexrim-amazon-workflow/
├── SKILL.md                              ← 本文件
├── .env                                  ← API 密钥（需手动创建）
├── scripts/                              ← 全部可执行脚本
│   ├── Refinement.mjs                    ← 单产品精修
│   ├── batch_refinement_parallel.mjs     ← 批量精修（5并发）
│   ├── generate_main_specs.mjs           ← 生成 主图_specs.json
│   ├── generate_main_images.mjs          ← 单产品7张主图生成
│   ├── poster_a_plus_generator.mjs       ← A+ 海报生成（读 product_info.json）
│   ├── batch_a_plus.mjs                  ← 批量A+生成（5并发）
│   ├── batch_generate.mjs                ← 批量主图生成（3并发）
│   ├── pipeline.mjs                      ← 统一流水线入口
│   ├── fetch_amazon_product_info.py      ← 抓取 Amazon 产品信息 → info.json
│   ├── download_material_images.py       ← 从飞书素材表下载工厂照片
│   └── fetch_amazon_images.py            ← 抓取竞品参考图（可选）
├── references/                           ← Spec / 映射规则（只读配置）
│   ├── product_info_spec.md              ← product_info.json 字段规范
│   ├── photo_classifier_spec.json        ← 工厂照片通用编号规则
│   ├── A_Plus_template_mapping_spec.json ← A+ 模板映射规则
│   └── 主图_template_mapping_spec.json
├── templates/
│   ├── main_image/                       ← 主图 AI 填充模板（02~06）
│   │   ├── 02_产品介绍_模板_*.png
│   │   ├── 03_兼容性信息_模板_*.png
│   │   ├── 04_技术规格_模板_*.png
│   │   ├── 05_细节特写_模板_*.png
│   │   └── 06_对比图_模板_*.png
│   └── A_Plus/                           ← A+ 固定模板（PC + Mobile）
│       ├── PC/
│       │   ├── 01.png                    ← 01 Hero 布局模板
│       │   ├── 02.png                    ← 02 参数表布局模板
│       │   ├── 03.png                    ← 03 固定模板
│       │   ├── 04.png                    ← 04 三面板布局模板
│       │   ├── 04_2.png                  ← 04 四面板布局模板
│       │   └── 05.png                    ← 05 固定模板
│       └── moblie/
│           ├── 01.png
│           ├── 02.png
│           ├── 03.png
│           ├── 04.png
│           ├── 04_2.png
│           └── 05.png
```

> **Agent 使用方式**：进入 skill 根目录后，直接运行 `node scripts/<script>.mjs <args>` 或 `python3 scripts/<script>.py <args>`。所有脚本内部路径已配置为相对 skill 根目录，无需额外修改。

## Spec 文件清单

| Spec 文件 | 位置 | 内容 |
|-----------|------|------|
| `product_info_spec.md` | `references/` | product_info.json 字段规范（A+和主图文字来源） |
| `generate_product_info_agent_prompt.md` | `references/` | Agent 从原始 info 改写生成 product_info.json 的 prompt |
| `photo_classifier_spec.json` | `references/` | 工厂照片通用编号规则（1-3 全身照，≥4 细节图） |
| `A_Plus_template_mapping_spec.json` | `references/` | A+ 模板映射与面板切换规则 |
| `主图_template_mapping_spec.json` | `references/` | 主图01~07的素材映射与占位符填充规则 |

## 品牌规范

| 项目 | 主图 | A+ |
|------|------|-----|
| Logo | VEXRIM logo（左上角） | VEXRIM logo（左上角） |
| 主色 | `#F37021`（Hermès 橙） | `#F37021`（Hermès 橙） |
| 背景 | `#FFFFFF` 纯白 | `#0a0a0a` ~ `#111111` 深黑 |
| 标题 | 白色，无衬线粗体 | 白色，极粗大字号 |
| 尺寸 | 1:1 正方形，2K | 3:2 横版，2K |

## API 参数

- **接口**：`https://api.apimart.ai/v1/images/generations`
- **模型**：`gpt-image-2`
- **认证**：`Authorization: Bearer {APIMART_API_KEY}`（从 `.env` 读取）
- **主图**：`size: "1:1"`, `resolution: "2k"`
- **A+**：`size: "3:2"`, `resolution: "2k"`

## 常见问题

**Q：精修后产品外观变了？**
A：检查原始图质量。Refinement.mjs 的 prompt 约束了 ZERO HALLUCINATION，但工厂图背景太杂乱时 AI 可能过度发挥。

**Q： specs.json 中 photo_refs 为 null？**
A：表示对应编号的工厂图缺失。05/04 等可以容忍1-2张缺失，但 01/02 的 1.jpg 必须存在。

**Q：02 的 oe_numbers 混入品牌名？**
A：手写 product_info.json 时检查 `oe_part_numbers`，排除品牌名、车型名、年份。只保留真正的零件号。

**Q：API 超时/524？**
A：降低 resolution 到 "2k"，减少并发，或单独重试失败的产品。
