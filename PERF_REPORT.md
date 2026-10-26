# DSHA Native Control 性能基准报告

- 日期：2026-10-26
- 依据：项目书 §4.2（不能把原项目文档 3–5ms 当作保证值，必须实测并报告 p50/p95）、§10 阶段5（比较普通 input 与 Injector 耗时、单步与批量总耗时）、§13.6（不虚构真机测试结果）

## 1. 结论（先行）

**本报告不包含任何真机实测数据。** 测试环境为 Windows 桌面开发机（无 adb、无 Android），无法运行
`su`/`input`/`app_process`/`screencap`。按照项目书要求，以下所有性能指标均标记为**【待验证】**，
需在 Redmi K20 Pro + DSHA（Magisk Root）真机上按第 4 节方法实测后回填。

## 2. 待实测指标清单

| 指标 | 对比组 | 上游参考值 | 本项目状态 |
| --- | --- | --- | --- |
| tap 单次耗时 p50/p95 | Injector vs 原生 `input` | Injector 3–5ms；`input` ~480ms（上游文档，**未经本项目验证**） | 【待验证】 |
| swipe 单次耗时 p50/p95 | Injector vs 原生 `input` | 无上游数据 | 【待验证】 |
| keyevent 单次耗时 p50/p95 | Injector vs 原生 `input` | 无上游数据 | 【待验证】 |
| screenshot 耗时 p50/p95 | native `screencap` 直读 vs ADB `exec-out screencap` | 无上游数据 | 【待验证】 |
| 5 动作批量总耗时 | input_batch 一次调用 vs 5 次 input_tap 串行调用 | 无上游数据 | 【待验证】 |
| Injector 部署一次性成本 | Native su 部署 vs ADB 部署 | 无上游数据 | 【待验证】 |

## 3. 已实现的测量基础设施（非数据）

代码层已为实测准备好采集点，真机验收时无需改代码即可取数：

- 单动作（tap/swipe/keyevent）结果自带 `ms` 字段（执行耗时）与 `backend` 字段（'injector' 或回退的命令路径），见 `inputBatchTool`/`inputTapTool` 等返回结构。
- `input_batch` 每个动作独立返回 `ms`，整批自然汇总。
- `native_status` 报告 Injector per-device 状态（ready/starting/off/blocked），确认测试跑在哪条路径上。
- 面板「诊断」弹窗实时显示 Injector 与帧状态，供手工验收时交叉确认。

## 4. 真机实测方法（交付给验收人）

在 DSHA 环境（Termux/DSHA 内建 Node）中对同一屏幕坐标执行，取 ≥30 次样本计算 p50/p95：

```text
A. 原生 input 基线（Injector 关闭时自动走此路径）
   for i in 1..30: input_tap(x, y)        → 记录每次返回的 ms

B. Injector 路径
   先触发一次 tap 让 Injector 部署并 READY（native_status 确认 ready，首跳成本单独记录）
   for i in 1..30: input_tap(x, y)        → 记录每次返回的 ms

C. 批量 vs 单步
   for i in 1..30: input_batch([5 个 tap/wait 动作])   → 记录整批耗时
   for i in 1..30: 5 次连续 input_tap 调用             → 记录总耗时

D. 截图
   for i in 1..30: screen_capture()       → 记录 ms（对比桌面 ADB 模式同指标）
```

判定参考（来自项目书，非硬性门槛）：

- Injector 路径 p50 应显著低于原生 `input`（上游宣称差距约两个数量级，但以实测为准）。
- input_batch 一次调用应少于等价单步调用总和（省去 N-1 次工具调用往返）。

## 5. 可在本机验证的间接证据

- test-batch 在 mock 后端下验证了耗时字段确实被测量与回传（`per-action timing+backend recorded`），
  即测量管道本身工作正常——缺的只是真机执行环境。
- 桌面 selfcheck 显示工具调用端到端（含 schema 校验、engine 分发）开销为毫秒级，不构成瓶颈。

## 6. 回填区（真机验收后填写）

```text
设备型号/Android 版本/Root 方案：
 Injector tap p50 / p95：
 input   tap p50 / p95：
 Injector swipe p50 / p95：
 input   swipe p50 / p95：
 Injector keyevent p50 / p95：
 input   keyevent p50 / p95：
 screenshot p50 / p95（native / adb 对比）：
 batch(5动作) p50 / p95 vs 5×单步 p50 / p95：
 Injector 首次部署耗时：
```
