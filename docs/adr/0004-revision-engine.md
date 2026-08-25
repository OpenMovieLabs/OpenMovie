# ADR-0004: Revision Engine

- 状态：Accepted
- 日期：2026-08-25

## Context

普通创作者不应被要求安装或理解 Git；媒体也不能进行文本合并。但项目需要版本、分支、Diff、冲突和回滚。

## Decision

- OpenMovie 实现领域级 Revision Engine。
- Revision 保存父版本、语义 MoviePatch、作者、影响、评测和费用。
- 写操作使用 expectedRevisionId 乐观并发。
- Take 与 Artifact 不可变。
- Git 是可选互操作层，不是运行依赖。

## Consequences

- 可以显示电影语义 Diff 和构建影响。
- Agent 修改可以成为 Proposal。
- 需要自有 Revision 存储、冲突和恢复测试。
- Git Commit 与 OpenMovie Revision 不假设一一对应。

## Guardrails

- Agent 不直接写 YAML 或 SQLite。
- 生成结果不静默覆盖。
- 过期 Proposal 必须重新基于当前 Revision。
- 受保护 Revision 需要审批。
