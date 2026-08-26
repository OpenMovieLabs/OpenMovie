# ADR-0004: Revision Engine

- 状态：Accepted
- 日期：2026-08-25

## Context

普通创作者不应被要求安装或理解 Git；媒体也不能进行文本合并。项目需要易理解的历史版本、Diff、冲突检测和恢复能力，但不需要分支与合并工作流。

## Decision

- OpenMovie 实现领域级 Revision Engine。
- Revision 保存单一父版本、语义 MoviePatch、作者、影响、评测和费用，形成线性历史。
- 写操作使用 expectedRevisionId 乐观并发。
- 恢复历史快照会追加一个新 Revision，不移动当前指针或改写历史。
- 不实现 Branch、Checkout 和 Merge。
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
