# Architecture Decision Records

ADR 记录已经接受、会影响实现边界的技术决策。

| ADR                                       | 状态     | 决策                                    |
| ----------------------------------------- | -------- | --------------------------------------- |
| [0001](./0001-desktop-stack.md)           | Accepted | Electron + React + TypeScript           |
| [0002](./0002-process-architecture.md)    | Accepted | Renderer/Main/Core/Worker 分层          |
| [0003](./0003-project-storage.md)         | Accepted | YAML + SQLite + 内容寻址对象库          |
| [0004](./0004-revision-engine.md)         | Accepted | OpenMovie Revision 独立于 Git           |
| [0005](./0005-agent-provider-gateways.md) | Accepted | Agent Gateway 与 Provider Gateway 解耦  |
| [0006](./0006-secret-storage.md)          | Accepted | Electron safeStorage + 应用级密文库     |
| [0007](./0007-protocol-and-platform.md)   | Accepted | 版本化 Contract + Windows/macOS 同步 CI |

规则：

- 一个 ADR 只记录一个相关决策集合。
- Accepted ADR 的实质变更需要新 ADR supersede，不能静默改写历史。
- 事实错误和链接可以直接修正。
- PR 若改变进程、数据、安全或公共 Contract，必须引用 ADR。
