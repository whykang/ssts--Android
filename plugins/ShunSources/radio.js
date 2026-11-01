// 广播电台：每个电台是一本“书”，第一集是“直播”（带 live 标记，宿主据此按直播来播放：不能拖动、不记进度）；
// 云听里央广的电台还能回听：直播后面是最近几天播过的节目，是普通的音频，能拖动、记进度。
// 以前是程序内置的源，挪到插件里以后编号没变，书架上已有的电台照样能听。

// ---------- 云听（央广）：全国各地的广播电台 ----------
(function () {
  var API = 'https://ytmsout.radio.cn';
  var KEY = 'f0fc4c668392f9f9a447e48584c214ee'; // 网页版接口的签名密钥
  var INDEX_CACHE = 'stations.json';
  var INDEX_LIFETIME = 24 * 3600 * 1000;

  var REPLAY_DAYS = 7; // 回听列出最近几天的节目

  // 接口要求把参数、时间戳和密钥拼起来做 MD5 签名（参数要按名字的字母顺序排，否则报“验签错误”）
  function request(host, path, query) {
    var ts = String(Date.now());
    var sign = host.md5((query ? query + '&' : '') + 'timestamp=' + ts + '&key=' + KEY).toUpperCase();
    return {
      url: API + path + (query ? '?' + query : ''),
      options: { headers: { equipmentId: '0000', platformCode: 'WEB', timestamp: ts, sign: sign, 'Content-Type': 'application/json' } }
    };
  }

  function call(host, path, query) {
    var r = request(host, path, query);
    var json = host.getJson(r.url, r.options);
    if (int(json, 'code') !== 0) throw new Error('云听：' + (str(json, 'message') || '接口返回错误 ' + str(json, 'code')));
    return json.data;
  }

  function stations(host, category, province) {
    return items(call(host, '/web/appBroadcast/list', 'categoryId=' + category + '&provinceCode=' + province));
  }

  function toBook(s, province) {
    return {
      bookUrl: 'yt:' + province + ':' + str(s, 'contentId'), title: str(s, 'title'), coverUrl: str(s, 'image'),
      status: str(s, 'subtitle').replace(/^正在直播[：:]\s*/, '') || '直播', intro: str(s, 'subtitle')
    };
  }

  // 接口没有搜索：把各省的电台列表都取一遍存起来，在本地按名字找（一天更新一次）。
  // 各省并发着取；中途超时被打断的话，已经取到的省份留在内存里，下次搜索接着取剩下的
  var fetched = {};      // 省份代码 → 电台列表
  var provinceCodes = null;

  function allStations(host) {
    var age = host.cacheAge(INDEX_CACHE);
    if (age >= 0 && age < INDEX_LIFETIME) {
      try { var cached = JSON.parse(host.readCache(INDEX_CACHE)); if (cached.length > 0) return cached; } catch (e) { }
    }
    if (!provinceCodes) {
      provinceCodes = items(call(host, '/web/appProvince/list/all', '')).map(function (p) { return str(p, 'provinceCode'); });
    }
    for (var round = 0; round < 2; round++) {
      var todo = provinceCodes.filter(function (c) { return !fetched[c]; });
      if (todo.length === 0) break;
      var requests = todo.map(function (c) { return request(host, '/web/appBroadcast/list', 'categoryId=0&provinceCode=' + c); });
      var texts = host.getStrings(requests.map(function (r) { return r.url; }), requests.map(function (r) { return r.options; }), 6);
      todo.forEach(function (c, i) {
        if (texts[i] === null) return;
        try {
          var json = JSON.parse(texts[i]);
          if (int(json, 'code') === 0) fetched[c] = items(json, 'data').map(function (s) { return toBook(s, c); });
        } catch (e) { }
      });
    }
    var all = [];
    provinceCodes.forEach(function (c) { (fetched[c] || []).forEach(function (b) { all.push(b); }); });
    // 全部省份都取到了才写缓存，否则下次再补
    if (all.length > 0 && provinceCodes.every(function (c) { return fetched[c]; })) host.writeCache(INDEX_CACHE, JSON.stringify(all));
    return all;
  }

  // 能回听的电台（目前是央广的全国频道）：编号 → true。一次运行里只问一次
  var replayIds = null;
  function canReplay(host, id) {
    if (!replayIds) {
      replayIds = {};
      try { items(call(host, '/web/appBroadcast/listenbackList', 'provinceCode=')).forEach(function (s) { replayIds[str(s, 'id')] = true; }); }
      catch (e) { replayIds = null; return false; }
    }
    return !!replayIds[id];
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dayString(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  // 最近几天播过的节目（今天在前，同一天里按时间先后），还没播完的不算
  function replays(host, id) {
    var now = Date.now(), days = [];
    for (var i = 0; i < REPLAY_DAYS; i++) days.push(dayString(new Date(now - i * 24 * 3600 * 1000)));
    var requests = days.map(function (d) { return request(host, '/web/appProgram/listByDate', 'broadcastId=' + id + '&date=' + d); });
    var texts = host.getStrings(requests.map(function (r) { return r.url; }), requests.map(function (r) { return r.options; }), 4);
    var list = [];
    texts.forEach(function (text) {
      if (text === null) return;
      var json;
      try { json = JSON.parse(text); } catch (e) { return; }
      if (int(json, 'code') !== 0) return;
      items(json, 'data').forEach(function (p) {
        var url = str(p, 'playUrlHigh') || str(p, 'playUrlLow');
        var start = int(p, 'startTime'), end = int(p, 'endTime');
        if (!url || int(p, 'enableStatus', 1) === 0 || end > now) return;
        var t = new Date(start);
        list.push({ title: (t.getMonth() + 1) + '月' + t.getDate() + '日 ' + pad(t.getHours()) + ':' + pad(t.getMinutes()) + ' ' + str(p, 'programName').trim(), url: url, start: start });
      });
    });
    // 天和天之间新的在前，一天之内按时间先后
    list.sort(function (a, b) {
      var da = dayString(new Date(a.start)), db = dayString(new Date(b.start));
      return da === db ? a.start - b.start : (da < db ? 1 : -1);
    });
    return list.map(function (e) { return { title: e.title, url: e.url, broadcastDate: dayString(new Date(e.start)), startTime: e.start }; });
  }

  registerSource({
    id: 'c5a8e1f27b3d4c90a6e4d82f1b7c3e59', name: '云听', url: 'https://www.radio.cn/', group: '广播',
    description: '央广“云听”的广播电台直播：中国之声、经济之声、音乐之声和各省市的电台。央广的电台还能回听最近 7 天播过的节目。',

    categoryMenus: function () {
      var host = this.host;
      var provinces = items(call(host, '/web/appProvince/list/all', '')).map(function (p) {
        var code = str(p, 'provinceCode');
        return { title: code === '0' ? '央广' : str(p, 'provinceName'), url: 'yt-list:0:' + code };
      });
      // 类型是在“地区”里再筛选的；这里的类型针对央广的全国频道
      var types = items(call(host, '/web/appCategory/list/all', '')).filter(function (c) { return str(c, 'id') !== '0'; })
        .map(function (c) { return { title: str(c, 'categoryName'), url: 'yt-list:' + str(c, 'id') + ':0' }; });
      return [{ title: '地区', tabs: provinces }, { title: '央广分类', tabs: types }];
    },

    categoryPage: function (url) {
      var m = /^yt-list:(\d+):(\d+)$/.exec(url);
      return { books: stations(this.host, m[1], m[2]).map(function (s) { return toBook(s, m[2]); }), currentPage: 1, totalPage: 1 };
    },

    search: function (keywords, page) {
      if (page > 1) return { books: [], totalPage: 1 };
      var words = keywords.toLowerCase().split(' ').filter(function (w) { return w.length > 0; });
      var found = allStations(this.host).filter(function (b) {
        var t = b.title.toLowerCase();
        return words.every(function (w) { return t.indexOf(w) >= 0; });
      });
      return { books: found.slice(0, 60), totalPage: 1 };
    },

    // 第一集是直播；能回听的电台后面跟着最近几天的节目
    bookDetail: function (bookUrl) {
      var episodes = [{ title: '直播', url: bookUrl, live: true }];
      var m = /^yt:(\d+):(\d+)$/.exec(bookUrl);
      if (m && canReplay(this.host, m[2])) {
        try { episodes = episodes.concat(replays(this.host, m[2])); } catch (e) { if (e.cancelled) throw e; this.host.log('云听回听节目没取到：' + e.message); }
      }
      return { episodes: episodes };
    },

    // 直播流地址带时效，每次播放时到电台所在省份的列表里现取；回听的节目本身就是音频地址
    audio: function (url) {
      if (/^https?:\/\//.test(url)) return url;
      var m = /^yt:(\d+):(\d+)$/.exec(url);
      if (!m) throw new Error('电台地址格式不正确');
      var found = null;
      stations(this.host, 0, m[1]).forEach(function (s) { if (str(s, 'contentId') === m[2]) found = s; });
      if (!found) throw new Error('云听里已经找不到这个电台');
      var stream = str(found, 'mp3PlayUrlHigh') || str(found, 'playUrlMulti') || str(found, 'mp3PlayUrlLow') || str(found, 'playUrlLow');
      if (!stream) throw new Error('这个电台暂时没有直播信号');
      return stream;
    }
  });
})();

// ---------- 全球电台：Radio Browser（radio-browser.info，RadioDroid 用的就是它） ----------
// 社区维护的公开电台目录，全世界几万个电台，免费、不用登录。每个电台是一本书，里面只有一集直播。
// 有好几台镜像服务器，一台连不上就换下一台
(function () {
  var SERVERS = ['https://de1.api.radio-browser.info', 'https://de2.api.radio-browser.info', 'https://all.api.radio-browser.info'];
  var PAGE = 60;
  // 接口要求带上能看出是哪个程序的 User-Agent
  var OPTIONS = { headers: { 'User-Agent': 'ssts/1.0 (audiobook player)' } }; // 请求头里不能有中文
  var good = 0; // 上次能用的那台

  function api(host, path) {
    var lastError = null;
    for (var i = 0; i < SERVERS.length; i++) {
      var k = (good + i) % SERVERS.length;
      try {
        var json = host.getJson(SERVERS[k] + path, OPTIONS);
        good = k;
        return json;
      } catch (e) {
        if (e.cancelled) throw e;
        lastError = e;
      }
    }
    throw new Error('全球电台的服务器都连不上：' + (lastError ? lastError.message : ''));
  }

  var COUNTRY_NAMES = { CN: '中国', HK: '中国香港', TW: '中国台湾', MO: '中国澳门', US: '美国', GB: '英国', JP: '日本', KR: '韩国',
    DE: '德国', FR: '法国', CA: '加拿大', AU: '澳大利亚', SG: '新加坡', MY: '马来西亚', RU: '俄罗斯', IT: '意大利', ES: '西班牙' };

  function toBook(s) {
    var tags = str(s, 'tags').split(',').filter(function (t) { return t.length > 0; }).slice(0, 3).join(' · ');
    var country = COUNTRY_NAMES[str(s, 'countrycode')] || str(s, 'country');
    var quality = [str(s, 'codec') !== 'UNKNOWN' ? str(s, 'codec') : '', int(s, 'bitrate') > 0 ? int(s, 'bitrate') + 'k' : ''].filter(function (x) { return x; }).join(' ');
    var favicon = str(s, 'favicon');
    return {
      bookUrl: 'rb:' + str(s, 'stationuuid'), title: str(s, 'name').trim(),
      coverUrl: /^https?:\/\//.test(favicon) ? favicon : '',
      artist: country, status: [country, tags, quality].filter(function (x) { return x; }).join(' · ') || '直播',
      intro: [tags, str(s, 'language'), str(s, 'homepage')].filter(function (x) { return x; }).join('\n')
    };
  }

  // 列一页电台。query 是 search 接口的筛选条件（国家、类型、语言、名字）；按收听次数从多到少，去掉检测不通的
  function stations(host, query, order, page) {
    var list = items(api(host, '/json/stations/search?' + query + (query ? '&' : '') + 'order=' + (order || 'clickcount') +
      '&reverse=true&hidebroken=true&limit=' + PAGE + '&offset=' + (page - 1) * PAGE));
    return { books: list.map(toBook), more: list.length >= PAGE };
  }

  function tab(title, query, order) { return { title: title, url: 'rb-list:' + (order || 'clickcount') + ':' + query }; }

  registerSource({
    id: '564dc6f02740417b99ec2876d5463a71', name: '全球电台', url: 'https://www.radio-browser.info/', group: '广播',
    description: '全世界几万个网络电台（和 RadioDroid 用的是同一个公开电台目录 radio-browser.info）：可以按地区、类型、语言浏览，也可以按名字搜索。电台的直播地址由各电台自己提供，个别可能连不上。',

    categoryMenus: function () {
      return [
        { title: '推荐', tabs: [tab('最多人听', ''), tab('最受好评', '', 'votes'), tab('中文电台', 'language=chinese')] },
        { title: '地区', tabs: ['CN', 'HK', 'TW', 'MO', 'SG', 'MY', 'US', 'GB', 'JP', 'KR', 'CA', 'AU', 'DE', 'FR'].map(function (c) {
          return tab(COUNTRY_NAMES[c], 'countrycode=' + c);
        }) },
        { title: '类型', tabs: [['新闻', 'news'], ['音乐', 'music'], ['谈话', 'talk'], ['流行', 'pop'], ['古典', 'classical'], ['爵士', 'jazz'],
          ['摇滚', 'rock'], ['轻音乐', 'easy listening'], ['怀旧', 'oldies'], ['儿童', 'kids'], ['讲故事', 'storytelling'], ['喜剧', 'comedy'], ['体育', 'sports'], ['宗教', 'religion']].map(function (t) {
          return tab(t[0], 'tagExact=true&tag=' + encodeURIComponent(t[1]));
        }) },
        { title: '语言', tabs: [['普通话', 'chinese'], ['粤语', 'cantonese'], ['英语', 'english'], ['日语', 'japanese'], ['韩语', 'korean']].map(function (l) {
          return tab(l[0], 'language=' + l[1]);
        }) }
      ];
    },

    // 地址：rb-list:排序:筛选条件，后面跟 #页码
    categoryPage: function (url) {
      var parts = String(url).split('#'), page = parseInt(parts[1] || '1', 10) || 1;
      var m = /^rb-list:(\w+):(.*)$/.exec(parts[0]);
      if (!m) throw new Error('分类地址格式不正确');
      var r = stations(this.host, m[2], m[1], page);
      return { books: r.books, currentPage: page, totalPage: r.more ? page + 1 : page, nextUrl: r.more ? parts[0] + '#' + (page + 1) : '' };
    },

    search: function (keywords, page) {
      var r = stations(this.host, 'name=' + encodeURIComponent(keywords.trim()), 'clickcount', page);
      return { books: r.books, totalPage: r.more ? page + 1 : page };
    },

    // 详情里带上最新的名字和图标（书架上存的旧了也能跟着更新）
    bookDetail: function (bookUrl) {
      var uuid = String(bookUrl).replace(/^rb:/, '');
      var detail = { episodes: [{ title: '直播', url: bookUrl, live: true }] };
      try {
        var s = items(api(this.host, '/json/stations/byuuid/' + encodeURIComponent(uuid)))[0];
        if (s) {
          var b = toBook(s);
          detail.title = b.title; detail.coverUrl = b.coverUrl; detail.intro = b.intro; detail.artist = b.artist;
        }
      } catch (e) { if (e.cancelled) throw e; }
      return detail;
    },

    // 播放时现取直播地址：用接口推荐的“点击”地址，它会返回解析好的流地址，同时给这个电台记一次收听
    audio: function (url) {
      var uuid = String(url).replace(/^rb:/, '');
      var stream = '';
      try { stream = str(api(this.host, '/json/url/' + encodeURIComponent(uuid)), 'url'); } catch (e) { if (e.cancelled) throw e; }
      if (!stream) {
        var s = items(api(this.host, '/json/stations/byuuid/' + encodeURIComponent(uuid)))[0];
        if (!s) throw new Error('全球电台里已经找不到这个电台');
        stream = str(s, 'url_resolved') || str(s, 'url');
      }
      if (!stream) throw new Error('这个电台没有直播地址');
      return stream;
    }
  });
})();
