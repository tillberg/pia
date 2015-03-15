function log() {
  var strings = [].map.call(arguments, function(arg) {
    return 'JSON.parse(unescape("' + escape(JSON.stringify(arg)) + '"))';
  });
  chrome.devtools.inspectedWindow.eval('console.log(' + strings.join(', ') + ');');
}

chrome.devtools.network.onRequestFinished.addListener(function(request) {
  var finishTime = new Date().getTime();
  log('request', request);
  request.getContent(function getContent(content, encoding) {
    var bytes = encoding === 'base64' ? atob(content) : content;
    log(request.request.url + ' is ' + bytes.length + ' bytes');

    var ev = {
      url: request.request.url,
      method: request.request.method,
      mimeType: request.response.content.mimeType,
      latency: Math.round(request.time),
      time: finishTime,
    };
    log(ev);
  });
});

chrome.devtools.network.onNavigated.addListener(function onNavigated(url) {
  log('navigated to ' + url);
});
