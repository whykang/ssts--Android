# 安卓 / iOS / Mac 局域网 MCP 插件开发

设置 → **MCP 插件开发** → 开启服务。默认关闭，不随应用启动自动开启。
跨设备连接时，电脑和手机连接同一局域网，在 AI 客户端添加 **Streamable HTTP** 服务；复制应用显示的连接配置即可。
客户端必须能访问设备地址，云端连接器不能直接访问私人局域网。

例如（地址以应用显示为准）：

```json
{
  "mcpServers": {
    "ssts": {
      "type": "http",
      "url": "http://192.168.1.20:8765/mcp"
    }
  }
}
```

不同 AI 客户端的配置外层格式可能不同；只需填写 HTTP 地址，不需要令牌或认证请求头。
界面分开显示“局域网地址”和“本机访问地址”，点击地址即可复制。
局域网地址优先 Wi-Fi，其次有线网络，供电脑等其他设备连接；本机地址为 `http://127.0.0.1:8765/mcp`，仅供当前设备上的客户端使用。
复制连接配置优先使用局域网地址，无局域网地址时使用本机地址。
端口为 8765；被占用时界面显示启动失败。连接超时时检查 Wi-Fi 客户端隔离、防火墙和设备地址是否变化。
不需要在应用里配置 AI 模型或模型 API Key。

## 开发流程

`plugin_guide` 返回四端通用插件 API 文档。同一个 `manifest.json` + JavaScript ZIP 插件包可在 Android、iOS、Mac、Windows 导入。本文的 MCP 服务连接与运行说明对应本仓库提供的安卓、iOS、Mac 实现。

可以对 AI 说：“先读取随身听书插件文档，制作这个网站的插件，测试搜索、目录和音频解析，通过后安装并导出 ZIP。”

| 工具 | 作用 |
|---|---|
| `plugin_guide` | 获取内置插件 API 文档及开发流程 |
| `plugin_list` | 列出草稿、已安装插件和备份 ID |
| `plugin_read` | 读取草稿、已安装插件或备份中的 JS / JSON |
| `plugin_write` | 原子替换整个草稿，传入文件名到 UTF-8 文本的 `files` 对象 |
| `plugin_validate` | 用目标设备真实引擎加载草稿，返回注册源；会执行脚本 |
| `plugin_test` | 测试 `search`、`categoryMenus`、`categoryPage`、`bookDetail`、`audio` |
| `plugin_install` | 安装草稿；先备份被替换版本，安装后刷新插件列表 |
| `plugin_restore` | 按备份 ID 恢复，恢复前也备份当前版本 |
| `plugin_export` | 导出标准 ZIP，返回文件名、SHA256、Base64 内容 |

测试参数与源 API 相同，放进 `arguments` 数组：

```json
{"id":"my-source","sourceId":"源的固定ID","method":"search","arguments":["三国",1]}
{"id":"my-source","sourceId":"源的固定ID","method":"bookDetail","arguments":["书籍地址",true,true]}
{"id":"my-source","sourceId":"源的固定ID","method":"audio","arguments":["章节地址"]}
```

正常工具结果在 `value` 内，另外提供 `elapsedMs` 和最多 100 条插件日志。错误返回 `isError: true`。
测试会检查基本返回形状，**音频解析成功不代表实际播放一定成功**；音频仍需播放验证。
每次测试重新加载草稿，草稿自己的偏好设置会保留，脚本全局内存不会跨测试调用保留。

## 安装和数据

- 草稿 ID 使用 1–64 个英文字母、数字、下划线或短横线。
- 新草稿由根目录 `manifest.json` 和 `.js` 文件组成，`manifest.scripts` 明确列出脚本。子目录和外部路径不接受。
- `plugin_write` 是完整替换，修改一个文件时也要带上需要保留的其他文件。
- 草稿最多 32 个 JS 文件、合计 4 MB。读取、备份导出最多 128 个文件、合计 4 MB。
- 草稿、备份和调试偏好保存在应用私有的 `mcp/` 目录，正式插件仍在 `plugins/`。
- 每次开启服务时默认允许远程安装 / 恢复插件，可在应用设置关闭此开关；服务关闭会撤销这个权限。
- 同名插件按现有命名规则替换，旧版先备份；语法错误或加载失败不覆盖旧插件。保留已发布源的固定 ID。
- 导出的 `base64` 解码后就是 ZIP，可继续通过现有“从文件导入”安装；不包含草稿偏好和调试缓存。

## 连接与运行

服务不使用配对令牌，开启后可直接通过局域网地址连接。HTTP 服务不提供 TLS。
拒绝带浏览器 `Origin` 的请求，不启用 CORS；只接受本地网络或回环地址的连接。
“最近连接”显示最近握手的客户端名称，不表示客户端此刻仍保持在线。

安卓使用可关闭的前台服务及通知；不自动重启。Android 15 的 dataSync 前台服务时间到期时会关闭服务。
iOS 必须保持应用前台，开发时可保持屏幕常亮；进入后台后立即关闭服务并恢复原有休眠设置。
常亮仅在 iOS 服务运行时生效，开启后不会用静音播放维持后台运行。
Mac 可保持后台服务，窗口隐藏后仍能连接；退出应用或手动关闭服务后监听关闭。
Mac 的 Debug / Release 均开启沙盒入站网络能力，并提供本地网络用途说明。
本机 AI 可使用 `http://127.0.0.1:8765/mcp`，其他设备使用显示的局域网地址。

调试偏好与正式插件隔离，插件日志做常见令牌 / 密码字段脱敏。网络和 WebView 使用本机实际环境，
因此仍可能访问已登录网站的 Cookie；这是可信代码的开发工具，不是恶意脚本的安全沙箱。
同一时刻只执行一项插件操作，其他工具调用返回忙，请顺序调用。
网络和 WebView 沿用宿主超时、取消机制；本版本无法安全强制终止纯 JavaScript 死循环，
也不保证 MCP 取消通知能终止已执行的脚本。脚本卡死时关闭应用后重新打开。

## 协议与验证

实现 `/mcp` 上的无会话 Streamable HTTP，支持 `initialize`、`notifications/initialized`、`ping`、`tools/list`、`tools/call`。
协商版本为 `2025-03-26`、`2025-06-18` 或 `2025-11-25`；新版本客户端需支持协商回退。
POST 返回 JSON，通知返回 202，无独立 SSE 推送，GET 返回 405，不使用认证请求头。
遵循 [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) 的 JSON 响应模式。

三端均用官方 TypeScript MCP SDK，在独立安卓模拟器 / iOS 模拟器以及 Mac 实际应用的隔离资料目录中验证：
握手、九个工具、真实 HTTP 请求、WebView 渲染、偏好隔离、日志脱敏、路径限制、
安装备份 / 恢复、错误插件不覆盖旧版、ZIP 解码 / CRC / SHA256。另验证安装权限开关、
iOS 退到后台关闭监听，以及协议输入和 HTTP 分片 / 大小限制。未替代实体手机的局域网联调。

复测脚本为 `scripts/tests/mcp-smoke.mjs` 与 `scripts/tests/mcp-fixture-server.py`；
安卓入口 `McpHostSessionTest`，Apple 协议测试 `ssts-ios/tests/McpTransportTests.swift`。
执行 `python3 scripts/generate-mcp-assets.py` 可同步生成三端工具目录和内置开发文档。

Mac 已加入同样九个工具，TV 未修改、未构建。
