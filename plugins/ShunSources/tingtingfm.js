// 听听FM公开网页：北京电台直播、节目单回听和广播节目历史回听。
// 接口、签名及字段来自 mobile.tingtingfm.com 的公开 H5 页面，不依赖 App 登录接口。
(function () {
  var SITE = 'https://mobile.tingtingfm.com';
  var API = 'https://api-v3.tingtingfm.com';
  var VERSION = 'h5_6.6.3.4';
  var SIGN_KEY = [66,87,133,123,135,65,115,119,129,103,126,130,115,86,68,73]
    .map(function (v) { return String.fromCharCode(v - 17); }).join('');
  var client = '';
  var searchPages = {};
  var searchWord = null;
  var DAY = 24 * 3600 * 1000;

  function enc(v) {
    return encodeURIComponent(String(v)).replace(/[!'()*]/g, function (c) { return '%' + c.charCodeAt(0).toString(16).toUpperCase(); });
  }
  function call(host, path, params, method) {
    if (!client) client = 'h5_' + host.uuid().replace(/-/g, '');
    var data = { version: VERSION, client: client };
    Object.keys(params || {}).forEach(function (k) { data[k] = params[k]; });
    var pairs = Object.keys(data).map(function (k) { return k + '=' + enc(data[k]); });
    var sign = host.md5(pairs.slice().sort().join('&') + '_' + SIGN_KEY).toLowerCase();
    var json = host.getJson(API + path + '?' + pairs.join('&') + '&api_sign=' + sign,
      { method: method || 'POST', headers: { Referer: SITE + '/', Origin: SITE } });
    if (!json || json.errno === undefined) throw new Error('听听FM返回了无法识别的数据');
    if (Number(json.errno) !== 0) throw new Error('听听FM：' + (str(json, 'error') || '接口错误 ' + json.errno));
    return json.data;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  // 北京电台的节目时间始终按北京时间解释，不跟随设备所在时区。
  function chinaDay(ms) {
    var d = new Date(ms + 8 * 3600 * 1000);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function titleDay(title) {
    var m = /^(\d{4})[-年/]?(\d{2})[-月/]?(\d{2})/.exec(title);
    return m ? m[1] + '-' + m[2] + '-' + m[3] : '';
  }
  function timestamp(day, time) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day), t = /^(\d{1,2}):(\d{2})/.exec(time || '00:00');
    if (!m || !t) return 0;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t[1]) - 8, Number(t[2]));
  }
  function parseBook(url) {
    var m = /^ttfm:(radio|program):([A-Za-z0-9]+)$/.exec(url);
    if (!m) throw new Error('不认识的听听FM书籍地址');
    return { type: m[1], id: m[2] };
  }
  function radioInfo(host, id) { return call(host, '/broadcast/get_radio_programs', { h_radio_id: id }); }
  function radioBook(r) {
    return { bookUrl: 'ttfm:radio:' + (str(r, 'content') || str(r, 'h_radio_id')), title: str(r, 'radio_name') || str(r, 'name'),
      coverUrl: str(r, 'file_url') || str(r, 'list_cover') || str(r, 'cover'), artist: str(r, 'fm'),
      status: str(r, 'program_name') || '直播 / 回听' };
  }
  function searchBook(row) {
    var d = row.data || {}, id = str(d, 'id'), type = Number(row.type);
    if (!id || (type !== 3 && type !== 4)) return null;
    return { bookUrl: 'ttfm:' + (type === 3 ? 'radio' : 'program') + ':' + id,
      title: str(d, 'title'), coverUrl: str(d, 'cover'), artist: str(d, 'sub_title'), status: type === 3 ? '直播 / 回听' : '节目回听' };
  }
  function replayEpisode(p, day, time) {
    var id = str(p, 'h_audio_id');
    if (!id || id === '0') return null;
    var title = str(p, 'audio_name') || str(p, 'title');
    day = titleDay(title) || day;
    return { title: day + (time ? ' ' + time : '') + ' ' + title.replace(/^\d{8}期[：:]?\s*/, ''),
      url: 'ttfm:audio:' + id, broadcastDate: day, startTime: timestamp(day, time), isFree: true };
  }
  function radioDetail(host, id, loadEpisodes) {
    var data = radioInfo(host, id), info = data.info || {};
    if (!str(info, 'h_radio_id')) throw new Error('听听FM没有返回这个电台的信息');
    var episodes = [], seen = {};
    if (loadEpisodes !== false) {
      episodes.push({ title: '直播', url: 'ttfm:live:' + id, live: true });
      // 网页电台页只提供今天、昨天和明天；只列已有回听音频的已播节目，不把预告当成回听。
      ['today', 'yesterday'].forEach(function (bucket) {
        var day = chinaDay(Date.now() - (bucket === 'yesterday' ? DAY : 0));
        items(data, 'list.' + bucket).forEach(function (p) {
          var episode = replayEpisode(p, day, str(p, 's_time'));
          var end = timestamp(episode ? episode.broadcastDate : day, str(p, 'e_time'));
          if (end > 0 && end <= (episode ? episode.startTime : 0)) end += DAY;
          if (!episode || seen[episode.url] || (end > Date.now())) return;
          seen[episode.url] = true; episodes.push(episode);
        });
      });
      var live = episodes.shift();
      episodes.sort(function (a, b) { return a.broadcastDate === b.broadcastDate ? a.startTime - b.startTime : (a.broadcastDate < b.broadcastDate ? 1 : -1); });
      episodes.unshift(live);
    }
    return { title: str(info, 'name'), artist: str(info, 'fm'), coverUrl: str(info, 'list_cover') || str(info, 'cover'),
      intro: '电台直播与网页节目单回听；更多历史节目可到“广播节目”或搜索节目名称。', episodes: episodes };
  }
  function programDetail(host, id, loadEpisodes, loadFullPages) {
    var info = call(host, '/broadcast/get_program_v3_8', { h_program_id: id }).info || {};
    if (!str(info, 'h_program_id')) throw new Error('听听FM没有返回这个节目的信息');
    var episodes = [], seen = {}, cursors = {}, apt = '', cutoff = '';
    var days = String(host.getPref('replayDays', '30') || '30');
    if (['7', '30', '90', '全部'].indexOf(days) < 0) days = '30';
    if (loadEpisodes !== false) {
      try {
        while (true) {
          var params = { h_program_id: id };
          if (apt) params.apt = apt;
          var page = call(host, '/broadcast/get_program_audio_list', params);
          if (!Array.isArray(page)) throw new Error('听听FM节目目录格式不正确');
          var outside = false, added = 0;
          page.forEach(function (p) {
            var date = titleDay(str(p, 'title'));
            // 按最新一期向前计算范围，停播节目也能查看当时的历史回听。
            if (!cutoff && date && days !== '全部') cutoff = chinaDay(timestamp(date, '00:00') - (Number(days) - 1) * DAY);
            if (cutoff && date && date < cutoff) { outside = true; return; }
            var e = replayEpisode(p, date, '');
            if (e && !seen[e.url]) { seen[e.url] = true; episodes.push(e); added++; }
          });
          if (loadFullPages === false || outside || page.length < 20 || added === 0) break;
          var next = str(page[page.length - 1], 'apt');
          if (!next || next === apt || cursors[next]) break;
          cursors[next] = true; apt = next;
          host.progress('已加载 ' + episodes.length + ' 期');
        }
      } finally { host.progress(null); }
    }
    return { title: str(info, 'title'), coverUrl: str(info, 'cover'), artist: items(info, 'anchor').join(' · '),
      author: str(info, 'belong_radio'), intro: str(info, 'description'), episodes: episodes };
  }

  registerSource({
    id: '704f356ff05c47b9a872f50d3216e8a5', name: '听听FM', url: SITE + '/', group: '广播', multipleEpisodePages: true,
    description: '北京广播电视台听听FM：电台直播、节目单回听和广播节目历史回听。电台页列今天、昨天已有音频的节目；历史节目可在“广播节目”或搜索里找。单个节目默认列最新一期起30天，可在源设置里调整。不包含付费专辑和主播直播。',
    config: [{ type: 'select', key: 'replayDays', label: '节目回听范围（从最新一期向前，天）', default: '30', options: ['7', '30', '90', '全部'] }],
    categoryMenus: function () {
      return [{ title: '广播', tabs: [{ title: '北京电台', url: 'ttfm-radios' }, { title: '广播节目', url: 'ttfm-programs:1' }] }];
    },
    categoryPage: function (url) {
      var host = this.host;
      if (url === 'ttfm-radios') {
        var home = call(host, '/recommend/index_v3_6', {});
        return { books: items(home, 'bj_radio').map(radioBook), currentPage: 1, totalPage: 1 };
      }
      var m = /^ttfm-programs:(\d+)$/.exec(url);
      if (!m || Number(m[1]) < 1) throw new Error('不认识的听听FM分类地址');
      var page = Number(m[1]), path = page === 1 ? '/sitemap/index.html' : '/sitemap/index_' + page + '.html';
      var doc = host.getHtml(SITE + path), books = [];
      doc.select('.card').forEach(function (card) {
        var link = card.first('.card-title a'), id = /\/program\/([A-Za-z0-9]+)/.exec(link.attr('href'));
        if (id) books.push({ bookUrl: 'ttfm:program:' + id[1], title: link.text(), coverUrl: card.first('img').absUrl('src'),
          intro: card.first('.card-description').text(), status: '节目回听' });
      });
      var more = doc.select('.pagination a').some(function (a) { return a.text().indexOf('下一页') >= 0; });
      return { books: books, currentPage: page, totalPage: more ? page + 1 : page, nextUrl: more ? 'ttfm-programs:' + (page + 1) : null };
    },
    search: function (keywords, page) {
      var host = this.host, word = String(keywords).trim();
      if (!word) return { books: [], totalPage: 1 };
      if (word !== searchWord || page === 1) { searchWord = word; searchPages = {}; }
      var books = [], more = false, next = {};
      [3, 4].forEach(function (type) {
        var prev = searchPages[page];
        if (page > 1 && (!prev || !prev[type])) return;
        var params = { keyword: word, type: type };
        if (page > 1) params.apt = prev[type];
        var list = items(call(host, '/search/search_row_v4', params), 'list');
        list.forEach(function (row) { var book = searchBook(row); if (book) books.push(book); });
        var cursor = list.length >= 20 ? str(list[list.length - 1], 'apt') : '';
        if (cursor && cursor !== params.apt) { next[type] = cursor; more = true; }
      });
      searchPages[page + 1] = next;
      var seen = {};
      books = books.filter(function (b) { if (seen[b.bookUrl]) return false; seen[b.bookUrl] = true; return true; });
      return { books: books, totalPage: more ? page + 1 : page };
    },
    bookDetail: function (url, loadEpisodes, loadFullPages) {
      var book = parseBook(url);
      return book.type === 'radio' ? radioDetail(this.host, book.id, loadEpisodes) : programDetail(this.host, book.id, loadEpisodes, loadFullPages);
    },
    audio: function (url) {
      var host = this.host, m = /^ttfm:(live|audio):([A-Za-z0-9]+)$/.exec(url);
      if (!m) throw new Error('不认识的听听FM章节地址');
      if (m[1] === 'live') {
        var info = radioInfo(host, m[2]).info || {};
        var link = str(info, 'play_urls.hls') || str(info, 'play_urls.mp3');
        if (!/^https?:\/\//.test(link)) throw new Error('听听FM暂未提供这个电台的直播地址');
        var headers = { Referer: SITE + '/' };
        if (str(info, 'play_urls.hls')) headers['X-Media-Type'] = 'hls';
        return { url: link, headers: headers };
      }
      // 地址有 auth_key 时效签名，每次播放重新获取，不把签名地址当作章节标识保存。
      var data = call(host, '/albumaudio/play_audio', { type: 2, sort: -1, audio_id: m[2] });
      if (data.info && Number(data.info.is_free) === 0 && Number(data.info.is_buy) !== 1) throw new Error('这期节目需要在听听FM登录或购买后收听');
      var selected = items(data, 'list').filter(function (a) { return str(a, 'h_audio_id') === m[2]; })[0];
      var audio = str(selected, 'play_url');
      if (!/^https?:\/\//.test(audio)) throw new Error('听听FM没有返回所选这一期的播放地址，可能已下架或暂不可用');
      return { url: audio, headers: { Referer: SITE + '/' } };
    }
  });
})();
