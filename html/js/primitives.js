
// Get length of vector
function vector_length_sq(xyz) {
  return (xyz[0]*xyz[0] + xyz[1]*xyz[1] + xyz[2]*xyz[2]);
}
function vector_length(xyz) {
  return Math.sqrt(vector_length_sq(xyz));
}

// Subtracts two vectors
function vector_subtract(v0, v1) {
  return [v0[0]-v1[0], v0[1]-v1[1], v0[2]-v1[2]];
}

// Normalizes a vector
function normalize(xyz) {
  var len = vector_length(xyz);
  return [ xyz[0]/len, xyz[1]/len, xyz[2]/len ];
}

// Cross product of two vectors
function cross(xyz0, xyz1) {
  return [ xyz0[1] * xyz1[2] - xyz0[2] * xyz1[1],
           xyz0[2] * xyz1[0] - xyz0[0] * xyz1[2],
           xyz0[0] * xyz1[1] - xyz0[1] * xyz1[0] ];
}

// Stringifies a number (for printing/debug). Handles -0.
function stringify_number(num, num_decimals) {
  if (num === 0.0 && (1/num === -Infinity))
    num = 0.0; // -0 -> 0
  if (num_decimals === undefined)
    num_decimals = 5;
  return num.toFixed(num_decimals);
}

// Stringifies a vector (for printing/debug). Handles -0.
function stringify_vector(xyz) {
  return "{ x=" + stringify_number(xyz[0]) + " y=" +
                  stringify_number(xyz[1]) + " z=" +
                  stringify_number(xyz[2]) + " }";
}


// A single UV coordinate for a polygon a point is part of
function PointUV(pnt_index, uv) {
  this.index = pnt_index;
  this.uv = uv;
}


// A single point in 3D space
function Point(xyz) {
  this.xyz = xyz;
  this.neighbours = [];
  this.uv = []; // PointUV objects. Temporary.
  this.polygons = []; // Polygon objects.
}

Point.prototype.to_string = function() {
  return stringify_vector(this.xyz);
}

Point.prototype.is_neighbour = function(pt) {
  for (const n of this.neighbours) {
    if (n === pt)
      return true;
  }
  return false;
}

Point.prototype.dist = function(pt) {
  return Math.sqrt(this.dist_sq(pt));
}

Point.prototype.dist_sq = function(pt) {
  return vector_length_sq(vector_subtract(this.xyz, pt.xyz));
}

// Reads the texture UV coordinates of this point that is shared
// by one other point as a polygon, connected to the specified
// neighbouring ring.
Point.prototype.find_uv = function(shared_point, shared_ring) {
  for (const poly of this.polygons) {
    var vt_self = poly.find_vertex(this);
    var vt_other = poly.find_vertex(shared_point);
    if (vt_self && vt_other) {
      for (const vert of poly.vertices) {
        if (shared_ring.includes_point(vert.pt))
          return vt_self.uv;
      }
    }
  }
  return null;
}

// Attempts to find the ring of 4 points this point is part of
// Also returns the next-ring iterator, and a previous-ring iterator
// if applicable to this ring.
Point.prototype.find_ring = function() {
  var rings = this.identify_ring_candidates();
  var options = [];
  for (const root_ring of rings) {
    var next_rings = root_ring.find_neighbours();
    if (next_rings.length > 0) {
      var iterators = [];
      for (const next_ring of next_rings) {
        iterators.push(new RingIterator(next_ring, root_ring));
      }
      options.push({
          root: root_ring,
          root_next_rings: next_rings,
          iterators: iterators
      });
    }
  }

  // Try to iterate the rings. Max number of iterations wins.
  // Maximum of 10 iterations, then we give up
  var lim = 10;
  var result = null;
  while (true) {
    // Too many iterations
    if (--lim == 0) {
      return null;
    }

    // All options are invalid
    if (!options || options.length == 0) {
      return null;
    }

    // Single option left, we found it!
    if (options.length == 1) {
      result = options[0];
      break;
    }

    // Iterate all running iterators
    // Remove the option if they reach the end
    for (var i = options.length-1; i >= 0; --i) {
      const option = options[i];
      for (var j = option.iterators.length-1; j >= 0; --j) {
        if (!option.iterators[j].next()) {
          option.iterators.splice(j, 1);
        }
      }
      if (option.iterators.length == 0) {
        options.splice(i, 1);
      }
    }
  }

  // Orient the found ring option upwards using TX UV information
  // If this fails, assume it's upright and use position instead
  if (result.root.align_facing_up(result.root_next_rings)) {
    console.info("Start ring aligned using VMAP TXUV information");
  } else {
    result.root.align_maximum_up();
    console.info("Start ring aligned using Y-coordinate");
  }

  // Orient the ring using forward vector as well
  if (!result.root_next_rings[0].align(result.root))
    return null; // Unexpected
  result.root.align_front(result.root_next_rings[0]);

  // Align previous and next rings with the root ring
  for (var neighbour_ring of result.root_next_rings) {
    if (!neighbour_ring.align(result.root))
      return null; // Unexpected
  }

  // Previous or nah?
  var root = result.root;
  var next_iter = new RingIterator(result.root_next_rings[0], root);
  var previous_iter = null;
  if (result.root_next_rings.length >= 2) {
    previous_iter = new RingIterator(result.root_next_rings[1], root);
  }

  // Got our result!
  return {
    root: result.root,
    iterator_next: next_iter,
    iterator_previous: previous_iter
  }
}

Point.prototype.identify_ring_candidates = function() {
  // Can change start index to properly validate discovery in the
  // middle of the loop. Generally point 0 is of an end-ring.
  const p0 = this;

  var rings = [];
  for (const p1 of p0.neighbours) {
    for (const p2 of p1.neighbours) {
      // Should not already have been picked
      if (p2 === p0)
        continue;

      for (const p3 of p2.neighbours) {
        // Should not already have been picked
        if (p3 === p0 || p3 === p1)
          continue;

        // Should be connected to p0
        if (!p3.is_neighbour(p0))
          continue;

        // Only add if the inverse (p0-p3-p2-p1) wasn't already added
        var added = false;
        for (const ring of rings) {
          if (ring.is_same_points_reversed(p0, p1, p2, p3)) {
            added = true;
            break;
          }
        }
        if (added)
          continue;

        // Add result
        rings.push(new Ring([p0, p1, p2, p3]));
      }
    }
  }

  return rings;
}


// Polygon vertex. Point reference with UV coordinates.
function PolygonVertex(pt, uv) {
  this.pt = pt;
  this.uv = uv;
}

PolygonVertex.find_in_pnts_list = function(pnts, idx) {
  const pt = pnts[idx];
  var uv = null;
  for (const pt_uv of pt.uv) {
    if (pt_uv.index == idx) {
      uv = pt_uv.uv;
      break;
    }
  }
  return new PolygonVertex(pt, uv);
}


// A polygon of 3 points, with the UV coordinates for each point (if available)
function Polygon(vertices) {
  this.vertices = vertices;
}

Polygon.prototype.find_vertex = function(pt) {
  for (const vertex of this.vertices) {
    if (vertex.pt === pt) {
      return vertex;
    }
  }
  return null;
}


// A ring of 4 points in 3D space
function Ring(points) {
  this.points = points;
}

// Stringifies this ring's points
Ring.prototype.to_string = function() {
  return "{\n" + "  " + this.points[0].to_string() + "\n" +
                 "  " + this.points[1].to_string() + "\n" +
                 "  " + this.points[2].to_string() + "\n" +
                 "  " + this.points[3].to_string() + "\n}";
}

Ring.prototype.to_path_string = function() {
  return "{\n" + "  pos   " + stringify_vector(this.pos()) + "\n" +
                 "  up    " + stringify_vector(this.up()) + "\n" +
                 "  front " + stringify_vector(this.front()) + "\n" +
                 "  left  " + stringify_vector(this.left()) + "\n}";
}

// Rotates the points of this ring around one step
// Modifies this ring
Ring.prototype.rotate = function() {
  this.points.push(this.points.shift());
}

// Clones this ring. Not the points.
Ring.prototype.copy = function() {
  return new Ring([...this.points]);
}

// Finds the mid point information
Ring.prototype.pos = function() {
  var p0 = this.points[0].xyz;
  var p1 = this.points[1].xyz;
  var p2 = this.points[2].xyz;
  var p3 = this.points[3].xyz;
  return [ ((p0[0] + p1[0] + p2[0] + p3[0]) / 4),
            ((p0[1] + p1[1] + p2[1] + p3[1]) / 4),
            ((p0[2] + p1[2] + p2[2] + p3[2]) / 4) ];
}

// Finds the top point information
Ring.prototype.top = function() {
  var p0 = this.points[0].xyz;
  var p1 = this.points[1].xyz;
  return new Point([ (p0[0]+p1[0])/2, (p0[1]+p1[1])/2, (p0[2]+p1[2])/2 ]);
}

// Finds the front orientation vector of this ring
Ring.prototype.front = function() {
  return normalize(cross(this.left(), this.up()));
}

// Finds the up orientation vector of this ring
Ring.prototype.up = function() {
  return this.make_dir_vec(0, 3, 1, 2);
}

// Finds the left orientation vector of this ring
Ring.prototype.left = function() {
  return this.make_dir_vec(0, 1, 3, 2);
}

// Finds the orientation of this ring
Ring.prototype.orientation = function() {
  return Quaternion.from_look(this.front(), this.up());
}

// Creates a normalized direction vector using a pair of two points to diff
// The pi values are indices (0-3) of points of this ring
// pi0f is front (into direction) and pi0b is back (away from direction)
Ring.prototype.make_dir_vec = function(pi0f, pi0b, pi1f, pi1b) {
  var p0f = this.points[pi0f].xyz;
  var p0b = this.points[pi0b].xyz;
  var p1f = this.points[pi1f].xyz;
  var p1b = this.points[pi1b].xyz;
  // Sum the offsets
  var dir = [ (((p0f[0] - p0b[0]) + (p1f[0] - p1b[0])) / 2),
              (((p0f[1] - p0b[1]) + (p1f[1] - p1b[1])) / 2),
              (((p0f[2] - p0b[2]) + (p1f[2] - p1b[2])) / 2) ];
  // Normalize the vector
  return normalize(dir);
}

// Checks whether this ring contains a point
Ring.prototype.includes_point = function(pt) {
  return this.points[0] === pt ||
         this.points[1] === pt ||
         this.points[2] === pt ||
         this.points[3] === pt;
}

// Checks whether the input are the same points, but reversed
// Assumes point[0] is identical
Ring.prototype.is_same_points_reversed = function(pt0, pt1, pt2, pt3) {
  return this.points[0] === pt0 &&
         this.points[1] === pt3 &&
         this.points[2] === pt2 &&
         this.points[3] === pt1;
}

// Checks whether this ring and another ring share identical points
// Order of the points does not matter.
// Is used to detect a loop
Ring.prototype.is_same_points = function(other_ring) {
  return this.includes_point(other_ring.points[0]) &&
         this.includes_point(other_ring.points[1]) &&
         this.includes_point(other_ring.points[2]) &&
         this.includes_point(other_ring.points[3]);
}

// Checks that this ring and another ring connect point-to-point
Ring.prototype.is_connected = function(other_ring) {
  return this.points[0].is_neighbour(other_ring.points[0]) &&
         this.points[1].is_neighbour(other_ring.points[1]) &&
         this.points[2].is_neighbour(other_ring.points[2]) &&
         this.points[3].is_neighbour(other_ring.points[3]);
}

// Computes the average distance squared between this and another ring
Ring.prototype.avg_dist_sq = function(other_ring) {
  return (this.points[0].dist_sq(other_ring.points[0]) +
          this.points[1].dist_sq(other_ring.points[1]) +
          this.points[2].dist_sq(other_ring.points[2]) +
          this.points[3].dist_sq(other_ring.points[3])) / 4;
}

// Rotates this ring around so the most up coordinate is facing upwards
// This assumes the track is primarily upright and might not be correct
Ring.prototype.align_maximum_up = function() {
  var best = this.copy();
  var best_top = best.top().xyz[1];
  for (var i = 0; i < 3; i++) {
    this.rotate();
    var top = this.top().xyz[1];
    if (top > best_top) {
      best_top = top;
      best = this.copy();
    }
  }
  this.points = best.points;
}

// Rotates this ring around so that it is facing upwards. This is done by looking
// at the UV coordinates of the side-polygons, which both should be oriented the same
// way. Through testing it was found that the up-facing vertices have TXUV[V] of 1.
//
// After alignment points[0] and points[1] represent the top-face.
// Returns true if alignment was successful
Ring.prototype.align_facing_up = function(neighbour_rings) {
  if (neighbour_rings.length == 0) {
    // No/invalid neighbours, can't find
    return false;
  } else if (neighbour_rings.length == 1) {
    // One neighbour, easy.
    return this.align_facing_up_impl(neighbour_rings[0]);
  } else {
    // Try all neighbours, and all resulting rings should be identical
    var results = [];
    for (const neighbour_ring of neighbour_rings) {
      var copy = this.copy();
      if (!copy.align_facing_up_impl(neighbour_ring))
        return false;
      results.push(copy);
    }
    for (var i = 1; i < results.length; i++) {
      var r0 = results[0].points;
      var r1 = results[i].points;
      if (r0[0] !== r1[0] || r0[1] !== r1[1] ||
          r0[2] !== r1[2] || r0[3] !== r1[3])
      {
        return false;
      }
    }
    this.points = results[0].points;
    return true;
  }
}

Ring.prototype.align_facing_up_impl = function(neighbour_ring) {
  for (var i = 0; i < 4; i++) {
    var uv_l = this.points[0].find_uv(this.points[3], neighbour_ring);
    var uv_r = this.points[1].find_uv(this.points[2], neighbour_ring);
    if (!uv_l || !uv_r) {
      return false; // Missing uv coordinates
    }
    if (uv_l[1] == 1 && uv_r[1] == 1) {
      return true; // The one we want!
    }
    this.rotate();
  }
  return false;
}

// Reverses the points to make the front() vector align with the position
// changes from this ring to the next iterated one. Assumes up-alignment
// was performed correctly previously.
Ring.prototype.align_front = function(next_neighbour) {
  var p0 = this.pos();
  var p1 = next_neighbour.pos();
  var pos_fwd = [ p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2] ];
  var cur_fwd = this.front();
  var dot = ( (pos_fwd[0]*cur_fwd[0]) +
              (pos_fwd[1]*cur_fwd[1]) +
              (pos_fwd[2]*cur_fwd[2]) );
  if (dot < 0.0) {
    // p0 p1 p2 p3 -> p1 p0 p3 p2
    var p = this.points;
    this.points = [p[1], p[0], p[3], p[2]];
  }
}

// Re-organizes this ring of points so that it directly connects
// with another ring. Supports advancing all elements
// in both directions or reversing order. This ring is updated.
Ring.prototype.align = function(ring_with) {
  const reverse_ring = this.copy();
  reverse_ring.points.reverse();

  // Check both forward and reversed rings
  var options = [];
  for (const ring of [this.copy(), reverse_ring]) {
    // Check. Rotate the rings 3 times as well.
    for (var n = 0; n < 4; n++) {
      // Check valid ring connection is possible
      // If so, store a copy
      if (ring_with.is_connected(ring)) {
        options.push(ring.copy());
      }

      // Rotate points around
      ring.rotate();
    }
  }

  if (options.length == 1) {
    this.points = options[0].points;
    return true;
  } else if (options.length > 1) {
    // Multiple options. Pick lowest distance between the ring points.
    // This eliminates the diagonals.
    var best_dist_sq = options[0].avg_dist_sq(ring_with);
    var best = options[0];
    for (var i = 1; i < options.length; i++) {
      var opt = options[i];
      var dist_sq = opt.avg_dist_sq(ring_with);
      if (dist_sq < best_dist_sq) {
        best_dist_sq = dist_sq;
        best = opt;
      }
    }
    this.points = best.points;
    return true;
  } else {
    return false; // Can't align them
  }
}

// Tries to find 1 or 2 connected neighbouring rings
// Returns 0 if the ring is invalid
Ring.prototype.find_neighbours = function(ignore) {
  // Collect all neighbouring points of this ring, except those
  // which are part of the ring to ignore or this ring itself
  var neighbour_points = [];
  for (const pt of this.points) {
    for (const n of pt.neighbours) {
      if (this.points.includes(n))
        continue;
      if (ignore && ignore.points.includes(n))
        continue;
      if (neighbour_points.includes(n))
        continue;
      neighbour_points.push(n);
    }
  }

  // Find the isolated rings these points belong to
  // If the initial ring is valid, this should work fine
  var rings = Ring.multiple_from_points(neighbour_points);
  if (rings.length == 0)
    return [];

  // Now we must rotate the found rings to connect properly to this one
  // Due to diagonal lines there are always two ways of doing this
  // We find the connection with lowest distance to fix this.
  for (var i = 0; i < rings.length; i++) {
    if (!rings[i].align(this))
      return [];
  }

  return rings;
}

// Turns a list of 4 points into a valid ring
// Points are sorted so the elements connect to one another
// Returns null if the 4 points don't make a connected ring
Ring.from_points = function(points) {
  // Check
  if (points.length != 4)
    return null;

  // Create a copy of all the points, and for every point
  // count how many connections to the same list of points
  // exist. The end-ring can have an additional connection
  // between two points along the diagonal. We must make sure
  // that those points can only connect with a neighbour
  // that does not have this.
  var pending = new Array(points.length);
  for (var i = 0; i < points.length; i++) {
    const pt = points[i];
    var num_neighbours = 0;
    for (const n of pt.neighbours) {
      if (points.includes(n))
        num_neighbours++;
    }
    if (num_neighbours != 2 && num_neighbours != 3)
      return null; // Fail early for invalid situations

    pending[i] = {
      pt: pt,
      has_diagonal: (num_neighbours==3)
    };
  }

  // Try to process all pending points in a loop
  var points_sorted = [];
  var last = pending[0];
  points_sorted.push(last.pt);
  pending.splice(0, 1);
  while (true) {
    var failed = true;
    for (var i = pending.length-1; i >= 0; --i) {
      var p = pending[i];
      if (last.has_diagonal && p.has_diagonal)
        continue; // Can't connect two diagonals together
      if (!p.pt.is_neighbour(last.pt))
        continue; // Next point must connect

      // Add point, remove pending
      last = p;
      points_sorted.push(p.pt);
      pending.splice(i, 1);
      failed = false;
    }

    // If all points are added, also check first and last points connect
    if (points_sorted.length == points.length) {
      if (last.pt.is_neighbour(points_sorted[0])) {
        return new Ring(points_sorted);
      } else {
        failed = true; // Fail early.
      }
    }

    // Failure condition
    if (failed)
      return null;
  }
}

// Tries to identify 1 or 2 isolated rings in a pool of points
Ring.multiple_from_points = function(points) {
  if (points.length == 4) {
    // Single ring
    var ring = Ring.from_points(points);
    if (ring)
      return [ring];
  } else if (points.length == 8) {
    // Two rings. Must both be valid and not be connected together.
    var rings_points = [];
    for (const pt of points) {
      var added = false;
      for (const ring_pt_list of rings_points) {
        for (const ring_pt_existing of ring_pt_list) {
          if (pt.is_neighbour(ring_pt_existing)) {
            ring_pt_list.push(pt);
            added = true;
            break;
          }
        }
        if (added)
          break;
      }
      if (!added)
        rings_points.push([pt]);
    }

    // We expect two valid rings
    if (rings_points.length == 2 &&
        rings_points[0].length == 4 &&
        rings_points[1].length == 4)
    {
      var ring_one = Ring.from_points(rings_points[0]);
      var ring_two = Ring.from_points(rings_points[1]);
      if (ring_one && ring_two) {
        return [ring_one, ring_two];
      }
    }
  }

  // Invalid points
  return [];
}


// Iterates rings one by one. Must either start from a dead-end, or know
// the previous ring to ignore
function RingIterator(root, ignore) {
  this.current = root;
  this.ignore = ignore;
}

RingIterator.prototype.next = function() {
  var result = this.current;
  if (!result)
    return null;

  var next_rings = result.find_neighbours(this.ignore);
  this.ignore = result;
  if (next_rings && next_rings.length == 1) {
    this.current = next_rings[0];
  } else {
    console.info("Reached end at " + result.to_string());
    this.current = null; // End reached
  }

  return result;
}


// Stores interpolation metadata between two rings
function RingPair(ring0, ring1, exclude_end) {
  this.pos0 = ring0.pos();
  this.pos1 = ring1.pos();
  this.ori0 = ring0.orientation();
  this.ori1 = ring1.orientation();
  this.distance = vector_length(vector_subtract(this.pos0, this.pos1));
  this.exclude_end = exclude_end;
  this.next = null;
}

RingPair.prototype.interpolate = function(distance_traveled) {
  var t1 = distance_traveled / this.distance;
  var t0 = 1.0 - t1;
  var pos = [ (t0*this.pos0[0] + t1*this.pos1[0]),
              (t0*this.pos0[1] + t1*this.pos1[1]),
              (t0*this.pos0[2] + t1*this.pos1[2]) ];
  var ori = Quaternion.slerp(this.ori0, this.ori1, t1);
  return {
    pos: pos,
    front: ori.front(),
    left: ori.left(),
    up: ori.up()
  };
}

RingPair.prototype.first = function() {
  return {
    pos: this.pos0,
    front: this.ori0.front(),
    left: this.ori0.left(),
    up: this.ori0.up()
  }
}

RingPair.prototype.last = function() {
  return {
    pos: this.pos1,
    front: this.ori1.front(),
    left: this.ori1.left(),
    up: this.ori1.up()
  }
}


// Interpolates between a sequence of rings
function RingInterpolator(start_chain) {
  this.current = start_chain;
  this.first = start_chain.first();
  this.offset = 0.0;
}

RingInterpolator.prototype.next = function(distance) {
  // End of iteration
  if (!this.current) {
    return null;
  }

  var remaining = distance;
  while (true) {
    var new_offset = this.offset + remaining;

    // Interpolate between rings
    if (new_offset < this.current.distance) {
      this.offset = new_offset;
      return this.current.interpolate(new_offset);
    }

    // If current ring is a looped end, we stop here
    // The last point should be excluded (as this is the first point already)
    if (this.current.exclude_end) {
      return null;
    }

    // If there is no next ring, end here and return the last point
    if (!this.current.next) {
      var result = this.current.last();
      this.current = null;
      return result;
    }

    // Moved beyond the current ring, subtract distance
    remaining -= (this.current.distance - this.offset);
    this.current = this.current.next;
    this.offset = 0;
  }
}
