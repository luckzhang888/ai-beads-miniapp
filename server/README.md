# AI Beads Vision Server（第一阶段）

小程序只把图片上传到本服务；DeepSeek Key 只保存在服务器。DeepSeek 返回图片类型、网格尺寸和归一化四角，服务端校验后交给小程序；格内采样、MARD 295 色匹配及豆数统计仍在小程序本地完成。图片在请求期间保存在内存，不写入磁盘。无网格照片进入现有照片转图纸流程；AI 失败时用户可手动选择本地识别。

## 启动

要求 Node.js 18.19+。在 `server/` 目录执行：

```bash
npm ci
cp .env.example .env
# 用安全的编辑方式在服务器本机填写 DEEPSEEK_API_KEY，勿提交 .env
npm start
```

默认只监听 `127.0.0.1:3001`，需由 Nginx 等 HTTPS 反向代理对外提供服务。`DEEPSEEK_BASE_URL` 默认为 `https://api.deepseek.com`，`DEEPSEEK_VISION_MODEL` 默认为 `deepseek-v4-flash-vision-exp`。Key 缺失时健康检查可用，但识别接口会返回 `AI_NOT_CONFIGURED`，不会伪装成 AI 结果。生产配置中的 Key 只保存在服务器 `/home/luck/ai-beads-server/.env`，不提交 Git。

## 验证

```bash
npm test
curl -i http://127.0.0.1:3001/healthz
curl -i -F image=@/path/to/your-owned-test-chart.png -F mode=auto -F expectedSize=80 -F palette=MARD http://127.0.0.1:3001/api/v1/beads/analyze
npm run smoke:live
```

接口为 `POST /api/v1/beads/analyze`，图片上限 10 MB，支持 JPEG、PNG、WebP、GIF。`/healthz` 不调用 DeepSeek。只有在配置有效 Key 后，第三条命令才是完整真实 AI 请求；测试图片应使用自有或获授权素材。`smoke:live` 则在内存中生成自制 8×8 网格并发起一次真实 DeepSeek 请求，可能产生 API 费用，不会由 CI 自动运行。服务端超时默认 90 秒，小程序上传超时 120 秒。可用 `DEEPSEEK_TIMEOUT_MS` 调整服务端超时，最大 120 秒。

## 当前服务器部署

`api.luckwork.ltd` 的 A 记录指向 `106.55.36.21`。小程序的 HTTPS 源地址已写入 [`miniprogram/config/api.js`](../miniprogram/config/api.js)。服务器通过 `ai-beads.service` 常驻运行本项目，独立的 Nginx `ai-beads-api` 站点将 HTTPS 请求代理到 `127.0.0.1:3001`，不修改已有的 `remote-xiangqi` 站点。相关模板在 [`deploy/`](deploy/)；`nginx-api-http.conf` 仅用于首次申请证书，证书签发后使用 `nginx-api.conf`。证书由 Certbot webroot 模式签发，`certbot.timer` 定期续期，`certbot-reload-nginx.sh` 在续期后重载 Nginx。验证命令：

```bash
systemctl is-active ai-beads.service nginx certbot.timer
curl -fsS https://api.luckwork.ltd/healthz
sudo certbot renew --dry-run
```

该证书创建时未配置续期通知邮箱，应依靠定时器和监控检查证书到期时间，并尽快在 Certbot 账号中补充可用邮箱。服务器 SSH 密码已在对话中暴露，部署后应更换为强密码并优先使用 SSH 密钥。

## HTTPS 和小程序

1. 使用 `https://api.luckwork.ltd` 作为 HTTPS 源地址。不要把 Key 配到 Nginx 响应或小程序里。
2. 需要更换域名时，同步修改 Nginx 站点、证书和 [`miniprogram/config/api.js`](../miniprogram/config/api.js) 的 `apiBaseUrl`（不带 `/api/v1/...`）。
3. 在微信公众平台为正式小程序 AppID 配置该域名的 `uploadFile` 合法域名；如后续用 `wx.request` 调用同域名，也配置 `request` 合法域名。域名配置生效后，用真机测试上传、断网回退、图纸详情及编辑器。
4. 不要为了测试在生产版关闭微信域名校验或使用裸 IP/自签名证书。

开放给真实用户前，应增加登录身份校验、用户级配额及持久化限流；当前的每 IP 每小时 20 次/同时 2 次限制只防止基础误用，并不能抵御分布式滥用。日志只包含请求 ID、耗时、模型、状态、识别类型/尺寸/置信度或错误类型。

## 第一阶段限制

目前只让 AI 定位图纸结构；带格内色号的逐块 OCR、人工网格校准、复杂背景去除尚未实现。视觉模型可能缩小大图片，所以高密度 128×128 及以上图纸仍需人工核对行列和颜色，不能把置信度当准确率。照片生成结果也不是原图的精确豆数统计。
