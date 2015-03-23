
var reconnectPortEveryMs = 1000;
var port;
function onDisconnect() {
  log('disconnected');
  port = null;
}
function onMessage(ev) {
  if (ev.type === 'check_sha1') {
    var sha1 = ev.sha1;
    if (hashCheckQueue[sha1] != null) {
      log('check_sha1 ' + btoa(sha1) + ' ' + (ev.isHit ? 'hit' : 'miss'));
      if (!ev.isHit) {
        uploadQueue[sha1] = hashCheckQueue[sha1];
        ensureUploaderTimeout();
      }
      delete hashCheckQueue[sha1];
    }
  } else {
    log('unknown event type: ' + ev.type);
  }
}
function postMessage(msg) {
  if (!port) {
    // log('new port');
    port = chrome.runtime.connect({name: "devtools-page"});
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);
    setTimeout(function () {
      var _port = port;
      port = null;
      setTimeout(function () {
        // log('disconnect');
        _port.disconnect();
      }, 2000); // allow for in-flight responses to come back
    }, reconnectPortEveryMs);
  }
  // How do we know that msg gets received?
  port.postMessage(msg);
}

function log() {
  var strings = [].map.call(arguments, function(arg) {
    return 'JSON.parse(unescape("' + escape(JSON.stringify(arg)) + '"))';
  });
  chrome.devtools.inspectedWindow.eval('console.log(' + strings.join(', ') + ');');
}

var blobPrefix = 'blob\0';
var bcatPrefix = 'cat1\0'; // cat2 would/will maybe be sha256, I guess?
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
  // log('hash of ' + bytes.length + ' bytes took ' + elapsed + 'ms');
  return hash;
}

var uploadQueue = {};
var hashCheckQueue = {};

var uploaderTimeout;
function uploader() {
  uploaderTimeout = null;
  var sha1;
  for (var _sha1 in uploadQueue) {
    sha1 = _sha1;
    ensureUploaderTimeout();
    break;
  }
  if (sha1) {
    // XXX do something to verify receipt?
    var bytes = uploadQueue[sha1];
    log('uploading ' + btoa(sha1) + ' (' + (bytes ? bytes.length : 'null') + ' bytes)');
    postMessage({
      type: 'upload',
      sha1: sha1,
      bytes: bytes,
    });
    delete uploadQueue[sha1];
  }
}
function ensureUploaderTimeout() {
  if (!uploaderTimeout) {
    uploaderTimeout = setTimeout(uploader, 1);
  }
}

function sendHashCheck(sha1) {
  if (hashCheckQueue[sha1] != null) {
    // log('send check_sha1 ' + btoa(sha1));
    postMessage({
      type: 'check_sha1',
      sha1: sha1,
    });
    setTimeout(sendHashCheck.bind(null, sha1), 1000);
  }
}

function queueUpload(bytes, cb) {
  var sha1 = calcHash(bytes);
  // log('queueing upload of ' + btoa(hash) + ' - ' + bytes.length + ' bytes.');
  hashCheckQueue[sha1] = bytes;
  sendHashCheck(sha1);
  cb(sha1);
}

function uploadBytes(bytes, cb) {
  if (bytes.length > chunkLength) {
    var chunks = [];
    function nextChunk(done) {
      var n = chunks.length;
      var start = n * chunkLength;
      if (start < bytes.length) {
        var chunk = bytes.slice(start, start + chunkLength);
        // log(start);
        queueUpload(chunk, function(hash) {
          chunks.push(hash);
          queueOnIdle(nextChunk);
          done();
        });
      } else {
        var chunkData = bcatPrefix + chunks.join('');
        uploadBytes(chunkData, cb);
        done();
      }
    }
    queueOnIdle(nextChunk);
  } else {
    queueUpload(bytes, cb);
  }
}

var nextId = 1;

var idleCallbacks = [];

var idlenessCheckerTimeout;
var idleCheckCount = 0;
var _isIdle = false;

var idleTimerMs = 0;//50;
var idleThresholdMs = 100;
var idleThresholdCount = 20;
var idlenessCheckerLastTime = 0;
var idleTaskRunning = false;

function callIdleTask() {
  if (idleCallbacks.length) {
    var start = Date.now();
    idleTaskRunning = true;
    var taskFn = idleCallbacks.shift();
    // log('running task: ' + taskFn);
    taskFn(function onIdleTaskDone() {
      // log('task took ' + (Date.now() - start) + 'ms');
      idleTaskRunning = false;
      ensureIdlenessCheckerTimeout();
    });
  } else {
    // log('idle queue empty');
  }
}

function ensureIdlenessCheckerTimeout() {
  if (!idlenessCheckerTimeout && !idleTaskRunning) {
    var now = Date.now();
    var delay = Math.max(0, idleTimerMs - (now - idlenessCheckerLastTime));
    // log('delay: ' + delay);
    idlenessCheckerTimeout = setTimeout(idlenessChecker, delay);
  }
}

function idlenessChecker() {
  idlenessCheckerTimeout = null;
  var now = Date.now();

  if (now - idlenessCheckerLastTime < idleThresholdMs) {
    idleCheckCount++;
  } else {
    idleCheckCount = 0;
  }
  // log('delta: ' + (now - idlenessCheckerLastTime) + ', idleCheckCount: '+ idleCheckCount);
  idlenessCheckerLastTime = now;
  if (idleCheckCount >= idleThresholdCount) {
    _isIdle = true;
    callIdleTask();
    return;
  }
  ensureIdlenessCheckerTimeout();
}

function queueOnIdle(cb) {
  idleCallbacks.push(cb);
  ensureIdlenessCheckerTimeout();
}

function requestContent(request, done) {
  var start = Date.now();
  var headers = {};
  for (var i = 0; i < request.request.headers.length; i++) {
    var header = request.request.headers[i];
    headers[header.name] = header.value;
  }
  if (headers.Origin && headers.Origin.match(/^chrome-extension/)) {
    log('ignoring request by chrome-extension');
    return;
  }
  request.getContent(function getContent(content, encoding) {
    var postData = request.request.postData;
    var reqBytes = postData && postData.text;
    var respBytes = content != null && encoding === 'base64' ? atob(content) : content;

    // log(request.request.url + ' (' + (bytes && bytes.length) + ' bytes) getContent took ' + (Date.now() - start) + 'ms');
    var reqSha1;
    var respSha1;
    function sendEvent() {
      var ev = {
        type: 'request',
        url: request.request.url,
        method: request.request.method,
        status: request.response.status,
        latency: Math.round(request.time),
        startTime: new Date(request.startedDateTime).getTime(),
        reqMimeType: postData && postData.mimeType,
        reqBody: reqSha1,
        respMimeType: request.response.content.mimeType,
        respBody: respSha1,
      };
      log(ev);
      postMessage(ev);
    }
    done();
    function processReqBody(done) {
      if (reqBytes != null) {
        uploadBytes(blobPrefix + reqBytes, function(sha1) {
          reqSha1 = sha1;
          sendEvent();
        });
      } else {
        sendEvent();
      }
    }
    function processRespBody(done) {
      done();
      if (respBytes != null) {
        uploadBytes(blobPrefix + respBytes, function(sha1) {
          respSha1 = sha1;
          processReqBody();
        });
      } else {
        processReqBody();
      }
    }
    queueOnIdle(processRespBody);
  });
}

chrome.devtools.network.onRequestFinished.addListener(function(request) {
  if (request.request.url.match(/^data\:/)) {
    // log('ignoring data url: ' + request.request.url);
    return;
  }
  // Process the request after a delay so as to avoid causing delays during
  // page load/render.
  queueOnIdle(requestContent.bind(null, request));
});

chrome.devtools.network.onNavigated.addListener(function onNavigated(url) {
  // log('navigated to ' + url);
  totalHashTime = 0;
});
