// AcidSquares - 基于 OGL 库的 WebGL 背景（纯 JS 实现）
// 功能：酸性晶格效果 + 鼠标交互 + 后处理模糊 + 胶片颗粒

// 使用 CDN 导入 OGL（兼容浏览器 ES Modules）
import { Renderer, Program, Mesh, Triangle, RenderTarget } from 'https://esm.sh/ogl@1.0.8';

const hexToRgb = (hex) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [1, 1, 1];
  return [
    parseInt(result[1], 16) / 255,
    parseInt(result[2], 16) / 255,
    parseInt(result[3], 16) / 255
  ];
};

const DETAIL_STEPS = { low: 20, medium: 32, high: 48 };
const stepsFor = (detail) => DETAIL_STEPS[detail] || DETAIL_STEPS.medium;

// Vertex Shader
const vertex = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

// Main Fragment Shader (Raymarching)
const fragment = `#version 300 es
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform float uSpeed;
uniform float uWaveDepth;
uniform float uZoom;
uniform float uDensity;
uniform float uSpread;
uniform float uStepSize;
uniform float uGlow;
uniform float uExposure;
uniform float uColorShift;
uniform float uContrast;
uniform float uBrightness;
uniform float uOpacity;
uniform float uSteps;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform vec2 uMouse;
uniform float uMouseStrength;
uniform float uMouseRadius;
uniform float uEnableMouse;
uniform float uMouseActive;
uniform float uGrain;
uniform float uGrainIntensity;
out vec4 fragColor;

void main() {
  vec2 frag = gl_FragCoord.xy;
  float zoom = max(uZoom, 0.05);
  float aspect = iResolution.x / iResolution.y;
  vec2 ndc = (2.0 * frag - iResolution.xy) / iResolution.y;
  vec2 dir = ndc * (0.5 / zoom);

  // 鼠标交互
  vec2 mouseNdc = vec2(uMouse.x * aspect, uMouse.y);
  float mr = max(uMouseRadius, 0.01);
  vec2 md = ndc - mouseNdc;
  float dent = exp(-dot(md, md) / (mr * mr)) * (3.0 * uMouseStrength * uEnableMouse * uMouseActive);

  float travel = sin(iTime * uSpeed) * uWaveDepth;
  float density = max(uDensity, 1.0);
  float spread = clamp(uSpread, 0.05, 0.6);
  float stepSize = max(uStepSize, 0.0005);
  float glowGain = max(uGlow, 0.0);

  vec3 tOffset = vec3(0.0, dent, travel);
  vec3 p = vec3(0.0);
  float s = 0.0;
  float glow = 0.0;

  for (int i = 0; i < 64; i++) {
    if (float(i) >= uSteps) break;
    p += vec3(dir * s, s);
    vec3 q = p + tOffset;
    s += density - length(q.xz) + length(ceil(q).xy);
    s = stepSize + abs(s) * spread;
    glow += glowGain / s;
  }

  float e = glow / max(uExposure, 1.0);
  float shimmer = 0.5 + 0.5 * dot(cos(iTime * uColorShift + p), vec3(0.3333));
  float v = tanh(e * uBrightness * mix(0.7, 1.05, shimmer));
  v = clamp((v - 0.5) * uContrast + 0.5, 0.0, 1.0);

  vec3 col = mix(uColor1, uColor2, smoothstep(0.0, 0.55, v));
  col = mix(col, uColor3, smoothstep(0.55, 1.0, v));
  col *= v;

  float a = clamp(v, 0.0, 1.0) * uOpacity;
  vec3 outRgb = col * a;

  if (uGrain > 0.5) {
    float gv = (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + iTime) * 43758.5453) - 0.5) * uGrainIntensity;
    outRgb = clamp(outRgb + gv, 0.0, 1.0);
    a = clamp(a + gv, 0.0, 1.0);
  }
  fragColor = vec4(outRgb, a);
}
`;

// Post-processing Fragment Shader (Gaussian Blur)
const postFragment = `#version 300 es
precision highp float;
uniform sampler2D tMap;
uniform vec2 iResolution;
uniform vec2 uDirection;
uniform float uRadius;
uniform float uGrain;
uniform float uGrainIntensity;
uniform float iTime;
out vec4 fragColor;

vec4 samp(vec2 uv) {
  return texture(tMap, uv);
}

void main() {
  vec2 uv = gl_FragCoord.xy / iResolution;
  vec2 texel = uDirection / iResolution;
  float st = uRadius * 0.25;
  vec4 sum = samp(uv) * 0.2026;
  sum += (samp(uv + texel * st) + samp(uv - texel * st)) * 0.179;
  sum += (samp(uv + texel * (st * 2.0)) + samp(uv - texel * (st * 2.0))) * 0.124;
  sum += (samp(uv + texel * (st * 3.0)) + samp(uv - texel * (st * 3.0))) * 0.0672;
  sum += (samp(uv + texel * (st * 4.0)) + samp(uv - texel * (st * 4.0))) * 0.0285;
  vec4 col = sum;
  if (uGrain > 0.5) {
    float gv = (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + iTime) * 43758.5453) - 0.5) * uGrainIntensity;
    col.rgb = clamp(col.rgb + gv, 0.0, 1.0);
    col.a = clamp(col.a + gv, 0.0, 1.0);
  }
  fragColor = col;
}
`;

export default function initAcidSquares(container, options = {}) {
  // 默认配置
  const props = {
    color1: '#12082b',
    color2: '#3b1f8e',
    color3: '#a78bfa',
    detail: 'medium',
    speed: 0.7,
    waveDepth: 1,
    zoom: 1.3,
    density: 10.0,
    glow: 1.2,
    exposure: 1800,
    spread: 0.28,
    stepSize: 0.002,
    colorShift: 0.08,
    contrast: 1.25,
    brightness: 1.3,
    opacity: 0.9,
    mouseInteraction: true,
    mouseStrength: 0.5,
    mouseRadius: 0.4,
    blur: 0,
    grain: true,
    grainIntensity: 0.03,
    ...options
  };

  // 创建 Renderer（尝试 WebGL 2，不支持则回退到 WebGL 1）
  let renderer;
  try {
    renderer = new Renderer({
      webgl: 2,
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      dpr: Math.min(window.devicePixelRatio || 1, 2)
    });
  } catch (e) {
    console.warn('[AcidSquares] WebGL 2 not supported, falling back to WebGL 1');
    renderer = new Renderer({
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      dpr: Math.min(window.devicePixelRatio || 1, 2)
    });
  }

  const gl = renderer.gl;
  gl.clearColor(0, 0, 0, 0);

  const canvas = gl.canvas;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  canvas.style.position = 'absolute';
  canvas.style.top = '0';
  canvas.style.left = '0';
  container.appendChild(canvas);

  console.log('[AcidSquares] Canvas created:', canvas.width, 'x', canvas.height);
  console.log('[AcidSquares] Container size:', container.clientWidth, 'x', container.clientHeight);

  // 创建全屏三角形几何体
  const geometry = new Triangle(gl);

  // 主渲染程序
  const program = new Program(gl, {
    vertex,
    fragment,
    uniforms: {
      iTime: { value: 0 },
      iResolution: { value: new Float32Array([1, 1]) },
      uSpeed: { value: props.speed },
      uWaveDepth: { value: props.waveDepth },
      uZoom: { value: props.zoom },
      uDensity: { value: props.density },
      uSpread: { value: props.spread },
      uStepSize: { value: props.stepSize },
      uGlow: { value: props.glow },
      uExposure: { value: props.exposure },
      uColorShift: { value: props.colorShift },
      uContrast: { value: props.contrast },
      uBrightness: { value: props.brightness },
      uOpacity: { value: props.opacity },
      uSteps: { value: stepsFor(props.detail) },
      uColor1: { value: new Float32Array(hexToRgb(props.color1)) },
      uColor2: { value: new Float32Array(hexToRgb(props.color2)) },
      uColor3: { value: new Float32Array(hexToRgb(props.color3)) },
      uMouse: { value: new Float32Array([0, 0]) },
      uMouseStrength: { value: props.mouseStrength },
      uMouseRadius: { value: props.mouseRadius },
      uEnableMouse: { value: props.mouseInteraction ? 1.0 : 0.0 },
      uMouseActive: { value: 0.0 },
      uGrain: { value: props.grain ? 1.0 : 0.0 },
      uGrainIntensity: { value: props.grainIntensity }
    }
  });

  const mesh = new Mesh(gl, { geometry, program });

  // 后处理程序（高斯模糊）
  const postProgram = new Program(gl, {
    vertex,
    fragment: postFragment,
    uniforms: {
      tMap: { value: null },
      iResolution: { value: new Float32Array([1, 1]) },
      uDirection: { value: new Float32Array([1, 0]) },
      uRadius: { value: 0 },
      uGrain: { value: 0 },
      uGrainIntensity: { value: props.grainIntensity },
      iTime: { value: 0 }
    }
  });
  const postMesh = new Mesh(gl, { geometry, program: postProgram });

  // 渲染目标（用于后处理）
  let rtA = null;
  let rtB = null;

  const ensureTargets = () => {
    if (!rtA) {
      const bw = gl.drawingBufferWidth;
      const bh = gl.drawingBufferHeight;
      rtA = new RenderTarget(gl, { width: bw, height: bh, depth: false });
      rtB = new RenderTarget(gl, { width: bw, height: bh, depth: false });
    }
  };

  // 渲染帧
  const renderFrame = () => {
    const grainOn = props.grain ? 1.0 : 0.0;
    const grainAmt = props.grainIntensity;
    program.uniforms.uGrainIntensity.value = grainAmt;
    postProgram.uniforms.uGrainIntensity.value = grainAmt;

    if (props.blur > 0) {
      ensureTargets();
      // 渲染到 rtA（无颗粒）
      program.uniforms.uGrain.value = 0.0;
      renderer.render({ scene: mesh, target: rtA });

      // 水平模糊 -> rtB
      const pu = postProgram.uniforms;
      pu.uRadius.value = props.blur * 14.0;
      pu.tMap.value = rtA.texture;
      pu.uDirection.value[0] = 1;
      pu.uDirection.value[1] = 0;
      pu.uGrain.value = 0.0;
      renderer.render({ scene: postMesh, target: rtB });

      // 垂直模糊 -> 屏幕（带颗粒）
      pu.tMap.value = rtB.texture;
      pu.uDirection.value[0] = 0;
      pu.uDirection.value[1] = 1;
      pu.uGrain.value = grainOn;
      renderer.render({ scene: postMesh });
    } else {
      // 直接渲染（带颗粒）
      program.uniforms.uGrain.value = grainOn;
      renderer.render({ scene: mesh });
    }
  };

  // 设置尺寸
  const setSize = () => {
    const rect = container.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    renderer.setSize(w, h);

    const bw = gl.drawingBufferWidth;
    const bh = gl.drawingBufferHeight;

    const res = program.uniforms.iResolution.value;
    res[0] = bw;
    res[1] = bh;

    const pres = postProgram.uniforms.iResolution.value;
    pres[0] = bw;
    pres[1] = bh;

    if (rtA) {
      rtA.setSize(bw, bh);
      rtB.setSize(bw, bh);
    }

    renderFrame();
  };

  // 鼠标状态
  const mouseTarget = [0, 0];
  const mouseCurrent = [0, 0];
  let mouseActive = 0;
  let mouseActiveTarget = 0;

  // 动画循环
  let raf = 0;
  let isVisible = true;
  let isPageVisible = !document.hidden;
  const t0 = performance.now();

  const loop = (t) => {
    program.uniforms.iTime.value = (t - t0) * 0.001;

    // 增强平滑鼠标跟随（使用弹性缓动）
    const cur = mouseCurrent;
    const tgt = mouseTarget;
    const easing = 0.08; // 更快的响应速度
    cur[0] += easing * (tgt[0] - cur[0]);
    cur[1] += easing * (tgt[1] - cur[1]);

    const m = program.uniforms.uMouse.value;
    m[0] = cur[0];
    m[1] = cur[1];

    const activeTarget = props.mouseInteraction ? mouseActiveTarget : 0;
    mouseActive += 0.08 * (activeTarget - mouseActive); // 更快的激活/淡出过渡
    program.uniforms.uMouseActive.value = mouseActive;
    program.uniforms.uEnableMouse.value = props.mouseInteraction ? 1.0 : 0.0;
    program.uniforms.uMouseStrength.value = props.mouseStrength;

    postProgram.uniforms.iTime.value = program.uniforms.iTime.value;

    renderFrame();
    raf = requestAnimationFrame(loop);
  };

  const tryStart = () => {
    if (isVisible && isPageVisible && raf === 0) {
      raf = requestAnimationFrame(loop);
    }
  };

  const tryStop = () => {
    if (raf !== 0) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  // 鼠标事件
  const handleMouseMove = (e) => {
    const rect = container.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width - 0.5) * 2.0;
    const y = -((e.clientY - rect.top) / rect.height - 0.5) * 2.0;
    mouseTarget[0] = x;
    mouseTarget[1] = y;
    mouseActiveTarget = 1;
  };

  const handleMouseLeave = () => {
    mouseActiveTarget = 0;
  };

  container.addEventListener('mousemove', handleMouseMove);
  container.addEventListener('mouseleave', handleMouseLeave);

  // ResizeObserver
  const ro = new ResizeObserver(setSize);
  ro.observe(container);
  setSize();

  // IntersectionObserver
  const io = new IntersectionObserver(
    ([entry]) => {
      isVisible = entry.isIntersecting;
      isVisible ? tryStart() : tryStop();
    },
    { threshold: 0 }
  );
  io.observe(container);

  // 页面可见性
  const onVisibility = () => {
    isPageVisible = !document.hidden;
    isPageVisible ? tryStart() : tryStop();
  };
  document.addEventListener('visibilitychange', onVisibility);

  tryStart();

  console.log('[AcidSquares] Initialized with OGL');

  // 返回控制接口
  return {
    update(newProps) {
      Object.assign(props, newProps);

      const u = program.uniforms;
      u.uSpeed.value = props.speed;
      u.uWaveDepth.value = props.waveDepth;
      u.uZoom.value = props.zoom;
      u.uDensity.value = props.density;
      u.uSpread.value = props.spread;
      u.uStepSize.value = props.stepSize;
      u.uGlow.value = props.glow;
      u.uExposure.value = props.exposure;
      u.uColorShift.value = props.colorShift;
      u.uContrast.value = props.contrast;
      u.uBrightness.value = props.brightness;
      u.uOpacity.value = props.opacity;
      u.uSteps.value = stepsFor(props.detail);
      u.uMouseRadius.value = props.mouseRadius;

      const c1 = hexToRgb(props.color1);
      const a1 = u.uColor1.value;
      a1[0] = c1[0]; a1[1] = c1[1]; a1[2] = c1[2];

      const c2 = hexToRgb(props.color2);
      const a2 = u.uColor2.value;
      a2[0] = c2[0]; a2[1] = c2[1]; a2[2] = c2[2];

      const c3 = hexToRgb(props.color3);
      const a3 = u.uColor3.value;
      a3[0] = c3[0]; a3[1] = c3[1]; a3[2] = c3[2];
    },

    destroy() {
      tryStop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      container.removeEventListener('mousemove', handleMouseMove);
      container.removeEventListener('mouseleave', handleMouseLeave);

      if (rtA) {
        gl.deleteFramebuffer(rtA.buffer);
        gl.deleteFramebuffer(rtB.buffer);
        rtA.textures.forEach((tex) => gl.deleteTexture(tex.texture));
        rtB.textures.forEach((tex) => gl.deleteTexture(tex.texture));
      }

      try {
        container.removeChild(canvas);
      } catch {}

      gl.getExtension('WEBGL_lose_context')?.loseContext();
      console.log('[AcidSquares] Destroyed');
    }
  };
}
