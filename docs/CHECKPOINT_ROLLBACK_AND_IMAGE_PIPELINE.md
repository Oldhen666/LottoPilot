# 检查点、回滚与「只保留图像处理」工作流

本文说明：如何给当前代码打检查点、日后如何回滚、如何把未来版本与检查点对比并只合并需要的功能（例如只保留图像相关更新）。

---

## 推荐方案（一次性执行）

目标：在远程留下**可恢复**的锚点，并包含你**当前工作区**里所有未提交改动（若你希望锚点含这些文件）。

在项目根目录 PowerShell 中：

```powershell
cd C:\Users\xiang\Documents\projects\LottoPilot

# 1) 把所有改动纳入一次提交（检查点）
git add -A
git commit -m "checkpoint: before cleanup — image algo testing snapshot"

# 2) 打附注标签（说明用途，便于以后搜索）
git tag -a checkpoint-image-algo-testing -m "rollback anchor after image algorithm testing; later may strip non-image changes"

# 3) 推到远程（提交 + 标签）
git push origin main
git push origin checkpoint-image-algo-testing
```

若你的主分支不是 `main`，把 `main` 换成实际分支名。

可选：再建一条**备份分支**指向同一次提交（和标签二选一或并存均可）：

```powershell
git branch backup/image-algo-testing
git push origin backup/image-algo-testing
```

---

## 日后如何 Rollback

### A. 只想「看一眼」当时代码（不破坏当前分支）

```powershell
git fetch origin
git checkout checkpoint-image-algo-testing
```

看完后回到日常分支：

```powershell
git checkout main
```

### B. 从检查点新开分支继续改（推荐）

```powershell
git fetch origin
git checkout -b restore-from-checkpoint checkpoint-image-algo-testing
```

### C. 让当前分支**完全回到**检查点（会丢掉该点之后的提交，慎用）

先确认没有需要保留的未推送工作，再执行：

```powershell
git fetch origin
git reset --hard checkpoint-image-algo-testing
```

若已推送过 `main` 且要改历史，需要 `git push --force`（团队协作前务必沟通）。

### D. 只恢复**部分文件**（不整体回退）

先看检查点里某文件长什么样：

```powershell
git show checkpoint-image-algo-testing:path/to/file.ts
```

把单个文件恢复成检查点版本（覆盖工作区）：

```powershell
git checkout checkpoint-image-algo-testing -- path/to/file.ts
```

---

## 与未来版本对比：看改了什么、保留哪些功能

### 1. 检查点 → 当前 HEAD：总体差异

```powershell
git diff checkpoint-image-algo-testing..HEAD --stat
```

只看涉及图像/票据的目录（按你项目实际路径改）：

```powershell
git diff checkpoint-image-algo-testing..HEAD -- src/services/ticketPreprocess/ src/services/powerballOcr/
```

### 2. 某次提交是否在检查点之后、改了哪些文件

```powershell
git log checkpoint-image-algo-testing..HEAD --oneline
```

### 3. 按文件看逐行差异

```powershell
git diff checkpoint-image-algo-testing..HEAD -- src/services/ocr.ts
```

### 4. 在图形界面里对比（可选）

- VS Code / Cursor：`Git: Compare with...`，选标签 `checkpoint-image-algo-testing`。
- 或安装 Git GUI（如 `gitk`、`git gui`）查看范围 `checkpoint-image-algo-testing..HEAD`。

---

## 「只保留图像处理」的实操顺序

1. **列出要保留的目录/文件**（示例，请按你最终决策改）  
   - 例如：`src/services/ticketPreprocess/`、`src/services/powerballOcr/` 下与识别/几何/展平相关的模块。  
   - 要删的：临时脚本、与商店/EAS/监控无关的实验代码等。

2. **用 diff 确认检查点与「未来精简版」差在哪里**  
   - 从检查点拉分支做精简：`git checkout -b slim-image-only checkpoint-image-algo-testing`  
   - 在新分支上删除不需要的文件并提交；或用 `git checkout future-branch -- path` 从「未来分支」**只捡回**需要的文件。

3. **只合并部分提交**（若未来分支已有清晰小提交）  

   ```powershell
   git cherry-pick <commit-hash>
   ```

4. **填下面清单**（复制到 issue 或 PR 描述里），避免遗漏：

| 区域 | 保留 | 不保留 / 稍后删 |
|------|------|------------------|
| ticketPreprocess |  |  |
| powerballOcr |  |  |
| ocr 入口 |  |  |
| App / UI |  |  |
| app.config / EAS |  |  |

---

## 标签与分支命名约定（建议）

| 名称 | 用途 |
|------|------|
| `checkpoint-image-algo-testing` | 附注标签，回滚锚点 |
| `backup/image-algo-testing` | 可选，与标签同提交，便于 `git branch -a` 查找 |

日后若再打新检查点，用新标签名（如 `checkpoint-image-algo-v2`），避免移动旧标签。

---

## 常见问题

**Q：标签推不上去？**  
执行：`git push origin checkpoint-image-algo-testing`

**Q：忘记标签全名？**  
执行：`git tag -l "checkpoint*"`

**Q：只想对比两个分支、不涉及标签？**  
执行：`git diff main..feature-branch --stat`

---

*若你尚未执行「推荐方案」中的 `commit` + `tag`，检查点不存在；请先完成该节再使用本文其余命令。*
