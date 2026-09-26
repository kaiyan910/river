- 問題必須用正體中文(台灣)回答，除非是專用或技術名詞
- 問題顯示形式必須是 TAB 形式，不要一次過垂直顯示所有問題
- 所有 worktree 一定要放到 project root 的 `.worktree` 資料夾，完成後必須將 worktree 移除

## Agent skills

### Issue tracker

Issue 與 spec 以 Markdown 檔案存放在 `.scratch/<feature-slug>/`。See `docs/agents/issue-tracker.md`.

### Triage labels

使用預設的五個 triage label（needs-triage、needs-info、ready-for-agent、ready-for-human、wontfix）。See `docs/agents/triage-labels.md`.

### Domain docs

Single-context：根目錄的 `CONTEXT.md` + `docs/adr/`。See `docs/agents/domain.md`.
