
function PasteServer(server_name) {
  this.server_name = server_name;

  // Ensure either http:// or https:// is in front
  // If omitted, default to http:// which should auto redirect to https if so
  if (!this.server_name.startsWith("http://") && !this.server_name.startsWith("https://")) {
    this.server_name = "http://" + this.server_name;
  }

  // Trim trailing path elements
  while (this.server_name.endsWith("/")) {
    this.server_name = this.server_name.substring(0, this.server_name.length-1);
  }
}

/* Bleh. */
PasteServer.prototype.make_request = function(options, success, failure) {
  try {
    var xmlhttp = new XMLHttpRequest();

    xmlhttp.onreadystatechange = function() {
      if (xmlhttp.readyState == XMLHttpRequest.DONE) { // XMLHttpRequest.DONE == 4
        if (xmlhttp.status != 200) {
          failure("Server Error Code " + String(xmlhttp.status));
        } else {
          try {
            if (options.json)
              success(JSON.parse(xmlhttp.responseText));
            else
              success(xmlhttp.responseText);
          } catch (err) {
            failure(err);
          }
        }
      }
    };

    xmlhttp.open(options.method, this.server_name + "/" + options.path, true);

    if (options.compressed) {
      xmlhttp.setRequestHeader('Content-Encoding', 'gzip');
    }

    xmlhttp.send(options.content);
  } catch (err) {
    failure(err);
  }
}

PasteServer.prototype.can_compress = function(callback) {
  // If clientside compression isn't supported at all, don't bother with this.
  if (typeof CompressionStream === 'undefined' || typeof Response === 'undefined') {
    callback(false);
    return;
  }

  this.make_request({method:"GET", path:"capabilities", json:true}, function(capabilities) {
    callback(capabilities['request-content-encoding'] || false);
  }, function() { callback(false); });
}

PasteServer.prototype.upload_doc = function(content, compressed, success, failure) {
  const paste = this;

  paste.make_request({
    method: 'POST',
    path: 'documents',
    json: true,
    compressed: compressed,
    content: content
  }, function(resp) {
    if (resp.key) {
      success(paste.server_name + "/" + resp.key);
    } else {
      failure("Server did not return a document");
    }
  }, failure);
}

PasteServer.prototype.upload = function(content, success, failure) {
  const paste = this;

  // Check can compress the data with gzip during upload, or not
  paste.can_compress(function (can_compress) {
    if (can_compress) {
      // Compress the data (not supported on all browsers)
      try {
        const s = new CompressionStream('gzip');
        const compressionStream = content.stream().pipeThrough(s);
        new Response(compressionStream).blob().then(function (compressed_content) {
          paste.upload_doc(compressed_content, true, success, failure);
        }).catch(failure);
      } catch (err) {
        console.warn("Compression failed", err);
      }
    }

    // Uncompressed upload - failed to query / failed to compress
    paste.upload_doc(content, false, success, failure);
  });
}
