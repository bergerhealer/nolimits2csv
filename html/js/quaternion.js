
function Quaternion(x, y, z, w) {
  this.x = x;
  this.y = y;
  this.z = z;
  this.w = w;
  this.normalize();
}

Quaternion.prototype.normalize = function() {
  var f = 1.0 / Math.sqrt((this.x * this.x) + (this.y * this.y) + (this.z * this.z) + (this.w * this.w));
  this.x *= f;
  this.y *= f;
  this.z *= f;
  this.w *= f;
}

Quaternion.prototype.copy = function() {
  return new Quaternion(this.x, this.y, this.z, this.w);
}

Quaternion.prototype.dot = function(q) {
  return this.x * q.x + this.y * q.y + this.z * q.z + this.w * q.w;
}

Quaternion.prototype.front = function() {
  return [2.0 * (this.x*this.z+this.y*this.w),
          2.0 * (this.y*this.z-this.x*this.w),
          1.0 + 2.0 * (-this.x*this.x-this.y*this.y)];
}

Quaternion.prototype.left = function() {
  return [1.0 + 2.0 * (-this.y*this.y-this.z*this.z),
          2.0 * (this.x*this.y+this.z*this.w),
          2.0 * (this.x*this.z-this.y*this.w)];
}

Quaternion.prototype.up = function() {
  return [2.0 * (this.x*this.y-this.z*this.w),
          1.0 + 2.0 * (-this.x*this.x-this.z*this.z),
          2.0 * (this.y*this.z+this.x*this.w)];
}

// Borrowed from BKCommonLib
Quaternion.from_matrix = function(m) {
  tr = m[0][0] + m[1][1] + m[2][2];
  if (tr > 0) {
    return new Quaternion(m[2][1]-m[1][2], m[0][2]-m[2][0], m[1][0]-m[0][1], 1.0 + tr);
  } else if ((m[0][0] > m[1][1]) & (m[0][0] > m[2][2])) {
    return new Quaternion(1.0+m[0][0]-m[1][1]-m[2][2], m[0][1]+m[1][0], m[0][2]+m[2][0], m[2][1]-m[1][2]);
  } else if (m[1][1] > m[2][2]) {
    return new Quaternion(m[0][1]+m[1][0], 1.0+m[1][1]-m[0][0]-m[2][2], m[1][2]+m[2][1], m[0][2]-m[2][0]);
  } else {
    return new Quaternion(m[0][2]+m[2][0], m[1][2]+m[2][1], 1.0+m[2][2]-m[0][0]-m[1][1], m[1][0]-m[0][1]);
  }
}

// Borrowed from BKCommonLib
Quaternion.from_look = function(dir, up) {
  // If up-vector specified, try to roll the quaternion along it
  if (up) {
    // Use the 3x3 rotation matrix solution found on SO, combined with a getRotation()
    // https://stackoverflow.com/a/18574797

    var D = normalize(dir);
    var S = normalize(cross(up, dir));
    var U = cross(D, S);

    // Make a 4x4 matrix out of it (SUD)
    var M = [ [ S[0], U[0], D[0], 0.0 ],
              [ S[1], U[1], D[1], 0.0 ],
              [ S[2], U[2], D[2], 0.0 ],
              [ 0.0, 0.0, 0.0, 1.0] ];

    // Compute quaternion from this 4x4 matrix again
    var q = Quaternion.from_matrix(M);

    // Fix NaN as a result of dir == up
    if (!isNaN(q.x))
      return q;
  }

  // Use dir only, assume pointing up
  var dir_len = vector_length(dir);
  var q = new Quaternion(-dir[1], dir[0], 0.0, dir[2] + dir_len);
  if (isNaN(q.w)) {
    q.x = 0.0;
    q.y = 1.0;
    q.z = 0.0;
    q.w = 0.0;
  }
  return q;
}

Quaternion.lerp = function(q0, q1, t0, t1) {
  return new Quaternion(t0 * q0.x + t1 * q1.x,
                        t0 * q0.y + t1 * q1.y,
                        t0 * q0.z + t1 * q1.z,
                        t0 * q0.w + t1 * q1.w);
}

// Borrowed from BKCommonLib
Quaternion.slerp = function(q0, q1, theta) {
  var qs = q1.copy();
  var dot = q0.dot(q1);

  // Invert quaternion when dot < 0 to simplify maths
  if (dot < 0.0) {
    dot = -dot;
    qs.x = -qs.x;
    qs.y = -qs.y;
    qs.z = -qs.z;
    qs.w = -qs.w;
  }

  // Above this a lerp is adequate
  if (dot >= 0.95) {
    return Quaternion.lerp(q0, qs, 1.0 - theta, theta);
  }

  // Linear interpolation using sines
  angle = Math.acos(dot);
  qd = 1.0 / Math.sin(angle);
  q0f = qd * Math.sin(angle*(1.0-theta));
  qsf = qd * Math.sin(angle*theta);
  console.warn(q0f, qsf);
  return Quaternion.lerp(q0, qs, q0f, qsf);
}
