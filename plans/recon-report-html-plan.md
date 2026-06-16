# Russia-Recon 报告 HTML 美化计划

## 目标
将 russia-recon skill 输出的 Markdown 报告转换为**精美的 B2B 风格 HTML 报告**，适合直接发给客户或展示在 CRM 看板。

## 方案：Markdown → HTML 后处理

**不修改 skill 本身**（skill 保持输出 Markdown，这是它最擅长的），而是在 worker 的 `process_job()` 中增加一个后处理步骤。

```
worker 流程:

poll job → build_prompt → run_agent(hermes)
  → report.md (markdown)
  → render_report_html(report.md) → report.html  ← 新增
  → submitReconResult (report_path + html_path)
```

## 设计风格

- **配色**：深蓝 + 白底专业风（类似 McKinsey / BCG 报告风格）
- **布局**：单栏流式，头部摘要卡 + 分节内容
- **响应式**：适配手机端查看

## 报告结构

```
┌─────────────────────────────────────┐
│  [星级] 评分: XX/100                 │  ← 顶部横幅
│  公司名 | 域名                       │
│  制裁: ✅CLEAR / 🔴SANCTIONED       │
│  类型: ✅ 制造商 / ❌ 分销商          │
├─────────────────────────────────────┤
│  一句话结论                          │  ← 概要卡片
├─────────────────────────────────────┤
│  核心数据                            │  ← 两列网格
│  INN / OGRN / 法人 / 营收 / 员工     │
├─────────────────────────────────────┤
│  采购需求分析                        │  ← 表格
│  海关实证 + 产品推断                  │
├─────────────────────────────────────┤
│  联系人                              │  ← 名片样式
│  姓名 | 职位 | 邮箱 | 电话            │
├─────────────────────────────────────┤
│  评分明细                            │  ← 进度条
│  采购需求 ████████░░ 60/60           │
│  客户类型 ████████░░ 20/20           │
│  联系信息 █████░░░░░ 15/20           │
├─────────────────────────────────────┤
│  执行记录 (可折叠)                   │  ← details/summary
│  Step 1: ✓ 身份锚定                  │
│  Step 2: ✓ 政府采购                  │
│  Step 3: ✓ 制裁检查                  │
├─────────────────────────────────────┤
│  外联话术 & 数据质量声明              │
└─────────────────────────────────────┘
```

## 技术实现

### 文件结构（新增 2 个文件）

```
scripts/
├── recon_agent_worker.py       ← 修改：增加 render_report_html() 调用
└── report_renderer.py           ← 新增：Markdown → HTML 转换器

templates/
└── recon_report_template.html   ← 新增：HTML 模板（CSS + 骨架）
```

### report_renderer.py 核心函数

```python
def render_report_html(markdown_path: str, output_html: str) -> str:
    """
    读取 report.md → 解析结构化数据 → 渲染 HTML 模板 → 写 report.html
    返回 html 文件路径
    """
```

**解析逻辑**：
1. 从报告文本中提取各节内容（正则）
2. 提取 `## 客户数据摘要` YAML 块
3. 传入 Jinja2 或 f-string 模板
4. 输出 HTML

### 模板技术选型

| 方案 | 优点 | 缺点 | 推荐？ |
|------|------|------|:-----:|
| Jinja2 模板 | 成熟的模板引擎，条件渲染 | 需要依赖 | ✅ |
| f-string 拼接 | 零依赖 | 维护困难 | ❌ |
| 纯 CSS + 内联 HTML | 零依赖 | 模板代码量大 | ❌ |

**推荐**：Jinja2（Python 内置 / pip install 即用）

### 集成到 worker

在 `process_job()` 中 report.md 写入后增加：

```python
try:
    from scripts.report_renderer import render_report_html
    html_path = render_report_html(
        markdown_path=output_dir / "report.md",
        output_html=output_dir / "report.html"
    )
    result["report_html_path"] = html_path
except ImportError:
    pass  # 可选模块，失败不阻塞
```

## 工作量估算

| 任务 | 估计工时 |
|------|---------|
| 编写 HTML 模板（CSS 样式 ~200行） | 30min |
| 编写 report_renderer.py 解析 + 渲染 | 40min |
| 集成到 worker process_job() | 10min |
| 测试：用 turkov.md 跑一次生成 | 10min |
| **合计** | **~1.5h** |

## 是否需要新建 skill？

**不需要。** 这是 worker 侧的增强，不影响 russia-recon skill 本身。如果以后需要批量渲染历史报告，可以把 `report_renderer.py` 抽象成 CLI 工具：

```bash
python3 scripts/report_renderer.py --input report.md --output report.html
```
