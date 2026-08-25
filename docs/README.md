# OpenMovie Documentation

> 文档基线日期：2026-08-25

## 产品

| 文档                                  | 作用                       | 状态                 |
| ------------------------------------- | -------------------------- | -------------------- |
| [Product Definition](../PRODUCT.md)   | 愿景、边界、领域模型和 MVP | MVP Product Baseline |
| [Product Design](./PRODUCT_DESIGN.md) | 用户旅程、桌面交互和验收   | MVP Product Baseline |

## 技术

| 文档                                            | 作用                                         | 状态                    |
| ----------------------------------------------- | -------------------------------------------- | ----------------------- |
| [Technical Design](./TECHNICAL_DESIGN.md)       | 总体架构和模块设计                           | Implementation Baseline |
| [Project Format](./PROJECT_FORMAT.md)           | YAML、SQLite、Object Store 与迁移            | Implementation Baseline |
| [Protocol Contracts](./PROTOCOLS.md)            | IPC、Event、Tool、Agent 和 Provider Contract | Implementation Baseline |
| [Security Design](./SECURITY.md)                | 威胁模型、Secret、权限和安全门禁             | Implementation Baseline |
| [Performance](./PERFORMANCE.md)                 | 离线性能工作负载、阈值和 CI 门禁             | Implementation Baseline |
| [Accessibility](./ACCESSIBILITY.md)             | 键盘、辅助技术与中英本地化基础               | Implementation Baseline |
| [Plugin Development](./PLUGIN_DEVELOPMENT.md)   | 隔离进程 Plugin Manifest 与开发模式          | Implementation Baseline |
| [用户手册](./USER_GUIDE.zh-CN.md)               | 桌面创作、Provider、版本与备份               | Beta Guide              |
| [Development](./DEVELOPMENT.md)                 | 本地开发、包边界、测试与 Contract            | Beta Guide              |
| [Troubleshooting](./TROUBLESHOOTING.md)         | 常见故障、恢复和安全报告信息                 | Beta Guide              |
| [Releasing](./RELEASING.md)                     | 签名、公证、Sidecar 与发布验收               | Maintainer Guide        |
| [Implementation Plan](./IMPLEMENTATION_PLAN.md) | Milestone、Issues、CI 和 DoD                 | Beta Baseline           |
| [ADR Index](./adr/README.md)                    | 已接受架构决策                               | Accepted                |

## 阅读顺序

产品与设计：

```text
PRODUCT.md
→ PRODUCT_DESIGN.md
→ TECHNICAL_DESIGN.md
```

开始实现：

```text
IMPLEMENTATION_PLAN.md
├── PROJECT_FORMAT.md
├── PROTOCOLS.md
├── SECURITY.md
└── adr/
```

## 事实层级

发生冲突时：

1. 已接受 ADR 决定架构选择。
2. Project Format 和 Protocols 决定持久化与公共 Contract。
3. Security 决定权限和数据边界。
4. Technical Design 提供总体解释。
5. Implementation Plan 决定实施顺序，不改变上层 Contract。
6. Product Definition 和 Product Design 决定用户目标与范围。

如技术实现无法满足产品要求，必须显式更新产品决策或新建 ADR，不能静默偏离。

## 版本管理

- Implementation Baseline 可以在编码中通过 PR 修正细节。
- 改变公共格式或协议时更新版本与 Fixture。
- 改变 Accepted ADR 时新建 superseding ADR。
- 文档链接和事实错误可以直接修复。
- 所有用户可见行为变更同步产品文档。

仓库协作与漏洞报告入口分别见 [CONTRIBUTING](../CONTRIBUTING.md) 和 [Security Policy](../SECURITY.md)。

## 当前阶段

M0–M5 和 M6 Beta Hardening 基线已经实现。后续变更以
[Implementation Plan](./IMPLEMENTATION_PLAN.md) 的 Exit Criteria、本文档事实层级和回归门禁为准。
