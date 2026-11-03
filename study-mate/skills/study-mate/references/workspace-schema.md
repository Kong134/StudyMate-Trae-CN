# 工作区数据格式

## 目录树

```
StudyMate/
├── workspace.json                     # 工作区索引
├── memory/
│   ├── profile.md                     # 学习者档案（水平、时间、目标）
│   └── preferences.md                 # 讲法偏好与常见卡点（跨科目共享）
└── subjects/
    └── <subject-id>/
        ├── course.json                # 大纲与路线图（唯一真相源）
        ├── progress.json              # 进度流水（只追加）
        ├── lessons/
        │   └── 01-xxx.md              # 课件（一课一文件）
        ├── notes/
        │   └── <node-id>.md           # 学习者在阅读端写的笔记
        └── records/
            └── <node-id>-<日期>.md    # 评估记录
```

`<subject-id>` 用英文小写短横线，例如 `psychology-intro`、`cpp-contest`。

## workspace.json

```json
{
  "version": 1,
  "name": "我的学习工作区",
  "createdAt": "2026-11-03",
  "subjects": ["psychology-intro"]
}
```

## course.json

```json
{
  "id": "psychology-intro",
  "title": "心理学导论",
  "subtitle": "从零建立学科地图",
  "goal": "能读懂入门文献，能设计一个简单实验",
  "level": "零基础",
  "hoursPerWeek": 5,
  "status": "active",
  "createdAt": "2026-11-03",
  "nodes": [
    {
      "id": "p1",
      "title": "心理学研究什么",
      "type": "concept",
      "layer": 1,
      "status": "done",
      "estimated": 40,
      "summary": "能区分常识结论与实证结论",
      "prereq": [],
      "lesson": "01-what-is-psychology.md"
    }
  ],
  "edges": [{ "from": "p1", "to": "p2" }]
}
```

字段约定：

| 字段 | 取值 | 说明 |
| --- | --- | --- |
| `type` | `concept` / `practice` / `lab` / `project` | 概念课 / 实操课 / 实验课 / 项目课 |
| `status` | `todo` / `in_progress` / `done` / `skipped` | 阅读端按此着色并算进度 |
| `layer` | 整数，从 1 开始 | 前置依赖层级，数字越大越靠后 |
| `prereq` | 节点 id 数组 | 阅读端卡片上显示"前置" |
| `lesson` | 文件名或省略 | 省略表示课件还没写 |

`edges` 可选；`prereq` 已足够表达依赖，`edges` 只用于以后画连线。

## progress.json

```json
[
  { "at": "2026-11-03T10:20:00+08:00", "subject": "psychology-intro", "node": "p1", "status": "done" }
]
```

只追加，不改旧行。阅读端点"标记完成"时由服务端自动写入。

## 课件文件

首部是受限的 YAML 头（只支持 `key: value` 单行），空一行以后是正文：

```markdown
---
node: p1
title: 心理学研究什么
type: concept
duration: 40
---

正文……
```

正文支持普通 Markdown（含表格、代码块、内联 `<svg>`）与下列提示块：

| 语法 | 渲染 |
| --- | --- |
| `::: goal 标题` | 目标卡（绿色） |
| `::: key` | 重点卡（蓝色） |
| `::: warn` | 易错点卡（红色） |
| `::: note` | 补充说明（灰色） |
| `::: example 标题` | 例子卡 |
| `::: exercise 标题` | 练习卡，可折叠答案 |
| `::: answer` | 写在 exercise 内部的参考答案，默认折叠 |
| `::: project` | 项目卡 |
| `::: selfcheck` | 自检清单 |

结束标记是单独一行的 `:::`。块内可以再嵌套一层（`exercise` 里套 `answer`）。

数学公式用 `$...$`（行内）与 `$$...$$`（独立成行），由本地 KaTeX 渲染，离线可用。
