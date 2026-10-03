# 插件开发指南（安卓版）

程序本身不带任何源，所有源都由插件提供。安卓版的插件是一个 **zip 压缩包**，里面是一个 `manifest.json` 和若干 JavaScript 脚本；
一个插件里可以注册任意多个源。在 App 的“插件”页点 `+` →“从文件导入 zip”或“从网址导入”即可安装，重新导入同名插件就是升级。

> Windows 版的插件是 .NET DLL，安卓上无法加载，所以安卓版改用脚本。接口和 Windows 版的 `SourceBase` 一一对应，移植基本是逐行翻译。

完整示例：[plugins/ShunSources](../plugins/ShunSources)，18 个源，覆盖了本文提到的大部分写法。

## 1. 插件包结构

```
MySources.zip
├─ manifest.json
├─ common.js
└─ sites.js
```

zip 里可以多套一层同名目录。`manifest.json`：

```json
{
  "name": "MySources",
  "version": "1.0.0",
  "author": "作者名",
  "description": "显示在插件页面上的说明",
  "scripts": ["common.js", "sites.js"]
}
```

`scripts` 按顺序执行，所有脚本共用一个全局作用域（前面的脚本定义的函数，后面的可以直接用）。
没有 `manifest.json` 时，按文件名顺序执行包里的所有 `.js`。

## 2. 编写一个源

```js
registerSource({
  id: '0f9c0b5c2d7e4c1b9a0e6f3a2b1c4d5e',   // 唯一 ID，发布后不要改
  name: '我的站点',
  url: 'https://example.com',

  search: function (keywords, page) {
    var doc = this.host.getHtml('https://example.com/search?q=' + encodeURIComponent(keywords) + '&p=' + page);
    var books = doc.select('.item').map(function (e) {
      return { coverUrl: e.first('img').absUrl('src'), bookUrl: e.first('a').absUrl('href'), title: e.first('h3').text() };
    });
    return { books: books, totalPage: regexInt(doc.first('.total').text(), /(\d+)/, page) };
  },

  bookDetail: function (bookUrl, loadEpisodes, loadFullPages) {
    var doc = this.host.getHtml(bookUrl);
    return {
      episodes: doc.select('#playlist a').map(function (a) { return { title: a.text(), url: a.absUrl('href') }; }),
      intro: doc.first('.intro').text()
    };
  },

  audio: function (episodeUrl) {
    return this.host.getHtml(episodeUrl).first('audio').absUrl('src');
  }
});
```

所有方法都在后台线程执行，而且是**同步**的：网络请求直接拿返回值，不需要 `await` / 回调。
脚本引擎是 Rhino（ES5 加上 `let` / `const`、箭头函数、模板字符串等部分 ES6），不支持 `class`、`async`、展开运算符、可选链，保守起见按 ES5 写。
脚本只能使用宿主提供的对象，不能访问 Java 类和文件系统。

### 源对象的成员

| 成员 | 说明 |
|---|---|
| `id` | 源的唯一 ID，书架、设置、章节缓存都以它为准，发布后不要改 |
| `name` / `url` / `description` | 名称、网址、说明（显示在插件页面） |
| `group` | 分组，默认“听书” |
| `multipleEpisodePages` | 章节分多页，见第 6 节 |
| `enabledByDefault` | 首次导入时是否启用，默认 true |
| `search(keywords, page)` | 搜索，返回 `{ books, totalPage }`；不知道总页数时，确定有下一页就返回 `page + 1`。不写这个方法就不参与聚合搜索 |
| `categoryMenus()` | 分类菜单：`[{ title, tabs: [{ title, url }] }]`。不写就不出现在“发现”页 |
| `categoryPage(url)` | 分类的一页书：`{ books, currentPage, totalPage, nextUrl }`，`nextUrl` 为空表示没有下一页 |
| `bookDetail(bookUrl, loadEpisodes, loadFullPages)` | 详情与章节：`{ episodes, intro, author, artist, coverUrl, title, status }`，除章节外的字段不为空时会补充到书籍信息里 |
| `audio(episodeUrl)` | 把章节地址解析成音频地址，见第 3 节。不写表示章节地址本身就是音频 |
| `host` | 宿主注入的能力，见第 4 节 |

书：`{ coverUrl, bookUrl, title, author, artist, intro, status }`，`bookUrl` 在同一个源内必须唯一。
章节：`{ title, url, isFree }`，`isFree` 默认 true。

分类标签的地址不一定是网址，可以是任意字符串，宿主只会把它原样传回 `categoryPage`，例如 `my-search:关键词#1`。

## 3. 音频提取

`audio(episodeUrl)` 返回音频地址字符串，或者 `{ url, headers }`。常见写法：

| 场景 | 写法 |
|---|---|
| 章节地址本身就是音频 | 不写 `audio` |
| 从章节网页的 HTML 里取 | `this.host.getHtml(url).first('audio').absUrl('src')` |
| 章节地址返回 JSON | `str(this.host.getJson(url), 'data.url')` |
| 要执行页面脚本才有地址 | `this.host.render(url, { desktop, script, parse })`：用 WebView 打开页面，反复执行 `script`（默认返回整个 HTML），直到 `parse(结果)` 返回非空 |
| 嗅探页面发出的音频请求 | `this.host.sniff(url, { desktop, validate, script })`：`validate(地址)` 判断哪个请求是音频（默认按扩展名），`script` 是可选的触发播放脚本（宿主也会自动点击常见播放器的播放按钮） |

播放地址带时效签名的，就在 `audio` 里每次现取。WebView 方式比普通请求慢得多，能用普通请求就不要用 WebView。
取不到时直接 `throw new Error('原因')`，原因会显示给用户。

播放时宿主会附带 UA 和 `audioHeaders` 提供的请求头；播放前会先探测地址，404 / 410 会提示“音频文件已失效”。

## 4. 宿主能力（this.host）

| 成员 | 说明 |
|---|---|
| `getString(url, options)` | 请求文本，自动识别 GBK / UTF-8 等编码；非 2xx 状态码会抛出错误，`e.status` 是状态码 |
| `getHtml(url, options)` | 请求并解析 HTML，返回文档元素（见第 7 节） |
| `getJson(url, options)` | 请求并解析 JSON（兼容 JSONP） |
| `getStrings(urls, options, concurrency)` | 并发请求多个地址，返回文本数组，失败的位置是 `null` |
| `finalUrl(url, options)` | 跟随跳转后的最终地址 |
| `fetch(url, options)` | 请求并返回 `{ status, body }`；和 `getString` 不同，非 2xx 状态码不会抛出错误（有的接口把错误原因放在响应内容里） |
| `status(url, options)` | 只返回 HTTP 状态码，不下载内容（探测音频地址能不能访问时用，记得带上 `Range` 头） |
| `parseHtml(html, baseUrl)` | 解析一段 HTML |
| `render(url, { desktop, script, parse, timeout })` | 用 WebView 加载页面，见第 3 节。`timeout` 单位毫秒，默认 25000 |
| `sniff(url, { desktop, validate, script, timeout })` | 用 WebView 打开页面并嗅探音频地址 |
| `cookies(url)` | 某个地址当前的 Cookie，格式 `a=1; b=2` |
| `getPref(key, 默认值)` / `setPref(key, value)` | 源自己的配置，宿主会持久保存 |
| `toast(message)` | 界面提示 |
| `log(message)` | 调试日志，显示在插件页面的“日志”里 |
| `progress(info)` | 加载多页章节时报告进度（例如 `"3 / 20"`），传 `null` 表示结束 |
| `sleep(毫秒)` | 等待 |
| `readCache(name)` / `writeCache(name, text)` / `cacheAge(name)` | 源独立的缓存文件；`cacheAge` 返回距今多少毫秒，不存在为 -1 |
| `base64Decode` / `base64Encode` / `md5` / `sha256` / `uuid()` / `htmlDecode` | 常用工具 |
| `userAgent(desktop)` | 用户在设置里配置的 UA |

请求选项 `options`：

| 字段 | 说明 |
|---|---|
| `desktop` | true 用电脑版 UA，false（默认）用手机版 UA |
| `method` / `body` / `contentType` | POST 等请求，`body` 默认按表单（`application/x-www-form-urlencoded`）发送 |
| `headers` | 额外请求头，例如 `Referer`、`Origin`、`Cookie` |
| `encoding` | 强制按指定编码解码（例如 `"gbk"`），默认自动判断 |

**Cookie 是共享的**：普通请求和 App 里的 WebView（登录页、验证页、`render` / `sniff`）用同一份 Cookie，
用户登录或通过人机验证之后，后续请求自动带上，不需要额外处理。

## 5. 可选成员

| 成员 | 作用 |
|---|---|
| `audioHeaders(audioUrl)` | 播放音频时附加请求头（例如 `Referer` 防盗链），返回 `{ ... }` 或 `null` |
| `coverHeaders(coverUrl)` | 加载封面时附加请求头，返回 `{ ... }` 或 `null`。先判断封面地址属于自己 |
| `loginUrl` / `loginDesktop` | 需要登录的源：插件页面会出现“登录”按钮，在 App 内的网页里完成登录 |
| `searchVerificationUrl(keywords)` | 搜索需要人机验证：搜索失败或没有结果时，搜索页会出现“验证”按钮，用户通过验证（页面标题不再包含“验证”）后自动返回并重新搜索。配合 `searchVerificationDesktop`（默认 true）、`searchDelaySeconds`（网站限制两次搜索最小间隔时用） |
| `updateEpisodes(bookUrl, known)` | 增量更新章节，见第 6 节 |
| `config` | 设置项数组，插件页面会出现“设置”按钮：`{ type: 'text' | 'switch' | 'select', key, label, default, options }`，值用 `this.host.getPref(key)` 读取 |
| `onPlaybackState(state)` | 接收播放状态：`playing` / `paused` / `stopped` / `error` |

## 6. 章节很多的书

### 分页章节

章节分很多页的网站，把 `multipleEpisodePages` 设为 true，并按 `loadFullPages` 区分：

- `loadFullPages == false`：只返回第一页章节，要快；
- `loadFullPages == true`：返回全部章节，逐页加载时用 `host.progress(i + ' / ' + total)` 报告进度，结束时 `host.progress(null)`（放在 `finally` 里）。

第一次打开这类书时，宿主会先用 `false` 取第一页立即显示，用户可以马上开始播放，再用 `true` 在后台加载全部章节。

### 增量更新（updateEpisodes）

宿主会为书架上和播放过的书缓存章节列表。默认每次打开详情页都会整本重新加载；章节很多、或者网站限制访问频率时，
实现 `updateEpisodes(bookUrl, known)`：`known` 是缓存的章节（按网站原始顺序），返回包含完整章节列表的详情；返回 `null` 表示无法增量更新，宿主会退回整本加载。
示例见 `sites.js` 里的“爱听书”。

### 访问频率限制

部分网站返回 HTTP 429 后会封一段时间。逐页加载时页与页之间用 `host.sleep` 留出间隔；遇到 429（`e.status === 429`）等一段时间再试，
重试几次仍不行就先返回已加载的部分并用 `host.toast` 说明，配合 `updateEpisodes` 让下次接着加载。

## 7. HTML 与 JSON 辅助

HTML 元素（`getHtml` / `parseHtml` 的返回值，以及 `select` 出来的每一项）：

| 方法 | 说明 |
|---|---|
| `select(selector)` | 查找所有元素（CSS 选择器），返回普通的 JS 数组，可以 `map` / `filter` / `forEach` |
| `first(selector)` | 查找第一个元素。找不到时返回一个“空元素”，可以继续调用下面的方法 |
| `exists()` | 元素是否存在 |
| `text()` / `ownText()` | 去掉首尾空白、合并连续空白的文本 / 只取元素自身的文本 |
| `attr(name)` / `absUrl(name)` | 读取属性 / 读取属性并转成绝对地址，不存在返回空字符串 |
| `html()` / `outerHtml()` / `tag()` / `hasClass(name)` | 内部 HTML / 完整 HTML / 标签名 / 是否有某个 class |
| `children()` / `parent()` / `byId(id)` | 子元素数组 / 父元素 / 按 id 在整个文档里找 |

所以 `doc.first('.intro').text()` 不需要判空。

JSON 用全局函数读取，路径用点分隔，数组下标直接写数字：

```js
var json = this.host.getJson(url);
var name = str(json, 'data.list.0.name');   // 字符串，不存在返回 ''
var count = int(json, 'data.total', 0);      // 整数
items(json, 'data.list').forEach(function (item) { /* ... */ });   // 数组，不存在返回 []
at(json, 'data.pageQuery');                  // 任意节点，不存在返回 null
```

另有 `regexInt(文本, /正则(\d+)/, 默认值)` 和 `parseJson(text)`。

## 8. 调试

在手机上：“插件”页点开一个源 →“测试”，会依次测试分类、搜索、详情和音频解析；结果和 `host.log` 的输出都在右上角的“日志”里。
改完脚本后重新打包、重新导入同名插件即可覆盖旧版本。

## 9. 打包

把 `manifest.json` 和脚本压成 zip 即可，用任意压缩软件都行。命令行：

```bash
cd plugins/ShunSources && zip -r ../dist/ShunSources.zip . -x '.*'
```

## 10. 安全提示

插件脚本运行在受限环境里（不能访问 Java 类和文件系统），但它可以访问网络、读取 App 内网页的 Cookie。**只导入你信任的来源提供的插件**。
