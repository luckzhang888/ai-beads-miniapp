# AI 豆仓微信小程序

微信原生小程序 MVP。当前 `develop` 分支已实现第一条完整闭环：

> 图片导入 → 中心裁剪/像素化 → RGB 转 Lab → ΔE76 色差匹配 → 拼豆格子图 → 色号统计 → 本地库存 → 缺豆计算

## 已实现

- 微信原生 WXML / WXSS / JavaScript
- 图片从相册或相机导入
- 32×32 / 48×48 / 64×64 / 128×128
- Canvas 2D 离屏图片缩放与像素读取
- RGB → XYZ → CIELAB
- ΔE76 最近色匹配
- DEMO 独立色卡
- Canvas 拼豆图
- 1× / 1.5× / 2× 查看
- 网格开关
- 色号显示（格子足够大时）
- 单色高亮
- 水平镜像
- 颜色数量统计
- 本地库存增减和直接修改
- 自动计算库存、缺少、剩余
- 自动保存最近 20 张图纸
- 无图片也可用“快速体验示例图”验证界面

> 注意：仓库里的 DEMO 色卡仅用于验证产品流程，不代表任何拼豆品牌的官方色号。

## Codespaces

仓库页面：

`Code -> Codespaces -> Create codespace`

创建后自动执行：

```bash
npm install
npm run check
```

## 本地/云端静态检查

```bash
npm install
npm run check
```

## 微信真机预览

项目使用 `miniprogram-ci`。需要在微信公众平台的小程序后台取得：

1. 小程序 AppID
2. 代码上传密钥

然后在 GitHub 仓库 Settings → Secrets and variables → Actions 中增加：

- `WX_APPID`
- `WX_PRIVATE_KEY`

把代码推到 `develop` 后，GitHub Actions 的 `wechat-preview` 会：

1. 安装依赖
2. 临时写入上传私钥
3. 调用 `miniprogram-ci preview`
4. 生成 `preview-qrcode.png`
5. 上传为名为 `wechat-preview-qrcode` 的 Actions Artifact

下载 Artifact 后，用具有该小程序开发/体验权限的微信扫码即可打开。

私钥文件不会提交到 Git。

## 项目结构

```text
miniprogram/
├── pages/
│   ├── home/
│   ├── convert/
│   ├── pattern/
│   └── inventory/
├── components/
│   └── bead-grid/
├── data/
│   └── colors/
│       └── demo.js
└── utils/
    ├── image.js
    ├── lab.js
    ├── color-match.js
    ├── inventory.js
    └── pattern.js
```

## 下一阶段

- 替换真实品牌色卡
- ΔE2000
- 自定义裁剪区域
- 颜色替换
- 撤销/重做
- 图纸导出
- 云同步
- AI 抠图与图像优化
