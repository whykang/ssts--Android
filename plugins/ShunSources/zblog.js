// ---------- 评书随身听 psmp3.com（Z-BlogPHP） ----------
// 结构：评书艺人（分类）→ 书（子分类页，如 /stf-styy.html）→ 若干“部分”文章（如 /stf-styy/styy-1.html），
// 每个部分页的 APlayer 脚本里有约 50 回的音频列表。音频需要带 Referer。
(function () {
  var SITE = 'https://www.psmp3.com/';
  var ARTISTS = [['单田芳', 'stf'], ['袁阔成', 'ykc'], ['田连元', 'tly'], ['刘兰芳', 'llf'], ['连丽如', 'llr'], ['张少佐', 'zsz'], ['田战义', 'tzy']];

  function artistByCode(code) {
    for (var i = 0; i < ARTISTS.length; i++) if (ARTISTS[i][1] === code) return ARTISTS[i][0];
    return '';
  }
  function artistOf(bookUrl) { return artistByCode((/psmp3\.com\/([a-z]+)-/.exec(bookUrl) || [])[1]); }

  // /stf-styy/styy-1.html → /stf-styy.html（部分页文件名不统一，只取目录名）
  function bookUrlOfPart(partUrl) {
    var m = /psmp3\.com\/([a-z]+-[a-z0-9]+)\/[^\/]+\.html/.exec(partUrl);
    return m ? SITE + m[1] + '.html' : null;
  }

  // “单田芳评书《隋唐演义》全216回(一)在线收听,免费下载” → “隋唐演义 全216回”
  function bookTitleOfPart(title) {
    var m = /《(.+?)》(全\d+回)?/.exec(title);
    return m ? m[1] + (m[2] ? ' ' + m[2] : '') : title;
  }

  function hasNext(doc) { return Shun.findByText(doc, 'a', '下一页'); }

  registerSource({
    id: 'a20ead64890d4b1b8fd2a6e5d7b21d43', name: '评书随身听', url: SITE,
    description: '单田芳、袁阔成、田连元、刘兰芳、连丽如、张少佐、田战义的评书全集。',
    group: '评书',
    multipleEpisodePages: true,

    search: function (keywords, page) {
      var doc = Shun.getDoc(this.host, SITE + 'search.php?q=' + Shun.enc(keywords) + '&page=' + page, true);
      // 搜索结果是“部分”文章，按所属的书合并
      var books = [], seen = {};
      doc.select('.post_list_li h2 a').forEach(function (a) {
        var url = bookUrlOfPart(a.absUrl('href'));
        if (!url || seen[url]) return;
        seen[url] = true;
        books.push({ bookUrl: url, title: bookTitleOfPart(a.text()), artist: artistOf(url) });
      });
      return { books: books, totalPage: hasNext(doc).exists() ? page + 1 : page };
    },

    categoryMenus: function () {
      return [{ title: '评书艺人', tabs: ARTISTS.map(function (a) { return { title: a[0], url: SITE + a[1] + '.html' }; }) }];
    },

    // 艺人页顶部列出了他的全部书（子分类链接）
    categoryPage: function (url) {
      var doc = Shun.getDoc(this.host, url, true);
      var code = (/psmp3\.com\/([a-z]+)\.html/.exec(url) || [])[1] || '';
      var artist = artistByCode(code);
      var re = new RegExp('psmp3\\.com/' + code + '-[a-z0-9]+\\.html$');
      var books = [], seen = {};
      doc.select('.article a').forEach(function (a) {
        var href = a.absUrl('href');
        if (!re.test(href) || seen[href]) return;
        seen[href] = true;
        var title = a.text();
        if (artist && title.indexOf(artist) === 0) title = title.substring(artist.length);
        books.push({ bookUrl: href, title: title, artist: artist });
      });
      return { books: books, currentPage: 1, totalPage: 1 };
    },

    bookDetail: function (bookUrl, loadEpisodes, loadFullPages) {
      var host = this.host;
      var doc = Shun.getDoc(host, bookUrl, true);
      var intro = doc.first('.post_list_li p').text();
      var list = [];
      if (!loadEpisodes) return { episodes: list, intro: intro };

      // 书页列出各“部分”，可能分页
      var parts = [], pages = {};
      pages[bookUrl] = true;
      var current = doc;
      for (var i = 0; i < 20 && current; i++) {
        current.select('.post_list_li h2 a').forEach(function (a) {
          var href = a.absUrl('href');
          if (parts.indexOf(href) < 0) parts.push(href);
        });
        var next = hasNext(current).absUrl('href');
        if (next && !pages[next]) { pages[next] = true; current = Shun.getDoc(host, next, true); }
        else current = null;
      }
      // 文章按发布时间倒序时，按“部分”编号排序
      parts.sort(function (a, b) { return regexInt(a, /-(\d+)\.html$/, 0) - regexInt(b, /-(\d+)\.html$/, 0); });

      try {
        for (var k = 0; k < parts.length; k++) {
          if (k > 0) {
            if (!loadFullPages) break;
            host.progress((k + 1) + ' / ' + parts.length);
            host.sleep(200 + Math.random() * 300);
          }
          Shun.aplayerItems(host.getString(parts[k], { desktop: true })).forEach(function (e) { list.push({ title: e.title, url: e.url }); });
        }
      } finally {
        host.progress(null);
      }
      return { episodes: list, intro: intro, artist: artistOf(bookUrl) };
    },

    // 章节地址就是音频地址；不带 Referer 时音频服务器返回 403
    audioHeaders: function (audioUrl) { return audioUrl.indexOf('psmp3.com') >= 0 ? { Referer: SITE } : null; }
  });
})();

// ---------- 相声随身听 xsmp3.com（与评书随身听同一套主题） ----------
// 每篇文章是一个“专辑”，音频列表在 APlayer 脚本里。
// 网站自带搜索在服务器端报错，所以抓取全站文章列表做本地索引来搜索。
(function () {
  var SITE = 'https://www.xsmp3.com/';
  var INDEX_LIFETIME = 7 * 24 * 3600 * 1000;
  var CACHE = 'index.tsv';
  var index = null;     // [{url, raw, category}]
  var partial = {};     // 建索引中途被打断（搜索超时）时保留已抓到的页，下次接着抓

  function clean(s) { return s.replace(/[\t\r\n]+/g, ' ').trim(); }

  // “马三立王凤山《白事会》相声在线收听,mp3免费下载” → {title: “白事会”, artist: “马三立王凤山”}
  function cleanTitle(raw) {
    var m = /^(.*?)《(.+?)》/.exec(raw);
    if (m) return { title: m[2], artist: m[1] };
    var title = raw.replace(/(相声)?(在线收听|持续更新|,|，).*$/, '');
    return { title: title.length > 0 ? title : raw, artist: '' };
  }

  function toBook(e) {
    var t = cleanTitle(e.raw);
    return { bookUrl: e.url, title: t.title, artist: t.artist.length > 0 ? t.artist : e.category, status: e.category };
  }

  function parseList(doc) {
    var list = [];
    doc.select('.post_list_li').forEach(function (li) {
      var a = li.first('h2 a');
      if (!a.exists()) return;
      var url = a.absUrl('href');
      if (!/xsmp3\.com\/[a-z0-9-]+\/[^\/]+\.html$/.test(url)) return;
      list.push({ url: url, raw: clean(a.text()), category: clean(li.first('.fenli a').text()) });
    });
    return list;
  }

  function lastPageOf(doc, re, def) {
    var list = doc.select('a');
    for (var i = 0; i < list.length; i++) if (list[i].text().indexOf('尾页') >= 0) return regexInt(list[i].absUrl('href'), re, def);
    return def;
  }

  // 从磁盘缓存或全站文章列表（/page/N.html）建立索引
  function getIndex(host) {
    if (index) return index;
    var age = host.cacheAge(CACHE);
    if (age >= 0 && age < INDEX_LIFETIME) {
      var cached = (host.readCache(CACHE) || '').split('\n').map(function (l) { return l.split('\t'); })
        .filter(function (p) { return p.length === 3; })
        .map(function (p) { return { url: p[0], raw: p[1], category: p[2] }; });
      if (cached.length > 0) return (index = cached);
    }
    try {
      host.progress('正在建立搜索索引…');
      if (!partial[1]) partial[1] = parseList(Shun.getDoc(host, SITE, true));
      var last = partial.last || (partial.last = lastPageOf(Shun.getDoc(host, SITE, true), /\/page\/(\d+)\.html/, 1));
      var todo = [];
      for (var p = 2; p <= last; p++) if (!partial[p]) todo.push(p);
      // 每批 12 页并发抓取，失败的页最多重试两次
      for (var round = 0; round < 3 && todo.length > 0; round++) {
        var failed = [];
        for (var i = 0; i < todo.length; i += 12) {
          var batch = todo.slice(i, i + 12);
          var htmls = host.getStrings(batch.map(function (n) { return SITE + 'page/' + n + '.html'; }), { desktop: true }, 6);
          batch.forEach(function (n, k) {
            if (htmls[k] === null) failed.push(n);
            else partial[n] = parseList(host.parseHtml(htmls[k], SITE + 'page/' + n + '.html'));
          });
          host.progress('正在建立搜索索引 ' + Math.min(i + 12, todo.length) + ' / ' + todo.length);
        }
        todo = failed;
        if (todo.length > 0) host.sleep(1000);
      }
      var seen = {}, list = [];
      for (var n = 1; n <= last; n++) {
        (partial[n] || []).forEach(function (e) { if (!seen[e.url]) { seen[e.url] = true; list.push(e); } });
      }
      // 有页面失败时不写缓存，下次再完整重建
      if (todo.length === 0) {
        host.writeCache(CACHE, list.map(function (e) { return e.url + '\t' + e.raw + '\t' + e.category; }).join('\n'));
        index = list;
      } else {
        host.log('相声随身听索引有 ' + todo.length + ' 页失败');
      }
      return list;
    } finally {
      host.progress(null);
    }
  }

  function menu(title, list) {
    return { title: title, tabs: list.map(function (t) { var p = t.split('='); return { title: p[0], url: SITE + p[1] + '.html' }; }) };
  }

  registerSource({
    id: '5b0f3c1e9a7d4e26b8c4d1f0a2e7c913', name: '相声随身听', url: SITE,
    description: '郭德纲、德云社、马三立、侯宝林、刘宝瑞、马季等相声全集。首次搜索需要建立索引（约半分钟，超时的话再搜一次会接着建），之后 7 天内搜索是即时的。',
    group: '相声',

    search: function (keywords, page) {
      var words = keywords.toLowerCase().split(' ').filter(function (w) { return w.length > 0; });
      var matches = getIndex(this.host).filter(function (e) {
        var raw = e.raw.toLowerCase(), cat = e.category.toLowerCase();
        return words.every(function (w) { return raw.indexOf(w) >= 0 || cat.indexOf(w) >= 0; });
      });
      var pageSize = 30;
      return { books: matches.slice((page - 1) * pageSize, page * pageSize).map(toBook), totalPage: Math.max(1, Math.ceil(matches.length / pageSize)) };
    },

    categoryMenus: function () {
      return [
        menu('郭德纲', ['全部=gdg', '郭德纲单口=gdg-dk', '郭德纲于谦=gdg-yq', '郭德纲张文顺=gdg-zws', '郭德纲李菁=gdg-lj', '郭德纲徐德亮=gdg-xdl',
          '郭德纲何云伟=gdg-hyw', '郭德纲曹云金=gdg-cyj', '郭德纲王玥波=gdg-wyb', '郭德纲王文林=gdg-wwl']),
        menu('德云社', ['全部=dys', '德云社精选=dys-jx', '高峰=dys-gf', '岳云鹏=dys-yyp', '郭麒麟=dys-gql', '张鹤伦=dys-zhl', '孟鹤堂=dys-mht',
          '徐德亮王文林=xdl-wwl', '何云伟李菁=hyw-lj', '曹云金刘云天=cyj-lyt']),
        menu('相声名家', ['全部=xsmj', '马三立=msl', '侯宝林=hbl', '刘宝瑞=lbr', '马季=mj', '侯耀文=hyw', '师胜杰=ssj', '姜昆=jk', '马志明=mzm',
          '杨振华=yzh', '苏文茂=swm', '王谦祥=wqx', '高英培=gyp', '李伯祥=lbx', '郭全宝=gqb', '郭荣起=grq', '郝爱民=ham', '李增瑞=lzr',
          '常贵田=cgt', '李金斗=ljd', '张寿臣=zsc', '刘文亨=lwh', '魏文亮=wwl', '常宝霆=cbt', '赵振铎=zzd', '佟有为=tyw', '马敬伯=mjb',
          '于宝林=ybl', '奇志大兵=qzdb', '刘伟=lw', '牛群=nq', '赵伟洲=zwz']),
        menu('更多', ['最新更新=page/1', '相声新势力=xsxsl', '青曲社=qqs'])
      ];
    },

    // 分类第 N 页为 /{code}/N.html，首页列表为 /page/N.html
    categoryPage: function (url) {
      var doc = Shun.getDoc(this.host, url, true);
      var current = regexInt(url, /\/(\d+)\.html$/, 1);
      var total = lastPageOf(doc, /\/(\d+)\.html$/, current);
      return {
        books: parseList(doc).map(toBook), currentPage: current, totalPage: Math.max(total, current),
        nextUrl: Shun.findByText(doc, 'a', '下一页').absUrl('href')
      };
    },

    bookDetail: function (bookUrl) {
      var html = this.host.getString(bookUrl, { desktop: true });
      var doc = this.host.parseHtml(html, bookUrl);
      var tracks = Shun.aplayerItems(html);
      var h1 = doc.first('h1').text();
      return {
        episodes: tracks.map(function (e) { return { title: e.title, url: e.url }; }),
        intro: doc.first('.news_con p').text(),
        title: h1 ? cleanTitle(clean(h1)).title : '',
        artist: tracks.length > 0 ? tracks[0].artist : ''
      };
    },

    audioHeaders: function (audioUrl) { return audioUrl.indexOf('xsmp3.com') >= 0 ? { Referer: SITE } : null; }
  });
})();
