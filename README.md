# 文道材料批量下载工具

一个简单的 Node + HTML 工具：登录后输入关键词，先看结果数量，再批量下载文件并自动打包成 ZIP。

## 功能

- 扫码登录，保留会员登录态
- 输入关键词搜索，查看总数量和各类型数量
- 全部结果 / 限制数量两种下载范围
- 按文件类型筛选（Word / Excel / PPT / PDF / 视频 / 其他）
- 并发、间隔、保存位置等高级选项
- 下载完成后生成 ZIP 压缩包

## 运行环境

- Windows 10 / 11
- Node.js 18 或更高版本
- 已安装 Microsoft Edge（工具用它承载页面和登录）

## 本地运行

```bash
npm install
npm start
```

也可以直接双击 `start-tool.cmd`，首次会自动安装依赖并启动。

启动后网页会自动打开，先点“扫码登录”，登录成功后再搜索下载。

## 项目结构

```text
wdcl-web/
├─ public/           网页前端（HTML / CSS / JS）
├─ server.js         Node 服务：登录、搜索、下载、打包
├─ make-zip.ps1      打包脚本
├─ package.json      依赖和启动脚本
├─ start-tool.cmd    Windows 一键启动
└─ README.md         说明
```

## 关于发布到 GitHub

这个项目需要 Node 后端才能真正搜索和下载，因此：

- 可以作为源码仓库发布到 GitHub；
- GitHub Pages 是纯静态托管，不能在这上面运行下载服务；
- 想“免安装、点一下就用”，需要把 Node 服务部署到支持 Node 的平台（例如 Render / Railway / Fly）。

## 说明

- 请使用你有会员权限的账号登录，不要绕过官方会员控制。
- 首次使用会创建一个本地浏览器 profile，后续通常不用重复扫码。
