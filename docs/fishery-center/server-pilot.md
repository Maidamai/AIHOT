# Linux 隔离试部署（2026-10-20）

> Archived project snapshot; dates and claims describe that stage, not current live state. Local paths and private deployment locations are redacted. Local-only evidence is catalogued in provenance; its links are not copies of the raw evidence. See [current status](current-status.md) and [source/hash inventory](provenance/source-manifest.json).


本文件记录远洋渔业素材中心的服务器验证方式。它是内部回环试验，不是生产上线或业务审核结论。现有网站、Nginx、公网入口和发布调度不属于这个项目。

## 独立资源

- 主机：`[private-ssh-target]`；目录：`[private-server-or-temporary-path]`。
- Compose 项目：`fishery-pilot`；配置：`modules/fishery/deploy/compose.yaml`。
- 网页：服务器 `127.0.0.1:39871`；API：服务器 `127.0.0.1:39872`。
- 专用数据库：`fishery_pilot_test`，仅在项目 Docker 网络内使用，不发布宿主端口。
- 专用卷：`fishery-pilot_db`、`fishery-pilot_data`；网络：`fishery-pilot_pilot`。
- 专用镜像：`fishery-pilot-app:linux-pdf-v1`；Node 24 Debian trixie 镜像中安装发行版 `poppler-utils`，不修改宿主 Node 或系统包。
- `setup` 只执行迁移，不导入演示信源；没有 worker。采集、模型、飞书推送及 IndexNow 阀全部关闭。三来源采集仅由一次性命令明确触发。

这个测试不创建持久认证密钥：非生产 API 使用开发管理员身份，PostgreSQL 只在无宿主端口映射的专用网络内使用 trust。因而不能直接改成公网监听、接反向代理或混用生产数据；生产鉴权需要另外设计和审核。容器设置内存/CPU上限，重启策略为 `no`，不宣称具备生产可用性或重启自愈。

## PDF 行为

`backend/pdf-text.ts` 从归档字节创建私有临时快照，哈希与全部解析命令读取同一份字节，退出后清理。Linux 记录 `pdfinfo` 和 `pdftotext` 版本，逐页提取并保留页码；macOS 延用系统 PDFKit，先检查真实文本再添加页码。

限制为原件 10 MiB、最多 200 页、整份文档共享 60 秒预算、每个命令以及累计文本最多 4 MiB。缺解析器、加密、异常诊断、超时、无文字、损坏或超限不会成为可导出正文。不做 OCR，不传密码，不绕过 PDF 权限。版本、正文哈希或附件哈希变化都属于新 observation，旧审核不能继续放行。

Linux 的实际软件包版本和镜像 ID 记在本任务验证回执中。macOS 的 parser 标记仍为 `Apple PDFKit/v1`，暂未包含系统/PDFKit 实际版本；不据此保证系统升级后自动识别版本变化。

## 启停与回退

以下命令只在上述服务器专用目录执行：

```sh
cd [private-server-or-temporary-path]
docker compose -p fishery-pilot -f modules/fishery/deploy/compose.yaml ps -a
docker compose -p fishery-pilot -f modules/fishery/deploy/compose.yaml stop
docker compose -p fishery-pilot -f modules/fishery/deploy/compose.yaml start fishery-db api web
```

需要撤去本试验的容器和网络时，可在停止后执行 `docker compose -p fishery-pilot -f modules/fishery/deploy/compose.yaml down`；不加 `-v`，保留证据数据库和数据卷。不停止或重启其他 Compose 项目，不修改 Nginx、防火墙、DNS 或代理。恢复容器使用同目录 `up -d --no-build`，setup 的迁移是幂等的。

可用现有 SSH 身份做临时本机转发查看后台；本机已存在同端口试验时，可另选 `49871`、`49872` 映射服务器 `39871`、`39872`。本文件不启动隧道、不保存新凭据。`SITE_URL` 是服务器回环测试地址，不是对外分享地址。

## 验证范围与限制

核验包括：Linux 镜像中的合成有效、空白、加密和损坏 PDF；本地全套类型检查、数据库和 Web 回归；服务器全站冒烟；三固定来源的新网络收据及原件；独立数据库里的待审、错误 CSRF、审核版本、许可版本、附件/正文修订和撤回门禁。

真实来源许可保持未知，真实 primary 文档没有业务审核。审核演练仅使用单独的 `ISOLATED TEST` 副本和 `example.org` 合成许可，导出带测试警示；成功导出的副本在演练结束后撤回，获取失败的副本即便有测试审核也始终拒绝导出。Pending 异议截止日不写为生效日，2027/2028 条款不写成 2026 已实施；404 不使用搜索缓存补正文，也不推断官方撤稿。

本轮结果：完整类型检查通过；后端957项、Web59项、Linux容器模块14项和全站30项冒烟均通过。服务器实时验收76项HTTP断言全部符合预期。晋江于09:01:30 UTC获取HTTP200，正文2053字节；IOTC页面及PDF于09:01:44—56 UTC获取HTTP200，PDF285120字节、5页，使用Poppler25.03.0提取。附件SHA-256为`6d60080cf90f9fe7f0e960b28e73c8f23e24764bcf7d12f240d6ad3c09dac44e`，与此前同一原件一致。福州09:01:59 UTC返回HTTP404、3448字节错误响应，无正文。

隔离库有69条迁移、6个来源配置、7个文档、10次观察、9条测试审核、3个已撤回测试文档；真实来源审核0、模型回执/尝试0，公开动态0条。原6容器ID保持一致，启动时间均早于本次部署；Nginx仍为原进程、80/443监听保持原状。一次资源快照中本项目三常驻容器约283MiB，宿主可用内存约2.14GiB、磁盘余量30.60GiB；这是瞬时采样，不是峰值或压力测试。

没有验证长期采集、OCR、真实转载许可、法律适用性、付费模型准确率、Easel交付、平台发布/撤回、灾难恢复或生产容量。已下载的离线文件不能远程撤回。运行结果以任务目录 `server-deployment-checks/` 的日志和最终验收回执为准。
