# OpenMovie Security Design v0

> 状态：Implementation Baseline  
> 更新日期：2026-08-25  
> 关联：[技术方案](./TECHNICAL_DESIGN.md) · [协议契约](./PROTOCOLS.md)

## 1. 安全目标

OpenMovie 是一个会读取本地媒体、调用付费 API、运行本地 Agent 和修改项目文件的桌面应用。安全目标：

1. Project 只能在用户明确选择的范围内被读写。
2. API Key、Token 和 Harness 凭据不会进入项目、日志或 Agent 上下文。
3. 私人素材不会未经授权发送给 Provider。
4. Agent 不能绕过 Tool、Policy、Approval 和 Revision。
5. 不可信媒体、项目和 Plugin 不能获得任意代码执行。
6. 更新、Sidecar 和发布产物可验证来源与完整性。
7. 安全错误不会造成不可恢复的数据覆盖。

## 2. 非目标

MVP 不承诺：

- 防御已经完全控制当前操作系统用户账户的恶意软件。
- 在受感染内核或管理员权限攻击者下保护内存 Secret。
- 把本地桌面应用变成多租户强隔离服务。
- 自动判断所有媒体版权、肖像授权和内容合法性。

这些限制必须公开，不得把 OS-backed encryption 描述为万能保险箱。

## 3. 资产

高价值资产：

- Provider API Key、OAuth Token 和刷新 Token。
- 私人图片、视频、音频、脚本和角色参考。
- 未发布电影和商业创意。
- Provider 付费额度。
- Movie IR、Revision 和审计历史。
- 发布凭据与签名密钥。

完整性资产：

- 当前采用 Take。
- Story Fact 和受保护 Revision。
- 评测与生成来源。
- Provider 路由和预算策略。

## 4. 信任边界

```text
Untrusted / Less Trusted
├── Imported Project
├── Imported Media
├── Model Output
├── Agent Output
├── Plugin
├── Provider Response
└── Remote URLs

Desktop Boundary
├── Renderer（低信任）
├── Preload（窄桥）
├── Electron Main（高信任）
├── Core（高信任业务）
├── Workers（受限）
└── Sidecars（固定能力）

External
├── Agent Harness
├── Model Provider
├── Update Server
└── Future Remote Store
```

所有跨边界消息运行时验证。

## 5. 威胁主体

- 恶意或被篡改的 Project。
- 恶意媒体文件。
- Prompt Injection 内容。
- 失控或被误导的 Agent。
- 恶意或漏洞 Plugin。
- 被入侵 Provider。
- 同一机器上的其他普通应用。
- 拥有当前用户权限的恶意进程。
- 中间人和伪造更新源。

## 6. Renderer

必须：

- nodeIntegration: false。
- contextIsolation: true。
- sandbox: true。
- 禁止 remote module。
- Preload 只暴露白名单 API。
- CSP 不允许 unsafe-eval 和任意远程脚本。
- 导航和新窗口默认拒绝，仅对白名单外链调用系统浏览器。
- 不渲染模型返回的原始 HTML。
- Markdown 使用安全渲染和 URL Scheme 白名单。

Renderer 泄露时，攻击者仍不能直接读取任意文件、执行命令或获得 Secret。

## 7. IPC

- Channel 固定且有运行时 Schema。
- Renderer 不控制 Method 名以访问隐藏 Core 命令。
- 请求绑定 Window、Project 和用户会话。
- 文件选择返回受控 Handle/Import Token，而不是开放任意路径 API。
- 单条消息限制大小。
- 媒体通过受控 Artifact Protocol 流式读取，不通过 JSON/Base64 IPC。
- IPC Error 脱敏。

## 8. Project 路径

- 所有 Project 相对路径进行 canonicalize。
- 拒绝路径逃逸、绝对路径和 NUL。
- 符号链接在导入和每次敏感访问前验证最终目标。
- Windows 处理盘符、UNC、大小写和保留设备名。
- macOS 处理 Unicode 归一化差异。
- 不信任压缩包内路径；防止 Zip Slip。
- Project 打开不执行脚本、Hook、宏和任意二进制。

## 9. Project 信任

首次打开未知来源项目：

- 默认只读解析。
- 显示来源与签名状态。
- 不自动启动 Harness、Plugin 或 Provider 请求。
- 不自动加载外部 URL。
- 不自动执行构建。
- 用户信任后才启用写入和外部操作。

Developer Mode 也不能让项目内容自动获得 Shell 权限。

## 10. 媒体处理

媒体视为不可信输入：

- FFprobe/FFmpeg 在独立进程运行。
- 设置 CPU、内存、输出大小和超时限制。
- 读取前检查文件大小和 MIME，但不只信任扩展名。
- 防止压缩炸弹、超大分辨率和异常时长。
- 缩略图和代理输出进入临时目录后再验证。
- Sidecar 使用固定路径与参数数组，不通过 Shell。
- 未来高风险解析器可以进入 OS Sandbox 或容器。

## 11. Secret Store

### 11.1 MVP 实现

- Electron Main 独占 safeStorage。
- 使用异步 encryptStringAsync/decryptStringAsync。
- macOS 加密密钥由 Keychain Access 保存。
- Windows 使用当前用户上下文的 DPAPI。
- 密文保存在应用级 settings.sqlite。
- Project 只保存 credentialRef。

Electron 官方说明 safeStorage 使用 OS 提供的密码系统；macOS 使用 Keychain，Windows 使用 DPAPI，并推荐异步接口。[Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)

### 11.2 存储位置

```text
Application Data/
├── settings.sqlite
└── diagnostics/

Project/
└── openmovie.yaml  # 只保存 Provider Profile ID
```

Secret 不进入 .openmovie/state.sqlite。

### 11.3 Secret Broker

- Provider Worker 使用 credentialRef 请求 Secret Lease。
- Secret Broker 验证 Provider、用途、Project Policy 和 Run。
- Lease 短时有效且不可序列化。
- Worker 不缓存 Secret 到磁盘。
- 请求完成后释放引用；内存清理是 best effort。
- Plugin 只能请求 Manifest 声明的 Secret Slot。

### 11.4 Redaction

Redactor 覆盖：

- Authorization、Proxy-Authorization、Cookie。
- 常见 API Key Header。
- URL Query Secret。
- 用户配置的 Secret 原值和派生掩码。
- Provider Error 中回显的请求片段。

测试必须使用 Canary Secret，确保日志、Event、Error、诊断包和崩溃元数据不出现。

### 11.5 开发者模式

- 环境变量可以注入 Secret。
- 环境变量不复制到数据库。
- 子进程只继承明确白名单变量。
- CLI 不提供会把 Key 写入 Shell History 的推荐用法。

## 12. Provider 数据外发

每次请求计算：

- Provider。
- Model。
- Base URL 与地区。
- 输入 Artifact。
- 数据分类。
- 是否首次发送。
- 预计费用。
- 保留和训练策略元数据，若已知。

默认审批：

- 首次向 Provider 发送 Project Private 数据。
- 发送 Sensitive Identity。
- Provider Fallback 改变数据接收方。
- Base URL 非 HTTPS；MVP 默认直接拒绝远程明文 HTTP。
- 费用超过策略。

Restricted 数据不允许外发。

## 13. Provider URL

- 远程 Provider 默认只允许 HTTPS。
- 自定义 Base URL 禁止嵌入 username/password。
- 解析 DNS 后阻止未授权本地网段访问，除非用户明确配置 Local Provider。
- 防止重定向把请求发送到不同 Origin。
- 下载结果限制协议、域名、大小和次数。
- 临时 URL 不写入长期日志。
- TLS 验证不能在普通模式关闭。
- Provider 连通性测试不生成内容、不记录响应正文，禁止自动跟随重定向，并将错误归一化后再返回 Renderer。
- Provider Base URL 拒绝内嵌 username/password 和 URL fragment。

本地 Provider 使用独立 Local Provider 开关，并提示其可以访问本机接口。

## 14. Agent

Agent 输出一律不可信：

- Tool Call 必须 Schema 验证。
- Agent 不能直接写 Project、SQLite 和 Object Store。
- Agent 看不到 Secret。
- Agent 只能使用当前 Task 授权的 Tool。
- 写操作携带 expectedRevisionId。
- 费用、外发、破坏性操作和受保护修改进入 Policy。
- Agent 不能批准自己的审批。
- Agent 自评必须明确标记，不能作为唯一自动合并依据。

## 15. Prompt Injection

图片文字、脚本、字幕、网页和导入文档可能包含恶意指令。

控制：

- 外部内容在 Context 中标记为 data，不作为 system/developer 指令。
- Tool 权限不因内容中的指令扩大。
- Agent 不能从媒体文本获得 Secret。
- 关键操作由 Policy 决定，不依赖 Prompt 遵守。
- 审批卡片由 Core 生成，不由 Agent 提供最终描述。
- Evaluation 模型不获得执行类 Tool。

## 16. Harness

- 只使用结构化公开接口。
- 不解析交互 TUI。
- 不读取 Harness 私有凭据文件。
- 启动参数不包含 Secret。
- 环境变量白名单。
- 工作目录固定为 Project 或受控 Worktree。
- 协议消息限制大小。
- 取消后终止完整进程树。
- Harness 版本和可执行文件路径进入诊断，不进入 Project。

## 17. Plugin

Plugin Manifest 声明：

- 代码身份和版本。
- Tools。
- 文件 Scope。
- 网络 Origin。
- Secret Slot。
- 子进程需求。

策略：

- MVP 仅支持用户显式安装的本地开发 Plugin。
- Plugin 在独立进程运行。
- 默认无 Shell。
- 权限变更重新审批。
- Plugin 更新后重新验证 Manifest。
- 未签名 Plugin 显示风险并默认禁用自动更新。

## 18. Update 与供应链

- macOS 应用签名与 Notarization。
- Windows 代码签名。
- 更新清单和包签名验证。
- 禁止降级到已撤销版本。
- Sidecar 带 SHA-256 清单和来源。
- 发布 SBOM。
- npm Lockfile 进入仓库。
- CI 最小权限和受保护发布环境。
- 签名密钥不进入普通 CI 日志和 Fork 构建。

## 19. Object Store

- 文件名来自内容哈希，不来自用户输入。
- 写入临时文件后验证并原子移动。
- 读取验证数据库引用和 Project Scope。
- 垃圾回收有延迟和 Dry Run。
- 删除受保护 Revision 引用对象前必须拒绝。
- Object 不具备执行权限。

## 20. Revision 与审计

审计记录：

- Actor。
- Task、Run、Tool。
- Policy Decision。
- Approval 与审批者。
- Provider 和数据分类。
- Cost Estimate/Actual。
- Patch 和 Revision。
- 错误与恢复动作。

审计记录不包含 Secret 和完整敏感媒体内容。

## 21. 权限模式

### Creator

- 无通用 Shell。
- 只通过 Tool 修改。
- 外部发送与费用审批。

### Professional

- 更多 Provider 和参数控制。
- 仍不默认开放 Shell。

### Developer

- 可查看日志、IR 和协议。
- 可以显式启用 Project-scoped Shell。
- Shell 仍需路径、网络和命令审批。

### Trusted Automation

不属于 MVP。未来必须使用独立策略、服务账户和审计。

## 22. 隐私

- 本地功能在关闭遥测时完整可用。
- 遥测默认不包含 Prompt、Movie IR、文件名和媒体。
- 崩溃报告上传前提供数据说明。
- 诊断包由用户显式生成和分享。
- Project Export 不包含 Secret。
- 删除 Provider Profile 时提供删除本地 Secret 选项。

## 23. 安全测试

### 自动测试

- IPC Schema 拒绝。
- Path Traversal 和符号链接逃逸。
- Zip Slip。
- YAML 恶意 Tag。
- 超大协议消息。
- Secret Canary Redaction。
- Provider 重定向和 SSRF。
- Revision 权限绕过。
- Agent Tool Schema Fuzz。
- Object Hash 与 MIME 欺骗。
- 不可信 HTML/Markdown。

### 双平台测试

- macOS Keychain 首次授权、更新后访问和删除。
- Windows 不同用户无法解密 DPAPI Blob。
- 应用签名变化的失败模式。
- Windows 文件占用和杀进程树。
- macOS Quarantine 与 Sidecar 签名。

### 手工评审

- 发布前 Threat Model Review。
- 新 Tool、Provider Adapter 和 Plugin 权限评审。
- 新数据外发路径评审。
- 自动更新与签名验证。

## 24. 漏洞处理

公开仓库需要 SECURITY.md 或等价入口，包含：

- 私密报告渠道。
- 支持版本。
- 响应预期。
- 不公开零日细节的要求。

修复流程：

1. 确认影响。
2. 创建私密修复分支。
3. 增加回归测试。
4. 发布签名更新。
5. 必要时撤销版本和轮换凭据。
6. 发布安全公告。

## 25. Security Gate

实现进入公开 Beta 前必须满足：

1. Renderer Sandbox、CSP 和 Preload 审计通过。
2. Secret Canary 在所有日志与诊断路径中不泄露。
3. Project Import 不执行任何项目代码。
4. Provider 外发和 Fallback 受 Policy 控制。
5. Agent 无法绕过 Tool Runtime 写入。
6. Sidecar 和更新包验证签名或哈希。
7. Windows/macOS 安装包完成安全 Smoke Test。
8. 依赖扫描无未接受的 Critical 漏洞。
9. Project Backup/Recovery 演练通过。
10. 漏洞报告渠道已建立。
