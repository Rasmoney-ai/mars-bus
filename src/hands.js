// The user's own hands, drawn as puffy astronaut gloves from WebXR hand
// tracking (optional feature). If controllers are used instead, a simple
// glove sits on each controller. Controllers are never required.

import * as THREE from 'three';
import { SEATS } from './config.js';
import { gloveGeometry } from './passengers.js';

const CHAINS = [
  ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'],
  ...['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'].map((f) => [
    `${f}-phalanx-proximal`, `${f}-phalanx-intermediate`, `${f}-phalanx-distal`, `${f}-tip`,
  ]),
];
const JOINTS_PER_HAND = CHAINS.reduce((a, c) => a + c.length, 0);
const BONES_PER_HAND = CHAINS.reduce((a, c) => a + c.length - 1, 0);
const Y = new THREE.Vector3(0, 1, 0);

export class UserHands {
  constructor(renderer, rig) {
    this.group = new THREE.Group();
    this.group.name = 'user-hands';
    rig.add(this.group);

    this.hands = [renderer.xr.getHand(0), renderer.xr.getHand(1)];
    for (const h of this.hands) rig.add(h);

    this.gloveMat = new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true });
    this.cuffMat = new THREE.MeshLambertMaterial({ color: '#cccccc', flatShading: true });
    this.joints = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), this.gloveMat, JOINTS_PER_HAND * 2);
    this.bones = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 8, 1, true), this.gloveMat, BONES_PER_HAND * 2);
    this.palms = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.gloveMat, 2);
    this.cuffs = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1.1, 1, 10).rotateX(Math.PI / 2), this.cuffMat, 2);
    for (const m of [this.joints, this.bones, this.palms, this.cuffs]) {
      m.count = 0;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
    }

    // Controller fallback: a glove on each grip.
    this.grips = [renderer.xr.getControllerGrip(0), renderer.xr.getControllerGrip(1)];
    this.isHand = [false, false];
    this.gripGloves = [];
    this.grips.forEach((grip, i) => {
      rig.add(grip);
      grip.addEventListener('connected', (e) => {
        this.isHand[i] = !!e.data.hand;
        const side = e.data.handedness === 'left' ? -1 : 1;
        grip.clear();
        const glove = new THREE.Mesh(gloveGeometry(side, 'rest'), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
        glove.rotation.set(-0.6, 0, side * Math.PI / 2);
        glove.position.set(0, 0, 0.05);
        glove.material.color.copy(this.gloveMat.color);
        glove.visible = !this.isHand[i];
        grip.add(glove);
        this.gripGloves[i] = glove;
      });
      grip.addEventListener('disconnected', () => { grip.clear(); this.gripGloves[i] = null; });
    });

    this._m = new THREE.Matrix4();
    this._p = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
  }

  setSeat(seat) {
    const c = new THREE.Color(SEATS.colors[seat - 1]);
    this.cuffMat.color.copy(c);
    this.gloveMat.color.copy(c).lerp(new THREE.Color('#f2f2f2'), 0.85);
    for (const g of this.gripGloves) if (g) g.material.color.copy(this.gloveMat.color);
  }

  // Tracked index fingertip of hand i (rig space), or null.
  indexTip(i) {
    const hand = this.hands[i];
    const tip = hand && hand.visible && hand.joints && hand.joints['index-finger-tip'];
    return tip && tip.visible ? tip.position : null;
  }

  update() {
    let js = 0, bs = 0, ps = 0;
    for (let i = 0; i < 2; i++) {
      const hand = this.hands[i];
      const J = hand.joints;
      const wrist = J && J.wrist;
      if (!hand.visible || !wrist || !wrist.visible) continue;
      for (const chain of CHAINS) {
        for (let k = 0; k < chain.length; k++) {
          const j = J[chain[k]];
          if (!j || !j.visible) continue;
          const r = (j.jointRadius || 0.009) * 1.6;
          this._m.compose(j.position, j.quaternion, this._s.set(r, r, r));
          this.joints.setMatrixAt(js++, this._m);
          const prev = k > 0 ? J[chain[k - 1]] : null;
          if (prev && prev.visible) {
            this._d.subVectors(j.position, prev.position);
            const len = this._d.length();
            if (len < 1e-5) continue;
            this._q.setFromUnitVectors(Y, this._d.multiplyScalar(1 / len));
            this._p.addVectors(j.position, prev.position).multiplyScalar(0.5);
            const br = ((prev.jointRadius || 0.009) + (j.jointRadius || 0.009)) * 0.75;
            this._m.compose(this._p, this._q, this._s.set(br, len, br));
            this.bones.setMatrixAt(bs++, this._m);
          }
        }
      }
      // Palm between the wrist and the knuckles, and a cuff behind the wrist.
      const mid = J['middle-finger-phalanx-proximal'];
      const idx = J['index-finger-phalanx-proximal'];
      const pinky = J['pinky-finger-phalanx-proximal'];
      if (mid && idx && pinky && mid.visible) {
        const len = wrist.position.distanceTo(mid.position);
        const width = idx.position.distanceTo(pinky.position) + 0.022;
        this._p.addVectors(wrist.position, mid.position).multiplyScalar(0.5);
        this._m.compose(this._p, wrist.quaternion, this._s.set(width, 0.036, len + 0.012));
        this.palms.setMatrixAt(ps, this._m);
        this._p.set(0, 0, 0.035).applyQuaternion(wrist.quaternion).add(wrist.position);
        this._m.compose(this._p, wrist.quaternion, this._s.set(0.04, 0.036, 0.06));
        this.cuffs.setMatrixAt(ps, this._m);
        ps++;
      }
    }
    this.joints.count = js;
    this.bones.count = bs;
    this.palms.count = ps;
    this.cuffs.count = ps;
    for (const m of [this.joints, this.bones, this.palms, this.cuffs]) m.instanceMatrix.needsUpdate = true;
    this.gripGloves.forEach((g, i) => { if (g) g.visible = !this.isHand[i]; });
  }
}
