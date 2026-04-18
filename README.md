# AI English Learning

这是一个用于验证“语境式英语学习”的浏览器插件 MVP。

它会在网页正文中进行少量双向替换：

- 中文网页：把部分中文词或词组替换成英文表达
- 英文网页：把部分英文词或词组替换成中文解释
- 鼠标悬停：显示原文、解释、例句，并支持收藏或忽略

插件不依赖构建工具，可以直接加载 `extension` 目录运行。默认使用内置词表；在设置页配置 OpenAI 兼容接口后，可以启用 AI 替换建议、中文改写和复习反馈。

## 本地安装

1. 打开 Chrome 或 Edge
2. 进入扩展管理页
   - Chrome：`chrome://extensions`
   - Edge：`edge://extensions`
3. 开启“开发者模式”
4. 点击“加载已解压的扩展程序”
5. 选择本项目中的 `extension` 目录

## 使用方式

- 打开任意中文或英文网页
- 页面正文中会出现少量带下划线的替换词
- 鼠标悬停在替换词上，可以看到原文、解释和例句
- 点击插件图标，可以开启/关闭替换、调整替换方向和强度
- 点击插件图标里的“打开生词本”“开始复习”“中文改写”进入完整学习页

## 当前功能

- 浏览器 DOM 文本替换
- 中文到英文、英文到中文双向替换
- hover 浮层
- 收藏词条
- 忽略词条
- 当前页面恢复原文
- 当前网站暂停/启用
- 插件弹窗设置
- 生词本管理
- 掌握状态：陌生、被动认识、半熟、主动可用、已掌握
- 每日复习任务
- 中文改写成自然英文
- 可选 AI 替换建议
- 可选 AI 复习反馈
- 数据导出
- 本地学习数据清空

## AI 设置

进入插件弹窗，点击“设置”，填写：

- API Endpoint：默认 `https://api.openai.com/v1/chat/completions`
- Model：默认 `gpt-4o-mini`
- API Key：你的接口密钥
- 勾选“启用 AI 替换、改写和复习反馈”

API key 只保存在浏览器本地存储里。开启 AI 后，插件会把有限的页面正文片段发送到你配置的接口，用于生成替换建议。

## 当前不包含

- 桌面全局快捷键划词解释
- OCR 识别图片、视频字幕或桌面软件文字
- 云同步和账号系统
- 浏览器商店打包发布

这些能力需要桌面应用或服务端能力，后续可以在插件核心体验稳定后继续开发。

## 开发验证

当前项目没有构建步骤。修改后可以运行：

```powershell
node --check .\extension\src\dictionary.js
node --check .\extension\src\content.js
node --check .\extension\src\popup.js
node --check .\extension\src\app.js
node --check .\extension\src\background.js
Get-Content -Raw .\extension\manifest.json | ConvertFrom-Json | Out-Null
```
