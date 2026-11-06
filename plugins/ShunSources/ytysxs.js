// 悦听有声书：WordPress + AudioIgniter 公开音频列表。兼容 Rhino / JavaScriptCore。
(function () {
  var SITE = 'https://www.ytysxs.com/';
  function options(host) {
    var headers = { Referer: SITE }, ua = typeof host.webViewUA === 'function' ? host.webViewUA() : '';
    if (ua) headers['User-Agent'] = ua;
    return { desktop: false, headers: headers };
  }
  function doc(host, url) { return host.parseHtml(host.getString(url, options(host)), url); }
  function http(url) {
    url = String(url || '').trim();
    if (url.indexOf('//') === 0) url = 'https:' + url;
    return /^https?:\/\//i.test(url) ? url : '';
  }
  function info(text) {
    var segments = String(text || '').split('|'), m = /《([^》]+)》/.exec(segments[0]), author = '', artist = '';
    for (var i = 1; i < segments.length; i++) {
      var part = segments[i].trim();
      if (/著$/.test(part)) author = part.replace(/著$/, '');
      if (/播$/.test(part)) artist = part.replace(/播$/, '');
    }
    return { title: m ? m[1] : segments[0].replace(/有[聲声](?:書|书)?(?:小說|小说)?/g, '').trim(), author: author, artist: artist };
  }
  function cover(element) {
    var img = element.first('img'), a = element.first('.thumbnail a, .picture-img a'), style = a.attr('style') || '';
    var background = /url\(["']?([^\)"']+)/i.exec(style);
    return http(img.absUrl('data-src') || img.absUrl('data-original') || img.absUrl('src') || a.absUrl('data-src') || (background ? background[1] : ''));
  }
  function books(document) {
    var list = [], seen = {};
    document.select('#main article').forEach(function (item) {
      var a = item.first('.entry-title a, .post-title a, .grid-title a'), url = a.absUrl('href');
      if (!/^https?:\/\/(?:www\.)?ytysxs\.com\/\d+\.html(?:[?#].*)?$/.test(url) || seen[url]) return;
      seen[url] = true;
      var book = info(a.text()); book.bookUrl = url; book.coverUrl = cover(item);
      book.intro = item.first('.archive-content').text(); list.push(book);
    });
    return list;
  }
  function pageNumber(url) { return Number((/\/page\/(\d+)\//.exec(url) || /[?&]paged=(\d+)/.exec(url) || [0, 1])[1]); }
  function pagination(document, page) {
    var total = page;
    document.select('.nav-links .page-numbers').forEach(function (a) {
      var n = /^\d+$/.test(a.text().trim()) ? Number(a.text().trim()) : pageNumber(a.absUrl('href'));
      if (n > total) total = n;
    });
    return { totalPage: total, nextUrl: document.first('.nav-links a.next').absUrl('href') || null };
  }
  registerSource({
    id: '83a7db674cf84d38b4a75806a4eb86d2', name: '悦听有声书', url: SITE, group: '听书',
    description: '分类浏览和原站音频目录。部分音频文件合并多集，按原站分段展示。',
    multipleEpisodePages: true,
    categoryMenus: function () {
      return [{ title: '分类', tabs: [
        ['首页推荐', ''], ['仙侠', 'xianxia/'], ['玄幻', 'xuanhuan/'], ['历史', 'lishi/'],
        ['言情', 'yanqing/'], ['都市', 'dushi/'], ['灵异', 'kbly/'], ['科幻', 'kehuan/'], ['完结', 'tag/wanjie/']
      ].map(function (item) { return { title: item[0], url: SITE + item[1] }; }) }];
    },
    categoryPage: function (url) {
      var document = doc(this.host, url), page = pageNumber(url), pages = url === SITE ? { totalPage: 1, nextUrl: null } : pagination(document, page);
      return { books: books(document), currentPage: page, totalPage: pages.totalPage, nextUrl: pages.nextUrl };
    },
    bookDetail: function (url, loadEpisodes, loadFullPages) {
      var host = this.host, document = doc(host, url), result = info(document.first('h1.entry-title').text());
      var content = document.first('.single-content');
      result.coverUrl = http(content.first('.wp-caption img, img').absUrl('src'));
      result.intro = content.first('.abstract fieldset').text().replace(/^摘要\s*/, '') || content.first('p').text();
      content.select('p').forEach(function (p) {
        var text = p.text(), m;
        if ((m = /^作者[：:]\s*([^，,。；;]+)/.exec(text))) result.author = m[1];
        if ((m = /^主播[：:]\s*(.+)/.exec(text))) result.artist = m[1];
      });
      var finished = document.first('.tag-links').text() + content.select('h6').map(function (e) { return e.text(); }).join(' ');
      result.status = /完[結结]/.test(finished) ? '完本' : '';
      result.episodes = [];
      if (!loadEpisodes) return result;
      var playlists = [], seenLists = {}, seenAudio = {};
      content.select('[data-tracks-url]').forEach(function (e) {
        var link = e.absUrl('data-tracks-url');
        if (!/^https?:\/\/(?:www\.)?ytysxs\.com\/\?audioigniter_playlist_id=\d+$/.test(link) || seenLists[link]) return;
        seenLists[link] = true; playlists.push(link);
      });
      try {
        for (var i = 0; i < playlists.length; i++) {
          if (i > 0 && !loadFullPages) break;
          host.progress((i + 1) + ' / ' + playlists.length);
          var tracks = JSON.parse(host.getString(playlists[i], options(host)));
          if (!Array.isArray(tracks)) throw new Error('原站音频列表格式发生变化');
          tracks.forEach(function (track) {
            var audio = http(track.audio);
            if (!audio || seenAudio[audio]) return;
            seenAudio[audio] = true;
            result.episodes.push({ title: track.title || ('第 ' + (result.episodes.length + 1) + ' 段'), url: audio });
            if (!result.artist && track.subtitle) result.artist = track.subtitle;
            if (!result.coverUrl) result.coverUrl = http(track.cover || track.cover_link);
          });
        }
      } finally { host.progress(null); }
      if (!result.episodes.length) throw new Error('原站暂未提供可播放的音频目录');
      return result;
    },
    audio: function (url) {
      if (!http(url)) throw new Error('音频地址无效，请刷新目录');
      return { url: url, headers: { Referer: SITE } };
    },
    audioHeaders: function () { return { Referer: SITE }; },
    coverHeaders: function (url) { return /^https?:\/\/(?:www\.ytysxs\.com|mp3\.ytysxs\.top)\//.test(url) ? { Referer: SITE } : null; }
  });
})();
