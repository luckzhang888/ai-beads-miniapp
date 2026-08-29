# AI 豆仓微信小程序

基于 `develop` 分支实现的微信原生拼豆效率工具，围绕“导入图纸 → 智能转色 → 管理图纸 → 高亮辅助拼豆 → 库存核销”完成可运行闭环。

## 当前功能

- AI 豆仓风格图纸册：首页统计、搜索、状态筛选、文件夹预览、图纸卡片
- 五种创作入口：图纸导入、PDF 文件入口、分享口令、像素画转图纸、无图例识别
- MARD 221 标准色，RGB → XYZ → CIELAB → CIEDE2000 最近色匹配
- 保持比例、方形裁剪、方形留白，以及照片提亮、色数限制和孤立豆点清理
- 32 / 48 / 64 / 80 / 96 / 128 短边精度与自动推荐尺寸
- 图纸详情：主图、单色效果、色号与用量、库存缺口、状态和标签
- 图纸高亮助手：色号、5×5 辅助线、镜像、锁定、缩放、逐色完成进度和 PNG 导出
- 图纸编辑：画笔、填充、换色、镜像、旋转、撤销与重做
- 本地豆仓：库存增减、缺豆计算、作品完成后扣减库存
- 本地图纸分享口令、重命名、复制、删除和状态管理

## 说明与边界

- PDF 页面的文件选择与预览入口已保留；微信小程序端不能直接把 PDF 栅格化为图片，自动识别需要部署受控的服务端转换接口。
- 当前分享口令用于同一小程序本地数据中的图纸定位；跨设备分享需要云数据库或业务服务端。
- 色卡 RGB 值用于屏幕算法匹配，实物会受到品牌批次、光线与屏幕显示影响。
- 本项目不包含 AI 豆仓官方代码、素材或用户数据，界面和交互根据公开产品信息与参考截图重新实现。

## 安装与验证

```bash
npm ci
npm run verify
```

`verify` 会依次执行：

1. JSON、JavaScript、WXML、WXSS、页面资源和事件绑定检查
2. 色卡、CIEDE2000、图片尺寸、图纸持久化、分享口令和库存单元测试
3. 使用微信 `miniprogram-ci` 完成本地编译

也可以分别运行：

```bash
npm run check
npm test
npm run compile:local
```

## 微信真机预览二维码

官方预览必须使用目标小程序的合法 AppID 与代码上传密钥。把以下仓库 Secrets 配置到 GitHub Actions：

- `WX_APPID`
- `WX_PRIVATE_KEY`

推送到 `develop` 后，`wechat-preview` 工作流会生成 `preview-qrcode.png`，并上传为 `wechat-preview-qrcode` Artifact。私钥仅在工作流运行时写入，不会提交到 Git。

本地也可以运行：

```bash
WX_APPID=你的小程序AppID WX_PRIVATE_KEY_PATH=private.key npm run preview
```

Windows PowerShell：

```powershell
$env:WX_APPID = '你的小程序AppID'
$env:WX_PRIVATE_KEY_PATH = 'private.key'
npm run preview
```

## 目录

```text
miniprogram/
├── components/bead-grid/      # Canvas 拼豆网格
├── data/colors/mard.js        # MARD 221 色
├── pages/
│   ├── patterns/              # 图纸册
│   ├── convert/               # 导入与智能转图
│   ├── detail/                # 图纸详情
│   ├── pattern/               # 高亮拼豆助手
│   ├── editor/                # 图纸编辑器
│   └── inventory/             # 豆仓库存
└── utils/                     # 色差、图片、图纸和库存逻辑
```
