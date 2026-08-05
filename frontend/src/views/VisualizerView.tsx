import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Mode = "tiles" | "tiles2" | "orbit" | "plasma" | "scope";
type AudioSampleBuffer = Float32Array<ArrayBuffer>;

const BASE_BANDS = 40;
const MAX_ANALYSIS_BANDS = 96;
const MAX_BANDS = 220;
const MIN_FREQ = 40;
const MAX_FREQ = 18_160;
const LABELS = ["40Hz", "75Hz", "140Hz", "260Hz", "500Hz", "1k", "2k", "4k", "8k", "18k"];
const OG_LABEL_FREQS: [number, string][] = [
  [40, "40"],
  [75, "75"],
  [141, "141"],
  [264, "264"],
  [494, "494"],
  [925, "925"],
  [1731, "1.7k"],
  [3241, "3.2k"],
  [6062, "6k"],
  [11349, "11k"],
  [18160, "18k"],
];

function clamp(v: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, v));
}

function freqsForCount(count: number) {
  if (count <= 1) return [MIN_FREQ];
  const ratio = MAX_FREQ / MIN_FREQ;
  return Array.from({ length: count }, (_, i) => MIN_FREQ * (ratio ** (i / (count - 1))));
}

function resample(values: number[], count: number, floor = 0) {
  if (values.length === count) return values.slice();
  if (count <= 1) return [values[0] ?? floor];
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const p = (i / (count - 1)) * Math.max(0, values.length - 1);
    const j = Math.floor(p);
    const t = p - j;
    out.push((values[j] ?? floor) * (1 - t) + (values[j + 1] ?? values[j] ?? floor) * t);
  }
  return out;
}

function soften(values: number[], passes = 1) {
  let result = values.slice();
  for (let p = 0; p < passes; p++) {
    const prev = result;
    result = prev.map((v, i) => (prev[Math.max(0, i - 1)] * 0.24) + (v * 0.52) + (prev[Math.min(prev.length - 1, i + 1)] * 0.24));
  }
  return result;
}

function goertzel(samples: ArrayLike<number>, sampleRate: number, freq: number) {
  const n = samples.length;
  const k = Math.round((n * freq) / sampleRate);
  const omega = (2 * Math.PI * k) / n;
  const coeff = 2 * Math.cos(omega);
  let q0 = 0, q1 = 0, q2 = 0;
  for (let i = 0; i < n; i++) {
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, n - 1));
    q0 = coeff * q1 - q2 + samples[i] * window;
    q2 = q1;
    q1 = q0;
  }
  return Math.sqrt(q1 * q1 + q2 * q2 - q1 * q2 * coeff) / n;
}

function barColor(i: number, n: number) {
  return `hsl(${Math.round((i / Math.max(1, n - 1)) * 281)}, 84%, 58%)`;
}

function labelIndicesForCount(count: number) {
  const freqs = freqsForCount(count);
  const labels = new Map<number, string>();
  for (const [target, label] of OG_LABEL_FREQS) {
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < freqs.length; i++) {
      const distance = Math.abs(Math.log(freqs[i] / target));
      if (distance < bestDistance) {
        best = i;
        bestDistance = distance;
      }
    }
    labels.set(best, label);
  }
  return labels;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function ringPath(ctx: CanvasRenderingContext2D, points: [number, number][]) {
  if (points.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 0; i < points.length; i++) {
    const p0 = points[(i - 1 + points.length) % points.length];
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const p3 = points[(i + 2) % points.length];
    ctx.bezierCurveTo(
      p1[0] + (p2[0] - p0[0]) / 6,
      p1[1] + (p2[1] - p0[1]) / 6,
      p2[0] - (p3[0] - p1[0]) / 6,
      p2[1] - (p3[1] - p1[1]) / 6,
      p2[0],
      p2[1],
    );
  }
  ctx.closePath();
}

const PLASMA_VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const PLASMA_FRAG = `
precision mediump float;
uniform float u_time;
uniform float u_bass;
uniform float u_mid;
uniform float u_treble;
uniform vec2 u_res;

void main() {
  vec2 uv = (gl_FragCoord.xy / u_res - 0.5);
  uv.x *= u_res.x / u_res.y;

  float t   = u_time;
  float sc  = 6.0 + u_bass * 5.0;

  float v = 0.0;
  v += sin(uv.x * sc + t * 1.10);
  v += sin(uv.y * sc * 0.8 + t * 0.85);
  v += sin((uv.x + uv.y) * sc * 0.65 + t * 1.30);
  float d = length(uv);
  v += sin(d * sc * 1.6 - t * 2.1 + u_mid * 3.5);
  v += sin(uv.x * sc * 1.8 * (1.0 + u_treble * 0.6) + t * 1.7) * 0.6;

  v /= 4.6;

  // Cosine palette — cycles through hue as v changes
  vec3 col = 0.5 + 0.5 * cos(6.28318 * (v + vec3(0.0, 0.33, 0.67) + t * 0.04));

  // Bass: bright centre flare
  float flare = exp(-d * d * (5.0 - u_bass * 3.5)) * u_bass;
  col += flare * vec3(1.0, 0.65, 0.3);

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

export function VisualizerView() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef(performance.now());
  const dataRef = useRef<AudioSampleBuffer | null>(null);
  const barsRef = useRef<number[]>(Array(BASE_BANDS).fill(0));
  const targetsRef = useRef<number[]>(Array(BASE_BANDS).fill(0));
  const peaksRef = useRef<number[]>(Array(BASE_BANDS).fill(0));
  const gainsRef = useRef<number[]>(Array(BASE_BANDS).fill(0.003));
  const orbitRef = useRef(0);
  const scopeWaveRef = useRef<Float32Array | null>(null);
  const glCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const glProgramRef = useRef<WebGLProgram | null>(null);
  const glRafRef = useRef<number | null>(null);
  const glStartRef = useRef(0);
  const glUniRef = useRef<Record<string, WebGLUniformLocation | null>>({});
  const [mode, setMode] = useState<Mode>("tiles");
  const [running, setRunning] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [, setStatus] = useState("Idle");
  const modeRef = useRef<Mode>(mode);
  modeRef.current = mode;

  const isPopout = useMemo(() => new URLSearchParams(window.location.search).get("popout") === "1", []);
  const [headerVisible, setHeaderVisible] = useState(true);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const all = await navigator.mediaDevices.enumerateDevices();
    const inputs = all.filter(d => d.kind === "audioinput");
    setDevices(inputs);
    setDeviceId(current => current || inputs[0]?.deviceId || "");
  }, []);

  const stopGL = useCallback(() => {
    if (glRafRef.current !== null) cancelAnimationFrame(glRafRef.current);
    glRafRef.current = null;
  }, []);

  const drawGL = useCallback(() => {
    const gl = glRef.current;
    const prog = glProgramRef.current;
    const canvas = glCanvasRef.current;
    if (!gl || !prog || !canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h);
    }

    const bars = barsRef.current;
    const n = bars.length;
    if (n > 0) {
      const b = Math.floor(n * 0.12), m = Math.floor(n * 0.55);
      const bass   = bars.slice(0, b).reduce((a, v) => a + v, 0) / b;
      const mid    = bars.slice(b, m).reduce((a, v) => a + v, 0) / (m - b);
      const treble = bars.slice(m).reduce((a, v) => a + v, 0) / (n - m);
      const t = (performance.now() - glStartRef.current) / 1000;
      const u = glUniRef.current;
      gl.useProgram(prog);
      gl.uniform1f(u.time!, t);
      gl.uniform1f(u.bass!, bass);
      gl.uniform1f(u.mid!, mid);
      gl.uniform1f(u.treble!, treble);
      gl.uniform2f(u.res!, w, h);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    glRafRef.current = requestAnimationFrame(drawGL);
  }, []);

  const initGL = useCallback(() => {
    const canvas = glCanvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl");
    if (!gl) return;
    glRef.current = gl;

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s); return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, PLASMA_VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, PLASMA_FRAG));
    gl.linkProgram(prog);
    glProgramRef.current = prog;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    glUniRef.current = {
      time: gl.getUniformLocation(prog, "u_time"),
      bass: gl.getUniformLocation(prog, "u_bass"),
      mid:  gl.getUniformLocation(prog, "u_mid"),
      treble: gl.getUniformLocation(prog, "u_treble"),
      res:  gl.getUniformLocation(prog, "u_res"),
    };
    glStartRef.current = performance.now();
    drawGL();
  }, [drawGL]);

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    stopGL();
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    void audioRef.current?.close();
    audioRef.current = null;
    analyserRef.current = null;
    dataRef.current = null;
    setRunning(false);
    setStatus("Idle");
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const analyser = analyserRef.current;
    if (!canvas || !ctx || !analyser) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const width = rect.width;
    const height = rect.height;
    const now = performance.now();
    const frame = Math.min(2.5, Math.max(1, (now - lastFrameRef.current) / 16.6667));
    lastFrameRef.current = now;

    const compactTiles2 = modeRef.current === "tiles2" && isPopout;
    let bandCount = BASE_BANDS;
    if (modeRef.current === "tiles") {
      bandCount = Math.max(BASE_BANDS, Math.min(MAX_BANDS, Math.round(width / 7 / 4) * 4));
    } else if (compactTiles2) {
      const padX = 7;
      const top = 16;
      const boundsH = Math.max(0, height - top - 4);
      const innerPad = Math.min(14, Math.max(3, boundsH * 0.035));
      const maxBarH = boundsH - innerPad * 2;
      const targetRows = boundsH < 170 ? 26 : 30;
      const segTotal = Math.max(2.4, Math.min(12, maxBarH / targetRows));
      const segH = segTotal * 0.75;
      const gap = Math.max(2, Math.min(4, (width - padX * 2) / 240));
      const desired = Math.round((width - padX * 2 + gap) / (segH + gap));
      bandCount = Math.max(BASE_BANDS, Math.min(MAX_BANDS, Math.round(desired / 4) * 4));
    }
    if (barsRef.current.length !== bandCount) {
      barsRef.current = resample(barsRef.current, bandCount);
      targetsRef.current = resample(targetsRef.current, bandCount);
      peaksRef.current = resample(peaksRef.current, bandCount);
      gainsRef.current = resample(gainsRef.current, bandCount, 0.003);
    }

    const sampleCount = analyser.fftSize;
    if (!dataRef.current || dataRef.current.length !== sampleCount) dataRef.current = new Float32Array(sampleCount);
    analyser.getFloatTimeDomainData(dataRef.current);
    const analysis = Math.min(bandCount, MAX_ANALYSIS_BANDS);
    const freqs = freqsForCount(analysis);
    const computed = freqs.map((freq, i) => {
      const t = i / Math.max(1, analysis - 1);
      const v = goertzel(dataRef.current!, audioRef.current?.sampleRate ?? 44_100, freq) * (1 + t * 3);
      const headroom = 1.6 - t * 0.7;
      gainsRef.current[i] = Math.max(gainsRef.current[i] * 0.993 + v * 0.007 * headroom, 0.002);
      return clamp((v / gainsRef.current[i]) ** 0.62);
    });
    targetsRef.current = analysis === bandCount ? computed : resample(computed, bandCount);

    for (let i = 0; i < bandCount; i++) {
      const target = targetsRef.current[i] * (0.962 ** frame);
      const current = barsRef.current[i];
      const attack = target > current ? 0.40 : 0.044;
      const value = current + (target - current) * Math.min(1, attack * frame);
      barsRef.current[i] = value;
      peaksRef.current[i] = value >= peaksRef.current[i] ? value : Math.max(0, peaksRef.current[i] - 0.0065 * frame);
      targetsRef.current[i] = target;
    }

    if (modeRef.current === "plasma") {
      rafRef.current = requestAnimationFrame(draw);
      return;
    }

    if (modeRef.current === "scope") {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#060609";
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = "rgba(255,255,255,0.03)";
      ctx.lineWidth = 1;
      for (const frac of [0.25, 0.5, 0.75]) {
        ctx.beginPath(); ctx.moveTo(0, height * frac); ctx.lineTo(width, height * frac); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(width * frac, 0); ctx.lineTo(width * frac, height); ctx.stroke();
      }
      ctx.strokeStyle = "rgba(0,225,160,0.07)";
      ctx.beginPath(); ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2); ctx.stroke();

      if (dataRef.current) {
        const raw = dataRef.current;
        // Temporal smoothing — 78% previous frame, 22% current
        if (!scopeWaveRef.current || scopeWaveRef.current.length !== raw.length) {
          scopeWaveRef.current = new Float32Array(raw);
        } else {
          for (let i = 0; i < raw.length; i++) {
            scopeWaveRef.current[i] = scopeWaveRef.current[i] * 0.78 + raw[i] * 0.22;
          }
        }
        const wave = scopeWaveRef.current;
        // Draw every 4th sample for a cleaner line
        const step = 4;
        const n = Math.floor(wave.length / step);
        const drawWave = (lw: number, alpha: number) => {
          ctx.beginPath();
          for (let i = 0; i < n; i++) {
            const x = (i / (n - 1)) * width;
            const y = height / 2 - wave[i * step] * height * 0.42;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          }
          ctx.strokeStyle = `rgba(0,225,160,${alpha})`;
          ctx.lineWidth = lw;
          ctx.lineJoin = "round";
          ctx.stroke();
        };
        drawWave(16, 0.02);
        drawWave(7, 0.07);
        drawWave(2.5, 0.5);
        drawWave(1.2, 1.0);
      }
      rafRef.current = requestAnimationFrame(draw);
      return;
    }

    ctx.clearRect(0, 0, width, height);
    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, "#090909");
    bg.addColorStop(1, "#121212");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    const bounds = { x: 28, y: 26, w: width - 56, h: height - 66 };
    if (modeRef.current !== "tiles2") {
      const panel = ctx.createLinearGradient(0, bounds.y, 0, bounds.y + bounds.h);
      panel.addColorStop(0, "#0e0e0e");
      panel.addColorStop(1, "#080808");
      ctx.fillStyle = panel;
      roundedRect(ctx, bounds.x, bounds.y, bounds.w, bounds.h, 10);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    if (modeRef.current === "orbit") {
      orbitRef.current = (orbitRef.current + 0.20 * frame) % 360;
      const cx = bounds.x + bounds.w / 2;
      const cy = bounds.y + bounds.h / 2;
      const rAvail = Math.min(bounds.w, bounds.h) * 0.48;
      const rBase = rAvail * 0.54;
      const rAmp = rAvail * 0.42;
      const smooth = soften(resample(barsRef.current, BASE_BANDS), 2);
      const peak = soften(resample(peaksRef.current, BASE_BANDS), 2);
      const values = smooth.concat([...smooth].reverse());
      const peakValues = peak.concat([...peak].reverse());
      const avg = smooth.reduce((a, b) => a + b, 0) / smooth.length;
      const bass = smooth.slice(0, 7).reduce((a, b) => a + b, 0) / 7;
      const start = -Math.PI / 2 + (orbitRef.current * Math.PI) / 180;
      const step = (2 * Math.PI) / values.length;
      const points: [number, number][] = [];
      const peakPoints: [number, number][] = [];
      values.forEach((v, i) => {
        const a = start + i * step;
        points.push([cx + (rBase + v * rAmp) * Math.cos(a), cy + (rBase + v * rAmp) * Math.sin(a)]);
        peakPoints.push([cx + (rBase + peakValues[i] * rAmp) * Math.cos(a), cy + (rBase + peakValues[i] * rAmp) * Math.sin(a)]);
      });
      const fill = ctx.createRadialGradient(cx, cy, rBase * 0.2, cx, cy, rBase + rAmp);
      fill.addColorStop(0, `rgba(8,6,18,${0.10 + avg * 0.12})`);
      fill.addColorStop(0.75, `rgba(16,12,32,${0.22 + avg * 0.26})`);
      fill.addColorStop(1, `rgba(22,16,42,${0.32 + avg * 0.38})`);
      ctx.fillStyle = fill;
      ringPath(ctx, points);
      ctx.fill();
      for (const [lineWidth, alpha] of [[28, avg * 0.17], [15, avg * 0.30], [7, 0.09 + avg * 0.39]] as const) {
        ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
      }
      const grad = ctx.createConicGradient(start, cx, cy);
      ["#ff4060", "#ff7f3f", "#ffd23f", "#7ed957", "#00c9a7", "#4b9fff", "#9b5de5", "#d45fbf", "#ff4060"].forEach((c, i, arr) => {
        grad.addColorStop(i / (arr.length - 1), c);
      });
      ringPath(ctx, points);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2.2 + avg * 3.8;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.stroke();
      ringPath(ctx, peakPoints);
      ctx.strokeStyle = `rgba(255,255,255,${Math.min(0.36, avg * 0.28)})`;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = `rgba(255,255,255,${0.22 + (avg + bass) * 0.32})`;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(2.5, 3 + bass * 14), 0, Math.PI * 2);
      ctx.fill();
    } else if (modeRef.current === "tiles2") {
      const compact = isPopout;
      const labelH = compact ? 0 : 32;
      const padX = compact ? 7 : 28;
      const top = compact ? 16 : 26;
      const bottomPad = compact ? 4 : 8;
      const ogBounds = { x: padX, y: top, w: width - padX * 2, h: height - top - labelH - bottomPad };

      const ogPanel = ctx.createLinearGradient(0, ogBounds.y, 0, ogBounds.y + ogBounds.h);
      ogPanel.addColorStop(0, "#0e0e0e");
      ogPanel.addColorStop(1, "#080808");
      ctx.fillStyle = ogPanel;
      roundedRect(ctx, ogBounds.x, ogBounds.y, ogBounds.w, ogBounds.h, 10);
      ctx.fill();

      if (!compact) {
        ctx.strokeStyle = "rgba(255,255,255,0.063)";
        ctx.lineWidth = 1;
        roundedRect(ctx, ogBounds.x + 0.5, ogBounds.y + 0.5, ogBounds.w - 1, ogBounds.h - 1, 10);
        ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,0.031)";
        for (let i = 1; i < 4; i++) {
          const y = ogBounds.y + ogBounds.h * i / 4;
          ctx.beginPath();
          ctx.moveTo(ogBounds.x + 14, y);
          ctx.lineTo(ogBounds.x + ogBounds.w - 14, y);
          ctx.stroke();
        }
      }

      const gap = compact ? Math.max(2, Math.min(4, ogBounds.w / 240)) : 5;
      const barW = (ogBounds.w - gap * (bandCount - 1)) / bandCount;
      if (barW > 0 && ogBounds.h > 0) {
        const inner = Math.min(14, Math.max(3, ogBounds.h * (compact ? 0.035 : 0.05)));
        const maxBarH = ogBounds.h - inner * 2;
        const targetRows = compact && ogBounds.h < 170 ? 26 : 30;
        const segTotal = Math.max(compact ? 2.4 : 3.5, Math.min(12, maxBarH / targetRows));
        const segH = segTotal * 0.75;
        const segs = Math.max(1, Math.floor(maxBarH / segTotal));
        const radius = Math.min(1.5, segH * 0.4);

        for (let i = 0; i < bandCount; i++) {
          const x = ogBounds.x + i * (barW + gap);
          const color = barColor(i, bandCount);
          const energy = barsRef.current[i];

          for (let s = 0; s < segs; s++) {
            const bottom = ogBounds.y + ogBounds.h - inner - s * segTotal;
            const topY = bottom - segH;
            const frac = (s * segTotal) / maxBarH;

            if (frac < energy) {
              const rel = frac / Math.max(energy, 0.01);
              ctx.filter = rel > 0.86 ? "brightness(1.55)" : rel > 0.70 ? "brightness(1.2)" : "none";
              ctx.fillStyle = color;
            } else {
              ctx.filter = "none";
              ctx.fillStyle = compact ? "#1c1c1c" : "#191919";
            }
            roundedRect(ctx, x, topY, barW, segH, radius);
            ctx.fill();
          }

          ctx.filter = "none";
          if (peaksRef.current[i] > 0.015) {
            ctx.fillStyle = color;
            ctx.filter = "brightness(1.8)";
            const pkY = ogBounds.y + ogBounds.h - inner - peaksRef.current[i] * maxBarH;
            roundedRect(ctx, x, pkY - segH, barW, segH, radius);
            ctx.fill();
            ctx.filter = "none";
          }
        }

        if (!compact) {
          ctx.fillStyle = "#555555";
          ctx.font = "10px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
          ctx.textAlign = "center";
          for (const [idx, label] of labelIndicesForCount(bandCount)) {
            const x = ogBounds.x + idx * (barW + gap) + barW / 2;
            ctx.fillText(label, x, ogBounds.y + ogBounds.h + 17);
          }
        }
      }
    } else {
      ctx.strokeStyle = "rgba(255,255,255,0.03)";
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const y = bounds.y + bounds.h * i / 4;
        ctx.beginPath();
        ctx.moveTo(bounds.x + 14, y);
        ctx.lineTo(bounds.x + bounds.w - 14, y);
        ctx.stroke();
      }
      const gap = 5;
      const barW = Math.max(1, (bounds.w - gap * (bandCount - 1)) / bandCount);
      const inner = Math.min(14, Math.max(3, bounds.h * 0.05));
      const maxBarH = bounds.h - inner * 2;
      const segTotal = Math.max(3.5, Math.min(12, maxBarH / 30));
      const segH = segTotal * 0.75;
      const segs = Math.max(1, Math.floor(maxBarH / segTotal));
      for (let i = 0; i < bandCount; i++) {
        const x = bounds.x + i * (barW + gap);
        const color = barColor(i, bandCount);
        const energy = barsRef.current[i];
        for (let s = 0; s < segs; s++) {
          const bottom = bounds.y + bounds.h - inner - s * segTotal;
          const top = bottom - segH;
          const frac = (s * segTotal) / maxBarH;
          ctx.fillStyle = frac < energy ? color : "#191919";
          roundedRect(ctx, x, top, barW, segH, Math.min(1.5, segH * 0.4));
          ctx.fill();
        }
        if (peaksRef.current[i] > 0.015) {
          ctx.fillStyle = color;
          roundedRect(ctx, x, bounds.y + bounds.h - inner - peaksRef.current[i] * maxBarH - segH, barW, segH, 1.5);
          ctx.fill();
        }
      }
      ctx.fillStyle = "#555";
      ctx.font = "10px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
      ctx.textAlign = "center";
      LABELS.forEach((label, i) => {
        const idx = Math.round((i / (LABELS.length - 1)) * (bandCount - 1));
        ctx.fillText(label, bounds.x + idx * (barW + gap) + barW / 2, bounds.y + bounds.h + 19);
      });
    }

    rafRef.current = requestAnimationFrame(draw);
  }, []);

  const start = useCallback(async () => {
    stop();
    try {
      setStatus("Requesting audio input...");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
      streamRef.current = stream;
      const audio = new AudioContext({ sampleRate: 44_100 });
      const source = audio.createMediaStreamSource(stream);
      const analyser = audio.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0;
      source.connect(analyser);
      audioRef.current = audio;
      analyserRef.current = analyser;
      setRunning(true);
      const label = devices.find(d => d.deviceId === deviceId)?.label || "audio input";
      setStatus(`Listening to ${label}`);
      await refreshDevices();
      lastFrameRef.current = performance.now();
      rafRef.current = requestAnimationFrame(draw);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Audio input failed");
      setRunning(false);
    }
  }, [deviceId, devices, draw, refreshDevices, stop]);

  useEffect(() => {
    void refreshDevices();
    return stop;
  }, [refreshDevices, stop]);

  useEffect(() => {
    if (mode === "plasma" && running) { stopGL(); initGL(); }
    else stopGL();
    return stopGL;
  }, [mode, running, initGL, stopGL]);

  return (
    <section style={{ height: "100%", display: "flex", flexDirection: "column", background: "#0b0b0b", position: "relative" }}>
      {headerVisible && (
        <header style={{
          height: 54,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: isPopout ? "0 18px 0 80px" : "0 18px",
          borderBottom: "1px solid var(--border)",
          background: "rgba(18,18,18,0.92)",
          flexShrink: 0,
        }}>
          <strong style={{ fontSize: 18 }}>Visualizer</strong>
          <select value={mode} onChange={e => setMode(e.target.value as Mode)} style={selectStyle}>
            <option value="tiles">Tiles</option>
            <option value="tiles2">Tiles2</option>
            <option value="orbit">Orbit</option>
            <option value="plasma">Plasma</option>
            <option value="scope">Scope</option>
          </select>
          <button onClick={running ? stop : start} style={{ ...buttonStyle, color: running ? "#ff7474" : "var(--white)" }}>
            {running ? "Stop" : "Start"}
          </button>
          <select value={deviceId} onChange={e => setDeviceId(e.target.value)} style={{ ...selectStyle, minWidth: 220 }}>
            {devices.length === 0 ? <option value="">Default input</option> : devices.map((d, i) => (
              <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Input ${i + 1}`}</option>
            ))}
          </select>
          {!isPopout && (
            <button
              onClick={() => window.open("/visualizer?popout=1", "audiovault-visualizer", "width=760,height=430")}
              style={buttonStyle}
              title="Pop out visualizer"
            >
              Pop out
            </button>
          )}
          {isPopout && (
            <button onClick={() => setHeaderVisible(false)} style={{ ...buttonStyle, padding: "0 8px" }} title="Hide controls">
              ⌃
            </button>
          )}
        </header>
      )}

      <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: mode === "plasma" ? "none" : "block" }} />
        <canvas ref={glCanvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: mode === "plasma" ? "block" : "none" }} />
      </div>

      {isPopout && !headerVisible && (
        <button
          onClick={() => setHeaderVisible(true)}
          title="Show controls"
          style={{
            position: "absolute", top: 8, right: 8,
            background: "rgba(30,30,30,0.75)", border: "1px solid #333",
            borderRadius: 6, color: "var(--white)", fontSize: 12,
            padding: "2px 8px", cursor: "pointer",
          }}
        >
          ⌄
        </button>
      )}
    </section>
  );
}

const buttonStyle: React.CSSProperties = {
  height: 30,
  padding: "0 12px",
  borderRadius: 7,
  border: "1px solid #303030",
  background: "#1c1c1c",
  fontSize: 12,
  fontWeight: 800,
};

const selectStyle: React.CSSProperties = {
  height: 30,
  padding: "0 9px",
  borderRadius: 7,
  border: "1px solid #303030",
  background: "#1c1c1c",
  color: "var(--white)",
  fontSize: 12,
  fontWeight: 700,
};
