// ---------- 念音网、有听网：同一套网站程序（?s=ting-search-wd-… 搜索，音频存放在 guoguo.org.cn） ----------
function guoguoSource(def) {
  var site = def.site;

  function get(host, url) { return Shun.getDoc(host, url, true, site); }

  function parseBooks(doc, withStatus) {
    var books = [];
    doc.select('.category-list > ul li').forEach(function (li) {
      var a = li.first('.info > h4 > a');
      if (!a.exists()) return;
      var p = li.first('.info').select('p');
      books.push({
        coverUrl: li.first('.img > a > img').absUrl('src'), bookUrl: a.absUrl('href'), title: a.text(),
        author: Shun.stripLabel(Shun.nth(p, 1).text()), artist: Shun.stripLabel(Shun.nth(p, 2).text()),
        status: withStatus ? Shun.stripLabel(Shun.nth(p, 3).text()) : ''
      });
    });
    return books;
  }

  return registerSource({
    id: def.id, name: def.name, url: site, description: def.description,
    coverHeaders: Shun.coverReferer('guoguo.org', site),

    search: function (keywords, page) {
      var doc = get(this.host, site + '?s=ting-search-wd-' + Shun.enc(keywords) + '-p-' + page + '.html');
      var pager = doc.first('.category-list > .c-page');
      var current = regexInt(pager.first('.current').text(), /(\d+)/);
      var last = Shun.findByText(pager, 'a', '尾页');
      return { books: parseBooks(doc, false), totalPage: regexInt(last.absUrl('href'), /p-(\d+)\.html/, current) };
    },

    categoryMenus: function () {
      var tabs = Shun.getDoc(this.host, site, true).first('.nav').select('a')
        .filter(function (a) { return a.text() !== '首页'; })
        .map(function (a) { return { title: a.text(), url: a.absUrl('href') }; });
      return [{ title: '分类', tabs: tabs }];
    },

    categoryPage: function (url) {
      var doc = get(this.host, url);
      var pager = doc.first('.category-list > .c-page');
      var current = regexInt(pager.first('.current').text(), /(\d+)/);
      var total = regexInt(Shun.findByText(pager, 'a', '尾页').absUrl('href'), /index(\d+)\.html/, current);
      return {
        books: parseBooks(doc, true), currentPage: current, totalPage: Math.max(total, current),
        nextUrl: Shun.findByText(pager, 'a', '下一页').absUrl('href')
      };
    },

    bookDetail: function (bookUrl, loadEpisodes) {
      var doc = get(this.host, bookUrl);
      var episodes = loadEpisodes
        ? doc.select('.plist > ul li a').map(function (a) { return { title: a.text(), url: a.absUrl('href') }; })
        : [];
      return { episodes: episodes, intro: doc.first('.intro > p').text() };
    },

    // 播放页要执行脚本后才有音频地址：用 WebView 渲染后读取 jPlayer 的 audio 元素
    audio: function (url) {
      var host = this.host;
      return host.render(url, {
        desktop: true,
        parse: function (html) {
          var src = host.parseHtml(html, site).first('#jp_audio_0').absUrl('src');
          return src.replace('https://cloud.guoguo.org.cn/nyts.php?uid=', 'https://oss-links.guoguo.org.cn/uploads/');
        }
      });
    },

    audioHeaders: function (audioUrl) { return audioUrl.indexOf('guoguo') >= 0 ? { Referer: site } : null; }
  });
}

guoguoSource({
  id: 'd87f1316fa2e41a299074e2b0c086a17', name: '念音网', site: 'https://www.nianyin.com/',
  description: '推荐指数:4星 ⭐⭐⭐⭐\n不是所有都能听，有的可能要会员。'
});
guoguoSource({
  id: 'c3c5bdc9145c4200a38e9a3558861e98', name: '有听网', site: 'https://www.ting15.com/',
  description: '推荐指数:4星 ⭐⭐⭐⭐\n不是所有都能听，有的可能要会员。'
});

// ---------- 乐听吧、米听书、囧贼听书网：同一套网站程序（.row3.row-b 列表 + .pagebar 分页，播放页 var now） ----------
function pageBarSource(def) {
  var site = def.site;

  function parseBooks(items) {
    var books = [];
    items.forEach(function (li) {
      var a = li.first('.style-img.clearfix > section > h2 > a');
      if (!a.exists()) return;
      books.push({
        coverUrl: li.first('.style-img.clearfix > .img-80.fl.mr15 > span > img').absUrl('src'),
        bookUrl: a.absUrl('href'), title: a.text(),
        author: li.first('.style-img.clearfix > section > h2 > span').text(),
        intro: li.first('.style-img.clearfix > section > .f-gray.mb10.f-12').text()
      });
    });
    return books;
  }

  var source = {
    id: def.id, name: def.name, url: site, description: def.description,
    coverHeaders: Shun.coverReferer(Shun.hostOf(site), site),

    // 搜索需要人机验证时，搜索页会显示“验证”按钮
    searchVerificationUrl: function (keywords) { return site + 'search.php?searchword=' + Shun.enc(keywords); },
    searchVerificationDesktop: true,
    searchDelaySeconds: 6, // 网站限制两次搜索的间隔

    search: function (keywords, page) {
      var doc = Shun.getDoc(this.host, site + 'search.php?page=' + page + '&searchword=' + Shun.enc(keywords) + '&searchtype=', true);
      var last = Shun.findByText(doc.first('.pagebar.ta-c.mb15 > span'), 'a', '尾页');
      return { books: parseBooks(doc.first('.row3.row-b').select('li')), totalPage: regexInt(last.absUrl('href'), /page=(\d+)/, page) };
    },

    categoryMenus: function () {
      var tabs = Shun.getDoc(this.host, site, true).select('.nav.mb10 > ul li > a')
        .filter(function (a) { return a.text() !== '首页'; })
        .map(function (a) { return { title: a.text(), url: a.absUrl('href') }; });
      return [{ title: '分类', tabs: tabs }];
    },

    categoryPage: function (url) {
      var doc = Shun.getDoc(this.host, url, true);
      var bar = doc.first('.pagebar.ta-c.mb15 > span');
      var current = regexInt(bar.first('.page.now-page').text(), /(\d+)/);
      var total = regexInt(Shun.findByText(bar, 'a', '尾页').absUrl('href'), /-(\d+)/, current);
      return {
        books: parseBooks(doc.select('.row3.row-b > li')), currentPage: current, totalPage: Math.max(total, current),
        nextUrl: Shun.findByText(bar, 'a', '››').absUrl('href')
      };
    },

    bookDetail: function (bookUrl, loadEpisodes) {
      var doc = Shun.getDoc(this.host, bookUrl, true);
      var episodes = loadEpisodes
        ? doc.select('.ul-36.clearfix li a').map(function (a) { return { title: a.text(), url: a.absUrl('href') }; })
        : [];
      return { episodes: episodes, intro: Shun.nth(doc.first('.style-img.clearfix.pd10 > section').select('p'), 4).text() };
    },

    audio: function (url) { return Shun.varNowAudio(this.host, url, true); }
  };
  if (def.categoryMenus) source.categoryMenus = def.categoryMenus;
  return registerSource(source);
}

pageBarSource({
  id: 'f04408546017411c890d4d72325a67ec', name: '乐听吧', site: 'https://www.leting8.com/',
  description: '推荐指数:3星 ⭐⭐⭐\n搜索可能需要验证：在搜索页点击该源旁的“验证”，输入验证码后返回即可。'
});

pageBarSource({
  id: '63a4f98615394edea416ba5fd15b569d', name: '米听书', site: 'https://www.ting78.com/',
  description: '搜索需要人机验证：在搜索页点击该源旁的“验证”，完成后会自动重新搜索。',
  categoryMenus: function () {
    var names = ['玄幻', '言情', '都市', '恐怖', '惊悚', '推理', '武侠', '历史', '军事', '穿越', '科幻', '网游', '评书', '戏曲', '笑话', '儿童', '财经', '诗歌', '文学', '粤语', '经典', '相声小品', '百家讲坛'];
    var ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 19, 20, 21, 22, 23, 24];
    return [{ title: '有声小说', tabs: names.map(function (n, i) { return { title: n, url: 'https://www.ting78.com/books/' + ids[i] + '.html' }; }) }];
  }
});

pageBarSource({
  id: 'c1bf15e52e0841a1bc621a0a18bdeaea', name: '囧贼听书网', site: 'https://jiongzei.com/',
  description: '言情、武侠、悬疑、评书、相声小品、百家讲坛等。搜索如需验证，点击搜索页该源旁的“验证”即可。'
});

// ---------- 一夜幻听 22ting.com ----------
registerSource({
  id: '488676f5ccf8455aa7770cbd197fd500', name: '一夜幻听', url: 'https://22ting.com/',
  description: '推荐指数:4星 ⭐⭐⭐⭐\n搜索可能需要验证：在搜索页点击该源旁的“验证”，输入验证码后返回即可。',
  coverHeaders: Shun.coverReferer('22ting.com/', 'https://22ting.com/'),

  searchVerificationUrl: function (keywords) { return 'https://22ting.com/search.php?searchword=' + Shun.enc(keywords); },
  searchVerificationDesktop: true,
  searchDelaySeconds: 6,

  search: function (keywords, page) {
    var doc = Shun.getDoc(this.host, 'https://22ting.com/search.php?page=' + page + '&searchword=' + Shun.enc(keywords) + '&searchtype=', true);
    var books = [];
    doc.select('.row-b > li').forEach(function (li) {
      var a = li.first('.clearfix > section > .mb5 > a');
      if (!a.exists()) return;
      books.push({
        coverUrl: li.first('.clearfix > a > span > img').absUrl('src'), bookUrl: a.absUrl('href'), title: a.text(),
        author: li.first('.clearfix > section > .mb5 > .f-gray').text(),
        intro: li.first('.clearfix > section > .mb5 > .f-12').text(),
        status: Shun.nth(li.first('.clearfix > section').select('p'), 1).text()
      });
    });
    var last = Shun.findByText(doc.first('.mb15 > span'), 'a', '尾页');
    return { books: books, totalPage: regexInt(last.absUrl('href'), /page=(\d+)/, page) };
  },

  categoryMenus: function () {
    var nav = Shun.nth(Shun.getDoc(this.host, this.url, true).select('.clearfix'), 1);
    var tabs = nav.select('li > a')
      .filter(function (a) { return a.text() !== '首页'; })
      .map(function (a) { return { title: a.text(), url: a.absUrl('href') }; });
    return [{ title: '分类', tabs: tabs }];
  },

  categoryPage: function (url) {
    var doc = Shun.getDoc(this.host, url, true);
    var bar = doc.first('.mb15 > span');
    var current = regexInt(doc.first('.mb15 > span > .now-page').text(), /(\d+)/);
    var total = regexInt(Shun.findByText(bar, 'a', '尾页').absUrl('href'), /page=(\d+)/, current);
    var next = Shun.findByText(bar, 'a', '››').absUrl('href');
    var books = [];
    doc.select('.row-b > li').forEach(function (li) {
      var a = li.first('.clearfix > section > .mb5 > a');
      if (!a.exists()) return;
      var ps = li.select('.clearfix > section > p');
      books.push({
        coverUrl: li.first('.clearfix > a > .img-box > img').absUrl('src'), bookUrl: a.absUrl('href'), title: a.text(),
        author: li.first('.clearfix > section > .mb5 > span').text(),
        intro: Shun.nth(ps, 0).text(), status: Shun.nth(ps, 1).first('a').text()
      });
    });
    return { books: books, currentPage: current, totalPage: Math.max(total, next ? current + 1 : current), nextUrl: next };
  },

  bookDetail: function (bookUrl, loadEpisodes) {
    var doc = Shun.getDoc(this.host, bookUrl, true);
    var episodes = loadEpisodes
      ? doc.select('#yuedu .clearfix > li a').map(function (a) { return { title: a.text(), url: a.absUrl('href') }; })
      : [];
    return { episodes: episodes, intro: Shun.nth(doc.first('.pd10 > section').select('p'), 4).text() };
  },

  audio: function (url) { return Shun.varNowAudio(this.host, url, true); }
});
