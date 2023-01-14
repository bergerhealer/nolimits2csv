/* All the GUI-related javascript. No conversion happens here. */

const inputDropzone = document.getElementById("input-dropzone")
document.body.addEventListener("dragover", inputDragOverHandler);
document.body.addEventListener("dragenter", inputDragEnterHandler);
document.body.addEventListener("dragleave", inputDragLeaveHandler);
document.body.addEventListener("drop", inputDropHandler);

const inputFileSelect = document.getElementById("inputFile")
inputFileSelect.addEventListener("change", inputFileChanged);

const nodeDistanceDefault = document.getElementById("default-node-distance");
const nodeDistance = document.getElementById("node-distance");
nodeDistanceDefault.addEventListener("change", defaultNodeDistanceCheckedChanged);
nodeDistance.addEventListener("change", nodeDistanceChanged);

const defaultPasteServer = "https://paste.traincarts.net"
const pasteServerDialog = document.getElementById("paste-server-bg");
pasteServerDialog.addEventListener("mousedown", function (evt) {
  if (evt.target === pasteServerDialog)
    closePasteServerDialog();
});
const pasteServerName = document.getElementById("paste-server-name");
pasteServerName.value = defaultPasteServer;
pasteServerName.addEventListener("change", function() {
  updateUploadBtnTitle();
  saveSettings();
});
pasteServerName.addEventListener("keydown", function (evt) {
  if (evt.keyCode === 13)
    closePasteServerDialog();
});

const outputTextEl = document.getElementById('output-text');

// Browsers suck what the heck???
var dragCounter = 0;

// Currently loaded LWO data
var lwo = null;

// All supported formats
function CSVGUIFormat(name, create_csv_encoder) {
  this.name = name;
  this.create_csv_encoder = create_csv_encoder;
  this.el = document.getElementById(name);
}
const formats = [
  new CSVGUIFormat('format-nl2', function() { return new NL2CSV(); }),
  new CSVGUIFormat('format-tcc', function() { return new TCCCSV(); })
];

// All settings that are remembered/restored on refresh
const settings = [
  {
    name: 'node-distance',
    get: function() { return nodeDistance.value; },
    set: function(val) { nodeDistance.value = val; }
  },
  {
    name: 'node-distance-default',
    get: function() { return nodeDistanceDefault.checked; },
    set: function(val) { nodeDistanceDefault.checked = (val == 'true'); }
  },
  {
    name: 'output-format',
    get: function() {
      for (const format of formats) {
        if (format.el.checked) {
          return format.name;
        }
      }
      return "none";
    },
    set: function(val) {
      for (const format of formats) {
        if (format.name == val) {
          format.el.checked = true;
          break;
        }
      }
    }
  },
  {
    name: 'paste-server-name',
    get: function() { return pasteServerName.value; },
    set: function(val) { if (val) pasteServerName.value = val; }
  }
];

function loadSettings() {
  for (const setting of settings) {
    var value = window.localStorage.getItem(setting.name);
    if (value !== null) {
      setting.set(value);
    }
  }

  // Refresh UI based on settings
  nodeDistance.disabled = nodeDistanceDefault.checked;
  updateUploadBtnTitle();
}

function saveSettings() {
  try {
    for (const setting of settings) {
      window.localStorage.setItem(setting.name, String(setting.get()));
    }
  } catch (err) {
    console.warn("Failed to save current options to local storage", err);
  }
}

function updateUploadBtnTitle() {
  var el = document.getElementById('upload-btn');
  el.title = "Upload to " + (String(pasteServerName.value) || defaultPasteServer);
}

function showDropDialog() {
  // Forward the click to the input element
  document.getElementById("inputFile").click();
}

function inputDropHandler(evt) {
  evt.preventDefault();
  inputDropzone.classList.remove("drophover");
  dragCounter = 0;

  if (!evt.dataTransfer || !evt.dataTransfer.files || evt.dataTransfer.files.length == 0) {
    setInputError("Please drop files only");
    return;
  }

  if (evt.dataTransfer.files.length == 1) {
    // Pass file drop to the file in
    // Might not work on all browsers
    inputFileSelect.files = evt.dataTransfer.files;
    inputFileSelect.dispatchEvent(new Event('change', { 'bubbles': true }));
  } else {
    setInputError("Please drop only one file");
  }
}

function setInputError(message) {
  errEl = document.getElementById("input-error-msg");
  if (message) {
    errEl.innerText = message;
    errEl.classList.add("error-shake");
  } else {
    errEl.innerText = "";
    errEl.classList.remove("error-shake");
  }
}

function inputDragEnterHandler(evt) {
  inputDropzone.classList.add("drophover");
  ++dragCounter;
}

function inputDragOverHandler(evt) {
  evt.preventDefault();
}

function inputDragLeaveHandler(evt) {
  if (--dragCounter == 0) {
    // All this crap is because firefox does something funky
    window.setTimeout(function() {
      if (dragCounter == 0) {
        inputDropzone.classList.remove("drophover");
      }
    }, 50);
  }
}

function defaultNodeDistanceCheckedChanged() {
  saveSettings();
  nodeDistance.disabled = nodeDistanceDefault.checked;
  generateCSVText();
}

function nodeDistanceChanged() {
  saveSettings();
  generateCSVText();
}

function formatChanged() {
  saveSettings();
  generateCSVText();
}

function setOutputText(text) {
  outputTextEl.value = text || "No LWO file loaded";
  setExportEnabled(text ? true : false);
}

function setExportEnabled(enabled) {
  const save_el = document.getElementById('save-btn');
  const upload_el = document.getElementById('upload-btn');
  save_el.disabled = !enabled;
  upload_el.disabled = !enabled;
}

function generateCSVText() {
  if (!lwo) {
    setOutputText(null);
    return;
  }

  var csv = null;
  for (const format of formats) {
    if (format.el.checked) {
      csv = format.create_csv_encoder();
      break;
    }
  }
  if (!csv)
    return;

  if (nodeDistanceDefault.checked) {
    // Output as-is
    for (const ring of lwo.rings) {
      csv.add(ring.pos(), ring.front(), ring.left(), ring.up());
    }
  } else {
    // Walk along the rings, interpolating position and orientation
    const node_distance = Math.max(0.1, parseFloat(nodeDistance.value));
    if (isNaN(node_distance))
      throw new Error("NaN node distance");

    const interpolator = lwo.interpolate();
    const first = interpolator.first;
    csv.add(first.pos, first.front, first.left, first.up);
    for (var next; next = interpolator.next(node_distance);) {
      csv.add(next.pos, next.front, next.left, next.up);
    }
  }
  if (lwo.looped) {
    csv.add_loop();
  }
  setOutputText(csv.text);
}

function inputFileChanged(evt) {
  if (!inputFileSelect.files || inputFileSelect.files.length == 0) {
    return;
  }

  const info_el = document.getElementById("input-info");

  setInputError("");
  setOutputText(null);
  setExportEnabled(false);
  info_el.innerText = "";
  lwo = null;

  // Read the file contents
  var reader = new FileReader();
  reader.onload = function() {
    try {
      var data = new Uint8Array(this.result);
      var name = inputFileSelect.files[0].name;
      if (name.toLowerCase().endsWith(".lwo")) {
        name = name.substring(0, name.length - 4);
      }

      lwo = new LWO(data, name);
      lwo.load();

      // Show filename now we know it loaded
      info_el.innerText = 'Loaded [ ' + name + ' ]';

      // Generate NoLimits2 CSV
      generateCSVText();

      setExportEnabled(true);
    } catch (err) {
      setInputError(String(err));
      lwo = null;
      setTimeout(function() { throw err; }, 0);
    }
  }
  reader.readAsArrayBuffer(inputFileSelect.files[0]);
}

function openPasteServerDialog() {
  pasteServerDialog.classList.add("paste-server-bg-shown");
  pasteServerName.select();
  pasteServerName.focus();
}

function closePasteServerDialog() {
  if (!pasteServerName.value) {
    pasteServerName.value = defaultPasteServer;
  } else {
    pasteServerDialog.classList.remove("paste-server-bg-shown");
  }
}

function upload(success, failure) {
  server = new PasteServer(String(pasteServerName.value) || defaultPasteServer);
  server.upload(saveAsBlob(), success, failure);
}

function uploadButtonClick() {
  const container_el = document.getElementById('upload-fold-container');
  const result_el = document.getElementById('upload-result');
  const status_el = document.getElementById('upload-status-icon');
  const popup_el = document.getElementById('upload-copy-popup');

  // Hide everything, show a spinner
  container_el.style.width = '0%';
  result_el.className = '';
  result_el.value = '';
  status_el.style.display = 'block';

  // Success callback
  function success(url) {
    container_el.style.width = '100%';
    status_el.style.display = 'none';
    result_el.className = 'upload-result-url';
    result_el.value = url;
    result_el.select();

    // Also copy to clipboard. Only show popup about this if successful
    try {
      navigator.clipboard.writeText(url);
      setTimeout(function() {
        popup_el.style.display = 'block';
        setTimeout(function() { popup_el.style.display = 'none'; }, 1000);
      }, 250);
    } catch (err) {
    }
  }

  // Failure callback
  function failure(err) {
    container_el.style.width = '100%';
    status_el.style.display = 'none';
    result_el.className = 'upload-result-error';
    result_el.value = String(err);

    // Log to console as well
    setTimeout(function() { throw err; }, 0);
  }

  // Perform the asynchronous upload, with handlers for success/failure
  try {
    upload(success, failure);
  } catch (err) {
    failure(err);
  }
}

function saveAsBlob() {
  return new Blob([outputTextEl.value], {type: "text/csv;charset=utf-8"});
}

function saveButtonClick() {
  saveAs(saveAsBlob(), lwo.name + ".csv"); /* FileSaver.min.js */
}
