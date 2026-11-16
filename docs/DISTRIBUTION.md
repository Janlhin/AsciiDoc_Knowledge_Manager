# ADKM 分发与自动更新（R9 起；构建产物名已改为 adkm）

> 商业分发的两条签名是不同的东西，别混：
> 1. **更新签名（minisign）**——tauri-plugin-updater 校验更新包用，本地生成密钥，**已落地**。
> 2. **Windows 代码签名（Authenticode）**——防 SmartScreen 拦截，需购买证书，
>    已留好配置位（见下），购证后填入即可。

## 更新签名密钥（minisign）

- 密钥对在 `.tauri-keys/adkm.key`（私钥）+ `adkm.key.pub`（公钥），**gitignore，永不入库**；口令单独存放在 `.tauri-keys/adkm.key.pass.txt`（同样 gitignore）。
- 公钥已写进 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`。2026-11-16 已轮换：新公钥 ID `8018A0ACD0AB5712`，旧 `geode` 密钥对作废弃用（此前口令曾以明文写在本文件，随历史重写一并清除）。
- **私钥或口令丢失 = 永远无法向已装机用户推送更新**（公钥烧在已分发的安装包里）。请把 `.tauri-keys/` 备份进密码管理器或离线介质，备份完成后删掉本机的 `adkm.key.pass.txt`。
- 密钥必须带密码：**Windows 无法表达空字符串环境变量**，空密码密钥在 Windows 上构建会卡在交互式密码提示。

## 发布一个新版本

1. 五处版本号同步 bump：`package.json`、`package-lock.json`（根与 `packages[""]` 各一处）、
   `src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`。
   About 页版本取自 `package.json`（`PRODUCT.version`），不需要另改文案。
2. 设置签名环境变量后构建：

   ```powershell
   # 变量要的是私钥【内容】（或改用 TAURI_SIGNING_PRIVATE_KEY_PATH 传绝对路径）
   $env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content .tauri-keys/adkm.key -Raw)
   $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<密钥密码>"
   npm run tauri build
   ```

3. 产物在 `src-tauri/target/release/bundle/nsis/`：
   - `ADKM_<version>_x64-setup.exe` —— 安装包（同时就是更新包）
   - `ADKM_<version>_x64-setup.exe.sig` —— minisign 签名（`createUpdaterArtifacts: true` 生成）
4. 编写/更新 `latest.json`（官方静态 manifest 格式）：

   ```json
   {
     "version": "0.9.0",
     "notes": "更新说明",
     "pub_date": "2026-06-11T00:00:00Z",
     "platforms": {
       "windows-x86_64": {
         "signature": "<.sig 文件的完整内容>",
         "url": "https://github.com/Janlhin/AsciiDoc_Knowledge_Manager/releases/download/v0.9.0/ADKM_0.9.0_x64-setup.exe"
       }
     }
   }
   ```

5. 把 setup.exe + latest.json 上传到发布渠道。当前 `tauri.conf.json` 的 endpoint 指向本仓库
   `https://github.com/Janlhin/AsciiDoc_Knowledge_Manager/releases/latest/download/latest.json`；
   仓库一旦转 public 并发布第一个 release，这条链路即可用，无需再改。

## 客户端更新链路（已实现）

- `core/update.ts`：`checkForUpdate()` / `downloadAndInstallUpdate(onProgress)`，浏览器模式
  `updateSupported() === false` 全程降级。
- 设置页 About 节"检查更新"区 + 命令 `app:check-updates`；下载校验 minisign 签名后走 NSIS
  `passive` 静默安装并自动重启（`plugins.updater.windows.installMode`）。
- 签名校验是硬门槛：manifest 的 `signature` 与下载字节对不上即拒绝安装（R9 桌面实测含
  篡改签名负向用例）。

## Windows 代码签名配置位（购证后启用）

`src-tauri/tauri.conf.json` 增加（示例为 Azure Trusted Signing；本地 PFX 用 signtool 形态）：

```json
{
  "bundle": {
    "windows": {
      "signCommand": "trusted-signing-cli -e https://wus2.codesigning.azure.net -a <Account> -c <Profile> -d ADKM %1"
    }
  }
}
```

- `%1` 会被替换为待签文件路径；NSIS 安装器与 exe 都会经此命令签名。
- 没有这一步应用照常可分发，但 SmartScreen 会对低信誉下载弹黄条——商业上线前必须补。

## 本地验证更新链路（开发口径，R9 实测过程）

1. 以"新版本"配置构建一次（endpoint 指向 `http://localhost:17321/latest.json` +
   `"dangerousInsecureTransportProtocol": true`，仅测试构建用，**不得提交**）。
2. 以"旧版本"号再构建一次作为被更新方；用任意静态服务器在 17321 端口伺服
   `.update-test/`（latest.json + 新版 setup.exe）。
3. CDP 驱动旧版 `checkForUpdate()` → 应报新版本；`download()` 成功 = 签名链路通；
   把 latest.json 的 signature 改一个字符 → download 必须失败（负向用例）。
