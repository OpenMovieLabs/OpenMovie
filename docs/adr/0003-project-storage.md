# ADR-0003: Project Storage

- 状态：Accepted
- 日期：2026-08-25

## Context

工程需要可读、可 Git 管理、跨平台，同时支持任务历史、大媒体、缓存和崩溃恢复。单纯 Git、单一 SQLite 或所有内容 YAML 都不能同时满足。

## Decision

- 当前 Movie IR 使用 YAML。
- JSON Schema 定义格式和验证。
- SQLite 保存 Task、Run、Revision、索引和运行状态。
- 媒体使用 SHA-256 内容寻址对象库。
- Cache 与 Preview 可删除重建。
- Secret 不属于 Project。
- MVP SQLite Driver 使用 better-sqlite3，置于 Repository Port 后。

## Consequences

- 当前创作状态人类可读。
- 运行查询和恢复有效率。
- 媒体可去重和保持不可变。
- YAML 与 SQLite 存在一致性问题，需要 Revision Journal 和 Project Doctor。

## Guardrails

- Project Format 遵循 PROJECT_FORMAT.md。
- IR 不保存绝对路径。
- 所有对象写入临时路径后原子移动。
- SQLite Driver 必须通过 Electron ABI 双平台门禁。
