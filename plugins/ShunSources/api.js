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
