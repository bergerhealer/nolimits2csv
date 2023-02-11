/*
 * Converts LWO files into a sequence of 3D points with orientation
 * LWO format gleaned from https://github.com/nangtani/blender-import-lwo/wiki/LWO2-file-format-(2001)
 */

function Track() {
  this.chains = [];
  this.rings = [];
  this.looped = false;
  this.total_length = 0.0;
}

// Starts ring-to-ring interpolation
Track.prototype.interpolate = function() {
  return new RingInterpolator(this.chains[0]);
}

// The mesh should look like a series of squares connected like a tube.
// The below code figures out the 4 points making up a single ring of this
// tube. Further down below we walk step by step along these "rings".
//
// Can change start index to properly validate discovery in the
// middle of the loop. Generally point 0 is of an end-ring.
Track.prototype.decode_rings = function(start_point) {
  // Ring around the circumference of the square tube the start point is part of
  // Also identifies the next ring in the sequence, and previous if found
  const search_ring_result = start_point.find_ring();
  if (!search_ring_result) {
    throw new Error("Mesh does not look like a square tube");
  }

  const root_ring = search_ring_result.root;

  var rings = [root_ring];
  var is_looped = false;
  {
    // First process the next ring until we reach the end, or
    // a loop is detected
    var iter = search_ring_result.iterator_next;
    for (var next; (next = iter.next());) {
      if (next.is_same_points(root_ring)) {
        is_looped = true;
        console.info("Reached loop at " + next.to_string());
        break; // Loop detected
      } else {
        rings.push(next);
      }
    }

    // Log the start point as an end point too
    if (!is_looped && !search_ring_result.iterator_previous) {
      console.info("Reached end at " + root_ring.to_string());
    }

    // If not looped and we have a second neighbour, iterate that one
    // too. We add the elements in front of the first chain of rings
    // in reverse.
    if (!is_looped && search_ring_result.iterator_previous) {
      iter = search_ring_result.iterator_previous;
      var last_ring = rings[rings.length - 1]; // just in case it connects anyway
      var prev_rings = [];
      for (var next; (next = iter.next());) {
        if (next.is_same_points(last_ring)) {
          is_looped = true;
          console.info("Reached loop at " + next.to_string());
          break; // Loop detected
        } else {
          prev_rings.push(next);
        }
      }

      // Reverse and concat
      prev_rings.reverse();
      rings = prev_rings.concat(rings);
    }
  }

  // Build a sequence of ring-pairs with distance pre-calculated
  // If looped, include a closing sequence with a last element
  var chains = [];
  for (var i = 0; i < (rings.length-1); i++) {
    chains.push(new RingPair(rings[i], rings[i+1], false));
  }
  if (is_looped) {
    chains.push(new RingPair(rings[rings.length-1], rings[0], true));
  }
  for (var i = 0; i < (chains.length-1); i++) {
    chains[i].next = chains[i+1];
  }

  // Compute total length of the track
  var total_length = 0.0;
  for (const chain of chains) {
    total_length += chain.distance;
  }

  console.info("Decoded " + rings.length + " rings, looped = " + is_looped +
          ", length = " + total_length);
  if (root_ring !== rings[0]) {
    console.info("Root ring " + root_ring.to_path_string());
  }
  console.info("Start ring " + rings[0].to_path_string());
  if (!is_looped) {
    console.info("End ring " + rings[rings.length - 1].to_path_string());
  }

  this.rings = rings;
  this.chains = chains;
  this.looped = is_looped;
  this.total_length = total_length;
}

function LWO(data, name) {
  this.data = data;
  this.name = name;
  this.tracks = [];
}

LWO.prototype.load = function() {
  var data = this.data;
  var endpos = data.length; // Updated by FORM
  var pos = 0;
  var tag;

  // Test whether the browser is little-endian, big-endian or very weird and unsupported
  // LWO files are written as big-endian
  // Test code taken from https://abdulapopoola.com/2019/01/20/check-endianness-with-javascript/
  // We could use DataView for this, but that API is quite "recent"
  var isLittleEndian;
  var isBigEndian;
  {
    var uInt32 = new Uint32Array([0x11223344]);
    var uInt8 = new Uint8Array(uInt32.buffer);
    if(uInt8[0] === 0x44) {
      isLittleEndian = true;
      isBigEndian = false;
    } else if (uInt8[0] === 0x11) {
      isLittleEndian = false;
      isBigEndian = true;
    } else {
      throw new Error("Unsupported system endian-ness");
    }
  }

  function advance_block(len) {
    var prev_pos = pos;
    pos += len;
    if (pos > endpos)
      throw new Error("Unexpected EOF at position " + pos);
    return prev_pos;
  }

  function read_block(len) {
    var prev_pos = advance_block(len);
    return data.subarray(prev_pos, pos);
  }

  function read_string(len) {
    return String.fromCharCode.apply(null, read_block(len));
  }

  function read_null_terminated_string() {
    var prev_pos = advance_block(0);
    while (pos < endpos) {
      if (data[pos] == 0) {
        // Null terminated string found
        var result = String.fromCharCode.apply(null, data.subarray(prev_pos, pos));
        ++pos; // skip null byte itself

        // If length including null is odd there's an extra terminating null
        if ((pos - prev_pos) & 0x1) {
          if (pos >= endpos || data[pos] != 0) {
            throw new Error("String null padding incorrect at position " + pos);
          } else {
            ++pos;
          }
        }

        return result;
      } else {
        ++pos;
      }
    }

    throw new Error("Unexpected String EOF at position " + pos);
  }

  // Read big-endian uint32
  function read_uint32() {
    var block = read_block(4);
    return (block[0] << 24) | (block[1] << 16) | (block[2] << 8) | (block[3]);
  }

  // Read big-endian uint16
  function read_uint16() {
    var block = read_block(2);
    return (block[0] << 8) | (block[1]);
  }

  // Read a variable int length number
  // This is 2 bytes for all sizes below 65280
  // If the first byte read is 0xFF then the next 3 bytes are the length, instead
  function read_var_int() {
    var start_pos = advance_block(2); // Advance at least this
    var b0, b1, b2, b3;
    b0 = data[start_pos];
    if (b0 == 0xFF) {
      advance_block(2);
      b0 = data[start_pos + 1];
      b1 = data[start_pos + 2];
      b2 = data[start_pos + 3];
      return (b0 << 16) | (b1 << 8) | b2;
    } else {
      b1 = data[start_pos + 1];
      return (b0 << 8) | b1;
    }
  }

  function read_float_array(num_floats) {
    var start_pos = advance_block(num_floats * 4);

    // If big-endian we can return the buffered data as-is
    if (isBigEndian) {
      return new Float32Array(data.buffer, start_pos, num_floats);
    }

    // Create a copy of the buffer and swap bytes to make it big-endian
    if (isLittleEndian) {
      var block = new Uint8Array(new ArrayBuffer(pos - start_pos));
      block.set(data.subarray(start_pos, pos));

      var holder;
      for (var i = 0; i< block.length; i+=4) {
        holder = block[i];
        block[i] = block[i+3];
        block[i+3] = holder;
        holder = block[i+1];
        block[i+1] = block[i+2];
        block[i+2] = holder;
      }

      return new Float32Array(block.buffer, 0, num_floats);
    }

    throw new Error("Unsupported operation");
  }

  function read_points(num_points, unique_points) {
    var float_data = read_float_array(num_points * 3); // xyz
    var points = new Array(num_points);
    var f_idx = 0;
    var old_unique = Object.keys(unique_points).length;
    for (var i = 0; i < num_points; i++) {
      var f_prev = f_idx;
      f_idx += 3;
      var pt = new Point(float_data.subarray(f_prev, f_idx));
      pt.xyz[2] = -pt.xyz[2];
      var pt_existing = unique_points[pt.xyz]
      if (pt_existing) {
        points[i] = pt_existing;
      } else {
        unique_points[pt.xyz] = pt;
        points[i] = pt;
      }
    }
    var new_unique = Object.keys(unique_points).length - old_unique;
    console.info("Read " + num_points + " points (" + new_unique + " unique)");
    return points;
  }

  function read_vertex_map(pnts, end_pos) {
    var tag = read_string(4);
    if (tag != 'TXUV')
      return;

    var dimensions = read_uint16();
    if (dimensions != 2)
      return; // Can't use this

    // Name of the TXUV. Generally "UV Map"
    read_null_terminated_string();

    // Read texture UV coordinates
    // The first coordinate (U) denotes a distance along the track,
    // and can be discarded. The second coordinate (V) could be used
    // to figure out what side of a ring is 'top'.
    var cnt = 0;
    while (pos < end_pos) {
      var pnt_idx = read_var_int();
      var uv = read_float_array(2);
      pnts[pnt_idx].uv.push(new PointUV(pnt_idx, uv));
      cnt++;
    }
    console.info("Read TXUV information for " + cnt + " vertices");
  }

  function read_polygons(pnts, end_pos) {
    if (pnts == null) {
      throw new Error("POLS read before PNTS");
    }

    var polyType = read_string(4);
    if (polyType != "FACE") {
      throw new Error("Only FACE polygons are supported");
    }

    var polygons = [];
    while (pos < end_pos) {
      var count = read_uint16() & 0x3FF; // Ignore flags, unused for FACE
      if (count != 3) {
        throw new Error("Only triangle polygons are supported");
      }
      var vertices = new Array(count);
      for (var i = 0; i < count; i++) {
        vertices[i] = PolygonVertex.find_in_pnts_list(pnts, read_var_int());
      }
      polygons.push(new Polygon(vertices));
    }

    // Store all polygons in the points themselves. Discard cached UV information.
    for (const poly of polygons) {
      for (const vert of poly.vertices) {
        if (vert.pt.uv.length > 0) {
          vert.pt.uv = [];
        }
        vert.pt.polygons.push(poly);
      }
    }

    // Use polygon information to calculate point-to-point neighbours
    var num_connections = 0;
    for (var poly of polygons) {
      for (var vert0 of poly.vertices) {
        for (var vert1 of poly.vertices) {
          const pt0 = vert0.pt;
          const pt1 = vert1.pt;
          if (pt0 !== pt1 && !pt0.is_neighbour(pt1)) {
            pt0.neighbours.push(pt1);
            pt1.neighbours.push(pt0);
            num_connections++;
          }
        }
      }
    }

    console.info("Read " + polygons.length + " polygons connecting " + num_connections + " lines");
  }

  // Expecting the file to start with FORM and then LWO2 (the format)
  {
    if ((tag = read_string(4)) != "FORM")
      throw new Error("Not a LWO2 file");
    endpos = 4 + read_uint32();
    if ((tag = read_string(4)) != "LWO2")
      throw new Error("Not a LWO2 file. Type: " + tag);
  }

  var loopcnt = 0;
  var lastPNTS = null;
  var unique_points = {};
  var all_points = [];
  while (pos < endpos) {
    // Read next chunk
    var chunk_tag = read_string(4);
    var chunk_len = read_uint32();
    var end_pos = pos + chunk_len;
    console.info("Parsing tag " + chunk_tag + " length " + chunk_len);
    switch(chunk_tag) {
    case 'PNTS':
        // Vertex points. Will be combined during VMAP/POLS/PTAG
        // Each point has 3x 4 byte floating point numbers
        // As such, chunk len should be dividable by 12.
        if ((chunk_len % 12) != 0) {
          throw new Error("PNTS chunk size invalid: " + chunk_len);
        }
        lastPNTS = read_points(chunk_len / 12, unique_points);
        if (lastPNTS && lastPNTS.length > 0) {
          all_points = all_points.concat(lastPNTS)
        }
        break;
    case 'VMAP':
        read_vertex_map(lastPNTS, end_pos);
        break;
    case 'POLS':
        read_polygons(lastPNTS, end_pos);
        break;
    default:
      // Unknown tag type. Skip it.
      break;
    }

    // Move position to beyond the chunk end
    pos = end_pos;
    if (chunk_len & 0x1)
      pos++;

    if (++loopcnt > 1000)
      throw new Error("Too many loops");
  }

  if (all_points.length == 0)
    throw new Error("No points decoded");

  // Identify un-connected island groups of tracks in the results
  // Start with the start point, then find a point that hasn't been
  // visited yet for optional additional tracks.
  this.tracks = [];
  visited_points = new Set();
  for (const start_point of all_points) {
    if (visited_points.has(start_point.xyz)) {
      continue;
    }

    const track = new Track();
    track.decode_rings(start_point);
    this.tracks.push(track);

    for (const ring of track.rings) {
      for (const pt of ring.points) {
        visited_points.add(pt.xyz);
      }
    }
  }
}
