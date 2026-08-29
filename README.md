# AI 豆仓微信小程序

微信原生小程序 MVP，目标闭环：

> 图片导入 → 像素化 → 色号匹配 → 拼豆图纸 → 数量统计 → 库存缺口

## 当前阶段

这是第一版项目框架，已经包含：

- 微信原生小程序目录
- 首页、创建图纸、图纸、库存页面骨架
- Canvas 拼豆组件骨架
- 独立色卡目录
- 图片/颜色/Lab/库存算法模块目录
- GitHub Codespaces 配置
- GitHub Actions 基础检查
- miniprogram-ci 预览流程
- GitHub Secrets 私钥方案

## Codespaces

在 GitHub 仓库页面点击：

`Code -> Codespaces -> Create codespace`

容器创建后会自动执行：

```bash
npm install
```

项目结构检查：

```bash
npm run check
```

## 微信配置

`project.config.json` 当前使用 `touristappid`，用于框架占位。

正式 CI 需要在 GitHub 仓库 Secrets 中配置：

- `WX_APPID`
- `WX_PRIVATE_KEY`

私钥禁止提交到 Git。

## 分支建议

- `main`：稳定版本
- `develop`：日常开发、自动预览

## 下一阶段

1. Canvas 读取图片像素
2. RGB -> XYZ -> Lab
3. ΔE76 色差匹配
4. 生成二维色号矩阵
5. Canvas 绘制拼豆网格
6. 色号数量统计
7. 本地库存 CRUD
8. 缺豆数量计算
