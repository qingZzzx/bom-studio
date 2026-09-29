# BOM Studio

从项目资料库选择项目，导入各专业 Excel BOM 模板，按模板板块生成并导出派生 BOM。线上架构为 GitHub + Cloudflare Pages Functions + Supabase。

## 架构

- Cloudflare Pages 托管页面和同源 `/api/*` 接口。
- Pages Functions 使用服务端环境变量访问 Supabase，浏览器不会获得 Supabase service-role 密钥。
- Supabase 保存项目资料库和最近 30 条生成记录。
- `APP_ACCESS_TOKEN` 为站点共享访问口令；生产环境建议在此基础上增加 Cloudflare Access 或企业 SSO。
- Excel 模板只在浏览器中处理。导出时直接修改原始模板压缩包中的目标单元格，以保留全部工作表、样式、列宽、行高、合并区域和打印设置。

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
5. 重新部署。首次打开站点时输入 `APP_ACCESS_TOKEN`。

仓库通过 `.gitignore` 排除了原始资料库 Excel、浏览器配置和本地预览图片，避免将业务资料公开到 GitHub。

## 使用流程

1. 在线站点首次使用时导入项目资料库 Excel；解析后的项目数据写入 Supabase。
2. 在项目资料库中选择项目并点击“选中该项目并用于派生”。
3. 导入 BOM 模板并选择工作表。
4. 生成、审核并导出 Excel 派生 BOM。

## 规则边界

自动映射基于资料库字段名和常见电子物料别名。结果是可审核的派生草案，工程师仍需确认料号适用性、安规、版本、生效日期及替代关系。
