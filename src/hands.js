// The user's own hands, drawn as astronaut gloves (Claude Design, see
// suit.js) driven by WebXR hand tracking (optional feature). Each glove bone
// is named like a WebXR joint, so the joint poses are copied straight onto
// the bones. With controllers instead, a glove in a resting pose sits on
// each controller. Controllers are never required.

import * as THREE from 'three';
import { liveGlove, bakedGlove, JOINTS } from './suit.js';

export class UserHands {
  constructor(renderer, rig) {
    this.hands = [renderer.xr.getHand(0), renderer.xr.getHand(1)];
    for (const h of this.hands) rig.add(h);

    // Live gloves, keyed by handedness. Their group stays at the rig origin.
    this.gloves = { left: liveGlove('left'), right: liveGlove('right') };
    this.handedness = [null, null];
    for (const g of Object.values(this.gloves)) {
      g.group.visible = false;
      rig.add(g.group);
    }
    this.hands.forEach((hand, i) => {
      hand.addEventListener('connected', (e) => { this.handedness[i] = e.data.hand ? e.data.handedness : null; });
      hand.addEventListener('disconnected', () => { this.handedness[i] = null; });
    });

    // Controller fallback: a glove in a resting pose on each grip.
    this.grips = [renderer.xr.getControllerGrip(0), renderer.xr.getControllerGrip(1)];
    this.isHand = [false, false];
    this.gripGloves = [];
    const gripMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.grips.forEach((grip, i) => {
      rig.add(grip);
      grip.addEventListener('connected', (e) => {
        this.isHand[i] = !!e.data.hand;
        const side = e.data.handedness === 'left' ? -1 : 1;
        grip.clear();
        const glove = new THREE.Mesh(bakedGlove(side, 'rest', { lowDetail: false }), gripMat);
        glove.rotation.set(-0.6, 0, side * Math.PI / 2);
        glove.position.set(0, 0, 0.05);
        glove.visible = !this.isHand[i];
        grip.add(glove);
        this.gripGloves[i] = glove;
      });
      grip.addEventListener('disconnected', () => { grip.clear(); this.gripGloves[i] = null; });
    });
  }

  // Kept for compatibility: the gloves are white with gold details.
  setSeat() {}

  // Tracked index fingertip of hand i (rig space), or null.
  indexTip(i) {
    const hand = this.hands[i];
    const tip = hand && hand.visible && hand.joints && hand.joints['index-finger-tip'];
    return tip && tip.visible ? tip.position : null;
  }

  update() {
    const seen = { left: false, right: false };
    this.hands.forEach((hand, i) => {
      const side = this.handedness[i];
      const J = hand.joints;
      if (!side || !hand.visible || !J || !J.wrist || !J.wrist.visible) return;
      const glove = this.gloves[side];
      for (const name of JOINTS) {
        const j = J[name];
        if (!j || !j.visible) continue;
        const bone = glove.bones[name];
        bone.position.copy(j.position);
        bone.quaternion.copy(j.quaternion);
      }
      seen[side] = true;
    });
    for (const side of ['left', 'right']) this.gloves[side].group.visible = seen[side];
    this.gripGloves.forEach((g, i) => { if (g) g.visible = !this.isHand[i]; });
  }
}
