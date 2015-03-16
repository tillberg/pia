function log() {
  var strings = [].map.call(arguments, function(arg) {
    return 'JSON.parse(unescape("' + escape(JSON.stringify(arg)) + '"))';
  });
  chrome.devtools.inspectedWindow.eval('console.log(' + strings.join(', ') + ');');
}

var blobPrefix = 'blob\0';
var bcatPrefix = 'cat1\0'; // cat2 would be sha256, I guess?
var prefixLength = 5;

var hashPrefix = 'PIA1:';

var chunkLength = 256 * 1024;

var totalHashTime = 0;

function calcHash(bytes) {
  var start = Date.now();
  var shaObj = new jsSHA(hashPrefix + bytes, "BYTES");
  var hash = shaObj.getHash("SHA-1", "BYTES"); // SHA-256 is much slower
  var elapsed = Date.now() - start;
  totalHashTime += elapsed;
  return hash;
  // log('hash of ' + bytes.length + ' bytes took ' + elapsed + 'ms');
}

function queueUpload(bytes, cb) {
  var hash = calcHash(bytes);
  log('queueing upload of ' + btoa(hash) + ' - ' + bytes.length + ' bytes.');
  // queue upload if necessary
  setTimeout(function() {
    cb(hash);
  }, 0);
}

function uploadBytes(bytes, cb) {
  if (bytes.length > chunkLength) {
    var chunks = [];
    function nextChunk() {
      var n = chunks.length;
      var start = n * chunkLength;
      if (start < bytes.length) {
        var chunk = bytes.slice(start, start + chunkLength);
        // log(start);
        queueUpload(chunk, function(hash) {
          chunks.push(hash);
          setTimeout(nextChunk, 0);
        });
      } else {
        var chunkData = bcatPrefix + chunks.join('');
        uploadBytes(chunkData, cb);
      }
    }
    setTimeout(nextChunk, 0);
  } else {
    queueUpload(bytes, cb);
  }
}


chrome.devtools.network.onRequestFinished.addListener(function(request) {
  var finishTime = new Date().getTime();
  // log('request', request);
  request.getContent(function getContent(content, encoding) {
    var envelope;
    var parts = [];
    var bytes = encoding === 'base64' ? atob(content) : content;
    // log(request.request.url + ' is ' + bytes.length + ' bytes');
    uploadBytes(blobPrefix + bytes, function(hash) {
      var ev = {
        url: request.request.url,
        method: request.request.method,
        mimeType: request.response.content.mimeType,
        status: request.response.status,
        latency: Math.round(request.time),
        startTime: new Date(request.startedDateTime).getTime(),
        sha1: btoa(hash),
      };
      log(ev);
      log('totalHashTime: ' + totalHashTime);
    });
  });
});

chrome.devtools.network.onNavigated.addListener(function onNavigated(url) {
  // log('navigated to ' + url);
  totalHashTime = 0;
});
