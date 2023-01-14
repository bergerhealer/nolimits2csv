
function NL2CSV() {
  this.no = 0;
  this.text = ['"No."',
               '"PosX"', '"PosY"', '"PosZ"',
               '"FrontX"', '"FrontY"', '"FrontZ"',
               '"LeftX"', '"LeftY"', '"LeftZ"',
               '"UpX"', '"UpY"', '"UpZ"' ].join('\t');
}

NL2CSV.prototype.add = function(pos, front, left, up) {
  var values = [].concat(pos)
                 .concat(front)
                 .concat(left)
                 .concat(up);
  values = values.map(function (n) { return stringify_number(n, 6); });

  this.text += '\r\n' + ++this.no + '\t' + values.join('\t');
}

NL2CSV.prototype.add_loop = function() {
  // Not supported
}


function TCCCSV() {
  this.text = '';
  this.first_node = null;
}

function TCCStringify(n) {
  n = Number(n.toFixed(6)); // Round
  if (n == 0.0)
    return '"0.0"'; // avoids "-0.0"
  else if (Number.isInteger(n))
    return '"' + n + '.0"'; // avoids "2"
  else
    return '"' + n.toString() + '"';
}

TCCCSV.prototype.add = function(pos, front, left, up) {
  var values = [].concat(pos)
                 .concat(up);
  values = values.map(TCCStringify);

  var format;
  if (this.text === '') {
    this.text = '"ROOT",' + values.join(',');
    this.first_node = pos.map(TCCStringify);
  } else {
    this.text += '\r\n"NODE",' + values.join(',');
  }
}

TCCCSV.prototype.add_loop = function() {
  if (this.first_node) {
    this.text += '\r\n"LINK",' + this.first_node;
  }
}
