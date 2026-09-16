# beads-ai 微信云函数

小程序先把图片上传到当前微信云环境并换取短期下载地址，云函数校验地址后读取图片、调用 DeepSeek Vision，小程序随后删除临时图片。DeepSeek Key 只保存在云函数环境变量中，不会进入小程序包或 Git。

## 首次部署

1. 使用 AppID `wx2959d9a12d0dcc97` 打开项目，在微信开发者工具中开通云开发并创建环境。
2. 如未设置默认环境，把环境 ID 填入 `miniprogram/config/cloud.js` 的 `cloudEnvId`。
3. 在“云开发 → 云函数”中上传并部署 `beads-ai`，选择“云端安装依赖”。
4. 将云函数超时时间设置为 `120 秒`，内存建议至少 `256 MB`。
5. 在云函数环境变量中添加：
   - `DEEPSEEK_API_KEY`：必填。
   - `DEEPSEEK_BASE_URL`：可选，默认 `https://api.deepseek.com`。
   - `DEEPSEEK_VISION_MODEL`：可选，默认 `deepseek-flash`（DeepSeek-V4.1-Flash）。
   - `DEEPSEEK_TIMEOUT_MS`：可选，默认 `90000`。

6. 建议给云存储目录 `ai-inputs/` 配置 1 天自动删除的生命周期规则，清理由于用户强制关闭小程序而未能即时删除的临时文件。

云开发调用不经过 `api.luckwork.ltd`，不需要配置小程序 `request` 或 `uploadFile` 合法域名，也不受该域名 ICP 备案阻断影响。
