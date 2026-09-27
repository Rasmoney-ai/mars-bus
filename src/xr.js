// Starting and ending the VR session on Meta Quest.
// Reference space 'local-floor': the real floor is y = 0, so the virtual
// seat height can match a real chair. When the user recentres (holding the
// Meta button), the reference space fires 'reset' and the new origin is
// wherever the user sits and looks.

export class VRSession {
  // handlers: { onStart(session), onEnd(), onVisibility(state), onReset() }
  constructor(renderer, handlers) {
    this.renderer = renderer;
    this.handlers = handlers;
    this.session = null;
    this.floorLevel = true;
  }

  get active() {
    return this.session !== null;
  }

  // Returns { supported, message } with a Danish message for the start page.
  async checkSupport() {
    if (!('xr' in navigator)) {
      if (!window.isSecureContext) return { supported: false, message: 'VR kræver en sikker forbindelse (https).' };
      return { supported: false, message: 'Denne browser kan ikke vise VR. Åbn siden i Meta Quest-browseren, eller se turen på skærmen.' };
    }
    try {
      const ok = await navigator.xr.isSessionSupported('immersive-vr');
      if (!ok) return { supported: false, message: 'Der er ingen VR-brille. Du kan se turen på skærmen.' };
      return { supported: true, message: '' };
    } catch {
      return { supported: false, message: 'VR er ikke tilgængelig lige nu.' };
    }
  }

  async enter() {
    if (this.session) return;
    const session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'hand-tracking', 'layers'],
    });
    // Fall back to 'local' if the floor is not available (then the eye
    // height is assumed, see main.js).
    const features = session.enabledFeatures;
    this.floorLevel = !features || features.includes('local-floor');
    this.renderer.xr.setReferenceSpaceType(this.floorLevel ? 'local-floor' : 'local');

    session.addEventListener('end', () => {
      this.session = null;
      this.handlers.onEnd();
    });
    session.addEventListener('visibilitychange', () => this.handlers.onVisibility(session.visibilityState));
    await this.renderer.xr.setSession(session);
    this.session = session;
    const space = this.renderer.xr.getReferenceSpace();
    if (space && space.addEventListener) space.addEventListener('reset', () => this.handlers.onReset());
    this.handlers.onStart(session);
  }

  exit() {
    if (this.session) this.session.end();
  }
}
