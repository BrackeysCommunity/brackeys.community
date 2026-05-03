#version 300 es
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform float uTimeSpeed;
uniform float uColorBalance;
uniform float uWarpStrength;
uniform float uWarpFrequency;
uniform float uWarpSpeed;
uniform float uWarpAmplitude;
uniform float uBlendAngle;
uniform float uBlendSoftness;
uniform float uRotationAmount;
uniform float uNoiseScale;
uniform float uGrainAmount;
uniform float uGrainScale;
uniform float uGrainAnimated;
uniform float uContrast;
uniform float uGamma;
uniform float uSaturation;
uniform vec2 uCenterOffset;
uniform float uZoom;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform float uGrainOnly;
out vec4 fragColor;
#define S(a,b,t) smoothstep(a,b,t)
mat2 Rot(float a){float s=sin(a),c=cos(a);return mat2(c,-s,s,c);}
vec2 hash(vec2 p){p=vec2(dot(p,vec2(2127.1,81.17)),dot(p,vec2(1269.5,283.37)));return fract(sin(p)*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.0-2.0*f);float n=mix(mix(dot(-1.0+2.0*hash(i+vec2(0.0,0.0)),f-vec2(0.0,0.0)),dot(-1.0+2.0*hash(i+vec2(1.0,0.0)),f-vec2(1.0,0.0)),u.x),mix(dot(-1.0+2.0*hash(i+vec2(0.0,1.0)),f-vec2(0.0,1.0)),dot(-1.0+2.0*hash(i+vec2(1.0,1.0)),f-vec2(1.0,1.0)),u.x),u.y);return 0.5+0.5*n;}
void main(){
  float t = iTime * uTimeSpeed;
  vec2 uv = gl_FragCoord.xy / iResolution.xy;

  // Grain texture is locked to screen UV — only animates if explicitly
  // opted in. Movement comes from the warped blob field and the
  // slow-noise mask below modulating where this static grain is visible.
  vec2 grainUv = uv * max(uGrainScale, 0.001);
  if (uGrainAnimated > 0.5) { grainUv += vec2(iTime * 0.05); }
  float grain = fract(sin(dot(grainUv, vec2(12.9898, 78.233))) * 43758.5453);

  // Slow low-frequency animated noise mask — produces patches of grain
  // that fade in and out across the surface, independent of the color
  // blobs. This is what gives the surface its "breathing" feel.
  float mask = noise(uv * 2.5 + vec2(iTime * 0.32, iTime * -0.27));
  mask = smoothstep(0.25, 0.85, mask);

  // Warped UV — the field that animates the "blobs". Shared by both modes
  // so grainOnly mode gets the same moving structure as the colored mode.
  float ratio = iResolution.x / iResolution.y;
  vec2 tuv = uv - 0.5 + uCenterOffset;
  tuv /= max(uZoom, 0.001);

  float degree = noise(vec2(t * 0.1, tuv.x * tuv.y) * uNoiseScale);
  tuv.y *= 1.0 / ratio;
  tuv *= Rot(radians((degree - 0.5) * uRotationAmount + 180.0));
  tuv.y *= ratio;

  float frequency = uWarpFrequency;
  float ws = max(uWarpStrength, 0.001);
  float amplitude = uWarpAmplitude / ws;
  float warpTime = t * uWarpSpeed;
  tuv.x += sin(tuv.y * frequency + warpTime) / amplitude;
  tuv.y += sin(tuv.x * (frequency * 1.5) + warpTime) / (amplitude * 0.5);

  float b = uColorBalance;
  float s = max(uBlendSoftness, 0.0);
  mat2 blendRot = Rot(radians(uBlendAngle));
  float blendX = (tuv * blendRot).x;
  float edge0 = -0.3 - b - s;
  float edge1 = 0.2 - b + s;
  float v0 = 0.5 - b + s;
  float v1 = -0.3 - b - s;
  float blobX = S(edge0, edge1, blendX);
  float blobY = S(v0, v1, tuv.y);

  if (uGrainOnly > 0.5) {
    // Moving patches of grain: grain pattern stays put, the slow mask
    // (and to a lesser extent the blob field) shape its visibility.
    // Output is grayscale centered on 0.5 — pair with mix-blend-overlay.
    float blob = smoothstep(0.1, 0.9, mix(blobX, blobY, 0.5));
    float visibility = mix(mask, blob, 0.35);
    float v = 0.5 + (grain - 0.5) * uGrainAmount * 2.0 * visibility;
    fragColor = vec4(vec3(v), 1.0);
    return;
  }

  vec3 layer1 = mix(uColor3, uColor2, blobX);
  vec3 layer2 = mix(uColor2, uColor1, blobX);
  vec3 col = mix(layer1, layer2, blobY);

  col += (grain - 0.5) * uGrainAmount * mask;
  col = (col - 0.5) * uContrast + 0.5;
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(luma), col, uSaturation);
  col = pow(max(col, 0.0), vec3(1.0 / max(uGamma, 0.001)));
  col = clamp(col, 0.0, 1.0);

  fragColor = vec4(col, 1.0);
}
