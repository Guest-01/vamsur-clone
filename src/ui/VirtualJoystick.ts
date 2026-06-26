import Phaser from 'phaser';
import { SCENES } from '../types';
import { COLORS, DEPTH } from '../config/balance';
import { MoveInput } from '../input/MoveInput';

const RADIUS = 96; // joystick travel radius (design px)
const KNOB = 42;
const DEADZONE = 8;
const JOY_DEPTH = DEPTH.POPTEXT + 6; // above the HUD, below the overlays

/**
 * Floating on-screen joystick for touch devices (mobile). It appears wherever a
 * finger touches the open play area and writes a unit-disk vector into the
 * shared {@link MoveInput} that the Player reads. Mouse input is ignored (so
 * desktop keyboard play is unaffected); on-screen buttons (higher depth) keep
 * input priority because the catch-zone sits at a low depth.
 */
export class VirtualJoystick {
  private readonly scene: Phaser.Scene;
  private readonly zone: Phaser.GameObjects.Zone;
  private readonly base: Phaser.GameObjects.Arc;
  private readonly knob: Phaser.GameObjects.Arc;

  private pointerId = -1;
  private active = false;
  private baseX = 0;
  private baseY = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;

    // Huge, low-depth catch zone so it covers any screen size yet loses input
    // priority to the (higher-depth) HUD buttons and overlays.
    this.zone = scene.add
      .zone(0, 0, 100000, 100000)
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1)
      .setInteractive();

    this.base = scene.add
      .circle(0, 0, RADIUS, 0xffffff, 0.1)
      .setStrokeStyle(4, COLORS.GOLD, 0.45)
      .setScrollFactor(0)
      .setDepth(JOY_DEPTH)
      .setVisible(false);
    this.knob = scene.add
      .circle(0, 0, KNOB, 0xffffff, 0.32)
      .setStrokeStyle(3, COLORS.GOLD_LIGHT, 0.7)
      .setScrollFactor(0)
      .setDepth(JOY_DEPTH + 1)
      .setVisible(false);

    this.zone.on('pointerdown', this.onDown, this);
    scene.input.on('pointermove', this.onMove, this);
    scene.input.on('pointerup', this.onUp, this);
    scene.input.on('pointerupoutside', this.onUp, this);
  }

  private onDown(pointer: Phaser.Input.Pointer): void {
    if (this.active) return; // already tracking a finger
    if (!pointer.wasTouch) return; // ignore desktop mouse — keyboard play is unaffected
    // Don't grab touches while gameplay is paused (level-up / pause screens),
    // so taps there reach the overlay instead of arming the stick behind it.
    if (this.scene.scene.isPaused(SCENES.GAME)) return;
    this.active = true;
    this.pointerId = pointer.id;
    this.baseX = pointer.x;
    this.baseY = pointer.y;
    this.base.setPosition(this.baseX, this.baseY).setVisible(true);
    this.knob.setPosition(this.baseX, this.baseY).setVisible(true);
    MoveInput.clear();
  }

  private onMove(pointer: Phaser.Input.Pointer): void {
    if (!this.active || pointer.id !== this.pointerId) return;
    let dx = pointer.x - this.baseX;
    let dy = pointer.y - this.baseY;
    const len = Math.hypot(dx, dy);
    if (len > RADIUS) {
      const k = RADIUS / len;
      dx *= k;
      dy *= k;
    }
    this.knob.setPosition(this.baseX + dx, this.baseY + dy);
    if (len < DEADZONE) MoveInput.clear();
    else MoveInput.set(dx / RADIUS, dy / RADIUS);
  }

  private onUp(pointer: Phaser.Input.Pointer): void {
    if (pointer.id !== this.pointerId) return;
    this.active = false;
    this.pointerId = -1;
    this.base.setVisible(false);
    this.knob.setVisible(false);
    MoveInput.clear();
  }

  destroy(): void {
    this.zone.off('pointerdown', this.onDown, this);
    this.scene.input.off('pointermove', this.onMove, this);
    this.scene.input.off('pointerup', this.onUp, this);
    this.scene.input.off('pointerupoutside', this.onUp, this);
    this.zone.destroy();
    this.base.destroy();
    this.knob.destroy();
    MoveInput.clear();
  }
}
