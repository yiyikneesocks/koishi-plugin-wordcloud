# koishi-plugin-wordcloud

[![npm](https://img.shields.io/npm/v/koishi-plugin-wordcloud?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-wordcloud)

聊天词云 for Koishi：基于 [koishi-plugin-chatlog](https://www.npmjs.com/package/koishi-plugin-chatlog)
收集的历史消息分词（`jbmsg`），用 puppeteer 渲染 SVG 词云图。

## 安装

```bash
npm install koishi-plugin-wordcloud
npm install koishi-plugin-puppeteer
```

依赖 `koishi-plugin-chatlog`（数据来源）、数据库插件与 `koishi-plugin-puppeteer`（渲染）。

## 用法

```
wordcloud           → 默认 60 个词
wordcloud 100       → 100 个词
词云 -d 30          → 只统计最近 30 天
```

## 配置

词数上下限、图片宽高、字体（需系统已安装）、停用词列表等，见 Config 面板。
