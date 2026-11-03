---
description: 打开学习界面，并继续当前科目的下一课
---

# /learn

按顺序做三步，不要反问用户想干什么：

1. 读取 `StudyMate/workspace.json`，以及第一个 `status` 为 `active` 的科目的 `course.json`，用两行说明：学到哪、下一步是哪个节点。
2. 启动阅读端并把地址给用户：

   ```powershell
   node "study-mate/app/server.mjs" --workspace "StudyMate" --open
   ```

   终端会打印 `http://127.0.0.1:4310/` 之类的地址；如果端口被占用会自动顺延，以终端输出为准。

3. 如果该科目还有未完成且已有 `lesson` 的节点，提醒用户点「继续学」；如果当前节点还没有课件，就直接按 `study-mate/skills/study-mate/SKILL.md` 的规范把这一课写出来。
