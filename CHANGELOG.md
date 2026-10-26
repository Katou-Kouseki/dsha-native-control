# DSHA Native Control 变更记录 / 回滚说明

本仓库是独立项目（包名 `@katou-kouseki/dsha-native-control`），代码基于
[dsh-logcat](https://github.com/WindyPro-rourou/dsh-logcat)（Apache-2.0）改造，致谢见 README。

## 0.1.0 — 独立化改造

从上游派生后进行的品牌与命名独立，确保可与上游插件并存、互不干扰：

| 项目 | 原值（上游） | 新值 |
| --- | --- | --- |
| 包名 | `@windypro-rourou/dsh-logcat` | `@katou-kouseki/dsha-native-control` |
| cordis 插件 id / `name` 导出 | `logcat` | `dsha-native-control` |
| `ctx.provide` 键 | `ctx.logcat` | `ctx['dsha-native-control']` |
| HTTP 路由前缀 | `/api/dsh-logcat/*` | `/api/dsha-native-control/*` |
| 客户端 bundle 路径 | `/plugins/logcat/client.js` | `/plugins/dsha-native-control/client.js` |
| 浏览器 bundle id | `@windypro-rourou/dsh-logcat` | `@katou-kouseki/dsha-native-control` |
| 数据目录 | `~/.dsh/logcat/`（logs、crashes） | `~/.dsh/dsha-native-control/` |
| 环境变量前缀 | `DSH_LOGCAT_*` | `DSHA_NATIVE_CONTROL_*` |
| 原生面板开关 | `window.__DSH_LOGCAT_NATIVE_PANEL__` | `window.__DSHA_NATIVE_CONTROL_PANEL__` |
| localStorage 键前缀 | `dsh-logcat-*` | `dsha-native-control-*` |
| 面板 CSS 类/属性 | `.dsh-logcat-*`、`[data-dsh-logcat-entry]` | `.dsha-native-control-*`、`[data-dsha-native-control-entry]` |

其他独立化调整：

- 删除上游专属文件：`publish.ps1`、`publish-npm.ps1`、`publish-github-packages.ps1`、
  `restart-dsh-web.cmd`（含上游作者本机路径）。
- `package.json` 改为本项目元信息（作者、仓库、homepage、bugs、keywords），版本重置为 `0.1.0`。
- 新增 `NOTICE` 文件，按 Apache-2.0 要求声明上游来源与改动范围；`LICENSE` 附录填入本项目版权。
- 测试与报告迁入仓库根目录：`test-*.mjs`、`smoke-native.mjs`、`TEST_REPORT.md`、`PERF_REPORT.md`。
- **agent 工具名保持 `logcat_*` 不变**，避免破坏既有用法与测试断言。

> 升级提示：数据目录与 localStorage 键均已更换，旧的上游面板设置不会自动继承；旧日志仍留在
> `~/.dsh/logcat/`，可手工迁移到 `~/.dsh/dsha-native-control/`。

## 一、阶段变更（0.1.0 之前的开发过程）


### 阶段 0：审计
- 输出 ADB 强耦合点清单（engine.adb 直查、DeviceStream、InputChannel spawn adb、installPlatformTools、client.js 状态栏/设备下拉）。

### 阶段 1：Backend 抽象层（新增 `lib/backends/`）
- `manager.js`：`auto/native/adb` 三模式。auto = Android 宿主且 native 探测成功 → native；否则 adb。`status()` 统一返回 `{mode,kind,ready,reason,native,adb}`。
- `native.js`：本机后端。探测 `/system/bin/su`、input/screencap/logcat/app_process/base64/wm/uiautomator，Root 三态（available/denied/unavailable），能力表 capabilities，工具路径映射。不假定 Node 自身是 Root。
- `adb.js`：原 ADB 行为封装，桌面用户零变化。
- `types.js`：`NATIVE_DEVICE_ID='native-local'`、设备描述符、`validatePoint`、`screenshotMeta`、`pngSize`。
- `lib/index.js`：Engine 接 manager；设备列表、执行命令、logcat 附加按 backend 分流。

### 阶段 2：坐标统一与 Injector Native 部署
- 内部坐标标准 = 当前截图原始像素（原点左上）；`screen_capture` 返回 `screenshotMeta`（imageWidth/imageHeight/rotation/frameId/coordinateSpace='screenshot-pixels'/capturedAt）。
- 帧缓存：旋转/分辨率变化即失效，重新截图才重建；超范围坐标明确报错不裁剪；不臆测横竖屏 x/y 交换。
- Injector 部署/启动从 ADB 耦合抽离：native 用 `su` 部署（dex chmod 600），失败回退原生 `input`；连续 3 次失败停用并标记 blocked；不使用宽泛 pkill。

### 阶段 3：input_batch 批量动作
- 新工具 `input_batch`：tap/swipe/keyevent/wait/screenshot 五种受限动作，MAX_ACTIONS=20、单 wait ≤10s、整批 ≤120s，串行执行（防并发交错），stopOnError 默认 true，超时不重放，逐动作返回 index/type/ms/backend。
- schema 层（defineTool enum + additionalProperties:false）拒绝未知动作类型，`shell` 等命令根本无法进入执行器——不开放任意 Root Shell。
- 系统提示（LOGCAT_GUIDANCE）更新：新工具说明、§6.3"命令已执行≠页面状态已验证"、建议关键步骤插 screenshot。

### 阶段 4：UI 诊断与 unzip 兼容
- `client.js`：
  - 状态栏 Native 模式显示「Native 本机模式」（带 Root 三态 tooltip），隐藏「一键安装 adb」按钮；ADB 模式保持原样。
  - 设备下拉 `native-local` 显示「本机设备（DSHA Native）」；无设备文案区分模式。
  - 工具栏新增「诊断」按钮（pulse 图标）：弹窗展示后端 kind/mode/reason、Root 三态（文本非仅颜色）、Injector per-device 状态、截图帧（尺寸/rotation/frameId/坐标空间）、工具探测路径、能力表；打开时自动拉取最新 /status。
- `lib/index.js`：
  - 新增 `engine.nativeDiagnostics()` 只读诊断快照；`/status` 与 ws `ready` 帧注入 `backend` + `native` 块。
  - `logcatGuidance()` §7.3 后端感知：Native 模式明示"无需 ADB/USB/电脑"+ Root/Injector 状态；ADB 模式列出外接设备与选择原因。
  - **unzip 兼容修复（§7.2）**：新增 `extractZipJs`（纯 JS ZIP 解包：EOCD 回扫/中央目录/deflate inflateRawSync/stored/路径穿越拒绝，零新依赖）与 `extractPlatformTools`（系统解压器优先 → JS 回退，双层失败原因都保留）。Native 模式完全不触发此流程。
- README 中英文更新：Native 模式、33 工具、unzip 回退、故障排查（Root 拒绝/Injector blocked/解压失败/坐标错位）。

### 阶段 5：测试与报告
- `selfcheck.mjs`：从仅断言工具数量扩展为**按名断言 33 个必需工具 + 12 条必需路由**。
- 新增测试：`test-coords.mjs`（16 断言）、`test-batch.mjs`（16 断言）、`test-zip.mjs`（9 断言）。
- 报告：`TEST_REPORT.md`（§12 十五用例覆盖状态）、`PERF_REPORT.md`（真机 p50/p95 实测方法与回填区，未伪造数据）。

## 二、改动文件列表

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `lib/backends/manager.js` | 新增 | 后端管理器（auto/native/adb） |
| `lib/backends/native.js` | 新增 | 本机 su/input/screencap 后端 |
| `lib/backends/adb.js` | 新增 | 原 ADB 后端封装 |
| `lib/backends/types.js` | 新增 | 设备描述符、坐标校验、帧元数据 |
| `lib/index.js` | 修改 | backend 集成、坐标帧缓存、input_batch、nativeDiagnostics、extractZipJs/extractPlatformTools、系统提示 |
| `lib/client.js` | 修改 | Native 状态栏、设备下拉标识、诊断弹窗、pulse 图标 |
| `selfcheck.mjs` | 修改 | 按名断言工具/路由 |
| `README.md` / `README.en.md` | 修改 | Native 模式、33 工具、故障排查 |
| `test-coords.mjs` / `test-batch.mjs` / `test-zip.mjs` | 新增 | 自动化测试（项目根目录） |
| `TEST_REPORT.md` / `PERF_REPORT.md` / 本文件 | 新增 | 阶段5交付物 |

未改动：`cordis.patch.yml`（挂载方式不变）、`tools/injector/*`（Injector.java 复用原版）、HTTP 路由的 loopback/鉴权限制（未削弱）。

## 三、运行测试

```powershell
node --check lib\index.js
node --check lib\client.js
node selfcheck.mjs          # 33 工具按名断言 + 12 路由断言
node test-coords.mjs                   # 16 断言
node test-batch.mjs                    # 16 断言
node test-zip.mjs                      # 9 断言
```

全部通过（桌面无 adb 环境下，工具返回明确 "adb not found" 属预期降级）。

## 四、DSHA（Android 手机）安装步骤

1. 将本仓库放到 DSHA 可访问的存储（或 `git clone` 到 DSHA）。
2. DSHA 的 Node 环境加载插件（沿用上游方式二/三：`dsh plugin --profile web add link:<路径>`，或按 DSHA 文档安装）。
3. 启动 DSH Web GUI，首次在 Magisk 弹窗中**授予 DSHA su 权限**。
4. 打开 Logcat 面板：状态栏应显示「Native 本机模式」，设备下拉显示「本机设备（DSHA Native）」。
5. 点工具栏「诊断」确认：Root 可用、工具探测有 su/input/screencap 路径。
6. 按 `PERF_REPORT.md` 第 4 节实测 p50/p95 并回填。

## 五、回滚方案

- **整体回滚**：删除/移走本插件目录，重新安装上游 `@windypro-rourou/dsh-logcat`。本改造未写宿主全局状态；但本版数据目录为 `~/.dsh/dsha-native-control/`，上游读的是 `~/.dsh/logcat/`，回滚前如需保留历史日志请手工迁移。
- **单文件回滚**：`lib/backends/` 为纯新增目录，删除即回到无 backend 层状态——但 `lib/index.js` 依赖它，因此实际回滚单位是整个插件目录，不支持只回滚单文件。
- **模式回退（不回滚代码）**：在插件配置中设 `backend: adb`（`lib/index.js` 的 `apply()` 读取 `config.backend`，取值 `auto|native|adb`），即可让整个 Native 改造旁路，回到原版纯 ADB 行为；`backend: native` 则强制本机后端且探测失败时不做回退。auto（默认）在 Android 宿主走 native、桌面走 adb，探测失败也会自动落回 adb。
- **Injector 回退（运行时）**：Injector 连续启动失败 3 次自动停用回退原生 `input`，无需人工干预；面板诊断可见状态。

## 六、剩余风险（真机验收项）

- su 探测、app_process Injector 在 K20 Pro（Android 版本待确认）上的实际行为。
- SELinux/隐藏 API 限制导致 Injector 失败时的回退流畅性。
- native screencap 的帧率与 PNG 尺寸稳定性。
- 详见 `TEST_REPORT.md` 第 2 节【待验证】清单。
