import * as THREE from 'three';

// The sky carries the clock of this world: a ringed "moon" whose colour is
// the sky phase. Everything that has weight is weighed against it.
export class Sky {
  constructor() {
    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uMoonCol: { value: new THREE.Color() },
        uMoonDir: { value: new THREE.Vector3(1, 0.4, 0).normalize() },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main(){
          vDir = position;
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uMoonCol; uniform vec3 uMoonDir; uniform float uTime;
        varying vec3 vDir;
        float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        void main(){
          vec3 d = normalize(vDir);
          float t = clamp(d.y * 1.4 + 0.08, 0.0, 1.0);
          vec3 c = mix(uHorizon, uTop, pow(t, 0.6));
          float s = hash(floor(d * 280.0));
          c += step(0.9975, s) * vec3(0.7, 0.75, 0.9) * smoothstep(0.0, 0.25, d.y) * (0.6 + 0.4 * sin(uTime * 3.0 + s * 90.0));
          float a = sin(d.x * 5.0 + uTime * 0.05 + sin(d.z * 3.0)) * sin(d.z * 4.0 - uTime * 0.035);
          c += uMoonCol * 0.07 * smoothstep(0.35, 1.0, a) * smoothstep(0.05, 0.6, d.y);
          vec3 md = normalize(uMoonDir);
          float m = dot(d, md);
          c += uMoonCol * pow(max(m, 0.0), 60.0) * 0.35;
          c = mix(c, uMoonCol * 2.2, smoothstep(0.9965, 0.9975, m));
          // tilted ring
          vec3 ax = normalize(vec3(0.3, 1.0, 0.2));
          vec3 q = d - md * m;
          float ring = abs(dot(normalize(q + 1e-5), ax));
          float rr = smoothstep(0.985, 0.988, m) * (1.0 - smoothstep(0.9915, 0.993, m)) * smoothstep(0.35, 0.0, ring);
          c += uMoonCol * rr * 1.4;
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
  }

  update(skyPhase, time, camPos, moonColor, top, horizon) {
    const u = this.material.uniforms;
    u.uMoonDir.value.set(Math.cos(skyPhase), 0.45, Math.sin(skyPhase)).normalize();
    u.uMoonCol.value.copy(moonColor);
    u.uTop.value.copy(top);
    u.uHorizon.value.copy(horizon);
    u.uTime.value = time;
    this.mesh.position.copy(camPos);
  }
}
