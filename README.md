# BOM Studio

从项目资料库选择项目，导入各专业 Excel BOM 模板，按模板板块生成并导出派生 BOM。线上架构为 GitHub + Cloudflare Pages Functions + Supabase。

## 架构

- Cloudflare Pages 托管页面和同源 `/api/*` 接口。
- Pages Functions 使用服务端环境变量访问 Supabase，浏览器不会获得 Supabase service-role 密钥。
- Supabase 保存项目资料库和最近 30 条生成记录。
- `APP_ACCESS_TOKEN` 为站点共享访问口令；生产环境建议在此基础上增加 Cloudflare Access 或企业 SSO。
- Excel 模板只在浏览器中处理。导出时直接修改原始模板压缩包中的目标单元格，以保留全部工作表、样式、列宽、行高、合并区域和打印设置。
- AI 差异分析由 `/api/ai` 转发到 DeepSeek（OpenAI 兼容协议）。API Key 只保存在 Cloudflare 服务端，浏览器不接触密钥。

## Supabase 初始化

1. 创建 Supabase 项目。
2. 在 SQL Editor 执行 [`supabase/schema.sql`](supabase/schema.sql)。
3. 从项目设置复制 Project URL 和 service-role key。service-role key 只能配置为 Cloudflare 密钥，不得写入 GitHub。

## 本地开发

1. 将 `.dev.vars.example` 复制为 `.dev.vars` 并填写三个变量。
2. 运行 `npm run dev`。
3. 直接打开 `index.html` 时，应用使用 IndexedDB 和 localStorage 作为离线回退。

## Cloudflare Pages 部署

1. 将本目录推送到 GitHub 仓库。
2. 在 Cloudflare Pages 选择该 GitHub 仓库。
3. Framework preset 选 `None`，Build command 留空，Build output directory 填 `.`。
4. 在 Pages 项目的 Settings → Variables and Secrets 中添加：
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`（Secret）
   - `APP_ACCESS_TOKEN`（Secret，建议使用至少 32 位随机值）
   - `AI_API_KEY`（Secret，DeepSeek API Key）
   - `AI_BASE_URL`（默认 `https://api.deepseek.com`，可不填）
   - `AI_MODEL`（默认 `deepseek-flash`，可不填）
   - `AI_MAX_TOKENS`（默认 `8192`，可不填）
5. 重新部署。首次打开站点时输入 `APP_ACCESS_TOKEN`。

仓库通过 `.gitignore` 排除了原始资料库 Excel、浏览器配置和本地预览图片，避免将业务资料公开到 GitHub。

## 使用流程

1. 在线站点首次使用时导入项目资料库 Excel；解析后的项目数据写入 Supabase。
2. 在项目资料库中选择项目并点击“选中该项目并用于派生”。
3. 导入 BOM 模板并选择工作表。
4. 生成、审核并导出 Excel 派生 BOM。
5. 需要 AI 辅助时，点击“AI 识别基础/派生差异”，核对差异面板后点击“应用 AI 建议到派生结果”。

## AI 差异分析

- 客户端按每批 40 行调用 `/api/ai`，避免单次输出超过模型上限；模板行较多时会自动分批并显示进度。
- 服务端默认使用 DeepSeek `deepseek-flash`，`temperature` 为 0，并开启 `response_format: json_object`。
- 提示词强制要求派生料号只能取自项目资料库字段，取不到则留空并说明原因，禁止编造料号。
- 若上游不支持 JSON 模式，或返回内容为空／被截断，服务端会自动降级重试一次，并在界面提示“已降级重试”。
- 导出 Excel 时，“新项目 BOM 物料”列写入派生结果；模板存在“是否更改”列时，按基础料号与派生料号的比对结果自动填写“是／否”。
- 模型除逐行判断外，还会返回 `extraRows`：项目资料库中存在、但模板物料行未覆盖的差异物料。
- “导出变更清单”按上表当前值重建导出文件：派生料号与基础料号一致的行会被删除，取不到料号的行保留供工程确认，模型识别出的模板外物料以“新增”追加在末尾；表头与样式沿用模板，数据区跨行合并改为逐行重复取值，避免删除锚点行后丢失分组信息。

## 自动匹配规则

字段匹配采用打分制（完全一致 100、表头以物料名开头 92、物料名以表头开头 88、表头含物料名 74、别名完全一致 90 等），低于 74 分不自动填入。另有两道硬性拦截：

- **属性列不参与匹配**：字段名含 命名／名称／型号／描述／规格／平台／制式／备注／亮度／色域 等属性词的列一律排除，避免把“机芯命名”“屏型号”这类名称当成料号写入 BOM。
- **组件类型冲突不匹配**：若字段名与物料名指向不同组件（如物料“电源板”对字段“电源线(自采)”），直接判定不匹配。

名称、来源与数量都带有可追溯标记（“来源字段”列），取不到可靠字段时保持空白并标为待确认，交由 AI 或工程师判断，不做静默错配。

## BOM 自检模块

- 页面入口：「BOM 自检」。导入 ALV/ERP 导出的 BOM 明细（需含“子件编码 / 子件描述”）与自检表模板（需含“检查内容 / 检查结果”，可选“物编 / 备注”）。
- 解析时按工作表实际起始行列定位表头，兼容从 B 列开始的模板；检查项与行号一一绑定，导出时写回原表。
- AI 逐条检查项输出 `codes`（命中的物编与描述，仅取自 BOM 真实编码）、`result`（YES / NO / PENDING）、`reason` 和 3~5 条 `steps`。
- 界面“分析过程”展示的是可复核的判断依据（检索词、命中编码、依据条款、结论），不是模型内部推理原文；证据不足时返回“待确认”，不猜测。
- 导出写回“物编 / 检查结果”，备注列仅在原本为空时补写判断依据，避免覆盖模板已有说明。
- 类别判定按编码前缀：02 主板、**02T TCON（不计入主芯片）**、06 遥控器、07 WIFI/蓝牙模块、41 线材、42 喇叭、46/47 连接器插座、49 电池、81 电源板。遥控器项只列 06，电池项只列 49，跨类别编码不得混入。
- 检查类别以主语归类：“电池（遥控器）”属于电池检查，只列 49；括号内仅为修饰对象。
- 主芯片专则：BOM 无独立芯片编码、仅有 02 主板时，判定“主芯片集成于主板”并标为通过，编码只列该主板，不把 02T（TCON）当芯片。
- “环保要求”类检查项自动跳过（不送模型），结果写 “/”；其余检查项未命中物料时，物编与结果均写 “/”，不使用空值。

## 规则边界

默认自动映射基于资料库字段名和常见电子物料别名，AI 在此基础上补充语义匹配。两者产出的都是可审核的派生草案，工程师仍需确认料号适用性、安规、版本、生效日期及替代关系；AI 未取到字段的行一律留空，不会填入推测料号。
