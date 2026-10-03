// 本插件包中各源共用的辅助方法
var Shun = (function () {
  var AUDIO_EXTS = ['.m4a', '.mp3', '.m4b', '.flac', '.aa3', '.ogg', '.wma', '.wav', '.aac', '.ac3', '.mp4'];

  // “不存在的元素”：数组越界时返回它，后面可以继续 .text() / .absUrl()
  var none = {
    exists: function () { return false; },
    text: function () { return ''; },
    ownText: function () { return ''; },
    attr: function () { return ''; },
    absUrl: function () { return ''; },
    first: function () { return none; },
    select: function () { return []; }
  };

  return {
    none: none,
    enc: function (s) { return encodeURIComponent(s); },

    /** 数组的第 n 个元素，越界返回“不存在的元素” */
    nth: function (list, n) { return list && n < list.length ? list[n] : none; },

    /** 在 selector 选中的元素中找文字包含 text 的第一个 */
    findByText: function (node, selector, text) {
      if (!node || !node.exists()) return none;
      var list = node.select(selector);
      for (var i = 0; i < list.length; i++) if (list[i].text().indexOf(text) >= 0) return list[i];
      return none;
    },

    /** 去掉“作者：”“播音：”这类标签前缀 */
    stripLabel: function (text) {
      return (text || '').replace(/^\s*[一-龥A-Za-z]{1,4}\s*[：:]\s*/, '').trim();
    },

    /** 还原脚本字符串里的转义（\/、\uXXXX） */
    unescape: function (s) {
      try { return JSON.parse('"' + s.replace(/"/g, '\\"') + '"'); }
      catch (e) { return s.replace(/\\\//g, '/'); }
    },

    /** 地址中包含常见音频扩展名 */
    containsAudioExt: function (url) {
      var u = url.toLowerCase();
      return AUDIO_EXTS.some(function (e) { return u.indexOf(e) >= 0; });
    },

    getDoc: function (host, url, desktop, referer, encoding) {
      var o = { desktop: !!desktop };
      if (referer) o.headers = { Referer: referer };
      if (encoding) o.encoding = encoding;
      return host.getHtml(url, o);
    },

    /** 封面地址包含 domain 时加上 Referer（防盗链） */
    coverReferer: function (domain, referer) {
      return function (coverUrl) { return coverUrl.indexOf(domain) >= 0 ? { Referer: referer } : null; };
    },

    hostOf: function (url) { return url.replace(/^https?:\/\//, '').split('/')[0]; },

    /** 这类站点的播放页里用 var now="音频地址" 保存当前音频；取不到时回退为 WebView 嗅探 */
    varNowAudio: function (host, url, desktop) {
      var html = host.getString(url, { desktop: desktop });
      var m = /var\s+now\s*=\s*["']([^"']+)["']/.exec(html);
      var audio = m ? Shun.unescape(m[1]) : '';
      if (audio.indexOf('http') === 0) return audio;
      return host.sniff(url, { desktop: desktop, validate: Shun.containsAudioExt });
    },

    /** APlayer 脚本里的音频列表：name: "..", artist: "..", url: ".." */
    aplayerItems: function (html) {
      var re = /name:\s*"((?:[^"\\]|\\.)*)"\s*,\s*artist:\s*"((?:[^"\\]|\\.)*)"\s*,\s*url:\s*"([^"]+)"/g;
      var list = [], m;
      while ((m = re.exec(html)) !== null) {
        var url = Shun.unescape(m[3]);
        if (url.indexOf('//') === 0) url = 'https:' + url;
        list.push({ title: Shun.unescape(m[1]), artist: Shun.unescape(m[2]), url: url });
      }
      return list;
    }
  };
})();
