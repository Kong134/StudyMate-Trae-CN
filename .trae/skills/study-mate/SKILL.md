---
name: study-mate
description: 学习搭档。用户想学某门科目、要课程大纲/课件/练习、说“继续学习 / 考考我 / 这里没懂”、想打开学习界面时使用。完整规范在 study-mate/skills/study-mate/SKILL.md。
---

# 学习搭档（本仓库版）

这个项目里已经装好一套学习系统。接到学习类请求时，**先读** `study-mate/skills/study-mate/SKILL.md` 并严格按它执行；工作区数据格式见 `study-mate/skills/study-mate/references/workspace-schema.md`，课型与讲法见 `teaching-playbook.md`。

三条硬规则：

1. **工作区就是项目根下的 `StudyMate/`**，一科一个目录，不要另建散落的课件文件。
2. **讲一课写一课**：先把 `course.json` 的节点状态改成 `in_progress`，再写 `lessons/<序号>-<slug>.md`，写完告诉用户怎么打开阅读端。
3. 打开阅读端统一用：`node "study-mate/app/server.mjs" --workspace "StudyMate" --open`，然后把终端打印的地址发给用户。

用户说「我想学 X」时，先做最多 4 个问题的入学评估，再产出路线图与第一课；不要说“我可以帮你规划”然后停在提问上。
