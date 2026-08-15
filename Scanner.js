// Scanner - 基于 OGL 库的扫描线效果背景（纯 JS 实现）
// 功能：扫描线动画 + 信号场扭曲 + 鼠标交互 + CRT 效果

import { Renderer, Program, Mesh, Triangle } from 'https://esm.sh/ogl@1.0.8';

const hexToRgb = (hex) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [1, 1, 1];
  return [
    parseInt(result[1], 16) / 255,
    parseInt(result[2], 16) / 255,
    parseInt(result[3], 16) / 255
  ];
};

const directionToFloat = (dir) => {
  if (dir === 'horizontal') return 1.0;
  if (dir === 'diagonal') return 2.0;
  return 0.0;
};

// Vertex Shader
const vertex = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

// Fragment Shader
const fragment = `#version 300 es
precision highp float;

uniform vec2 iResolution;
uniform float iTime;
uniform float uSpeed;
uniform float uSweepSpeed;
uniform float uSweepWidth;
uniform float uSweepFalloff;
uniform float uScale;
uniform float uFrequency;
uniform float uRipple;
uniform float uBandDensity;
uniform float uLineSharpness;
uniform float uGlow;
uniform float uColorSpread;
uniform float uBrightness;
uniform float uContrast;
uniform float uSoftness;
uniform float uVignette;
uniform float uOpacity;
uniform float uScanline;
uniform float uGrain;
uniform float uGrainIntensity;
uniform float uDirection;
uniform vec2 uMouse;
uniform float uMouseEnabled;
uniform float uMouseRadius;
uniform float uMouseStrength;
uniform float uMouseActive;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;

out vec4 fragColor;

const float TAU = 6.2831853;

float signalField(vec2 p, float t) {
  float w = sin(p.x * 1.3 + t * 0.7);
  w += sin(p.y * 1.7 - t * 0.52) * 0.8;
  w += sin((p.x + p.y) * 0.9 + t * 0.91) * 0.6;
  w += sin((p.x - p.y) * 1.53 - t * 0.63) * 0.42;
  return w * 0.35;
}

vec3 palette(float f) {
  f = clamp(f, 0.0, 1.0);
  f = pow(f, uContrast);
  vec3 c = mix(uColor1, uColor2, smoothstep(0.08, 0.6, f));
  return mix(c, uColor3, smoothstep(0.68, 1.0, f));
}

float scanBand(float x, float aa, float sharp) {
  float v = mix(0.5, 0.5 + 0.5 * cos(x * TAU), aa);
  return pow(v, sharp);
}

void main() {
  float aspect = iResolution.x / iResolution.y;
  vec2 uv0 = (gl_FragCoord.xy * 2.0 - iResolution.xy) / iResolution.y;
  vec2 p = uv0 / max(uScale, 0.001);

  float t = iTime * uSpeed;

  // 鼠标交互
  float mouseBoost = 0.0;
  if (uMouseEnabled > 0.5) {
    vec2 mUv = vec2((uMouse.x * 2.0 - 1.0) * aspect, uMouse.y * 2.0 - 1.0);
    vec2 md = uv0 - mUv;
    float r = max(uMouseRadius, 0.001);
    mouseBoost = exp(-dot(md, md) / (r * r)) * uMouseStrength * uMouseActive;
  }

  // 扫描方向
  float axis;
  if (uDirection < 0.5) axis = p.y;
  else if (uDirection < 1.5) axis = p.x;
  else axis = (p.x + p.y) * 0.70710678;

  // 信号场扭曲
  float sig = signalField(p * uFrequency, t);
  float coord = axis + sig * uRipple;

  // 扫描带
  float phase = coord / max(uSweepWidth, 0.05) - t * uSweepSpeed;
  float sweep = pow(0.5 + 0.5 * cos(phase * TAU), max(uSweepFalloff, 0.1));

  // 扫描线密度和抗锯齿
  float lc = coord * uBandDensity;
  float aa = 1.0 / (1.0 + uSoftness * fwidth(lc) * 3.0);
  aa = clamp(aa * (1.0 + mouseBoost * 0.6), 0.0, 1.0);

  // 发光体
  float bodyBase = clamp(0.5 + 0.5 * sig, 0.0, 1.0);
  float body = bodyBase * bodyBase * uGlow * sweep;

  // RGB 分离扫描带
  float sharp = max(uLineSharpness, 0.1);
  float split = uColorSpread * 0.16;
  float fr = clamp(scanBand(lc + split, aa, sharp) * sweep + body, 0.0, 1.0);
  float fg = clamp(scanBand(lc, aa, sharp) * sweep + body, 0.0, 1.0);
  float fb = clamp(scanBand(lc - split, aa, sharp) * sweep + body, 0.0, 1.0);

  // 调色板混合
  vec3 col = vec3(palette(fr).r, palette(fg).g, palette(fb).b);

  // 亮度计算
  float inten = (fr + fg + fb) * 0.3333333 * uBrightness;
  inten *= 1.0 + mouseBoost * 0.9;

  // CRT 扫描线
  if (uScanline > 0.5) {
    inten *= 1.0 - 0.18 * (0.5 + 0.5 * cos(gl_FragCoord.y * 1.7));
  }

  // 胶片颗粒
  if (uGrain > 0.5) {
    float g = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + iTime) * 43758.5453);
    inten += (g - 0.5) * uGrainIntensity;
  }

  // 暗角效果
  inten *= clamp(1.0 - uVignette * smoothstep(0.55, 1.65, length(uv0)), 0.0, 1.0);
  inten = clamp(inten, 0.0, 1.0);

  // 输出
  float a = clamp(inten * uOpacity, 0.0, 1.0);
  fragColor = vec4(clamp(col, 0.0, 1.0) * a, a);
}
`;

const ctxMap = new WeakMap();

export default function initScanner(container, options = {}) {
  // 默认配置（与 React 组件默认值一致）
  const props = {
    color1: '#5227FF',
    color2: '#FF9FFC',
    color3: '#FFFFFF',
    speed: 0.5,
    sweepSpeed: 0.25,
    sweepWidth: 1.6,
    sweepFalloff: 6,
    scale: 1.5,
    frequency: 2,
    ripple: 0.22,
    bandDensity: 11,
    lineSharpness: 5.5,
    glow: 0.22,
    scanDirection: 'vertical',
    colorSpread: 0.7,
    brightness: 1.0,
    contrast: 1.15,
    softness: 1.4,
    vignette: 0.45,
    scanline: true,
    grain: true,
    grainIntensity: 0.05,
    opacity: 1.0,
    mouseInteraction: true,
    mouseRadius: 0.5,
    mouseStrength: 0.5,
    ...options
  };

  let mouseInteractionRef = props.mouseInteraction;

  // 创建 Renderer
  const renderer = new Renderer({
    webgl: 2,
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    dpr: Math.min(window.devicePixelRatio || 1, 2)
  });

  const gl = renderer.gl;
  gl.clearColor(0, 0, 0, 0);

  const canvas = gl.canvas;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  container.appendChild(canvas);

  // 创建全屏三角形几何体
  const geometry = new Triangle(gl);

  // 渲染程序
  const program = new Program(gl, {
    vertex,
    fragment,
    uniforms: {
      iTime: { value: 0 },
      iResolution: { value: new Float32Array([1, 1]) },
      uSpeed: { value: props.speed },
      uSweepSpeed: { value: props.sweepSpeed },
      uSweepWidth: { value: props.sweepWidth },
      uSweepFalloff: { value: props.sweepFalloff },
      uScale: { value: props.scale },
      uFrequency: { value: props.frequency },
      uRipple: { value: props.ripple },
      uBandDensity: { value: props.bandDensity },
      uLineSharpness: { value: props.lineSharpness },
      uGlow: { value: props.glow },
      uColorSpread: { value: props.colorSpread },
      uBrightness: { value: props.brightness },
      uContrast: { value: props.contrast },
      uSoftness: { value: props.softness },
      uVignette: { value: props.vignette },
      uOpacity: { value: props.opacity },
      uScanline: { value: props.scanline ? 1.0 : 0.0 },
      uGrain: { value: props.grain ? 1.0 : 0.0 },
      uGrainIntensity: { value: props.grainIntensity },
      uDirection: { value: directionToFloat(props.scanDirection) },
      uMouse: { value: new Float32Array([0.5, 0.5]) },
      uMouseEnabled: { value: props.mouseInteraction ? 1.0 : 0.0 },
      uMouseRadius: { value: props.mouseRadius },
      uMouseStrength: { value: props.mouseStrength },
      uMouseActive: { value: 0.0 },
      uColor1: { value: new Float32Array(hexToRgb(props.color1)) },
      uColor2: { value: new Float32Array(hexToRgb(props.color2)) },
      uColor3: { value: new Float32Array(hexToRgb(props.color3)) }
    }
  });

  const mesh = new Mesh(gl, { geometry, program });
  ctxMap.set(container, { renderer, program, mesh });

  // 设置尺寸
  const setSize = () => {
    const rect = container.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    renderer.setSize(w, h);

    const res = program.uniforms.iResolution.value;
    res[0] = gl.drawingBufferWidth;
    res[1] = gl.drawingBufferHeight;

    renderer.render({ scene: mesh });
  };

  // ResizeObserver
  const ro = new ResizeObserver(setSize);
  ro.observe(container);
  setSize();

  // 鼠标状态
  let currentMouse = [0.5, 0.5];
  let targetMouse = [0.5, 0.5];
  let mouseActive = 0;
  let targetMouseActive = 0;

  // 鼠标事件
  const onMouseMove = (e) => {
    const rect = canvas.getBoundingClientRect();
    targetMouse = [
      (e.clientX - rect.left) / rect.width,
      1.0 - (e.clientY - rect.top) / rect.height
    ];
    targetMouseActive = 1;
  };

  const onMouseLeave = () => {
    targetMouseActive = 0;
  };

  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseleave', onMouseLeave);

  // 动画循环
  let raf = 0;
  let isVisible = true;
  let isPageVisible = !document.hidden;
  const t0 = performance.now();

  const loop = (t) => {
    program.uniforms.iTime.value = (t - t0) * 0.001;

    if (!mouseInteractionRef) {
      targetMouseActive = 0;
    }

    // 平滑鼠标跟随
    currentMouse[0] += 0.05 * (targetMouse[0] - currentMouse[0]);
    currentMouse[1] += 0.05 * (targetMouse[1] - currentMouse[1]);
    program.uniforms.uMouse.value[0] = currentMouse[0];
    program.uniforms.uMouse.value[1] = currentMouse[1];

    mouseActive += 0.05 * (targetMouseActive - mouseActive);
    program.uniforms.uMouseActive.value = mouseActive;

    renderer.render({ scene: mesh });
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

  console.log('[Scanner] Initialized');

  // 返回控制接口
  return {
    update(newProps) {
      Object.assign(props, newProps);

      const u = program.uniforms;
      u.uSpeed.value = props.speed;
      u.uSweepSpeed.value = props.sweepSpeed;
      u.uSweepWidth.value = props.sweepWidth;
      u.uSweepFalloff.value = props.sweepFalloff;
      u.uScale.value = props.scale;
      u.uFrequency.value = props.frequency;
      u.uRipple.value = props.ripple;
      u.uBandDensity.value = props.bandDensity;
      u.uLineSharpness.value = props.lineSharpness;
      u.uGlow.value = props.glow;
      u.uColorSpread.value = props.colorSpread;
      u.uBrightness.value = props.brightness;
      u.uContrast.value = props.contrast;
      u.uSoftness.value = props.softness;
      u.uVignette.value = props.vignette;
      u.uOpacity.value = props.opacity;
      u.uScanline.value = props.scanline ? 1.0 : 0.0;
      u.uGrain.value = props.grain ? 1.0 : 0.0;
      u.uGrainIntensity.value = props.grainIntensity;
      u.uDirection.value = directionToFloat(props.scanDirection);
      u.uMouseEnabled.value = props.mouseInteraction ? 1.0 : 0.0;
      u.uMouseRadius.value = props.mouseRadius;
      u.uMouseStrength.value = props.mouseStrength;

      const c1 = hexToRgb(props.color1);
      u.uColor1.value[0] = c1[0];
      u.uColor1.value[1] = c1[1];
      u.uColor1.value[2] = c1[2];

      const c2 = hexToRgb(props.color2);
      u.uColor2.value[0] = c2[0];
      u.uColor2.value[1] = c2[1];
      u.uColor2.value[2] = c2[2];

      const c3 = hexToRgb(props.color3);
      u.uColor3.value[0] = c3[0];
      u.uColor3.value[1] = c3[1];
      u.uColor3.value[2] = c3[2];

      mouseInteractionRef = props.mouseInteraction;
    },

    destroy() {
      tryStop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseleave', onMouseLeave);
      ctxMap.delete(container);

      try {
        container.removeChild(canvas);
      } catch {}

      gl.getExtension('WEBGL_lose_context')?.loseContext();
      console.log('[Scanner] Destroyed');
    }
  };
}
