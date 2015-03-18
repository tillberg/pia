var num = 0;

function log(s) {
  var div = document.createElement('div');
  var nowStr = new Date().toISOString().slice(0, -1);
  div.innerHTML = nowStr + ' ' + s;
  div.style.whiteSpace = 'nowrap';
  document.body.appendChild(div);
  num++;
  if (num > 30) {
    document.body.children[0].remove();
  }
}

// var requestFilter = {
//   urls: [ "<all_urls>" ]
// };

// chrome.webRequest.onSendHeaders.addListener(function onSendHeaders(data) {
//   console.log('onSendHeaders', data);
// }, requestFilter);

// chrome.webRequest.onBeforeRedirect.addListener(function onBeforeRedirect(data) {
//   console.log('onBeforeRedirect', data);
// }, requestFilter);

// chrome.webRequest.onCompleted.addListener(function onCompleted(data) {
//   console.log('onCompleted', data);
// }, requestFilter);

// chrome.webRequest.onErrorOccurred.addListener(function onErrorOccurred(data) {
//   console.log('onErrorOccurred', data);
// }, requestFilter);

var cachedSha1s = new Set();

chrome.runtime.onConnect.addListener(function(port) {
  port.onMessage.addListener(function(ev) {
    var sha1 = ev.sha1;
    var sha1Str = sha1 ? btoa(sha1) : null;
    if (ev.type === 'request') {
      var url = ev.url;
      var shortUrl = url.length > 103 ? (url.slice(0, 50) + '...' + url.slice(-50)) : url;
      log('req: ' + shortUrl + (sha1Str ? ' [' + sha1Str + ']' : ''));
    } else if (ev.type === 'check_sha1') {
      var isHit = cachedSha1s.has(sha1);
      // log('cache ' + (isHit ? 'hit' : 'miss') + ' ' + sha1Str);
      port.postMessage({
        type: 'check_sha1',
        sha1: sha1,
        isHit: isHit,
      });
    } else if (ev.type === 'upload') {
      cachedSha1s.add(sha1);
      log('"saved" ' + sha1Str + ' (' + ev.bytes.length + ' bytes)');
    } else {
      log('unknown event type: ' + ev.type);
    }
  });
});

log('PIA started.');
