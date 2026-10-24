# 当前隔离部署检查点

> Archived project snapshot; dates and claims describe that stage, not current live state. Local paths and private deployment locations are redacted. Local-only evidence is catalogued in provenance; its links are not copies of the raw evidence. See [current status](../../../current-status.md) and [source/hash inventory](../../../provenance/source-manifest.json).


已获用户批准安装两项官方依赖；PG/API/Web已启动，最终953项DB、59项Web及30项smoke通过。旧原件离线回放和仅隔离数据的测试审核闭环完成，64次HTTP检查符合预期。网络实时采集仍被SSRF保留地址检查拒绝，未改网络或防护。

当前汇总见[completion.json (local original; provenance)](../../../provenance/source-manifest.json)，完整验收与复现命令见仓库docs/fishery-center/local-pilot.md，启停脚本为pilot-control.py。安装前检查点另保留为checkpoint-before-install.md，不再将其中“依赖待批准/实例未启动”当作当前状态。

本地提交完成：`5561f0b7ca62e79b224021b4748da94861815c40`；仓库工作区干净，未push。最终commit及实际DB/运行状态已写入completion.json。
