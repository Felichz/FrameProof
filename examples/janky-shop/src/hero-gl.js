// The hero: a soft generative backdrop, drawn once with WebGL.
const VERTEX = `attribute vec2 p; varying vec2 uv; void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

function fragment(seed) {
  // A layered noise field: each layer its own constants, so each program is a shader of its own.
  let layers = '';
  for (let k = 0; k < 40; k++) layers += `  v += sin(uv.x * ${(k + seed * 1.7).toFixed(2)} + cos(uv.y * ${(k * 0.9 + 1).toFixed(2)} + v)) * ${(1 / (k + 1)).toFixed(3)};\n`;
  return `precision highp float; varying vec2 uv; uniform float t;
float field(vec2 uv) {
  float v = 0.0;
  for (int i = 0; i < 48; i++) {
    v += sin(uv.x * float(i) * ${(seed + 1).toFixed(1)} + t) * cos(uv.y * float(i) - v) / float(i + 1);
${layers}  }
  return v;
}
void main(){ float f = field(uv * 3.0); gl_FragColor = vec4(0.55 + 0.3 * sin(f), 0.42 + 0.2 * cos(f * 1.3), 0.35 + 0.25 * sin(f * 0.7), 1.0); }`;
}

export function drawHero(canvas) {
  const gl = canvas.getContext('webgl');
  if (!gl) return;
  const programs = [];
  // Looks to pick from, prepared up front.
  for (let seed = 0; seed < 12; seed++) {
    const program = gl.createProgram();
    for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, fragment(seed)]]) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) console.warn(gl.getProgramInfoLog(program));
    programs.push(program);
  }
  const program = programs[new Date().getDate() % programs.length];
  gl.useProgram(program);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.uniform1f(gl.getUniformLocation(program, 't'), 1.3);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
