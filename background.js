var log = console.log.bind(console);

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

var bytesUploaded = 0;
var numReqs = 0;

function updateStats() {
  var text = [
    '',
    'blocks: ' + cachedSha1s.size,
    'bytes: ' + bytesUploaded,
    'reqs: ' + numReqs,
    '',
  ].join('\n');
  document.body.innerHTML = text;
}

var serverUrl = 'http://localhost:8430/';

function queueUpload(sha1, bytes) {
  cachedSha1s.add(sha1);
  var numBytes = bytes.length;
  bytesUploaded += numBytes;
  var summaryStr = btoa(sha1) + ' (' + numBytes + ' bytes)';
  var request = new XMLHttpRequest();
  request.open('POST', serverUrl, true);
  request.setRequestHeader('Content-Type', 'application/octet-stream');
  request.onload = function() {
    if (request.status >= 200 && request.status < 400) {
      log('Uploaded ' + summaryStr);
    } else {
      console.error('Error POSTing ' + summaryStr + ' to ' + serverUrl);
    }
  };
  request.onerror = function() {
    console.error('Error POSTing ' + summaryStr + ' to ' + serverUrl);
  };
  request.send(bytes);
}

chrome.runtime.onConnect.addListener(function(port) {
  // log('new connection');
  port.onMessage.addListener(function(ev) {
    // log('msg: ' + ev.type);
    var sha1 = ev.sha1;
    var sha1Str = sha1 ? btoa(sha1) : null;
    if (ev.type === 'request') {
      var url = ev.url;
      var shortUrl = url.length > 103 ? (url.slice(0, 50) + '...' + url.slice(-50)) : url;
      log('req: ' + shortUrl + (sha1Str ? ' [' + sha1Str + ']' : ''));
      numReqs++;
    } else if (ev.type === 'check_sha1') {
      var isHit = cachedSha1s.has(sha1);
      log('cache ' + (isHit ? 'hit' : 'miss') + ' ' + sha1Str);
      port.postMessage({
        type: 'check_sha1',
        sha1: sha1,
        isHit: isHit,
      });
    } else if (ev.type === 'upload') {
      queueUpload(sha1, ev.bytes);
    } else {
      log('unknown event type: ' + ev.type);
    }
    updateStats();
  });
  // port.onDisconnect.addListener(function() {
  //   log('disconnect');
  // });
});

log('PIA started.');
