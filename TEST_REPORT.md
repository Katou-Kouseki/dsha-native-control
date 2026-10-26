# DSHA Native Control 测试报告

- 日期：2026-10-26
- 代码基线：本仓库 `dsha-native-control`（独立项目，基于上游 WindyPro-rourou/dsh-logcat 改造）
- 测试环境：Windows 10 x64 开发机（非 Android），Node.js，无 adb、无连接真机
- 结论：**桌面侧全部自动化测试通过；所有 Android 真机行为标记【待验证】，未伪造任何实测结果**

## 1. 自动化测试结果（本机实跑）

| 测试 | 命令 | 结果 |
| --- | --- | --- |
| 语法检查 | `node --check lib/index.js`、`node --check lib/client.js` | PASS |
| 插件自检 | `node selfcheck.mjs` | PASS（33 工具按名逐项断言 + 12 必需路由断言全过；本机无 adb，工具返回明确的 "adb not found on this host"，属预期优雅降级） |
| 坐标系统 | `node test-coords.mjs` | PASS（16/16） |
| 批量动作 | `node test-batch.mjs` | PASS（16/16） |
| ZIP 解包回退 | `node test-zip.mjs` | PASS（9/9，含与 PowerShell Expand-Archive 输出一致性交叉验证） |

### 1.1 selfcheck 覆盖点

- 插件挂载（webServer / tools / systemPrompt 三注入点）。
- 33 个 agent 工具全部注册，且按**工具名**逐项断言存在（不只看数量）：30 个原版工具 + `native_status`、`native_display_info`、`input_batch`。
- 12 个面板/工具依赖的 HTTP 路由按路径断言存在；1 个 WebSocket upgrade 路由。
- 无设备环境下 15 个代表性工具 execute 全部返回结构化错误而非崩溃。
- `/status` 返回 `backend` 块（mode=auto、kind=adb、ready=false、reason="mode=auto off-Android: adb backend"）——桌面环境正确保留 ADB 后端。

### 1.2 test-coords 覆盖点（对应验收 11.2）

- 范围内点通过；x/y 超界、负数、非有限数拒绝；未知几何拒绝（不静默放行）。
- 横屏 2340×1080 空间内坐标通过；竖屏坐标在横屏空间被拒。
- `pngSize` 从 IHDR 读真实尺寸；非 PNG 拒绝。
- `screenshotMeta` 携带 coordinateSpace='screenshot-pixels'、frameId、capturedAt。
- 帧缓存：noteFrame → frameInfo 一致；rotation 变化使旧帧失效；旋转后新截图重建帧。

### 1.3 test-batch 覆盖点（对应验收 11.3 与 §12 用例 10）

- 空数组拒绝、>20 拒绝、schema 层拒绝未知动作类型（`ToolArgsError INVALID_ARGS`，`shell` 之类动作根本到不了执行器）。
- happy path：每动作返回 index/type/ms/backend，命令按序执行。
- 第 2 个动作超范围失败 → 第 3 个动作不执行，skipped==[2]，`stopOnError=true` 生效。
- `stopOnError=false` 时失败后继续执行。
- wait 超过 10s 被钳制。
- 无 adb 主机返回明确错误。

### 1.4 test-zip 覆盖点（对应验收 11.4 / §12 用例 4）

- 纯 JS 解包：deflate/stored 往返、目录项不计文件数、路径穿越（`../evil.txt`）拒绝、损坏 zip 拒绝。
- `extractPlatformTools` 导出可用；输出与系统解压器（Expand-Archive）逐文件一致。

## 2. 项目书 §12 建议用例覆盖状态

| # | 用例 | 状态 | 证据 |
| --- | --- | --- | --- |
| 1 | 非 Android 开发机 backend=auto 选 ADB | ✅ 已验证 | selfcheck status 输出 `kind: "adb", reason: "mode=auto off-Android: adb backend"` |
| 2 | Android 本机 Root 可用 → Native，不装 ADB | 【待验证】需 DSHA 真机 | manager.js 逻辑：`isAndroidHost()` + native 探测成功即选 native；桌面无法模拟 `/system/bin/su` |
| 3 | Android 本机 Root 被拒绝 | 【待验证】需 DSHA 真机 | rootState 三态逻辑已实现，真机行为待验收 |
| 4 | 缺少 unzip | ✅ 已验证（ADB 侧） | test-zip 9/9；Native 侧天然不走解压流程（代码路径隔离） |
| 5 | 横屏 2340×1080 坐标范围检查 | ✅ 已验证 | test-coords "landscape coords validated against landscape space" |
| 6 | 旋转后旧帧失效 | ✅ 已验证 | test-coords "rotation change invalidates the stale frame" |
| 7 | Injector 启动成功 ping/READY | 【待验证】需 DSHA 真机 | InputChannel 状态机已实现；Android `app_process` 行为无法桌面模拟 |
| 8 | Injector 启动失败回退 input | 【待验证】需 DSHA 真机 | 连续 3 次失败 → injectorBlocked → runGesture 回退原生命令（逻辑已实现） |
| 9 | 截图失败不返回旧图 | 【待验证】需 DSHA 真机 | 截图路径失败直接报错，不读缓存（代码路径）；真机验证待验收 |
| 10 | 批量第 2 动作失败 | ✅ 已验证 | test-batch "stopOnError skips later indices exactly" |
| 11 | 触控超时不自动重放 | ✅ 代码实现+部分验证 | input_batch 超时标记失败且不重放；单动作超时逻辑同路径 |
| 12 | 游戏自绘 ui_dump 空结果 | 【待验证】需真机 | ui_dump 空结果原样返回，系统提示已声明"空结果≠无UI" |
| 13 | 面板断开重连无泄漏 | 【待验证】需 GUI 环境 | dispose 清理逻辑已实现 |
| 14 | 插件卸载子进程清理 | 【待验证】需 GUI 环境 | engine.dispose() 停 injector/流；selfcheck 正常退出 |
| 15 | 原 ADB 外接设备回归 | ✅ 部分验证 | 桌面路径全量测试通过；带真机 adb 的完整回归需有 adb 的环境 |

## 3. 验收标准自查（§11）

- 11.1 本机功能：桌面侧可验证项全过；Native 识别/截图/Root 三态【待真机】。
- 11.2 坐标准确性：自动化测试全过（范围校验、不静默裁剪、不臆测旋转转换、元数据齐全）。
- 11.3 批量操作：全部 6 项自动化验证通过。
- 11.4 兼容与安全：原工具名/schema 保留、路由 loopback 限制未动、batch 不开放 shell、injector 失败有阈值不无限重启、README 已区分"动作执行成功/业务状态已验证"。

## 4. 已知限制与风险

1. **真机未验证**：所有 Android-only 行为（su 探测、app_process 注入器、screencap 权限、SELinux 拦截）均待 Redmi K20 Pro + DSHA 环境手工验收。
2. **PowerShell 5.1**：测试脚本运行于 `powershell5` 环境，`&&` 不可用（用 `;` 分隔）；CLIXML profile 警告与系统临时目录清理报错属于环境噪音，不影响断言结果。
3. **Injector 性能**：上游宣称 3~5ms，本项目书 §4.2 明确禁止直接采信；见 PERF_REPORT.md。

## 5. 回归测试命令

```powershell
node --check lib\index.js
node --check lib\client.js
node selfcheck.mjs
node test-coords.mjs
node test-batch.mjs
node test-zip.mjs
node smoke-native.mjs
```
