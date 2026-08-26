# OpenMovie 用户手册（简体中文）

## 1. OpenMovie 是什么

OpenMovie 把电影理解为一个可检查的工程：YAML Movie IR 是源文件，图片/视频/音频和成片是构建
产物，Revision 是可回滚提交，Evaluation 是测试，AI 只能提出可审查的修改。桌面端支持 macOS
和 Windows；没有安装 Codex 或 Claude Code 时，也可以直接配置 API Provider。

## 2. 第一次使用

1. 安装对应平台的签名版本并启动 OpenMovie。
2. 点击“新建电影 / New movie”，输入片名并选择工程目录。
3. 在中央对话框用一句话描述电影、角色或第一个场景；不需要先配置复杂工作流。
4. 左侧会列出最近使用的全部电影工程；只有当前工程展开 Story、Character、Scene、Shot 和 Timeline，点击其他工程即可切换并展开。
5. 普通消息会像 Codex 一样直接返回对话文本，不显示固定工作流。需要生成图片或视频时，展开“生成设置”并选择一次性任务类型；只有实际工具执行期间才显示进度。
6. 右侧资源区展示 Shot、生成的 Take、Current Cut 和版本历史。没有选中 Shot 时，生成任务会自动建立归档 Shot，确保产物立即可见。选择 Take 会创建一个新的 Revision，而不是覆盖历史。

内置 Fake Provider 免费、离线、确定性，适合先走通工作流。它不会生成真实创意媒体。

每个已打开工程拥有独立后台会话。工程 A 正在生成图片或视频时，可以切换到工程 B 继续对话或发起
另一个任务；切回工程 A 后会恢复它自己的任务与资源状态。切换工程不会改变左侧列表顺序。

## 3. 配置模型和 API

打开左下角设置。Provider Profile 包含名称、协议、Base URL、模型和 API Key：

| 协议                      | 用途                                   |
| ------------------------- | -------------------------------------- |
| OpenAI-compatible Chat    | 文本规划、兼容 Chat/Vision 的图片理解  |
| OpenAI Responses / Vision | Responses 文本与图片理解               |
| OpenAI-compatible Images  | 图片生成                               |
| Async HTTP Video Jobs     | 提交、轮询、取消和收集异步视频任务     |
| Custom                    | 明确按 OpenAI Chat-compatible 语义处理 |

API Key 由 Electron Main 使用系统加密保存，Renderer、Movie IR 和导出工程都不会得到明文。保存后先点
“Test”进行无费用或最低风险的连通性探测。Base URL 必须是 HTTPS；仅 localhost 可使用 HTTP。

打开设置中的“Provider 用量与控制”可以配置两项工程级策略：

- 月度已报告费用上限：留空表示不限；填写美元金额后，达到该上限会阻止后续远程调用。
- 远程数据策略：`上传前确认`（默认）、`允许`或`禁止`。默认模式下，包含远程文本规划、图片/视频
  生成或分析的 Task 会先停在审批状态。

设置页按 UTC 月显示调用次数、Provider 明确报告的费用和未定价次数。并非所有兼容 API 都返回费用，
所以未定价调用不能纳入绝对硬上限；OpenMovie 会明确显示它们，而不会假装为免费。两项工程策略都会
形成 Revision，可以查看 Diff 或回滚。本地 Fake、Codex/Claude Code Harness 和显式开发 Plugin 不会被
当作远程 Provider。

## 4. 使用本地 Harness

OpenMovie 会探测本机 Codex 与 Claude Code：

- Codex 通过 App Server 和项目范围只读工具规划；
- Claude Code 使用非交互 print mode、Plan 权限和 `Read/Glob/Grep` 白名单；
- Direct Agent 使用已配置的 API Provider；
- 三者都只能产生 `OPENMOVIE_PLAN_V1` Proposal，不能直接提交 Movie IR。

在中央对话中审查 Proposal 的字段级动作。只有点击“应用到工程”才会原子提交；拒绝不会修改
工程。工程头发生变化时，旧 Proposal 会失效，必须重新生成。

## 5. Take、分析、反馈和成片

- 每次生成都是独立不可变 Take，可在同一 Shot 下比较多个 Provider 的结果。
- 图片/视频类型是一次性选择；发送后输入框自动恢复为“仅对话”，避免后续普通消息误触发生成。
- 图片分析直接调用视觉 Provider；视频先在本地生成代理、WAV、波形、镜头边界和确定性关键帧，
  再把关键帧发送给视觉 Provider。
- Feedback 可以绑定起止秒数。“Fix with AI”会把意见和时间范围带入新的局部 Shot 任务。
- Evaluation 检查媒体类型、来源、请求哈希、分辨率、宽高比和时长，并报告相对上一 Take 的回归。
- Timeline 按选中的 Take 确定性组装；Render 生成 Current Cut 并记录精确源 Revision。

## 6. Revision 历史、恢复和外部编辑

右侧“版本”页显示线性 Revision 历史。选择历史版本并点击“恢复为新版本”后，OpenMovie 会把
该快照追加为新的 Revision，不会抹掉历史或直接移动回旧版本。产品不提供分支或合并。外部编辑
受支持的 YAML 会显示为 Working Changes；冲突写入通过 `expectedRevisionId` 拒绝，不会静默覆盖。

## 7. 工程体检、磁盘和备份

- 左侧“工程检查”运行 Project Doctor，检查 Schema、引用、选中 Take、SQLite、Object Store 和 Working Changes；
  Deep 模式会重新计算媒体哈希。
- Overview 的存储卡片区分媒体对象、源文件、运行数据库和可重建 Cache。清理按钮只删除 Cache、
  Preview 和 Temp，不删除 Object Store、Revision 或 Movie IR。
- 完整备份请使用 `openmovie export` 或复制关闭状态下的整个工程目录。只保留 YAML 可以恢复当前
  Story/Scene/Shot/Timeline，但不能恢复 Task、Take Provenance、Feedback 和历史 Revision。

## 8. 更新和隐私

正式安装版从 `OpenMovieLabs/OpenMovie` 的 Stable GitHub Release 检查更新，后台下载后等待用户点击
安装并重启。正式 Tag 构建缺少 Windows/macOS 签名或 macOS 公证时会失败。

媒体只在明确执行 Provider/Harness 任务时离开本机。运行本地视频分析会产生派生对象；发送给远程
视觉 Provider 的是采样帧。请根据素材授权、Provider 数据政策和费用限制选择模型。

遇到问题参见 [Troubleshooting](./TROUBLESHOOTING.md)。
