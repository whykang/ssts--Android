// ---------- 听中国（手机版）m.i275.com —— 网站已改版为“275听书网” ----------
registerSource({
  id: '966475a6c66a47408449a6cfa7696fb0', name: '听中国', url: 'https://m.i275.com/',
  description: '推荐指数:4星 ⭐⭐⭐⭐\n资源挺全，但未必都能播放。网站已改版，只保留“最近上架”分类。',
  loginUrl: 'https://m.i275.com/',
  coverHeaders: Shun.coverReferer('i275.com', 'https://m.i275.com/'),

  search: function (keywords, page) {
    var doc = Shun.getDoc(this.host, 'https://m.i275.com/search.php?q=' + Shun.enc(keywords) + '&page=' + page, false);
    var books = doc.select(".divide-y > a[href*='/book/']").map(function (a) {
      var ps = a.select('p');
      function field(label) {
        for (var i = 0; i < ps.length; i++) if (ps[i].text().indexOf(label) === 0) return ps[i].ownText();
        return '';
      }
      return {
        coverUrl: a.first('img').absUrl('src'), bookUrl: a.absUrl('href'), title: a.first('h3').text(),
        author: field('作者'), artist: field('演播'), intro: a.first('p.line-clamp-2, p.text-gray-400').text()
      };
    });
    // 网站一次返回全部结果
    return { books: books, totalPage: page };
  },

  categoryMenus: function () {
    return [{ title: '推荐', tabs: [{ title: '最近上架', url: 'https://m.i275.com/' }] }];
  },

  categoryPage: function (url) {
    var doc = Shun.getDoc(this.host, url, false);
    var books = doc.select(".grid > a[href*='/book/']").map(function (a) {
      var lines = a.select('.p-2 > div');
      return {
        coverUrl: a.first('img').absUrl('src'), bookUrl: a.absUrl('href'), title: Shun.nth(lines, 0).text(),
        artist: Shun.nth(lines, 1).text().replace('演播', '').trim()
      };
    });
    return { books: books, currentPage: 1, totalPage: 1 };
  },

  bookDetail: function (bookUrl, loadEpisodes) {
    var doc = Shun.getDoc(this.host, bookUrl, false);
    var episodes = loadEpisodes ? doc.select("a[id^='chapter-pos-']").map(function (a) {
      var t = Shun.nth(a.select('span'), 1).text();
      return { title: t.length > 0 ? t : a.text(), url: a.absUrl('href') };
    }) : [];
    var ps = doc.select('p');
    function info(label) {
      for (var i = 0; i < ps.length; i++) if (ps[i].text().indexOf(label + '：') === 0) return ps[i].first('span').text();
      return '';
    }
    return {
      episodes: episodes, intro: doc.first('p.leading-relaxed').text(),
      author: info('作者'), artist: info('演播'), status: info('状态'), coverUrl: doc.first('.shadow-lg img').absUrl('src')
    };
  },

  // 播放页需要先访问书籍页拿到会话 Cookie，否则会跳回首页；音频地址在 APlayer 配置的 url 字段（带签名，需每次现取）
  audio: function (url) {
    var host = this.host;
    var m = /\/play\/(\d+)\//.exec(url);
    var bookUrl = m ? 'https://m.i275.com/book/' + m[1] + '.html' : this.url;
    host.getString(bookUrl);
    var html = host.getString(url, { headers: { Referer: bookUrl } });
    var a = /audio\s*:\s*\[\s*\{[\s\S]*?url\s*:\s*"([^"]+)"/.exec(html);
    if (!a) return host.sniff(url);
    var audio = Shun.unescape(a[1]);
    if (audio.indexOf('http') === 0) return audio;
    if (audio.indexOf('lrts$') === 0) return this.fromLrts(audio);
    throw new Error('网站没有提供这一集的播放地址');
  },

  // 部分书籍来自懒人听书，网站只给出占位符 lrts$书ID#章节ID#序号#...，改用懒人听书的公开接口获取（只有免费章节可以播放）
  fromLrts: function (placeholder) {
    var parts = placeholder.substring(5).split('#');
    if (parts.length < 3) throw new Error('无法识别的播放地址：' + placeholder);
    var json = this.host.getJson('https://m.lrts.me/ajax/getPlayPath?entityId=' + parts[0] + '&entityType=3&opType=1&sections=[' + parts[2] + ']&type=0');
    var path = str(json, 'list.0.path');
    if (path.indexOf('http') === 0) return path;
    var msg = str(json, 'msg');
    throw new Error('这本书的音频来自懒人听书' + (msg.length > 0 ? '：' + msg : '，这一集无法播放'));
  }
});

// ---------- 爱听书（电脑版）www.itingshu.net、29听书网 www.ting29.com：同一套建站程序 ----------
// 目录每页 50 集（?page=N&sort=asc），目录页和播放页有一层 JS 校验。两个站不一样的地方都在 cfg 里：
//   site / id / name / description / login   网站地址（以 / 结尾）和源的基本信息
//   cookie            校验令牌要写进哪个 Cookie
//   pageDelay         目录翻页之间等多少毫秒（爱听书限流很严，只能慢慢来）
//   parallel          不限流的站可以几页一起取，写同时取几页
//   authorIsArtist    列表里“作者”那一栏放的其实是演播
//   fixUrl(url)       可选：修正书架里的旧地址
//   search(host, keywords, page, kit)   搜索；kit 里是 parseBooks、lastPage、nextPageUrl
//   menus()           分类
//   audio(host, url, kit)   可选：取音频地址；没有就用 WebView 嗅探。kit.getDir 能通过校验取页面
function ptcmsSource(cfg) {
  var SITE = cfg.site;
  var PAGE_SIZE = 50;
  var searchPageUrl = {}; // 搜索结果第 2 页起的地址模板，按关键词记住
  // 目录页的访问令牌：网站先返回一段脚本，把令牌写进 Cookie（名字见 cfg.cookie）后刷新页面。
  // 令牌 2 小时内对所有目录页有效，解出来以后直接带上 Cookie 请求，不需要 WebView。
  var dirToken = null, dirTokenExpires = 0;

  function findLink(doc, texts) {
    var list = doc.select('a');
    for (var i = 0; i < list.length; i++) if (texts.indexOf(list[i].text()) >= 0) return list[i].absUrl('href');
    return '';
  }
  function nextPageUrl(doc) { return findLink(doc, ['下页', '下一页']); }
  function lastPage(doc) { return regexInt(findLink(doc, ['尾页']), /\/(\d+)\.html/, 1); }

  function parseBooks(doc) {
    var books = [];
    doc.select('ul.list-works > li').forEach(function (li) {
      var a = li.first('dt.list-book-dt > a');
      if (!a.exists()) return;
      var img = li.first('.list-imgbox img');
      var state = li.first('dt.list-book-dt > span').text();
      var latest = li.first('dt.list-book-dt > span > a').text();
      books.push({
        coverUrl: img.absUrl('data-original') || img.absUrl('src'), bookUrl: a.absUrl('href'), title: a.text(),
        author: cfg.authorIsArtist ? '' : li.select('.book-author a').map(function (e) { return e.text(); }).join(' '),
        artist: li.select(cfg.authorIsArtist ? '.book-author a' : '.book-boyin a').map(function (e) { return e.text(); }).join(' '),
        intro: li.first('dd.list-book-des').text(),
        status: [state, latest].filter(function (x) { return x.length > 0; }).join(' · ')
      });
    });
    return books;
  }

  // 标题带广告尾巴：“第001集浓雾_催更V裙vw5418814524”
  function addEpisodes(doc, list) {
    doc.select('#playlist li a').forEach(function (a) {
      list.push({ title: a.text().replace(/[_\s]*催更.*$/, ''), url: a.absUrl('href') });
    });
  }

  // 页面脚本：var reversed = "倒序的 base64"，解码后是 var token = '...'
  function readToken(host, html) {
    var m = /reversed = "([^"]+)"/.exec(html);
    if (!m) return null;
    var code = host.base64Decode(m[1].split('').reverse().join(''));
    var t = /var token = '([^']+)'/.exec(code);
    if (!t) return null;
    // 令牌本身是 base64(“IP|ID|过期时间|签名”)
    var parts = host.base64Decode(t[1]).split('|');
    var expires = parts.length > 2 ? parseInt(parts[2], 10) : NaN;
    return { token: t[1], expires: isNaN(expires) ? Date.now() / 1000 + 3600 : expires };
  }

  function getDir(host, url) {
    for (var attempt = 0, limited = 0; attempt < 3; attempt++) {
      var token = Date.now() / 1000 < dirTokenExpires ? dirToken : null;
      var html;
      try {
        html = host.getString(url, { desktop: true, headers: token ? { Cookie: cfg.cookie + '=' + encodeURIComponent(token) } : {} });
      } catch (e) {
        if (e.status !== 429) throw e;
        if (limited >= 5) {
          var err = new Error(cfg.name + '限制了访问频率（请求过于频繁），请过几分钟再试');
          err.rateLimited = true;
          throw err;
        }
        // 请求太快被限流：等一分钟再试（不算在令牌重试次数里）
        limited++;
        for (var s = 60; s > 0; s--) {
          host.progress('（网站限流，' + s + ' 秒后继续）');
          host.sleep(1000);
        }
        attempt--;
        continue;
      }
      if (html.indexOf('reversed = "') < 0) return host.parseHtml(html, url);
      var t = readToken(host, html);
      if (!t) break;
      dirToken = t.token;
      dirTokenExpires = t.expires - 300;
    }
    // 校验方式变了时退回 WebView 渲染
    var rendered = host.render(url, {
      desktop: true,
      script: "(function(){return document.querySelector('#playlist li a')?'<html>'+document.documentElement.innerHTML+'</html>':'';})();"
    });
    return host.parseHtml(rendered, url);
  }

  function load(host, bookUrl, known, loadEpisodes, loadFullPages) {
    if (cfg.fixUrl) bookUrl = cfg.fixUrl(bookUrl);
    var list = [];
    var doc1 = Shun.getDoc(host, bookUrl, true);
    var artist = [];
    doc1.select('.book-info dd').forEach(function (d) {
      if (artist.length === 0 && d.text().indexOf('演播') === 0) artist = d.select('a').map(function (e) { return e.text(); });
    });
    var detail = {
      episodes: list, intro: doc1.first('.book-des').text(),
      coverUrl: doc1.first('.book-info').parent().first('img').absUrl('data-original'), artist: artist.join(' ')
    };
    if (!loadEpisodes) return detail;

    if (known && known.length > 0) {
      // 书页上的“最新列表”是倒序的，翻成正序后找和缓存的衔接点
      var latest = [];
      addEpisodes(doc1, latest);
      latest.reverse();
      var urls = {};
      known.forEach(function (e) { urls[e.url] = true; });
      if (latest.length > 0 && urls[latest[0].url]) {
        known.forEach(function (e) { list.push(e); });
        latest.forEach(function (e) { if (!urls[e.url]) list.push(e); });
        return detail;
      }
    }

    // 书页上的“查看全部章节”进入目录（每页 50 集），目录页上的“快速选集”列出全部分页
    var dirUrl = doc1.first('a.dirurl').absUrl('href');
    var doc = dirUrl.length > 0 ? getDir(host, dirUrl) : doc1;
    var seen = {}, pages = [];
    doc.select('a').forEach(function (a) {
      var u = a.absUrl('href');
      var p = regexInt(u, /[?&]page=(\d+)/, 0);
      if (p > 1 && !seen[p]) { seen[p] = true; pages.push({ url: u, page: p }); }
    });
    pages.sort(function (a, b) { return a.page - b.page; });

    // 续传：保留缓存里完整的前几页，从下一页开始
    var startPage = 1;
    if (known && known.length > PAGE_SIZE && pages.length > 0) {
      startPage = Math.min(Math.floor(known.length / PAGE_SIZE), pages.length) + 1;
      known.slice(0, (startPage - 1) * PAGE_SIZE).forEach(function (e) { list.push(e); });
    }
    if (startPage === 1) addEpisodes(doc, list);
    if (!loadFullPages) return detail;

    try {
      var page = Math.max(2, startPage);
      if (cfg.parallel > 1) {
        // 不限流的站：几页一起取。令牌已经有了，直接带上；哪一页没取到或又要校验，就单独按老办法取
        for (; page <= pages.length + 1; page += cfg.parallel) {
          var batch = pages.slice(page - 2, page - 2 + cfg.parallel);
          host.progress(Math.min(page + batch.length - 1, pages.length + 1) + ' / ' + (pages.length + 1));
          var token = Date.now() / 1000 < dirTokenExpires ? dirToken : null;
          var texts = host.getStrings(batch.map(function (b) { return b.url; }),
            { desktop: true, headers: token ? { Cookie: cfg.cookie + '=' + encodeURIComponent(token) } : {} }, cfg.parallel);
          batch.forEach(function (b, k) {
            var ok = texts[k] !== null && texts[k].indexOf('reversed = "') < 0;
            addEpisodes(ok ? host.parseHtml(texts[k], b.url) : getDir(host, b.url), list);
          });
        }
      } else for (; page <= pages.length + 1; page++) {
        host.progress(page + ' / ' + (pages.length + 1));
        if (cfg.pageDelay > 0) host.sleep(cfg.pageDelay);
        addEpisodes(getDir(host, pages[page - 2].url), list);
      }
    } catch (e) {
      if (!e.rateLimited) throw e;
      // 被限流太久：先返回已加载的部分，下次打开这本书时从断开处接着加载
      host.toast(cfg.name + '限制访问频率，先加载了 ' + list.length + ' 集，下次打开这本书时会接着加载');
    } finally {
      host.progress(null);
    }
    return detail;
  }

  var kit = { parseBooks: parseBooks, lastPage: lastPage, nextPageUrl: nextPageUrl, getDir: getDir };

  registerSource({
    id: cfg.id, name: cfg.name, url: SITE,
    description: cfg.description,
    multipleEpisodePages: true,
    loginUrl: SITE + 'user/public/login.html',
    loginDesktop: false,
    coverHeaders: Shun.coverReferer(Shun.hostOf(SITE).replace(/^www\./, ''), SITE),

    search: function (keywords, page) { return cfg.search(this.host, keywords, page, kit); },

    categoryMenus: function () { return cfg.menus(); },

    categoryPage: function (url) {
      var doc = Shun.getDoc(this.host, url, true);
      var current = regexInt(url, /\/(\d+)\.html$/);
      return { books: parseBooks(doc), currentPage: current, totalPage: Math.max(current, lastPage(doc)), nextUrl: nextPageUrl(doc) };
    },

    bookDetail: function (bookUrl, loadEpisodes, loadFullPages) { return load(this.host, bookUrl, null, loadEpisodes, loadFullPages); },

    // 已有章节时只做增量更新：“最新列表”能接上缓存就直接合并；接不上就从缓存断开的那一页接着加载
    updateEpisodes: function (bookUrl, known) { return load(this.host, bookUrl, known, true, true); },

    // 播放页同样有 JS 校验；没有专门的取法时交给 WebView 打开并嗅探（电脑版用 jPlayer）
    audio: function (url) { return cfg.audio ? cfg.audio(this.host, url, kit) : this.host.sniff(url, { desktop: true }); }
  });
}

// 爱听书
(function () {
  var SITE = 'https://www.itingshu.net/';
  var searchPageUrl = {}; // 搜索结果第 2 页起的地址模板，按关键词记住
  ptcmsSource({
    site: SITE, id: 'e30009d5e6714d89a2692666ddf13cbd', name: '爱听书', cookie: '__51guid__', pageDelay: 6000,
    description: '推荐指数:4星 ⭐⭐⭐⭐\n有声小说、长篇评书、相声、百家讲坛等。网站限制访问频率，章节很多的书需要一点时间才能加载完。不能播放时先在插件页面“登录”。',
    // 书架里旧的手机版地址
    fixUrl: function (url) { return url.replace('://m.itingshu.net/', '://www.itingshu.net/'); },

    search: function (host, keywords, page, kit) {
      var doc;
      if (page > 1 && searchPageUrl[keywords]) {
        // 不带 Referer 时返回“友情提示信息”页
        doc = Shun.getDoc(host, searchPageUrl[keywords].replace('{0}', page), true, SITE + 'novelsearch/search/result.html');
      } else {
        doc = host.getHtml(SITE + 'novelsearch/search/result.html', {
          desktop: true, method: 'POST', body: 'searchword=' + Shun.enc(keywords),
          // 不带 Referer 和 Origin 时网站收不到关键词
          headers: { Referer: SITE, Origin: SITE.replace(/\/$/, '') }
        });
        var next = kit.nextPageUrl(doc);
        if (next) searchPageUrl[keywords] = next.replace(/\/\d+\.html$/, '/{0}.html');
      }
      return { books: kit.parseBooks(doc), totalPage: Math.max(page, kit.lastPage(doc)) };
    },

    menus: function () {
      function tabs(list) {
        return list.map(function (p) { return { title: p[0], url: SITE + 'yousheng/' + p[1] + '/lastupdate/1/1.html' }; });
      }
      return [
        { title: '有声小说', tabs: tabs([['全部', 'all'], ['玄幻修真', 'xuanhuan'], ['都市言情', 'dushi'], ['灵异惊悚', 'lingyi'], ['军事历史', 'junshi'],
          ['网游竞技', 'jingji'], ['官场商战', 'guanchangshangzhan'], ['通俗文学', 'wenxue'], ['经典纪实', 'jishi'],
          ['人物传记', 'chuanji'], ['儿童故事', 'ertong'], ['其他有声', 'qita']]) },
        { title: '评书曲艺', tabs: tabs([['长篇评书', 'pingshu'], ['相声戏曲', 'xiangsheng'], ['百家讲坛', 'bjjt'], ['综艺娱乐', 'yule']]) }
      ];
    }
  });
})();

// 29听书网
(function () {
  var SITE = 'https://www.ting29.com/';
  ptcmsSource({
    site: SITE, id: 'd4a8f1c63e9b47d2b5a0c7e91f3d6b28', name: '29听书网', cookie: 'pt_guid', parallel: 5, authorIsArtist: true,
    description: '有声小说、长篇评书、相声曲艺、儿童、国学等，分类很细，更新快，音频是直链。章节很多的书加载要一点时间。',

    // 搜索是表单提交；翻页是带着关键词的普通请求
    search: function (host, keywords, page, kit) {
      var doc = page > 1
        ? Shun.getDoc(host, SITE + 'search.html?searchtype=name&searchword=' + Shun.enc(keywords) + '&page=' + page, true, SITE + 'search.html')
        : host.getHtml(SITE + 'search.html', { desktop: true, method: 'POST', body: 'searchword=' + Shun.enc(keywords), headers: { Referer: SITE, Origin: SITE.replace(/\/$/, '') } });
      var books = kit.parseBooks(doc);
      // 页面上只有“下一页”，没有总页数：有下一页就再翻
      var more = doc.select('a').some(function (a) { return a.text() === '下一页' || a.text() === '下页'; });
      return { books: books, totalPage: more && books.length > 0 ? page + 1 : page };
    },

    menus: function () {
      function tabs(list) { return list.map(function (p) { return { title: p[0], url: SITE + 'book/' + p[1] + '/lastupdate.html' }; }); }
      return [
        { title: '有声小说', tabs: tabs([['全部', 'all'], ['玄幻奇幻', 'xhqh'], ['武侠仙侠', 'wxxx'], ['穿越架空', 'cyjk'], ['悬疑推理', 'xytl'], ['科幻竞技', 'khjj'],
          ['历史军事', 'lsjs'], ['现代言情', 'xdyq'], ['古代言情', 'gdyq'], ['幻想言情', 'hxyq'], ['青春校园', 'qcxy'], ['影视原著', 'ysyz'], ['文学名著', 'wxmz'], ['乡村生活', 'xcsh']]) },
        { title: '评书人文', tabs: tabs([['长篇评书', 'pingshu'], ['相声曲艺', 'xsqy'], ['国学经典', 'gxjd'], ['名家传记', 'mjcj'], ['档案纪实', 'dajs'], ['博闻杂谈', 'bxzt'],
          ['儿童频道', 'ertong'], ['职场干货', 'zcgh'], ['自我提升', 'zwts'], ['明星电台', 'mxdt'], ['其他有声', 'qita']]) }
      ];
    },

    // 播放页里嵌着播放器页面 /player.html?…，音频地址直接写在它的脚本里：mp3:'地址前半'+变量+''，变量在上面赋过值。
    // 取不到（网站改了写法）时退回 WebView 嗅探
    audio: function (host, url, kit) {
      try {
        var player = kit.getDir(host, url).first('iframe[src*="player.html"]').absUrl('src');
        if (player) {
          var html = host.getString(player, { desktop: true, headers: { Referer: url } });
          if (html.indexOf('reversed = "') >= 0) html = kit.getDir(host, player).outerHtml();
          var m = /(?:mp3|m4a|oga|wav)\s*:\s*'([^']*)'\s*\+\s*(\w+)/.exec(html);
          if (m) {
            var tail = new RegExp(m[2] + "\\s*=\\s*'([^']*)'").exec(html);
            var audio = m[1] + (tail ? tail[1] : '');
            if (/^https?:\/\//.test(audio)) return audio;
          }
        }
      } catch (e) { if (e.cancelled) throw e; }
      return host.sniff(url, { desktop: true });
    }
  });
})();


// ---------- 单田芳评书网 ----------
registerSource({
  id: 'accbef4f823c4cc9ae76ba24688c67f6', name: '单田芳评书网', url: 'http://www.pingshu5.net/',
  description: '推荐指数:3星 ⭐⭐⭐\n单田芳、袁阔成、刘兰芳、连丽如评书。只有分类，不支持搜索。',
  group: '评书',

  categoryMenus: function () {
    return [{ title: '评书分类', tabs: [
      { title: '单田芳', url: 'http://www.pingshu5.net/pbook/' }, { title: '袁阔成', url: 'http://www.pingshu5.net/ykc/' },
      { title: '刘兰芳', url: 'http://www.pingshu5.net/llf/' }, { title: '连丽如', url: 'http://www.pingshu5.net/llr/' }
    ] }];
  },

  categoryPage: function (url) {
    var books = [];
    Shun.getDoc(this.host, url, true).select('.pop-books2 > ul > li').forEach(function (li) {
      var a = li.first('.caption > a');
      if (!a.exists()) return;
      books.push({ coverUrl: li.first('img').absUrl('src'), bookUrl: li.first('a').absUrl('href'), title: a.text(), intro: li.first('.caption > span').text() });
    });
    return { books: books, currentPage: 1, totalPage: 1 };
  },

  bookDetail: function (bookUrl) {
    var doc = Shun.getDoc(this.host, bookUrl, true);
    return { episodes: doc.select('.book-list > ul > li > a').map(function (a) { return { title: a.text(), url: a.absUrl('href') }; }) };
  },

  audio: function (url) {
    var doc = Shun.getDoc(this.host, url, true);
    return doc.first('audio > source').absUrl('src') || doc.first('audio').absUrl('src');
  }
});

// ---------- 声音巴士 ----------
registerSource({
  id: '405d26b44ad24b25a450ede64bac682f', name: '声音巴士', url: 'https://vbus.cc/',
  description: '推荐指数:2星 ⭐⭐\n一个无障碍交流平台，一群热爱声音的人。只有分类，不支持搜索。',
  group: '播客',

  categoryMenus: function () {
    return [{ title: '声音巴士', tabs: [
      { title: '推荐', url: 'https://vbus.cc/recommend/1' }, { title: '最新', url: 'https://vbus.cc/new/1' }, { title: '最热', url: 'https://vbus.cc/hot/1' }
    ] }];
  },

  categoryPage: function (url) {
    var doc = Shun.getDoc(this.host, url, false);
    var next = Shun.findByText(doc, '.page-item > a', '下一页').absUrl('href');
    var current = regexInt(url, /\/(\d+)$/);
    var books = [];
    doc.select('.program-list > li').forEach(function (li) {
      var a = li.first('h3 > a');
      if (!a.exists()) return;
      var meta = li.first('.program-meta');
      var spans = meta.select('span');
      books.push({
        bookUrl: a.absUrl('href'), title: a.text(),
        author: meta.children().filter(function (c) { return c.tag() === 'a'; }).map(function (c) { return c.text(); }).join(','),
        status: spans.length > 0 ? spans[spans.length - 1].text() : ''
      });
    });
    return { books: books, currentPage: current, totalPage: next ? current + 1 : current, nextUrl: next };
  },

  // 每个节目只有一段音频
  bookDetail: function (bookUrl) { return { episodes: [{ title: '音频', url: bookUrl }] }; },

  // 播放页的 audio 指向 /program/get-source/{id}，会再跳转到真实音频
  audio: function (url) {
    var doc = Shun.getDoc(this.host, url.replace('://www.vbus.cc', '://vbus.cc'), false);
    var src = doc.first('audio > source').absUrl('src') || doc.first('audio').absUrl('src');
    if (!src) throw new Error('没有找到音频');
    return this.host.finalUrl(src);
  }
});

// ---------- 悦听吧 yuetingba.cn ----------
(function () {
  var SITE = 'http://www.yuetingba.cn/';

  function parsePager(doc) {
    var pager = doc.byId('PageContent');
    var current = regexInt(pager.first('.current').text(), /(\d+)/);
    var next = Shun.findByText(pager, 'a', '下一页');
    return { current: current, total: next.exists() ? current + 1 : current, next: next.absUrl('href') };
  }

  function parseBooks(doc) {
    var books = [];
    doc.first('.section-box').select('.section-box-list-item').forEach(function (li) {
      var a = li.first('.box-list-item-text > .box-list-item-text-title > a');
      if (!a.exists()) return;
      var spans = li.first('.box-list-item-text > .box-list-item-text-autspeaker').select('span');
      books.push({
        coverUrl: li.first('.box-list-item-img > a > img').absUrl('src'), bookUrl: a.absUrl('href'), title: a.text(),
        author: Shun.nth(spans, 0).first('a').text(),
        artist: Shun.nth(spans, 1).select('a').map(function (x) { return x.text(); }).join(' '),
        intro: li.first('.box-list-item-text > .box-list-item-text-intro.text-desc-content').text()
      });
    });
    return books;
  }

  registerSource({
    id: 'cc17e42c42fc434aa13f783567a947db', name: '悦听吧', url: SITE,
    description: '推荐指数:4星 ⭐⭐⭐⭐\n不是所有都能听，有的可能要会员。',
    coverHeaders: Shun.coverReferer('www.yuetingba.cn/', SITE),

    search: function (keywords, page) {
      var doc = Shun.getDoc(this.host, SITE + 'search?type=1&name=' + Shun.enc(keywords) + '&pageIndex=' + page, true);
      var p = parsePager(doc);
      return { books: parseBooks(doc), totalPage: p.total > 0 ? p.total : p.current };
    },

    categoryMenus: function () {
      var tabs = Shun.getDoc(this.host, SITE, true).select('.nav.navbar-nav li > a')
        .filter(function (a) { return a.text() !== '首页'; })
        .map(function (a) { return { title: a.text(), url: a.absUrl('href') }; });
      return [{ title: '分类', tabs: tabs }];
    },

    categoryPage: function (url) {
      var doc = Shun.getDoc(this.host, url, true);
      var p = parsePager(doc);
      return { books: parseBooks(doc), currentPage: p.current, totalPage: p.total, nextUrl: p.next };
    },

    bookDetail: function (bookUrl, loadEpisodes) {
      var episodes = [];
      if (loadEpisodes) {
        Shun.getDoc(this.host, bookUrl, true).select('.ting-list-content.row .col-md-3.col-xs-12').forEach(function (item) {
          var a = item.first('.col-md-10.col-xs-10 > a');
          if (!a.exists()) return;
          // 章节通过页面上的 testFn('id') 在播放器 iframe 中播放；记录书籍页地址和章节 id
          var id = a.attr('onclick').replace("testFn('", '').replace("')", '');
          episodes.push({ title: a.text(), url: bookUrl.split('#')[0] + '#ting=' + id });
        });
      }
      return { episodes: episodes };
    },

    // 网站接口返回的是加密地址。这里在书籍页里调用网站自己的 testFn(章节id)，
    // 由页面在播放器 iframe 中解密并设置 <video> 的地址，然后直接读取这个地址。
    audio: function (url) {
      var parts = url.split('#ting=');
      if (parts.length !== 2) throw new Error('章节地址格式不正确，请刷新章节列表');
      var id = parts[1].replace(/[^0-9a-fA-F-]/g, '');
      var script =
        "(function(){var f=document.getElementById('iframe_tingPlay');var w=f&&f.contentWindow;" +
        "if(!w||!w.testFun||!w.document)return '';" +
        "var cur=function(){var v=w.document.querySelector('video,audio');return v?(v.currentSrc||v.src||''):'';};" +
        // 播放器可能预载着上次播放的地址：记下调用前的地址，只接受变化后的新地址（4 秒后仍相同说明本来就是同一集）
        "if(window.__tsId!=='" + id + "'){window.__tsId='" + id + "';window.__tsPrev=cur();window.__tsAt=Date.now();try{testFn('" + id + "');}catch(e){}return '';}" +
        "var s=cur();if(s.indexOf('http')!==0)return '';" +
        "if(s===window.__tsPrev&&Date.now()-window.__tsAt<4000)return '';" +
        "return s;})();";
      return this.host.render(parts[0], { desktop: true, script: script, timeout: 30000 }).replace(/^"|"$/g, '');
    }
  });
})();

// ---------- 听书网（手机版）m.tingshuwang.cc：章节一页列完，播放页里直接写着音频地址 ----------
(function () {
  var SITE = 'https://m.tingshuwang.cc';

  function parseBooks(doc) {
    return doc.select('ul.m-book-list > li').map(function (li) {
      var a = li.first('h5 a');
      var latest = li.first('.cover em').text();
      return {
        coverUrl: li.first('.cover img').absUrl('src'), bookUrl: a.absUrl('href'), title: a.text(),
        artist: li.first('.author a').text(), intro: li.first('p.intro').text(),
        status: [li.first('h5 em').text(), latest].filter(function (s) { return s; }).join(' · ')
      };
    }).filter(function (b) { return b.bookUrl && b.title; });
  }

  registerSource({
    id: 'f2b9d4a61c7e48f3a5d08e3b7c1a9d54', name: '听书网', url: SITE + '/',
    description: '有声小说为主，书不算多但整理得干净。音频是直链，不用登录；个别章节网站上的文件已经没有了，会提示播放失败。',
    coverHeaders: Shun.coverReferer('tingshuwang.cc', SITE + '/'),

    // 网站一次返回全部结果，没有分页。搜索框提交到 /plus/search.php，它只是跳转到 /so/关键词/，这里直接访问后者
    search: function (keywords, page) {
      if (page > 1) return { books: [], totalPage: 1 };
      return { books: parseBooks(Shun.getDoc(this.host, SITE + '/so/' + Shun.enc(keywords) + '/', false, SITE + '/')), totalPage: 1 };
    },

    categoryMenus: function () {
      var cats = [['全部', ''], ['连载', 'lianzai/'], ['完结', 'wanjie/'], ['玄幻武侠', 'xuanhuanwuxia/'], ['恐怖悬疑', 'kongbuxuanyi/'], ['都市言情', 'dushiyanqing/'],
        ['职场商战', 'zhichangshangzhan/'], ['推理小说', 'tuilixiaoshuo/'], ['军事历史', 'junshilishi/'], ['网游竞技', 'wangyoujingji/'], ['综艺娱乐', 'zongyiyule/']];
      return [{ title: '有声小说', tabs: cats.map(function (c) { return { title: c[0], url: SITE + '/book/' + c[1] + 'index.html' }; }) }];
    },

    // 分页：index.html、index_2.html……页面下方写着“当前: 1/6”
    categoryPage: function (url) {
      var doc = Shun.getDoc(this.host, url, false, SITE + '/');
      var m = /(\d+)\s*\/\s*(\d+)/.exec(doc.first('.mpages .page-info').text());
      var current = m ? parseInt(m[1], 10) : 1, total = m ? parseInt(m[2], 10) : 1;
      var next = doc.first('.mpages a.next').absUrl('href');
      return { books: parseBooks(doc), currentPage: current, totalPage: total, nextUrl: current < total && /^http/.test(next) ? next : null };
    },

    bookDetail: function (bookUrl, loadEpisodes) {
      var doc = Shun.getDoc(this.host, bookUrl, false, SITE + '/');
      var title = doc.first('h1.bookname').text();
      // 简介开头是“《书名》简介：”，结尾有一段请大家多多宣传的话，都去掉
      var intro = doc.first('.book-intro').text();
      var head = doc.first('.book-intro .intro-title').text(), tail = doc.first('.book-intro p.other').text();
      if (head && intro.indexOf(head) === 0) intro = intro.substring(head.length);
      if (tail && intro.lastIndexOf(tail) >= 0) intro = intro.substring(0, intro.lastIndexOf(tail));
      var detail = {
        title: title, coverUrl: doc.first('.book-details .cover img').absUrl('src'), author: doc.first('.book-details .author a').text(),
        artist: doc.first('.book-details .announcer a').text(), status: doc.first('.book-details .status').text(), intro: intro.trim(), episodes: []
      };
      if (loadEpisodes) {
        // 章节名前面重复的书名去掉
        var list = doc.select('ul.chapter-list-data > li > a').map(function (a) {
          var name = a.text();
          if (title && name.indexOf(title) === 0 && name.length > title.length) name = name.substring(title.length).trim();
          return { title: name, url: a.absUrl('href') };
        }).filter(function (e) { return e.url; });
        // 有的书页面上是倒序（最新的在前），有的是正序：章节地址里的编号是越往后越大的，据此统一成正序
        function id(e) { return regexInt(e.url, /\/(\d+)\.html$/, 0); }
        if (list.length > 1 && id(list[0]) > id(list[list.length - 1])) list.reverse();
        detail.episodes = list;
      }
      return detail;
    },

    audio: function (url) {
      var html = this.host.getString(url, { headers: { Referer: SITE + '/' } });
      var m = /videourl\s*:\s*'([^']*)'/.exec(html), type = /videotype\s*:\s*'([^']*)'/.exec(html);
      var audio = m ? m[1].trim() : '';
      // 类型是 tc 的章节，音频在别的网站上，要靠这个站自己的转接才能播
      if (!/^https?:\/\//.test(audio) || (type && type[1] === 'tc')) throw new Error('这一集网站没有提供可以直接播放的音频');
      return { url: audio, headers: { Referer: SITE + '/' } };
    }
  });
})();

// ---------- 电台网 diantaiwang.com：各地广播电台直播。每个电台是一本“书”，里面只有一集“直播” ----------
(function () {
  var SITE = 'https://www.diantaiwang.com';
  var INDEX_CACHE = 'stations.json';
  var INDEX_LIFETIME = 24 * 3600 * 1000;
  var REGIONS = [['央广', 'yangguang'], ['北京', 'beijing'], ['天津', 'tianjin'], ['上海', 'shanghai'], ['重庆', 'chongqing'], ['湖南', 'hunan'], ['湖北', 'hubei'],
    ['广东', 'guangdong'], ['广西', 'guangxi'], ['海南', 'hainan'], ['江苏', 'jiangsu'], ['浙江', 'zhejiang'], ['安徽', 'anhui'], ['福建', 'fujian'], ['江西', 'jiangxi'],
    ['河南', 'henan'], ['河北', 'hebei'], ['山西', 'shanxi'], ['山东', 'shandong'], ['内蒙古', 'neimenggu'], ['辽宁', 'liaoning'], ['吉林', 'jilin'],
    ['黑龙江', 'heilongjiang'], ['四川', 'sichuan'], ['贵州', 'guizhou'], ['云南', 'yunnan'], ['陕西', 'shan-xi'], ['甘肃', 'gansu'], ['宁夏', 'ningxia'],
    ['青海', 'qinghai'], ['新疆', 'xinjiang'], ['西藏', 'xizang']];
  var TYPES = [['综合', 'zonghe'], ['新闻', 'xinwen'], ['经济', 'jingji'], ['音乐', 'yinyue'], ['交通', 'jiaotong'], ['都市', 'dushi'], ['生活', 'shenghuo'],
    ['文艺', 'wenyi'], ['戏曲', 'xiqu'], ['健康', 'jiankang'], ['娱乐', 'yule'], ['教育', 'jiaoyu'], ['资讯', 'zixun'], ['体育', 'tiyu'], ['旅游', 'luyou'],
    ['农村', 'nongcun'], ['故事', 'gushi'], ['评书', 'pingshu'], ['外语', 'waiyu']];

  // 列表页（GBK 编码）里的电台：<div class="content"> 里一串 /fm/xxx.html 的链接
  function parseStations(doc, label) {
    return doc.select('div.content li a[href*="/fm/"]').map(function (a) {
      return { bookUrl: a.absUrl('href'), title: a.text(), status: label || '直播' };
    }).filter(function (b) { return b.title && /\/fm\/[^\/]+\.html$/.test(b.bookUrl); });
  }

  // 网站没有搜索：把各地区的列表都取一遍存起来，在本地按名字找（一天更新一次）
  function allStations(host) {
    var age = host.cacheAge(INDEX_CACHE);
    if (age >= 0 && age < INDEX_LIFETIME) {
      try { var cached = JSON.parse(host.readCache(INDEX_CACHE)); if (cached.length > 0) return cached; } catch (e) { }
    }
    var texts = host.getStrings(REGIONS.map(function (r) { return SITE + '/' + r[1] + '/'; }), { desktop: true, encoding: 'gbk' }, 6);
    var all = [], seen = {}, missed = 0;
    texts.forEach(function (text, i) {
      if (text === null) { missed++; return; }
      parseStations(host.parseHtml(text, SITE + '/'), REGIONS[i][0]).forEach(function (b) {
        if (!seen[b.bookUrl]) { seen[b.bookUrl] = true; all.push(b); }
      });
    });
    // 有的地区没取到就先不存，下次搜索再重新取一遍
    if (all.length > 0 && missed === 0) host.writeCache(INDEX_CACHE, JSON.stringify(all));
    return all;
  }

  registerSource({
    id: 'c9e4f7a20b6d4183a7f5d02e8b3c6a19', name: '电台网', url: SITE + '/', group: '广播',
    description: '全国各地的广播电台直播，按地区和类型找。大约八成能听；有的电台直播地址已经失效，会提示播放失败。',

    search: function (keywords, page) {
      if (page > 1) return { books: [], totalPage: 1 };
      var word = keywords.toLowerCase().replace(/\s+/g, '');
      var books = allStations(this.host).filter(function (b) { return b.title.toLowerCase().replace(/\s+/g, '').indexOf(word) >= 0; });
      return { books: books.slice(0, 80), totalPage: 1 };
    },

    categoryMenus: function () {
      function tabs(list) { return list.map(function (c) { return { title: c[0], url: SITE + '/' + c[1] + '/' }; }); }
      return [{ title: '地区', tabs: tabs(REGIONS) }, { title: '类型', tabs: tabs(TYPES) }];
    },

    // 一个地区 / 类型的电台都在一页里
    categoryPage: function (url) {
      return { books: parseStations(Shun.getDoc(this.host, url, true, SITE + '/', 'gbk')), currentPage: 1, totalPage: 1, nextUrl: null };
    },

    bookDetail: function (bookUrl) {
      return { intro: '广播电台直播', episodes: [{ title: '直播', url: bookUrl, live: true }] };
    },

    // 电台页里嵌着一个播放器页面 /radio/xxx.html（要带来源才给看），直播地址写在里面，有三种写法
    audio: function (url) {
      var m = /\/fm\/([^\/]+)\.html/.exec(url);
      if (!m) throw new Error('不认识的电台地址：' + url);
      var html = this.host.getString(SITE + '/radio/' + m[1] + '.html', { desktop: true, headers: { Referer: url } });
      var found = /<audio[^>]+src\s*=\s*["']([^"']+)["']/i.exec(html)        // <audio src="…">
        || /var\s+vvid\s*=\s*["']([^"']+)["']/.exec(html)                    // var vvid = "…m3u8"
        || /var\s+video\s*=\s*\[\s*["']([^"']+)["']/.exec(html)              // var video = ['…m3u8']
        || /["'](https?:\/\/[^"'\s]+\.(?:m3u8|mp3|aac|flv)[^"'\s]*)["']/i.exec(html);
      var stream = found ? this.host.htmlDecode(found[1]).trim() : '';
      if (stream.indexOf('//') === 0) stream = 'https:' + stream;
      if (!/^https?:\/\//.test(stream)) throw new Error('这个电台的页面里没有找到直播地址');
      return stream;
    }
  });
})();
