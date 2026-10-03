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

// ---------- 爱听书（电脑版）www.itingshu.net ----------
// 目录每页 50 集（?page=N&sort=asc），目录页和播放页有一层 JS 校验；网站限流很严，只能逐页慢慢加载。
(function () {
  var SITE = 'https://www.itingshu.net/';
  var PAGE_SIZE = 50;
  var searchPageUrl = {}; // 搜索结果第 2 页起的地址模板，按关键词记住
  // 目录页的访问令牌：网站先返回一段脚本，把令牌写进 __51guid__ Cookie 后刷新页面。
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
        author: li.select('.book-author a').map(function (e) { return e.text(); }).join(' '),
        artist: li.select('.book-boyin a').map(function (e) { return e.text(); }).join(' '),
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
        html = host.getString(url, { desktop: true, headers: token ? { Cookie: '__51guid__=' + encodeURIComponent(token) } : {} });
      } catch (e) {
        if (e.status !== 429) throw e;
        if (limited >= 5) {
          var err = new Error('爱听书限制了访问频率（请求过于频繁），请过几分钟再试');
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
    // 书架里旧的手机版地址
    bookUrl = bookUrl.replace('://m.itingshu.net/', '://www.itingshu.net/');
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
      for (var page = Math.max(2, startPage); page <= pages.length + 1; page++) {
        host.progress(page + ' / ' + (pages.length + 1));
        host.sleep(6000);
        addEpisodes(getDir(host, pages[page - 2].url), list);
      }
    } catch (e) {
      if (!e.rateLimited) throw e;
      // 被限流太久：先返回已加载的部分，下次打开这本书时从断开处接着加载
      host.toast('爱听书限制访问频率，先加载了 ' + list.length + ' 集，下次打开这本书时会接着加载');
    } finally {
      host.progress(null);
    }
    return detail;
  }

  registerSource({
    id: 'e30009d5e6714d89a2692666ddf13cbd', name: '爱听书', url: SITE,
    description: '推荐指数:4星 ⭐⭐⭐⭐\n有声小说、长篇评书、相声、百家讲坛等。网站限制访问频率，章节很多的书需要一点时间才能加载完。不能播放时先在插件页面“登录”。',
    multipleEpisodePages: true,
    loginUrl: SITE + 'user/public/login.html',
    loginDesktop: false,
    coverHeaders: Shun.coverReferer('itingshu.net', SITE),

    search: function (keywords, page) {
      var doc;
      if (page > 1 && searchPageUrl[keywords]) {
        // 不带 Referer 时返回“友情提示信息”页
        doc = Shun.getDoc(this.host, searchPageUrl[keywords].replace('{0}', page), true, SITE + 'novelsearch/search/result.html');
      } else {
        doc = this.host.getHtml(SITE + 'novelsearch/search/result.html', {
          desktop: true, method: 'POST', body: 'searchword=' + Shun.enc(keywords),
          // 不带 Referer 和 Origin 时网站收不到关键词
          headers: { Referer: SITE, Origin: SITE.replace(/\/$/, '') }
        });
        var next = nextPageUrl(doc);
        if (next) searchPageUrl[keywords] = next.replace(/\/\d+\.html$/, '/{0}.html');
      }
      return { books: parseBooks(doc), totalPage: Math.max(page, lastPage(doc)) };
    },

    categoryMenus: function () {
      function tabs(list) {
        return list.map(function (p) { return { title: p[0], url: SITE + 'yousheng/' + p[1] + '/lastupdate/1/1.html' }; });
      }
      return [
        { title: '有声小说', tabs: tabs([['全部', 'all'], ['玄幻修真', 'xuanhuan'], ['都市言情', 'dushi'], ['灵异惊悚', 'lingyi'], ['军事历史', 'junshi'],
          ['网游竞技', 'jingji'], ['官场商战', 'guanchangshangzhan'], ['通俗文学', 'wenxue'], ['经典纪实', 'jishi'],
          ['人物传记', 'chuanji'], ['儿童故事', 'ertong'], ['其他有声', 'qita']]) },
        { title: '评书曲艺', tabs: tabs([['长篇评书', 'pingshu'], ['相声戏曲', 'xiangsheng'], ['百家讲坛', 'bjjt'], ['综艺娱乐', 'yule']]) }
      ];
    },

    categoryPage: function (url) {
      var doc = Shun.getDoc(this.host, url, true);
      var current = regexInt(url, /\/(\d+)\.html$/);
      return { books: parseBooks(doc), currentPage: current, totalPage: Math.max(current, lastPage(doc)), nextUrl: nextPageUrl(doc) };
    },

    bookDetail: function (bookUrl, loadEpisodes, loadFullPages) { return load(this.host, bookUrl, null, loadEpisodes, loadFullPages); },

    // 已有章节时只做增量更新：“最新列表”能接上缓存就直接合并；接不上就从缓存断开的那一页接着加载
    updateEpisodes: function (bookUrl, known) { return load(this.host, bookUrl, known, true, true); },

    // 播放页同样有 JS 校验，交给 WebView 打开并嗅探（电脑版用 jPlayer）
    audio: function (url) { return this.host.sniff(url, { desktop: true }); }
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
