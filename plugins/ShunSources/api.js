// ---------- 哔哩哔哩：搜索视频，按分 P 作为章节，播放 HTML5 版 mp4 的音轨 ----------
(function () {
  var API = 'https://api.bilibili.com/x/';
  var cookie = null; // B 站接口需要一个 buvid3 Cookie（随机生成即可）

  function get(host, url) {
    if (!cookie) cookie = 'buvid3=' + host.uuid().toUpperCase() + 'infoc';
    var json = host.getJson(url, { desktop: true, headers: { Cookie: cookie, Referer: 'https://www.bilibili.com/' } });
    if (int(json, 'code') !== 0) throw new Error('B 站接口返回错误：' + str(json, 'message') + '（' + str(json, 'code') + '）');
    return json.data;
  }

  function https(u) { return u.indexOf('//') === 0 ? 'https:' + u : u; }
  function formatCount(n) { return n >= 10000 ? (Math.round(n / 1000) / 10) + '万' : String(n); }

  function search(host, keywords, page) {
    var data = get(host, API + 'web-interface/search/type?search_type=video&keyword=' + Shun.enc(keywords) + '&page=' + page);
    var books = items(data, 'result').map(function (v) {
      return {
        coverUrl: https(str(v, 'pic')), bookUrl: 'https://m.bilibili.com/video/' + str(v, 'bvid'),
        title: host.htmlDecode(str(v, 'title').replace(/<[^>]+>/g, '')), artist: str(v, 'author'),
        status: '播放 ' + formatCount(int(v, 'play')) + ' · ' + str(v, 'duration'), intro: str(v, 'description')
      };
    });
    return { books: books, totalPage: Math.max(1, int(data, 'numPages')) };
  }

  registerSource({
    id: 'c893546d95f84db194046bd8de5dbcbb', name: '哔哩哔哩', url: 'https://m.bilibili.com',
    description: '推荐指数:5星 ⭐⭐⭐⭐⭐\nB 站有很多意想不到的有声书。播放的是视频的声音，多 P 视频每一 P 为一集。',
    coverHeaders: Shun.coverReferer('hdslb.com', 'https://www.bilibili.com/'),

    search: function (keywords, page) { return search(this.host, keywords, page); },

    // 分类即按关键词搜索
    categoryMenus: function () {
      var words = [['有声小说', '有声小说'], ['广播剧', '广播剧'], ['评书', '评书'], ['相声', '相声'], ['有声漫画', '有声漫画'],
        ['英文有声书', 'audiobooks'], ['经典老歌', '经典老歌'], ['音乐推荐', '音乐推荐'], ['同人音声', '同人音声']];
      return [{ title: '推荐', tabs: words.map(function (w) { return { title: w[0], url: 'bili-search:' + w[1] + '#1' }; }) }];
    },

    categoryPage: function (url) {
      var m = /^bili-search:(.+)#(\d+)$/.exec(url);
      var page = parseInt(m[2], 10);
      var r = search(this.host, m[1], page);
      return { books: r.books, currentPage: page, totalPage: r.totalPage, nextUrl: page < r.totalPage ? 'bili-search:' + m[1] + '#' + (page + 1) : null };
    },

    bookDetail: function (bookUrl) {
      var bvid = bookUrl.replace(/\/+$/, '').split('/').pop().split('?')[0];
      var data = get(this.host, API + 'web-interface/view?bvid=' + bvid);
      var pages = items(data, 'pages');
      var episodes = pages.map(function (p) {
        var part = str(p, 'part');
        return { title: pages.length === 1 ? str(data, 'title') : (part.length > 0 ? part : 'P' + int(p, 'page')), url: 'bili:' + str(data, 'aid') + ':' + str(p, 'cid') };
      });
      return { episodes: episodes, intro: str(data, 'desc'), title: str(data, 'title'), artist: str(data, 'owner.name'), coverUrl: https(str(data, 'pic')) };
    },

    // 播放地址带时效签名，每次播放时现取
    audio: function (url) {
      var parts = url.split(':');
      if (parts.length !== 3 || parts[0] !== 'bili') throw new Error('章节地址已过期，请刷新章节列表');
      var data = get(this.host, API + 'player/playurl?avid=' + parts[1] + '&cid=' + parts[2] + '&platform=html5&otype=json&qn=16&type=mp4&html5=1');
      var audio = str(data, 'durl.0.url');
      if (!audio) throw new Error('没有获取到播放地址（可能是大会员或付费内容）');
      return audio;
    },

    audioHeaders: function (audioUrl) {
      return audioUrl.indexOf('bilivideo') >= 0 || audioUrl.indexOf('akamaized') >= 0 ? { Referer: 'https://www.bilibili.com/' } : null;
    }
  });
})();

// ---------- 博看有声 ----------
(function () {
  var INSTANCE = '25304';

  function units(bookUrl, p) { return 'https://api.bookan.com.cn/voice/album/units?album_id=' + bookUrl + '&page=' + p + '&num=20&order=1'; }
  var lastPages = {}; // 搜索时每个关键词下图书 / 专辑各有多少页：{ 关键词: { book: 17, album: 0 } }

  function parseUnits(data) { return items(data, 'list').map(function (i) { return { title: str(i, 'title'), url: str(i, 'file') }; }); }

  registerSource({
    id: 'c98a21452583434da5cfef8be16b71d6', name: '博看有声', url: 'https://voicewk.bookan.com.cn/25303/index',
    description: '推荐指数:5星 ⭐⭐⭐⭐⭐\n图书馆数字资源，经典名著、人文社科类有声书。',
    multipleEpisodePages: true,

    // 图书和专辑是两个接口，各自分页：按传入的页码请求，总页数取两者中较大的；
    // 某一类已经翻完（页码超过它的最后一页）就不再请求它
    search: function (keywords, page) {
      var host = this.host, books = [], failed = 0;
      var known = lastPages[keywords] || (lastPages[keywords] = {});
      var types = ['book', 'album'];
      types.forEach(function (type) {
        if (known[type] !== undefined && page > known[type]) return;
        try {
          var json = host.getJson('https://es.bookan.com.cn/api/v3/voice/' + type + '?instanceId=' + INSTANCE + '&keyword=' + Shun.enc(keywords) +
            '&pageNum=' + page + '&limitNum=20');
          known[type] = int(json, 'data.last_page', 0);
          items(json, 'data.list').forEach(function (i) { books.push({ coverUrl: str(i, 'cover'), bookUrl: str(i, 'id'), title: str(i, 'name') }); });
        } catch (e) {
          if (e.cancelled) throw e;
          failed++;
          host.log('搜索 ' + type + ' 失败：' + e.message);
        }
      });
      if (failed === types.length) throw new Error('博看有声搜索失败，请稍后再试');
      return { books: books, totalPage: Math.max(page, known.book || 0, known.album || 0) };
    },

    categoryMenus: function () {
      function tabs(type, list) {
        return list.map(function (p) {
          return { title: p[0], url: 'https://api.bookan.com.cn/voice/' + type + '/list?instance_id=' + INSTANCE + '&page=1&category_id=' + p[1] + '&num=24' };
        });
      }
      return [
        { title: '图书', tabs: tabs('book', [['经典必读', 1314], ['国学经典', 1320], ['文学文艺', 1306], ['少年读物', 1305], ['儿童文学', 1304],
          ['心理哲学', 1310], ['育儿心经', 1309], ['家庭健康', 1311], ['青春励志', 1307], ['历史小说', 1312],
          ['商业财经', 1315], ['科技科普', 1313], ['故事会', 1303], ['红色岁月', 1316], ['社会观察', 1318], ['音乐戏曲', 1317], ['相声评书', 1319]]) },
        { title: '专辑', tabs: tabs('album', [['健康养生', 4], ['休闲娱乐', 5], ['财经科技', 6], ['广播节目', 7], ['人文社科', 8],
          ['少儿学堂', 9], ['文史军事', 10], ['投资理财', 11], ['亲子教育', 12], ['时尚生活', 13],
          ['汽车知识', 14], ['发展创业', 15], ['婚恋情感', 16], ['自我提升', 17], ['商业资讯', 18], ['新闻热点', 19]]) }
      ];
    },

    categoryPage: function (url) {
      var data = this.host.getJson(url).data;
      var current = int(data, 'current_page', 1), total = int(data, 'last_page', 1);
      var books = items(data, 'list').map(function (i) {
        return { coverUrl: str(i, 'cover'), bookUrl: str(i, 'id'), title: str(i, 'name'), status: '共 ' + int(i, 'total') + ' 章' };
      });
      return { books: books, currentPage: current, totalPage: total, nextUrl: current < total ? url.replace(/page=\d+/, 'page=' + (current + 1)) : null };
    },

    bookDetail: function (bookUrl, loadEpisodes, loadFullPages) {
      if (!loadEpisodes) return { episodes: [] };
      var host = this.host;
      var data = host.getJson(units(bookUrl, 1)).data;
      var total = int(data, 'last_page', 1);
      var list = parseUnits(data);
      if (loadFullPages) {
        try {
          for (var p = 2; p <= total; p++) {
            host.progress(p + ' / ' + total);
            list = list.concat(parseUnits(host.getJson(units(bookUrl, p)).data));
            host.sleep(100 + Math.random() * 300);
          }
        } finally {
          host.progress(null);
        }
      }
      return { episodes: list };
    }
  });
})();

// ---------- 云图有声 ----------
(function () {
  var API = 'http://open-service.yuntuys.com/api/w_ys/book/';
  var WECHAT = 'wechat:07955551-706c-4259-9aa0-db4627dfca57';

  function parseBook(i) {
    return {
      coverUrl: str(i, 'cover'), bookUrl: str(i, 'bookId'), title: str(i, 'bookName'), author: str(i, 'authorName'), artist: str(i, 'anchorName'),
      status: '共 ' + int(i, 'chapters') + ' 章', intro: str(i, 'summary')
    };
  }
  function chapters(bookUrl, p) { return API + 'getChapters/' + WECHAT + '/' + bookUrl + '/true/asc?pageSize=200&pageNum=' + p; }
  function parseChapters(q) { return items(q, 'list').map(function (i) { return { title: str(i, 'name'), url: str(i, 'audioUrl') }; }); }

  registerSource({
    id: 'ab0a5474cd6a40e3ba65045addad390a', name: '云图有声', url: 'http://yuntuwechat.yuntuys.com/home',
    description: '推荐指数:5星 ⭐⭐⭐⭐⭐\n正版有声书平台，经典文学、历史、少儿等。',
    multipleEpisodePages: true,

    search: function (keywords, page) {
      var data = this.host.getJson(API + 'search/' + WECHAT + '/' + Shun.enc(keywords) + '?pageSize=20&pageNum=' + page).data;
      return { books: items(data, 'list').map(parseBook), totalPage: Math.max(1, int(data, 'totalPage')) };
    },

    categoryMenus: function () {
      function menu(title, list) {
        return { title: title, tabs: list.map(function (p) { return { title: p[0], url: API + 'getBookListByType/' + WECHAT + '/' + p[1] + '?pageNum=1&pageSize=20' }; }) };
      }
      return [
        menu('特色', [['四史专栏', 585], ['远读重洋', 571], ['听见真知', 124], ['豆瓣高分', 125], ['广播剧', 126], ['影视同期', 127], ['云图学院', 421]]),
        menu('经典文学', [['世界名著', 131], ['中国文学', 132], ['国学经典', 134], ['外国文学', 133], ['诗词散文', 135], ['人物传记', 136]]),
        menu('畅销小说', [['国风古韵', 137], ['青春校园', 138], ['科学幻想', 139], ['官场商战', 140], ['军事谍战', 141], ['悬疑推理', 142], ['现代都市', 143], ['怪奇物语', 144], ['侠义江湖', 335]]),
        menu('职场财经', [['创业学院', 148], ['职场指南', 149], ['商界大咖', 150], ['金融理财', 151]]),
        menu('少儿教育', [['儿童文学', 152], ['童话名著', 153], ['国学启蒙', 154], ['儿歌故事', 155], ['百科知识', 156], ['亲子教育', 157]]),
        menu('文化历史', [['民俗文化', 161], ['世界之窗', 163], ['哲学思想', 164], ['古代历史', 165], ['近现代史', 166], ['世界历史', 167], ['传奇史话', 168]]),
        menu('军事', [['军事纪实', 173], ['战争烽火', 174], ['革命先驱', 176], ['政治领袖', 177]]),
        menu('生活', [['养生保健', 181], ['养颜减肥', 182], ['食疗课堂', 183], ['孕产育儿', 184], ['心理健康', 185], ['婚恋家庭', 186], ['心灵励志', 187], ['生活百科', 188], ['娱乐休闲', 189]])
      ];
    },

    categoryPage: function (url) {
      var data = this.host.getJson(url).data;
      var current = int(data, 'pageNumber', 1);
      var total = Math.max(current, int(data, 'totalPage', 1));
      return {
        books: items(data, 'list').map(parseBook), currentPage: current, totalPage: total,
        nextUrl: current < total ? url.replace(/pageNum=\d+/, 'pageNum=' + (current + 1)) : null
      };
    },

    bookDetail: function (bookUrl, loadEpisodes, loadFullPages) {
      if (!loadEpisodes) return { episodes: [] };
      var host = this.host;
      var query = at(host.getJson(chapters(bookUrl, 1)), 'data.pageQuery');
      var total = int(query, 'totalPage', 1);
      var list = parseChapters(query);
      if (loadFullPages) {
        try {
          for (var p = 2; p <= total; p++) {
            host.progress(p + ' / ' + total);
            list = list.concat(parseChapters(at(host.getJson(chapters(bookUrl, p)), 'data.pageQuery')));
            host.sleep(100 + Math.random() * 300);
          }
        } finally {
          host.progress(null);
        }
      }
      return { episodes: list };
    }
  });
})();

// ---------- 酷我畅听 ----------
(function () {
  var ALBUM_INFO = 'https://search.kuwo.cn/r.s?stype=albuminfo&loginUid=0&loginSid=null&prod=kwplayer_ar_9.1.7.0&bkprod=kwbook_ar_9.1.7.0' +
    '&source=kwplayer_ar_9.1.7.0_t18.apk&bksource=kwbook_ar_9.1.7.0_t18.apk&corp=kuwo&show_copyright_off=1' +
    '&vipver=MUSIC_8.2.0.0_BCS17&mobi=1&sortby=3&iskwbook=1';

  function bookUrl(albumId) { return ALBUM_INFO + '&albumid=' + albumId + '&pn=0&rn=200'; }
  function parseAlbum(item) {
    return {
      coverUrl: str(item, 'coverImg'), bookUrl: bookUrl(str(item, 'albumId')), title: str(item, 'albumName'), artist: str(item, 'artistName'),
      status: '共 ' + int(item, 'songTotal') + ' 章', intro: str(item, 'title')
    };
  }

  registerSource({
    id: '502efedf0613460a9967d9e86ce2b24c', name: '酷我畅听', url: 'https://kuwo.cn/downtingshu',
    description: '推荐指数:5星 ⭐⭐⭐⭐⭐\n酷我音乐的听书频道，部分付费内容只能试听或无法播放。',
    multipleEpisodePages: true,

    search: function (keywords, page) {
      var data = this.host.getJson('http://tingshu.kuwo.cn/tingshu/api/search/Search?rn=10&type=album&version=8.5.6.1&wd=' + Shun.enc(keywords) + '&pn=' + page + '&kweexVersion=1.0.2').data;
      return { books: items(data, 'data').map(parseAlbum), totalPage: Math.max(1, Math.ceil(int(data, 'total') / 10)) };
    },

    categoryMenus: function () {
      function tabs(category, list) {
        return list.map(function (p) {
          return { title: p[0], url: 'http://tingshu.kuwo.cn/tingshu/api/filter/albums?sortType=tsScore&classifyId=' + p[1] + '&rn=20&categoryId=' + category + '&pn=1&kweexVersion=1.0.2' };
        });
      }
      return [
        { title: '小说', tabs: [{ title: '免费排行', url: 'http://tingshu.kuwo.cn/tingshu/api/page/boutique/getBoutiqueData?pt=2&rn=100&version=8.5.6.1&pn=1&kweexVersion=1.0.2' }]
          .concat(tabs(2, [['都市传说', 42], ['玄幻奇幻', 44], ['悬疑推理', 45], ['现代言情', 41], ['武侠仙侠', 48], ['穿越架空', 52],
            ['经典小说', 64], ['青春校园', 55], ['历史军事', 56], ['科幻竞技', 57], ['古代言情', 207]])) },
        { title: '成长', tabs: tabs(4, [['能力提升', 82], ['人文艺术', 77], ['国学文化', 78], ['成功法则', 79], ['外语精通', 76], ['养生健康', 81], ['酷我读书', 211]]) },
        { title: '人文历史', tabs: tabs(9, [['国学经典', 117], ['历史小说', 181], ['纪实档案', 118], ['历史传奇', 119], ['人物传奇', 120], ['文化讲堂', 121], ['百家讲坛', 212]]) }
      ];
    },

    categoryPage: function (url) {
      var page = regexInt(url, /pn=(\d+)/);
      var data = this.host.getJson(url).data;
      var total, books;
      if (data && Array.isArray(data.topDatas)) {
        total = Math.ceil(int(data, 'pageInfo.total') / 100);
        books = items(data, 'topDatas').map(function (t) { return t.albums; }).filter(function (a) { return a; }).map(function (a) {
          return { coverUrl: str(a, 'img'), bookUrl: bookUrl(str(a, 'albumId')), title: str(a, 'name'), status: '共 ' + int(a, 'songTotal') + ' 章', intro: str(a, 'title') };
        });
      } else {
        total = Math.ceil(int(data, 'total') / 20);
        books = items(data, 'data').map(parseAlbum);
      }
      return { books: books, currentPage: page, totalPage: Math.max(total, page), nextUrl: page < total ? url.replace(/pn=\d+/, 'pn=' + (page + 1)) : null };
    },

    bookDetail: function (url, loadEpisodes, loadFullPages) {
      var list = [];
      if (!loadEpisodes) return { episodes: list };
      var host = this.host;
      var albumId = (/albumid=(\d+)/.exec(url) || [])[1] || '';
      try {
        for (var page = 0; page < 100; page++) {
          var tracks = items(host.getJson(ALBUM_INFO + '&albumid=' + albumId + '&pn=' + page + '&rn=200'), 'musiclist');
          if (tracks.length === 0) break;
          tracks.forEach(function (i) { list.push({ title: str(i, 'name'), url: 'kuwo:' + str(i, 'musicrid') }); });
          if (!loadFullPages || tracks.length < 200) break;
          host.progress('第 ' + (page + 2) + ' 页');
          host.sleep(200 + Math.random() * 400);
        }
      } finally {
        host.progress(null);
      }
      return { episodes: list };
    },

    audio: function (url) {
      var rid = url.replace('kuwo:', '').replace('MUSIC_', '');
      var json = this.host.getJson('https://mobi.kuwo.cn/mobi.s?f=web&source=kwplayercar_ar_6.0.0.9_B_jiakong_vh.apk&from=PC&type=convert_url_with_sign&br=128kmp3&rid=' + rid, { desktop: true });
      var audio = str(json, 'data.url');
      if (!audio) throw new Error('没有获取到播放地址（可能是付费内容）');
      return audio;
    }
  });
})();

// ---------- 懒人听书 m.lrts.me：JSON 接口、分页章节、免费章节走接口，付费章节走 WebView 嗅探（需要登录） ----------
(function () {
  var EPISODE_PAGE_SIZE = 50; // 接口目前最多支持 50
  var CATEGORY_PAGE_SIZE = 20;
  var categoryBookIds = {}; // 分类第一页会返回该分类下全部书籍 ID，后续页按 ID 列表请求

  function parseBook(node) {
    var cover = str(node, 'cover');
    if (cover.length > 0 && cover.indexOf('180') < 0) {
      var dot = cover.lastIndexOf('.');
      if (dot > 0) cover = cover.substring(0, dot) + '_180x254' + cover.substring(dot);
    }
    var title = str(node, 'name');
    var tags = str(node, 'tags');
    if (tags.indexOf('VIP') >= 0) title = '[VIP] ' + title;
    else if (tags.indexOf('精品') >= 0) title = '[精品] ' + title;
    var finished = int(node, 'state') === 2;
    var sections = int(node, 'sections');
    var intro = str(node, 'recReason');
    if (intro.length === 0 || intro === 'null') intro = str(node, 'desc');
    return {
      coverUrl: cover, bookUrl: 'https://m.lrts.me?' + str(node, 'id'), title: title, author: str(node, 'author'), artist: str(node, 'announcer'),
      intro: intro, status: (finished ? '完本' : '连载') + (sections > 0 ? ' · ' + sections + ' 集' : '')
    };
  }

  function parseQuery(url) {
    var q = {}, i = url.indexOf('?');
    if (i < 0) return q;
    url.substring(i + 1).split('&').forEach(function (p) {
      var k = p.split('=')[0];
      if (k && !(k in q)) q[k] = decodeURIComponent(p.substring(k.length + 1));
    });
    return q;
  }

  function getMenu(host, bookId, page) {
    var json = host.getJson('https://m.lrts.me/ajax/getBookMenu?bookId=' + bookId + '&pageNum=' + page + '&pageSize=' + EPISODE_PAGE_SIZE + '&sortType=0');
    // 出错时返回 {"status":"n1006","msg":"服务器繁忙"}
    if (!json.list && str(json, 'msg')) throw new Error(str(json, 'msg'));
    return json;
  }

  function parseEpisodes(json, bookId, offset) {
    return items(json, 'list').map(function (track, i) {
      var isFree = int(track, 'payType') === 0;
      return {
        title: str(track, 'name'), isFree: isFree,
        url: isFree
          ? 'https://m.lrts.me/ajax/getPlayPath?entityId=' + bookId + '&entityType=3&opType=1&sections=[' + int(track, 'section') + ']&type=0'
          : 'https://m.lrts.me/player?index=' + (offset + i) + '&entityType=3&sonId=' + str(track, 'id') + '&id=' + bookId
      };
    });
  }

  registerSource({
    id: '4a3ed84e5cf841609ed4d7f790fc7fbf', name: '懒人听书', url: 'https://m.lrts.me',
    description: '正版源，免费书籍较少。带 [VIP] / [精品] 的书需要登录对应账号后才能收听。',
    multipleEpisodePages: true,
    loginUrl: 'https://m.lrts.me/user',

    search: function (keywords, page) {
      var result = at(this.host.getJson('https://m.lrts.me/ajax/search?keyWord=' + Shun.enc(keywords) + '&pageSize=40&pageNum=' + page + '&searchOption=1'), 'data.bookResult');
      return { books: items(result, 'list').map(parseBook), totalPage: Math.max(Math.ceil(int(result, 'count') / 40), 1) };
    },

    categoryMenus: function () {
      function menu(title, list) {
        return { title: title, tabs: list.map(function (p) {
          return { title: p[0], url: 'https://m.lrts.me/ajax/getResourceList?dsize=' + CATEGORY_PAGE_SIZE + '&entityId=' + p[1] + '&entityType=1&pageNum=1&showFilters=1' };
        }) };
      }
      return [
        menu('有声小说', [['玄幻奇幻', 11], ['都市传说', 8], ['穿越架空', 3109], ['武侠仙侠', 14], ['青春校园', 3106],
          ['历史幻想', 12], ['科幻空间', 3021], ['网游竞技', 9042], ['热血军事', 9041], ['官场商战', 44]]),
        menu('人文', [['心理百科', 9045], ['科学科普', 9046], ['人物传记', 17], ['纪实传奇', 3063], ['哲学宗教', 1026], ['文艺文化', 9044], ['公开课', 109]]),
        menu('财经', [['投资理财', 3059], ['股市', 3058], ['商业智慧', 3057], ['管理营销', 16], ['创业', 9048]]),
        menu('儿童', [['益智故事', 63], ['儿童文学', 3027], ['国学启蒙', 9031], ['卡通动画', 9029], ['少儿名著', 9245], ['少儿科普', 64], ['少儿英语', 68]]),
        menu('曲艺戏曲', [['戏曲名家', 9060], ['豫剧', 95], ['京剧', 89], ['黄梅戏', 93], ['越剧', 90], ['鼓书琴书', 67]])
      ];
    },

    categoryPage: function (url) {
      var query = parseQuery(url);
      var entityId = query.entityId || '';
      var json = this.host.getJson(url);
      var useAlbums = int(json, 'albumCount') > 0;
      var books = items(json, useAlbums ? 'albums' : 'books').map(parseBook);
      var currentPage;
      if (!('bookIds' in query)) {
        currentPage = 1;
        categoryBookIds[entityId] = items(json, useAlbums ? 'albumIds' : 'bookIds');
      } else {
        currentPage = parseInt(query.page, 10) || 2;
      }
      var nextUrl = null, ids = categoryBookIds[entityId];
      if (ids) {
        var from = currentPage * CATEGORY_PAGE_SIZE;
        if (from < ids.length) {
          nextUrl = 'https://m.lrts.me/ajax/getResourceList?dsize=' + CATEGORY_PAGE_SIZE + '&entityId=' + entityId + '&entityType=0&pageNum=0&showFilters=0' +
            '&page=' + (currentPage + 1) + '&bookIds=[' + ids.slice(from, from + CATEGORY_PAGE_SIZE).join(',') + ']';
        }
      }
      return { books: books, currentPage: currentPage, totalPage: nextUrl ? currentPage + 1 : currentPage, nextUrl: nextUrl };
    },

    bookDetail: function (bookUrl, loadEpisodes, loadFullPages) {
      var host = this.host;
      var bookId = bookUrl.split('?').pop();
      var episodes = [];
      if (loadEpisodes) {
        var first = getMenu(host, bookId, 1);
        var pageCount = Math.ceil(int(first, 'sections') / EPISODE_PAGE_SIZE);
        episodes = parseEpisodes(first, bookId, 0);
        if (loadFullPages) {
          try {
            for (var page = 2; page <= pageCount; page++) {
              host.progress(page + ' / ' + pageCount);
              episodes = episodes.concat(parseEpisodes(getMenu(host, bookId, page), bookId, episodes.length));
              host.sleep(100 + Math.random() * 300);
            }
          } finally {
            host.progress(null);
          }
        }
      }
      var info = host.getJson('https://m.lrts.me/ajax/getBookInfo?id=' + bookId);
      return { episodes: episodes, intro: str(info, 'extraInfos.0.content'), artist: str(info, 'announcer'), author: str(info, 'author'), coverUrl: str(info, 'bestCover') };
    },

    audio: function (url) {
      if (url.indexOf('getPlayPath') >= 0) {
        var json = this.host.getJson(url);
        var path = str(json, 'list.0.path');
        if (!path) throw new Error(str(json, 'msg') || '无法获取音频地址');
        return path;
      }
      // 付费章节：打开播放页嗅探（需要先在插件页面登录）
      return this.host.sniff(url);
    }
  });
})();

// ---------- 听友听书（tingyou.fm）：网站自己的 JSON 接口 ----------
(function () {
  var SITE = 'https://tingyou.fm';
  // 接口的域名网站会换：先用上次能用的，再挨个试已知的，都不行就到网站首页里找现在用的是哪个
  var BASES = ['https://api-preview.toulaopao.cc/api', 'https://appp.fdhtbz.cn/api', 'https://laopaoaappi.oobyvy.vip/api'];
  var working = null;
  var session = null;   // 网站每次打开生成一个会话标识，这里照做
  var filters = null;   // 分类筛选项，取一次就够

  // 接口只认从网站页面发出的请求（看 Origin）
  function options(host, body) {
    if (!session) session = host.uuid();
    var o = { headers: { Origin: SITE, Referer: SITE + '/', Accept: 'application/json', 'x-listening-session': session, 'x-listening-timezone': 'Asia/Shanghai' } };
    if (body !== undefined) { o.method = 'POST'; o.body = JSON.stringify(body); o.contentType = 'application/json'; }
    return o;
  }

  function discover(host) {
    try {
      var m = /https:\/\/[a-z0-9.-]+\/api(?=["\\/])/i.exec(host.getString(SITE + '/listening'));
      return m ? m[0] : null;
    } catch (e) { return null; }
  }

  // 请求接口并解析成 JSON。allowEmpty：翻到最后一页以后接口返回空内容，不算出错
  function call(host, path, body, allowEmpty) {
    var tried = {}, last = null;
    var list = [working || host.getPref('base')].concat(BASES);
    for (var i = 0; i <= list.length; i++) {
      var base = i < list.length ? list[i] : discover(host);
      if (!base || tried[base]) continue;
      tried[base] = true;
      try {
        var text = host.getString(base + '/h5/listening/' + path, options(host, body));
        if (!text.trim() && allowEmpty) return {};
        var json = parseJson(text);
        if (json && json.error) throw new Error(str(json, 'message') || '接口返回错误');
        if (working !== base) { working = base; host.setPref('base', base); }
        return json;
      } catch (e) {
        if (e.cancelled) throw e;
        last = e;
      }
    }
    throw new Error('听友听书的接口现在访问不了：' + (last ? last.message : '没有可用的地址'));
  }

  function albumId(url) {
    var m = /album\/(\d+)/.exec(url);
    if (!m) throw new Error('不认识的地址：' + url);
    return m[1];
  }

  function toBook(a) {
    var count = int(a, 'count');
    return {
      coverUrl: str(a, 'cover_url'), bookUrl: SITE + '/listening/album/' + str(a, 'id'), title: str(a, 'title').trim(),
      author: str(a, 'author'), artist: str(a, 'teller'), intro: str(a, 'intro') || str(a, 'description') || str(a, 'synopsis'),
      status: (int(a, 'status') === 0 ? '已完结' : '连载中') + (count > 0 ? ' · ' + count + ' 集' : '')
    };
  }

  var SORTS = { '综合排序': 'comprehensive', '播放最多': 'popular', '最近更新': 'updated', '最新发布': 'new' };

  registerSource({
    id: 'a6d1c3f08b2e4759b8e0f4a27c915d36', name: '听友听书', url: SITE + '/listening',
    description: '有声小说和评书比较全，更新快。直接用网站的接口，不需要登录。',
    config: [{ type: 'select', key: 'sort', label: '分类里的排序', default: '播放最多', options: ['综合排序', '播放最多', '最近更新', '最新发布'] }],

    search: function (keywords, page) {
      var json = call(this.host, 'search', { keyword: keywords, page: page });
      var books = items(json, 'results').map(toBook);
      // 接口只说“后面还有没有”，没有总页数：有就再翻一页
      return { books: books, totalPage: json.has_more && books.length > 0 ? page + 1 : page };
    },

    categoryMenus: function () {
      var menus = [{ title: '推荐', tabs: [['最新', 'latest'], ['热门', 'hot'], ['推荐', 'recommend'], ['连载', 'serial']].map(function (t) {
        return { title: t[0], url: 'tingyou:rank:' + t[1] + '#1' };
      }) }];
      if (!filters) filters = call(this.host, 'filters');
      items(filters, 'categories').forEach(function (c) {
        var tabs = [{ title: '全部', url: 'tingyou:cat:category=' + str(c, 'id') + '#1' }].concat(items(c, 'types').map(function (t) {
          return { title: str(t, 'name'), url: 'tingyou:cat:type=' + str(t, 'id') + '#1' };
        }));
        menus.push({ title: str(c, 'name'), tabs: tabs });
      });
      return menus;
    },

    categoryPage: function (url) {
      var m = /^tingyou:(rank|cat):([^#]+)#(\d+)$/.exec(url);
      if (!m) throw new Error('不认识的分类地址：' + url);
      var page = parseInt(m[3], 10), next = 'tingyou:' + m[1] + ':' + m[2] + '#' + (page + 1), books, total;
      if (m[1] === 'rank') {
        var r = call(this.host, 'rank?section=' + m[2] + '&page=' + page, undefined, true);
        books = items(r, 'items').map(toBook);
        var size = int(r, 'page_size', 30) || 30;
        total = r.has_more ? Math.max(page + 1, Math.ceil(int(r, 'total') / size)) : page;
      } else {
        var sort = SORTS[this.host.getPref('sort', '播放最多')] || 'popular';
        var c = call(this.host, 'category?sort=' + sort + '&' + m[2] + '&page=' + page, undefined, true);
        books = items(c, 'data').map(toBook);
        total = Math.max(page, int(c, 'pages', page));
      }
      if (books.length === 0) total = page;
      return { books: books, currentPage: page, totalPage: total, nextUrl: page < total ? next : null };
    },

    bookDetail: function (bookUrl, loadEpisodes) {
      var id = albumId(bookUrl);
      var a = call(this.host, 'album/' + id);
      if (a.available === false) throw new Error('这本书已经下架了');
      var detail = toBook(a);
      detail.episodes = [];
      if (loadEpisodes) {
        var c = call(this.host, 'chapters/' + id);
        // 章节地址里记下“第几集”，取播放地址时要用
        detail.episodes = items(c, 'chapters').map(function (ch) {
          return { title: str(ch, 'title').trim() || ('第 ' + int(ch, 'index') + ' 集'), url: SITE + '/listening/album/' + id + '#' + int(ch, 'index') };
        });
      }
      return detail;
    },

    // 播放地址带时效和签名，每次现取
    audio: function (url) {
      var m = /album\/(\d+)#(\d+)$/.exec(url);
      if (!m) throw new Error('不认识的章节地址：' + url);
      var json = call(this.host, 'play', { album_id: m[1], chapter_idx: parseInt(m[2], 10) });
      var play = str(json, 'play_url');
      if (!play) throw new Error(str(json, 'detail') || str(json, 'message') || '没有拿到播放地址');
      return play;
    }
  });
})();

// ---------- 蜻蜓FM（qtfm.cn）：网站自己的接口，音频地址要带签名 ----------
(function () {
  var SITE = 'https://www.qtfm.cn';
  var CAPI = 'https://i.qtfm.cn/capi/';
  var PAGE = 100; // 节目列表一页最多给 100 条

  // --- HMAC-MD5（音频地址的签名用）。按字节算，不能用宿主的 md5（那个是按文本算的） ---
  function md5(bytes) {
    function add(x, y) { var l = (x & 0xFFFF) + (y & 0xFFFF); return (((x >> 16) + (y >> 16) + (l >> 16)) << 16) | (l & 0xFFFF); }
    function rol(n, c) { return (n << c) | (n >>> (32 - c)); }
    function cmn(q, a, b, x, s, t) { return add(rol(add(add(a, q), add(x, t)), s), b); }
    function ff(a, b, c, d, x, s, t) { return cmn((b & c) | (~b & d), a, b, x, s, t); }
    function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & ~d), a, b, x, s, t); }
    function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
    function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | ~d), a, b, x, s, t); }
    var n = bytes.length, words = [], i;
    for (i = 0; i < n; i++) words[i >> 2] |= bytes[i] << ((i % 4) * 8);
    words[n >> 2] |= 0x80 << ((n % 4) * 8);
    words[(((n + 8) >> 6) << 4) + 14] = n * 8;
    var a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
    for (i = 0; i < words.length; i += 16) {
      var x = [], k; for (k = 0; k < 16; k++) x[k] = words[i + k] | 0;
      var oa = a, ob = b, oc = c, od = d;
      a = ff(a, b, c, d, x[0], 7, -680876936); d = ff(d, a, b, c, x[1], 12, -389564586); c = ff(c, d, a, b, x[2], 17, 606105819); b = ff(b, c, d, a, x[3], 22, -1044525330);
      a = ff(a, b, c, d, x[4], 7, -176418897); d = ff(d, a, b, c, x[5], 12, 1200080426); c = ff(c, d, a, b, x[6], 17, -1473231341); b = ff(b, c, d, a, x[7], 22, -45705983);
      a = ff(a, b, c, d, x[8], 7, 1770035416); d = ff(d, a, b, c, x[9], 12, -1958414417); c = ff(c, d, a, b, x[10], 17, -42063); b = ff(b, c, d, a, x[11], 22, -1990404162);
      a = ff(a, b, c, d, x[12], 7, 1804603682); d = ff(d, a, b, c, x[13], 12, -40341101); c = ff(c, d, a, b, x[14], 17, -1502002290); b = ff(b, c, d, a, x[15], 22, 1236535329);
      a = gg(a, b, c, d, x[1], 5, -165796510); d = gg(d, a, b, c, x[6], 9, -1069501632); c = gg(c, d, a, b, x[11], 14, 643717713); b = gg(b, c, d, a, x[0], 20, -373897302);
      a = gg(a, b, c, d, x[5], 5, -701558691); d = gg(d, a, b, c, x[10], 9, 38016083); c = gg(c, d, a, b, x[15], 14, -660478335); b = gg(b, c, d, a, x[4], 20, -405537848);
      a = gg(a, b, c, d, x[9], 5, 568446438); d = gg(d, a, b, c, x[14], 9, -1019803690); c = gg(c, d, a, b, x[3], 14, -187363961); b = gg(b, c, d, a, x[8], 20, 1163531501);
      a = gg(a, b, c, d, x[13], 5, -1444681467); d = gg(d, a, b, c, x[2], 9, -51403784); c = gg(c, d, a, b, x[7], 14, 1735328473); b = gg(b, c, d, a, x[12], 20, -1926607734);
      a = hh(a, b, c, d, x[5], 4, -378558); d = hh(d, a, b, c, x[8], 11, -2022574463); c = hh(c, d, a, b, x[11], 16, 1839030562); b = hh(b, c, d, a, x[14], 23, -35309556);
      a = hh(a, b, c, d, x[1], 4, -1530992060); d = hh(d, a, b, c, x[4], 11, 1272893353); c = hh(c, d, a, b, x[7], 16, -155497632); b = hh(b, c, d, a, x[10], 23, -1094730640);
      a = hh(a, b, c, d, x[13], 4, 681279174); d = hh(d, a, b, c, x[0], 11, -358537222); c = hh(c, d, a, b, x[3], 16, -722521979); b = hh(b, c, d, a, x[6], 23, 76029189);
      a = hh(a, b, c, d, x[9], 4, -640364487); d = hh(d, a, b, c, x[12], 11, -421815835); c = hh(c, d, a, b, x[15], 16, 530742520); b = hh(b, c, d, a, x[2], 23, -995338651);
      a = ii(a, b, c, d, x[0], 6, -198630844); d = ii(d, a, b, c, x[7], 10, 1126891415); c = ii(c, d, a, b, x[14], 15, -1416354905); b = ii(b, c, d, a, x[5], 21, -57434055);
      a = ii(a, b, c, d, x[12], 6, 1700485571); d = ii(d, a, b, c, x[3], 10, -1894986606); c = ii(c, d, a, b, x[10], 15, -1051523); b = ii(b, c, d, a, x[1], 21, -2054922799);
      a = ii(a, b, c, d, x[8], 6, 1873313359); d = ii(d, a, b, c, x[15], 10, -30611744); c = ii(c, d, a, b, x[6], 15, -1560198380); b = ii(b, c, d, a, x[13], 21, 1309151649);
      a = ii(a, b, c, d, x[4], 6, -145523070); d = ii(d, a, b, c, x[11], 10, -1120210379); c = ii(c, d, a, b, x[2], 15, 718787259); b = ii(b, c, d, a, x[9], 21, -343485551);
      a = add(a, oa); b = add(b, ob); c = add(c, oc); d = add(d, od);
    }
    var out = [];
    [a, b, c, d].forEach(function (w) { for (var j = 0; j < 4; j++) out.push((w >> (j * 8)) & 0xFF); });
    return out;
  }
  function ascii(s) { var r = []; for (var i = 0; i < s.length; i++) r.push(s.charCodeAt(i) & 0xFF); return r; }
  function hmacMd5Hex(key, message) {
    var k = ascii(key), i;
    if (k.length > 64) k = md5(k);
    while (k.length < 64) k.push(0);
    var inner = [], outer = [];
    for (i = 0; i < 64; i++) { inner.push(k[i] ^ 0x36); outer.push(k[i] ^ 0x5C); }
    return md5(outer.concat(md5(inner.concat(ascii(message))))).map(function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');
  }

  // --- 登录 ---
  // 用蜻蜓手机版的登录页。登录后网站把身份信息写在 Cookie 里（.qtfm.cn 整个域名下都能读到）：
  // qingting_id 是用户编号，access_token 是访问令牌，refresh_token 用来换新令牌。
  // Cookie 只留三天，所以读到以后记到源的设置里；令牌失效了用 refresh_token 换新的。
  var LOGIN = 'https://sss.qtfm.cn/account/mobile/login.html?wx=0&qq=0&wb=0&redirect_uri=' + encodeURIComponent('https://m.qtfm.cn/');

  function cookieValues(host) {
    var o = {};
    String(host.cookies('https://m.qtfm.cn/') || '').split(';').forEach(function (p) {
      var i = p.indexOf('=');
      if (i > 0) { try { o[p.substring(0, i).trim()] = decodeURIComponent(p.substring(i + 1).trim()); } catch (e) { o[p.substring(0, i).trim()] = p.substring(i + 1).trim(); } }
    });
    return o;
  }

  function saved(host) {
    return { uat: host.getPref('uat', ''), refresh: host.getPref('refresh', ''), access: host.getPref('access', ''), seen: host.getPref('seen', '') };
  }
  function save(host, s) {
    host.setPref('uat', s.uat || null); host.setPref('refresh', s.refresh || null);
    host.setPref('access', s.access || null); host.setPref('seen', s.seen || null);
  }

  // 现在的登录信息；没登录返回 null。Cookie 里的令牌和上次见到的不一样，说明刚（重新）登录过，以 Cookie 为准
  function login(host) {
    var s = saved(host), c = cookieValues(host);
    if (c.qingting_id && c.access_token && c.access_token !== s.seen) {
      s = { uat: c.qingting_id, access: c.access_token, refresh: c.refresh_token || '', seen: c.access_token };
      save(host, s);
    }
    return s.uat && (s.access || s.refresh) ? s : null;
  }

  // 用 refresh_token 换一个新的访问令牌；换不了返回 false
  function renew(host, s) {
    if (!s.refresh) return false;
    try {
      var r = host.fetch('https://user.qtfm.cn/u2/api/v4/auth', {
        desktop: true, method: 'POST', contentType: 'application/json',
        body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: s.refresh, qingting_id: s.uat, device_id: 'web' })
      });
      var json = parseJson(r.body), data = at(json, 'data');
      if (!data || !str(data, 'access_token')) {
        // 服务器明确说换不了（refresh_token 不存在或已作废）：登录已经失效，把记着的登录信息清掉，免得每次播放都白试一次
        if (int(json, 'errorno') !== 0) save(host, {});
        return false;
      }
      s.access = str(data, 'access_token');
      if (str(data, 'refresh_token')) s.refresh = str(data, 'refresh_token');
      save(host, s);
      return true;
    } catch (e) { if (e.cancelled) throw e; return false; }
  }

  function api(host, url) {
    var json = host.getJson(url, { desktop: true, headers: { Referer: SITE + '/' } });
    var code = str(json, 'errorno') || str(json, 'errcode');
    if (code && code !== '0') throw new Error('蜻蜓FM 接口返回错误：' + (str(json, 'errormsg') || str(json, 'errmsg')) + '（' + code + '）');
    return json;
  }

  function https(u) { return u.replace(/^http:\/\//, 'https://'); }
  function channelId(url) {
    var m = /channels\/(\d+)/.exec(url);
    if (!m) throw new Error('不认识的地址：' + url);
    return m[1];
  }

  function toBook(c) {
    var play = str(c, 'playcount');
    return {
      coverUrl: https(str(c, 'cover')), bookUrl: SITE + '/channels/' + str(c, 'id') + '/', title: str(c, 'title').trim(),
      artist: str(c, 'podcaster'), intro: str(c, 'description'), status: play ? '播放 ' + play : ''
    };
  }

  // paid：这张专辑是不是收费的。免费专辑的节目全都能听，接口里也不带 isfree 这个字段；
  // 收费专辑里只有试听的那几集带 isfree=true，其余的要购买或开会员
  function toEpisodes(cid, json, paid) {
    return items(json, 'data.programs').map(function (p) {
      return { title: str(p, 'title').trim(), url: SITE + '/channels/' + cid + '/programs/' + str(p, 'id') + '/', isFree: !paid || p.isfree === true };
    });
  }

  registerSource({
    id: 'b7e3a9c15d0f4b62a8c4e17f3d9b0a68', name: '蜻蜓FM', url: SITE + '/',
    description: '小说、评书、相声、广播剧、历史人文都有。免费专辑可以直接听；收费专辑只有前面试听的几集能听，其余带锁的要在蜻蜓购买或开会员——在插件页面点“登录”，用自己的蜻蜓账号（手机号）登录后就能听已购买的内容。章节很多的书加载要一点时间。',
    multipleEpisodePages: true,
    loginUrl: LOGIN,
    loginDesktop: false,

    // 登录页关掉后宿主会来问：登录了返回昵称，没登录抛出错误
    checkLogin: function () {
      var s = login(this.host);
      if (!s) throw new Error('还没有登录蜻蜓FM');
      try { return str(api(this.host, 'https://user.qtfm.cn/u2/api/v4/user/' + s.uat), 'data.nick_name'); } catch (e) { if (e.cancelled) throw e; return ''; }
    },

    search: function (keywords, page) {
      var json = api(this.host, 'https://search.qtfm.cn/v3/search?categoryid=0&k=' + Shun.enc(keywords) + '&page=' + page + '&pagesize=20&include=channel_ondemand');
      var found = int(json, 'data.data.numFound');
      return { books: items(json, 'data.data.docs').map(toBook), totalPage: Math.max(1, Math.min(50, Math.ceil(found / 20))) };
    },

    categoryMenus: function () {
      function tabs(list) { return list.map(function (c) { return { title: c[0], url: 'qtfm:' + c[1] + ':' + (c[2] || 0) + '#1' }; }); }
      return [
        { title: '听书', tabs: tabs([['小说', 521], ['男生爱听', 521, 3289], ['女生爱听', 521, 3290], ['多人有声剧', 521, 5544], ['评书', 3496], ['相声小品', 527],
          ['广播剧', 3442], ['出版精品', 3636], ['儿童', 1599], ['戏曲', 3276], ['二次元', 3427]]) },
        { title: '知识', tabs: tabs([['历史', 531], ['文化', 3613], ['情感', 529], ['脱口秀', 3251], ['播客', 3873], ['头条', 545], ['财经', 533], ['科技', 535],
          ['教育', 537], ['外语', 543], ['音乐', 523], ['娱乐', 547], ['生活', 3670], ['汽车', 3385], ['校园', 1737], ['母婴', 3675]]) }
      ];
    },

    // 分类地址：qtfm:分类:筛选项#页码，一页 12 本
    categoryPage: function (url) {
      var m = /^qtfm:(\d+):(\d+)#(\d+)$/.exec(url);
      if (!m) throw new Error('不认识的分类地址：' + url);
      var page = parseInt(m[3], 10);
      var json = api(this.host, CAPI + 'neo-channel-filter?category=' + m[1] + '&attrs=' + m[2] + '&curpage=' + page);
      var books = items(json, 'data.channels').map(toBook);
      var total = books.length === 0 ? page : Math.max(page, Math.ceil(int(json, 'total') / 12));
      return { books: books, currentPage: page, totalPage: total, nextUrl: page < total ? 'qtfm:' + m[1] + ':' + m[2] + '#' + (page + 1) : null };
    },

    bookDetail: function (bookUrl, loadEpisodes, loadFullPages) {
      var host = this.host, cid = channelId(bookUrl);
      var c = at(api(host, CAPI + 'v3/channel/' + cid), 'data') || {};
      var count = int(c, 'program_count');
      var detail = {
        title: str(c, 'title').trim(), coverUrl: https(str(c, 'cover')), intro: str(c, 'description'),
        artist: items(c, 'podcasters').map(function (p) { return str(p, 'nick_name'); }).filter(function (n) { return n; }).join('、'),
        status: (str(c, 'finished') === '1' ? '已完结' : '连载中') + (count > 0 ? ' · ' + count + ' 集' : ''), episodes: []
      };
      if (!loadEpisodes) return detail;
      // 节目列表的地址里要带专辑的“版本号”
      var base = CAPI + 'channel/' + cid + '/programs/' + str(c, 'v') + '?pagesize=' + PAGE + '&order=asc&curpage=';
      // 专辑信息里 purchase.item_type 不是 0 的才是收费专辑
      var paid = int(c, 'purchase.item_type') !== 0;
      var first = api(host, base + 1);
      detail.episodes = toEpisodes(cid, first, paid);
      var pages = Math.ceil(int(first, 'data.total') / PAGE);
      if (loadFullPages && pages > 1) {
        var urls = [];
        for (var p = 2; p <= pages; p++) urls.push(base + p);
        var done = 0;
        // 一批 6 页同时取，每取完一批报一次进度
        for (var i = 0; i < urls.length; i += 6) {
          var batch = urls.slice(i, i + 6);
          host.getStrings(batch, { desktop: true, headers: { Referer: SITE + '/' } }, 6).forEach(function (text, k) {
            if (text === null) throw new Error('第 ' + (i + k + 2) + ' 页章节加载失败，请重试');
            detail.episodes = detail.episodes.concat(toEpisodes(cid, parseJson(text), paid));
          });
          done += batch.length;
          host.progress((done + 1) + ' / ' + pages);
        }
        host.progress(null);
      }
      return detail;
    },

    // 音频地址：路径 + 登录信息 + 时间，用固定的密钥做 HMAC-MD5 签名（和电脑版网页一样）；访问后会跳转到真正的文件。
    // 没登录时登录信息留空，只能取到免费的和试听的
    audio: function (url) {
      var host = this.host, m = /channels\/(\d+)\/programs\/(\d+)/.exec(url);
      if (!m) throw new Error('不认识的章节地址：' + url);
      function signed(s) {
        var path = '/audiostream/redirect/' + m[1] + '/' + m[2] + '?access_token=' + (s ? encodeURIComponent(s.access) : '') +
          '&device_id=MOBILESITE&qingting_id=' + (s ? encodeURIComponent(s.uat) : '') + '&t=' + new Date().getTime();
        return 'https://audio.qtfm.cn' + path + '&sign=' + hmacMd5Hex('7l8CZ)SgZgM_bkrw', path);
      }
      var s = login(host);
      if (!s) return signed(null);
      // 带着登录信息时，令牌要是已经失效，连免费的节目服务器也会拒绝（401）。所以先问一下：
      // 被拒绝就换一个新令牌再试；还不行就把令牌作废，这一次按没登录的方式取
      function rejected(link) {
        try { return host.status(link, { desktop: true, headers: { Range: 'bytes=0-1' } }) === 401; } catch (e) { if (e.cancelled) throw e; return false; }
      }
      var link = s.access ? signed(s) : '';
      if (link && !rejected(link)) return link;
      if (renew(host, s)) {
        link = signed(s);
        if (!rejected(link)) return link;
      }
      host.setPref('access', null);
      return signed(null);
    }
  });
})();

// ---------- 书音FM（m.mekui.com）：网站自己的 JSON 接口 ----------
(function () {
  var SITE = 'https://m.mekui.com';
  var API = SITE + '/ecmsapi/index.php?';
  var KEY = '056a308c515e16b2fe5a5c631319339cbc60a8ee0e03d016'; // 取播放地址时签名用的固定密钥（网页脚本里写着）
  var CHAPTERS = 500; // 章节列表一页取多少
  var menus = null;

  function options() { return { headers: { Referer: SITE + '/', Accept: 'application/json, text/plain, */*' } }; }

  function call(host, query) {
    var json = host.getJson(API + query, options());
    if (int(json, 'code') !== 1) throw new Error('书音FM：' + (str(json, 'message') || str(json, 'msg') || '接口返回错误'));
    return json;
  }

  function toBook(b) {
    return {
      coverUrl: str(b, 'titlepic'), bookUrl: SITE + '/album-' + str(b, 'classid') + '-' + str(b, 'id') + '.html', title: str(b, 'title').trim(),
      artist: str(b, 'player'), intro: str(b, 'moviesay'), status: str(b, 'filetype')
    };
  }

  function ids(url) {
    var m = /(?:album|audio)[-\/](\d+)-(\d+)(?:-(\d+))?\.html/.exec(url);
    if (!m) throw new Error('不认识的地址：' + url);
    return { classId: m[1], id: m[2], no: m[3] };
  }

  function toEpisodes(k, json) {
    return items(json, 'data.moielist').map(function (e) {
      // control / level / ofen 不为 0 的是要登录、会员或积分才能听的
      var free = str(e, 'control') === '0' && str(e, 'level') === '0' && str(e, 'ofen') === '0';
      return { title: str(e, 'title').trim() || ('第 ' + str(e, 'id') + ' 集'), url: SITE + '/audio/' + k.classId + '-' + k.id + '-' + str(e, 'id') + '.html', isFree: free };
    });
  }

  var SORTS = { '热播': 'onclick+desc', '最新': 'newstime+desc', '热评': 'plnum+desc' };

  registerSource({
    id: 'e8c2a5d47f1b4936b0d7a3c9e6f41b05', name: '书音FM', url: SITE + '/',
    description: '有声小说、广播剧、评书、百家讲坛、相声小品、戏曲、儿童等，内容很全，分类细。直接用网站的接口，不需要登录。',
    multipleEpisodePages: true,
    config: [{ type: 'select', key: 'sort', label: '分类里的排序', default: '热播', options: ['热播', '最新', '热评'] }],

    search: function (keywords, page) {
      var json = call(this.host, 'act=search&mod=movie&keyword=' + Shun.enc(keywords) + '&page=' + page + '&pagesize=20');
      return { books: items(json, 'data.list').map(toBook), totalPage: Math.max(page, int(json, 'data.totalpage', page)) };
    },

    // 大类各是一组，里面是“全部”和它的小类。大类和小类都问接口要，一次把各大类的小类一起取回来
    categoryMenus: function () {
      if (menus) return menus;
      var host = this.host;
      var top = items(call(host, 'classid=0&act=navigation&mod=column'), 'list');
      var texts = host.getStrings(top.map(function (c) { return API + 'classid=' + str(c, 'classid') + '&act=navigation&mod=column'; }), options(), 6);
      var result = top.map(function (c, i) {
        var tabs = [{ title: '全部', url: 'mekui:' + str(c, 'classid') + '#1' }];
        try {
          if (texts[i]) items(parseJson(texts[i]), 'list').forEach(function (s) { tabs.push({ title: str(s, 'classname'), url: 'mekui:' + str(s, 'classid') + '#1' }); });
        } catch (e) { }
        return { title: str(c, 'classname'), tabs: tabs };
      });
      // 小类都取到了才记住；有没取到的下次再取一遍
      if (texts.every(function (t) { return t !== null; })) menus = result;
      return result;
    },

    categoryPage: function (url) {
      var m = /^mekui:(\d+)#(\d+)$/.exec(url);
      if (!m) throw new Error('不认识的分类地址：' + url);
      var page = parseInt(m[2], 10);
      var sort = SORTS[this.host.getPref('sort', '热播')] || SORTS['热播'];
      var json = call(this.host, 'act=list&mod=movie&classid=' + m[1] + '&page=' + page + '&pagesize=20&sort=' + sort);
      var books = items(json, 'data.list').map(toBook);
      var total = books.length === 0 ? page : Math.max(page, int(json, 'data.totalpage', page));
      return { books: books, currentPage: page, totalPage: total, nextUrl: page < total ? 'mekui:' + m[1] + '#' + (page + 1) : null };
    },

    bookDetail: function (bookUrl, loadEpisodes, loadFullPages) {
      var host = this.host, k = ids(bookUrl);
      var d = at(call(host, 'mod=movie&act=detail&id=' + k.id), 'data.detail') || {};
      var detail = {
        title: str(d, 'title').trim(), coverUrl: str(d, 'titlepic'), intro: str(d, 'moviesay'), artist: str(d, 'player') || str(d, 'playadmin'),
        status: [str(d, 'filetype'), str(d, 'firstclassname')].filter(function (x) { return x; }).join(' · '), episodes: []
      };
      if (!loadEpisodes) return detail;
      var base = API + 'mod=movie&act=movielist&id=' + k.id + '&pagesize=' + CHAPTERS + '&page=';
      var first = host.getJson(base + 1, options());
      detail.episodes = toEpisodes(k, first);
      var pages = int(first, 'data.totalpage', 1);
      if (loadFullPages && pages > 1) {
        var urls = [];
        for (var p = 2; p <= pages; p++) urls.push(base + p);
        host.getStrings(urls, options(), 4).forEach(function (text, i) {
          if (text === null) throw new Error('第 ' + (i + 2) + ' 页章节加载失败，请重试');
          detail.episodes = detail.episodes.concat(toEpisodes(k, parseJson(text)));
        });
      }
      return detail;
    },

    // 播放地址：参数按名字排好序拼起来，末尾加上密钥，取 MD5 当校验值（网页就是这么算的）
    audio: function (url) {
      var k = ids(url);
      if (!k.no) throw new Error('不认识的章节地址：' + url);
      var t = Math.floor(new Date().getTime() / 1000);
      var token = this.host.md5('act=wapseries&id=' + k.id + '&mod=movie&movieId=' + k.no + '&t=' + t + '&token=' + KEY);
      var json = this.host.getJson(API + 'act=wapseries&mod=movie&id=' + k.id + '&movieId=' + k.no + '&t=' + t + '&token=' + token, options());
      if (int(json, 'code') !== 1 || !json.data) throw new Error(str(json, 'message') || str(json, 'msg') || '没有拿到播放地址（可能需要在网站上登录或开通会员）');
      var audio = str(json, 'data.SeriesUrl');
      // 主地址没有时用备用线路里第一个不为空的
      if (!audio) items(json, 'data.signed_urls').forEach(function (u) { if (!audio && typeof u === 'string' && u) audio = u; });
      if (!audio) throw new Error('这一集网站没有给出播放地址（可能需要在网站上登录或开通会员）');
      return { url: audio, headers: { Referer: SITE + '/' } };
    }
  });
})();

// ---------- 央视听音（tv.cctv.com/ty）：央视网的“听节目”频道，用央视网自己的接口 ----------
// 每张专辑是一本书，里面的节目是章节。没有单独的音频文件，播的是节目视频的最低码率那一路（只出声音）。
(function () {
  var SITE = 'https://tv.cctv.com';
  var LIST = 'https://api.cntv.cn/newVideoset/getVideoAlbumListByPageIdTvty?serviceId=tvty&n=20';
  var menus = null;

  function options() { return { headers: { Referer: SITE + '/ty/m/index.shtml' } }; }

  function albumId(url) {
    var m = /(VIDA[0-9A-Za-z]+)/.exec(url);
    if (!m) throw new Error('不认识的地址：' + url);
    return m[1];
  }

  function toBook(a) {
    return {
      coverUrl: str(a, 'image') || str(a, 'image2'), bookUrl: str(a, 'url') || (SITE + '/' + str(a, 'id') + '.shtml'), title: str(a, 'title').trim(),
      intro: str(a, 'brief'), status: str(a, 'sc').split(',').filter(function (x) { return x; }).slice(0, 3).join(' · ')
    };
  }

  registerSource({
    id: 'f5b0d8e27a3c4169b4e2c70d9a61f8b3', name: '央视听音', url: SITE + '/ty/m/index.shtml',
    description: '央视网的“听音”频道：百家讲坛等名家讲座、评书、戏曲、历史人文、儿童、健康等，都是央视的节目。' +
      '播放的是节目视频的声音，比普通音频费流量；不能下载到本地。',

    // 搜出来的是一期期节目，按它所在的专辑归并成书
    search: function (keywords, page) {
      var json = this.host.getJson('https://search.cctv.com/m/if3g_search.php?page=' + page + '&qtext=' + Shun.enc(keywords) +
        '&type=audio&sort=SCORE&pageSize=20&channel=', { headers: { Referer: 'https://search.cctv.com/m/search.php?type=audio' } });
      var host = this.host, seen = {}, books = [];
      items(json, 'list').forEach(function (v) {
        var id = str(v, 'ALBUMID');
        if (!id || seen[id]) return;
        seen[id] = true;
        var plain = function (s) { return host.htmlDecode(String(s).replace(/<[^>]+>/g, '')).trim(); };
        books.push({
          coverUrl: str(v, 'IMAGELINK'), bookUrl: str(v, 'PAGELINK').split('?')[0].replace('//tv.cctv.cn/', '//tv.cctv.com/'),
          title: plain(str(v, 'DRETITLE')), intro: plain(str(v, 'DRECONTENT')), status: str(v, 'CHANNEL')
        });
      });
      return { books: books, totalPage: Math.max(page, Math.min(50, Math.ceil(int(json, 'total') / 20))) };
    },

    // 分类来自网站“全部”页的标签：一级分类各是一组，里面是“全部”和它的二级标签
    categoryMenus: function () {
      if (menus) return menus;
      var result = [{ title: '推荐', tabs: [{ title: '全部', url: 'cctv:#1' }] }];
      var groups = {}, order = [];
      items(this.host.getJson(SITE + '/ty/m/sxy/data.jsonp', options()), 'data.list').forEach(function (t) {
        var fc = str(t, 'fc'), sc = str(t, 'sc');
        if (!fc || !sc) return;
        if (!groups[fc]) { groups[fc] = [{ title: '全部', url: 'cctv:fc=' + Shun.enc(fc) + '#1' }]; order.push(fc); }
        groups[fc].push({ title: sc, url: 'cctv:fc=' + Shun.enc(fc) + '&sc=' + Shun.enc(sc) + '#1' });
      });
      order.forEach(function (fc) { result.push({ title: fc, tabs: groups[fc] }); });
      if (order.length > 0) menus = result;
      return result;
    },

    categoryPage: function (url) {
      var m = /^cctv:([^#]*)#(\d+)$/.exec(url);
      if (!m) throw new Error('不认识的分类地址：' + url);
      var page = parseInt(m[2], 10);
      var json = this.host.getJson(LIST + '&p=' + page + (m[1] ? '&' + m[1] : ''), options());
      var books = items(json, 'data.list').map(toBook);
      var total = books.length === 0 ? page : Math.max(page, Math.ceil(int(json, 'data.total') / 20));
      return { books: books, currentPage: page, totalPage: total, nextUrl: page < total ? 'cctv:' + m[1] + '#' + (page + 1) : null };
    },

    bookDetail: function (bookUrl, loadEpisodes) {
      var host = this.host, id = albumId(bookUrl), detail = { episodes: [] };
      try {
        var a = at(host.getJson('https://api.cntv.cn/NewVideoset/getVideoAlbumInfo?id=' + id + '&serviceId=tvcctv', options()), 'data') || {};
        detail.title = str(a, 'title').trim(); detail.intro = str(a, 'brief'); detail.coverUrl = str(a, 'image');
      } catch (e) { if (e.cancelled) throw e; }
      if (!loadEpisodes) return detail;
      // 专辑里的节目分两种存法（mode 0 和 1），事先不知道是哪种：先按 0 取，一期都没有再按 1 取。一页最多 100 期，按播出顺序
      for (var mode = 0; mode <= 1 && detail.episodes.length === 0; mode++) {
        var base = 'https://api.cntv.cn/NewVideo/getVideoListByAlbumIdNew?id=' + id + '&serviceId=tvcctv&mode=' + mode + '&pub=1&n=100&sort=asc&p=';
        for (var p = 1; p <= 50; p++) {
          var json = host.getJson(base + p, options());
          var list = items(json, 'data.list');
          list.forEach(function (v) {
            var guid = str(v, 'guid');
            if (guid) detail.episodes.push({ title: str(v, 'title').trim(), url: bookUrl.split('?')[0] + '?guid=' + guid });
          });
          if (list.length < 100 || detail.episodes.length >= int(json, 'data.total')) break;
        }
      }
      detail.status = detail.episodes.length > 0 ? detail.episodes.length + ' 期' : '';
      return detail;
    },

    // 用节目的编号问央视网要播放地址（HLS）。用手机的身份去问，给的是码率最低的那一路
    audio: function (url) {
      var m = /[?&]guid=([0-9a-fA-F]+)/.exec(url);
      if (!m) throw new Error('不认识的章节地址：' + url);
      var json = this.host.getJson('https://vdn.apps.cntv.cn/api/getHttpVideoInfo.do?pid=' + m[1], { headers: { Referer: SITE + '/' } });
      var hls = str(json, 'hls_url');
      if (!hls) throw new Error('央视网没有给出这期节目的播放地址' + (str(json, 'tip_msg') ? '：' + str(json, 'tip_msg') : '（可能有版权限制）'));
      return { url: hls, headers: { Referer: SITE + '/', 'X-Media-Type': 'hls' } };
    }
  });
})();
