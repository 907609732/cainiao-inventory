# 独立飞牛云仓 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 独立空库飞牛应用 24 小时后台、四页面、浏览器采集与受控 ERP API，实际安装验收。
**Architecture:** Node 24 Fastify 复用业务核心，认证网页网关与 loopback 内部 API 分离；独立 Linux Chromium/Xvfb/noVNC 登录；fnOS 独立包与持久目录。Windows 路径保持原样。
**Tech Stack:** 已有 Fastify 5、SQLite、Playwright、Node crypto；成熟 noVNC/websockify；fnpack。
**Spec:** 本次用户委派与 docs/integrations/erp-api-v1.md。

## Global Constraints

不动 ERP；不迁移历史数据/Windows 密钥；不做订单；不发布 Release。真实通知仅明确授权后发送。自动任务默认关闭。完整业务不能被模拟或只读壳替代。

## Review Focus

断电后未知任务不重复投递；浏览器 WebSocket 不绕过鉴权；服务密钥不进入 URL/日志；空库有独立 datasetId；备份含恢复密钥且恢复校验数据集。

### Task 1: API 与 NAS 网关
- [ ] 在 `nas/server` 实现认证网页入口、私有内部 API、凭据撤销、身份与既有回执；复用 `desktop/local-web`，不公开旧 loopback。
- [ ] 先写 `tests/nas-transport.test.mjs` 证明认证/只读/跨站/秘密/数据集与重启回执。
- [ ] 复用原页面适配，NAS 登录页面与可视化入口独立。

### Task 2: Node 业务运行时
- [ ] `nas/runtime.mjs` 与 `nas/storage.mjs` 复用库存/月销量/设置/通知/日期异常/任务调度；无 Electron 导入。
- [ ] 加密配置、默认关闭、持久锁、执行子进程、回执、CLI/MCP，先测试后实现。
- [ ] 全部原操作兼容，更新/目录操作提供飞牛可用语义。

### Task 3: Linux 浏览器与独立包装
- [ ] `deploy/fnos` 原生应用包/独立容器生命周期、完整依赖、持久目录、备份恢复与健康检查。
- [ ] 复用 Playwright/noVNC，独立端口且不接管 ERP 浏览器；GitHub Linux 构建与浏览器检查。
- [ ] 下载同次 fpk，NAS 隔离安装后验收，记录所有未完成项。

### Task 4: 综合审查与安装
- [ ] 定向+Windows 回归+Linux CI；下载同次产物。
- [ ] 审查所有授权/重试/备份/生命周期边界。
- [ ] NAS 空库隔离安装、普通浏览器四页面、真实登录、重启/故障/恢复；不碰 ERP 数据；写实证到部署文档。
