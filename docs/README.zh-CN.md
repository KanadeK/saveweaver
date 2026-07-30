# SaveWeaver 中文说明

**让 CI 对玩家已经拥有的旧存档负责。**

SaveWeaver 是一个与游戏引擎无关的 CLI、JavaScript 库和 GitHub Action。它把旧版 JSON
存档沿声明式迁移链升级到当前版本，并在 CI 中用真实存档夹具验证：

- 源版本、每个中间版本和目标版本的 Schema；
- 迁移链是否完整、唯一且只向前；
- 同一输入重复迁移是否产生完全相同的 SHA-256；
- 当前版本再次迁移是否保持不变；
- 已发布迁移或 Schema 是否被悄悄改写；
- 实际写入是否有备份、原子替换和可复核回执。

它不只是一个界面。仓库中的 `examples/space-ranger` 有三代 Schema、两段迁移和四份真实
夹具，涵盖数组成员字段改名、数据拆分、默认值、枚举映射和数值重平衡。

## 立即验收

需要 Node.js 20 或更新版本，无运行时依赖：

```sh
node bin/saveweaver.js matrix --project examples/space-ranger
node bin/saveweaver.js lock --project examples/space-ranger --check
node scripts/verify.mjs
```

最后一条命令会运行静态检查、格式检查、89 项测试和覆盖率门槛，随后生成 npm tarball、
便携 ZIP、SHA-256 清单，并在干净临时目录安装产物、调用已安装 CLI 再跑一次兼容矩阵。

## 接入自己的游戏

```sh
saveweaver init save-contract
cd save-contract
saveweaver check
```

初始化只允许空目录，避免覆盖现有数据。之后把每个已发布版本的 Schema 放入
`schemas/`，把真实脱敏存档放入 `fixtures/`，再按顺序添加迁移文件。

预览迁移：

```sh
saveweaver plan player-save.json --project save-contract
saveweaver migrate player-save.json --project save-contract --dry-run
```

写到新文件：

```sh
saveweaver migrate player-save.json \
  --project save-contract \
  --out player-save-current.json
```

原地升级必须显式使用 `--in-place`。SaveWeaver 会先在 `.saveweaver-backups/` 写入按源
内容哈希命名的备份，再通过临时文件原子替换，并生成包含输入/输出哈希、迁移哈希和字段
变化的回执。

## CI

```yaml
- uses: KanadeK/saveweaver@v0.1.1
  with:
    project: path/to/save-contract
```

发布新存档版本时，先添加新 Schema 和迁移，再加入至少一份上一公开版本的真实脱敏
存档夹具，执行：

```sh
saveweaver lock
saveweaver check
```

详细格式见[迁移规范](migration-format.md)，失败处理见[修复手册](repair-playbook.md)，
完整验收命令见[验收说明](acceptance.md)。
