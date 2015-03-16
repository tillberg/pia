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
  // log('hash of ' + bytes.length + ' bytes took ' + elapsed + 'ms');
  return hash;
}

function queueUpload(bytes, cb) {
  var hash = calcHash(bytes);
  // log('queueing upload of ' + btoa(hash) + ' - ' + bytes.length + ' bytes.');
  // queue upload if necessary
  cb(hash);
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

var idleTimerMs = 50;
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
  request.getContent(function getContent(content, encoding) {
    var bytes = content != null && encoding === 'base64' ? atob(content) : content;
    // log(request.request.url + ' (' + (bytes && bytes.length) + ' bytes) getContent took ' + (Date.now() - start) + 'ms');
    function sendEvent(sha1) {
      var ev = {
        url: request.request.url,
        method: request.request.method,
        mimeType: request.response.content.mimeType,
        status: request.response.status,
        latency: Math.round(request.time),
        startTime: new Date(request.startedDateTime).getTime(),
      };
      if (sha1) {
        ev.sha1 = sha1;
      }
      // log(ev);
    }
    done();
    if (bytes != null) {
      queueOnIdle(function(done) {
        done();
        uploadBytes(blobPrefix + bytes, function(sha1) {
          // log('totalHashTime: ' + totalHashTime);
          sendEvent(sha1);
        });
      })
    } else {
      sendEvent(null);
    }
  });
}

chrome.devtools.network.onRequestFinished.addListener(function(request) {
  // Process the request after a delay so as to avoid causing delays during
  // page load/render.
  queueOnIdle(requestContent.bind(null, request));
});

chrome.devtools.network.onNavigated.addListener(function onNavigated(url) {
  // log('navigated to ' + url);
  totalHashTime = 0;
});
